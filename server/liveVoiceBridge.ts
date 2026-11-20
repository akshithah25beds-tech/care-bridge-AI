import { FunctionDeclaration, LiveServerMessage, Modality, Type } from '@google/genai';
import { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { buildAuditEntry } from '../src/core/coordinatorRules';
import { LanguageCode, UserRole } from '../src/types/carebridge';
import {
  runConsultationAgent,
  runReferralAgent,
  triggerHumanHandoff,
} from './coordinatorService';
import { getGeminiClient, isGeminiConfigured } from './geminiClient';
import { getSharedState, makeId, mutateSharedState } from './sharedStore';

const liveCoordinatorTools: FunctionDeclaration[] = [
  {
    name: 'record_patient_consent_and_ack',
    description:
      'Records patient consent and/or screening result acknowledgement in the shared database.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        consentGranted: { type: Type.BOOLEAN },
        resultAcknowledged: { type: Type.BOOLEAN },
      },
      required: ['consentGranted', 'resultAcknowledged'],
    },
  },
  {
    name: 'schedule_consultation_request',
    description: 'Creates a doctor appointment consultation request.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preferredDate: { type: Type.STRING },
        preferredSlot: { type: Type.STRING },
        mode: { type: Type.STRING },
        notes: { type: Type.STRING },
      },
      required: ['preferredDate', 'mode'],
    },
  },
  {
    name: 'create_specialist_referral',
    description: 'Creates a specialist referral record.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        toFacility: { type: Type.STRING },
        specialty: { type: Type.STRING },
      },
      required: ['toFacility', 'specialty'],
    },
  },
  {
    name: 'request_human_clinician_handoff',
    description:
      'Immediately escalates to a human clinician when the patient asks for diagnosis, medications, or human staff.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING },
      },
      required: ['reason'],
    },
  },
];

export function attachLiveVoiceWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: '/api/voice/live' });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    const url = new URL(req.url || '/api/voice/live', 'http://localhost');
    const caseId = url.searchParams.get('caseId') || '';
    const language = (url.searchParams.get('language') === 'kn' ? 'kn' : 'en') as LanguageCode;
    const actorRole = (url.searchParams.get('role') || 'coordinator') as UserRole;
    const actorName = url.searchParams.get('actorName') || 'Voice Coordinator';

    if (!isGeminiConfigured()) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message: 'GEMINI_API_KEY is not configured on the server.',
        })
      );
      clientWs.close();
      return;
    }

    const state = getSharedState();
    const targetCase = state.cases.find((c) => c.id === caseId);
    if (!targetCase) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message: 'Selected patient case not found.',
        })
      );
      clientWs.close();
      return;
    }

    let liveSession: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>> | null = null;

    try {
      const ai = getGeminiClient();
      const systemInstruction = `You are the CareBridge AI Patient Voice Agent connected to the Central Multi-Agent Coordinator.
Speak naturally in ${language === 'kn' ? 'Kannada (ಕನ್ನಡ)' : 'English'}.
STRICT CLINICAL SAFETY: Never diagnose, never prescribe medicines, never determine clinical urgency independently.
Only explain the clinician-approved summary: "${targetCase.clinicianApprovedSummary || targetCase.clinicianProtocol}".
Ask for consent if consentGranted=${targetCase.consentGranted}. Record consent/acknowledgement, schedule consultations, create referrals, or escalate for human handoff using the provided tools.
Patient: ${targetCase.patientName} (${targetCase.patientCode}), Screening: ${targetCase.screeningType}, Assigned Clinician: ${targetCase.assignedClinician || 'Dr. Ananya Rao, MD'}.`;

      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          tools: [{ functionDeclarations: liveCoordinatorTools }],
          systemInstruction,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;

            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              const txt = content.inputTranscription.text;
              clientWs.send(JSON.stringify({ type: 'inputTranscript', text: txt }));
              mutateSharedState((draft) => {
                draft.transcripts.push({
                  id: makeId('trn'),
                  caseId,
                  speaker: 'patient',
                  language,
                  text: txt,
                  timestamp: new Date().toISOString(),
                });
              });
            }

            if (content?.outputTranscription?.text) {
              const txt = content.outputTranscription.text;
              clientWs.send(JSON.stringify({ type: 'outputTranscript', text: txt }));
              mutateSharedState((draft) => {
                draft.transcripts.push({
                  id: makeId('trn'),
                  caseId,
                  speaker: 'agent',
                  language,
                  text: txt,
                  agentAction: 'PatientVoiceAgent (Gemini Live Stream)',
                  timestamp: new Date().toISOString(),
                });
              });
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ type: 'audio', audio: part.inlineData.data }));
              }
            }

            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }

            for (const call of message.toolCall?.functionCalls ?? []) {
              const args = (call.args || {}) as Record<string, unknown>;
              let resultPayload: Record<string, unknown> = { ok: true };
              let actionLabel = '';

              if (call.name === 'record_patient_consent_and_ack') {
                const consent = Boolean(args.consentGranted);
                const ack = Boolean(args.resultAcknowledged);
                const ts = new Date().toISOString();
                mutateSharedState((draft) => {
                  const c = draft.cases.find((item) => item.id === caseId);
                  if (!c) return;
                  if (consent) {
                    c.consentGranted = true;
                    c.consentTimestamp = ts;
                  }
                  if (ack) c.resultAcknowledged = true;
                  c.stage = ack ? 'acknowledged' : 'voice_contacted';
                  c.updatedAt = ts;
                  draft.activities.unshift({
                    id: makeId('act'),
                    caseId,
                    ownerId: c.ownerId,
                    agentName: 'PatientVoiceAgent',
                    action: 'Live voice consent & acknowledgement recorded',
                    summary: `Live session updated consent=${c.consentGranted}, acknowledged=${c.resultAcknowledged}.`,
                    language,
                    createdAt: ts,
                  });
                  draft.auditLogs.unshift(
                    buildAuditEntry({
                      id: makeId('aud'),
                      caseId,
                      ownerId: c.ownerId,
                      actor: 'PatientVoiceAgent (Live)',
                      actorRole: 'system_agent',
                      event: 'LIVE_VOICE_CONSENT_ACK',
                      details: `Consent=${c.consentGranted}, Ack=${c.resultAcknowledged}`,
                      createdAt: ts,
                    })
                  );
                });
                actionLabel = 'PatientVoiceAgent: Recorded Consent/Ack';
              } else if (call.name === 'schedule_consultation_request') {
                runConsultationAgent({
                  caseId,
                  preferredDate: String(args.preferredDate || '2026-11-23'),
                  preferredSlot: String(args.preferredSlot || '10:30 AM IST'),
                  mode: args.mode === 'telehealth' ? 'telehealth' : 'in_person',
                  languageSupport: language,
                  notes: String(args.notes || 'Requested via Live Voice session.'),
                  actorName: 'ConsultationAgent (Live Coordinator)',
                  actorRole,
                  viaAgent: 'CentralCoordinator',
                });
                actionLabel = 'ConsultationAgent: Scheduled Request';
              } else if (call.name === 'create_specialist_referral') {
                runReferralAgent({
                  caseId,
                  fromClinic: 'Primary Screening Center',
                  toFacility: String(args.toFacility || 'Victoria Specialty Care Wing, Bengaluru'),
                  specialty: String(args.specialty || 'Specialist Care'),
                  actorName: 'ReferralAgent (Live Coordinator)',
                  actorRole,
                  viaSystem: true,
                });
                actionLabel = 'ReferralAgent: Created Referral';
              } else if (call.name === 'request_human_clinician_handoff') {
                triggerHumanHandoff({
                  caseId,
                  reason: String(args.reason || 'Requested during live voice session.'),
                  actorName,
                  actorRole,
                  viaSystem: true,
                });
                actionLabel = 'EscalationAgent: Human Handoff';
              }

              liveSession?.sendToolResponse({
                functionResponses: [
                  {
                    id: call.id,
                    name: call.name,
                    response: resultPayload,
                  },
                ],
              });

              if (actionLabel) {
                clientWs.send(
                  JSON.stringify({
                    type: 'stateUpdated',
                    action: actionLabel,
                    state: getSharedState(),
                  })
                );
              }
            }
          },
          onerror: (err: unknown) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: 'error',
                  message: err instanceof Error ? err.message : 'Live voice session error',
                })
              );
            }
          },
        },
      });

      clientWs.send(JSON.stringify({ type: 'ready', model: 'gemini-3.8-live', language }));

      clientWs.on('message', (raw) => {
        try {
          const payload = JSON.parse(raw.toString()) as {
            audio?: string;
            text?: string;
          };
          if (payload.audio && liveSession) {
            liveSession.sendRealtimeInput({
              audio: { data: payload.audio, mimeType: 'audio/pcm;rate=16000' },
            });
          } else if (payload.text && liveSession) {
            liveSession.sendRealtimeInput({
              text: payload.text,
            });
          }
        } catch (err) {
          console.warn('Invalid WebSocket payload from client:', err);
        }
      });

      clientWs.on('close', () => {
        try {
          liveSession?.close();
        } catch {
          // ignore close errors
        }
      });
    } catch (err) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to connect to Gemini Live API.',
          })
        );
        clientWs.close();
      }
    }
  });
}
