import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  ClipboardCheck,
  Database,
  FilePlus2,
  GitBranch,
  Mic,
  ShieldCheck,
} from 'lucide-react';
import { FullCareStateResponse } from '../services/coordinatorApi';
import { AgentName, PatientCase } from '../types/carebridge';

interface CareBridgeModelHeroProps {
  state: FullCareStateResponse;
  activeCase: PatientCase | undefined;
  onOpenVoiceModal: (caseId: string) => void;
  onOpenInspectModal: (caseId: string) => void;
  onOpenIntakeModal: () => void;
  onRunEscalationScan: () => Promise<void>;
  onNavigateTab: (tab: 'voice' | 'cases' | 'coordination' | 'escalations' | 'governance') => void;
}

interface AgentNodeConfig {
  id: AgentName;
  num: string;
  shortLabel: string;
  title: string;
  description: string;
  actionLabel: string;
  icon: React.FC<{ className?: string }>;
  x: number; // % in orbital canvas
  y: number; // % in orbital canvas
}

const AGENT_NODES: AgentNodeConfig[] = [
  {
    id: 'ResultIntakeAgent',
    num: '01',
    shortLabel: 'Result Intake',
    title: 'Result Intake Agent',
    description:
      'Evaluates fictional screening entries using clinician-approved protocol rules without diagnosing.',
    actionLabel: 'New Screening Intake',
    icon: FilePlus2,
    x: 21,
    y: 18,
  },
  {
    id: 'PatientVoiceAgent',
    num: '02',
    shortLabel: 'Patient Voice',
    title: 'Patient Voice Agent',
    description:
      'Conducts bilingual Kannada & English voice conversations, records consent, and logs acknowledgements.',
    actionLabel: 'Open Voice Call',
    icon: Mic,
    x: 79,
    y: 18,
  },
  {
    id: 'ConsultationAgent',
    num: '03',
    shortLabel: 'Consultation',
    title: 'Consultation Agent',
    description:
      'Collects patient date, time, and telehealth/in-person preferences to schedule doctor visits.',
    actionLabel: 'Manage Consultations',
    icon: CalendarClock,
    x: 83,
    y: 50,
  },
  {
    id: 'ReferralAgent',
    num: '04',
    shortLabel: 'Referral',
    title: 'Referral Agent',
    description:
      'Tracks inter-facility referrals across primary screening clinics and specialist hospitals.',
    actionLabel: 'Track Referrals',
    icon: GitBranch,
    x: 79,
    y: 82,
  },
  {
    id: 'EscalationAgent',
    num: '05',
    shortLabel: 'Escalation',
    title: 'Escalation Agent',
    description:
      'Detects missed voice outreach, overdue SLAs, and diagnostic boundary triggers for human handoff.',
    actionLabel: 'Run SLA Scan',
    icon: AlertTriangle,
    x: 21,
    y: 82,
  },
  {
    id: 'CaseClosureAgent',
    num: '06',
    shortLabel: 'Case Closure',
    title: 'Case Closure Agent',
    description:
      'Audits required follow-up evidence and enforces human clinician approval before case closure.',
    actionLabel: 'Review Closure Gate',
    icon: ClipboardCheck,
    x: 17,
    y: 50,
  },
];

export const CareBridgeModelHero: React.FC<CareBridgeModelHeroProps> = ({
  state,
  activeCase,
  onOpenVoiceModal,
  onOpenInspectModal,
  onOpenIntakeModal,
  onRunEscalationScan,
  onNavigateTab,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<AgentName>('PatientVoiceAgent');
  const [runningAction, setRunningAction] = useState(false);

  const selectedAgent =
    AGENT_NODES.find((n) => n.id === selectedAgentId) || AGENT_NODES[1];
  const latestAgentRun = state.activities.find((a) => a.agentName === selectedAgent.id);
  const agentRunCount = state.activities.filter((a) => a.agentName === selectedAgent.id).length;

  const handleAgentQuickAction = async () => {
    if (selectedAgent.id === 'ResultIntakeAgent') {
      onOpenIntakeModal();
    } else if (selectedAgent.id === 'PatientVoiceAgent' && activeCase) {
      onOpenVoiceModal(activeCase.id);
    } else if (selectedAgent.id === 'ConsultationAgent' || selectedAgent.id === 'ReferralAgent') {
      onNavigateTab('coordination');
    } else if (selectedAgent.id === 'EscalationAgent') {
      setRunningAction(true);
      try {
        await onRunEscalationScan();
      } finally {
        setRunningAction(false);
      }
    } else if (selectedAgent.id === 'CaseClosureAgent' && activeCase) {
      onOpenInspectModal(activeCase.id);
    }
  };

  return (
    <section
      aria-label="CareBridge Multi-Agent Interactive Model"
      className="relative rounded-2xl bg-[#0B3B36] text-white overflow-hidden border border-[#13554E]"
    >
      {/* Subtle architectural grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-15"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.14) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
        aria-hidden="true"
      />

      <div className="relative p-6 lg:p-7 grid grid-cols-1 xl:grid-cols-12 gap-6 items-center">
        {/* Left Editorial Spotlight */}
        <div className="xl:col-span-5 space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-teal-200 tracking-wide">
              CareBridge AI · Shared Firestore & Gemini Coordinator
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white [text-wrap:balance]">
              Six Connected Agents, One Clinical Record
            </h2>
            <p className="text-sm text-teal-100/90 leading-relaxed max-w-lg">
              Click any agent in the live orchestration model to inspect its latest execution,
              launch Kannada or English voice outreach, or review clinician-approved workflows.
            </p>
          </div>

          {/* Active Patient Spotlight */}
          {activeCase && (
            <div className="p-4 rounded-xl bg-white/10 border border-white/15 space-y-2">
              <div className="flex items-center justify-between text-xs text-teal-200">
                <span className="font-medium">Active Demo Journey</span>
                <span className="font-mono-tabular">
                  {activeCase.patientCode} · {activeCase.preferredLanguage === 'kn' ? 'ಕನ್ನಡ' : 'English'}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-display text-base font-semibold text-white">
                  {activeCase.patientName}
                </p>
                <span className="text-xs text-teal-100">{activeCase.screeningType}</span>
              </div>
              <p className="text-xs text-teal-100/85 line-clamp-2">
                {activeCase.clinicianProtocol}
              </p>
            </div>
          )}

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-3">
            {activeCase && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenVoiceModal(activeCase.id)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#0B3B36] bg-white hover:bg-teal-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Mic className="w-4 h-4" />
                  <span>Start Voice Session</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenInspectModal(activeCase.id)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-white/15 hover:bg-white/20 border border-white/20 rounded-lg transition-colors whitespace-nowrap"
                >
                  <span>Inspect Journey Modal</span>
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>

          {/* Inline Tabular Metrics */}
          <div className="pt-2 border-t border-white/15 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="font-mono-tabular text-lg font-semibold text-white">
                {state.metrics.totalCases}
              </div>
              <div className="text-teal-200/80">Total Cases</div>
            </div>
            <div>
              <div className="font-mono-tabular text-lg font-semibold text-emerald-300">
                {state.metrics.acknowledgedResults}
              </div>
              <div className="text-teal-200/80">Acknowledged</div>
            </div>
            <div>
              <div className="font-mono-tabular text-lg font-semibold text-amber-300">
                {state.metrics.openEscalations}
              </div>
              <div className="text-teal-200/80">Escalations</div>
            </div>
            <div>
              <div className="font-mono-tabular text-lg font-semibold text-teal-200">
                {state.metrics.completedCases}
              </div>
              <div className="text-teal-200/80">Closed</div>
            </div>
          </div>
        </div>

        {/* Right Interactive 6-Agent Orbital Model */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          {/* Mobile Compact Hub & 2-Column Agent Selector */}
          <div className="sm:hidden space-y-3 rounded-xl bg-[#072B27]/80 border border-white/15 p-3.5">
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/15">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-teal-200 shrink-0" />
                <div>
                  <div className="font-display text-xs font-semibold text-white">
                    Central Coordinator
                  </div>
                  <div className="text-[11px] text-teal-200/85">Shared Firestore DB</div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-mono-tabular text-emerald-300">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Human Safe</span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {AGENT_NODES.map((node) => {
                const Icon = node.icon;
                const isSelected = node.id === selectedAgentId;
                const count = state.activities.filter((a) => a.agentName === node.id).length;

                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedAgentId(node.id)}
                    aria-label={`Select ${node.title} (mobile)`}
                    className={`px-2.5 py-2 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? 'bg-white text-slate-900 border-teal-300'
                        : 'bg-[#0E443E]/95 text-white border-white/20 hover:bg-[#13574F]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <Icon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? 'text-teal-700' : 'text-teal-200'
                          }`}
                        />
                        <span className="text-xs font-semibold truncate">{node.shortLabel}</span>
                      </span>
                      <span
                        className={`font-mono-tabular text-[11px] shrink-0 ${
                          isSelected ? 'text-teal-700' : 'text-teal-200/80'
                        }`}
                      >
                        {count}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Desktop & Tablet Interactive 6-Agent Orbital Canvas */}
          <div className="hidden sm:block relative w-full h-[360px] rounded-xl bg-[#072B27]/80 border border-white/15 overflow-hidden">
            {/* Animated SVG Data Flow Conduits */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none"
              aria-hidden="true"
            >
              {AGENT_NODES.map((node) => {
                const isSelected = node.id === selectedAgentId;
                return (
                  <g key={node.id}>
                    <line
                      x1="50"
                      y1="50"
                      x2={node.x}
                      y2={node.y}
                      stroke={isSelected ? '#5EEAD4' : 'rgba(255,255,255,0.18)'}
                      strokeWidth={isSelected ? '0.65' : '0.35'}
                      strokeDasharray={isSelected ? 'none' : '1.5 1.5'}
                    />
                    {isSelected && (
                      <circle r="1.25" fill="#5EEAD4">
                        <animate
                          attributeName="cx"
                          values={`50;${node.x};50`}
                          dur="2.2s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="cy"
                          values={`50;${node.y};50`}
                          dur="2.2s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                  </g>
                );
              })}
              <circle
                cx="50"
                cy="50"
                r="24"
                fill="none"
                stroke="rgba(94,234,212,0.16)"
                strokeWidth="0.3"
              />
            </svg>

            {/* Central Coordinator Core */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-36 rounded-full bg-[#0F524B] border border-teal-300/40 flex flex-col items-center justify-center text-center p-3 shadow-lg z-10"
              aria-label="Central Coordinator and Shared Firestore Database"
            >
              <Database className="w-5 h-5 text-teal-200 mb-1" />
              <span className="font-display text-xs font-semibold text-white leading-tight">
                Central Coordinator
              </span>
              <span className="text-[11px] text-teal-200/90 mt-0.5 leading-tight">
                Shared Firestore DB
              </span>
              <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono-tabular text-emerald-300">
                <ShieldCheck className="w-3 h-3" />
                <span>Human Safe</span>
              </span>
            </div>

            {/* 6 Interactive Agent Nodes */}
            {AGENT_NODES.map((node) => {
              const Icon = node.icon;
              const isSelected = node.id === selectedAgentId;
              const count = state.activities.filter((a) => a.agentName === node.id).length;

              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedAgentId(node.id)}
                  aria-label={`Select ${node.title}`}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 z-20 px-3 py-2 rounded-xl border text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 ${
                    isSelected
                      ? 'bg-white text-slate-900 border-teal-300 shadow-md scale-[1.03]'
                      : 'bg-[#0E443E]/95 text-white border-white/20 hover:bg-[#13574F]'
                  }`}
                >
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isSelected ? 'text-teal-700' : 'text-teal-200'
                      }`}
                    />
                    <span className="text-xs font-semibold">{node.shortLabel}</span>
                    <span
                      className={`font-mono-tabular text-[11px] ${
                        isSelected ? 'text-teal-700' : 'text-teal-200/80'
                      }`}
                    >
                      {count}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Agent Live Inspector Strip */}
          <div className="p-4 rounded-xl bg-white/10 border border-white/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-teal-200 font-mono-tabular">
                <span>Agent {selectedAgent.num}</span>
                <span aria-hidden="true">·</span>
                <span>{agentRunCount} recorded run(s)</span>
              </div>
              <p className="text-sm font-semibold text-white">{selectedAgent.title}</p>
              <p className="text-xs text-teal-100/90 leading-relaxed">
                {latestAgentRun
                  ? `Latest: ${latestAgentRun.action} — ${latestAgentRun.summary}`
                  : selectedAgent.description}
              </p>
            </div>

            <button
              type="button"
              disabled={runningAction}
              onClick={handleAgentQuickAction}
              className="px-3.5 py-2 text-xs font-semibold text-[#0B3B36] bg-teal-200 hover:bg-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {runningAction ? 'Running...' : selectedAgent.actionLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
