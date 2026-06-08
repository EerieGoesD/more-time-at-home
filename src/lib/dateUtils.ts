// Dates are passed around as "YYYY-MM-DD" strings to avoid JS Date timezone bugs.

export type IsoDate = string;

export function isoFromYMD(year: number, month: number, day: number): IsoDate {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function parseIso(iso: IsoDate): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  const { year, month, day } = parseIso(iso);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + n);
  return isoFromYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function dayOfWeek(iso: IsoDate): number {
  const { year, month, day } = parseIso(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function totalDaysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

export function yearOf(iso: IsoDate): number {
  return parseIso(iso).year;
}

export function isNaturalWeekend(iso: IsoDate): boolean {
  const d = dayOfWeek(iso);
  return d === 0 || d === 6;
}

export function formatLong(iso: IsoDate): string {
  const { year, month, day } = parseIso(iso);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

export function formatShort(iso: IsoDate): string {
  const { month, day } = parseIso(iso);
  const d = new Date(Date.UTC(2000, month - 1, day));
  return d.toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric" });
}

export function monthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { timeZone: "UTC", month: "long", year: "numeric" });
}

export function todayIso(): IsoDate {
  const d = new Date();
  return isoFromYMD(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
