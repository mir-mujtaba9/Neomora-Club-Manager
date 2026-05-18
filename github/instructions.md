# Club Manager — Neomora Backend

## Project overview
Multi-tenant SaaS backend for sports academy management built with NestJS + TypeScript.
Manages the full participant lifecycle across academies.

## Tech stack
- NestJS with TypeScript
- PostgreSQL via NeonDB (Prisma 7 ORM)
- Redis + BullMQ for async jobs
- JWT auth with refresh token rotation
- S3-compatible object storage for documents
- WhatsApp Cloud API + AWS SES for notifications

## Multi-tenancy rule
Every database query MUST include `where: { tenantId: req.tenantId }`.
Never query without tenant scope. tenant_id comes from JWT via TenantContextMiddleware.

## Participant lifecycle states
INQUIRY → DOCUMENTS_PENDING → FEE_PENDING → ACTIVE → ON_HOLD → COMPLETED → WITHDRAWN
All state transitions must go through participants.state-machine.ts only.
Never do a raw prisma.participant.update({ data: { status: ... } }) directly.

## Key rules
- Soft deletes only — always filter `deletedAt: null`
- Payment webhooks must verify HMAC signature before processing
- Refresh tokens must rotate on every use
- S3 files accessed via signed URLs only, never public
- All async side effects (notifications, PDFs, webhooks) go through BullMQ queue
- PII (phone, email, DOB) must never appear in logs

## Module structure
src/modules/ — auth, tenants, locations, users, sessions, participants,
guardians, enrolments, documents, fees, payments, waitlist, notifications,
broadcasts, webhooks, api-keys, reporting, storage, pdf, audit, health, cron

## Database
21 Prisma models — Tenant, Location, User, RefreshToken, ApiKey, Session,
SessionLocation, PaymentPlan, Participant, Guardian, Enrolment, Document,
Invoice, Payment, Waitlist, BroadcastMessage, Notification,
WebhookSubscription, WebhookEvent, AuditLog, StaffNote

## Payment gateways
Moyasar, PayTabs, HyperPay — all behind BaseGateway abstraction interface.
Idempotency key required on every payment to prevent duplicate processing.