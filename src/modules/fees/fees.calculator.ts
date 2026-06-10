import { Prisma } from '@prisma/client';

/**
 * Plan F — pure fee resolution.
 *
 * Resolves the total fee that should be charged for an enrolment,
 * with strict precedence so the result is deterministic and easy
 * for finance to reason about:
 *
 *   1. enrolment.feeOverride       — admin set custom fee for THIS participant
 *   2. sessionLocation.feeOverride — per-location override on the session
 *   3. session.baseFee             — session default
 *
 * The returned `breakdown` is stored on the AuditLog at the call site
 * so any later question of "why was this participant charged X" can be
 * answered without re-running computation.
 */
export type FeeSource =
  | 'ENROLMENT_OVERRIDE'
  | 'LOCATION_OVERRIDE'
  | 'SESSION_BASE';

export interface ComputeFeeInput {
  /** Override set on the enrolment itself (admin custom). May be null. */
  enrolmentFeeOverride?: Prisma.Decimal | number | string | null;
  /** Override set on the (session, location) link. May be null. */
  sessionLocationFeeOverride?: Prisma.Decimal | number | string | null;
  /** Session base fee. Required — every session has one. */
  sessionBaseFee: Prisma.Decimal | number | string;
}

export interface ComputeFeeResult {
  total: Prisma.Decimal;
  source: FeeSource;
  breakdown: {
    enrolmentOverride: string | null;
    locationOverride: string | null;
    sessionBase: string;
    chosen: string;
  };
}

/**
 * Picks the first non-null value in precedence order and returns it
 * along with breakdown metadata for audit. Never throws.
 *
 * Decimal values are normalised to `Prisma.Decimal` so the caller can
 * pass them straight into a Prisma `create` without casts.
 */
export function computeEnrolmentFee(input: ComputeFeeInput): ComputeFeeResult {
  const enrolment = toDecimalOrNull(input.enrolmentFeeOverride);
  const location = toDecimalOrNull(input.sessionLocationFeeOverride);
  const base = toDecimal(input.sessionBaseFee);

  let chosen: Prisma.Decimal;
  let source: FeeSource;

  if (enrolment !== null) {
    chosen = enrolment;
    source = 'ENROLMENT_OVERRIDE';
  } else if (location !== null) {
    chosen = location;
    source = 'LOCATION_OVERRIDE';
  } else {
    chosen = base;
    source = 'SESSION_BASE';
  }

  return {
    total: chosen,
    source,
    breakdown: {
      enrolmentOverride: enrolment?.toString() ?? null,
      locationOverride: location?.toString() ?? null,
      sessionBase: base.toString(),
      chosen: chosen.toString(),
    },
  };
}

function toDecimal(v: Prisma.Decimal | number | string): Prisma.Decimal {
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(v);
}

function toDecimalOrNull(
  v: Prisma.Decimal | number | string | null | undefined,
): Prisma.Decimal | null {
  if (v === null || v === undefined) return null;
  return toDecimal(v);
}
