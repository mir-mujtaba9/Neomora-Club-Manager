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
  /** Active VAT rate (e.g., 15 for 15%). Null if no VAT is configured. */
  activeVatRate?: Prisma.Decimal | number | string | null;
}

export interface ComputeFeeResult {
  baseTotal: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  source: FeeSource;
  breakdown: {
    enrolmentOverride: string | null;
    locationOverride: string | null;
    sessionBase: string;
    chosenBase: string;
    vatRate: string | null;
    vatAmount: string;
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
  const vatRate = toDecimalOrNull(input.activeVatRate) || new Prisma.Decimal(0);

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

  // e.g. chosen = 100, vatRate = 15 -> vatAmount = 15, total = 115
  const vatMultiplier = vatRate.dividedBy(100);
  const vatAmount = chosen.mul(vatMultiplier);
  const total = chosen.add(vatAmount);

  return {
    baseTotal: chosen,
    vatAmount,
    total,
    source,
    breakdown: {
      enrolmentOverride: enrolment?.toString() ?? null,
      locationOverride: location?.toString() ?? null,
      sessionBase: base.toString(),
      chosenBase: chosen.toString(),
      vatRate: input.activeVatRate?.toString() ?? null,
      vatAmount: vatAmount.toString(),
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
