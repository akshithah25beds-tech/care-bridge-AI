import React from 'react';
import { DashboardMetrics } from '../types/carebridge';

interface KpiStripProps {
  metrics: DashboardMetrics;
}

export const KpiStrip: React.FC<KpiStripProps> = ({ metrics }) => {
  const items = [
    {
      label: 'Total Patient Cases',
      value: metrics.totalCases,
      note: 'Shared database',
      tone: 'text-slate-900',
    },
    {
      label: 'Acknowledged Results',
      value: metrics.acknowledgedResults,
      note: 'Consent verified',
      tone: 'text-emerald-700',
    },
    {
      label: 'Pending Follow-ups',
      value: metrics.pendingFollowUps,
      note: 'Awaiting outreach',
      tone: 'text-amber-700',
    },
    {
      label: 'Consultation Requests',
      value: metrics.consultationRequests,
      note: 'Active bookings',
      tone: 'text-slate-900',
    },
    {
      label: 'Active Referrals',
      value: metrics.activeReferrals,
      note: 'Specialist tracking',
      tone: 'text-slate-900',
    },
    {
      label: 'Escalation Alerts',
      value: metrics.openEscalations,
      note: metrics.openEscalations > 0 ? 'Staff review needed' : 'No open alerts',
      tone: metrics.openEscalations > 0 ? 'text-red-600' : 'text-slate-900',
    },
    {
      label: 'Completed Cases',
      value: metrics.completedCases,
      note: 'Clinician approved',
      tone: 'text-teal-700',
    },
  ];

  return (
    <section aria-label="Healthcare Coordination Metrics">
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 overflow-hidden">
        {items.map((item) => (
          <div key={item.label} className="p-4 flex flex-col justify-between gap-1.5">
            <span className="text-xs font-medium text-slate-500 leading-snug">{item.label}</span>
            <span className={`font-mono-tabular text-2xl font-semibold ${item.tone}`}>
              {item.value}
            </span>
            <span className="text-xs text-slate-400">{item.note}</span>
          </div>
        ))}
      </div>
    </section>
  );
};
