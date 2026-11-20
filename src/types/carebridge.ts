export type UserRole = 'clinician' | 'coordinator' | 'patient_kiosk';

export type LanguageCode = 'en' | 'kn';

export type FollowUpCategory =
  | 'routine_review'
  | 'specialist_referral'
  | 'priority_clinician_review';

export type CaseStage =
  | 'intake_created'
  | 'voice_contacted'
  | 'acknowledged'
  | 'consultation_requested'
  | 'referral_active'
  | 'escalated'
  | 'closure_pending_approval'
  | 'closed';

export type AgentName =
  | 'ResultIntakeAgent'
  | 'PatientVoiceAgent'
  | 'ConsultationAgent'
  | 'ReferralAgent'
  | 'EscalationAgent'
  | 'CaseClosureAgent'
  | 'CentralCoordinator';

export type ActorRole = 'clinician' | 'coordinator' | 'patient_kiosk' | 'system_agent';

export type ConsultationStatus = 'requested' | 'confirmed' | 'completed' | 'cancelled';
export type ReferralStatus = 'pending' | 'accepted' | 'scheduled' | 'completed';
export type EscalationStatus = 'open' | 'acknowledged' | 'resolved';

export const BLUEPRINT_LIMITS = {
  ID_REGEX: /^[a-zA-Z0-9_-]+$/,
  NAME_MAX: 120,
  PATIENT_CODE_MAX: 40,
  SUMMARY_MAX: 1000,
  NOTES_MAX: 500,
  REASON_MAX: 300,
} as const;

export interface PatientCase {
  id: string;
  ownerId: string;
  patientCode: string;
  patientName: string;
  age?: number;
  preferredLanguage: LanguageCode;
  screeningType: string;
  screeningValue: string;
  clinicianProtocol: string;
  clinicianApprovedSummary?: string;
  followUpCategory: FollowUpCategory;
  stage: CaseStage;
  consentGranted: boolean;
  consentTimestamp?: string;
  resultAcknowledged: boolean;
  humanHandoffRequired: boolean;
  humanHandoffReason?: string;
  assignedClinician?: string;
  dueAt?: string;
  closedByClinician?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConsultationRequest {
  id: string;
  caseId: string;
  ownerId: string;
  preferredDate: string;
  preferredSlot?: string;
  mode: 'in_person' | 'telehealth';
  languageSupport?: 'en' | 'kn' | 'bilingual';
  department?: string;
  status: ConsultationStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralRecord {
  id: string;
  caseId: string;
  ownerId: string;
  fromClinic: string;
  toFacility: string;
  specialty: string;
  status: ReferralStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EscalationAlert {
  id: string;
  caseId: string;
  ownerId: string;
  reason: string;
  severity: 'warning' | 'critical';
  status: EscalationStatus;
  resolvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentActivity {
  id: string;
  caseId: string;
  ownerId: string;
  agentName: AgentName;
  action: string;
  summary: string;
  language?: 'en' | 'kn' | 'system';
  createdAt: string;
}

export interface AuditLog {
  id: string;
  caseId: string;
  ownerId: string;
  actor: string;
  actorRole: ActorRole;
  event: string;
  details: string;
  createdAt: string;
}

export interface VoiceTranscriptTurn {
  id: string;
  caseId: string;
  speaker: 'patient' | 'agent' | 'coordinator';
  language: LanguageCode;
  text: string;
  agentAction?: string;
  timestamp: string;
}

export interface DashboardMetrics {
  totalCases: number;
  acknowledgedResults: number;
  pendingFollowUps: number;
  consultationRequests: number;
  activeReferrals: number;
  openEscalations: number;
  completedCases: number;
}

export interface SharedCareState {
  cases: PatientCase[];
  consultations: ConsultationRequest[];
  referrals: ReferralRecord[];
  escalations: EscalationAlert[];
  activities: AgentActivity[];
  auditLogs: AuditLog[];
  transcripts: VoiceTranscriptTurn[];
}
