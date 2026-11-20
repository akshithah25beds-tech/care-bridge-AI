import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { createSeedState } from '../core/seedData';
import {
  AgentActivity,
  AuditLog,
  BLUEPRINT_LIMITS,
  ConsultationRequest,
  EscalationAlert,
  PatientCase,
  ReferralRecord,
  UserRole,
} from '../types/carebridge';

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

export async function ensureStaffProfileInFirestore(
  user: User,
  defaultRole: UserRole = 'coordinator'
): Promise<UserRole> {
  if (!user.emailVerified) return defaultRole;
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/info`;

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    let resolvedRole: UserRole = defaultRole;

    if (!snap.exists()) {
      // Bootstrapped admin email gets clinician role; other self-registrants start as coordinator
      const initialRole: UserRole =
        user.email === 'akshithah_25beds@acharya.ac.in' ? 'clinician' : 'coordinator';
      resolvedRole = initialRole;

      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        displayName: (user.displayName || user.email || 'Care Staff').slice(
          0,
          BLUEPRINT_LIMITS.NAME_MAX
        ),
        role: initialRole,
        preferredLanguage: 'en',
        department: 'CareBridge Coordination Unit',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const data = snap.data();
      if (data?.role) {
        resolvedRole = data.role as UserRole;
      }
    }

    const privSnap = await getDoc(doc(db, 'users', user.uid, 'private', 'info'));
    if (!privSnap.exists() && user.email) {
      await setDoc(doc(db, 'users', user.uid, 'private', 'info'), {
        uid: user.uid,
        email: user.email.slice(0, 200),
        updatedAt: serverTimestamp(),
      });
    }

    return resolvedRole;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${userPath} | ${privatePath}`);
  }
}

export async function syncSeedCasesToFirestoreIfEmpty(user: User): Promise<void> {
  if (!user.emailVerified) return;
  const casesPath = 'patientCases';
  try {
    const existingSnap = await getDocs(
      query(collection(db, casesPath), where('ownerId', '==', user.uid))
    );
    if (!existingSnap.empty) return;

    const seed = createSeedState(user.uid);

    // Step 1: Create parent PatientCase documents first (Master Gate invariant)
    const parentBatch = writeBatch(db);
    for (const c of seed.cases) {
      const caseId = sanitizeId(c.id);
      parentBatch.set(doc(db, casesPath, caseId), {
        id: caseId,
        ownerId: user.uid,
        patientCode: c.patientCode.slice(0, BLUEPRINT_LIMITS.PATIENT_CODE_MAX),
        patientName: c.patientName.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
        ...(typeof c.age === 'number' ? { age: c.age } : {}),
        preferredLanguage: c.preferredLanguage,
        screeningType: c.screeningType.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
        screeningValue: c.screeningValue.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
        clinicianProtocol: c.clinicianProtocol.slice(0, 200),
        ...(c.clinicianApprovedSummary
          ? { clinicianApprovedSummary: c.clinicianApprovedSummary.slice(0, BLUEPRINT_LIMITS.SUMMARY_MAX) }
          : {}),
        followUpCategory: c.followUpCategory,
        stage: c.stage === 'closed' ? 'closure_pending_approval' : c.stage,
        consentGranted: c.consentGranted,
        ...(c.consentTimestamp ? { consentTimestamp: c.consentTimestamp } : {}),
        resultAcknowledged: c.resultAcknowledged,
        humanHandoffRequired: c.humanHandoffRequired,
        ...(c.humanHandoffReason
          ? { humanHandoffReason: c.humanHandoffReason.slice(0, BLUEPRINT_LIMITS.NOTES_MAX) }
          : {}),
        ...(c.assignedClinician
          ? { assignedClinician: c.assignedClinician.slice(0, BLUEPRINT_LIMITS.NAME_MAX) }
          : {}),
        ...(c.dueAt ? { dueAt: c.dueAt } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await parentBatch.commit();

    // Step 2: Create child subcollections now that parent documents exist
    const childBatch = writeBatch(db);
    for (const cons of seed.consultations) {
      const id = sanitizeId(cons.id);
      const caseId = sanitizeId(cons.caseId);
      childBatch.set(doc(db, casesPath, caseId, 'consultations', id), {
        id,
        caseId,
        ownerId: user.uid,
        preferredDate: cons.preferredDate,
        ...(cons.preferredSlot ? { preferredSlot: cons.preferredSlot } : {}),
        mode: cons.mode,
        ...(cons.languageSupport ? { languageSupport: cons.languageSupport } : {}),
        ...(cons.department ? { department: cons.department } : {}),
        status: cons.status,
        ...(cons.notes ? { notes: cons.notes.slice(0, BLUEPRINT_LIMITS.NOTES_MAX) } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const ref of seed.referrals) {
      const id = sanitizeId(ref.id);
      const caseId = sanitizeId(ref.caseId);
      childBatch.set(doc(db, casesPath, caseId, 'referrals', id), {
        id,
        caseId,
        ownerId: user.uid,
        fromClinic: ref.fromClinic,
        toFacility: ref.toFacility,
        specialty: ref.specialty,
        status: ref.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const esc of seed.escalations) {
      const id = sanitizeId(esc.id);
      const caseId = sanitizeId(esc.caseId);
      childBatch.set(doc(db, casesPath, caseId, 'escalations', id), {
        id,
        caseId,
        ownerId: user.uid,
        reason: esc.reason.slice(0, BLUEPRINT_LIMITS.REASON_MAX),
        severity: esc.severity,
        status: esc.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const act of seed.activities) {
      const id = sanitizeId(act.id);
      const caseId = sanitizeId(act.caseId);
      childBatch.set(doc(db, casesPath, caseId, 'agentActivities', id), {
        id,
        caseId,
        ownerId: user.uid,
        agentName: act.agentName,
        action: act.action.slice(0, 160),
        summary: act.summary.slice(0, BLUEPRINT_LIMITS.NOTES_MAX),
        ...(act.language ? { language: act.language } : {}),
        createdAt: serverTimestamp(),
      });
    }

    for (const aud of seed.auditLogs) {
      const id = sanitizeId(aud.id);
      const caseId = sanitizeId(aud.caseId);
      childBatch.set(doc(db, casesPath, caseId, 'auditLogs', id), {
        id,
        caseId,
        ownerId: user.uid,
        actor: aud.actor.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
        actorRole: aud.actorRole,
        event: aud.event.slice(0, 160),
        details: aud.details.slice(0, BLUEPRINT_LIMITS.NOTES_MAX),
        createdAt: serverTimestamp(),
      });
    }

    await childBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, casesPath);
  }
}

export async function mirrorCaseMutationToFirestore(
  user: User,
  c: PatientCase,
  options?: {
    consultations?: ConsultationRequest[];
    referrals?: ReferralRecord[];
    escalations?: EscalationAlert[];
    activities?: AgentActivity[];
    auditLogs?: AuditLog[];
  }
): Promise<void> {
  if (!user.emailVerified) return;
  const caseId = sanitizeId(c.id);
  const casePath = `patientCases/${caseId}`;

  try {
    const existing = await getDoc(doc(db, 'patientCases', caseId));
    if (!existing.exists()) {
      await setDoc(doc(db, 'patientCases', caseId), {
        id: caseId,
        ownerId: user.uid,
        patientCode: c.patientCode.slice(0, BLUEPRINT_LIMITS.PATIENT_CODE_MAX),
        patientName: c.patientName.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
        ...(typeof c.age === 'number' ? { age: c.age } : {}),
        preferredLanguage: c.preferredLanguage,
        screeningType: c.screeningType.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
        screeningValue: c.screeningValue.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
        clinicianProtocol: c.clinicianProtocol.slice(0, 200),
        ...(c.clinicianApprovedSummary
          ? { clinicianApprovedSummary: c.clinicianApprovedSummary.slice(0, BLUEPRINT_LIMITS.SUMMARY_MAX) }
          : {}),
        followUpCategory: c.followUpCategory,
        stage: c.stage === 'closed' ? 'closure_pending_approval' : c.stage,
        consentGranted: c.consentGranted,
        ...(c.consentTimestamp ? { consentTimestamp: c.consentTimestamp } : {}),
        resultAcknowledged: c.resultAcknowledged,
        humanHandoffRequired: c.humanHandoffRequired,
        ...(c.humanHandoffReason
          ? { humanHandoffReason: c.humanHandoffReason.slice(0, BLUEPRINT_LIMITS.NOTES_MAX) }
          : {}),
        ...(c.assignedClinician
          ? { assignedClinician: c.assignedClinician.slice(0, BLUEPRINT_LIMITS.NAME_MAX) }
          : {}),
        ...(c.dueAt ? { dueAt: c.dueAt } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(
        doc(db, 'patientCases', caseId),
        {
          id: caseId,
          ownerId: existing.data().ownerId || user.uid,
          patientCode: c.patientCode.slice(0, BLUEPRINT_LIMITS.PATIENT_CODE_MAX),
          patientName: c.patientName.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
          ...(typeof c.age === 'number' ? { age: c.age } : {}),
          preferredLanguage: c.preferredLanguage,
          screeningType: c.screeningType.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
          screeningValue: c.screeningValue.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
          clinicianProtocol: c.clinicianProtocol.slice(0, 200),
          ...(c.clinicianApprovedSummary
            ? { clinicianApprovedSummary: c.clinicianApprovedSummary.slice(0, BLUEPRINT_LIMITS.SUMMARY_MAX) }
            : {}),
          followUpCategory: c.followUpCategory,
          stage: c.stage,
          consentGranted: c.consentGranted,
          ...(c.consentTimestamp ? { consentTimestamp: c.consentTimestamp } : {}),
          resultAcknowledged: c.resultAcknowledged,
          humanHandoffRequired: c.humanHandoffRequired,
          ...(c.humanHandoffReason
            ? { humanHandoffReason: c.humanHandoffReason.slice(0, BLUEPRINT_LIMITS.NOTES_MAX) }
            : {}),
          ...(c.assignedClinician
            ? { assignedClinician: c.assignedClinician.slice(0, BLUEPRINT_LIMITS.NAME_MAX) }
            : {}),
          ...(c.dueAt ? { dueAt: c.dueAt } : {}),
          ...(c.closedByClinician ? { closedByClinician: c.closedByClinician.slice(0, 120) } : {}),
          createdAt: existing.data().createdAt,
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
    }

    if (options?.activities?.length) {
      const act = options.activities[0];
      const actId = sanitizeId(act.id);
      await setDoc(doc(db, 'patientCases', caseId, 'agentActivities', actId), {
        id: actId,
        caseId,
        ownerId: user.uid,
        agentName: act.agentName,
        action: act.action.slice(0, 160),
        summary: act.summary.slice(0, BLUEPRINT_LIMITS.NOTES_MAX),
        ...(act.language ? { language: act.language } : {}),
        createdAt: serverTimestamp(),
      });
    }

    if (options?.auditLogs?.length) {
      const aud = options.auditLogs[0];
      const audId = sanitizeId(aud.id);
      await setDoc(doc(db, 'patientCases', caseId, 'auditLogs', audId), {
        id: audId,
        caseId,
        ownerId: user.uid,
        actor: aud.actor.slice(0, BLUEPRINT_LIMITS.NAME_MAX),
        actorRole: aud.actorRole,
        event: aud.event.slice(0, 160),
        details: aud.details.slice(0, BLUEPRINT_LIMITS.NOTES_MAX),
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, casePath);
  }
}

export function subscribeToUserCases(
  user: User,
  onCountUpdate: (count: number) => void
): () => void {
  if (!user.emailVerified) return () => {};
  const q = query(collection(db, 'patientCases'), where('ownerId', '==', user.uid));
  return onSnapshot(
    q,
    (snapshot) => {
      onCountUpdate(snapshot.size);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'patientCases');
    }
  );
}
