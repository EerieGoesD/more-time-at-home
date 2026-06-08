import type { IsoDate } from "./dateUtils";
import { addDays } from "./dateUtils";
import type { PlanState } from "./state";
import { isWeekend } from "./state";

function isoToYmd(iso: IsoDate): string {
  return iso.split("-").join("");
}

export function groupConsecutiveDates(
  sorted: IsoDate[],
  s: Pick<PlanState, "nationalHolidays" | "customHolidays" | "weekendOverrides">,
): IsoDate[][] {
  if (sorted.length === 0) return [];
  const blocks: IsoDate[][] = [];
  let current: IsoDate[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    let check = addDays(prev, 1);
    let consecutive = true;
    while (check < curr) {
      if (
        !isWeekend(check, s.weekendOverrides) &&
        !s.nationalHolidays.has(check) &&
        !s.customHolidays.has(check)
      ) {
        consecutive = false;
        break;
      }
      check = addDays(check, 1);
    }
    if (consecutive) {
      current.push(curr);
    } else {
      blocks.push(current);
      current = [curr];
    }
  }
  blocks.push(current);
  return blocks;
}

export function generateIcs(s: PlanState): string {
  const sortedLeaves = [...s.plannedLeaves].sort();
  const blocks = groupConsecutiveDates(sortedLeaves, s);

  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//MoreTimeAtHome//LeavePlanner//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timestamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  for (const block of blocks) {
    const blockStart = block[0];
    const blockEndExclusive = addDays(block[block.length - 1], 1);

    const halfCount = block.filter(d => s.halfDayLeaves.has(d)).length;
    const blockPaid = block.length - halfCount * 0.5;

    let halfTag = "";
    if (halfCount > 0) {
      halfTag = block.length === 1 ? " (half day)" : ` (${halfCount} half)`;
    }
    const summary =
      block.length === 1
        ? `Planned Leave${halfTag}`
        : `Planned Leave (${block.length} days${halfCount > 0 ? `, ${halfCount} half` : ""})`;

    lines.push("BEGIN:VEVENT");
    lines.push(`DTSTART;VALUE=DATE:${isoToYmd(blockStart)}`);
    lines.push(`DTEND;VALUE=DATE:${isoToYmd(blockEndExclusive)}`);
    lines.push(`DTSTAMP:${timestamp}`);
    lines.push(`UID:${crypto.randomUUID()}@moretimeathome`);
    lines.push(`SUMMARY:${summary}`);
    lines.push(`DESCRIPTION:Planned via More Time at Home - ${blockPaid.toFixed(blockPaid % 1 ? 1 : 0)} paid leave day(s)`);
    lines.push("STATUS:TENTATIVE");
    lines.push("TRANSP:OPAQUE");
    lines.push("BEGIN:VALARM");
    lines.push("TRIGGER:-P7D");
    lines.push("ACTION:DISPLAY");
    lines.push("DESCRIPTION:Upcoming planned leave in 7 days");
    lines.push("END:VALARM");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

