/**
 * Generates an array of dates for instalments based on an interval
 */
export function generateInstalmentDates(
  startDate: Date,
  count: number,
  intervalMonths: number,
): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + i * intervalMonths);
    dates.push(d);
  }
  return dates;
}

/**
 * Checks if a session is currently within its open and close window
 */
export function isSessionOpen(openAt: Date, closeAt: Date): boolean {
  const now = new Date();
  return now >= openAt && now <= closeAt;
}

/**
 * Adds a specific number of days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
