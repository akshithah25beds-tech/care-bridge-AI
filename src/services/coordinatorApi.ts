import {
  ConsultationRequest,
  ConsultationStatus,
  DashboardMetrics,
  LanguageCode,
  PatientCase,
  ReferralRecord,
  ReferralStatus,
  SharedCareState,
  UserRole,
} from '../types/carebridge';
import { ClosureReadinessReport, ScreeningRuleEvaluation } from '../core/coordinatorRules';

export interface FullCareStateResponse extends SharedCareState {
  metrics: DashboardMetrics;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof (data as { error?: string }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchCareState(): Promise<FullCareStateResponse> {
  const res = await fetch('/api/state');
  return parseJsonOrThrow<FullCareStateResponse>(res);
}

export async function fetchHealthStatus(): Promise<{
  status: string;
  geminiConfigured: boolean;
}> {
  const res = await fetch('/api/health');
  return parseJsonOrThrow(res);
}

export async function resetDemoState(ownerId?: string): Promise<FullCareStateResponse> {
  const res = await fetch('/api/state/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId }),
  });
  return parseJsonOrThrow<FullCareStateResponse>(res);
}

export async function submitIntakeAgent(payload: {
  patientName: string;
  age?: number;
  preferredLanguage: LanguageCode;
  screeningType: string;
  screeningValue: string;
  assignedClinician?: string;
  actorName: string;
  actorRole: UserRole;
  ownerId?: string;
}): Promise<{
  newCase: PatientCase;
  rule: ScreeningRuleEvaluation;
  state: FullCareStateResponse;
}> {
  const res = await fetch('/api/coordinator/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function recordConsentApi(payload: {
  caseId: string;
  consentGranted: boolean;
  resultAcknowledged: boolean;
  language: LanguageCode;
  actorName: string;
  actorRole: UserRole;
}): Promise<{ state: FullCareStateResponse }> {
  const res = await fetch('/api/coordinator/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function sendVoiceCoordinatorTurn(payload: {
  caseId: string;
  utterance: string;
  language: LanguageCode;
  grantConsentExplicitly?: boolean;
  actorName: string;
  actorRole: UserRole;
  includeTts?: boolean;
}): Promise<{
  replyText: string;
  executedActions: string[];
  audioBase64?: string;
  state: FullCareStateResponse;
}> {
  const res = await fetch('/api/coordinator/voice-turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function transcribeAudioClip(payload: {
  audioBase64: string;
  mimeType: string;
  language: LanguageCode;
}): Promise<{ transcript: string }> {
  const res = await fetch('/api/voice/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function synthesizeTtsAudio(text: string): Promise<{
  audioBase64?: string;
  mimeType: string;
}> {
  const res = await fetch('/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return parseJsonOrThrow(res);
}

export async function createConsultationRequest(payload: {
  caseId: string;
  preferredDate: string;
  preferredSlot?: string;
  mode: 'in_person' | 'telehealth';
  languageSupport?: 'en' | 'kn' | 'bilingual';
  department?: string;
  notes?: string;
  actorName: string;
  actorRole: UserRole;
}): Promise<{ consultation: ConsultationRequest; state: FullCareStateResponse }> {
  const res = await fetch('/api/coordinator/consultation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function updateConsultationStatusApi(
  consultationId: string,
  payload: { status: ConsultationStatus; actorName: string; actorRole: UserRole }
): Promise<{ state: FullCareStateResponse }> {
  const res = await fetch(`/api/coordinator/consultation/${consultationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function createReferralRecord(payload: {
  caseId: string;
  fromClinic: string;
  toFacility: string;
  specialty: string;
  actorName: string;
  actorRole: UserRole;
}): Promise<{ referral: ReferralRecord; state: FullCareStateResponse }> {
  const res = await fetch('/api/coordinator/referral', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function updateReferralStatusApi(
  referralId: string,
  payload: { status: ReferralStatus; actorName: string; actorRole: UserRole }
): Promise<{ state: FullCareStateResponse }> {
  const res = await fetch(`/api/coordinator/referral/${referralId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function triggerEscalationScanApi(payload: {
  actorName: string;
  actorRole: UserRole;
}): Promise<{ createdCount: number; state: FullCareStateResponse }> {
  const res = await fetch('/api/coordinator/escalation/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function resolveEscalationApi(
  escalationId: string,
  payload: { resolutionNote: string; actorName: string; actorRole: UserRole }
): Promise<{ state: FullCareStateResponse }> {
  const res = await fetch(`/api/coordinator/escalation/${escalationId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function triggerHumanHandoffApi(payload: {
  caseId: string;
  reason: string;
  actorName: string;
  actorRole: UserRole;
}): Promise<{ state: FullCareStateResponse }> {
  const res = await fetch('/api/coordinator/handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}

export async function evaluateOrApproveClosureApi(payload: {
  caseId: string;
  approveClosure: boolean;
  actorName: string;
  actorRole: UserRole;
}): Promise<{
  readiness: ClosureReadinessReport;
  closed: boolean;
  state: FullCareStateResponse;
}> {
  const res = await fetch('/api/coordinator/closure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res);
}
