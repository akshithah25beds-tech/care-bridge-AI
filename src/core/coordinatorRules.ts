import {
  AuditLog,
  ConsultationRequest,
  DashboardMetrics,
  EscalationAlert,
  FollowUpCategory,
  LanguageCode,
  PatientCase,
  ReferralRecord,
  SharedCareState,
  UserRole,
} from '../types/carebridge';

export interface ScreeningRuleEvaluation {
  clinicianProtocol: string;
  followUpCategory: FollowUpCategory;
  recommendedDepartment: string;
  clinicianApprovedSummaryEn: string;
  clinicianApprovedSummaryKn: string;
  requiresSpecialistReferral: boolean;
  dueHours: number;
}

/**
 * Agent 1 (Result Intake Agent): Deterministic, clinician-approved protocol rules.
 * IMPORTANT: Never diagnoses or prescribes treatment. Only maps clinician-flagged
 * screening categories to pre-approved coordination protocols.
 */
export function evaluateClinicianApprovedRule(
  screeningType: string,
  screeningValue: string
): ScreeningRuleEvaluation {
  const typeLower = screeningType.toLowerCase();
  const numericMatch = screeningValue.match(/(\d+(?:\.\d+)?)/);
  const firstNumber = numericMatch ? parseFloat(numericMatch[1]) : NaN;

  if (typeLower.includes('hba1c') || typeLower.includes('glucose') || typeLower.includes('diabetes')) {
    const isElevated = (!Number.isNaN(firstNumber) && firstNumber >= 6.5) || screeningValue.toLowerCase().includes('flag') || screeningValue.toLowerCase().includes('high');
    if (isElevated) {
      return {
        clinicianProtocol: 'Protocol CB-MET-02: Metabolic Follow-up & Endocrinology Review',
        followUpCategory: 'specialist_referral',
        recommendedDepartment: 'Endocrinology & Metabolic Clinic',
        clinicianApprovedSummaryEn:
          'Your clinician has shared a screening summary requesting a follow-up metabolic consultation. This is not a diagnosis; a specialist doctor will review your report and discuss next steps with you.',
        clinicianApprovedSummaryKn:
          'ನಿಮ್ಮ ವೈದ್ಯರು ತಪಾಸಣಾ ವರದಿಯನ್ನು ಪರಿಶೀಲಿಸಲು ಮುಂದಿನ ಸಮಾಲೋಚನೆಯನ್ನು ಶಿಫಾರಸು ಮಾಡಿದ್ದಾರೆ. ಇದು ರೋಗನಿರ್ಣಯವಲ್ಲ; ತಜ್ಞ ವೈದ್ಯರು ನಿಮ್ಮ ವರದಿಯನ್ನು ನೋಡಿ ಮುಂದಿನ ಕ್ರಮಗಳ ಬಗ್ಗೆ ತಿಳಿಸುತ್ತಾರೆ.',
        requiresSpecialistReferral: true,
        dueHours: 48,
      };
    }
    return {
      clinicianProtocol: 'Protocol CB-MET-01: Routine Preventive Screening Review',
      followUpCategory: 'routine_review',
      recommendedDepartment: 'Primary Care Clinic',
      clinicianApprovedSummaryEn:
        'Your clinician noted your screening record is ready for a routine check-in conversation. Please confirm receipt and schedule a standard review if you have questions.',
      clinicianApprovedSummaryKn:
        'ನಿಮ್ಮ ತಪಾಸಣಾ ವರದಿಯು ಸಾಮಾನ್ಯ ಪರಿಶೀಲನೆಗೆ ಸಿದ್ಧವಾಗಿದೆ ಎಂದು ವೈದ್ಯರು ತಿಳಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ವರದಿ ತಲುಪಿದ ಬಗ್ಗೆ ದೃಢೀಕರಿಸಿ.',
      requiresSpecialistReferral: false,
      dueHours: 72,
    };
  }

  if (typeLower.includes('blood pressure') || typeLower.includes('bp') || typeLower.includes('hypertension')) {
    const isPriority = (!Number.isNaN(firstNumber) && firstNumber >= 140) || screeningValue.toLowerCase().includes('priority') || screeningValue.toLowerCase().includes('high');
    return {
      clinicianProtocol: isPriority
        ? 'Protocol CB-CV-03: Clinician-Flagged Blood Pressure Follow-up'
        : 'Protocol CB-CV-01: Routine Cardiovascular Screening Review',
      followUpCategory: isPriority ? 'priority_clinician_review' : 'routine_review',
      recommendedDepartment: 'Cardiovascular & Internal Medicine',
      clinicianApprovedSummaryEn: isPriority
        ? 'Your clinician has flagged your blood pressure screening entry for a timely follow-up visit with a care team physician. Only your doctor will advise on clinical care.'
        : 'Your clinician has shared your blood pressure screening note for routine confirmation.',
      clinicianApprovedSummaryKn: isPriority
        ? 'ನಿಮ್ಮ ರಕ್ತದೊತ್ತಡ ತಪಾಸಣಾ ವರದಿಯ ಕುರಿತು ವೈದ್ಯರೊಂದಿಗೆ ಶೀಘ್ರ ಭೇಟಿ ನಿಗದಿಪಡಿಸಲು ವೈದ್ಯರು ಸೂಚಿಸಿದ್ದಾರೆ. ವೈದ್ಯರು ಮಾತ್ರ ಚಿಕಿತ್ಸಾ ಸಲಹೆ ನೀಡುತ್ತಾರೆ.'
        : 'ನಿಮ್ಮ ರಕ್ತದೊತ್ತಡ ತಪಾಸಣಾ ವರದಿಯು ಸಾಮಾನ್ಯ ಪರಿಶೀಲನೆಗೆ ಸಿದ್ಧವಾಗಿದೆ.',
      requiresSpecialistReferral: isPriority,
      dueHours: isPriority ? 24 : 72,
    };
  }

  if (typeLower.includes('mammography') || typeLower.includes('imaging') || typeLower.includes('radiology') || typeLower.includes('pap')) {
    return {
      clinicianProtocol: 'Protocol CB-IMG-04: Diagnostic Imaging Specialist Follow-up',
      followUpCategory: 'specialist_referral',
      recommendedDepartment: 'Diagnostic Imaging & Oncology Coordination',
      clinicianApprovedSummaryEn:
        'Your clinician has requested a follow-up imaging review appointment so a specialist can walk you through the findings in detail.',
      clinicianApprovedSummaryKn:
        'ನಿಮ್ಮ ತಪಾಸಣಾ ಚಿತ್ರಗಳ ಕುರಿತು ತಜ್ಞ ವೈದ್ಯರೊಂದಿಗೆ ಮುಂದಿನ ಸಮಾಲೋಚನೆ ನಡೆಸಲು ವೈದ್ಯರು ಸೂಚಿಸಿದ್ದಾರೆ.',
      requiresSpecialistReferral: true,
      dueHours: 36,
    };
  }

  return {
    clinicianProtocol: 'Protocol CB-GEN-01: Standard Clinician-Approved Follow-up',
    followUpCategory: 'routine_review',
    recommendedDepartment: 'General Outpatient Medicine',
    clinicianApprovedSummaryEn:
      'Your clinician has posted a screening follow-up notice for your confirmation and appointment coordination.',
    clinicianApprovedSummaryKn:
      'ನಿಮ್ಮ ತಪಾಸಣಾ ವರದಿಯ ಮುಂದಿನ ಸಮಾಲೋಚನೆಗಾಗಿ ದೃಢೀಕರಣ ಮತ್ತು ಭೇಟಿ ಸಮಯ ನಿಗದಿಪಡಿಸಲು ವಿನಂತಿಸಲಾಗಿದೆ.',
    requiresSpecialistReferral: false,
    dueHours: 48,
  };
}

/**
 * Safety Guardrail: Detects clinical diagnosis/prescription requests in patient utterances
 * so the Patient Voice Agent strictly avoids diagnosing or prescribing and routes to human clinician handoff.
 */
export function detectClinicalBoundaryTrigger(utterance: string): {
  triggered: boolean;
  reason?: string;
} {
  const lower = utterance.toLowerCase();
  const patterns = [
    /\bdiagnos(e|is)\b/,
    /\bdo i have\b/,
    /\bwhat disease\b/,
    /\bprescrib(e|ption)\b/,
    /\bwhich medicine\b/,
    /\bwhat tablet\b/,
    /\bdosage\b/,
    /\bmg\b/,
    /\bcancer\b/,
    /\bchest pain\b/,
    /\bemergency\b/,
    /ರೋಗ ಇದೆಯಾ/,
    /ಔಷಧಿ/,
    /ಮಾತ್ರೆ/,
    /ಎದೆ ನೋವು/,
  ];

  for (const regex of patterns) {
    if (regex.test(lower)) {
      return {
        triggered: true,
        reason:
          'Patient asked a clinical diagnostic, medication, or symptom question requiring human clinician evaluation.',
      };
    }
  }
  return { triggered: false };
}

/**
 * Agent 5 (Escalation Agent): Deterministic SLA and gap detector across shared database.
 */
export function identifyEscalationCandidates(
  cases: PatientCase[],
  existingEscalations: EscalationAlert[],
  nowIso: string
): Array<{ caseId: string; reason: string; severity: 'warning' | 'critical' }> {
  const nowMs = Date.parse(nowIso);
  const candidates: Array<{ caseId: string; reason: string; severity: 'warning' | 'critical' }> = [];

  for (const c of cases) {
    if (c.stage === 'closed') continue;

    const alreadyOpen = existingEscalations.some(
      (e) => e.caseId === c.id && e.status !== 'resolved'
    );
    if (alreadyOpen) continue;

    const dueMs = c.dueAt ? Date.parse(c.dueAt) : NaN;
    const isOverdue = !Number.isNaN(dueMs) && nowMs > dueMs;
    const createdMs = Date.parse(c.createdAt);
    const hoursOpen = Number.isNaN(createdMs) ? 0 : (nowMs - createdMs) / 36e5;

    if (isOverdue && !c.resultAcknowledged) {
      candidates.push({
        caseId: c.id,
        reason: `Overdue follow-up SLA exceeded without patient acknowledgement (${c.clinicianProtocol}).`,
        severity: 'critical',
      });
    } else if (c.humanHandoffRequired && c.stage !== 'escalated') {
      candidates.push({
        caseId: c.id,
        reason: c.humanHandoffReason || 'Patient requested or triggered clinician handoff.',
        severity: 'critical',
      });
    } else if (!c.consentGranted && hoursOpen >= 24) {
      candidates.push({
        caseId: c.id,
        reason: 'Missed voice outreach / consent unconfirmed for over 24 hours.',
        severity: 'warning',
      });
    }
  }

  return candidates;
}

export interface ClosureReadinessReport {
  canClose: boolean;
  missingRequirements: string[];
  checks: {
    consentGranted: boolean;
    resultAcknowledged: boolean;
    followUpCompleted: boolean;
    noOpenEscalations: boolean;
    clinicianRoleVerified: boolean;
  };
}

/**
 * Agent 6 (Case Closure Agent): Validates all required follow-up evidence and enforces
 * human clinician approval before case closure.
 */
export function evaluateClosureReadiness(
  patientCase: PatientCase,
  consultations: ConsultationRequest[],
  referrals: ReferralRecord[],
  escalations: EscalationAlert[],
  actorRole: UserRole
): ClosureReadinessReport {
  const caseConsultations = consultations.filter((item) => item.caseId === patientCase.id);
  const caseReferrals = referrals.filter((item) => item.caseId === patientCase.id);
  const openEscalations = escalations.filter(
    (item) => item.caseId === patientCase.id && item.status !== 'resolved'
  );

  const hasCompletedConsultation = caseConsultations.some((c) => c.status === 'completed');
  const hasCompletedReferral = caseReferrals.some((r) => r.status === 'completed');
  const followUpCompleted =
    patientCase.followUpCategory === 'routine_review'
      ? hasCompletedConsultation || caseConsultations.some((c) => c.status === 'confirmed')
      : hasCompletedConsultation || hasCompletedReferral;

  const checks = {
    consentGranted: patientCase.consentGranted === true,
    resultAcknowledged: patientCase.resultAcknowledged === true,
    followUpCompleted,
    noOpenEscalations: openEscalations.length === 0,
    clinicianRoleVerified: actorRole === 'clinician',
  };

  const missingRequirements: string[] = [];
  if (!checks.consentGranted) missingRequirements.push('Patient voice/outreach consent not recorded.');
  if (!checks.resultAcknowledged) missingRequirements.push('Patient result acknowledgement not recorded.');
  if (!checks.followUpCompleted) {
    missingRequirements.push('Required consultation or specialist referral is not yet completed.');
  }
  if (!checks.noOpenEscalations) {
    missingRequirements.push(`${openEscalations.length} open escalation alert(s) must be resolved.`);
  }
  if (!checks.clinicianRoleVerified) {
    missingRequirements.push('Human clinician role required to approve final case closure.');
  }

  return {
    canClose: missingRequirements.length === 0,
    missingRequirements,
    checks,
  };
}

export type GovernanceAction =
  | 'intake_create'
  | 'voice_interact'
  | 'consultation_coordinate'
  | 'referral_update'
  | 'escalation_resolve'
  | 'case_closure_approve'
  | 'view_audit_logs';

export function canPerformAction(role: UserRole, action: GovernanceAction): boolean {
  switch (role) {
    case 'clinician':
      return true;
    case 'coordinator':
      return action !== 'case_closure_approve';
    case 'patient_kiosk':
      return action === 'voice_interact';
    default:
      return false;
  }
}

export function computeDashboardMetrics(state: SharedCareState): DashboardMetrics {
  const totalCases = state.cases.length;
  const acknowledgedResults = state.cases.filter((c) => c.resultAcknowledged).length;
  const completedCases = state.cases.filter((c) => c.stage === 'closed').length;
  const pendingFollowUps = state.cases.filter(
    (c) => c.stage !== 'closed' && (!c.resultAcknowledged || c.stage === 'intake_created' || c.stage === 'voice_contacted')
  ).length;
  const consultationRequests = state.consultations.filter(
    (c) => c.status === 'requested' || c.status === 'confirmed'
  ).length;
  const activeReferrals = state.referrals.filter((r) => r.status !== 'completed').length;
  const openEscalations = state.escalations.filter((e) => e.status !== 'resolved').length;

  return {
    totalCases,
    acknowledgedResults,
    pendingFollowUps,
    consultationRequests,
    activeReferrals,
    openEscalations,
    completedCases,
  };
}

export function getBilingualGreeting(patientName: string, language: LanguageCode): string {
  if (language === 'kn') {
    return `ನಮಸ್ಕಾರ ${patientName} ಅವರೇ. ನಾನು CareBridge AI ಆರೋಗ್ಯ ಸಮನ್ವಯ ಸಹಾಯಕ. ನಿಮ್ಮ ವೈದ್ಯರು ಅನುಮೋದಿಸಿರುವ ತಪಾಸಣಾ ವರದಿಯ ಮಾಹಿತಿಯನ್ನು ಹಂಚಿಕೊಳ್ಳಲು ಸಂಪರ್ಕಿಸಿದ್ದೇನೆ. ಮುಂದುವರಿಯಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯನ್ನು ತಿಳಿಸಿ.`;
  }
  return `Hello ${patientName}. I am your CareBridge AI care coordination assistant calling with clinician-approved follow-up information regarding your recent screening. Before we proceed, please confirm your consent to continue this coordination session.`;
}

export function buildAuditEntry(params: {
  id: string;
  caseId: string;
  ownerId: string;
  actor: string;
  actorRole: AuditLog['actorRole'];
  event: string;
  details: string;
  createdAt: string;
}): AuditLog {
  return {
    id: params.id,
    caseId: params.caseId,
    ownerId: params.ownerId,
    actor: params.actor.slice(0, 120),
    actorRole: params.actorRole,
    event: params.event.slice(0, 160),
    details: params.details.slice(0, 500),
    createdAt: params.createdAt,
  };
}
