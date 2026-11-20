import { FunctionDeclaration, Type } from '@google/genai';
import {
  buildAuditEntry,
  canPerformAction,
  detectClinicalBoundaryTrigger,
  evaluateClinicianApprovedRule,
  evaluateClosureReadiness,
  identifyEscalationCandidates,
} from '../src/core/coordinatorRules';
import {
  AgentActivity,
  ConsultationRequest,
  ConsultationStatus,
  LanguageCode,
  PatientCase,
  ReferralRecord,
  ReferralStatus,
  UserRole,
} from '../src/types/carebridge';
import { getGeminiClient } from './geminiClient';
import { getSharedState, makeId, mutateSharedState } from './sharedStore';

export function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  let parsedStatus = 500;
  let parsedMessage = raw;

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (obj.error?.code) parsedStatus = obj.error.code;
      if (obj.error?.message) parsedMessage = obj.error.message;
    }
  } catch {
    // keep raw message
  }

  if (parsedStatus === 403 || raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message: `${parsedMessage} Please check your GEMINI_API_KEY or billing settings in Settings > Secrets.`,
    };
  }
  if (parsedStatus === 429 || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: `${parsedMessage} Please verify your quota or select a billing-enabled API key in Settings > Secrets.`,
    };
  }
  return { status: parsedStatus >= 400 && parsedStatus < 600 ? parsedStatus : 500, message: parsedMessage };
}

export interface IntakePayload {
  patientName: string;
  age?: number;
  preferredLanguage: LanguageCode;
  screeningType: string;
  screeningValue: string;
  assignedClinician?: string;
  actorName: string;
  actorRole: UserRole;
  ownerId?: string;
}

/**
 * AGENT 1: Result Intake Agent
 */
export function runResultIntakeAgent(payload: IntakePayload) {
  if (!canPerformAction(payload.actorRole, 'intake_create')) {
    throw new Error('RBAC_DENIED: Current role cannot create patient screening intakes.');
  }

  const now = new Date().toISOString();
  const rule = evaluateClinicianApprovedRule(payload.screeningType, payload.screeningValue);
  const dueAt = new Date(Date.now() + rule.dueHours * 3600 * 1000).toISOString();
  const caseId = makeId('case');
  const patientCode = `CB-KA-${Math.floor(1050 + Math.random() * 8900)}`;
  const ownerId = payload.ownerId || 'demo_clinic_owner';

  const newCase: PatientCase = {
    id: caseId,
    ownerId,
    patientCode,
    patientName: payload.patientName.trim(),
    age: payload.age,
    preferredLanguage: payload.preferredLanguage,
    screeningType: payload.screeningType.trim(),
    screeningValue: payload.screeningValue.trim(),
    clinicianProtocol: rule.clinicianProtocol,
    clinicianApprovedSummary:
      payload.preferredLanguage === 'kn'
        ? rule.clinicianApprovedSummaryKn
        : rule.clinicianApprovedSummaryEn,
    followUpCategory: rule.followUpCategory,
    stage: 'intake_created',
    consentGranted: false,
    resultAcknowledged: false,
    humanHandoffRequired: false,
    assignedClinician: payload.assignedClinician || 'Dr. Ananya Rao, MD',
    dueAt,
    createdAt: now,
    updatedAt: now,
  };

  const activity: AgentActivity = {
    id: makeId('act'),
    caseId,
    ownerId,
    agentName: 'ResultIntakeAgent',
    action: 'Created patient case from clinician-approved screening rules',
    summary: `Assigned ${rule.clinicianProtocol} (${rule.followUpCategory}) for ${newCase.patientName}.`,
    language: 'system',
    createdAt: now,
  };

  const audit = buildAuditEntry({
    id: makeId('aud'),
    caseId,
    ownerId,
    actor: payload.actorName,
    actorRole: payload.actorRole,
    event: 'RESULT_INTAKE_CREATED',
    details: `Case ${patientCode} initialized via ResultIntakeAgent using protocol ${rule.clinicianProtocol}.`,
    createdAt: now,
  });

  const updated = mutateSharedState((draft) => {
    draft.cases.unshift(newCase);
    draft.activities.unshift(activity);
    draft.auditLogs.unshift(audit);
  });

  return { newCase, rule, state: updated };
}

/**
 * Direct Consent & Acknowledgement recording (works deterministically with Voice Studio & Modals)
 */
export function recordConsentAndAcknowledgement(params: {
  caseId: string;
  consentGranted: boolean;
  resultAcknowledged: boolean;
  language: LanguageCode;
  actorName: string;
  actorRole: UserRole;
}) {
  const now = new Date().toISOString();
  const state = getSharedState();
  const target = state.cases.find((c) => c.id === params.caseId);
  if (!target) throw new Error('Patient case not found.');

  const updated = mutateSharedState((draft) => {
    const c = draft.cases.find((item) => item.id === params.caseId)!;
    if (params.consentGranted && !c.consentGranted) {
      c.consentGranted = true;
      c.consentTimestamp = now;
    } else {
      c.consentGranted = params.consentGranted;
    }
    c.resultAcknowledged = params.resultAcknowledged;
    c.preferredLanguage = params.language;
    if (c.stage === 'intake_created' || c.stage === 'voice_contacted') {
      c.stage = params.resultAcknowledged
        ? 'acknowledged'
        : params.consentGranted
        ? 'voice_contacted'
        : 'intake_created';
    }
    c.updatedAt = now;

    draft.activities.unshift({
      id: makeId('act'),
      caseId: params.caseId,
      ownerId: c.ownerId,
      agentName: 'PatientVoiceAgent',
      action: params.resultAcknowledged
        ? 'Recorded patient consent & result acknowledgement'
        : 'Updated patient outreach consent',
      summary: `Consent=${c.consentGranted}, Acknowledged=${c.resultAcknowledged} (${
        params.language === 'kn' ? 'Kannada' : 'English'
      }).`,
      language: params.language,
      createdAt: now,
    });

    draft.auditLogs.unshift(
      buildAuditEntry({
        id: makeId('aud'),
        caseId: params.caseId,
        ownerId: c.ownerId,
        actor: params.actorName,
        actorRole: params.actorRole,
        event: 'CONSENT_AND_ACKNOWLEDGEMENT_RECORDED',
        details: `Recorded consent=${c.consentGranted} and acknowledgement=${c.resultAcknowledged} for ${c.patientCode}.`,
        createdAt: now,
      })
    );
  });

  return { state: updated };
}

/**
 * AGENT 3: Consultation Agent
 */
export function runConsultationAgent(params: {
  caseId: string;
  preferredDate: string;
  preferredSlot?: string;
  mode: 'in_person' | 'telehealth';
  languageSupport?: 'en' | 'kn' | 'bilingual';
  department?: string;
  notes?: string;
  actorName: string;
  actorRole: UserRole;
  viaAgent?: 'ConsultationAgent' | 'CentralCoordinator';
}) {
  const now = new Date().toISOString();
  const state = getSharedState();
  const targetCase = state.cases.find((c) => c.id === params.caseId);
  if (!targetCase) throw new Error('Case not found.');
  if (targetCase.stage === 'closed') throw new Error('Cannot add consultation to a closed case.');

  const newCons: ConsultationRequest = {
    id: makeId('cons'),
    caseId: params.caseId,
    ownerId: targetCase.ownerId,
    preferredDate: params.preferredDate,
    preferredSlot: params.preferredSlot || '10:00 AM IST',
    mode: params.mode,
    languageSupport: params.languageSupport || targetCase.preferredLanguage,
    department: params.department || 'Outpatient Follow-up Clinic',
    status: 'requested',
    notes: params.notes || 'Coordinated via CareBridge Consultation Agent.',
    createdAt: now,
    updatedAt: now,
  };

  const updated = mutateSharedState((draft) => {
    draft.consultations.unshift(newCons);
    const c = draft.cases.find((item) => item.id === params.caseId);
    if (c && c.stage !== 'escalated' && c.stage !== 'referral_active') {
      c.stage = 'consultation_requested';
      c.updatedAt = now;
    }
    draft.activities.unshift({
      id: makeId('act'),
      caseId: params.caseId,
      ownerId: targetCase.ownerId,
      agentName: 'ConsultationAgent',
      action: 'Created consultation request',
      summary: `Scheduled ${params.mode} preference for ${params.preferredDate} (${newCons.department}).`,
      language: targetCase.preferredLanguage,
      createdAt: now,
    });
    draft.auditLogs.unshift(
      buildAuditEntry({
        id: makeId('aud'),
        caseId: params.caseId,
        ownerId: targetCase.ownerId,
        actor: params.actorName,
        actorRole: params.viaAgent ? 'system_agent' : params.actorRole,
        event: 'CONSULTATION_REQUESTED',
        details: `Consultation ${newCons.id} created for ${params.preferredDate} (${params.mode}).`,
        createdAt: now,
      })
    );
  });

  return { consultation: newCons, state: updated };
}

export function updateConsultationStatus(params: {
  consultationId: string;
  status: ConsultationStatus;
  actorName: string;
  actorRole: UserRole;
}) {
  if (!canPerformAction(params.actorRole, 'consultation_coordinate')) {
    throw new Error('RBAC_DENIED: Current role cannot update consultation status.');
  }
  const now = new Date().toISOString();
  const updated = mutateSharedState((draft) => {
    const item = draft.consultations.find((c) => c.id === params.consultationId);
    if (!item) throw new Error('Consultation not found.');
    item.status = params.status;
    item.updatedAt = now;

    draft.activities.unshift({
      id: makeId('act'),
      caseId: item.caseId,
      ownerId: item.ownerId,
      agentName: 'ConsultationAgent',
      action: `Consultation marked ${params.status}`,
      summary: `Updated consultation ${item.id} (${item.preferredDate}) to ${params.status}.`,
      language: 'system',
      createdAt: now,
    });
    draft.auditLogs.unshift(
      buildAuditEntry({
        id: makeId('aud'),
        caseId: item.caseId,
        ownerId: item.ownerId,
        actor: params.actorName,
        actorRole: params.actorRole,
        event: 'CONSULTATION_STATUS_UPDATED',
        details: `Consultation ${item.id} transitioned to ${params.status}.`,
        createdAt: now,
      })
    );
  });
  return updated;
}

/**
 * AGENT 4: Referral Agent
 */
export function runReferralAgent(params: {
  caseId: string;
  fromClinic: string;
  toFacility: string;
  specialty: string;
  actorName: string;
  actorRole: UserRole;
  viaSystem?: boolean;
}) {
  const now = new Date().toISOString();
  const state = getSharedState();
  const targetCase = state.cases.find((c) => c.id === params.caseId);
  if (!targetCase) throw new Error('Case not found.');

  const newRef: ReferralRecord = {
    id: makeId('ref'),
    caseId: params.caseId,
    ownerId: targetCase.ownerId,
    fromClinic: params.fromClinic,
    toFacility: params.toFacility,
    specialty: params.specialty,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const updated = mutateSharedState((draft) => {
    draft.referrals.unshift(newRef);
    const c = draft.cases.find((item) => item.id === params.caseId);
    if (c && c.stage !== 'escalated' && c.stage !== 'closed') {
      c.stage = 'referral_active';
      c.updatedAt = now;
    }
    draft.activities.unshift({
      id: makeId('act'),
      caseId: params.caseId,
      ownerId: targetCase.ownerId,
      agentName: 'ReferralAgent',
      action: 'Initiated specialist referral',
      summary: `Created referral from ${params.fromClinic} to ${params.toFacility} (${params.specialty}).`,
      language: 'system',
      createdAt: now,
    });
    draft.auditLogs.unshift(
      buildAuditEntry({
        id: makeId('aud'),
        caseId: params.caseId,
        ownerId: targetCase.ownerId,
        actor: params.actorName,
        actorRole: params.viaSystem ? 'system_agent' : params.actorRole,
        event: 'REFERRAL_CREATED',
        details: `Referral ${newRef.id} routed to ${params.toFacility} (${params.specialty}).`,
        createdAt: now,
      })
    );
  });

  return { referral: newRef, state: updated };
}

export function updateReferralStatus(params: {
  referralId: string;
  status: ReferralStatus;
  actorName: string;
  actorRole: UserRole;
}) {
  if (!canPerformAction(params.actorRole, 'referral_update')) {
    throw new Error('RBAC_DENIED: Current role cannot update referrals.');
  }
  const now = new Date().toISOString();
  const updated = mutateSharedState((draft) => {
    const ref = draft.referrals.find((r) => r.id === params.referralId);
    if (!ref) throw new Error('Referral not found.');
    ref.status = params.status;
    ref.updatedAt = now;

    draft.activities.unshift({
      id: makeId('act'),
      caseId: ref.caseId,
      ownerId: ref.ownerId,
      agentName: 'ReferralAgent',
      action: `Referral status updated to ${params.status}`,
      summary: `${ref.toFacility} (${ref.specialty}) referral marked ${params.status}.`,
      language: 'system',
      createdAt: now,
    });
    draft.auditLogs.unshift(
      buildAuditEntry({
        id: makeId('aud'),
        caseId: ref.caseId,
        ownerId: ref.ownerId,
        actor: params.actorName,
        actorRole: params.actorRole,
        event: 'REFERRAL_STATUS_UPDATED',
        details: `Referral ${ref.id} moved to ${params.status}.`,
        createdAt: now,
      })
    );
  });
  return updated;
}

/**
 * AGENT 5: Escalation Agent & Human Handoff
 */
export function runEscalationAgentScan(params: { actorName: string; actorRole: UserRole }) {
  const now = new Date().toISOString();
  const state = getSharedState();
  const candidates = identifyEscalationCandidates(state.cases, state.escalations, now);

  if (candidates.length === 0) {
    return { createdCount: 0, state };
  }

  const updated = mutateSharedState((draft) => {
    for (const cand of candidates) {
      const target = draft.cases.find((c) => c.id === cand.caseId);
      if (!target) continue;

      draft.escalations.unshift({
        id: makeId('esc'),
        caseId: cand.caseId,
        ownerId: target.ownerId,
        reason: cand.reason,
        severity: cand.severity,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });

      target.stage = 'escalated';
      target.humanHandoffRequired = true;
      target.humanHandoffReason = cand.reason;
      target.updatedAt = now;

      draft.activities.unshift({
        id: makeId('act'),
        caseId: cand.caseId,
        ownerId: target.ownerId,
        agentName: 'EscalationAgent',
        action: 'Detected follow-up gap & alerted staff',
        summary: cand.reason,
        language: 'system',
        createdAt: now,
      });
      draft.auditLogs.unshift(
        buildAuditEntry({
          id: makeId('aud'),
          caseId: cand.caseId,
          ownerId: target.ownerId,
          actor: 'EscalationAgent',
          actorRole: 'system_agent',
          event: 'ESCALATION_TRIGGERED',
          details: cand.reason,
          createdAt: now,
        })
      );
    }
  });

  return { createdCount: candidates.length, state: updated };
}

export function triggerHumanHandoff(params: {
  caseId: string;
  reason: string;
  actorName: string;
  actorRole: UserRole;
  viaSystem?: boolean;
}) {
  const now = new Date().toISOString();
  const state = getSharedState();
  const target = state.cases.find((c) => c.id === params.caseId);
  if (!target) throw new Error('Case not found.');

  const updated = mutateSharedState((draft) => {
    const c = draft.cases.find((item) => item.id === params.caseId)!;
    c.humanHandoffRequired = true;
    c.humanHandoffReason = params.reason;
    c.stage = 'escalated';
    c.updatedAt = now;

    const alreadyOpen = draft.escalations.some(
      (e) => e.caseId === params.caseId && e.status !== 'resolved'
    );
    if (!alreadyOpen) {
      draft.escalations.unshift({
        id: makeId('esc'),
        caseId: params.caseId,
        ownerId: c.ownerId,
        reason: params.reason,
        severity: 'critical',
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });
    }

    draft.activities.unshift({
      id: makeId('act'),
      caseId: params.caseId,
      ownerId: c.ownerId,
      agentName: 'EscalationAgent',
      action: 'Human clinician handoff initiated',
      summary: params.reason,
      language: c.preferredLanguage,
      createdAt: now,
    });
    draft.auditLogs.unshift(
      buildAuditEntry({
        id: makeId('aud'),
        caseId: params.caseId,
        ownerId: c.ownerId,
        actor: params.actorName,
        actorRole: params.viaSystem ? 'system_agent' : params.actorRole,
        event: 'HUMAN_HANDOFF_REQUESTED',
        details: params.reason,
        createdAt: now,
      })
    );
  });

  return updated;
}

export function resolveEscalationAlert(params: {
  escalationId: string;
  resolutionNote: string;
  actorName: string;
  actorRole: UserRole;
}) {
  if (!canPerformAction(params.actorRole, 'escalation_resolve')) {
    throw new Error('RBAC_DENIED: Only clinical staff or care coordinators can resolve escalations.');
  }
  const now = new Date().toISOString();
  const updated = mutateSharedState((draft) => {
    const esc = draft.escalations.find((e) => e.id === params.escalationId);
    if (!esc) throw new Error('Escalation alert not found.');
    esc.status = 'resolved';
    esc.resolvedBy = params.actorName;
    esc.updatedAt = now;

    const c = draft.cases.find((item) => item.id === esc.caseId);
    if (c && c.stage === 'escalated') {
      c.humanHandoffRequired = false;
      c.stage = c.resultAcknowledged ? 'consultation_requested' : 'voice_contacted';
      c.updatedAt = now;
    }

    draft.activities.unshift({
      id: makeId('act'),
      caseId: esc.caseId,
      ownerId: esc.ownerId,
      agentName: 'EscalationAgent',
      action: 'Escalation resolved by staff',
      summary: `${params.actorName} resolved alert: ${params.resolutionNote}`,
      language: 'system',
      createdAt: now,
    });
    draft.auditLogs.unshift(
      buildAuditEntry({
        id: makeId('aud'),
        caseId: esc.caseId,
        ownerId: esc.ownerId,
        actor: params.actorName,
        actorRole: params.actorRole,
        event: 'ESCALATION_RESOLVED',
        details: params.resolutionNote,
        createdAt: now,
      })
    );
  });
  return updated;
}

/**
 * AGENT 6: Case Closure Agent (Human Clinician Approval Required)
 */
export function runCaseClosureAgent(params: {
  caseId: string;
  approveClosure: boolean;
  actorName: string;
  actorRole: UserRole;
}) {
  const state = getSharedState();
  const target = state.cases.find((c) => c.id === params.caseId);
  if (!target) throw new Error('Case not found.');

  const readiness = evaluateClosureReadiness(
    target,
    state.consultations,
    state.referrals,
    state.escalations,
    params.actorRole
  );

  if (!params.approveClosure) {
    const now = new Date().toISOString();
    const updated = mutateSharedState((draft) => {
      draft.activities.unshift({
        id: makeId('act'),
        caseId: params.caseId,
        ownerId: target.ownerId,
        agentName: 'CaseClosureAgent',
        action: 'Verified follow-up evidence readiness',
        summary: readiness.canClose
          ? 'All evidence checks passed; awaiting clinician approval.'
          : `Blocked closure: ${readiness.missingRequirements.join(' ')}`,
        language: 'system',
        createdAt: now,
      });
    });
    return { readiness, closed: false, state: updated };
  }

  if (!readiness.canClose) {
    throw new Error(`CLOSURE_BLOCKED: ${readiness.missingRequirements.join(' ')}`);
  }

  const now = new Date().toISOString();
  const updated = mutateSharedState((draft) => {
    const c = draft.cases.find((item) => item.id === params.caseId)!;
    c.stage = 'closed';
    c.closedByClinician = params.actorName;
    c.updatedAt = now;

    draft.activities.unshift({
      id: makeId('act'),
      caseId: params.caseId,
      ownerId: c.ownerId,
      agentName: 'CaseClosureAgent',
      action: 'Case closed with clinician approval',
      summary: `Evidence verified and final closure authorized by ${params.actorName}.`,
      language: 'system',
      createdAt: now,
    });
    draft.auditLogs.unshift(
      buildAuditEntry({
        id: makeId('aud'),
        caseId: params.caseId,
        ownerId: c.ownerId,
        actor: params.actorName,
        actorRole: params.actorRole,
        event: 'CASE_CLOSED_WITH_HUMAN_APPROVAL',
        details: `Case ${c.patientCode} closed after clinician verification.`,
        createdAt: now,
      })
    );
  });

  return { readiness, closed: true, state: updated };
}

/**
 * AGENT 2 + CENTRAL COORDINATOR: Bilingual Voice/Conversation Turn via Gemini AI
 */
const coordinatorTools: FunctionDeclaration[] = [
  {
    name: 'record_patient_consent_and_ack',
    description:
      'Records that the patient granted consent for care coordination and/or acknowledged receiving their clinician-approved screening information.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        consentGranted: {
          type: Type.BOOLEAN,
          description: 'True if patient clearly consented to proceed with voice coordination.',
        },
        resultAcknowledged: {
          type: Type.BOOLEAN,
          description: 'True if patient acknowledged understanding the clinician-approved summary.',
        },
      },
      required: ['consentGranted', 'resultAcknowledged'],
    },
  },
  {
    name: 'schedule_consultation_request',
    description:
      'Invokes the ConsultationAgent via CentralCoordinator to request a doctor appointment with patient preferences.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preferredDate: {
          type: Type.STRING,
          description: 'Preferred date or day (e.g., 2026-11-23 or tomorrow morning).',
        },
        preferredSlot: {
          type: Type.STRING,
          description: 'Preferred time slot (e.g., 10:30 AM IST).',
        },
        mode: {
          type: Type.STRING,
          description: 'Either in_person or telehealth.',
        },
        notes: {
          type: Type.STRING,
          description: 'Patient scheduling preferences.',
        },
      },
      required: ['preferredDate', 'mode'],
    },
  },
  {
    name: 'create_specialist_referral',
    description:
      'Invokes the ReferralAgent via CentralCoordinator to create a specialist hospital referral when follow-up requires one.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        toFacility: {
          type: Type.STRING,
          description: 'Destination clinic or specialty hospital name.',
        },
        specialty: {
          type: Type.STRING,
          description: 'Medical specialty department.',
        },
      },
      required: ['toFacility', 'specialty'],
    },
  },
  {
    name: 'request_human_clinician_handoff',
    description:
      'Invokes the EscalationAgent to alert healthcare staff and hand off to a human clinician whenever the patient asks for medical advice, diagnosis, prescriptions, or requests to speak with a nurse/doctor.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: {
          type: Type.STRING,
          description: 'Clear reason why human clinician handoff is needed.',
        },
      },
      required: ['reason'],
    },
  },
];

export async function runPatientVoiceCoordinatorTurn(params: {
  caseId: string;
  utterance: string;
  language: LanguageCode;
  grantConsentExplicitly?: boolean;
  actorName: string;
  actorRole: UserRole;
  includeTts?: boolean;
}) {
  const initialState = getSharedState();
  const targetCase = initialState.cases.find((c) => c.id === params.caseId);
  if (!targetCase) throw new Error('Patient case not found.');

  const now = new Date().toISOString();

  // Record patient transcript turn & explicit consent if toggled in UI
  mutateSharedState((draft) => {
    const c = draft.cases.find((item) => item.id === params.caseId)!;
    if (params.grantConsentExplicitly && !c.consentGranted) {
      c.consentGranted = true;
      c.consentTimestamp = now;
      c.preferredLanguage = params.language;
      if (c.stage === 'intake_created') c.stage = 'voice_contacted';
      c.updatedAt = now;
      draft.auditLogs.unshift(
        buildAuditEntry({
          id: makeId('aud'),
          caseId: params.caseId,
          ownerId: c.ownerId,
          actor: c.patientName,
          actorRole: 'patient_kiosk',
          event: 'PATIENT_CONSENT_GRANTED',
          details: `Consent explicitly granted in ${params.language === 'kn' ? 'Kannada' : 'English'} voice session.`,
          createdAt: now,
        })
      );
    }

    draft.transcripts.push({
      id: makeId('trn'),
      caseId: params.caseId,
      speaker: 'patient',
      language: params.language,
      text: params.utterance,
      timestamp: now,
    });
  });

  // Safety boundary pre-check
  const safetyCheck = detectClinicalBoundaryTrigger(params.utterance);
  const executedActions: string[] = [];

  if (safetyCheck.triggered) {
    triggerHumanHandoff({
      caseId: params.caseId,
      reason: safetyCheck.reason!,
      actorName: 'PatientVoiceAgent',
      actorRole: params.actorRole,
      viaSystem: true,
    });
    executedActions.push('EscalationAgent: Human Clinician Handoff Triggered');

    const safeReply =
      params.language === 'kn'
        ? `ನಾನು CareBridge AI ಸಮನ್ವಯ ಸಹಾಯಕ. ನಾನು ರೋಗನಿರ್ಣಯ ಮಾಡಲು ಅಥವಾ ಔಷಧಿಗಳನ್ನು ಸೂಚಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ. ನಿಮ್ಮ ಪ್ರಶ್ನೆಗೆ ಉತ್ತರಿಸಲು ನಾನು ಈಗಲೇ ನಿಮ್ಮ ಪ್ರಕರಣವನ್ನು ${targetCase.assignedClinician || 'ನಮ್ಮ ವೈದ್ಯರಿಗೆ'} ಹಸ್ತಾಂತರಿಸಿದ್ದೇನೆ (Human Handoff). ಶೀಘ್ರದಲ್ಲೇ ವೈದ್ಯಕೀಯ ತಂಡವು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತದೆ.`
        : `I am your CareBridge AI care coordinator. I cannot diagnose conditions, prescribe medications, or offer clinical opinions. I have immediately escalated your question for a human handoff to ${targetCase.assignedClinician || 'our clinical team'}, who will contact you directly.`;

    const finalState = mutateSharedState((draft) => {
      draft.transcripts.push({
        id: makeId('trn'),
        caseId: params.caseId,
        speaker: 'agent',
        language: params.language,
        text: safeReply,
        agentAction: executedActions.join(' · '),
        timestamp: new Date().toISOString(),
      });
    });

    const audioBase64 = params.includeTts
      ? await synthesizeSpeechBase64(safeReply).catch(() => undefined)
      : undefined;

    return {
      replyText: safeReply,
      executedActions,
      audioBase64,
      state: finalState,
    };
  }

  // Run Gemini Central Coordinator + Patient Voice Agent
  const ai = getGeminiClient();
  const freshCase = getSharedState().cases.find((c) => c.id === params.caseId)!;
  const recentTranscripts = getSharedState()
    .transcripts.filter((t) => t.caseId === params.caseId)
    .slice(-6)
    .map((t) => `${t.speaker.toUpperCase()}: ${t.text}`)
    .join('\n');

  const systemInstruction = `You are the CareBridge AI Patient Voice Agent operating under the Central Multi-Agent Coordinator.
STRICT CLINICAL SAFETY RULES:
1. NEVER diagnose a medical condition, interpret lab numbers clinically, prescribe medication, or determine clinical urgency independently.
2. ONLY explain the clinician-approved summary below, ask for consent if not yet granted, confirm acknowledgement, answer basic non-clinical coordination questions (timing, clinic location, process), and invoke tools to coordinate consultations, referrals, or human clinician handoff.
3. Respond STRICTLY in ${params.language === 'kn' ? 'Kannada (ಕನ್ನಡ Unicode script, warm polite respectful tone)' : 'clear, empathetic English'}. Keep spoken response concise (2-4 sentences).

PATIENT CASE CONTEXT (Shared Database):
- Patient: ${freshCase.patientName} (${freshCase.patientCode})
- Screening Type: ${freshCase.screeningType}
- Clinician Protocol: ${freshCase.clinicianProtocol}
- Clinician-Approved Summary: ${freshCase.clinicianApprovedSummary}
- Consent Granted: ${freshCase.consentGranted}
- Result Acknowledged: ${freshCase.resultAcknowledged}
- Assigned Clinician: ${freshCase.assignedClinician || 'Dr. Ananya Rao, MD'}
- Current Stage: ${freshCase.stage}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Recent conversation:\n${recentTranscripts}\n\nLatest patient utterance: "${params.utterance}"`,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: coordinatorTools }],
    },
  });

  // Execute any coordinated tool calls against the single shared database
  const calls = response.functionCalls ?? [];
  const toolResults: Array<{ name: string; result: unknown }> = [];

  for (const call of calls) {
    const args = (call.args || {}) as Record<string, unknown>;
    if (call.name === 'record_patient_consent_and_ack') {
      const consent = Boolean(args.consentGranted);
      const ack = Boolean(args.resultAcknowledged);
      const ts = new Date().toISOString();
      mutateSharedState((draft) => {
        const c = draft.cases.find((item) => item.id === params.caseId)!;
        if (consent && !c.consentGranted) {
          c.consentGranted = true;
          c.consentTimestamp = ts;
        }
        if (ack) {
          c.resultAcknowledged = true;
        }
        if (c.stage === 'intake_created' || c.stage === 'voice_contacted') {
          c.stage = ack ? 'acknowledged' : 'voice_contacted';
        }
        c.updatedAt = ts;

        draft.activities.unshift({
          id: makeId('act'),
          caseId: params.caseId,
          ownerId: c.ownerId,
          agentName: 'PatientVoiceAgent',
          action: ack ? 'Recorded consent & result acknowledgement' : 'Recorded voice consent',
          summary: `Voice session updated consent=${c.consentGranted}, acknowledged=${c.resultAcknowledged}.`,
          language: params.language,
          createdAt: ts,
        });
        draft.auditLogs.unshift(
          buildAuditEntry({
            id: makeId('aud'),
            caseId: params.caseId,
            ownerId: c.ownerId,
            actor: 'PatientVoiceAgent',
            actorRole: 'system_agent',
            event: 'VOICE_CONSENT_ACK_UPDATED',
            details: `Consent=${c.consentGranted}, Acknowledged=${c.resultAcknowledged} during ${params.language} call.`,
            createdAt: ts,
          })
        );
      });
      executedActions.push('PatientVoiceAgent: Recorded Consent/Ack');
      toolResults.push({ name: call.name, result: { ok: true, consent, ack } });
    } else if (call.name === 'schedule_consultation_request') {
      const preferredDate = String(args.preferredDate || '2026-11-23');
      const preferredSlot = String(args.preferredSlot || '10:30 AM IST');
      const mode = args.mode === 'telehealth' ? 'telehealth' : 'in_person';
      const notes = String(args.notes || 'Requested during voice outreach.');
      runConsultationAgent({
        caseId: params.caseId,
        preferredDate,
        preferredSlot,
        mode,
        languageSupport: params.language,
        notes,
        actorName: 'ConsultationAgent (via CentralCoordinator)',
        actorRole: params.actorRole,
        viaAgent: 'CentralCoordinator',
      });
      executedActions.push(`ConsultationAgent: Requested ${mode} (${preferredDate})`);
      toolResults.push({
        name: call.name,
        result: { ok: true, preferredDate, preferredSlot, mode },
      });
    } else if (call.name === 'create_specialist_referral') {
      const toFacility = String(args.toFacility || 'Victoria Specialty Care Wing, Bengaluru');
      const specialty = String(args.specialty || 'Specialist Consultation');
      runReferralAgent({
        caseId: params.caseId,
        fromClinic: 'Primary Screening Center',
        toFacility,
        specialty,
        actorName: 'ReferralAgent (via CentralCoordinator)',
        actorRole: params.actorRole,
        viaSystem: true,
      });
      executedActions.push(`ReferralAgent: Referred to ${toFacility}`);
      toolResults.push({ name: call.name, result: { ok: true, toFacility, specialty } });
    } else if (call.name === 'request_human_clinician_handoff') {
      const reason = String(args.reason || 'Patient requested human clinician assistance.');
      triggerHumanHandoff({
        caseId: params.caseId,
        reason,
        actorName: 'PatientVoiceAgent',
        actorRole: params.actorRole,
        viaSystem: true,
      });
      executedActions.push('EscalationAgent: Human Clinician Handoff');
      toolResults.push({ name: call.name, result: { ok: true, reason } });
    }
  }

  let replyText = (response.text ?? '').trim();
  if (!replyText && toolResults.length > 0) {
    // Follow-up generation to turn tool execution into a natural bilingual spoken response
    const followUp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Patient said: "${params.utterance}"\nThe CentralCoordinator executed these updates in the shared database: ${JSON.stringify(
        toolResults
      )}\nNow give a warm, clear 2-3 sentence spoken confirmation strictly in ${
        params.language === 'kn' ? 'Kannada (ಕನ್ನಡ)' : 'English'
      }. Never diagnose or prescribe.`,
      config: { systemInstruction },
    });
    replyText = (followUp.text ?? '').trim();
  }

  if (!replyText) {
    replyText =
      params.language === 'kn'
        ? 'ನಿಮ್ಮ ಮಾಹಿತಿಯನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ. ಮುಂದಿನ ಸಮಾಲೋಚನೆಗೆ ನಮ್ಮ ತಂಡ ಸಹಾಯ ಮಾಡುತ್ತದೆ.'
        : 'Thank you. Your coordination update has been recorded in your care record.';
  }

  const finalState = mutateSharedState((draft) => {
    draft.transcripts.push({
      id: makeId('trn'),
      caseId: params.caseId,
      speaker: 'agent',
      language: params.language,
      text: replyText,
      agentAction:
        executedActions.length > 0
          ? executedActions.join(' · ')
          : 'PatientVoiceAgent: Informational Guidance',
      timestamp: new Date().toISOString(),
    });
    if (executedActions.length === 0) {
      draft.activities.unshift({
        id: makeId('act'),
        caseId: params.caseId,
        ownerId: freshCase.ownerId,
        agentName: 'PatientVoiceAgent',
        action: `Responded in ${params.language === 'kn' ? 'Kannada' : 'English'} voice session`,
        summary: replyText.slice(0, 180),
        language: params.language,
        createdAt: new Date().toISOString(),
      });
    }
  });

  const audioBase64 = params.includeTts
    ? await synthesizeSpeechBase64(replyText).catch(() => undefined)
    : undefined;

  return {
    replyText,
    executedActions,
    audioBase64,
    state: finalState,
  };
}

/**
 * Gemini 3.8 Flash Lite TTS -> returns base64 WAV (24kHz mono 16-bit)
 */
export async function synthesizeSpeechBase64(text: string): Promise<string | undefined> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text,
            speechMetadata: {
              style: 'Warm, calm, respectful healthcare coordinator speaking clearly',
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
}

/**
 * Gemini 3.5 Transcribe -> transcribes audio clips (Kannada or English)
 */
export async function transcribeAudioClip(
  base64Audio: string,
  mimeType: string,
  language: LanguageCode
): Promise<string> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType || 'audio/webm',
            data: base64Audio,
          },
        },
        {
          text:
            language === 'kn'
              ? 'Transcribe this spoken patient audio accurately in Kannada script (or English if spoken in English). Return only the transcript.'
              : 'Transcribe this spoken patient audio accurately in English (or Kannada script if spoken in Kannada). Return only the transcript.',
        },
      ],
    },
  });

  return (response.text ?? '').trim();
}
