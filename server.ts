import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  formatGeminiError,
  recordConsentAndAcknowledgement,
  runCaseClosureAgent,
  runConsultationAgent,
  runEscalationAgentScan,
  runPatientVoiceCoordinatorTurn,
  runReferralAgent,
  runResultIntakeAgent,
  synthesizeSpeechBase64,
  transcribeAudioClip,
  triggerHumanHandoff,
  resolveEscalationAlert,
  updateConsultationStatus,
  updateReferralStatus,
} from './server/coordinatorService';
import { isGeminiConfigured } from './server/geminiClient';
import { attachLiveVoiceWebSocket } from './server/liveVoiceBridge';
import { getSharedState, resetSharedState } from './server/sharedStore';
import {
  ConsultationStatus,
  LanguageCode,
  ReferralStatus,
  UserRole,
} from './src/types/carebridge';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Health & Config Check (never exposes keys)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      geminiConfigured: isGeminiConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  // Shared Multi-Agent Database State
  app.get('/api/state', (_req, res) => {
    res.json(getSharedState());
  });

  app.post('/api/state/reset', (req, res) => {
    const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId : undefined;
    res.json(resetSharedState(ownerId));
  });

  // AGENT 1: Result Intake Agent
  app.post('/api/coordinator/intake', (req, res) => {
    try {
      const {
        patientName,
        age,
        preferredLanguage,
        screeningType,
        screeningValue,
        assignedClinician,
        actorName,
        actorRole,
        ownerId,
      } = req.body || {};

      if (!patientName || !screeningType || !screeningValue) {
        res.status(400).json({ error: 'patientName, screeningType, and screeningValue are required.' });
        return;
      }

      const result = runResultIntakeAgent({
        patientName: String(patientName),
        age: typeof age === 'number' ? age : age ? Number(age) : undefined,
        preferredLanguage: preferredLanguage === 'kn' ? 'kn' : 'en',
        screeningType: String(screeningType),
        screeningValue: String(screeningValue),
        assignedClinician: assignedClinician ? String(assignedClinician) : undefined,
        actorName: String(actorName || 'Care Coordinator'),
        actorRole: (actorRole || 'coordinator') as UserRole,
        ownerId: ownerId ? String(ownerId) : undefined,
      });
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create intake.';
      res.status(msg.startsWith('RBAC_DENIED') ? 403 : 400).json({ error: msg });
    }
  });

  // AGENT 2 Direct Consent & Acknowledgement
  app.post('/api/coordinator/consent', (req, res) => {
    try {
      const { caseId, consentGranted, resultAcknowledged, language, actorName, actorRole } =
        req.body || {};
      if (!caseId) {
        res.status(400).json({ error: 'caseId is required.' });
        return;
      }
      const result = recordConsentAndAcknowledgement({
        caseId: String(caseId),
        consentGranted: Boolean(consentGranted),
        resultAcknowledged: Boolean(resultAcknowledged),
        language: (language === 'kn' ? 'kn' : 'en') as LanguageCode,
        actorName: String(actorName || 'Care Coordinator'),
        actorRole: (actorRole || 'coordinator') as UserRole,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Consent update failed.';
      res.status(400).json({ error: msg });
    }
  });

  // AGENT 2 + CENTRAL COORDINATOR: Bilingual Voice/Text Turn + TTS
  app.post('/api/coordinator/voice-turn', async (req, res) => {
    try {
      const {
        caseId,
        utterance,
        language,
        grantConsentExplicitly,
        actorName,
        actorRole,
        includeTts,
      } = req.body || {};

      if (!caseId || !utterance) {
        res.status(400).json({ error: 'caseId and utterance are required.' });
        return;
      }

      const result = await runPatientVoiceCoordinatorTurn({
        caseId: String(caseId),
        utterance: String(utterance),
        language: (language === 'kn' ? 'kn' : 'en') as LanguageCode,
        grantConsentExplicitly: Boolean(grantConsentExplicitly),
        actorName: String(actorName || 'Patient Voice Session'),
        actorRole: (actorRole || 'coordinator') as UserRole,
        includeTts: includeTts !== false,
      });
      res.json(result);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Audio Transcription endpoint (Gemini 3.5 Transcribe)
  app.post('/api/voice/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType, language } = req.body || {};
      if (!audioBase64) {
        res.status(400).json({ error: 'audioBase64 is required.' });
        return;
      }
      const transcript = await transcribeAudioClip(
        String(audioBase64),
        String(mimeType || 'audio/webm'),
        language === 'kn' ? 'kn' : 'en'
      );
      res.json({ transcript });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Text-to-Speech endpoint (Gemini 3.8 Flash Lite TTS)
  app.post('/api/voice/tts', async (req, res) => {
    try {
      const { text } = req.body || {};
      if (!text) {
        res.status(400).json({ error: 'text is required.' });
        return;
      }
      const audioBase64 = await synthesizeSpeechBase64(String(text));
      res.json({ audioBase64, mimeType: 'audio/wav' });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // AGENT 3: Consultation Agent
  app.post('/api/coordinator/consultation', (req, res) => {
    try {
      const {
        caseId,
        preferredDate,
        preferredSlot,
        mode,
        languageSupport,
        department,
        notes,
        actorName,
        actorRole,
      } = req.body || {};

      if (!caseId || !preferredDate) {
        res.status(400).json({ error: 'caseId and preferredDate are required.' });
        return;
      }

      const result = runConsultationAgent({
        caseId: String(caseId),
        preferredDate: String(preferredDate),
        preferredSlot: preferredSlot ? String(preferredSlot) : undefined,
        mode: mode === 'telehealth' ? 'telehealth' : 'in_person',
        languageSupport,
        department: department ? String(department) : undefined,
        notes: notes ? String(notes) : undefined,
        actorName: String(actorName || 'Care Coordinator'),
        actorRole: (actorRole || 'coordinator') as UserRole,
      });
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Consultation creation failed.';
      res.status(400).json({ error: msg });
    }
  });

  app.patch('/api/coordinator/consultation/:id', (req, res) => {
    try {
      const { status, actorName, actorRole } = req.body || {};
      const state = updateConsultationStatus({
        consultationId: req.params.id,
        status: status as ConsultationStatus,
        actorName: String(actorName || 'Care Coordinator'),
        actorRole: (actorRole || 'coordinator') as UserRole,
      });
      res.json({ state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Consultation update failed.';
      res.status(msg.startsWith('RBAC_DENIED') ? 403 : 400).json({ error: msg });
    }
  });

  // AGENT 4: Referral Agent
  app.post('/api/coordinator/referral', (req, res) => {
    try {
      const { caseId, fromClinic, toFacility, specialty, actorName, actorRole } = req.body || {};
      if (!caseId || !fromClinic || !toFacility || !specialty) {
        res.status(400).json({ error: 'caseId, fromClinic, toFacility, and specialty are required.' });
        return;
      }
      const result = runReferralAgent({
        caseId: String(caseId),
        fromClinic: String(fromClinic),
        toFacility: String(toFacility),
        specialty: String(specialty),
        actorName: String(actorName || 'Care Coordinator'),
        actorRole: (actorRole || 'coordinator') as UserRole,
      });
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Referral creation failed.';
      res.status(400).json({ error: msg });
    }
  });

  app.patch('/api/coordinator/referral/:id', (req, res) => {
    try {
      const { status, actorName, actorRole } = req.body || {};
      const state = updateReferralStatus({
        referralId: req.params.id,
        status: status as ReferralStatus,
        actorName: String(actorName || 'Care Coordinator'),
        actorRole: (actorRole || 'coordinator') as UserRole,
      });
      res.json({ state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Referral update failed.';
      res.status(msg.startsWith('RBAC_DENIED') ? 403 : 400).json({ error: msg });
    }
  });

  // AGENT 5: Escalation Agent & Human Handoff
  app.post('/api/coordinator/escalation/scan', (req, res) => {
    try {
      const { actorName, actorRole } = req.body || {};
      const result = runEscalationAgentScan({
        actorName: String(actorName || 'Care Coordinator'),
        actorRole: (actorRole || 'coordinator') as UserRole,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Escalation scan failed.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/coordinator/escalation/:id/resolve', (req, res) => {
    try {
      const { resolutionNote, actorName, actorRole } = req.body || {};
      const state = resolveEscalationAlert({
        escalationId: req.params.id,
        resolutionNote: String(resolutionNote || 'Reviewed and followed up by clinical staff.'),
        actorName: String(actorName || 'Clinician'),
        actorRole: (actorRole || 'clinician') as UserRole,
      });
      res.json({ state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Escalation resolve failed.';
      res.status(msg.startsWith('RBAC_DENIED') ? 403 : 400).json({ error: msg });
    }
  });

  app.post('/api/coordinator/handoff', (req, res) => {
    try {
      const { caseId, reason, actorName, actorRole } = req.body || {};
      if (!caseId || !reason) {
        res.status(400).json({ error: 'caseId and reason are required.' });
        return;
      }
      const state = triggerHumanHandoff({
        caseId: String(caseId),
        reason: String(reason),
        actorName: String(actorName || 'Care Coordinator'),
        actorRole: (actorRole || 'coordinator') as UserRole,
      });
      res.json({ state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Human handoff failed.';
      res.status(400).json({ error: msg });
    }
  });

  // AGENT 6: Case Closure Agent (Requires Human Clinician Approval)
  app.post('/api/coordinator/closure', (req, res) => {
    try {
      const { caseId, approveClosure, actorName, actorRole } = req.body || {};
      if (!caseId) {
        res.status(400).json({ error: 'caseId is required.' });
        return;
      }
      const result = runCaseClosureAgent({
        caseId: String(caseId),
        approveClosure: Boolean(approveClosure),
        actorName: String(actorName || 'Clinician'),
        actorRole: (actorRole || 'coordinator') as UserRole,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Case closure check failed.';
      res.status(msg.startsWith('CLOSURE_BLOCKED') ? 403 : 400).json({ error: msg });
    }
  });

  const httpServer = http.createServer(app);
  attachLiveVoiceWebSocket(httpServer);

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`CareBridge AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CareBridge AI server:', err);
  process.exit(1);
});
