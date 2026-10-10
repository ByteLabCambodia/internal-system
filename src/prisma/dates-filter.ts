/** The day after a `YYYY-MM-DD` date, for an inclusive "to" bound on a timestamp. */
export function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) {
    throw new Error(`Not a date: ${date}`);
  }
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
