import React, { useState } from 'react';
import { canPerformAction } from '../core/coordinatorRules';
import {
  FullCareStateResponse,
  updateConsultationStatusApi,
  updateReferralStatusApi,
} from '../services/coordinatorApi';
import { ConsultationStatus, ReferralStatus, UserRole } from '../types/carebridge';

interface ConsultationsReferralsViewProps {
  state: FullCareStateResponse;
  role: UserRole;
  actorName: string;
  onStateUpdated: (newState: FullCareStateResponse) => void;
  onInspectCase: (caseId: string) => void;
}

export const ConsultationsReferralsView: React.FC<ConsultationsReferralsViewProps> = ({
  state,
  role,
  actorName,
  onStateUpdated,
  onInspectCase,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canCoordinate = canPerformAction(role, 'consultation_coordinate');

  const handleUpdateConsultation = async (id: string, status: ConsultationStatus) => {
    setError(null);
    setBusyId(id);
    try {
      const res = await updateConsultationStatusApi(id, { status, actorName, actorRole: role });
      onStateUpdated(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update consultation.');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateReferral = async (id: string, status: ReferralStatus) => {
    setError(null);
    setBusyId(id);
    try {
      const res = await updateReferralStatusApi(id, { status, actorName, actorRole: role });
      onStateUpdated(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update referral.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Agent 3: Consultation Requests */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Agent 3: Consultation Requests
            </h2>
            <p className="text-xs text-slate-500">
              Patient preferences collected via Voice Agent or Care Coordinator.
            </p>
          </div>
          <span className="font-mono-tabular text-xs text-slate-500">
            {state.consultations.length} total
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Patient</th>
                <th className="py-2.5 px-3">Date & Mode</th>
                <th className="py-2.5 px-3">Department</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-4 text-right">Workflow Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {state.consultations.map((cons) => {
                const c = state.cases.find((item) => item.id === cons.caseId);
                return (
                  <tr key={cons.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => onInspectCase(cons.caseId)}
                        className="font-medium text-teal-700 hover:underline text-left"
                      >
                        {c?.patientName || cons.caseId}
                      </button>
                      <div className="text-xs text-slate-500 font-mono-tabular">
                        {c?.patientCode} · {cons.languageSupport === 'kn' ? 'Kannada' : 'English'}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-xs">
                      <div className="font-mono-tabular font-medium text-slate-900">
                        {cons.preferredDate} · {cons.preferredSlot}
                      </div>
                      <div className="text-slate-500 capitalize">{cons.mode.replace('_', ' ')}</div>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700">
                      {cons.department || 'Outpatient Clinic'}
                    </td>
                    <td className="py-3 px-3 text-xs font-medium capitalize text-slate-800">
                      {cons.status}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                      {cons.status === 'requested' && (
                        <button
                          type="button"
                          disabled={!canCoordinate || busyId === cons.id}
                          onClick={() => handleUpdateConsultation(cons.id, 'confirmed')}
                          className="px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md disabled:opacity-50"
                        >
                          Confirm Slot
                        </button>
                      )}
                      {cons.status !== 'completed' && cons.status !== 'cancelled' && (
                        <button
                          type="button"
                          disabled={!canCoordinate || busyId === cons.id}
                          onClick={() => handleUpdateConsultation(cons.id, 'completed')}
                          className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md disabled:opacity-50"
                        >
                          Mark Completed
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Agent 4: Inter-Facility Referrals */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Agent 4: Inter-Facility Referrals
            </h2>
            <p className="text-xs text-slate-500">
              Tracks clinic-to-specialist hospital handoffs across the network.
            </p>
          </div>
          <span className="font-mono-tabular text-xs text-slate-500">
            {state.referrals.length} total
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Patient</th>
                <th className="py-2.5 px-3">From Clinic → To Facility</th>
                <th className="py-2.5 px-3">Specialty</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-4 text-right">Workflow Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {state.referrals.map((ref) => {
                const c = state.cases.find((item) => item.id === ref.caseId);
                return (
                  <tr key={ref.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => onInspectCase(ref.caseId)}
                        className="font-medium text-teal-700 hover:underline text-left"
                      >
                        {c?.patientName || ref.caseId}
                      </button>
                      <div className="text-xs text-slate-500 font-mono-tabular">{c?.patientCode}</div>
                    </td>
                    <td className="py-3 px-3 text-xs">
                      <div className="font-medium text-slate-900">{ref.toFacility}</div>
                      <div className="text-slate-500">From: {ref.fromClinic}</div>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700">{ref.specialty}</td>
                    <td className="py-3 px-3 text-xs font-medium capitalize text-slate-800">
                      {ref.status}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                      {ref.status === 'pending' && (
                        <button
                          type="button"
                          disabled={!canCoordinate || busyId === ref.id}
                          onClick={() => handleUpdateReferral(ref.id, 'accepted')}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md disabled:opacity-50"
                        >
                          Accept
                        </button>
                      )}
                      {ref.status === 'accepted' && (
                        <button
                          type="button"
                          disabled={!canCoordinate || busyId === ref.id}
                          onClick={() => handleUpdateReferral(ref.id, 'scheduled')}
                          className="px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md disabled:opacity-50"
                        >
                          Schedule
                        </button>
                      )}
                      {ref.status !== 'completed' && (
                        <button
                          type="button"
                          disabled={!canCoordinate || busyId === ref.id}
                          onClick={() => handleUpdateReferral(ref.id, 'completed')}
                          className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md disabled:opacity-50"
                        >
                          Complete Referral
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
