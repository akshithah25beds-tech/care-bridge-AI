import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Mic, ShieldAlert, UserCheck } from 'lucide-react';
import { canPerformAction, evaluateClosureReadiness } from '../core/coordinatorRules';
import {
  createConsultationRequest,
  createReferralRecord,
  evaluateOrApproveClosureApi,
  FullCareStateResponse,
  triggerHumanHandoffApi,
} from '../services/coordinatorApi';
import { UserRole } from '../types/carebridge';

interface PatientCaseDetailProps {
  state: FullCareStateResponse;
  selectedCaseId: string;
  onSelectCase: (caseId: string) => void;
  onStateUpdated: (newState: FullCareStateResponse) => void;
  onOpenVoiceForCase: (caseId: string) => void;
  role: UserRole;
  actorName: string;
}

export const PatientCaseDetail: React.FC<PatientCaseDetailProps> = ({
  state,
  selectedCaseId,
  onSelectCase,
  onStateUpdated,
  onOpenVoiceForCase,
  role,
  actorName,
}) => {
  const activeCase = state.cases.find((c) => c.id === selectedCaseId) || state.cases[0];

  const [consDate, setConsDate] = useState('2026-11-24');
  const [consSlot, setConsSlot] = useState('10:30 AM IST');
  const [consMode, setConsMode] = useState<'in_person' | 'telehealth'>('in_person');
  const [refToFacility, setRefToFacility] = useState('Victoria Specialty Care Wing, Bengaluru');
  const [refSpecialty, setRefSpecialty] = useState('Endocrinology');
  const [handoffReason, setHandoffReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const closureReport = useMemo(() => {
    if (!activeCase) return null;
    return evaluateClosureReadiness(
      activeCase,
      state.consultations,
      state.referrals,
      state.escalations,
      role
    );
  }, [activeCase, state.consultations, state.referrals, state.escalations, role]);

  if (!activeCase || !closureReport) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
        No patient cases found in the shared database.
      </div>
    );
  }

  const caseConsultations = state.consultations.filter((c) => c.caseId === activeCase.id);
  const caseReferrals = state.referrals.filter((r) => r.caseId === activeCase.id);
  const caseEscalations = state.escalations.filter((e) => e.caseId === activeCase.id);
  const caseActivities = state.activities.filter((a) => a.caseId === activeCase.id);

  const journeySteps = [
    {
      num: '01',
      title: 'Result Intake',
      done: true,
      detail: activeCase.clinicianProtocol,
    },
    {
      num: '02',
      title: 'Voice Outreach & Consent',
      done: activeCase.consentGranted && activeCase.resultAcknowledged,
      detail: activeCase.consentGranted
        ? activeCase.resultAcknowledged
          ? 'Consent granted & summary acknowledged'
          : 'Consent granted; awaiting result acknowledgement'
        : 'Pending bilingual voice consent',
    },
    {
      num: '03',
      title: 'Consultation Request',
      done: caseConsultations.some((c) => c.status === 'confirmed' || c.status === 'completed'),
      detail:
        caseConsultations.length > 0
          ? `${caseConsultations.length} request(s) · Latest: ${caseConsultations[0].status}`
          : 'Not yet requested',
    },
    {
      num: '04',
      title: 'Specialist Referral',
      done: caseReferrals.some((r) => r.status === 'completed' || r.status === 'scheduled'),
      detail:
        caseReferrals.length > 0
          ? `${caseReferrals[0].toFacility} (${caseReferrals[0].status})`
          : activeCase.followUpCategory === 'routine_review'
          ? 'Not required for routine review'
          : 'Pending referral initiation',
    },
    {
      num: '05',
      title: 'Escalation & Safety Check',
      done: caseEscalations.every((e) => e.status === 'resolved') && !activeCase.humanHandoffRequired,
      detail: activeCase.humanHandoffRequired
        ? `Human handoff required: ${activeCase.humanHandoffReason || 'Staff review'}`
        : 'No unresolved escalations',
    },
    {
      num: '06',
      title: 'Clinician-Approved Closure',
      done: activeCase.stage === 'closed',
      detail:
        activeCase.stage === 'closed'
          ? `Closed by ${activeCase.closedByClinician}`
          : 'Requires verified evidence + human clinician approval',
    },
  ];

  const handleBookConsultation = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    setBusy(true);
    try {
      const res = await createConsultationRequest({
        caseId: activeCase.id,
        preferredDate: consDate,
        preferredSlot: consSlot,
        mode: consMode,
        languageSupport: activeCase.preferredLanguage,
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setActionMessage('Consultation Agent scheduled appointment request.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to request consultation.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    setBusy(true);
    try {
      const res = await createReferralRecord({
        caseId: activeCase.id,
        fromClinic: 'Jayanagar Primary Screening Center',
        toFacility: refToFacility,
        specialty: refSpecialty,
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setActionMessage('Referral Agent created specialist facility referral.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create referral.');
    } finally {
      setBusy(false);
    }
  };

  const handleHandoff = async () => {
    setActionError(null);
    setActionMessage(null);
    setBusy(true);
    try {
      const res = await triggerHumanHandoffApi({
        caseId: activeCase.id,
        reason: handoffReason.trim() || 'Coordinator requested direct clinician review.',
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setHandoffReason('');
      setActionMessage('Human clinician handoff triggered and logged.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to trigger handoff.');
    } finally {
      setBusy(false);
    }
  };

  const handleApproveClosure = async () => {
    setActionError(null);
    setActionMessage(null);
    setBusy(true);
    try {
      const res = await evaluateOrApproveClosureApi({
        caseId: activeCase.id,
        approveClosure: true,
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setActionMessage('Case Closure Agent verified all evidence and closed case.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Closure blocked.');
    } finally {
      setBusy(false);
    }
  };

  const canCoordinate = canPerformAction(role, 'consultation_coordinate');
  const canClose = canPerformAction(role, 'case_closure_approve');

  return (
    <div className="space-y-6">
      {/* Case Selector Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="detail-case-select" className="text-xs font-semibold text-slate-600">
            Patient Case:
          </label>
          <select
            id="detail-case-select"
            value={activeCase.id}
            onChange={(e) => onSelectCase(e.target.value)}
            className="px-3 py-1.5 text-sm font-medium bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
          >
            {state.cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.patientCode} — {c.patientName} ({c.stage})
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            {activeCase.preferredLanguage === 'kn' ? 'Kannada (ಕನ್ನಡ)' : 'English'} ·{' '}
            {activeCase.screeningType}: {activeCase.screeningValue}
          </span>
        </div>

        <button
          type="button"
          onClick={() => onOpenVoiceForCase(activeCase.id)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap self-start md:self-auto"
        >
          <Mic className="w-3.5 h-3.5" />
          <span>Open Voice Session</span>
        </button>
      </div>

      {actionError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
          {actionMessage}
        </div>
      )}

      {/* 6-Stage Patient Journey Timeline */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Patient Journey Timeline (Six-Agent Coordination)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeCase.clinicianApprovedSummary || activeCase.clinicianProtocol}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          {journeySteps.map((step) => (
            <div
              key={step.num}
              className={`p-3.5 rounded-lg border space-y-1.5 ${
                step.done
                  ? 'bg-emerald-50/40 border-emerald-200'
                  : 'bg-slate-50/70 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono-tabular font-semibold text-slate-500">{step.num}</span>
                {step.done ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Clock className="w-4 h-4 text-slate-400" />
                )}
              </div>
              <p className="text-xs font-semibold text-slate-900">{step.title}</p>
              <p className="text-xs text-slate-600 leading-relaxed">{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Coordinator Action Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Agent 3 & Agent 4 Forms */}
        <div className="space-y-4">
          <form
            onSubmit={handleBookConsultation}
            className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
          >
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Agent 3: Consultation Request
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="cons-date" className="block text-xs text-slate-600 mb-1">
                  Preferred Date
                </label>
                <input
                  id="cons-date"
                  type="date"
                  value={consDate}
                  onChange={(e) => setConsDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="cons-slot" className="block text-xs text-slate-600 mb-1">
                  Time Slot
                </label>
                <input
                  id="cons-slot"
                  type="text"
                  value={consSlot}
                  onChange={(e) => setConsSlot(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label htmlFor="cons-mode" className="block text-xs text-slate-600 mb-1">
                Visit Mode
              </label>
              <select
                id="cons-mode"
                value={consMode}
                onChange={(e) => setConsMode(e.target.value as 'in_person' | 'telehealth')}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
              >
                <option value="in_person">In-Person Clinic</option>
                <option value="telehealth">Telehealth Video/Audio</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={busy || !canCoordinate || activeCase.stage === 'closed'}
              className="w-full py-2 px-3 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors"
            >
              Coordinate Consultation
            </button>
          </form>

          <form
            onSubmit={handleCreateReferral}
            className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
          >
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Agent 4: Specialist Referral
            </h3>
            <div>
              <label htmlFor="ref-facility" className="block text-xs text-slate-600 mb-1">
                Destination Facility
              </label>
              <input
                id="ref-facility"
                type="text"
                value={refToFacility}
                onChange={(e) => setRefToFacility(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="ref-specialty" className="block text-xs text-slate-600 mb-1">
                Specialty
              </label>
              <input
                id="ref-specialty"
                type="text"
                value={refSpecialty}
                onChange={(e) => setRefSpecialty(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !canCoordinate || activeCase.stage === 'closed'}
              className="w-full py-2 px-3 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors"
            >
              Create Specialist Referral
            </button>
          </form>
        </div>

        {/* Agent 5 Human Handoff & Agent 6 Clinician Closure */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Agent 5: Human Clinician Handoff
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Escalate to {activeCase.assignedClinician || 'assigned physician'} whenever clinical
              clarification or staff intervention is needed.
            </p>
            <input
              type="text"
              aria-label="Human handoff reason"
              placeholder="Reason for clinician handoff..."
              value={handoffReason}
              onChange={(e) => setHandoffReason(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
            />
            <button
              type="button"
              onClick={handleHandoff}
              disabled={busy || activeCase.stage === 'closed'}
              className="w-full py-2 px-3 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 disabled:opacity-50 rounded-lg transition-colors"
            >
              Trigger Human Clinician Handoff
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-teal-700" />
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Agent 6: Case Closure Evidence Gate
              </h3>
            </div>

            <ul className="space-y-1.5 text-xs">
              <li className="flex items-center justify-between">
                <span className="text-slate-600">Patient Consent Recorded</span>
                <span className={closureReport.checks.consentGranted ? 'text-emerald-700 font-medium' : 'text-red-600'}>
                  {closureReport.checks.consentGranted ? 'Pass' : 'Missing'}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600">Result Acknowledged</span>
                <span className={closureReport.checks.resultAcknowledged ? 'text-emerald-700 font-medium' : 'text-red-600'}>
                  {closureReport.checks.resultAcknowledged ? 'Pass' : 'Missing'}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600">Follow-up / Referral Completed</span>
                <span className={closureReport.checks.followUpCompleted ? 'text-emerald-700 font-medium' : 'text-red-600'}>
                  {closureReport.checks.followUpCompleted ? 'Pass' : 'Pending'}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600">Open Escalations Cleared</span>
                <span className={closureReport.checks.noOpenEscalations ? 'text-emerald-700 font-medium' : 'text-red-600'}>
                  {closureReport.checks.noOpenEscalations ? 'Pass' : 'Blocked'}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600">Human Clinician Role (RBAC)</span>
                <span className={closureReport.checks.clinicianRoleVerified ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                  {closureReport.checks.clinicianRoleVerified ? 'Authorized' : 'Clinician Required'}
                </span>
              </li>
            </ul>

            {activeCase.stage === 'closed' ? (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
                Case closed and authorized by {activeCase.closedByClinician}.
              </div>
            ) : (
              <button
                type="button"
                onClick={handleApproveClosure}
                disabled={busy || !closureReport.canClose || !canClose}
                className="w-full py-2 px-3 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-40 rounded-lg transition-colors"
              >
                {canClose
                  ? closureReport.canClose
                    ? 'Approve & Close Case (Clinician)'
                    : 'Evidence Incomplete — Closure Blocked'
                  : 'Switch Role to Clinician to Approve Closure'}
              </button>
            )}
          </div>
        </div>

        {/* Case Agent Trace */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Case Activity History
            </h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {caseActivities.map((act) => (
              <div key={act.id} className="p-3.5 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-teal-800">{act.agentName}</span>
                  <span className="font-mono-tabular text-slate-400">
                    {new Date(act.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs font-medium text-slate-800">{act.action}</p>
                <p className="text-xs text-slate-500">{act.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
