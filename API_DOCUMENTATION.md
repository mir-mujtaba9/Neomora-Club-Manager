# Neomora Club Manager — API Documentation

Complete reference of every HTTP endpoint exposed by the Neomora Club Manager backend. Use this together with the companion Postman collection (`neomora-api.postman_collection.json`).

> Tip — A live Swagger UI is also available at `GET /api/docs` whenever the server is running.

---

## 1. Conventions

### Base URL
```
http://localhost:3000/api/v1
```
> All routes are prefixed by `/api` (global prefix) and `/v1` (URI versioning). In production swap the host but keep the path.

### Content type
Unless explicitly stated otherwise, every request / response body uses:
```
Content-Type: application/json
```

File-upload endpoints use:
```
Content-Type: multipart/form-data
```

### Locale / i18n
Validation messages support English (default) and Arabic. Send:
```
Accept-Language: ar
```
to receive Arabic error messages. Omit or set `en` (or anything else) for English.

### Authentication
There are **three** independent authentication mechanisms:

| Mechanism | Header | Issued by | Used by |
|-----------|--------|-----------|---------|
| **Staff JWT (Bearer)** | `Authorization: Bearer <accessToken>` | `POST /auth/login` | Web/mobile dashboard for staff and admins |
| **Guardian JWT (Bearer)** | `Authorization: Bearer <accessToken>` | `POST /guardian-auth/verify` | Guardian/participant portal |
| **API key (machine‑to‑machine)** | `x-api-key: <plaintext>` | `POST /api-keys` (SUPER_ADMIN) | Partner integrations, read‑only scopes |

Routes annotated below as `Auth: JWT` accept the staff Bearer token. Routes annotated `Auth: JWT or API key` (typically the F‑35 partner-readable endpoints) additionally accept a valid `x-api-key`. Public routes are marked `Auth: Public`.

#### Role-based access (RBAC)
The roles enum is:

```
SUPER_ADMIN | LOCATION_MANAGER | FINANCE_OFFICER | STAFF
```

A `403 Forbidden` is returned if the caller's role is not in the route's allow-list. `LOCATION_MANAGER` accounts are auto-scoped to their own location on most list endpoints (the service silently overrides any `locationId` query parameter).

#### API‑key scopes
Scopes follow `<resource>:<verb>`, e.g. `participants:read`, `sessions:read`, `payments:read`, `locations:read`. The wildcard `*` grants all read endpoints (issue sparingly).

### Tenant context
The tenant is **never** sent on the wire by the caller — it is derived server-side from the JWT (`tenantId` claim) or the API key. The only places you supply a `tenantSlug` are the login / forgot-password / magic-link / public registration routes (since the JWT hasn't been issued yet).

### Pagination
List endpoints accept:
- `page` — default `1`, min `1`
- `limit` — default `20`, max `100`

Responses follow this shape:
```json
{
  "items": [ /* … */ ],
  "total": 123,
  "page": 1,
  "limit": 20
}
```

### Errors
A unified error envelope is returned for all 4xx/5xx responses:
```json
{
  "statusCode": 400,
  "message": "validation message or array",
  "error": "Bad Request"
}
```

Validation failures produce a 400 with a `message` array enumerating each invalid field.

### Rate limiting
- Auth login: 5 wrong-password attempts → account is locked for 15 minutes.
- API keys: per-key sliding-window throttle, default **1000 req / hour** (configurable per key, `0` = unlimited).

---

## 2. Auth — Staff `/auth`

### 2.1 Login
- **URL** `POST /auth/login`
- **Auth** Public
- **Body**
  ```json
  {
    "tenantSlug": "main-club",
    "email": "admin@example.com",
    "password": "password123",
    "totpCode": "123456"
  }
  ```
  `totpCode` is **required only when** the account has `totpEnabled=true`. Must be exactly 6 digits.
- **Response 200**
  ```json
  {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "user":   { "id": "uuid", "email": "...", "role": "SUPER_ADMIN", "locationId": null, ... },
    "tenant": { "id": "uuid", "slug": "main-club", "name": "Main Club" }
  }
  ```
- **Errors** `401` invalid credentials / invalid TOTP · `403` account locked · `404` tenant slug not found.

### 2.2 Refresh tokens
- **URL** `POST /auth/refresh`
- **Auth** Public
- **Body** `{ "refreshToken": "<refresh>" }`
- **Response 200** Same shape as Login. Rotates both tokens — the old refresh token is invalidated.

### 2.3 Current user
- **URL** `GET /auth/me`
- **Auth** JWT
- **Response 200** Full user + tenant profile.

### 2.4 Logout
- **URL** `POST /auth/logout`
- **Auth** JWT
- **Body** (optional)
  ```json
  { "refreshToken": "<refresh>" }
  ```
  - With a body → revokes only that one session.
  - Without a body → revokes **all** active sessions for this user in this tenant.

### 2.5 Switch tenant
- **URL** `POST /auth/switch-tenant`
- **Auth** JWT — `SUPER_ADMIN` only
- **Body** (provide either)
  ```json
  { "tenantId": "uuid" }
  ```
  ```json
  { "tenantSlug": "secondary-club" }
  ```
- **Response 200** A fresh token pair scoped to the target tenant.

### 2.6 2FA — Begin enrolment
- **URL** `POST /auth/2fa/setup`
- **Auth** JWT
- **Response 200**
  ```json
  { "secret": "JBSWY3DPEHPK3PXP", "otpauthUrl": "otpauth://totp/..." }
  ```
  Scan `otpauthUrl` in Google Authenticator / 1Password, then call `/auth/2fa/enable`.

### 2.7 2FA — Activate
- **URL** `POST /auth/2fa/enable`
- **Auth** JWT
- **Body** `{ "code": "123456" }` (6 digits from the authenticator app)

### 2.8 2FA — Disable
- **URL** `POST /auth/2fa/disable`
- **Auth** JWT
- **Body**
  ```json
  { "code": "123456", "password": "currentPassword" }
  ```
  Both the TOTP code **and** the current password are required (defends against hijacked sessions).

### 2.9 Forgot password
- **URL** `POST /auth/forgot-password`
- **Auth** Public
- **Body** `{ "tenantSlug": "main-club", "email": "user@example.com" }`
- **Response 200** Always returns 200 regardless of whether the email matches (anti-enumeration).

### 2.10 Reset password
- **URL** `POST /auth/reset-password`
- **Auth** Public
- **Body** `{ "token": "<emailed-token>", "newPassword": "minLength8" }`
- Single-use, 1-hour TTL. Successful reset revokes **all** active refresh tokens for the user.

---

## 3. Guardian Auth — `/guardian-auth`

Passwordless authentication for guardians/participants via magic links (email / WhatsApp).

### 3.1 Request magic link
- **URL** `POST /guardian-auth/request-link`
- **Auth** Public
- **Body**
  ```json
  {
    "tenantSlug": "main-club",
    "email": "parent@example.com",
    "phone": "+9665XXXXXXXX"
  }
  ```
  At least one of `email` or `phone` must be present.
- **Response 200** `{ "message": "If an account exists, a link has been sent." }`

### 3.2 Verify magic link
- **URL** `POST /guardian-auth/verify`
- **Auth** Public
- **Body** `{ "token": "<magic-link-token>" }`
- **Response 200**
  ```json
  {
    "accessToken": "...",
    "guardian": { "id": "uuid", "fullName": "...", "phone": "...", ... }
  }
  ```

### 3.3 Guardian profile
- **URL** `GET /guardian-auth/me`
- **Auth** JWT (Guardian session only — staff sessions return an error)

---

## 4. API Keys — `/api-keys`

`SUPER_ADMIN` only. Manage partner integration credentials.

### 4.1 Issue an API key
- **URL** `POST /api-keys`
- **Auth** JWT (SUPER_ADMIN)
- **Body**
  ```json
  {
    "label": "Acme Analytics integration",
    "scopes": ["participants:read", "sessions:read"],
    "rateLimit": 1000
  }
  ```
  - `scopes` — array of `<resource>:<verb>` strings or the wildcard `*`.
  - `rateLimit` — requests / hour. `0` = unlimited. Default `1000`.
- **Response 201**
  ```json
  {
    "id": "uuid",
    "label": "Acme Analytics integration",
    "scopes": ["participants:read", "sessions:read"],
    "rateLimit": 1000,
    "plaintext": "nm_live_xxxxxxxxxxxxxxxx"
  }
  ```
  > `plaintext` is shown **once**. The DB stores only the HMAC-SHA256 hash.

### 4.2 List API keys
- **URL** `GET /api-keys`
- **Auth** JWT (SUPER_ADMIN)
- Returns metadata only — never plaintext.

### 4.3 Revoke an API key
- **URL** `DELETE /api-keys/:id`
- **Auth** JWT (SUPER_ADMIN)
- Soft delete via `revokedAt`. The key stops working on the next request.

---

## 5. Users — `/users`

Manage staff accounts. All routes require `SUPER_ADMIN`.

### 5.1 Create user
- **URL** `POST /users`
- **Auth** JWT (SUPER_ADMIN)
- **Body**
  ```json
  {
    "name": "Optional Name",
    "email": "newstaff@example.com",
    "password": "min8chars",
    "role": "STAFF",
    "locationId": "uuid-required-if-role=LOCATION_MANAGER"
  }
  ```
  `role` ∈ `SUPER_ADMIN | LOCATION_MANAGER | FINANCE_OFFICER | STAFF`. `locationId` is required when `role=LOCATION_MANAGER`.

### 5.2 List users
- **URL** `GET /users`
- **Auth** JWT (SUPER_ADMIN)
- **Query** `role`, `locationId`, `page`, `limit`

### 5.3 Get user
- **URL** `GET /users/:id`
- **Auth** JWT (SUPER_ADMIN)

### 5.4 Update user
- **URL** `PATCH /users/:id`
- **Auth** JWT (SUPER_ADMIN)
- **Body** (any subset)
  ```json
  { "role": "STAFF", "locationId": "uuid" }
  ```

### 5.5 Delete user
- **URL** `DELETE /users/:id`
- **Auth** JWT (SUPER_ADMIN)
- Soft delete via `deletedAt`.

---

## 6. Locations — `/locations`

### 6.1 Create location
- **URL** `POST /locations`
- **Auth** JWT (SUPER_ADMIN)
- **Body**
  ```json
  {
    "name": "Westside Club",
    "city": "Riyadh",
    "address": "123 King Fahd Rd",
    "phone": "+9661XXXXXXX",
    "capacity": 100
  }
  ```

### 6.2 List locations
- **URL** `GET /locations`
- **Auth** JWT **or** API key (scope `locations:read`)
- **Query** `status` (`active` | `inactive` | `maintenance`), `city`, `search`, `page`, `limit`
- `LOCATION_MANAGER` is auto-scoped to their own location.

### 6.3 Update location
- **URL** `PATCH /locations/:id`
- **Auth** JWT (SUPER_ADMIN or LOCATION_MANAGER)
- **Body** (any subset)
  ```json
  {
    "name": "Westside Premium",
    "address": "...",
    "city": "...",
    "phone": "...",
    "email": "...",
    "capacity": 120,
    "status": "active",
    "amenities": ["pool", "gym"]
  }
  ```

### 6.4 Regenerate registration QR
- **URL** `POST /locations/:id/regenerate-qr`
- **Auth** JWT (SUPER_ADMIN or LOCATION_MANAGER)
- Rotates the slug used in the public registration URL.

### 6.5 Public registration config (used by the QR landing page)
- **URL** `GET /locations/:slug/register`
- **Auth** Public
- Returns the location info + the list of OPEN sessions for the public registration form.

---

## 7. Sessions — `/sessions`

### 7.1 Create session
- **URL** `POST /sessions`
- **Auth** JWT (SUPER_ADMIN)
- **Body**
  ```json
  {
    "name": "Summer 2026",
    "startDate": "2026-06-01",
    "endDate": "2026-08-31",
    "baseFee": 1500.00,
    "enrolOpenAt":  "2026-04-01T00:00:00Z",
    "enrolCloseAt": "2026-05-31T23:59:59Z",
    "status": "DRAFT",
    "locations": [
      { "locationId": "uuid", "feeOverride": 1200.00 }
    ]
  }
  ```
  `status` ∈ `DRAFT | OPEN | CLOSED | ARCHIVED`.

### 7.2 List sessions
- **URL** `GET /sessions`
- **Auth** JWT **or** API key (scope `sessions:read`)
- **Query** `status`, `locationId`, `dateFrom`, `dateTo`, `page`, `limit`
- Each item includes `durationDays` (inclusive of start and end day).

### 7.3 Update session status
- **URL** `PATCH /sessions/:id/status`
- **Auth** JWT (SUPER_ADMIN)
- **Body** `{ "status": "OPEN" }`

### 7.4 Add payment plan
- **URL** `POST /sessions/:id/payment-plans`
- **Auth** JWT (SUPER_ADMIN)
- **Body**
  ```json
  {
    "type": "MONTHLY",
    "instalmentCount": 3,
    "instalmentAmount": 500.00,
    "dueDates": ["2026-06-15", "2026-07-15", "2026-08-15"]
  }
  ```
  `type` ∈ `FULL | MONTHLY | SEASONAL`.

---

## 8. Participants — `/participants`

### 8.1 Register a participant (public)
- **URL** `POST /participants/register`
- **Auth** Public
- **Body** see [Section 17.2](#172-submit-registration-form) — the payload is the same as the public form but uses `locationSlug` in the body instead of the URL.
  ```json
  {
    "sessionId": "uuid-optional",
    "locationSlug": "westside",
    "firstNameEn": "Ahmed",
    "firstNameAr": "أحمد",
    "lastNameEn": "Khan",
    "lastNameAr": "خان",
    "dateOfBirth": "2015-04-12",
    "gender": "MALE",
    "phone": "+9665XXXXXXXX",
    "nationality": "SA",
    "preferredLang": "ar",
    "guardian": {
      "fullName": "Father Khan",
      "relationship": "father",
      "phone": "+9665XXXXXXXX",
      "email": "father@example.com"
    }
  }
  ```
  `gender` ∈ `MALE | FEMALE`.

### 8.2 List participants
- **URL** `GET /participants`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER / FINANCE_OFFICER / STAFF) **or** API key (`participants:read`)
- **Query** `status`, `locationId`, `sessionId`, `paymentPlanType` (`FULL|MONTHLY|SEASONAL`), `dateFrom`, `dateTo`, `search` (uniqueId / phone / name), `sortBy` (default `createdAt`), `order` (`asc|desc`), `page`, `limit`, `export=csv`
- `?export=csv` returns a CSV download (`Content-Type: text/csv`).

### 8.3 Get participant (360° profile)
- **URL** `GET /participants/:id`
- **Auth** JWT (staff roles) **or** API key (`participants:read`)
- Returns participant + guardians + enrolments (with `paymentSummary`) + documents + staff notes, ordered most recent first.

### 8.4 Update participant status
- **URL** `PATCH /participants/:id/status`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER / FINANCE_OFFICER)
- **Body**
  ```json
  { "status": "ACTIVE", "reason": "optional audit note" }
  ```
  `status` ∈ `INQUIRY | DOCUMENTS_PENDING | FEE_PENDING | ACTIVE | ON_HOLD | COMPLETED | WITHDRAWN`.

### 8.5 List staff notes
- **URL** `GET /participants/:id/staff-notes`
- **Auth** JWT (any staff role)

### 8.6 Add staff note
- **URL** `POST /participants/:id/staff-notes`
- **Auth** JWT (any staff role)
- **Body** `{ "note": "Followed up on Sunday — paid in cash." }`

### 8.7 Delete staff note
- **URL** `DELETE /participants/:id/staff-notes/:noteId`
- **Auth** JWT (any staff role)

### 8.8 Status history
- **URL** `GET /participants/:id/status-history`
- **Auth** JWT (any staff role)

### 8.9 Re-enrol (convenience)
- **URL** `POST /participants/:id/re-enrol`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER / STAFF)
- **Query** `allowOverlap=true` (SUPER_ADMIN / FINANCE_OFFICER only)
- **Body**
  ```json
  { "sessionId": "uuid", "paymentPlanType": "MONTHLY" }
  ```
  Looks up the participant's most recent enrolment and delegates to `EnrolmentsService.reEnrol`.

---

## 9. Enrolments — `/enrolments`

### 9.1 List enrolments
- **URL** `GET /enrolments`
- **Auth** JWT (any authenticated staff role)
- **Query** `sessionId`, `locationId`, `status` (`WAITLISTED|DOCUMENTS_PENDING|FEE_PENDING|ACTIVE|ON_HOLD|COMPLETED|WITHDRAWN`), `page`, `limit`

### 9.2 Create enrolment
- **URL** `POST /enrolments`
- **Auth** JWT (LOCATION_MANAGER / SUPER_ADMIN)
- **Query** `allowOverlap=true` (SUPER_ADMIN / FINANCE_OFFICER only — bypasses the date-overlap guard)
- **Body**
  ```json
  {
    "participantId": "uuid",
    "sessionId":     "uuid",
    "locationId":    "uuid",
    "paymentPlanType": "MONTHLY"
  }
  ```

### 9.3 Re-enrol (by previous enrolment id)
- **URL** `POST /enrolments/:id/re-enrol`
- **Auth** JWT (LOCATION_MANAGER / SUPER_ADMIN)
- **Query** `allowOverlap=true` (SUPER_ADMIN / FINANCE_OFFICER only)
- **Body**
  ```json
  { "sessionId": "uuid", "paymentPlanType": "FULL" }
  ```

---

## 10. Fees — `/enrolments/:enrolmentId/...`

Staff-facing fee/invoice routes (note the path lives under `/enrolments`).

### 10.1 Create payment plan + invoices for an enrolment
- **URL** `POST /enrolments/:enrolmentId/payment-plan`
- **Auth** JWT (SUPER_ADMIN / FINANCE_OFFICER / LOCATION_MANAGER)
- **Body**
  ```json
  { "planType": "MONTHLY", "instalmentCount": 3 }
  ```
  `instalmentCount` is required for `MONTHLY` / `SEASONAL`, ignored for `FULL` (forced to 1).

### 10.2 List invoices for an enrolment
- **URL** `GET /enrolments/:enrolmentId/invoices`
- **Auth** JWT (any authenticated staff role)

### 10.3 Set / clear fee override
- **URL** `PATCH /enrolments/:enrolmentId/fee-override`
- **Auth** JWT (SUPER_ADMIN / FINANCE_OFFICER)
- **Body**
  ```json
  { "amount": 1200.00, "reason": "Family discount" }
  ```
  Pass `"amount": null` to clear the override.

---

## 11. Invoices — `/invoices`

### 11.1 Issue (or refresh) a payment link
- **URL** `POST /invoices/:id/payment-link`
- **Auth** JWT (SUPER_ADMIN / FINANCE_OFFICER / LOCATION_MANAGER)
- Generates a checkout URL and notifies the guardian. Safe to call repeatedly — the stored link is reused while valid.

---

## 12. Payments — `/payments`

### 12.1 Upload proof of payment
- **URL** `POST /payments/proof-upload`
- **Auth** JWT (SUPER_ADMIN / FINANCE_OFFICER / LOCATION_MANAGER)
- **Content-Type** `multipart/form-data`
- **Form fields**
  - `file` — file ≤ 10 MB
  - `enrolmentId` — UUID
- **Response 200** `{ "storageKey": "proofs/<tenant>/<enrolment>/<file>" }`

### 12.2 Record an offline payment
- **URL** `POST /payments/offline`
- **Auth** JWT (SUPER_ADMIN / FINANCE_OFFICER / LOCATION_MANAGER)
- **Body**
  ```json
  {
    "enrolmentId": "uuid",
    "invoiceId":   "uuid-optional",
    "method":      "CASH",
    "amount":      500.00,
    "proofKey":    "proofs/<tenant>/<enrolment>/<file>",
    "idempotencyKey": "unique-string-per-attempt",
    "note": "optional"
  }
  ```
  `method` ∈ `ONLINE_CARD | SADAD | MADA | BANK_TRANSFER | CASH`. The new row enters `PENDING_VERIFICATION`.

### 12.3 Verify (mark COMPLETED)
- **URL** `POST /payments/:id/verify`
- **Auth** JWT (SUPER_ADMIN / FINANCE_OFFICER)

### 12.4 Reject
- **URL** `POST /payments/:id/reject`
- **Auth** JWT (SUPER_ADMIN / FINANCE_OFFICER)
- **Body** `{ "reason": "Wrong amount transferred" }` (optional, ≤ 500 chars)

### 12.5 List payments
- **URL** `GET /payments`
- **Auth** JWT **or** API key (scope `payments:read`)
- **Query** `enrolmentId`, `status` (`PENDING|COMPLETED|FAILED|REFUNDED|PENDING_VERIFICATION`), `gateway` (`MOYASAR|PAYTABS|HYPERPAY|OFFLINE`), `page`, `limit`
- `LOCATION_MANAGER` is auto-scoped to their location.

### 12.6 Get payment
- **URL** `GET /payments/:id`
- **Auth** JWT **or** API key (scope `payments:read`)

---

## 13. Payment Webhooks — `/webhooks/payments`

### 13.1 Receive gateway webhook
- **URL** `POST /webhooks/payments/:gateway`
- **Auth** Public (gateway provider authenticates via its own signed header — verified later by the WebhookProcessor cron)
- **Path** `:gateway` ∈ `moyasar | paytabs | hyperpay`
- **Body** Raw provider payload — persisted verbatim for audit / retry.
- **Response 200** Always `{ "received": true }`. Unknown gateways are still 200'd with a sentinel row created.

---

## 14. Documents — `/documents`

### 14.1 Upload document
- **URL** `POST /documents/:participantId`
- **Auth** JWT (LOCATION_MANAGER / SUPER_ADMIN)
- **Content-Type** `multipart/form-data`
- **Form fields**
  - `file` — file ≤ 10 MB
  - `docType` — one of `BIRTH_CERTIFICATE | PASSPORT | MEDICAL_CLEARANCE | ID_PHOTO | OTHER`
  - `notes` — optional string

### 14.2 Get signed download URL
- **URL** `GET /documents/:participantId/:docId/url`
- **Auth** JWT (any staff role)
- **Query** `disposition=inline|attachment` (default `inline`)
- **Response 200** `{ "url": "https://...", "expiresIn": 900 }` (15 minutes)

### 14.3 List documents for a participant
- **URL** `GET /documents/by-participant/:participantId`
- **Auth** JWT (any staff role)

### 14.4 Soft-delete document
- **URL** `DELETE /documents/:participantId/:docId`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER)

### 14.5 Verify / reject document
- **URL** `PATCH /documents/:docId/verify`
- **Auth** JWT (LOCATION_MANAGER / SUPER_ADMIN)
- **Body** `{ "status": "VERIFIED" }` or `{ "status": "REJECTED" }`
- If all REQUIRED documents become `VERIFIED`, the participant is auto-promoted from `DOCUMENTS_PENDING` → `FEE_PENDING`.

### 14.6 Local signed download (no‑S3 fallback)
- **URL** `GET /documents/download?key=<storageKey>&token=<hmac>&exp=<unix-ts>&disposition=inline|attachment`
- **Auth** Public — the HMAC signature in the URL **is** the credential.

---

## 15. Notifications — `/notifications`

Admin-only. Notifications are created server-side as side effects (registration, payment, enrolment changes). There is intentionally no public `POST /notifications`.

### 15.1 List notifications
- **URL** `GET /notifications`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER)
- **Query** `status` (`QUEUED|SENT|FAILED|DELIVERED`), `type` (e.g. `PAYMENT_CONFIRM`, `WAITLIST_OFFER`, …), `channel` (`WHATSAPP|EMAIL`), `participantId`, `recipientUserId`, `page`, `limit`

### 15.2 Get notification
- **URL** `GET /notifications/:id`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER)

### 15.3 Retry a failed notification
- **URL** `POST /notifications/:id/retry`
- **Auth** JWT (SUPER_ADMIN)

---

## 16. Waitlist — `/waitlist`

### 16.1 List waitlist (staff)
- **URL** `GET /waitlist`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER)
- **Query** `sessionId` (required, UUID), `locationId` (required, UUID)

### 16.2 Send waitlist offer (staff)
- **URL** `POST /waitlist/:id/offer`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER)
- Generates a single-use token and notifies the guardian.

### 16.3 Withdraw entry (staff)
- **URL** `DELETE /waitlist/:id`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER)

### 16.4 Accept offer (guardian)
- **URL** `POST /waitlist/accept`
- **Auth** Public — token in body
- **Body**
  ```json
  { "token": "<waitlist-offer-token>", "paymentPlanType": "MONTHLY" }
  ```

### 16.5 Decline offer (guardian)
- **URL** `POST /waitlist/decline`
- **Auth** Public
- **Body** `{ "token": "<waitlist-offer-token>" }`

### 16.6 Withdraw from waitlist (guardian)
- **URL** `POST /waitlist/withdraw`
- **Auth** Public
- **Body** `{ "token": "<waitlist-offer-token>" }`

---

## 17. Public Registration — `/register`

### 17.1 Get registration form config
- **URL** `GET /register/:slug`
- **Auth** Public
- Returns the location info and list of `OPEN` sessions for the form.

### 17.2 Submit registration form
- **URL** `POST /register/:slug`
- **Auth** Public
- **Body**
  ```json
  {
    "firstNameEn": "Ahmed",
    "firstNameAr": "أحمد",
    "lastNameEn":  "Khan",
    "lastNameAr":  "خان",
    "dateOfBirth": "2015-04-12",
    "gender":      "MALE",
    "phone":       "+9665XXXXXXXX",
    "nationality": "SA",
    "preferredLang": "ar",
    "sessionId":   "uuid-optional",
    "guardian": {
      "fullName":    "Father Khan",
      "relationship":"father",
      "phone":       "+9665XXXXXXXX",
      "email":       "father@example.com"
    }
  }
  ```
  `gender` ∈ `MALE | FEMALE`. When `sessionId` is omitted, the participant is created at status `INQUIRY` with no enrolment.

---

## 18. Guardian Portal — `/portal`

### 18.1 Get portal by token
- **URL** `GET /portal/:token`
- **Auth** Public — bearer-token-in-URL pattern (single use, signed)
- Returns the participant + enrolments + invoices visible to the guardian.

---

## 19. Reporting — `/reporting`

### 19.1 Dashboard summary
- **URL** `GET /reporting/dashboard`
- **Auth** JWT (any staff role)

### 19.2 Fees report
- **URL** `GET /reporting/fees`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER / FINANCE_OFFICER) — LM auto-scoped to their location.
- **Query** `sessionId`, `locationId`, `month` (`YYYY-MM`), `groupBy` (`location | session`, default `location`), `page`, `limit`

### 19.3 Funnel report
- **URL** `GET /reporting/funnel`
- **Auth** JWT (any staff role)
- **Query (all required for time bounds)** `startDate=YYYY-MM-DD`, `endDate=YYYY-MM-DD`, `sessionId` (optional)

### 19.4 Revenue report
- **URL** `GET /reporting/revenue`
- **Auth** JWT (SUPER_ADMIN / LOCATION_MANAGER / FINANCE_OFFICER)
- **Query** `year` (required, 2000–2100), `locationId` (optional)

### 19.5 Capacity utilisation (time-series)
- **URL** `GET /reporting/capacity-utilisation`
- **Auth** JWT (any staff role)
- **Query** `from=YYYY-MM-DD` (required), `to=YYYY-MM-DD` (required), `interval` (`day|week|month`, default `day`), `locationId` (optional). Maximum span is 366 buckets.

---

## 20. Audit — `/audit`

### 20.1 Verify audit chain
- **URL** `GET /audit/verify-chain`
- **Auth** JWT (SUPER_ADMIN)
- Walks every `AuditLog` row in `createdAt` order and recomputes SHA-256 hash links.
- **Response 200** `{ "ok": true, "checked": 1234 }` — chain intact.
- **Response 200** `{ "ok": false, "firstBadId": "uuid", "reason": "..." }` — tampering / insertion detected.

---

## 21. Quick start checklist for a fresh test

1. Make sure the server is running: `npm run start:dev` (default `http://localhost:3000`).
2. Confirm the tenant slug you'll log in against (defaults to `main-club` in seeds).
3. **POST /auth/login** with `tenantSlug + email + password` → copy `accessToken` and `refreshToken` into the Postman environment variables (the included collection does this automatically via test scripts).
4. **GET /auth/me** to confirm the token works.
5. Browse `GET /locations`, `GET /sessions`, `GET /participants` etc. as a sanity check.
6. To exercise partner-facing read endpoints: **POST /api-keys** with `["participants:read", "sessions:read", "payments:read", "locations:read"]` → set the `apiKey` variable in Postman → drop the `Authorization` header and add `x-api-key`.

Happy testing 🚀
