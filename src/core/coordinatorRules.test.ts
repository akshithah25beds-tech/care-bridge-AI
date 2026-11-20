import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canPerformAction,
  computeDashboardMetrics,
  detectClinicalBoundaryTrigger,
  evaluateClinicianApprovedRule,
  evaluateClosureReadiness,
  identifyEscalationCandidates,
} from './coordinatorRules';
import { createSeedState } from './seedData';

test('Agent 1 (Result Intake) maps elevated HbA1c to specialist referral protocol without diagnosing', () => {
  const result = evaluateClinicianApprovedRule('HbA1c Metabolic Screening', '7.8%');
  assert.equal(result.followUpCategory, 'specialist_referral');
  assert.equal(result.requiresSpecialistReferral, true);
  assert.match(result.clinicianApprovedSummaryEn, /not a diagnosis/i);
  assert.ok(result.clinicianApprovedSummaryKn.length > 10);
});

test('Clinical safety guardrail flags diagnostic and medication questions for human handoff', () => {
  const safe = detectClinicalBoundaryTrigger('Can I book an appointment for Friday morning?');
  assert.equal(safe.triggered, false);

  const diag = detectClinicalBoundaryTrigger('Do I have diabetes? What tablet should I take?');
  assert.equal(diag.triggered, true);

  const knMed = detectClinicalBoundaryTrigger('ನನಗೆ ಯಾವ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಬೇಕು?');
  assert.equal(knMed.triggered, true);
});

test('Agent 5 (Escalation) detects overdue unacknowledged cases without duplicating open alerts', () => {
  const state = createSeedState();
  // case_cb_1043 already has an open alert, so it should not duplicate
  const initialCandidates = identifyEscalationCandidates(
    state.cases,
    state.escalations,
    '2026-11-20T15:30:00.000Z'
  );
  assert.equal(initialCandidates.some((c) => c.caseId === 'case_cb_1043'), false);

  // Advance clock past case_cb_1042 dueAt (18h from now -> +30h)
  const futureCandidates = identifyEscalationCandidates(
    state.cases,
    state.escalations,
    '2026-11-22T06:00:00.000Z'
  );
  assert.equal(futureCandidates.some((c) => c.caseId === 'case_cb_1042'), true);
});

test('Agent 6 (Case Closure) blocks closure without evidence and without clinician RBAC role', () => {
  const state = createSeedState();
  const ramesh = state.cases.find((c) => c.id === 'case_cb_1041')!;
  const lakshmi = state.cases.find((c) => c.id === 'case_cb_1042')!;

  // Ramesh's referral is only scheduled (not completed) -> cannot close yet even as clinician
  const pendingFollowUp = evaluateClosureReadiness(
    ramesh,
    state.consultations,
    state.referrals,
    state.escalations,
    'clinician'
  );
  assert.equal(pendingFollowUp.canClose, false);
  assert.equal(pendingFollowUp.checks.followUpCompleted, false);

  // Mark referral completed -> coordinator still blocked by RBAC, clinician can close
  const completedReferrals = state.referrals.map((r) =>
    r.caseId === 'case_cb_1041' ? { ...r, status: 'completed' as const } : r
  );

  const coordinatorAttempt = evaluateClosureReadiness(
    ramesh,
    state.consultations,
    completedReferrals,
    state.escalations,
    'coordinator'
  );
  assert.equal(coordinatorAttempt.canClose, false);
  assert.equal(coordinatorAttempt.checks.clinicianRoleVerified, false);

  const clinicianAttempt = evaluateClosureReadiness(
    ramesh,
    state.consultations,
    completedReferrals,
    state.escalations,
    'clinician'
  );
  assert.equal(clinicianAttempt.canClose, true);

  const incompleteAttempt = evaluateClosureReadiness(
    lakshmi,
    state.consultations,
    state.referrals,
    state.escalations,
    'clinician'
  );
  assert.equal(incompleteAttempt.canClose, false);
  assert.ok(incompleteAttempt.missingRequirements.length >= 2);
});

test('RBAC permission matrix restricts closure approval to clinicians and kiosk to voice', () => {
  assert.equal(canPerformAction('clinician', 'case_closure_approve'), true);
  assert.equal(canPerformAction('coordinator', 'case_closure_approve'), false);
  assert.equal(canPerformAction('coordinator', 'intake_create'), true);
  assert.equal(canPerformAction('patient_kiosk', 'voice_interact'), true);
  assert.equal(canPerformAction('patient_kiosk', 'escalation_resolve'), false);
});

test('Dashboard KPI computation accurately summarizes seeded shared store', () => {
  const state = createSeedState();
  const metrics = computeDashboardMetrics(state);
  assert.equal(metrics.totalCases, 4);
  assert.equal(metrics.acknowledgedResults, 2);
  assert.equal(metrics.completedCases, 1);
  assert.equal(metrics.openEscalations, 1);
  assert.equal(metrics.activeReferrals, 1);
});
