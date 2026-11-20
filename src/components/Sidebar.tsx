import React from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  FileCheck2,
  LayoutDashboard,
  Mic,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { UserRole } from '../types/carebridge';

export type NavTab =
  | 'overview'
  | 'voice'
  | 'cases'
  | 'coordination'
  | 'escalations'
  | 'governance';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  role: UserRole;
  onChangeRole: (role: UserRole) => void;
  openEscalationCount: number;
  pendingCasesCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const CLINICIAN_AVATAR = '/src/assets/images/avatar_clinician_1795191268289.jpg';
const COORDINATOR_AVATAR = '/src/assets/images/avatar_coordinator_1795191268302.jpg';

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  role,
  onChangeRole,
  openEscalationCount,
  pendingCasesCount,
  mobileOpen,
  onCloseMobile,
}) => {
  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.FC<{ className?: string }>;
    count?: number;
  }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'voice', label: 'Voice Studio', icon: Mic },
    { id: 'cases', label: 'Patient Cases', icon: Users, count: pendingCasesCount },
    { id: 'coordination', label: 'Consultations & Referrals', icon: CalendarClock },
    {
      id: 'escalations',
      label: 'Escalations & Handoff',
      icon: AlertTriangle,
      count: openEscalationCount,
    },
    { id: 'governance', label: 'Audit & Governance', icon: ShieldCheck },
  ];

  const roleProfile =
    role === 'clinician'
      ? {
          name: 'Dr. Ananya Rao, MD',
          title: 'Attending Clinician',
          avatar: CLINICIAN_AVATAR,
        }
      : role === 'coordinator'
      ? {
          name: 'Karthik Hegde',
          title: 'Care Coordinator',
          avatar: COORDINATOR_AVATAR,
        }
      : {
          name: 'Clinic Kiosk #04',
          title: 'Patient Voice Mode',
          avatar: '',
        };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-30 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed lg:sticky lg:top-0 lg:h-screen shrink-0 inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col justify-between transition-transform duration-150 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        aria-label="Primary Sidebar"
      >
        <div>
          <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4" />
              </div>
              <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
                CareBridge AI
              </span>
            </div>
          </div>

          <nav className="p-3 space-y-1" aria-label="Workspace Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(item.id);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-teal-50 text-teal-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-teal-700' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span
                      className={`font-mono-tabular text-xs font-semibold ${
                        item.id === 'escalations' ? 'text-red-600' : 'text-slate-500'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mx-3 mt-4 pt-4 border-t border-slate-200 px-2">
            <p className="text-xs font-medium text-slate-500 mb-2">Clinical Safety Policy</p>
            <div className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed">
              <FileCheck2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
              <span>
                Non-diagnostic coordination only. Clinicians approve clinical decisions and case
                closure.
              </span>
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-slate-200 space-y-3">
          <div>
            <label
              htmlFor="rbac-role-select"
              className="block text-xs font-medium text-slate-500 mb-1.5"
            >
              Active Access Role (RBAC)
            </label>
            <select
              id="rbac-role-select"
              value={role}
              onChange={(e) => onChangeRole(e.target.value as UserRole)}
              className="w-full px-2.5 py-2 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
            >
              <option value="clinician">Clinician / Medical Director</option>
              <option value="coordinator">Care Coordinator</option>
              <option value="patient_kiosk">Patient / Voice Kiosk</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-1">
            {roleProfile.avatar ? (
              <img
                src={roleProfile.avatar}
                alt={roleProfile.name}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-semibold shrink-0">
                PK
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">{roleProfile.name}</p>
              <p className="text-xs text-slate-500 truncate">{roleProfile.title}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
