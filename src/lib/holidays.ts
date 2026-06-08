import type { IsoDate } from "./dateUtils";

export interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
}

export async function fetchHolidays(year: number, countryCode: string): Promise<IsoDate[]> {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nager API ${res.status}`);
  const data = (await res.json()) as NagerHoliday[];
  return data.map(h => h.date).filter(Boolean);
}
