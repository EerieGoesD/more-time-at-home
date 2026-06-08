import type { IsoDate } from "./dateUtils";
import { addDays, daysInMonth, parseIso, totalDaysInYear, yearOf } from "./dateUtils";
import type { Constraints, PlanState } from "./state";
import { isWeekend } from "./state";

interface LeaveOpportunity {
  startDate: IsoDate;
  leaveDates: IsoDate[];
  requiredLeaves: number;
  totalDaysOff: number;
  efficiency: number;
}

interface OptimizerCtx {
  year: number;
  weekendOverrides: Set<IsoDate>;
  nationalHolidays: Set<IsoDate>;
  customHolidays: Set<IsoDate>;
}

function isOffForOptimizer(d: IsoDate, ctx: OptimizerCtx): boolean {
  return (
    isWeekend(d, ctx.weekendOverrides) ||
    ctx.nationalHolidays.has(d) ||
    ctx.customHolidays.has(d)
  );
}

function evaluateOpportunity(
  startDate: IsoDate,
  leaveLength: number,
  ctx: OptimizerCtx,
): LeaveOpportunity | null {
  const leaveDates: IsoDate[] = [];
  let current = startDate;
  let added = 0;

  while (added < leaveLength) {
    if (isOffForOptimizer(current, ctx)) {
      current = addDays(current, 1);
      if (yearOf(current) !== ctx.year) return null;
      continue;
    }
    leaveDates.push(current);
    added++;
    current = addDays(current, 1);
    if (yearOf(current) !== ctx.year) break;
  }

  if (added < leaveLength) return null;

  let checkStart = startDate;
  let lookBack = addDays(startDate, -1);
  while (yearOf(lookBack) === ctx.year && isOffForOptimizer(lookBack, ctx)) {
    checkStart = lookBack;
    lookBack = addDays(lookBack, -1);
  }

  const totalOff = new Set<IsoDate>();
  let checkDate = checkStart;
  const leaveSet = new Set(leaveDates);
  while (yearOf(checkDate) === ctx.year) {
    if (isOffForOptimizer(checkDate, ctx) || leaveSet.has(checkDate)) {
      totalOff.add(checkDate);
      checkDate = addDays(checkDate, 1);
    } else {
      break;
    }
  }

  if (totalOff.size === 0) return null;

  return {
    startDate: checkStart,
    leaveDates,
    requiredLeaves: leaveLength,
    totalDaysOff: totalOff.size,
    efficiency: totalOff.size / leaveLength,
  };
}

function countConsecutivePaidLeaves(
  leaveDates: IsoDate[],
  ctx: OptimizerCtx,
): number {
  if (leaveDates.length === 0) return 0;

  const sorted = [...leaveDates].sort();
  const leaveSet = new Set(sorted);

  let maxRun = 0;
  let curRun = 0;
  let prev: IsoDate | null = null;

  for (const d of sorted) {
    if (prev === null) {
      curRun = 1;
    } else {
      let check = addDays(prev, 1);
      let broken = false;
      while (check < d) {
        if (ctx.nationalHolidays.has(check) || ctx.customHolidays.has(check)) {
          broken = true;
          break;
        }
        if (!isWeekend(check, ctx.weekendOverrides) && !leaveSet.has(check)) {
          broken = true;
          break;
        }
        check = addDays(check, 1);
      }
      if (broken) {
        maxRun = Math.max(maxRun, curRun);
        curRun = 1;
      } else {
        curRun++;
      }
    }
    prev = d;
  }

  return Math.max(maxRun, curRun);
}

function dayOfYear(iso: IsoDate): number {
  const { year, month, day } = parseIso(iso);
  let d = day;
  for (let m = 1; m < month; m++) d += daysInMonth(year, m);
  return d;
}

// "Longest stretch without any planned leave" within the calendar year.
// Used to penalize opportunities that would leave huge unbroken work stretches.
// Edges are measured against Jan 1 / Dec 31 of the same year - no wrap.
function maxLeaveGapDays(plannedLeaves: Set<IsoDate>, year: number): number {
  const totalDays = totalDaysInYear(year);
  if (plannedLeaves.size === 0) return totalDays;

  const doys = [...plannedLeaves]
    .filter(d => yearOf(d) === year)
    .map(d => dayOfYear(d))
    .sort((a, b) => a - b);
  if (doys.length === 0) return totalDays;

  let maxGap = Math.max(doys[0] - 1, totalDays - doys[doys.length - 1]);
  for (let i = 1; i < doys.length; i++) {
    const g = doys[i] - doys[i - 1] - 1;
    if (g > maxGap) maxGap = g;
  }
  return maxGap;
}

// Score = efficiency + a spread bonus. Spread bonus is in [0, 1] and
// rewards opportunities that REDUCE the longest leave-free stretch.
// Efficiency dominates when it differs by >= 1 (which is rare in practice -
// most ties are within 0.5); spread breaks ties cleanly.
function scoreOpportunity(
  opp: LeaveOpportunity,
  used: Set<IsoDate>,
  year: number,
): number {
  const totalDays = totalDaysInYear(year);
  const simulated = new Set<IsoDate>(used);
  for (const d of opp.leaveDates) simulated.add(d);
  const newMaxGap = maxLeaveGapDays(simulated, year);
  const spread = (totalDays - newMaxGap) / totalDays;
  return opp.efficiency + spread;
}

function pickBest(
  opportunities: LeaveOpportunity[],
  used: Set<IsoDate>,
  remaining: number,
  year: number,
  extraFilter: (opp: LeaveOpportunity) => boolean,
): LeaveOpportunity | null {
  let best: LeaveOpportunity | null = null;
  let bestScore = -Infinity;
  for (const opp of opportunities) {
    if (opp.requiredLeaves > remaining) continue;
    if (opp.leaveDates.some(d => used.has(d))) continue;
    if (!extraFilter(opp)) continue;
    const s = scoreOpportunity(opp, used, year);
    if (s > bestScore) {
      bestScore = s;
      best = opp;
    }
  }
  return best;
}

export function optimizeLeaves(
  state: PlanState,
  paidLeavesAmount: number,
  startDate: IsoDate,
  constraints: Constraints,
): { plannedLeaves: Set<IsoDate>; warning?: string } {
  const ctx: OptimizerCtx = {
    year: state.year,
    weekendOverrides: state.weekendOverrides,
    nationalHolidays: state.nationalHolidays,
    customHolidays: state.customHolidays,
  };

  const planned = new Set<IsoDate>();
  if (paidLeavesAmount === 0) return { plannedLeaves: planned };

  const allDays: IsoDate[] = [];
  let cur = startDate;
  while (yearOf(cur) === state.year) {
    allDays.push(cur);
    cur = addDays(cur, 1);
  }

  const opportunities: LeaveOpportunity[] = [];

  for (let i = 0; i < allDays.length; i++) {
    const opportunityStart = allDays[i];
    if (isOffForOptimizer(opportunityStart, ctx)) continue;

    const maxLen = Math.min(paidLeavesAmount, 20);
    for (let leaveLen = 1; leaveLen <= maxLen; leaveLen++) {
      if (constraints.minDaysOff10 && leaveLen < 10) continue;
      if (constraints.minDaysOff5 && leaveLen < 5) continue;

      const opp = evaluateOpportunity(opportunityStart, leaveLen, ctx);
      if (!opp) continue;
      if (opp.requiredLeaves > paidLeavesAmount) continue;
      if (constraints.maxDaysOff10 && opp.totalDaysOff > 10) continue;
      if (constraints.maxDaysOff5 && opp.totalDaysOff > 5) continue;
      if (constraints.maxDaysOff14 && opp.totalDaysOff > 14) continue;
      if (constraints.maxPaid10 && opp.requiredLeaves > 10) continue;
      if (constraints.maxPaid5 && opp.requiredLeaves > 5) continue;
      opportunities.push(opp);
    }
  }

  let remaining = paidLeavesAmount;
  const used = new Set<IsoDate>();

  // Satisfy minPaid first (one block), but pick the SPREAD-BEST candidate
  // among those that satisfy the consecutive-paid-leaves requirement.
  if (constraints.minPaid10 || constraints.minPaid5) {
    const required = constraints.minPaid10 ? 10 : 5;
    const opp = pickBest(opportunities, used, remaining, state.year, o =>
      countConsecutivePaidLeaves(o.leaveDates, ctx) >= required,
    );
    if (!opp) {
      return {
        plannedLeaves: new Set(),
        warning: `Cannot satisfy constraint: need ${required} paid leaves in a row`,
      };
    }
    for (const d of opp.leaveDates) {
      planned.add(d);
      used.add(d);
    }
    remaining -= opp.requiredLeaves;
  }

  // Greedy pick by score (efficiency + spread). Re-evaluates each pick against
  // the current used set, so each new block lands in the largest remaining gap
  // unless raw efficiency strongly outweighs it.
  while (remaining > 0) {
    const opp = pickBest(opportunities, used, remaining, state.year, o => {
      const cons = countConsecutivePaidLeaves(o.leaveDates, ctx);
      if (constraints.maxPaid10 && cons > 10) return false;
      if (constraints.maxPaid5 && cons > 5) return false;
      return true;
    });
    if (!opp) break;
    for (const d of opp.leaveDates) {
      planned.add(d);
      used.add(d);
    }
    remaining -= opp.requiredLeaves;
  }

  // Leftover fallback: when no min constraint is set and there are still leaves
  // unused, place them on the single-day bridges that score best.
  const minActive =
    constraints.minDaysOff10 ||
    constraints.minDaysOff5 ||
    constraints.minPaid10 ||
    constraints.minPaid5;
  if (remaining > 0 && !minActive) {
    while (remaining > 0) {
      const opp = pickBest(
        opportunities,
        used,
        remaining,
        state.year,
        o => o.requiredLeaves === 1,
      );
      if (!opp) break;
      planned.add(opp.leaveDates[0]);
      used.add(opp.leaveDates[0]);
      remaining--;
    }
  }

  return { plannedLeaves: planned };
}

export function isBridgeDay(
  date: IsoDate,
  s: Pick<PlanState, "nationalHolidays" | "customHolidays" | "plannedLeaves" | "weekendOverrides">,
): boolean {
  const offDay = (d: IsoDate) =>
    isWeekend(d, s.weekendOverrides) ||
    s.nationalHolidays.has(d) ||
    s.customHolidays.has(d) ||
    s.plannedLeaves.has(d);

  if (offDay(date)) return false;

  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  if (!offDay(prev) || !offDay(next)) return false;

  const year = yearOf(date);
  let total = 1;

  let walkBack = prev;
  while (yearOf(walkBack) === year && offDay(walkBack)) {
    total++;
    walkBack = addDays(walkBack, -1);
  }

  let walkForward = next;
  while (yearOf(walkForward) === year && offDay(walkForward)) {
    total++;
    walkForward = addDays(walkForward, 1);
  }

  return total >= 4;
}
