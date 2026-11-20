import React, { useMemo, useState } from 'react';
import { ArrowRight, Search, ShieldAlert } from 'lucide-react';
import { FullCareStateResponse } from '../services/coordinatorApi';
import { CaseStage, PatientCase, UserRole } from '../types/carebridge';
import { CareBridgeModelHero } from './CareBridgeModelHero';
import { KpiStrip } from './KpiStrip';

interface OverviewDashboardProps {
  state: FullCareStateResponse;
  role: UserRole;
  selectedCaseId: string;
  onSelectCase: (caseId: string) => void;
  onOpenVoiceForCase: (caseId: string) => void;
  onOpenInspectModal: (caseId: string) => void;
  onOpenIntakeModal: () => void;
  onRunEscalationScan: () => Promise<void>;
  onNavigateTab: (tab: 'cases' | 'voice' | 'coordination' | 'escalations' | 'governance') => void;
}

const STAGE_LABEL: Record<CaseStage, { label: string; tone: string }> = {
  intake_created: { label: 'Intake Created', tone: 'text-slate-700' },
  voice_contacted: { label: 'Voice Contacted', tone: 'text-teal-700' },
  acknowledged: { label: 'Result Acknowledged', tone: 'text-emerald-700' },
  consultation_requested: { label: 'Consultation Requested', tone: 'text-teal-700' },
  referral_active: { label: 'Referral Active', tone: 'text-teal-700' },
  escalated: { label: 'Escalated · Handoff', tone: 'text-red-600 font-semibold' },
  closure_pending_approval: { label: 'Awaiting Clinician Approval', tone: 'text-amber-700' },
  closed: { label: 'Closed (Clinician Approved)', tone: 'text-emerald-700' },
};

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  state,
  selectedCaseId,
  onSelectCase,
  onOpenVoiceForCase,
  onOpenInspectModal,
  onOpenIntakeModal,
  onRunEscalationScan,
  onNavigateTab,
}) => {
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | 'active' | 'escalated' | 'closed'>('all');

  const filteredCases = useMemo(() => {
    return state.cases.filter((c) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        c.patientName.toLowerCase().includes(q) ||
        c.patientCode.toLowerCase().includes(q) ||
        c.screeningType.toLowerCase().includes(q);
      if (!matchesSearch) return false;
      if (stageFilter === 'active') return c.stage !== 'closed';
      if (stageFilter === 'escalated') return c.stage === 'escalated' || c.humanHandoffRequired;
      if (stageFilter === 'closed') return c.stage === 'closed';
      return true;
    });
  }, [state.cases, search, stageFilter]);

  const activeCase: PatientCase | undefined =
    state.cases.find((c) => c.id === selectedCaseId) || state.cases[0];

  return (
    <div className="space-y-6">
      <CareBridgeModelHero
        state={state}
        activeCase={activeCase}
        onOpenVoiceModal={onOpenVoiceForCase}
        onOpenInspectModal={onOpenInspectModal}
        onOpenIntakeModal={onOpenIntakeModal}
        onRunEscalationScan={onRunEscalationScan}
        onNavigateTab={onNavigateTab}
      />

      <KpiStrip metrics={state.metrics} />

      {/* Main Split: Patient Queue + Live Activity & Selected Journey */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* Left 2 columns: Patient Case Queue */}
        <section
          aria-label="Patient Case Coordination Queue"
          className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Patient Coordination Queue
              </h2>
              <p className="text-xs text-slate-500">
                Select a case to inspect its 6-stage journey or start a Kannada/English voice call.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  aria-label="Search patient cases"
                  placeholder="Search patient or ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 w-44"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(['all', 'active', 'escalated', 'closed'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setStageFilter(tab)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap ${
                      stageFilter === tab
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredCases.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700">No patient cases match your filter.</p>
              <p className="text-xs text-slate-500">
                Clear the search query or create a new screening intake using Agent 1.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-medium text-slate-500">
                    <th className="py-2.5 pl-4 pr-2">Patient & Screening</th>
                    <th className="py-2.5 px-2">Protocol & Stage</th>
                    <th className="py-2.5 px-2">Consent / Ack</th>
                    <th className="py-2.5 pl-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredCases.map((c) => {
                    const stageMeta = STAGE_LABEL[c.stage];
                    const isSelected = c.id === activeCase?.id;
                    return (
                      <tr
                        key={c.id}
                        className={`transition-colors ${
                          isSelected ? 'bg-teal-50/40' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2 align-top">
                          <div className="font-medium text-slate-900 whitespace-nowrap">
                            {c.patientName}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 font-mono-tabular whitespace-nowrap">
                            {c.patientCode} · {c.preferredLanguage === 'kn' ? 'Kannada' : 'English'}
                          </div>
                          <div className="text-xs text-slate-500 truncate max-w-[185px]">
                            {c.screeningType}
                          </div>
                        </td>
                        <td className="py-3 px-2 align-top">
                          <div className={`text-xs font-medium whitespace-nowrap ${stageMeta.tone}`}>
                            {stageMeta.label}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 max-w-[165px] truncate">
                            {c.clinicianProtocol}
                          </div>
                        </td>
                        <td className="py-3 px-2 align-top text-xs whitespace-nowrap">
                          <div className="text-slate-700">
                            Consent:{' '}
                            <span className={c.consentGranted ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                              {c.consentGranted ? 'Granted' : 'Pending'}
                            </span>
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            Result:{' '}
                            <span className={c.resultAcknowledged ? 'text-emerald-700 font-medium' : 'text-slate-600'}>
                              {c.resultAcknowledged ? 'Acknowledged' : 'Pending'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 pl-2 pr-4 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenVoiceForCase(c.id)}
                              className="px-2.5 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md transition-colors whitespace-nowrap"
                            >
                              Voice
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onSelectCase(c.id);
                                onOpenInspectModal(c.id);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
                            >
                              <span>Inspect</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right Column: Agent Activity Monitoring & Active Journey Summary */}
        <div className="space-y-6">
          {activeCase && (
            <section
              aria-label="Sample Patient Journey Snapshot"
              className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">Selected Journey</p>
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    {activeCase.patientName} · {activeCase.patientCode}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('cases')}
                  className="text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
                >
                  Full Timeline
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Screening</span>
                  <span className="font-medium text-slate-800 text-right">
                    {activeCase.screeningType} ({activeCase.screeningValue})
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Clinician</span>
                  <span className="font-medium text-slate-800">
                    {activeCase.assignedClinician || 'Dr. Ananya Rao, MD'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Stage</span>
                  <span className={STAGE_LABEL[activeCase.stage].tone}>
                    {STAGE_LABEL[activeCase.stage].label}
                  </span>
                </div>
              </div>

              {activeCase.humanHandoffRequired && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-xs text-red-700">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{activeCase.humanHandoffReason || 'Clinician handoff active.'}</span>
                </div>
              )}
            </section>
          )}

          <section
            aria-label="Agent Activity Monitoring"
            className="bg-white border border-slate-200 rounded-xl overflow-hidden"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Agent Activity Monitor
              </h2>
              <span className="font-mono-tabular text-xs text-slate-500">
                {state.activities.length} events
              </span>
            </div>

            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {state.activities.slice(0, 10).map((act) => (
                <div key={act.id} className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-teal-800">{act.agentName}</span>
                    <span className="font-mono-tabular text-slate-400">
                      {new Date(act.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-800">{act.action}</p>
                  <p className="text-xs text-slate-500 leading-relaxed">{act.summary}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
