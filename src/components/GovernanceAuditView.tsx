import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import { canPerformAction, GovernanceAction } from '../core/coordinatorRules';
import { FullCareStateResponse, resetDemoState } from '../services/coordinatorApi';
import { UserRole } from '../types/carebridge';

interface GovernanceAuditViewProps {
  state: FullCareStateResponse;
  role: UserRole;
  firebaseUser: User | null;
  firestoreConnected: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onStateUpdated: (newState: FullCareStateResponse) => void;
}

const ACTIONS: Array<{ key: GovernanceAction; label: string }> = [
  { key: 'intake_create', label: 'Agent 1: Create Screening Intake' },
  { key: 'voice_interact', label: 'Agent 2: Bilingual Voice Interaction' },
  { key: 'consultation_coordinate', label: 'Agent 3: Schedule Consultations' },
  { key: 'referral_update', label: 'Agent 4: Track Specialist Referrals' },
  { key: 'escalation_resolve', label: 'Agent 5: Resolve Escalations / Handoff' },
  { key: 'case_closure_approve', label: 'Agent 6: Approve Final Case Closure' },
];

export const GovernanceAuditView: React.FC<GovernanceAuditViewProps> = ({
  state,
  role,
  firebaseUser,
  firestoreConnected,
  onSignIn,
  onSignOut,
  onStateUpdated,
}) => {
  const [filterText, setFilterText] = useState('');
  const [resetting, setResetting] = useState(false);

  const filteredLogs = state.auditLogs.filter((log) => {
    const q = filterText.trim().toLowerCase();
    if (!q) return true;
    return (
      log.event.toLowerCase().includes(q) ||
      log.actor.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q)
    );
  });

  const handleResetDemo = async () => {
    setResetting(true);
    try {
      const fresh = await resetDemoState(firebaseUser?.uid);
      onStateUpdated(fresh);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Firebase & API Security Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-teal-700" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Firebase Persistence & Key Security
              </h2>
            </div>
            <button
              type="button"
              onClick={handleResetDemo}
              disabled={resetting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{resetting ? 'Resetting...' : 'Reset Demo Journey'}</span>
            </button>
          </div>

          <div className="space-y-2.5 text-xs text-slate-700">
            <div className="flex justify-between gap-4 py-1 border-b border-slate-100">
              <span className="text-slate-500">Cloud Firestore Connectivity</span>
              <span className="font-medium text-slate-900">
                {firestoreConnected ? 'Verified Connected' : 'Server Shared Store'}
              </span>
            </div>
            <div className="flex justify-between gap-4 py-1 border-b border-slate-100">
              <span className="text-slate-500">Gemini API Key Handling</span>
              <span className="font-medium text-emerald-700">
                Server-Side Only (Never Exposed to Browser)
              </span>
            </div>
            <div className="flex justify-between gap-4 py-1 border-b border-slate-100">
              <span className="text-slate-500">Firebase Google Auth</span>
              <span className="font-medium text-slate-900">
                {firebaseUser ? firebaseUser.email : 'Not signed in (Demo Sandbox)'}
              </span>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <span className="text-slate-500">Clinical AI Guardrail</span>
              <span className="font-medium text-slate-900">
                Non-diagnostic · Clinician Approval Enforced
              </span>
            </div>
          </div>

          <div className="pt-2">
            {firebaseUser ? (
              <button
                type="button"
                onClick={onSignOut}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
              >
                Sign Out of Google Auth
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
              >
                Sign In with Google to Sync Cloud Firestore
              </button>
            )}
          </div>
        </section>

        {/* RBAC Permission Matrix */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Role-Based Access Control (RBAC) Matrix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Active role: <span className="font-semibold text-teal-700">{role}</span>
            </p>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">Capability</th>
                <th className="py-2 text-center">Clinician</th>
                <th className="py-2 text-center">Coordinator</th>
                <th className="py-2 text-center">Kiosk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ACTIONS.map((a) => (
                <tr key={a.key}>
                  <td className="py-2 text-slate-800 font-medium">{a.label}</td>
                  {(['clinician', 'coordinator', 'patient_kiosk'] as UserRole[]).map((r) => {
                    const allowed = canPerformAction(r, a.key);
                    return (
                      <td
                        key={r}
                        className={`py-2 text-center font-mono-tabular ${
                          allowed ? 'text-emerald-700 font-semibold' : 'text-slate-400'
                        }`}
                      >
                        {allowed ? 'Allowed' : 'Blocked'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Immutable Audit Logs */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Immutable Governance Audit Logs
            </h2>
            <p className="text-xs text-slate-500">
              Append-only compliance ledger recording consent, handoffs, and clinician approvals.
            </p>
          </div>

          <input
            type="search"
            aria-label="Filter audit logs"
            placeholder="Filter by event or actor..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg w-60"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-500">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-3">Event</th>
                <th className="py-2.5 px-3">Actor & Role</th>
                <th className="py-2.5 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/60">
                  <td className="py-3 px-4 font-mono-tabular text-slate-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 font-mono-tabular font-semibold text-slate-800 whitespace-nowrap">
                    {log.event}
                  </td>
                  <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                    {log.actor} · <span className="text-slate-500">{log.actorRole}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-600">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
