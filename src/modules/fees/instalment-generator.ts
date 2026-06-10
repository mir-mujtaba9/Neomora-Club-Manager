import { Prisma, PaymentPlanType } from '@prisma/client';

/**
 * Plan F — pure instalment schedule generator.
 *
 * Given a payment plan + the session date range, produce the exact
 * list of invoice rows that should be created. The output is the
 * single source of truth for `Invoice.{amount, dueDate, instalmentNo,
 * instalmentTotal}` — no other module computes due dates.
 *
 * Rounding rule: instalment amounts are rounded to 2 decimal places.
 * Rounding error (e.g. 100 / 3 = 33.33 × 3 = 99.99) is absorbed into
 * the LAST instalment so the sum always equals the total exactly.
 *
 *   computeInstalments(100, 3, FULL,    start, end)
 *     → [{ no:1, due:start,                  amount:100.00 }]
 *
 *   computeInstalments(100, 3, MONTHLY, start, end)
 *     → [{ no:1, due:1st-of-month-1, amount:33.33 },
 *        { no:2, due:1st-of-month-2, amount:33.33 },
 *        { no:3, due:1st-of-month-3, amount:33.34 }]
 *
 *   computeInstalments(100, 4, SEASONAL, start, end)
 *     → 4 equal date-range chunks; due = end of each chunk.
 */
export interface InstalmentSpec {
  instalmentNo: number;
  instalmentTotal: number;
  dueDate: Date;
  amount: Prisma.Decimal;
}

/**
 * Generate the instalment schedule for a plan.
 *
 * @param total           The total fee being divided.
 * @param instalmentCount Number of instalments. Ignored for FULL (=1).
 * @param planType        FULL | MONTHLY | SEASONAL.
 * @param sessionStart    Session.startDate.
 * @param sessionEnd      Session.endDate. Must be >= sessionStart.
 */
export function computeInstalments(
  total: Prisma.Decimal | number | string,
  instalmentCount: number,
  planType: PaymentPlanType,
  sessionStart: Date,
  sessionEnd: Date,
): InstalmentSpec[] {
  const totalDec = total instanceof Prisma.Decimal ? total : new Prisma.Decimal(total);

  if (sessionEnd < sessionStart) {
    throw new Error('sessionEnd must be on or after sessionStart');
  }

  if (planType === PaymentPlanType.FULL) {
    return [
      {
        instalmentNo: 1,
        instalmentTotal: 1,
        dueDate: stripTime(sessionStart),
        amount: totalDec,
      },
    ];
  }

  if (instalmentCount < 1) {
    throw new Error('instalmentCount must be >= 1');
  }

  const dueDates =
    planType === PaymentPlanType.MONTHLY
      ? generateMonthlyDates(sessionStart, instalmentCount)
      : generateSeasonalDates(sessionStart, sessionEnd, instalmentCount);

  if (dueDates.length !== instalmentCount) {
    throw new Error(
      `internal: expected ${instalmentCount} due dates, got ${dueDates.length}`,
    );
  }

  return splitTotalEvenly(totalDec, instalmentCount).map((amount, i) => ({
    instalmentNo: i + 1,
    instalmentTotal: instalmentCount,
    dueDate: dueDates[i],
    amount,
  }));
}

// ─── helpers ──────────────────────────────────────────────────────────

/**
 * Split a Decimal total into N parts of equal pennies, with the
 * remainder (if any) added to the last part. Guarantees sum === total.
 */
function splitTotalEvenly(total: Prisma.Decimal, n: number): Prisma.Decimal[] {
  // Work in cents to avoid floating-point drift.
  const cents = total.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const base = cents.div(n).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  const remainder = cents.minus(base.mul(n));

  const result: Prisma.Decimal[] = [];
  for (let i = 0; i < n; i++) {
    const c = i === n - 1 ? base.plus(remainder) : base;
    result.push(c.div(100));
  }
  return result;
}

/**
 * Returns N consecutive month-start dates beginning at the
 * first-of-month on or after `start`. (Month 1 = the start month.)
 */
function generateMonthlyDates(start: Date, n: number): Date[] {
  const out: Date[] = [];
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  for (let i = 0; i < n; i++) {
    out.push(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1)));
  }
  return out;
}

/**
 * Splits [start, end] into N equal time-chunks and returns the END
 * of each chunk as the due date. The LAST due date is exactly `end`.
 */
function generateSeasonalDates(start: Date, end: Date, n: number): Date[] {
  const startMs = stripTime(start).getTime();
  const endMs = stripTime(end).getTime();
  const span = endMs - startMs;
  const chunk = Math.floor(span / n);

  const out: Date[] = [];
  for (let i = 1; i <= n; i++) {
    const ms = i === n ? endMs : startMs + chunk * i;
    out.push(new Date(ms));
  }
  return out;
}

/** Normalise a date to its UTC-midnight value so @db.Date conversions don't drift. */
function stripTime(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
