import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Mic, ShieldAlert, UserCheck, X } from 'lucide-react';
import { canPerformAction, evaluateClosureReadiness } from '../core/coordinatorRules';
import {
  createConsultationRequest,
  evaluateOrApproveClosureApi,
  FullCareStateResponse,
  recordConsentApi,
  triggerHumanHandoffApi,
} from '../services/coordinatorApi';
import { UserRole } from '../types/carebridge';

interface QuickCaseModalProps {
  open: boolean;
  caseId: string;
  state: FullCareStateResponse;
  role: UserRole;
  actorName: string;
  onClose: () => void;
  onStateUpdated: (newState: FullCareStateResponse) => void;
  onOpenVoice: (caseId: string) => void;
  onOpenFullTimeline: (caseId: string) => void;
}

export const QuickCaseModal: React.FC<QuickCaseModalProps> = ({
  open,
  caseId,
  state,
  role,
  actorName,
  onClose,
  onStateUpdated,
  onOpenVoice,
  onOpenFullTimeline,
}) => {
  const activeCase = state.cases.find((c) => c.id === caseId);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consDate, setConsDate] = useState('2026-11-24');

  const readiness = useMemo(() => {
    if (!activeCase) return null;
    return evaluateClosureReadiness(
      activeCase,
      state.consultations,
      state.referrals,
      state.escalations,
      role
    );
  }, [activeCase, state.consultations, state.referrals, state.escalations, role]);

  if (!open || !activeCase || !readiness) return null;

  const canCoordinate = canPerformAction(role, 'consultation_coordinate');
  const canClose = canPerformAction(role, 'case_closure_approve');

  const handleConfirmConsentAndAck = async () => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await recordConsentApi({
        caseId: activeCase.id,
        consentGranted: true,
        resultAcknowledged: true,
        language: activeCase.preferredLanguage,
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setFeedback('Verbal consent and result acknowledgement recorded in shared database.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record consent.');
    } finally {
      setBusy(false);
    }
  };

  const handleQuickConsult = async () => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await createConsultationRequest({
        caseId: activeCase.id,
        preferredDate: consDate,
        preferredSlot: '11:00 AM IST',
        mode: 'telehealth',
        languageSupport: activeCase.preferredLanguage,
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setFeedback('Consultation Agent scheduled telehealth request.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Consultation request failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleHandoff = async () => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await triggerHumanHandoffApi({
        caseId: activeCase.id,
        reason: 'Clinician review requested from Case Quick-Inspect Modal.',
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setFeedback('Escalation Agent triggered human clinician handoff.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Handoff failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleApproveClosure = async () => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await evaluateOrApproveClosureApi({
        caseId: activeCase.id,
        approveClosure: true,
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setFeedback('Case closed with human clinician approval.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Closure blocked.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-case-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-mono-tabular text-teal-700 font-semibold">
              {activeCase.patientCode} · {activeCase.preferredLanguage === 'kn' ? 'Kannada (ಕನ್ನಡ)' : 'English'}
            </p>
            <h2
              id="quick-case-modal-title"
              className="font-display text-xl font-semibold text-slate-900 mt-0.5"
            >
              {activeCase.patientName} — Coordination Model
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeCase.screeningType}: {activeCase.screeningValue}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close case inspection modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {feedback && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
            {feedback}
          </div>
        )}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Clinician-Approved Summary */}
        <div className="p-4 bg-slate-50 rounded-xl space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-800">{activeCase.clinicianProtocol}</span>
            <span className="text-slate-500">{activeCase.assignedClinician}</span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">
            {activeCase.clinicianApprovedSummary}
          </p>
        </div>

        {/* 6-Agent Evidence Checklist */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 border border-slate-200 rounded-xl space-y-2">
            <p className="font-semibold text-slate-900">Agent 2: Voice & Consent</p>
            <div className="flex items-center gap-2 text-slate-600">
              {activeCase.consentGranted && activeCase.resultAcknowledged ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>
                Consent: {activeCase.consentGranted ? 'Granted' : 'Pending'} · Result:{' '}
                {activeCase.resultAcknowledged ? 'Acknowledged' : 'Pending'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={busy || (activeCase.consentGranted && activeCase.resultAcknowledged)}
                onClick={handleConfirmConsentAndAck}
                className="px-3 py-1.5 font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-45 rounded-lg transition-colors"
              >
                Confirm Consent & Ack
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenVoice(activeCase.id);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Voice Call</span>
              </button>
            </div>
          </div>

          <div className="p-3.5 border border-slate-200 rounded-xl space-y-2">
            <p className="font-semibold text-slate-900">Agent 3: Consultation Booking</p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="Preferred consultation date"
                value={consDate}
                onChange={(e) => setConsDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg flex-1"
              />
              <button
                type="button"
                disabled={busy || !canCoordinate || activeCase.stage === 'closed'}
                onClick={handleQuickConsult}
                className="px-3 py-1.5 font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
              >
                Book Visit
              </button>
            </div>
          </div>
        </div>

        {/* Agent 5 Handoff & Agent 6 Closure */}
        <div className="border-t border-slate-200 pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || activeCase.stage === 'closed'}
              onClick={handleHandoff}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 disabled:opacity-45 rounded-lg"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Human Handoff</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFullTimeline(activeCase.id);
              }}
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
            >
              Full Timeline & Referrals
            </button>
          </div>

          {activeCase.stage === 'closed' ? (
            <span className="text-xs font-semibold text-emerald-700">
              Closed by {activeCase.closedByClinician}
            </span>
          ) : (
            <button
              type="button"
              disabled={busy || !readiness.canClose || !canClose}
              onClick={handleApproveClosure}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-40 rounded-lg"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>
                {canClose
                  ? readiness.canClose
                    ? 'Approve Case Closure'
                    : 'Evidence Incomplete'
                  : 'Clinician Role Required'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
