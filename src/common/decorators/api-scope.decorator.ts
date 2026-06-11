/**
 * Plan K (F-34) — Scope-based authorization for API-key callers.
 *
 * Each F-35 partner-facing read endpoint declares the scope it requires.
 * When the caller authenticates via API key (not JWT), `RolesGuard` checks
 * the route's `ApiScopes` metadata against the key's `scopes` field —
 * intersection must be non-empty OR the key must hold the wildcard `*`.
 *
 * Why a separate decorator instead of overloading `@Roles`?
 *   - `@Roles(SUPER_ADMIN, …)` is closed-set per the UserRole enum.
 *   - Scopes are open-set (`participants:read`, `participants:write`,
 *     `sessions:read`, future `bookings:read`, …) and meant to expand
 *     freely without schema changes.
 *
 * Recognised scope naming: `<resource>:<verb>`.
 *  - resource is lower-case singular or plural noun
 *  - verb ∈ {read, write, *} — wildcard reserved for super-keys
 */
import { SetMetadata } from '@nestjs/common';

export const API_SCOPES_KEY = 'apiScopes';

/**
 * Declares the API scopes a route accepts when called with an API key.
 * Multiple scopes are OR-ed (any-match passes). JWT callers ignore this
 * metadata entirely — their access is gated by `@Roles(...)` as usual.
 */
export const ApiScopes = (...scopes: string[]) =>
  SetMetadata(API_SCOPES_KEY, scopes);

/** Synthetic role assigned to API-key callers on `request.user.role`. */
export const API_KEY_ROLE = '__API_KEY__' as const;
