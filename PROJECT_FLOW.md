# Neomora Club Manager — Project Flow Document

A complete, end-to-end walkthrough of how every module in the Neomora Club
Manager backend works in practice: who calls what, what status changes
happen, what side-effects fire, and how the pieces interact.

> Companion to `API_DOCUMENTATION.md` (URL/method/body reference) and
> `neomora-api.postman_collection.json` (ready-to-import Postman v2.1).
> This document explains the **business logic and lifecycles** behind
> those endpoints.

---

## Table of Contents

0. [Architecture Overview](#0-architecture-overview)
1. [Tenants, Users & Authentication](#1-tenants-users--authentication)
2. [Locations & QR Registration](#2-locations--qr-registration)
3. [Sessions Lifecycle](#3-sessions-lifecycle)
4. [Participant Registration Flows](#4-participant-registration-flows)
5. [Enrolment Allocation (Seat Engine)](#5-enrolment-allocation-seat-engine)
6. [Documents: Upload → Verify → Auto-Promote](#6-documents-upload--verify--auto-promote)
7. [Fees & Invoices](#7-fees--invoices)
8. [Payments: Offline & Online](#8-payments-offline--online)
9. [Auto-Promotion to ACTIVE](#9-auto-promotion-to-active)
10. [Waitlist Lifecycle](#10-waitlist-lifecycle)
11. [Guardian Portal & Magic Links](#11-guardian-portal--magic-links)
12. [Notifications Dispatch](#12-notifications-dispatch)
13. [Reporting & Dashboards](#13-reporting--dashboards)
14. [API Keys & Partner Integration](#14-api-keys--partner-integration)
15. [Audit Chain (Tamper Detection)](#15-audit-chain-tamper-detection)
16. [Cron Processors Summary](#16-cron-processors-summary)
17. [Status Enum Reference](#17-status-enum-reference)
18. [End-to-End Worked Example](#18-end-to-end-worked-example)

---

## 0. Architecture Overview

### Stack

| Layer            | Technology                                                |
| ---------------- | --------------------------------------------------------- |
| Runtime          | Node.js (ESM), NestJS 11                                  |
| ORM / DB         | Prisma → PostgreSQL (Neon)                                |
| Cache / locks    | Redis (optional — used for rate-limiting)                 |
| Cron / queues    | `@nestjs/schedule` (in-process)                           |
| Auth             | JWT (HS256, separate access + refresh) + API keys         |
| Validation       | `class-validator` + global `ValidationPipe`               |
| Docs             | Swagger UI at `/api/docs`, JSON at `/api/docs-json`       |

### Global conventions

- **Global prefix**: every route is mounted under `/api`.
- **URI versioning**: `/api/v1/...` (defaults to `v1` if unspecified).
- **Multi-tenant**: every domain row carries `tenantId`. The tenant is
  inferred from the caller's JWT (`tenantId` claim) or API key. Cross-
  tenant access is impossible — every query is filtered server-side.
- **Soft delete**: most tables have `deletedAt`; queries always filter
  `deletedAt: null`. Records are never hard-deleted.
- **Idempotency**: write endpoints that can be retried (payments,
  notifications) carry `idempotencyKey` or `dedupeKey` columns with
  `@unique` constraints, so retries never double-write.

### Three authentication mechanisms

| Caller      | Header                          | Identity carried                                   | Used for                  |
| ----------- | ------------------------------- | -------------------------------------------------- | ------------------------- |
| Staff       | `Authorization: Bearer <jwt>`   | `{ sub, tenantId, role, locationId? }`             | Admin console / dashboards |
| Guardian    | `Authorization: Bearer <jwt>`   | `{ sub: guardianId, tenantId, actorType: 'GUARDIAN' }` | Guardian portal           |
| Partner app | `x-api-key: nm_<48 hex>`        | `{ tenantId, scopes[], rateLimit }`                | Server-to-server (HRIS, etc.) |

The unified `JwtOrApiKeyGuard` accepts any of the three. Role-based
checks are applied per-endpoint via `@Roles(...)` or `@RequireScopes(...)`.

### Role matrix (staff JWT)

| Role              | Scope                                                          |
| ----------------- | -------------------------------------------------------------- |
| `SUPER_ADMIN`     | Full tenant access. May override fee plans, force enrolments. |
| `LOCATION_MANAGER`| Auto-scoped to their `locationId` — list endpoints filter automatically; write endpoints `403` if the target row is in a different location. |
| `FINANCE_OFFICER` | Same access as super-admin for payments, invoices, fee overrides. |
| `STAFF`           | Read + basic write (register participant, upload docs). Cannot verify payments, edit fees, or change tenant config. |

### Layered structure

```
src/
├── infra/            # Cross-cutting infra (Prisma, Redis, logging)
├── common/           # Guards, decorators, filters, DTOs, constants
└── modules/
    ├── auth/                ← login, refresh, 2FA, password reset
    ├── users/               ← staff CRUD (super-admin only)
    ├── tenants/             ← tenant settings (balance threshold, branding)
    ├── locations/           ← locations + QR codes
    ├── sessions/            ← sessions + auto-status cron
    ├── registration/        ← public form + slug-based registration
    ├── participants/        ← participants + 360° profile + portal
    ├── guardians/           ← (controller is empty — see guardian-auth)
    ├── guardian-auth/       ← magic-link login for guardians
    ├── enrolments/          ← allocator (advisory lock) + enrol APIs
    ├── documents/           ← uploads, verify, signed URLs
    ├── fees/                ← plans, invoices, fee overrides
    ├── payments/            ← record/verify/reject + gateways + webhooks
    ├── waitlist/            ← offers, accept/decline, cron promotion
    ├── notifications/       ← WhatsApp/Email/SMS dispatch + dedupe
    ├── reporting/           ← dashboards, fees, funnel, revenue, capacity
    ├── api-keys/            ← partner key issuance + revocation
    └── audit/               ← tamper-evident hash-chained audit logs
```

---

## 1. Tenants, Users & Authentication

### 1.1 Tenant + first staff bootstrap

1. A tenant row is seeded (super-admin or via DB migration). It carries:
   - `slug` (used in public registration URLs)
   - `balanceThreshold` (e.g. SAR 0 → no balance allowed before ACTIVE)
   - branding fields
2. The first `SUPER_ADMIN` user is also seeded with a bcrypt-hashed
   password. From then on staff are managed via `POST /api/v1/users`.

### 1.2 Login flow

```
POST /api/v1/auth/login
{ "email": "...", "password": "...", "totpCode": "123456?" }
        │
        ▼
1. Look up user by email + tenant.
2. bcrypt.compare(password, hash).
3. If totpEnabled → require totpCode + verify via otplib
   (30s step, ±1 window).
4. On success → mint:
     • accessToken  (15 min, JWT HS256)
     • refreshToken (7 days, JWT HS256 with random jti)
5. Persist the refreshToken's jti in cm_refresh_tokens (one row per
   active session).
6. Return both tokens.
```

**Failure handling**: 5 consecutive failed attempts within 15 minutes
lock the account for 15 minutes (tracked in `cm_login_attempts`).

### 1.3 Refresh

```
POST /api/v1/auth/refresh
{ "refreshToken": "..." }
        │
        ▼
1. Verify signature + expiry.
2. Look up jti in cm_refresh_tokens. Reject if revoked / unknown.
3. Atomically:
     • Revoke old jti
     • Insert new jti
     • Mint new access + refresh pair
```

This **rotation** means a leaked refresh token works exactly once —
the next legitimate refresh invalidates it.

### 1.4 Two-factor authentication

| Endpoint                  | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `POST /auth/2fa/setup`    | Generates a TOTP secret + otpauth URL (QR-encodable). `totpEnabled` stays **false** until `enable` is called. |
| `POST /auth/2fa/enable`   | Validates the user-entered code against the stored secret; only then flips `totpEnabled = true`. |
| `POST /auth/2fa/disable`  | Requires **both** the TOTP code AND the password.      |

### 1.5 Password reset (anti-enumeration)

```
POST /auth/forgot-password { email }
   → ALWAYS returns 200 (so attackers can't enumerate accounts).
   → If user exists: generate 32-byte token, store SHA-256 hash with 1h TTL.
   → Send reset link via notification channel.

POST /auth/reset-password { token, newPassword }
   → Hash the token, look it up. Reject if expired / used.
   → Update password hash, mark token used.
   → Revoke ALL refresh tokens for the user (force re-login).
```

---

## 2. Locations & QR Registration

### 2.1 Creating a location

`POST /api/v1/locations` (SUPER_ADMIN):

```json
{
  "name": "Riyadh - Olaya Branch",
  "capacity": 40,
  "address": "...",
  "city": "Riyadh"
}
```

Side effects:
1. **Slug auto-generated** from `name` (lowercased, hyphenated, dedup-
   suffixed if collision).
2. **QR code generated** — a PNG of the public form URL
   `${webBaseUrl}/register/${tenantSlug}/${locationSlug}` stored as
   `location.qrCodeUrl` (base64 data URI for inline display).

### 2.2 Public form URL

The QR encodes the URL the guardian opens on their phone:

```
https://app.example.com/register/<tenantSlug>/<locationSlug>
```

The frontend then calls `GET /registration/form/:slug` to fetch the
location + open sessions list, and `POST /registration/form/:slug` to
submit (see §4.1).

### 2.3 Listing / scoping

`GET /api/v1/locations` returns all non-deleted locations for the
tenant. For LOCATION_MANAGER, the list is auto-filtered to their own
`locationId` (so the dashboard only shows one row).

---

## 3. Sessions Lifecycle

Sessions are the schedulable "classes" / "programmes" participants
enrol into.

### 3.1 State machine

```
                  staff sets it             staff sets it           staff sets it
                  (or cron @ enrolOpenAt)   (or cron @ enrolCloseAt) (manual)
   DRAFT  ─────► OPEN  ─────► CLOSED ─────► ARCHIVED
                  ▲                               ✕
                  └───────────────────────────────┘ (no return)
```

**Allow-list (enforced in `SessionsService.updateStatus`)**:

| From     | Allowed → To          |
| -------- | --------------------- |
| DRAFT    | OPEN                  |
| OPEN     | CLOSED                |
| CLOSED   | ARCHIVED              |
| ARCHIVED | *(terminal)*          |

Any other transition → `409 Conflict`.

### 3.2 Auto status processor

`SessionAutoStatusProcessor` runs **every 30 minutes**:

```
for each non-deleted session:
  if status === DRAFT  AND enrolOpenAt  <= now → flip to OPEN
  if status === OPEN   AND enrolCloseAt <= now → flip to CLOSED
```

Gated by `app.sessionAutoStatusEnabled` env flag. The processor
writes an AuditLog entry for every transition.

### 3.3 Public visibility

Only sessions with `status = OPEN` AND `enrolOpenAt <= now <= enrolCloseAt`
are surfaced through the public form endpoint
`GET /registration/form/:slug`. A staff member calling
`GET /sessions` (with JWT) sees everything.

### 3.4 Payment plans on a session

A session can carry one or more `SessionPaymentPlan` rows (FULL,
MONTHLY, SEASONAL — see §7). The plan list is what the registration
form shows the guardian as "payment options" at submit time.

---

## 4. Participant Registration Flows

There are **two registration paths**, both feeding the same allocator
(§5):

### 4.1 Public form (slug-based) — `POST /registration/form/:slug`

Used by guardians who scanned the location's QR code. No auth.

```
POST /registration/form/:locationSlug
Body:
{
  "tenantSlug": "...",
  "sessionId": "...",
  "paymentPlanType": "MONTHLY",
  "firstNameEn": "...", "lastNameEn": "...",
  "dob": "2014-05-10",
  "gender": "MALE",
  "preferredLang": "en",
  "guardian": {
    "fullName": "...", "phone": "+9665...", "email": "...",
    "relationship": "FATHER", "preferredLang": "en"
  }
}
```

What happens server-side:

1. Resolve `tenant` by slug and `location` by `(tenantId, slug)`.
2. Verify the chosen session is OPEN and within its enrolment window.
3. Verify the chosen `paymentPlanType` is offered by that session.
4. Create a `Participant` row at `INQUIRY` with a tenant-scoped
   sequence ID `P-NNNNNN` (race-free via `nextTenantSequence(tx,
   tenantId, 'participant')`).
5. Create or reuse the `Guardian` row (matched by phone + tenant).
6. Call the allocator (`EnrolmentAllocatorService.allocate`) → see §5.
7. Fire notifications post-commit (registration outcome).

Returns:

```json
{
  "participantId": "...",
  "uniqueId": "P-000123",
  "outcome": "ENROLLED",       // or WAITLISTED
  "enrolmentId": "...",         // when ENROLLED
  "waitlistPosition": 3         // when WAITLISTED
}
```

### 4.2 Staff manual registration — `POST /participants/register`

Used by front-desk staff at a branch. Requires JWT.

Same flow as the form, but:
- Body uses `locationSlug` directly (not derived from URL).
- Staff can also create a participant **without** enrolling them
  immediately by omitting `sessionId` — useful when registering a
  prospect at the desk before they pick a session.

### 4.3 Status sequence after registration

After a successful registration, the participant lands in one of
these starting statuses:

| Outcome      | Participant.status | Enrolment.status | Next action                                          |
| ------------ | ------------------ | ---------------- | ---------------------------------------------------- |
| ENROLLED     | `FEE_PENDING`      | `FEE_PENDING`    | Guardian pays → auto-promote to ACTIVE               |
| WAITLISTED   | `INQUIRY`          | `WAITLISTED`     | Wait for offer when seat frees up                    |
| INQUIRY only | `INQUIRY`          | *(none)*         | Staff converts later via `POST /enrolments`          |

### 4.4 Participant status state machine

```
                  staff or auto         (docs uploaded + verified)
   INQUIRY ───► DOCUMENTS_PENDING ───────────────────────────────┐
       │                                                          │
       │ (skip docs if not required)                              ▼
       └──────────────────────► FEE_PENDING ──── pay ──► ACTIVE
                                     │                     │
                                     │                     ├──► ON_HOLD     (staff hold)
                                     │                     ├──► COMPLETED   (session ended)
                                     │                     └──► WITHDRAWN   (staff withdraw)
                                     └──► ON_HOLD / WITHDRAWN
```

Implemented as a strict allow-list in `ParticipantsService.updateStatus`.

**Balance guard**: manually flipping `FEE_PENDING → ACTIVE` requires
`enrolment.balance <= tenant.balanceThreshold`. SUPER_ADMIN and
FINANCE_OFFICER may pass `?force=true` to bypass.

---

## 5. Enrolment Allocation (Seat Engine)

The heart of the system: `EnrolmentAllocatorService.allocate` decides
whether a participant gets a seat or joins the waitlist.

### 5.1 The race condition we solve

Two guardians submit the form for the **last seat** at the same
millisecond. Without locking, both create an enrolment → over-capacity.

### 5.2 The solution: PostgreSQL advisory lock

```sql
SELECT pg_advisory_xact_lock(
  hashtext('<sessionId>'),
  hashtext('<locationId>')
);
```

Held until transaction commit/rollback. Any second caller targeting the
same `(session, location)` blocks until the first finishes — strict
serialization without table locks. Other (session, location) pairs are
unaffected.

The transaction timeout is bumped to **60 s** (`{ timeout: 60_000,
maxWait: 60_000 }`) because Neon WebSocket latency makes the default
5 s too tight when several writes are chained inside the lock.

### 5.3 Algorithm

```
BEGIN
  pg_advisory_xact_lock(hashtext(sessionId), hashtext(locationId));

  capacity := location.capacity;
  occupied := count(enrolments) where
                sessionId, locationId match
                AND status NOT IN (WAITLISTED, WITHDRAWN);

  IF occupied < capacity THEN
      enrolment := create(status = FEE_PENDING);
      participant.status := FEE_PENDING (if was INQUIRY/DOCUMENTS_PENDING);
      outcome := ENROLLED;
  ELSE
      maxPos := select max(position) from waitlist
                 where sessionId, locationId match;
      waitlist := create(position = maxPos + 1, offerStatus = PENDING);
      outcome := WAITLISTED;
  END IF;
COMMIT;
```

### 5.4 Overlap guard

`assertNoOverlap` refuses to create a new enrolment when the
participant already has an **active** enrolment (ACTIVE / FEE_PENDING
/ DOCUMENTS_PENDING) whose session dates overlap the new session.

Bypass: pass `?allowOverlap=true` on the staff-side `POST /enrolments`
endpoint — restricted to SUPER_ADMIN and FINANCE_OFFICER.

### 5.5 Enrolment state machine

```
   WAITLISTED ─ guardian/staff accept offer ─► FEE_PENDING ──── pay ──► ACTIVE
                                                    │
   DOCUMENTS_PENDING ◄── if docs required ◄─── (optional branch)
                                                    │
                       ┌────────────────────────────┤
                       ▼                            ▼
                  ON_HOLD                      WITHDRAWN
                       │                            ▲
                       └─► resume → ACTIVE          │
                                                    │
                            ACTIVE ─ session ended ─► COMPLETED
                            ACTIVE ────────────────► WITHDRAWN
```

---

## 6. Documents: Upload → Verify → Auto-Promote

### 6.1 Required document types

Currently hard-coded in `DocumentsService`:

```ts
const REQUIRED_DOC_TYPES = ['BIRTH_CERTIFICATE', 'ID_PHOTO'];
```

(Per-tenant configurable required-types list is on the roadmap.)

### 6.2 Upload flow

```
POST /api/v1/documents/upload
Content-Type: multipart/form-data
Fields:
  participantId, docType (e.g. BIRTH_CERTIFICATE), file
        │
        ▼
1. RBAC: LOCATION_MANAGER can only upload for participants in their location.
2. File saved to:    storage/<tenantId>/<participantId>/<docType>/<ts>_<orig>
   (timestamp prefix so re-uploads don't overwrite — Plan H.)
3. Document row created at status = PENDING.
```

Returns `{ id, storageKey }`.

### 6.3 Signed-URL download

`GET /api/v1/documents/:participantId/:docId/url?disposition=inline|attachment`
returns:

```json
{ "url": "...", "expiresIn": 900 }
```

Behind the scenes the `StorageService` either signs an S3 GetObject
(prod) or returns a local URL `?token=<hmac>&exp=<unix>` pointing at
`GET /documents/download`. The local-download endpoint verifies the
HMAC + expiry and streams the file.

### 6.4 Verification

`PATCH /api/v1/documents/:docId/verify` body `{ status: "VERIFIED" | "REJECTED" }`:

1. Update document status, set `verifiedById`, `verifiedAt`.
2. If newly **VERIFIED** and participant is in `DOCUMENTS_PENDING`:
   - Fetch all verified docs for the participant.
   - If **all required types** are now verified → flip participant
     status to `FEE_PENDING`.
   - Write a staff note explaining the auto-advance.
3. Returns `{ id, status, verifiedAt, participantStatusChanged }`.

### 6.5 Soft delete + re-upload

`DELETE /api/v1/documents/:participantId/:docId` flags `deletedAt`
only. The file itself stays on disk/S3 for audit. A subsequent upload
creates a fresh row (collision-safe via timestamp prefix).

---

## 7. Fees & Invoices

### 7.1 Payment plan types

| Plan type | Behaviour                                              |
| --------- | ------------------------------------------------------ |
| `FULL`    | One invoice for the whole session amount.              |
| `MONTHLY` | One invoice per month between `startDate` and `endDate`.|
| `SEASONAL`| One invoice per declared "season" within the session.   |

The plan rows live on `SessionPaymentPlan`; each row carries the
amount, frequency, and (for monthly/seasonal) the period definition.

### 7.2 Creating a payment plan

`POST /api/v1/sessions/:sessionId/payment-plans` (SUPER_ADMIN /
FINANCE_OFFICER):

```json
{
  "type": "MONTHLY",
  "amount": 1500,
  "currency": "SAR",
  "label": "Monthly fee"
}
```

### 7.3 Invoice generation

When an enrolment is created, `FeesService.generateInvoices` is called:

1. Find the chosen `SessionPaymentPlan` for that enrolment.
2. Generate N invoice rows depending on plan type:
   - FULL → 1 invoice, `dueDate = session.startDate`.
   - MONTHLY → 1 per month, dueDates spread across the term.
   - SEASONAL → 1 per declared season.
3. Each invoice gets a tenant-scoped sequence number
   `INV-<tenantPrefix>-NNNNNN` (race-free via `nextTenantSequence`).
4. All invoices start at `status = PENDING`.

### 7.4 Fee override

`PATCH /api/v1/enrolments/:enrolmentId/fee-override` (SUPER_ADMIN /
FINANCE_OFFICER only):

```json
{ "overrideAmount": 1200, "reason": "Sibling discount" }
```

Refused if **any** invoice already exists for the enrolment — the
caller must cancel existing invoices first. Writes a before/after
`AuditLog` entry for traceability.

### 7.5 Invoice statuses

```
PENDING ─── full payment received ──► PAID
   │
   │ overdue cron / manual              cancelled by finance
   ├──► OVERDUE                         (only when no completed payments)
   └──► CANCELLED
```

---

## 8. Payments: Offline & Online

Two completely separate ingress paths, but they converge on the same
verify pipeline.

### 8.1 Offline (cash, bank transfer)

```
1. Guardian pays at branch (cash) or via bank transfer.
2. Staff uploads proof:
       POST /api/v1/payments/proof-upload
       multipart: file
       → returns storageKey
3. Staff records the payment:
       POST /api/v1/payments/offline
       {
         enrolmentId, invoiceId?, method: "CASH" | "BANK_TRANSFER",
         amount, proofKey, idempotencyKey
       }
       → creates Payment row at status = PENDING_VERIFICATION
4. FINANCE_OFFICER / SUPER_ADMIN verifies:
       POST /api/v1/payments/:id/verify
       (inside transaction:)
        - status → COMPLETED
        - recompute Enrolment.balance
        - if invoice fully covered → Invoice.status = PAID
        - write AuditLog
       (post-commit:)
        - run onVerifiedHooks (PDF receipt, notifications, auto-promotion)
   OR reject:
       POST /api/v1/payments/:id/reject  { reason? }
        - status → FAILED (no balance change)
```

**Idempotency**: the staff supplies `idempotencyKey` (UUID). A repeat
POST with the same key returns the existing row instead of creating a
duplicate.

### 8.2 Online (gateway: Moyasar / PayTabs / HyperPay)

```
1. Finance issues a payment link:
       POST /api/v1/invoices/:invoiceId/payment-link
       (PaymentLinkService.issueLinkForInvoice)
       - Loads invoice + enrolment + participant + primary guardian
       - Refuses if PAID or CANCELLED
       - Ensures guardian has a long-lived portalToken (1y TTL)
       - Calls gateway strategy.createCheckoutLink(...)
       - Persists Invoice.paymentLink + paymentLinkExpiresAt
       - Enqueues FEE_INVOICE notification (idempotent per invoiceId)
2. Guardian opens the link, completes checkout on the gateway page.
3. Gateway calls our public webhook:
       POST /api/v1/payments/webhooks/:gateway   (Moyasar/PayTabs/HyperPay)
       → row inserted into cm_payment_webhook_events (raw payload + headers)
       → returns 200 immediately (must always be fast)
4. WebhookProcessor cron runs every minute:
       - Loads unprocessed events
       - Resolves strategy.byGateway(...)
       - strategy.verifySignature(...) — reject + mark processed if bad
       - strategy.parsePayload(...) — extracts gatewayRef, amount, status
       - PaymentsService.applyGatewayResult(...) — creates/updates
         Payment, recomputes balance, marks invoice paid, runs hooks
       - Marks event processed=true
```

### 8.3 Partial payments

`FeesService.recomputeBalance` always recomputes from the SUM of
`COMPLETED` payments. So if `invoice.amount = 1500` and the guardian
pays 800 + 700, the first verify leaves the invoice PENDING (sum <
amount); the second verify flips it to PAID.

### 8.4 Payment state machine

```
   PENDING ─── gateway webhook ──► COMPLETED
   PENDING ─── gateway webhook ──► FAILED
   PENDING_VERIFICATION ─ staff verify ─► COMPLETED
   PENDING_VERIFICATION ─ staff reject ─► FAILED
   COMPLETED ─ refund (manual) ──► REFUNDED   (admin tool)
```

### 8.5 onVerified hooks (best-effort, fire-and-forget)

Registered at module init by:

| Hook                          | What it does                                                       |
| ----------------------------- | ------------------------------------------------------------------ |
| `ReceiptHookService`          | Calls `ReceiptBuilderService.build(payment)` → writes PDF to storage, sets `Payment.receiptKey`. |
| Auto-notification             | Fires `PAYMENT_CONFIRM` notification to the guardian.              |
| `AutoPromotionService`        | Tries to promote the enrolment from FEE_PENDING → ACTIVE.          |

Each hook is wrapped in try/catch; one failing hook does not stop the
others, and no hook failure ever rolls back the payment.

### 8.6 Payment reminder cron

`PaymentReminderProcessor` runs **every hour** when enabled. For each
active tenant:

- Resolve reminder waves: code default `[7, 1, 0, -3, -7]` days from
  due-date (positive = upcoming, 0 = due today, negative = overdue),
  unioned with per-tenant `cm_payment_reminder_configs`.
- For each wave, find invoices with `dueDate = today + wave`.
- Skip invoices with no `paymentLink` (a reminder without a URL would
  frustrate the parent).
- Call `NotificationsService.enqueuePaymentReminder` (dedupe per
  `(invoiceId, waveLabel)` so each wave fires at most once).
- Bump `invoice.reminderSentCount`.

---

## 9. Auto-Promotion to ACTIVE

`AutoPromotionService` centralises the rule:

> An enrolment is automatically promoted to ACTIVE when
> `balance <= tenant.balanceThreshold` AND all required documents are
> verified.

### 9.1 Two trigger points

1. **Payment-verified hook**: registered on PaymentsService at module
   init. Runs after every COMPLETED payment.
2. **Documents callback**: called from `DocumentsService.verifyDocument`
   after the final required document is verified.

### 9.2 Logic

```
tryPromote(tenantId, enrolmentId):
  enrolment := find non-deleted enrolment
  if status NOT IN (FEE_PENDING, DOCUMENTS_PENDING): skip
  threshold := tenant.balanceThreshold (default Decimal(0))
  if enrolment.balance > threshold: skip (reason: balance)
  if no VERIFIED documents:          skip (reason: docs)
  BEGIN
    enrolment.status := ACTIVE
    if participant.status IN (FEE_PENDING, DOCUMENTS_PENDING):
        participant.status := ACTIVE
    AuditLog: AUTO_PROMOTED_TO_ACTIVE
  COMMIT
```

Idempotent — running on an already-ACTIVE row is a no-op. All errors
are logged but never thrown to the caller.

---

## 10. Waitlist Lifecycle

### 10.1 Entry

A participant lands on the waitlist when `EnrolmentAllocatorService`
finds the session full (`occupied >= capacity`). A `Waitlist` row is
created with `position = MAX(position) + 1` and `offerStatus = PENDING`.

### 10.2 Offer fan-out

Two triggers:

| Trigger              | When                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `promoteVacancies` cron | Every 30 seconds: scans `(session, location)` tuples with active waitlist rows AND no outstanding offer. |
| `expireOffers` cron     | Every 5 minutes: flips PENDING offers past their deadline → EXPIRED, then re-runs promotion. |
| Manual                  | `POST /api/v1/waitlist/:id/send-offer` (staff) — re-offer immediately. |

Both call `WaitlistService.tryPromoteNext(tenantId, sessionId, locationId)`:

```
1. Capacity check: enrolledCount (status NOT IN WAITLISTED/WITHDRAWN)
                   < location.capacity? If not → return null.
2. Outstanding-offer check: any PENDING row with offerSentAt set and
   offerExpiresAt in future? If yes → return null (don't double-fan-out).
3. Pick next candidate by:
     ORDER BY offerAttempts ASC, position ASC
   (so people who already let an offer expire don't keep blocking
   newer entries.)
4. issueOfferInternal:
     - Generate 32-byte token (hex)
     - Update row: offerSentAt = now, offerExpiresAt = now + 48h,
                   offerToken = ..., offerTokenExpiresAt = ...,
                   offerAttempts++
     - Build accept/decline URLs
     - Enqueue WAITLIST_OFFER notification (dedupe per offerToken).
```

The 48-hour TTL is a balance between giving guardians time and not
starving the next person on the list.

### 10.3 Guardian responds

Three public endpoints (no JWT — auth is by the random token):

| Endpoint                                      | Effect                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/waitlist/offers/accept`         | Inside a tx: re-check token validity → call allocator → mark waitlist row ACCEPTED + soft-delete. Returns the new `enrolmentId`.       |
| `POST /api/v1/waitlist/offers/decline`        | Mark waitlist row DECLINED + soft-delete + clear token. Fire-and-forget `tryPromoteNext` for next person.                              |
| `POST /api/v1/waitlist/offers/withdraw`       | Same as decline — guardian is removing themselves entirely.                                                                            |

### 10.4 Offer state machine

```
   PENDING ─── cron / manual send-offer ──► (still PENDING with offerToken set)
       │
       ├── guardian accepts ──► ACCEPTED  + soft-delete
       ├── guardian declines ─► DECLINED  + soft-delete (frees seat → promoteNext)
       └── cron expireOffers ► EXPIRED    (row stays for visibility, tokens cleared)
                                            │
                                            └── cron re-offers next person
```

### 10.5 Reading the waitlist

`GET /api/v1/waitlist?sessionId=...&locationId=...` returns positions,
offer status, and timestamps for the staff dashboard. LOCATION_MANAGER
is auto-scoped to their location.

---

## 11. Guardian Portal & Magic Links

Guardians have a **separate auth realm** from staff.

### 11.1 Magic-link request

```
POST /api/v1/guardian/auth/magic-link
{ "email": "...", "phone": "..." }
        │
        ▼
1. Look up Guardian by email OR phone.
2. ALWAYS return 200 (anti-enumeration) — caller can't tell whether
   the contact exists.
3. If found: generate 32-byte hex token, store as `magicLinkToken` +
   `magicLinkExpiresAt = now + 15 min`.
4. Dispatch link via notification channel.
5. In dev mode: also return `dev_link` in the response (never in prod).
```

### 11.2 Magic-link verification

```
POST /api/v1/guardian/auth/verify
{ "token": "..." }
        │
        ▼
1. Look up Guardian by magicLinkToken.
2. Reject if expired.
3. CLEAR magicLinkToken + expiry (one-time use).
4. Mint a guardian JWT (actorType: 'GUARDIAN', 7d expiry).
5. Return { guardianToken, guardian: { ... } }.
```

### 11.3 Guardian-authenticated endpoints

| Endpoint                            | Purpose                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `GET /guardian/me`                  | Guardian profile + linked participants                   |
| `GET /guardian/participants/:id`    | 360° view of one of their participants                   |
| `GET /guardian/invoices`            | All invoices for guardian's participants                 |
| `POST /guardian/invoices/:id/pay`   | Generates / returns the gateway payment URL              |
| `GET /guardian/documents/upload-url`| Pre-signed URL to upload a document                      |
| `POST /guardian/waitlist/...`       | Accept/decline/withdraw waitlist offer (token-only auth) |

### 11.4 Portal token (long-lived)

`PaymentLinkService` mints a 1-year `portalToken` on the Guardian
record so payment links don't have to re-authenticate every time the
guardian opens an email. The portal is happy to accept either a
fresh magic-link JWT or a long-lived portalToken.

---

## 12. Notifications Dispatch

### 12.1 Channels

`NotificationChannel` enum: `WHATSAPP`, `EMAIL`, `SMS`.
`NotificationChannelFactory` picks the strategy at runtime:

- **WhatsAppChannel** — when configured, uses the tenant's provider
  (e.g. WhatsApp Business API). Otherwise falls back to a no-op
  logger.
- **EmailChannel** — SMTP / SendGrid (per env).
- **SmsChannel** — Twilio etc.

### 12.2 Templates

`renderTemplate(key, lang, vars)` looks up the template by enum key
(`WAITLIST_OFFER`, `FEE_INVOICE`, `PAYMENT_REMINDER`,
`REGISTRATION_ENROLLED`, etc.) in the chosen language (`en` / `ar`).
Variables are validated against `TemplateVarsByKey<key>` types at
compile time.

### 12.3 Dispatch pipeline

```
enqueueXyz(input):
  1. Build row { type, channel, recipientPhone/Email, bodyText, dedupeKey }.
  2. INSERT INTO cm_notifications ... ON CONFLICT (dedupeKey) DO NOTHING.
     - Partial unique index on dedupeKey means: if dedupeKey conflicts,
       the second call is a no-op.
  3. Status starts at QUEUED.
  4. Try channel.send(row).
     - Success → status = SENT (later DELIVERED when channel confirms)
     - Failure → status = FAILED, store errorReason
```

### 12.4 Notification status

```
QUEUED ─ channel.send() ─► SENT ─── provider callback ──► DELIVERED
   │
   └─ send() throws ──► FAILED  (errorReason stored, can be retried)
```

### 12.5 Idempotency keys (`dedupeKey`)

| Notification type        | Dedupe key format                                  |
| ------------------------ | -------------------------------------------------- |
| `REGISTRATION_ENROLLED`  | `registration:{participantId}:{outcome}`           |
| `WAITLIST_OFFER`         | `waitlist-offer:{waitlistId}:{offerToken}`         |
| `FEE_INVOICE`            | `fee-invoice:{invoiceId}`                          |
| `PAYMENT_REMINDER`       | `payment-reminder:{invoiceId}:{waveLabel}`         |
| `PAYMENT_CONFIRM`        | `payment-confirm:{paymentId}`                      |

Re-issuing a payment link (or re-running a cron) is therefore safe —
the dedupe key suppresses duplicates.

---

## 13. Reporting & Dashboards

All under `/api/v1/reports/*`. LOCATION_MANAGER is auto-pinned to
their own location (any `locationId` query param is overridden).

| Endpoint                         | Purpose                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /reports/dashboard`         | Counts (ACTIVE, INQUIRY, DOCUMENTS_PENDING, FEE_PENDING) + per-location capacity utilisation snapshot.    |
| `GET /reports/fees?...`          | Aggregated invoice/payment totals per period, with breakdown by status (PENDING, PAID, OVERDUE, CANCELLED). |
| `GET /reports/funnel?...`        | Conversion funnel: registrations → docs verified → fees paid → ACTIVE.                                    |
| `GET /reports/revenue?...`       | Time-series revenue from COMPLETED payments, grouped by day / week / month.                               |
| `GET /reports/capacity?...`      | Per-session occupancy vs capacity, including waitlist size.                                               |

All accept date range filters (`from`, `to`) and optional `locationId`.
Returns JSON ready for charting.

---

## 14. API Keys & Partner Integration

### 14.1 Issue

`POST /api/v1/api-keys` (SUPER_ADMIN):

```json
{
  "label": "HRIS integration",
  "scopes": ["participants:read", "enrolments:read"],
  "rateLimit": 500
}
```

Response (**plaintext shown ONCE — never recoverable**):

```json
{
  "id": "...",
  "plaintext": "nm_<48-hex-chars>",
  "label": "HRIS integration",
  "scopes": ["participants:read", "enrolments:read"],
  "rateLimit": 500,
  "createdAt": "..."
}
```

### 14.2 Storage

Plaintext is **HMAC-SHA256-hashed** with `API_KEY_SECRET` before
storage. A DB leak alone never yields usable keys.

### 14.3 Usage

```
GET /api/v1/participants
x-api-key: nm_abcdef...
```

`JwtOrApiKeyGuard`:
1. Hash the supplied key with the same secret.
2. Look up by hash, ensure `revokedAt IS NULL`.
3. Enforce per-key rate limit via Redis ZSET (default 1000 req/hour
   sliding window).
4. Build a synthetic principal `{ tenantId, scopes, rateLimit }`.
5. `RequireScopesGuard` checks the route's required scope against
   `scopes[]`. Wildcard `*` matches anything.

### 14.4 Revoke

`DELETE /api/v1/api-keys/:id` — soft-sets `revokedAt`. Never hard-
deleted because the audit chain references the key id.

### 14.5 Scope naming convention

`<resource>:<verb>` where `verb ∈ { read, write, admin }`:
`participants:read`, `payments:write`, `enrolments:read`, `*`, etc.

---

## 15. Audit Chain (Tamper Detection)

`AuditChainService.write` creates an `AuditLog` row whose `hashSelf`
SHA-256-chains to the previous row's `hashSelf` (per tenant).

```
row[N].hashSelf = SHA256(
    row[N].id || tenantId || userId || action || resource || resourceId
    || JSON(beforeState) || JSON(afterState) || ipAddress || createdAt
    || row[N-1].hashSelf
)
```

### 15.1 What gets audited

Every domain action that changes state writes an AuditLog:
- Login (success / failure)
- Status transitions (participant, enrolment, session, invoice, payment, document)
- Fee overrides
- Payment verify / reject
- Auto-promotion
- API key create / revoke

### 15.2 Verification

`GET /api/v1/audit/verify?tenantId=...` walks the tenant's chain in
`createdAt` order and recomputes every `hashSelf`. A mismatch returns
the offending row id + expected vs actual hash.

Legacy rows (pre-Plan-J, `hashSelf = NULL`) are skipped — chain
verification begins at the first row that has `hashSelf` set.

---

## 16. Cron Processors Summary

| Processor                    | Schedule              | Enable flag                            | What it does                                                                                                                       |
| ---------------------------- | --------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `SessionAutoStatusProcessor` | every 30 minutes      | `app.sessionAutoStatusEnabled`         | DRAFT → OPEN at `enrolOpenAt`, OPEN → CLOSED at `enrolCloseAt`. Writes AuditLog per transition.                                     |
| `WaitlistProcessor.promoteVacancies` | every 30 seconds | `app.waitlistProcessorEnabled`       | Scans `(session, location)` tuples with active waitlist rows + open seats; issues offers via `tryPromoteNext`.                       |
| `WaitlistProcessor.expireOffers`     | every 5 minutes  | `app.waitlistProcessorEnabled`       | Flips PENDING offers past deadline → EXPIRED, re-runs `tryPromoteNext` for affected tuples.                                          |
| `WebhookProcessor`           | every minute          | `app.paymentWebhookProcessorEnabled`   | Batches up to 50 unprocessed `cm_payment_webhook_events`, verifies signatures, applies via `PaymentsService.applyGatewayResult`.   |
| `PaymentReminderProcessor`   | every hour            | `app.paymentReminderEnabled`           | For each active tenant: fires payment reminders for waves `[7, 1, 0, -3, -7]` days from due-date (skip invoices with no link).      |

All cron jobs are **idempotent** and **non-reentrant** (NestJS Schedule
won't re-enter a still-running cron).

---

## 17. Status Enum Reference

### Participant

| Status              | Meaning                                                  |
| ------------------- | -------------------------------------------------------- |
| `INQUIRY`           | Walk-in / form-only; no enrolment yet                    |
| `DOCUMENTS_PENDING` | Enrolled but required docs not yet all VERIFIED          |
| `FEE_PENDING`       | Docs OK; outstanding fee balance > threshold             |
| `ACTIVE`            | Eligible to attend                                       |
| `ON_HOLD`           | Temporarily paused (medical, disciplinary)               |
| `COMPLETED`         | Their session ended                                      |
| `WITHDRAWN`         | Permanently withdrawn                                    |

### Session

`DRAFT → OPEN → CLOSED → ARCHIVED` (strict, one-way).

### Enrolment

`WAITLISTED | DOCUMENTS_PENDING | FEE_PENDING | ACTIVE | ON_HOLD | COMPLETED | WITHDRAWN`

### Invoice

`PENDING | PAID | OVERDUE | CANCELLED`

### Payment

`PENDING | COMPLETED | FAILED | REFUNDED | PENDING_VERIFICATION`

### Document

`PENDING | VERIFIED | REJECTED`

### Waitlist offer

`PENDING | ACCEPTED | DECLINED | EXPIRED`

### Notification

`QUEUED | SENT | DELIVERED | FAILED`

### Payment gateway

`OFFLINE | MOYASAR | PAYTABS | HYPERPAY`

### Payment method

`CASH | BANK_TRANSFER | ONLINE_CARD | APPLE_PAY | MADA | STC_PAY`

---

## 18. End-to-End Worked Example

> **Scenario**: Sara wants to enrol her son Omar in the Riyadh Summer
> Football Camp. The camp has 20 seats; 19 are already taken.

### Step 1 — Guardian opens the QR

Sara scans the QR code at the Riyadh branch:

```
GET https://app/register/neomora/riyadh-olaya
```

Frontend hits:

```
GET /api/v1/registration/form/riyadh-olaya
```

→ returns the location + the list of OPEN sessions including "Summer
Football Camp" with 3 payment plans (FULL, MONTHLY, SEASONAL).

### Step 2 — Submit the form

```
POST /api/v1/registration/form/riyadh-olaya
{
  tenantSlug: "neomora",
  sessionId: "sess_summer_football",
  paymentPlanType: "MONTHLY",
  firstNameEn: "Omar", lastNameEn: "Alharbi", dob: "2014-04-12",
  gender: "MALE", preferredLang: "en",
  guardian: { fullName: "Sara Alharbi", phone: "+9665...", email: "..." }
}
```

Server-side:

1. Resolve tenant + location + verify session is OPEN.
2. Create Participant `P-000847` at `INQUIRY`.
3. Create Guardian `Sara Alharbi`.
4. **Allocator with advisory lock**:
   - `pg_advisory_xact_lock(hashtext(sess_summer_football), hashtext(loc_riyadh_olaya))`
   - Count occupied: 19. Capacity: 20. → **20th seat available**.
   - Create Enrolment at `FEE_PENDING`.
   - Promote Participant → `FEE_PENDING`.
5. Generate Monthly invoices: e.g., INV-NEM-001234, INV-NEM-001235, INV-NEM-001236 (3 months).
6. COMMIT.
7. Post-commit: enqueue `REGISTRATION_ENROLLED` WhatsApp to Sara
   (dedupe `registration:P-000847:ENROLLED`).

Returns `{ participantId, uniqueId: "P-000847", outcome: "ENROLLED", enrolmentId }`.

### Step 3 — Guardian receives invoice link

Finance issues a payment link for the first month's invoice:

```
POST /api/v1/invoices/INV-NEM-001234/payment-link
```

`PaymentLinkService`:
- Loads invoice + guardian.
- Ensures Sara has a 1-year `portalToken`.
- Calls the tenant's gateway (e.g., Moyasar) → returns checkout URL.
- Persists `Invoice.paymentLink`.
- Enqueues `FEE_INVOICE` notification (dedupe `fee-invoice:INV-NEM-001234`).

Sara gets a WhatsApp with the link.

### Step 4 — Sara pays online

Sara opens the link, completes card payment on Moyasar. Moyasar
POSTs to `/api/v1/payments/webhooks/moyasar` with the success payload.
Webhook controller inserts a row into `cm_payment_webhook_events` and
returns 200 immediately.

### Step 5 — WebhookProcessor cron (within 60s)

```
1. Reads unprocessed event.
2. MoyasarStrategy.verifySignature(payload, headers) → OK.
3. MoyasarStrategy.parsePayload(payload) → {
     gatewayRef: "pay_xyz", amount: 1500, status: COMPLETED,
     enrolmentId, invoiceId
   }
4. PaymentsService.applyGatewayResult(...):
   - Insert/update Payment at COMPLETED.
   - recomputeBalance: balance was 4500 (3 months) → now 3000.
   - Invoice 001234 fully covered → status PAID.
5. Run onVerified hooks:
   - ReceiptHookService → generate PDF, store, set receiptKey.
   - Notifications → PAYMENT_CONFIRM WhatsApp.
   - AutoPromotionService → balance 3000 > threshold 0 → DON'T promote.
6. Mark event processed.
```

### Step 6 — Sara uploads docs

```
POST /api/v1/documents/upload  (multipart)
  participantId, docType: BIRTH_CERTIFICATE, file
POST /api/v1/documents/upload
  participantId, docType: ID_PHOTO, file
```

Each lands at PENDING.

### Step 7 — Staff verifies

```
PATCH /api/v1/documents/doc_birth/verify  { status: "VERIFIED" }
PATCH /api/v1/documents/doc_id/verify     { status: "VERIFIED" }
```

After the second verify, `DocumentsService.maybeAdvanceParticipantStatus`
runs:

- Verified types now contain both `BIRTH_CERTIFICATE` and `ID_PHOTO`.
- Participant was `FEE_PENDING` (not `DOCUMENTS_PENDING`) → no change
  to participant status from this branch.

But Omar is still FEE_PENDING because balance is 3000. He attends as
"FEE_PENDING" until Sara pays the next invoice.

### Step 8 — Sara pays month 2

Same as Step 5. After verify:
- Balance: 3000 → 1500.
- AutoPromotionService runs: balance 1500 > 0 → still no promote.

### Step 9 — Sara pays month 3

After verify:
- Balance: 1500 → 0.
- AutoPromotionService:
  - balance 0 ≤ threshold 0 ✓
  - VERIFIED docs > 0 ✓
  - **Promote**: Enrolment → ACTIVE, Participant → ACTIVE.
  - AuditLog: `AUTO_PROMOTED_TO_ACTIVE`.
- Notifications fire `PAYMENT_CONFIRM`.

Omar is now officially ACTIVE in the system. 🎉

### Step 10 — Meanwhile, the 21st guardian (Khaled) submits the form

```
POST /registration/form/riyadh-olaya  { ... sessionId: sess_summer_football }
```

Allocator:
- Capacity 20, occupied 20.
- Create Waitlist row at position 1, offerStatus PENDING.
- Outcome: `WAITLISTED` (returns position 1).

Khaled gets a `REGISTRATION_WAITLISTED` notification with his
position.

### Step 11 — A seat opens (Omar's brother withdraws)

Staff calls `PATCH /enrolments/:id/status { status: "WITHDRAWN" }`.

Within 30 seconds, `WaitlistProcessor.promoteVacancies`:
- `(neomora, sess_summer_football, loc_riyadh_olaya)` has active
  waitlist row + open seat.
- `tryPromoteNext`:
  - Capacity check passes (occupied 19 < 20).
  - No outstanding offer.
  - Pick Khaled (position 1, attempts 0).
  - Mint offerToken (32 hex), expires in 48h.
  - Enqueue `WAITLIST_OFFER` WhatsApp.

Khaled clicks accept:

```
POST /api/v1/waitlist/offers/accept
{ token: "...", paymentPlanType: "FULL" }
```

Server:
- Validate token + expiry.
- Allocator (under advisory lock) → ENROLLED.
- Soft-delete waitlist row, mark ACCEPTED.
- Returns `{ status: "ACCEPTED", enrolmentId }`.

Khaled is now `FEE_PENDING`, and the cycle continues.

---

## Appendix — Module Index

| Module           | Service entry point                        | Notable cron                          |
| ---------------- | ------------------------------------------ | ------------------------------------- |
| auth             | `auth.service.ts`                          | —                                     |
| guardian-auth    | `guardian-auth.service.ts`                 | —                                     |
| users            | `users.service.ts`                         | —                                     |
| tenants          | `tenants.service.ts`                       | —                                     |
| locations        | `locations.service.ts`                     | —                                     |
| sessions         | `sessions.service.ts`                      | `session-auto-status` (30m)           |
| registration     | `registration.service.ts`                  | —                                     |
| participants     | `participants.service.ts`                  | —                                     |
| enrolments       | `enrolments.service.ts` + `enrolment-allocator.service.ts` | —                |
| documents        | `documents.service.ts`                     | —                                     |
| fees             | `fees.service.ts`                          | —                                     |
| payments         | `payments.service.ts` + `payment-link.service.ts` | `webhook-processor` (1m), `payment-reminder` (1h) |
| auto-promotion   | `auto-promotion.service.ts`                | (hook-triggered)                      |
| waitlist         | `waitlist.service.ts`                      | `waitlist-promote` (30s), `waitlist-expire-offers` (5m) |
| notifications    | `notifications.service.ts`                 | —                                     |
| reporting        | `reporting.service.ts`                     | —                                     |
| api-keys         | `api-keys.service.ts`                      | —                                     |
| audit            | `audit-chain.service.ts`                   | —                                     |

---

## Glossary

- **Tenant** — a school/club organisation. All data is partitioned by `tenantId`.
- **Location** — a physical branch under a tenant; carries `capacity`.
- **Session** — a programme/class under a location (or tenant-wide); has dates, enrolment window, and capacity that may shadow location.capacity.
- **Enrolment** — the join row between Participant and Session (with status, balance, paymentPlanType).
- **Invoice** — a billable amount on an enrolment (one per period for monthly plans).
- **Payment** — a money transfer event (offline or online), idempotent via `idempotencyKey`.
- **Waitlist** — ordered queue per `(session, location)` of participants who didn't fit at registration time.
- **API key** — partner credential (`nm_<48 hex>`), HMAC-stored, scoped, rate-limited.
- **Magic link** — 32-byte token sent to a guardian for passwordless login (15-min TTL).
- **Portal token** — long-lived (1y) Guardian token embedded in payment links so guardians don't have to re-authenticate on each invoice email.

---

_Last updated: alongside `API_DOCUMENTATION.md` and the auto-generated
Postman collection. To regenerate the Postman collection after API
changes, run `node scripts/build-postman.js`._
