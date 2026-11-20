# CareBridge AI — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Identity & Ownership**: Every `patientCases` document and its subcollections (`consultations`, `referrals`, `escalations`, `agentActivities`, `auditLogs`) MUST have an `ownerId` matching the authenticated creator's `request.auth.uid` (unless operated by a verified admin).
2. **Verified Authentication**: All reads and writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Immutable Audit Trail**: `auditLogs` and `agentActivities` are strictly append-only; updates and deletes are unconditionally denied.
4. **Clinician-Controlled Case Closure**: A `patientCases` document cannot transition to `stage == "closed"` unless `consentGranted == true`, `resultAcknowledged == true`, and `closedByClinician` is a non-empty string. Once `stage == "closed"`, non-admin updates are blocked (Terminal State Locking).
5. **PII Isolation**: Staff emails live strictly in `/users/{userId}/private/info`, readable and writable only by the owning user or verified bootstrapped admin.
6. **Self-Assigned Role Escalation Prevention**: Users creating `/users/{userId}` can only self-register as `coordinator` or `patient_kiosk`; assigning `clinician` role requires an admin.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Case Read**: Anonymous client attempts `get /patientCases/case_01`.
2. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create a case.
3. **Shadow Field Injection (Ghost Field)**: Authenticated user creates a case with extra field `isAdminApproved: true`.
4. **Owner Spoofing on Create**: User `uid_A` creates a case with `ownerId: "uid_B"`.
5. **Privilege Escalation in Profile**: User `uid_A` creates `/users/uid_A` with `role: "clinician"` without admin privilege.
6. **Cross-User PII Snooping**: User `uid_A` attempts `get /users/uid_B/private/info`.
7. **ID Poisoning**: User creates `/patientCases/../../etc/passwd` or a 500-char invalid ID.
8. **Timestamp Forgery**: Client attempts to set `createdAt` to a backdated string instead of `request.time`.
9. **Orphan Subcollection Write**: User attempts to create `/patientCases/nonexistent_case/consultations/c1`.
10. **Audit Log Tampering**: User attempts to `update` or `delete` `/patientCases/case_01/auditLogs/log_1`.
11. **Premature AI Closure Bypass**: User attempts to update `patientCases/case_01` to `stage: "closed"` while `consentGranted: false`.
12. **Terminal State Mutation**: User attempts to modify a case after `stage == "closed"`.
