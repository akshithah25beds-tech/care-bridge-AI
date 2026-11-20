import React from 'react';
import { User } from 'firebase/auth';
import { Menu, Plus } from 'lucide-react';
import { canPerformAction } from '../core/coordinatorRules';
import { UserRole } from '../types/carebridge';
import { NavTab } from './Sidebar';

interface TopBarProps {
  activeTab: NavTab;
  role: UserRole;
  firebaseUser: User | null;
  firestoreConnected: boolean;
  onOpenIntake: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenMobileMenu: () => void;
}

const TAB_TITLES: Record<NavTab, string> = {
  overview: 'Coordination Overview',
  voice: 'Kannada & English Voice Studio',
  cases: 'Patient Case Registry',
  coordination: 'Consultations & Referrals',
  escalations: 'Escalation Alerts & Human Handoff',
  governance: 'Audit Logs, RBAC & Sync',
};

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  role,
  firebaseUser,
  firestoreConnected,
  onOpenIntake,
  onSignIn,
  onSignOut,
  onOpenMobileMenu,
}) => {
  const canIntake = canPerformAction(role, 'intake_create');

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="font-medium text-slate-500 hidden sm:inline whitespace-nowrap">
            CareBridge AI
          </span>
          <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <h1 className="font-display font-semibold text-slate-900 truncate">
            {TAB_TITLES[activeTab]}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap">
          <span>{firestoreConnected ? 'Firestore Ready' : 'Shared Local Store'}</span>
          <span aria-hidden="true">·</span>
          {firebaseUser ? (
            <button
              type="button"
              onClick={onSignOut}
              className="text-slate-700 hover:text-slate-900 font-medium underline underline-offset-2 whitespace-nowrap"
            >
              Sign out ({firebaseUser.displayName || firebaseUser.email})
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="text-teal-700 hover:text-teal-800 font-medium underline underline-offset-2 whitespace-nowrap"
            >
              Connect Google Auth
            </button>
          )}
        </div>

        {canIntake && (
          <button
            type="button"
            onClick={onOpenIntake}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Screening Intake</span>
          </button>
        )}
      </div>
    </header>
  );
};
