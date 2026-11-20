/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { ConsultationsReferralsView } from './components/ConsultationsReferralsView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { EscalationsView } from './components/EscalationsView';
import { GovernanceAuditView } from './components/GovernanceAuditView';
import { IntakeModal } from './components/IntakeModal';
import { OverviewDashboard } from './components/OverviewDashboard';
import { PatientCaseDetail } from './components/PatientCaseDetail';
import { QuickCaseModal } from './components/QuickCaseModal';
import { NavTab, Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { VoiceStudio } from './components/VoiceStudio';
import { auth, signInWithGoogle, signOutFirebase, testConnection } from './firebase';
import {
  fetchCareState,
  fetchHealthStatus,
  FullCareStateResponse,
  submitIntakeAgent,
  triggerEscalationScanApi,
} from './services/coordinatorApi';
import {
  ensureStaffProfileInFirestore,
  mirrorCaseMutationToFirestore,
  subscribeToUserCases,
  syncSeedCasesToFirestoreIfEmpty,
} from './services/firestoreSync';
import { LanguageCode, UserRole } from './types/carebridge';

function CareBridgeWorkspace() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [role, setRole] = useState<UserRole>('clinician');
  const [careState, setCareState] = useState<FullCareStateResponse | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('case_cb_1041');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [quickCaseModalId, setQuickCaseModalId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firestoreConnected, setFirestoreConnected] = useState(false);
  const [authBanner, setAuthBanner] = useState<string | null>(null);

  const actorName =
    firebaseUser?.displayName ||
    (role === 'clinician'
      ? 'Dr. Ananya Rao, MD'
      : role === 'coordinator'
      ? 'Karthik Hegde'
      : 'Patient Kiosk #04');

  // Initialize shared coordinator state + Firestore connection check + Auth listener
  useEffect(() => {
    let mounted = true;
    let unsubscribeCases: (() => void) | undefined;

    async function init() {
      try {
        const [stateRes, healthRes, fbOk] = await Promise.all([
          fetchCareState(),
          fetchHealthStatus(),
          testConnection(),
        ]);
        if (!mounted) return;
        setCareState(stateRes);
        setGeminiConfigured(healthRes.geminiConfigured);
        setFirestoreConnected(fbOk);
        if (stateRes.cases.length > 0) {
          setSelectedCaseId((prev) =>
            stateRes.cases.some((c) => c.id === prev) ? prev : stateRes.cases[0].id
          );
        }
      } catch (err) {
        if (!mounted) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load CareBridge AI state.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (unsubscribeCases) {
        unsubscribeCases();
        unsubscribeCases = undefined;
      }
      if (user && user.emailVerified) {
        try {
          const assignedRole = await ensureStaffProfileInFirestore(user, 'coordinator');
          setRole(assignedRole);
          await syncSeedCasesToFirestoreIfEmpty(user);
          unsubscribeCases = subscribeToUserCases(user, () => {
            setFirestoreConnected(true);
          });
        } catch (err) {
          setAuthBanner(err instanceof Error ? err.message : 'Firestore sync error');
        }
      }
    });

    return () => {
      mounted = false;
      unsubAuth();
      if (unsubscribeCases) unsubscribeCases();
    };
  }, []);

  const syncUpdatedState = async (newState: FullCareStateResponse) => {
    setCareState(newState);
    if (firebaseUser && firebaseUser.emailVerified && newState.cases[0]) {
      // Mirror latest mutated case & logs to Cloud Firestore
      const target =
        newState.cases.find((c) => c.id === selectedCaseId) || newState.cases[0];
      mirrorCaseMutationToFirestore(firebaseUser, target, {
        activities: newState.activities.filter((a) => a.caseId === target.id).slice(0, 1),
        auditLogs: newState.auditLogs.filter((l) => l.caseId === target.id).slice(0, 1),
      }).catch((err) => {
        console.warn('Firestore mirror warning:', err);
      });
    }
  };

  const handleSignIn = async () => {
    setAuthBanner(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthBanner(err instanceof Error ? err.message : 'Google sign-in cancelled or failed.');
    }
  };

  const handleSignOut = async () => {
    await signOutFirebase();
    setAuthBanner(null);
  };

  const handleIntakeSubmit = async (payload: {
    patientName: string;
    age?: number;
    preferredLanguage: LanguageCode;
    screeningType: string;
    screeningValue: string;
    assignedClinician: string;
  }) => {
    const res = await submitIntakeAgent({
      ...payload,
      actorName,
      actorRole: role,
      ownerId: firebaseUser?.uid,
    });
    setSelectedCaseId(res.newCase.id);
    await syncUpdatedState(res.state);
  };

  const handleEscalationScan = async () => {
    const res = await triggerEscalationScanApi({ actorName, actorRole: role });
    await syncUpdatedState(res.state);
  };

  const handleOpenVoiceForCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    setActiveTab('voice');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 w-full max-w-md space-y-3">
          <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-64 bg-slate-100 rounded animate-pulse" />
          <div className="h-4 w-52 bg-slate-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError || !careState) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Unable to Connect to CareBridge Coordinator
          </h2>
          <p className="text-xs text-red-700">{loadError || 'Unknown server error.'}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        role={role}
        onChangeRole={setRole}
        openEscalationCount={careState.metrics.openEscalations}
        pendingCasesCount={careState.metrics.pendingFollowUps}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeTab={activeTab}
          role={role}
          firebaseUser={firebaseUser}
          firestoreConnected={firestoreConnected}
          onOpenIntake={() => setIntakeOpen(true)}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-6">
          {authBanner && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center justify-between gap-3">
              <span>{authBanner}</span>
              <button
                type="button"
                onClick={() => setAuthBanner(null)}
                className="font-medium underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeTab === 'overview' && (
            <OverviewDashboard
              state={careState}
              role={role}
              selectedCaseId={selectedCaseId}
              onSelectCase={setSelectedCaseId}
              onOpenVoiceForCase={handleOpenVoiceForCase}
              onOpenInspectModal={(id) => {
                setSelectedCaseId(id);
                setQuickCaseModalId(id);
              }}
              onOpenIntakeModal={() => setIntakeOpen(true)}
              onRunEscalationScan={handleEscalationScan}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'voice' && (
            <VoiceStudio
              state={careState}
              selectedCaseId={selectedCaseId}
              onSelectCase={setSelectedCaseId}
              onStateUpdated={syncUpdatedState}
              role={role}
              actorName={actorName}
              geminiConfigured={geminiConfigured}
            />
          )}

          {activeTab === 'cases' && (
            <PatientCaseDetail
              state={careState}
              selectedCaseId={selectedCaseId}
              onSelectCase={setSelectedCaseId}
              onStateUpdated={syncUpdatedState}
              onOpenVoiceForCase={handleOpenVoiceForCase}
              role={role}
              actorName={actorName}
            />
          )}

          {activeTab === 'coordination' && (
            <ConsultationsReferralsView
              state={careState}
              role={role}
              actorName={actorName}
              onStateUpdated={syncUpdatedState}
              onInspectCase={(id) => {
                setSelectedCaseId(id);
                setActiveTab('cases');
              }}
            />
          )}

          {activeTab === 'escalations' && (
            <EscalationsView
              state={careState}
              role={role}
              actorName={actorName}
              onStateUpdated={syncUpdatedState}
              onInspectCase={(id) => {
                setSelectedCaseId(id);
                setActiveTab('cases');
              }}
            />
          )}

          {activeTab === 'governance' && (
            <GovernanceAuditView
              state={careState}
              role={role}
              firebaseUser={firebaseUser}
              firestoreConnected={firestoreConnected}
              onSignIn={handleSignIn}
              onSignOut={handleSignOut}
              onStateUpdated={syncUpdatedState}
            />
          )}
        </main>
      </div>

      <IntakeModal
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        onSubmit={handleIntakeSubmit}
      />

      <QuickCaseModal
        open={Boolean(quickCaseModalId)}
        caseId={quickCaseModalId || selectedCaseId}
        state={careState}
        role={role}
        actorName={actorName}
        onClose={() => setQuickCaseModalId(null)}
        onStateUpdated={syncUpdatedState}
        onOpenVoice={handleOpenVoiceForCase}
        onOpenFullTimeline={(id) => {
          setSelectedCaseId(id);
          setActiveTab('cases');
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <CareBridgeWorkspace />
    </ErrorBoundary>
  );
}
