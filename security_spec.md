# Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity Ownership Invariant**: Every document in `/employees/{employeeId}`, `/templates/{templateId}`, `/import_logs/{logId}`, `/print_logs/{logId}`, and `/settings/{settingId}` must belong to the authenticated and email-verified user (`ownerId == request.auth.uid`) or a verified bootstrapped administrator.
2. **Strict Schema & Key Whitelisting Invariant**: Every `create` and `update` must validate exact keys (`hasAll` and `hasOnly`) and enforce string length bounds and numeric bounds to prevent shadow fields and resource exhaustion.
3. **Immutability Invariant**: `ownerId` and `createdAt` can never be mutated during an `update`.
4. **Temporal Integrity Invariant**: `createdAt` must equal `request.time` on `create`, and `updatedAt` must equal `request.time` on `update`.
5. **Query Enforcer Invariant**: `allow list` rules must explicitly verify `resource.data.ownerId == request.auth.uid` so no cross-tenant query scraping is possible.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: Creating an employee when `request.auth == null`.
2. **Unverified Email Spoof**: Creating an employee when `request.auth.token.email_verified == false`.
3. **Owner Spoofing on Create**: Setting `ownerId: "victim-uid"` when `request.auth.uid == "attacker-uid"`.
4. **Shadow Field Injection on Create**: Adding `"isAdmin": true` to `/employees/{id}`.
5. **Shadow Field Injection on Update**: Updating `/employees/{id}` with an undeclared field `"role": "superadmin"`.
6. **ID Poisoning Attack**: Document ID with >128 chars or special characters outside `^[a-zA-Z0-9_\-]+$`.
7. **Denial of Wallet String Overflow**: Setting `fullName` to a 10,000-character string (exceeds `maxLength: 120`).
8. **Immutable Field Mutation**: Updating `createdAt` or `ownerId` on an existing `/employees/{id}` document.
9. **Client Timestamp Forgery**: Passing a past/future timestamp for `createdAt` or `updatedAt` instead of `request.time`.
10. **Cross-Tenant Read/Get**: Authenticated user A reading `/employees/{docOfUserB}`.
11. **Unfiltered List Query**: Authenticated user running an unconstrained collection list across all users' records.
12. **Audit Log Tampering**: Attempting to `update` or `delete` immutable audit logs in `/import_logs/{logId}` or `/print_logs/{logId}`.
