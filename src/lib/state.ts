import type { IsoDate } from "./dateUtils";
import { isNaturalWeekend } from "./dateUtils";

export interface Constraints {
  minDaysOff5: boolean;
  minDaysOff10: boolean;
  maxDaysOff5: boolean;
  maxDaysOff10: boolean;
  maxDaysOff14: boolean;
  minPaid5: boolean;
  minPaid10: boolean;
  maxPaid5: boolean;
  maxPaid10: boolean;
}

export interface PlanState {
  year: number;
  countryCode: string;
  nationalHolidays: Set<IsoDate>;
  customHolidays: Set<IsoDate>;
  plannedLeaves: Set<IsoDate>;
  halfDayLeaves: Set<IsoDate>;
  weekendOverrides: Set<IsoDate>;
  paidLeavesAmount: string;
  calculateFrom: IsoDate;
  weekStartsMonday: boolean;
  constraints: Constraints;
}

export interface PlanFile {
  year: number;
  countryCode: string;
  nationalHolidays: IsoDate[];
  customHolidays: IsoDate[];
  plannedLeaves: IsoDate[];
  halfDayLeaves: IsoDate[];
  weekendOverrides: IsoDate[];
  paidLeavesAmount: string;
  calculateFrom: IsoDate;
  weekStartsMonday: boolean;
  constraints: Constraints;
}

export function makeEmptyConstraints(): Constraints {
  return {
    minDaysOff5: false, minDaysOff10: false,
    maxDaysOff5: false, maxDaysOff10: false, maxDaysOff14: false,
    minPaid5: false,    minPaid10: false,
    maxPaid5: false,    maxPaid10: false,
  };
}

export function planToFile(s: PlanState): PlanFile {
  return {
    year: s.year,
    countryCode: s.countryCode,
    nationalHolidays: [...s.nationalHolidays],
    customHolidays: [...s.customHolidays],
    plannedLeaves: [...s.plannedLeaves],
    halfDayLeaves: [...s.halfDayLeaves],
    weekendOverrides: [...s.weekendOverrides],
    paidLeavesAmount: s.paidLeavesAmount,
    calculateFrom: s.calculateFrom,
    weekStartsMonday: s.weekStartsMonday,
    constraints: s.constraints,
  };
}

export function fileToPlan(f: PlanFile): PlanState {
  return {
    year: f.year,
    countryCode: f.countryCode,
    nationalHolidays: new Set(f.nationalHolidays ?? []),
    customHolidays: new Set(f.customHolidays ?? []),
    plannedLeaves: new Set(f.plannedLeaves ?? []),
    halfDayLeaves: new Set(f.halfDayLeaves ?? []),
    weekendOverrides: new Set(f.weekendOverrides ?? []),
    paidLeavesAmount: f.paidLeavesAmount ?? "20",
    calculateFrom: f.calculateFrom,
    weekStartsMonday: f.weekStartsMonday ?? true,
    constraints: f.constraints ?? makeEmptyConstraints(),
  };
}

export function isWeekend(date: IsoDate, weekendOverrides: Set<IsoDate>): boolean {
  return isNaturalWeekend(date) && !weekendOverrides.has(date);
}

export function isOffDay(date: IsoDate, s: Pick<PlanState, "nationalHolidays" | "customHolidays" | "plannedLeaves" | "weekendOverrides">): boolean {
  return (
    isWeekend(date, s.weekendOverrides) ||
    s.nationalHolidays.has(date) ||
    s.customHolidays.has(date) ||
    s.plannedLeaves.has(date)
  );
}
