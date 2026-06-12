// Build the Postman collection JSON in memory and write to disk.
// Saves us hand-escaping ~2000 lines of JSON literals.
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'neomora-api.postman_collection.json');

// ─── helpers ──────────────────────────────────────────────────────────────
const bearer = () => ({
  type: 'bearer',
  bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
});
const guardianBearer = () => ({
  type: 'bearer',
  bearer: [{ key: 'token', value: '{{guardianToken}}', type: 'string' }],
});
const apiKeyHeader = () => ({
  key: 'x-api-key',
  value: '{{apiKey}}',
  type: 'text',
  description: 'Use INSTEAD of Authorization when calling as a partner integration.',
  disabled: true,
});
const langHeader = () => ({
  key: 'Accept-Language',
  value: 'en',
  type: 'text',
  description: 'Use "ar" to receive Arabic validation messages.',
  disabled: true,
});
const jsonBody = (raw) => ({
  mode: 'raw',
  raw,
  options: { raw: { language: 'json' } },
});
const url = (pathParts, query = []) => ({
  raw: '{{baseUrl}}/' + pathParts.join('/') + (query.length ? '?' + query.map(q => `${q.key}=${encodeURIComponent(String(q.value ?? ''))}`).join('&') : ''),
  host: ['{{baseUrl}}'],
  path: pathParts,
  query: query.length ? query.map(q => ({ key: q.key, value: String(q.value ?? ''), description: q.description, disabled: q.disabled !== false ? true : false })) : undefined,
});

// Build a request item.
// opts:
//   name, method, urlPath, query, body, auth, description, headers, event,
const item = (opts) => {
  const req = {
    method: opts.method,
    header: [
      langHeader(),
      ...(opts.auth === 'apiKey' ? [{ key: 'x-api-key', value: '{{apiKey}}', type: 'text' }] : []),
      ...(opts.auth === 'jwtOrApiKey' ? [apiKeyHeader()] : []),
      ...(opts.headers || []),
    ],
    url: url(opts.urlPath, opts.query || []),
    description: opts.description,
  };
  if (opts.body) req.body = opts.body;
  if (opts.auth === 'jwt' || opts.auth === 'jwtOrApiKey') req.auth = bearer();
  if (opts.auth === 'guardian') req.auth = guardianBearer();
  const result = { name: opts.name, request: req, response: [] };
  if (opts.event) result.event = opts.event;
  return result;
};

// ─── Auth folder ──────────────────────────────────────────────────────────
const authFolder = {
  name: '1. Auth (Staff)',
  description:
    'Staff login, refresh, profile, logout, switch tenant, 2FA, password reset.\n\n' +
    'The Login request automatically stores `accessToken` and `refreshToken` into the active environment.',
  item: [
    item({
      name: 'Login',
      method: 'POST',
      urlPath: ['auth', 'login'],
      body: jsonBody(JSON.stringify({
        tenantSlug: '{{tenantSlug}}',
        email: '{{staffEmail}}',
        password: '{{staffPassword}}',
      }, null, 2)),
      description:
        'POST /auth/login\n\n' +
        'Returns `{ accessToken, refreshToken, user, tenant }`.\n\n' +
        'When the user has `totpEnabled=true`, add `totpCode` (6 digits) to the body.\n\n' +
        '5 wrong-password attempts in a row lock the account for 15 minutes.',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              'const res = pm.response.json();',
              'if (res.accessToken) {',
              '    pm.environment.set("accessToken", res.accessToken);',
              '    pm.environment.set("refreshToken", res.refreshToken);',
              '    console.log("✔ accessToken + refreshToken saved");',
              '}',
            ],
          },
        },
      ],
    }),
    item({
      name: 'Login (with TOTP)',
      method: 'POST',
      urlPath: ['auth', 'login'],
      body: jsonBody(JSON.stringify({
        tenantSlug: '{{tenantSlug}}',
        email: '{{staffEmail}}',
        password: '{{staffPassword}}',
        totpCode: '123456',
      }, null, 2)),
      description: 'Same endpoint as Login — use when 2FA is enabled on the account. `totpCode` MUST be exactly 6 digits.',
    }),
    item({
      name: 'Refresh Tokens',
      method: 'POST',
      urlPath: ['auth', 'refresh'],
      body: jsonBody(JSON.stringify({ refreshToken: '{{refreshToken}}' }, null, 2)),
      description: 'Rotates both tokens. Saves the new pair to the environment.',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              'const res = pm.response.json();',
              'if (res.accessToken) {',
              '    pm.environment.set("accessToken", res.accessToken);',
              '    pm.environment.set("refreshToken", res.refreshToken);',
              '}',
            ],
          },
        },
      ],
    }),
    item({
      name: 'Me (Current User)',
      method: 'GET',
      urlPath: ['auth', 'me'],
      auth: 'jwt',
      description: 'Returns the profile of the currently-authenticated staff user.',
    }),
    item({
      name: 'Logout (this session)',
      method: 'POST',
      urlPath: ['auth', 'logout'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({ refreshToken: '{{refreshToken}}' }, null, 2)),
      description: 'With body → revokes only this session. Without body → revokes ALL sessions for this user in this tenant.',
    }),
    item({
      name: 'Logout (all sessions)',
      method: 'POST',
      urlPath: ['auth', 'logout'],
      auth: 'jwt',
      description: 'No body. Revokes every active refresh token for this user in this tenant.',
    }),
    item({
      name: 'Switch Tenant',
      method: 'POST',
      urlPath: ['auth', 'switch-tenant'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({ tenantSlug: 'target-tenant-slug' }, null, 2)),
      description: 'SUPER_ADMIN only. Provide either `tenantId` (uuid) or `tenantSlug`. Returns a fresh token pair scoped to the target tenant.',
    }),
    item({
      name: '2FA — Setup',
      method: 'POST',
      urlPath: ['auth', '2fa', 'setup'],
      auth: 'jwt',
      description: 'Begin 2FA enrolment. Returns `{ secret, otpauthUrl }` — scan the URL into your authenticator app then call `/auth/2fa/enable`.',
    }),
    item({
      name: '2FA — Enable',
      method: 'POST',
      urlPath: ['auth', '2fa', 'enable'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({ code: '123456' }, null, 2)),
      description: 'Confirms the first TOTP code and activates 2FA on the account.',
    }),
    item({
      name: '2FA — Disable',
      method: 'POST',
      urlPath: ['auth', '2fa', 'disable'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({ code: '123456', password: '{{staffPassword}}' }, null, 2)),
      description: 'Requires BOTH a current TOTP code AND the account password (defends against hijacked sessions).',
    }),
    item({
      name: 'Forgot Password',
      method: 'POST',
      urlPath: ['auth', 'forgot-password'],
      body: jsonBody(JSON.stringify({
        tenantSlug: '{{tenantSlug}}',
        email: '{{staffEmail}}',
      }, null, 2)),
      description: 'Always returns 200 regardless of whether the email matches an account (anti-enumeration).',
    }),
    item({
      name: 'Reset Password',
      method: 'POST',
      urlPath: ['auth', 'reset-password'],
      body: jsonBody(JSON.stringify({
        token: 'paste-token-from-email-here',
        newPassword: 'NewSecureP@ssw0rd!',
      }, null, 2)),
      description: 'Single-use token, 1h TTL. Successful reset revokes ALL active refresh tokens for the user.',
    }),
  ],
};

// ─── Guardian Auth folder ─────────────────────────────────────────────────
const guardianAuthFolder = {
  name: '2. Guardian Auth',
  description: 'Passwordless magic-link authentication for guardians/participants.',
  item: [
    item({
      name: 'Request Magic Link',
      method: 'POST',
      urlPath: ['guardian-auth', 'request-link'],
      body: jsonBody(JSON.stringify({
        tenantSlug: '{{tenantSlug}}',
        email: 'guardian@example.com',
      }, null, 2)),
      description: 'Send a magic link via email and/or SMS. Provide either `email`, `phone`, or both.',
    }),
    item({
      name: 'Verify Magic Link',
      method: 'POST',
      urlPath: ['guardian-auth', 'verify'],
      body: jsonBody(JSON.stringify({ token: 'paste-magic-link-token-here' }, null, 2)),
      description: 'Exchange the magic-link token for a guardian JWT. Saves it as `guardianToken` in the environment.',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              'const res = pm.response.json();',
              'if (res.accessToken) {',
              '    pm.environment.set("guardianToken", res.accessToken);',
              '    console.log("✔ guardianToken saved");',
              '}',
            ],
          },
        },
      ],
    }),
    item({
      name: 'Guardian Me',
      method: 'GET',
      urlPath: ['guardian-auth', 'me'],
      auth: 'guardian',
      description: 'Returns the guardian profile. Fails with 500 if called with a staff token (different actor type).',
    }),
  ],
};

// ─── API Keys folder ──────────────────────────────────────────────────────
const apiKeysFolder = {
  name: '3. API Keys (SUPER_ADMIN)',
  description: 'Issue, list, and revoke partner integration keys. The plaintext key is shown ONLY on create.',
  item: [
    item({
      name: 'Create API Key',
      method: 'POST',
      urlPath: ['api-keys'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        label: 'Acme Analytics integration',
        scopes: ['participants:read', 'sessions:read', 'payments:read', 'locations:read'],
        rateLimit: 1000,
      }, null, 2)),
      description:
        'Issue a new API key. The plaintext key is returned in `plaintext` — this is the only time it is shown.\n\n' +
        'The test script copies it into the `apiKey` environment variable so the partner-facing requests can use it immediately.',
      event: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              'const res = pm.response.json();',
              'if (res.plaintext) {',
              '    pm.environment.set("apiKey", res.plaintext);',
              '    console.log("✔ apiKey saved (one-time plaintext)");',
              '}',
            ],
          },
        },
      ],
    }),
    item({
      name: 'List API Keys',
      method: 'GET',
      urlPath: ['api-keys'],
      auth: 'jwt',
      description: 'Returns metadata only — never plaintext.',
    }),
    item({
      name: 'Revoke API Key',
      method: 'DELETE',
      urlPath: ['api-keys', ':id'],
      auth: 'jwt',
      description: 'Soft delete via `revokedAt`. Stops working immediately on the next request.',
    }),
  ],
};

// ─── Users folder ─────────────────────────────────────────────────────────
const usersFolder = {
  name: '4. Users (Staff)',
  description: 'CRUD for staff accounts. SUPER_ADMIN only.',
  item: [
    item({
      name: 'Create User',
      method: 'POST',
      urlPath: ['users'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        name: 'New Staff',
        email: 'staff@example.com',
        password: 'SecureP@ssw0rd1',
        role: 'STAFF',
      }, null, 2)),
      description:
        'Roles: SUPER_ADMIN | LOCATION_MANAGER | FINANCE_OFFICER | STAFF.\n\n' +
        'When role=LOCATION_MANAGER, `locationId` (uuid) is required.',
    }),
    item({
      name: 'List Users',
      method: 'GET',
      urlPath: ['users'],
      auth: 'jwt',
      query: [
        { key: 'role', value: '', description: 'Filter by role (optional).' },
        { key: 'locationId', value: '', description: 'Filter by location (optional, uuid).' },
        { key: 'page', value: '1', disabled: false },
        { key: 'limit', value: '20', disabled: false },
      ],
    }),
    item({
      name: 'Get User by Id',
      method: 'GET',
      urlPath: ['users', ':id'],
      auth: 'jwt',
    }),
    item({
      name: 'Update User',
      method: 'PATCH',
      urlPath: ['users', ':id'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({ role: 'STAFF', locationId: 'uuid-optional' }, null, 2)),
    }),
    item({
      name: 'Delete User (soft)',
      method: 'DELETE',
      urlPath: ['users', ':id'],
      auth: 'jwt',
    }),
  ],
};

// ─── Locations folder ─────────────────────────────────────────────────────
const locationsFolder = {
  name: '5. Locations',
  description: 'Club branches / facilities. List endpoint also accepts `x-api-key` (`locations:read`).',
  item: [
    item({
      name: 'Create Location',
      method: 'POST',
      urlPath: ['locations'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        name: 'Westside Club',
        city: 'Riyadh',
        address: '123 King Fahd Rd',
        phone: '+9661XXXXXXX',
        capacity: 100,
      }, null, 2)),
      description: 'SUPER_ADMIN only.',
    }),
    item({
      name: 'List Locations',
      method: 'GET',
      urlPath: ['locations'],
      auth: 'jwtOrApiKey',
      query: [
        { key: 'status', value: '', description: 'active | inactive | maintenance' },
        { key: 'city', value: '' },
        { key: 'search', value: '' },
        { key: 'page', value: '1', disabled: false },
        { key: 'limit', value: '20', disabled: false },
      ],
      description: 'JWT (any staff role) OR API key with `locations:read`. LM auto-scoped to own location.',
    }),
    item({
      name: 'Update Location',
      method: 'PATCH',
      urlPath: ['locations', ':id'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        name: 'Westside Premium',
        address: '124 King Fahd Rd',
        city: 'Riyadh',
        phone: '+9661XXXXXXX',
        email: 'westside@example.com',
        capacity: 120,
        status: 'active',
        amenities: ['pool', 'gym'],
      }, null, 2)),
      description: 'SUPER_ADMIN or LOCATION_MANAGER (own location only).',
    }),
    item({
      name: 'Regenerate Registration QR',
      method: 'POST',
      urlPath: ['locations', ':id', 'regenerate-qr'],
      auth: 'jwt',
      description: 'Rotates the public registration slug.',
    }),
    item({
      name: 'Public Registration Config (by slug)',
      method: 'GET',
      urlPath: ['locations', ':slug', 'register'],
      description: 'PUBLIC endpoint used by the QR landing page. Returns the location info + list of OPEN sessions.',
    }),
  ],
};

// ─── Sessions folder ──────────────────────────────────────────────────────
const sessionsFolder = {
  name: '6. Sessions',
  description: 'Programmes / batches. List endpoint also accepts `x-api-key` (`sessions:read`).',
  item: [
    item({
      name: 'Create Session',
      method: 'POST',
      urlPath: ['sessions'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        name: 'Summer 2026',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        baseFee: 1500.00,
        enrolOpenAt: '2026-04-01T00:00:00Z',
        enrolCloseAt: '2026-05-31T23:59:59Z',
        status: 'DRAFT',
        locations: [
          { locationId: 'uuid-of-location', feeOverride: 1200.00 }
        ],
      }, null, 2)),
      description: 'SUPER_ADMIN. `status` ∈ DRAFT | OPEN | CLOSED | ARCHIVED.',
    }),
    item({
      name: 'List Sessions',
      method: 'GET',
      urlPath: ['sessions'],
      auth: 'jwtOrApiKey',
      query: [
        { key: 'status', value: '', description: 'DRAFT | OPEN | CLOSED | ARCHIVED' },
        { key: 'locationId', value: '' },
        { key: 'dateFrom', value: '' },
        { key: 'dateTo', value: '' },
        { key: 'page', value: '1', disabled: false },
        { key: 'limit', value: '20', disabled: false },
      ],
    }),
    item({
      name: 'Update Session Status',
      method: 'PATCH',
      urlPath: ['sessions', ':id', 'status'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({ status: 'OPEN' }, null, 2)),
    }),
    item({
      name: 'Add Payment Plan to Session',
      method: 'POST',
      urlPath: ['sessions', ':id', 'payment-plans'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        type: 'MONTHLY',
        instalmentCount: 3,
        instalmentAmount: 500.00,
        dueDates: ['2026-06-15', '2026-07-15', '2026-08-15'],
      }, null, 2)),
      description: '`type` ∈ FULL | MONTHLY | SEASONAL.',
    }),
  ],
};

// ─── Participants folder ──────────────────────────────────────────────────
const participantsFolder = {
  name: '7. Participants',
  description: 'Participant CRUD, staff notes, status history, re-enrol. List/get also accept `x-api-key` (`participants:read`).',
  item: [
    item({
      name: 'Register Participant (public)',
      method: 'POST',
      urlPath: ['participants', 'register'],
      body: jsonBody(JSON.stringify({
        sessionId: 'uuid-optional',
        locationSlug: 'westside',
        firstNameEn: 'Ahmed',
        firstNameAr: 'أحمد',
        lastNameEn: 'Khan',
        lastNameAr: 'خان',
        dateOfBirth: '2015-04-12',
        gender: 'MALE',
        phone: '+9665XXXXXXXX',
        nationality: 'SA',
        preferredLang: 'ar',
        guardian: {
          fullName: 'Father Khan',
          relationship: 'father',
          phone: '+9665XXXXXXXX',
          email: 'father@example.com',
        },
      }, null, 2)),
      description: 'Public endpoint. Arabic name fields must use Arabic script.',
    }),
    item({
      name: 'List Participants',
      method: 'GET',
      urlPath: ['participants'],
      auth: 'jwtOrApiKey',
      query: [
        { key: 'status', value: '', description: 'INQUIRY | DOCUMENTS_PENDING | FEE_PENDING | ACTIVE | ON_HOLD | COMPLETED | WITHDRAWN' },
        { key: 'locationId', value: '' },
        { key: 'sessionId', value: '' },
        { key: 'paymentPlanType', value: '', description: 'FULL | MONTHLY | SEASONAL' },
        { key: 'dateFrom', value: '', description: 'ISO date / datetime' },
        { key: 'dateTo', value: '', description: 'ISO date / datetime' },
        { key: 'search', value: '', description: 'matches uniqueId / phone / name' },
        { key: 'sortBy', value: 'createdAt', disabled: false },
        { key: 'order', value: 'desc', description: 'asc | desc', disabled: false },
        { key: 'page', value: '1', disabled: false },
        { key: 'limit', value: '20', disabled: false },
        { key: 'export', value: 'csv', description: 'Set to "csv" to download a CSV file' },
      ],
    }),
    item({
      name: 'Get Participant by Id (360° profile)',
      method: 'GET',
      urlPath: ['participants', ':id'],
      auth: 'jwtOrApiKey',
    }),
    item({
      name: 'Update Participant Status',
      method: 'PATCH',
      urlPath: ['participants', ':id', 'status'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        status: 'ACTIVE',
        reason: 'optional audit note',
      }, null, 2)),
    }),
    item({
      name: 'List Staff Notes',
      method: 'GET',
      urlPath: ['participants', ':id', 'staff-notes'],
      auth: 'jwt',
    }),
    item({
      name: 'Add Staff Note',
      method: 'POST',
      urlPath: ['participants', ':id', 'staff-notes'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({ note: 'Followed up on Sunday — paid in cash.' }, null, 2)),
    }),
    item({
      name: 'Delete Staff Note',
      method: 'DELETE',
      urlPath: ['participants', ':id', 'staff-notes', ':noteId'],
      auth: 'jwt',
    }),
    item({
      name: 'Get Status History',
      method: 'GET',
      urlPath: ['participants', ':id', 'status-history'],
      auth: 'jwt',
    }),
    item({
      name: 'Re-enrol (convenience)',
      method: 'POST',
      urlPath: ['participants', ':id', 're-enrol'],
      auth: 'jwt',
      query: [
        { key: 'allowOverlap', value: 'true', description: 'SUPER_ADMIN / FINANCE_OFFICER only' },
      ],
      body: jsonBody(JSON.stringify({
        sessionId: 'uuid-of-new-session',
        paymentPlanType: 'MONTHLY',
      }, null, 2)),
    }),
  ],
};

// ─── Enrolments folder ────────────────────────────────────────────────────
const enrolmentsFolder = {
  name: '8. Enrolments',
  description: 'Direct enrolment / re-enrolment with overlap guards.',
  item: [
    item({
      name: 'List Enrolments',
      method: 'GET',
      urlPath: ['enrolments'],
      auth: 'jwt',
      query: [
        { key: 'sessionId', value: '' },
        { key: 'locationId', value: '' },
        { key: 'status', value: '', description: 'WAITLISTED | DOCUMENTS_PENDING | FEE_PENDING | ACTIVE | ON_HOLD | COMPLETED | WITHDRAWN' },
        { key: 'page', value: '1', disabled: false },
        { key: 'limit', value: '20', disabled: false },
      ],
    }),
    item({
      name: 'Create Enrolment',
      method: 'POST',
      urlPath: ['enrolments'],
      auth: 'jwt',
      query: [
        { key: 'allowOverlap', value: 'true', description: 'SUPER_ADMIN / FINANCE_OFFICER only' },
      ],
      body: jsonBody(JSON.stringify({
        participantId: 'uuid',
        sessionId: 'uuid',
        locationId: 'uuid',
        paymentPlanType: 'MONTHLY',
      }, null, 2)),
    }),
    item({
      name: 'Re-enrol (by previous enrolment id)',
      method: 'POST',
      urlPath: ['enrolments', ':id', 're-enrol'],
      auth: 'jwt',
      query: [
        { key: 'allowOverlap', value: 'true', description: 'SUPER_ADMIN / FINANCE_OFFICER only' },
      ],
      body: jsonBody(JSON.stringify({
        sessionId: 'uuid-of-new-session',
        paymentPlanType: 'FULL',
      }, null, 2)),
    }),
  ],
};

// ─── Fees folder ──────────────────────────────────────────────────────────
const feesFolder = {
  name: '9. Fees (mounted under /enrolments)',
  description: 'Payment plan + invoice + fee-override routes for an enrolment.',
  item: [
    item({
      name: 'Create Payment Plan for Enrolment',
      method: 'POST',
      urlPath: ['enrolments', ':enrolmentId', 'payment-plan'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        planType: 'MONTHLY',
        instalmentCount: 3,
      }, null, 2)),
      description: '`planType` ∈ FULL | MONTHLY | SEASONAL. `instalmentCount` ignored when FULL (forced to 1).',
    }),
    item({
      name: 'List Invoices for Enrolment',
      method: 'GET',
      urlPath: ['enrolments', ':enrolmentId', 'invoices'],
      auth: 'jwt',
    }),
    item({
      name: 'Set / Clear Fee Override',
      method: 'PATCH',
      urlPath: ['enrolments', ':enrolmentId', 'fee-override'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        amount: 1200.00,
        reason: 'Family discount',
      }, null, 2)),
      description: 'Pass `"amount": null` to clear the override. SUPER_ADMIN / FINANCE_OFFICER.',
    }),
  ],
};

// ─── Invoices folder ──────────────────────────────────────────────────────
const invoicesFolder = {
  name: '10. Invoices',
  description: 'Generate or refresh a checkout URL for an invoice.',
  item: [
    item({
      name: 'Issue Payment Link',
      method: 'POST',
      urlPath: ['invoices', ':id', 'payment-link'],
      auth: 'jwt',
      description: 'Safe to call repeatedly — the stored link is reused while valid.',
    }),
  ],
};

// ─── Payments folder ──────────────────────────────────────────────────────
const paymentsFolder = {
  name: '11. Payments',
  description: 'Offline payment recording + verification. List/get also accept `x-api-key` (`payments:read`).',
  item: [
    item({
      name: 'Upload Proof of Payment',
      method: 'POST',
      urlPath: ['payments', 'proof-upload'],
      auth: 'jwt',
      body: {
        mode: 'formdata',
        formdata: [
          { key: 'file', type: 'file', src: [], description: 'Receipt image / PDF ≤ 10 MB' },
          { key: 'enrolmentId', value: 'uuid-of-enrolment', type: 'text' },
        ],
      },
      description: 'Returns `{ storageKey }` to feed into POST /payments/offline.',
    }),
    item({
      name: 'Record Offline Payment',
      method: 'POST',
      urlPath: ['payments', 'offline'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({
        enrolmentId: 'uuid',
        invoiceId: 'uuid-optional',
        method: 'CASH',
        amount: 500.00,
        proofKey: 'proofs/<tenant>/<enrolment>/<file>',
        idempotencyKey: 'unique-string-per-attempt',
        note: 'optional',
      }, null, 2)),
      description: '`method` ∈ ONLINE_CARD | SADAD | MADA | BANK_TRANSFER | CASH. Status starts at PENDING_VERIFICATION.',
    }),
    item({
      name: 'Verify Payment',
      method: 'POST',
      urlPath: ['payments', ':id', 'verify'],
      auth: 'jwt',
      description: 'Marks the payment COMPLETED and applies funds.',
    }),
    item({
      name: 'Reject Payment',
      method: 'POST',
      urlPath: ['payments', ':id', 'reject'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({ reason: 'Wrong amount transferred' }, null, 2)),
    }),
    item({
      name: 'List Payments',
      method: 'GET',
      urlPath: ['payments'],
      auth: 'jwtOrApiKey',
      query: [
        { key: 'enrolmentId', value: '' },
        { key: 'status', value: '', description: 'PENDING | COMPLETED | FAILED | REFUNDED | PENDING_VERIFICATION' },
        { key: 'gateway', value: '', description: 'MOYASAR | PAYTABS | HYPERPAY | OFFLINE' },
        { key: 'page', value: '1', disabled: false },
        { key: 'limit', value: '20', disabled: false },
      ],
    }),
    item({
      name: 'Get Payment by Id',
      method: 'GET',
      urlPath: ['payments', ':id'],
      auth: 'jwtOrApiKey',
    }),
  ],
};

// ─── Webhooks folder ──────────────────────────────────────────────────────
const webhooksFolder = {
  name: '12. Payment Webhooks',
  description: 'Endpoint the payment gateway calls. Always returns 200 (audit-row first, verify later).',
  item: [
    item({
      name: 'Receive Webhook (Moyasar)',
      method: 'POST',
      urlPath: ['webhooks', 'payments', 'moyasar'],
      headers: [{ key: 'x-signature', value: '<gateway-signed-header>', type: 'text' }],
      body: jsonBody(JSON.stringify({
        id: 'gateway-event-id',
        status: 'paid',
        amount: 50000,
        currency: 'SAR',
        metadata: { invoiceId: 'uuid', tenantId: 'uuid' },
      }, null, 2)),
      description: 'Path `:gateway` ∈ moyasar | paytabs | hyperpay. Payload shape is gateway-specific.',
    }),
    item({
      name: 'Receive Webhook (PayTabs)',
      method: 'POST',
      urlPath: ['webhooks', 'payments', 'paytabs'],
      headers: [{ key: 'x-paytabs-signature', value: '<gateway-signed-header>', type: 'text' }],
      body: jsonBody(JSON.stringify({
        tran_ref: 'TST-…',
        cart_id: 'uuid',
        payment_result: { response_status: 'A' },
      }, null, 2)),
    }),
    item({
      name: 'Receive Webhook (HyperPay)',
      method: 'POST',
      urlPath: ['webhooks', 'payments', 'hyperpay'],
      headers: [{ key: 'paymentid', value: '<gateway-event-id>', type: 'text' }],
      body: jsonBody(JSON.stringify({ id: 'hp-event', result: { code: '000.000.000' } }, null, 2)),
    }),
  ],
};

// ─── Documents folder ─────────────────────────────────────────────────────
const documentsFolder = {
  name: '13. Documents',
  description: 'Per-participant document upload / verification / download.',
  item: [
    item({
      name: 'Upload Document',
      method: 'POST',
      urlPath: ['documents', ':participantId'],
      auth: 'jwt',
      body: {
        mode: 'formdata',
        formdata: [
          { key: 'file', type: 'file', src: [], description: '≤ 10 MB' },
          { key: 'docType', value: 'BIRTH_CERTIFICATE', type: 'text', description: 'BIRTH_CERTIFICATE | PASSPORT | MEDICAL_CLEARANCE | ID_PHOTO | OTHER' },
          { key: 'notes', value: '', type: 'text', description: 'Optional' },
        ],
      },
    }),
    item({
      name: 'Get Signed Download URL',
      method: 'GET',
      urlPath: ['documents', ':participantId', ':docId', 'url'],
      auth: 'jwt',
      query: [
        { key: 'disposition', value: 'inline', description: 'inline | attachment (default inline)', disabled: false },
      ],
      description: 'Returns `{ url, expiresIn: 900 }`. Real S3 pre-signed URL when S3 is configured.',
    }),
    item({
      name: 'List Documents for Participant',
      method: 'GET',
      urlPath: ['documents', 'by-participant', ':participantId'],
      auth: 'jwt',
    }),
    item({
      name: 'Soft-delete Document',
      method: 'DELETE',
      urlPath: ['documents', ':participantId', ':docId'],
      auth: 'jwt',
    }),
    item({
      name: 'Verify / Reject Document',
      method: 'PATCH',
      urlPath: ['documents', ':docId', 'verify'],
      auth: 'jwt',
      body: jsonBody(JSON.stringify({ status: 'VERIFIED' }, null, 2)),
      description: '`status` ∈ VERIFIED | REJECTED. Auto-promotes the participant DOCUMENTS_PENDING → FEE_PENDING when all required docs are verified.',
    }),
    item({
      name: 'Local Signed Download (no-S3 fallback)',
      method: 'GET',
      urlPath: ['documents', 'download'],
      query: [
        { key: 'key', value: '<storageKey>', disabled: false },
        { key: 'token', value: '<hmac>', disabled: false },
        { key: 'exp', value: '<unix-ts>', disabled: false },
        { key: 'disposition', value: 'inline', description: 'inline | attachment' },
      ],
      description: 'PUBLIC — the HMAC token in the URL is the bearer credential. Only used when S3 is NOT configured.',
    }),
  ],
};

// ─── Notifications folder ─────────────────────────────────────────────────
const notificationsFolder = {
  name: '14. Notifications',
  description: 'Admin-only read + retry. There is no public POST — notifications are created server-side as side effects.',
  item: [
    item({
      name: 'List Notifications',
      method: 'GET',
      urlPath: ['notifications'],
      auth: 'jwt',
      query: [
        { key: 'status', value: '', description: 'QUEUED | SENT | FAILED | DELIVERED' },
        { key: 'type', value: '', description: 'REGISTRATION_CONFIRM | DOCUMENT_REQUEST | FEE_INVOICE | PAYMENT_CONFIRM | PAYMENT_REMINDER | SESSION_START | WAITLIST_OFFER | BROADCAST | STAFF_ALERT | GUARDIAN_MAGIC_LINK | PASSWORD_RESET' },
        { key: 'channel', value: '', description: 'WHATSAPP | EMAIL' },
        { key: 'participantId', value: '' },
        { key: 'recipientUserId', value: '' },
        { key: 'page', value: '1', disabled: false },
        { key: 'limit', value: '20', disabled: false },
      ],
    }),
    item({
      name: 'Get Notification',
      method: 'GET',
      urlPath: ['notifications', ':id'],
      auth: 'jwt',
    }),
    item({
      name: 'Retry Failed Notification',
      method: 'POST',
      urlPath: ['notifications', ':id', 'retry'],
      auth: 'jwt',
      description: 'SUPER_ADMIN only.',
    }),
  ],
};

// ─── Waitlist folder ──────────────────────────────────────────────────────
const waitlistFolder = {
  name: '15. Waitlist',
  description: 'Staff routes are JWT-guarded; guardian routes are PUBLIC and use the offer token as credential.',
  item: [
    item({
      name: 'List Waitlist (staff)',
      method: 'GET',
      urlPath: ['waitlist'],
      auth: 'jwt',
      query: [
        { key: 'sessionId', value: 'uuid', disabled: false },
        { key: 'locationId', value: 'uuid', disabled: false },
      ],
      description: 'Both `sessionId` and `locationId` are required UUIDs.',
    }),
    item({
      name: 'Send Waitlist Offer',
      method: 'POST',
      urlPath: ['waitlist', ':id', 'offer'],
      auth: 'jwt',
      description: 'Generates a single-use token and notifies the guardian.',
    }),
    item({
      name: 'Staff Withdraw',
      method: 'DELETE',
      urlPath: ['waitlist', ':id'],
      auth: 'jwt',
    }),
    item({
      name: 'Accept Offer (guardian)',
      method: 'POST',
      urlPath: ['waitlist', 'accept'],
      body: jsonBody(JSON.stringify({
        token: '<waitlist-offer-token>',
        paymentPlanType: 'MONTHLY',
      }, null, 2)),
      description: 'PUBLIC. `paymentPlanType` ∈ FULL | MONTHLY | SEASONAL.',
    }),
    item({
      name: 'Decline Offer (guardian)',
      method: 'POST',
      urlPath: ['waitlist', 'decline'],
      body: jsonBody(JSON.stringify({ token: '<waitlist-offer-token>' }, null, 2)),
    }),
    item({
      name: 'Guardian Withdraw',
      method: 'POST',
      urlPath: ['waitlist', 'withdraw'],
      body: jsonBody(JSON.stringify({ token: '<waitlist-offer-token>' }, null, 2)),
    }),
  ],
};

// ─── Registration folder ──────────────────────────────────────────────────
const registrationFolder = {
  name: '16. Public Registration',
  description: 'Public form routes — no JWT. Location context is carried in the URL slug.',
  item: [
    item({
      name: 'Get Form Config',
      method: 'GET',
      urlPath: ['register', ':slug'],
      description: 'Returns the location info and OPEN sessions to populate the form.',
    }),
    item({
      name: 'Submit Form',
      method: 'POST',
      urlPath: ['register', ':slug'],
      body: jsonBody(JSON.stringify({
        firstNameEn: 'Ahmed',
        firstNameAr: 'أحمد',
        lastNameEn: 'Khan',
        lastNameAr: 'خان',
        dateOfBirth: '2015-04-12',
        gender: 'MALE',
        phone: '+9665XXXXXXXX',
        nationality: 'SA',
        preferredLang: 'ar',
        sessionId: 'uuid-optional',
        guardian: {
          fullName: 'Father Khan',
          relationship: 'father',
          phone: '+9665XXXXXXXX',
          email: 'father@example.com',
        },
      }, null, 2)),
      description: 'When `sessionId` is omitted, the participant is created at status INQUIRY with no enrolment.',
    }),
  ],
};

// ─── Portal folder ────────────────────────────────────────────────────────
const portalFolder = {
  name: '17. Guardian Portal',
  description: 'Single-use signed token routes for the guardian portal.',
  item: [
    item({
      name: 'Get Portal by Token',
      method: 'GET',
      urlPath: ['portal', ':token'],
      description: 'PUBLIC. Returns participant + enrolments + invoices visible to the guardian.',
    }),
  ],
};

// ─── Reporting folder ─────────────────────────────────────────────────────
const reportingFolder = {
  name: '18. Reporting',
  description: 'Dashboards and time-series reports. JWT only.',
  item: [
    item({
      name: 'Dashboard Summary',
      method: 'GET',
      urlPath: ['reporting', 'dashboard'],
      auth: 'jwt',
    }),
    item({
      name: 'Fees Report',
      method: 'GET',
      urlPath: ['reporting', 'fees'],
      auth: 'jwt',
      query: [
        { key: 'sessionId', value: '' },
        { key: 'locationId', value: '' },
        { key: 'month', value: '', description: 'YYYY-MM' },
        { key: 'groupBy', value: 'location', description: 'location | session', disabled: false },
        { key: 'page', value: '1', disabled: false },
        { key: 'limit', value: '50', disabled: false },
      ],
      description: 'LM auto-scoped to their location.',
    }),
    item({
      name: 'Funnel Report',
      method: 'GET',
      urlPath: ['reporting', 'funnel'],
      auth: 'jwt',
      query: [
        { key: 'startDate', value: '2026-01-01', disabled: false },
        { key: 'endDate', value: '2026-12-31', disabled: false },
        { key: 'sessionId', value: '' },
      ],
    }),
    item({
      name: 'Revenue Report',
      method: 'GET',
      urlPath: ['reporting', 'revenue'],
      auth: 'jwt',
      query: [
        { key: 'year', value: '2026', disabled: false },
        { key: 'locationId', value: '' },
      ],
    }),
    item({
      name: 'Capacity Utilisation (time-series)',
      method: 'GET',
      urlPath: ['reporting', 'capacity-utilisation'],
      auth: 'jwt',
      query: [
        { key: 'from', value: '2026-01-01', disabled: false },
        { key: 'to', value: '2026-12-31', disabled: false },
        { key: 'interval', value: 'day', description: 'day | week | month', disabled: false },
        { key: 'locationId', value: '' },
      ],
      description: 'Maximum span is 366 buckets.',
    }),
  ],
};

// ─── Audit folder ─────────────────────────────────────────────────────────
const auditFolder = {
  name: '19. Audit',
  description: 'Tamper-evident audit chain verification (SUPER_ADMIN).',
  item: [
    item({
      name: 'Verify Audit Chain',
      method: 'GET',
      urlPath: ['audit', 'verify-chain'],
      auth: 'jwt',
      description: 'Walks every AuditLog row in createdAt order, recomputes SHA-256. Returns `{ ok, checked }` or `{ ok:false, firstBadId, reason }`.',
    }),
  ],
};

// ─── Collection root ──────────────────────────────────────────────────────
const collection = {
  info: {
    _postman_id: 'a1b2c3d4-e5f6-4a5b-bc6d-7e8f9a0b1c2e',
    name: 'Neomora Club Manager API',
    description:
      '# Neomora Club Manager API\n\n' +
      'Complete Postman collection covering every endpoint exposed by the backend.\n\n' +
      '## Setup\n\n' +
      '1. Make sure the API is running locally (`npm run start:dev`) on `http://localhost:3000`.\n' +
      '2. Open the collection variables (or create an environment) and set:\n' +
      '   - `baseUrl` — defaults to `http://localhost:3000/api/v1`\n' +
      '   - `tenantSlug` — the slug for your tenant (e.g. `main-club`)\n' +
      '   - `staffEmail`, `staffPassword` — a SUPER_ADMIN account to log in with\n' +
      '3. Run **Auth → Login**. The test script stores `accessToken` and `refreshToken` automatically.\n' +
      '4. All staff-protected requests then use `Bearer {{accessToken}}` via the request-level auth.\n\n' +
      '## API key (partner) flow\n\n' +
      '1. Run **API Keys → Create API Key** — its test script stores the plaintext into `{{apiKey}}`.\n' +
      '2. On the partner-friendly endpoints (List Participants / Sessions / Payments / Locations etc.), enable the `x-api-key` header. The bearer auth is overridden by the API-key header server-side.\n\n' +
      '## Notes\n\n' +
      '- Replace `:id`, `:slug`, `:participantId`, `:docId`, `:noteId`, `:gateway` path placeholders before sending.\n' +
      '- For Arabic validation messages set `Accept-Language: ar`.\n' +
      '- File-upload requests use `multipart/form-data` — Postman handles this automatically when you select the file.\n' +
      '- Full reference docs are in `API_DOCUMENTATION.md` and live Swagger at `http://localhost:3000/api/docs`.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    authFolder,
    guardianAuthFolder,
    apiKeysFolder,
    usersFolder,
    locationsFolder,
    sessionsFolder,
    participantsFolder,
    enrolmentsFolder,
    feesFolder,
    invoicesFolder,
    paymentsFolder,
    webhooksFolder,
    documentsFolder,
    notificationsFolder,
    waitlistFolder,
    registrationFolder,
    portalFolder,
    reportingFolder,
    auditFolder,
  ],
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000/api/v1', type: 'string' },
    { key: 'tenantSlug', value: 'main-club', type: 'string' },
    { key: 'staffEmail', value: 'admin@example.com', type: 'string' },
    { key: 'staffPassword', value: 'password123', type: 'string' },
    { key: 'accessToken', value: '', type: 'string' },
    { key: 'refreshToken', value: '', type: 'string' },
    { key: 'guardianToken', value: '', type: 'string' },
    { key: 'apiKey', value: '', type: 'string' },
  ],
};

fs.writeFileSync(out, JSON.stringify(collection, null, 2) + '\n', 'utf8');
console.log('Wrote', out, '(' + fs.statSync(out).size + ' bytes)');
