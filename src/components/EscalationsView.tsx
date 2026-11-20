import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { canPerformAction } from '../core/coordinatorRules';
import {
  FullCareStateResponse,
  resolveEscalationApi,
  triggerEscalationScanApi,
} from '../services/coordinatorApi';
import { UserRole } from '../types/carebridge';

interface EscalationsViewProps {
  state: FullCareStateResponse;
  role: UserRole;
  actorName: string;
  onStateUpdated: (newState: FullCareStateResponse) => void;
  onInspectCase: (caseId: string) => void;
}

export const EscalationsView: React.FC<EscalationsViewProps> = ({
  state,
  role,
  actorName,
  onStateUpdated,
  onInspectCase,
}) => {
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canResolve = canPerformAction(role, 'escalation_resolve');

  const handleScan = async () => {
    setError(null);
    setBanner(null);
    setScanning(true);
    try {
      const res = await triggerEscalationScanApi({ actorName, actorRole: role });
      onStateUpdated(res.state);
      setBanner(
        res.createdCount > 0
          ? `Escalation Agent flagged ${res.createdCount} new overdue or unacknowledged case(s).`
          : 'Escalation Scan complete: no new SLA breaches detected.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Escalation scan failed.');
    } finally {
      setScanning(false);
    }
  };

  const handleResolve = async (escalationId: string) => {
    setError(null);
    setBanner(null);
    setBusyId(escalationId);
    try {
      const note =
        noteById[escalationId]?.trim() ||
        'Staff contacted patient directly and logged human clinician follow-up.';
      const res = await resolveEscalationApi(escalationId, {
        resolutionNote: note,
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setBanner('Escalation resolved and recorded in immutable audit log.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve escalation.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Agent 5: Escalation Monitor & Human Handoff Queue
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Automatically detects missed outreach, overdue follow-ups, and clinical boundary
            handoffs.
          </p>
        </div>

        <button
          type="button"
          onClick={handleScan}
          disabled={scanning || role === 'patient_kiosk'}
          className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
        >
          {scanning ? 'Scanning Shared Cases...' : 'Run SLA Escalation Scan'}
        </button>
      </div>

      {banner && (
        <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-800">
          {banner}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        {state.escalations.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600">
            No escalation alerts recorded.
          </div>
        ) : (
          state.escalations.map((esc) => {
            const c = state.cases.find((item) => item.id === esc.caseId);
            const isResolved = esc.status === 'resolved';
            return (
              <div
                key={esc.id}
                className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    {isResolved ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle
                        className={`w-4 h-4 ${
                          esc.severity === 'critical' ? 'text-red-600' : 'text-amber-600'
                        }`}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => onInspectCase(esc.caseId)}
                      className="font-semibold text-slate-900 hover:text-teal-700 hover:underline"
                    >
                      {c?.patientName || esc.caseId} ({c?.patientCode})
                    </button>
                    <span className="text-slate-400">·</span>
                    <span
                      className={`uppercase font-mono-tabular font-semibold ${
                        isResolved
                          ? 'text-emerald-700'
                          : esc.severity === 'critical'
                          ? 'text-red-600'
                          : 'text-amber-700'
                      }`}
                    >
                      {isResolved ? 'resolved' : esc.severity}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700">{esc.reason}</p>
                  <p className="text-xs text-slate-400 font-mono-tabular">
                    Created {new Date(esc.createdAt).toLocaleString()}
                    {esc.resolvedBy ? ` · Resolved by ${esc.resolvedBy}` : ''}
                  </p>
                </div>

                {!isResolved && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                    <input
                      type="text"
                      aria-label={`Resolution note for ${c?.patientName || esc.caseId}`}
                      placeholder="Staff handoff resolution note..."
                      value={noteById[esc.id] || ''}
                      onChange={(e) =>
                        setNoteById((prev) => ({ ...prev, [esc.id]: e.target.value }))
                      }
                      className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg w-64"
                    />
                    <button
                      type="button"
                      disabled={!canResolve || busyId === esc.id}
                      onClick={() => handleResolve(esc.id)}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {canResolve ? 'Resolve Handoff' : 'Staff Role Required'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
