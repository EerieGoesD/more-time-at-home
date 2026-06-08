import { useEffect, useMemo, useState, useRef } from "react";
import "./App.css";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import type { IsoDate } from "./lib/dateUtils";
import {
  isoFromYMD,
  parseIso,
  addDays,
  dayOfWeek,
  daysInMonth,
  totalDaysInYear,
  isNaturalWeekend,
  monthName,
  todayIso,
  formatShort,
} from "./lib/dateUtils";
import { COUNTRIES, COUNTRY_NAMES } from "./lib/countries";
import { fetchHolidays } from "./lib/holidays";
import type { PlanState, PlanFile, Constraints } from "./lib/state";
import {
  makeEmptyConstraints,
  planToFile,
  fileToPlan,
  isWeekend,
} from "./lib/state";
import { optimizeLeaves, isBridgeDay } from "./lib/optimizer";
import { generateIcs, groupConsecutiveDates } from "./lib/ics";

const SETTINGS_KEY = "more-time-at-home.settings";
const APP_VERSION = "1.0.12";

interface AppSettings {
  remindersEnabled: boolean;
  daysBefore: number;
  notifiedStarts: IsoDate[];
  lastIcsExportPath: string | null;
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return {
        remindersEnabled: true,
        daysBefore: 7,
        notifiedStarts: [],
        lastIcsExportPath: null,
        ...JSON.parse(raw),
      };
    }
  } catch { /* ignore */ }
  return { remindersEnabled: true, daysBefore: 7, notifiedStarts: [], lastIcsExportPath: null };
}

function saveSettings(s: AppSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const INITIAL_YEAR = new Date().getFullYear();

function initialState(): PlanState {
  return {
    year: INITIAL_YEAR,
    countryCode: "US",
    nationalHolidays: new Set(),
    customHolidays: new Set(),
    plannedLeaves: new Set(),
    halfDayLeaves: new Set(),
    weekendOverrides: new Set(),
    paidLeavesAmount: "20",
    calculateFrom: isoFromYMD(INITIAL_YEAR, 1, 1),
    weekStartsMonday: true,
    constraints: makeEmptyConstraints(),
  };
}

const YEARS = (() => {
  const arr: number[] = [];
  for (let y = INITIAL_YEAR - 2; y <= INITIAL_YEAR + 5; y++) arr.push(y);
  return arr;
})();

export default function App() {
  const [state, setState] = useState<PlanState>(initialState);
  const [status, setStatus] = useState("Ready");
  const [optimizing, setOptimizing] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const settingsRef = useRef<AppSettings>(loadSettings());

  useEffect(() => {
    void loadHolidaysFor(state.year, state.countryCode);
    void requestNotificationPermissionOnce();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHolidaysFor = async (year: number, countryCode: string) => {
    setStatus("Loading holidays...");
    try {
      const dates = await fetchHolidays(year, countryCode);
      setState(s => ({
        ...s,
        year,
        countryCode,
        nationalHolidays: new Set(dates),
        plannedLeaves: new Set(),
        halfDayLeaves: new Set(),
      }));
      setStatus(`Loaded ${dates.length} national holidays for ${year}`);
    } catch (e) {
      setStatus(`Error fetching holidays: ${(e as Error).message}`);
    }
  };

  const markPlanChanged = () => {
    if (settingsRef.current.lastIcsExportPath) {
      setStatus("Plan changed since last export - press Export .ICS to refresh your calendar file.");
    }
  };

  const onYearChange = (y: number) => {
    const cur = parseIso(state.calculateFrom);
    setState(s => ({ ...s, year: y, calculateFrom: isoFromYMD(y, cur.month, cur.day) }));
    void loadHolidaysFor(y, state.countryCode);
  };

  const onCountryChange = (name: string) => {
    void loadHolidaysFor(state.year, COUNTRIES[name]);
  };

  const onCellClick = (date: IsoDate) => {
    setState(s => {
      const ns: PlanState = {
        ...s,
        nationalHolidays: new Set(s.nationalHolidays),
        customHolidays: new Set(s.customHolidays),
        plannedLeaves: new Set(s.plannedLeaves),
        halfDayLeaves: new Set(s.halfDayLeaves),
        weekendOverrides: new Set(s.weekendOverrides),
      };
      const natural = isNaturalWeekend(date);
      const wasNational = ns.nationalHolidays.has(date);
      const wasCustom = ns.customHolidays.has(date);
      const wasPlanned = ns.plannedLeaves.has(date);
      const wasWorkingWeekend = ns.weekendOverrides.has(date);

      ns.nationalHolidays.delete(date);
      ns.customHolidays.delete(date);
      ns.plannedLeaves.delete(date);
      ns.halfDayLeaves.delete(date);

      if (wasPlanned) {
        if (natural) ns.weekendOverrides.add(date);
      } else if (natural && !wasWorkingWeekend && !wasNational && !wasCustom) {
        ns.plannedLeaves.add(date);
      } else if (natural && wasWorkingWeekend) {
        ns.weekendOverrides.delete(date);
      } else if (wasCustom) {
        ns.plannedLeaves.add(date);
      } else if (wasNational) {
        ns.customHolidays.add(date);
      } else {
        ns.nationalHolidays.add(date);
      }
      return ns;
    });
    markPlanChanged();
  };

  const onCellRightClick = (date: IsoDate, e: React.MouseEvent) => {
    e.preventDefault();
    if (!state.plannedLeaves.has(date)) return;
    setState(s => {
      const half = new Set(s.halfDayLeaves);
      if (half.has(date)) half.delete(date);
      else half.add(date);
      return { ...s, halfDayLeaves: half };
    });
    markPlanChanged();
  };

  const onOptimize = async () => {
    const amount = parseInt(state.paidLeavesAmount, 10);
    if (Number.isNaN(amount) || amount < 0) {
      setStatus("Enter a valid number of paid leaves.");
      return;
    }
    setOptimizing(true);
    setStatus("Calculating optimal leave distribution...");
    let startDate = state.calculateFrom;
    const sd = parseIso(startDate);
    if (sd.year !== state.year) {
      startDate = isoFromYMD(state.year, sd.month, sd.day);
    }
    await new Promise(r => setTimeout(r, 0));
    const { plannedLeaves, warning } = optimizeLeaves(state, amount, startDate, state.constraints);
    setState(s => ({ ...s, plannedLeaves, halfDayLeaves: new Set() }));
    setOptimizing(false);
    setStatus(warning ?? "Optimization complete!");
    markPlanChanged();
  };

  const onSave = async () => {
    const path = await save({
      defaultPath: `HolidayPlan_${state.year}_${state.countryCode}.hplan`,
      filters: [{ name: "Holiday Plan", extensions: ["hplan"] }],
    });
    if (!path) return;
    try {
      await writeTextFile(path, JSON.stringify(planToFile(state), null, 2));
      setStatus("Plan saved successfully");
    } catch (e) {
      setStatus(`Error saving plan: ${(e as Error).message}`);
    }
  };

  const onLoad = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Holiday Plan", extensions: ["hplan"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const text = await readTextFile(selected as string);
      const file = JSON.parse(text) as PlanFile;
      setState(fileToPlan(file));
      setStatus("Plan loaded successfully");
      markPlanChanged();
    } catch (e) {
      setStatus(`Error loading plan: ${(e as Error).message}`);
    }
  };

  const onExportIcs = async () => {
    if (state.plannedLeaves.size === 0) {
      setStatus("No planned leaves to export. Run the optimizer first or click dates manually.");
      return;
    }
    const path = await save({
      defaultPath: settingsRef.current.lastIcsExportPath ?? `LeavePlan_${state.year}_${state.countryCode}.ics`,
      filters: [{ name: "iCalendar file", extensions: ["ics"] }],
    });
    if (!path) return;
    try {
      const ics = generateIcs(state);
      await writeTextFile(path, ics);
      settingsRef.current = { ...settingsRef.current, lastIcsExportPath: path };
      saveSettings(settingsRef.current);
      setStatus(`Exported ${state.plannedLeaves.size} leave days to .ICS`);
      try { await openPath(path); } catch { /* user may decline */ }
    } catch (e) {
      setStatus(`Error exporting: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    const tick = async () => {
      const s = settingsRef.current;
      if (!s.remindersEnabled || state.plannedLeaves.size === 0) return;
      const today = todayIso();
      const target = addDays(today, Math.max(0, s.daysBefore));
      const sorted = [...state.plannedLeaves].sort();
      const blocks = groupConsecutiveDates(sorted, state);
      let updated = false;
      for (const block of blocks) {
        const start = block[0];
        if (start !== target) continue;
        if (s.notifiedStarts.includes(start)) continue;
        try {
          const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
          if (!granted) continue;
          const body = block.length === 1
            ? `Planned leave starts in ${s.daysBefore} day(s): ${formatShort(start)}`
            : `${block.length}-day planned leave starts in ${s.daysBefore} day(s): ${formatShort(start)}`;
          await sendNotification({ title: "More Time at Home", body });
          s.notifiedStarts.push(start);
          updated = true;
        } catch { /* ignore */ }
      }
      if (updated) saveSettings(s);
    };
    void tick();
    const id = setInterval(tick, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [state]);

  const stats = useMemo(() => {
    const total = totalDaysInYear(state.year);
    let off = 0;
    let weekendsHolidays = 0;
    for (let m = 1; m <= 12; m++) {
      const dim = daysInMonth(state.year, m);
      for (let d = 1; d <= dim; d++) {
        const iso = isoFromYMD(state.year, m, d);
        const w = isWeekend(iso, state.weekendOverrides);
        const nh = state.nationalHolidays.has(iso);
        const ch = state.customHolidays.has(iso);
        const pl = state.plannedLeaves.has(iso);
        if (w || nh || ch || pl) off++;
        if (w || nh || ch) weekendsHolidays++;
      }
    }
    const working = total - off;
    const halfCount = [...state.halfDayLeaves].filter(d => state.plannedLeaves.has(d)).length;
    const usedLeaves = state.plannedLeaves.size - halfCount * 0.5;
    const efficiency = usedLeaves > 0 ? (off - weekendsHolidays) / usedLeaves : 0;
    return { off, working, total, usedLeaves, halfCount, efficiency };
  }, [state]);

  return (
    <div className="app">
      <ControlsPanel
        state={state}
        setState={setState}
        onYearChange={onYearChange}
        onCountryChange={onCountryChange}
        onOptimize={onOptimize}
        onSave={onSave}
        onLoad={onLoad}
        onClear={() => setShowClear(true)}
        onExportIcs={onExportIcs}
        onHowTo={() => setShowHowTo(true)}
        onReminders={() => setShowReminders(true)}
        onDebug={() => setShowDebug(true)}
        optimizing={optimizing}
      />

      <div className="calendar-scroll">
        <div className="calendar-grid">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <MonthPanel
              key={m}
              month={m}
              state={state}
              onCellClick={onCellClick}
              onCellRightClick={onCellRightClick}
            />
          ))}
        </div>
      </div>

      <div className="statistics">
        Statistics for {state.year}: Paid Leaves Used: {fmtNum(stats.usedLeaves)}/{state.paidLeavesAmount}
        {stats.halfCount > 0 ? ` (${stats.halfCount} half-day)` : ""} | National Holidays: {state.nationalHolidays.size} |
        Custom Holidays: {state.customHolidays.size} | Total Days Off: {stats.off} ({((stats.off * 100) / stats.total).toFixed(1)}%) |
        Working Days: {stats.working} | Efficiency: {stats.efficiency.toFixed(2)} extra days per leave
      </div>

      <div className="status-bar">
        <span>{status}</span>
        <div className="legend">
          <span style={{ fontWeight: 600 }}>Legend:</span>
          <span className="legend-chip" style={{ background: "#4cc9f0", color: "#fff" }}>National</span>
          <span className="legend-chip" style={{ background: "#90ee90", color: "#1a5f1a" }}>Planned</span>
          <span className="legend-chip" style={{ background: "#f9c74f", color: "#5a3d0f" }}>Weekend</span>
          <span className="legend-chip" style={{ background: "#ff6b6b", color: "#fff" }}>Holiday+Weekend</span>
          <span className="legend-chip" style={{ background: "#ffc0cb", color: "#8b3a62" }}>Custom</span>
          <span className="legend-chip" style={{ background: "#b39ddb", color: "#311b92" }}>Bridge</span>
          <a href="#" onClick={e => { e.preventDefault(); void openUrl("https://date.nager.at"); }}>
            Nager.Date API
          </a>
        </div>
      </div>

      <div className="footer">
        <a href="#" onClick={e => { e.preventDefault(); void openUrl("https://eeriegoesd.com/"); }}>
          Made by <span style={{ color: "#90EE90", fontWeight: 600 }}>EERIE</span>
        </a>
        <a
          href="#"
          onClick={e => {
            e.preventDefault();
            void openUrl("https://github.com/EerieGoesD/more-time-at-home/issues/new?template=bug_report.md");
          }}
        >
          Report Issue
        </a>
        <a
          href="#"
          onClick={e => {
            e.preventDefault();
            void openUrl("https://github.com/EerieGoesD/more-time-at-home/discussions");
          }}
        >
          Feedback
        </a>
        <a
          href="#"
          onClick={e => {
            e.preventDefault();
            void openUrl("https://github.com/EerieGoesD/more-time-at-home/issues/new?template=feature_request.md");
          }}
        >
          Suggest Feature
        </a>
        <a
          href="#"
          onClick={e => { e.preventDefault(); void openUrl("https://buymeacoffee.com/eeriegoesd"); }}
          style={{ color: "#facc15" }}
        >
          ☕ Support This Project
        </a>
      </div>

      {showHowTo && <HowToModal onClose={() => setShowHowTo(false)} />}
      {showReminders && (
        <RemindersModal
          settings={settingsRef.current}
          onClose={() => setShowReminders(false)}
          onSave={s => {
            settingsRef.current = s;
            saveSettings(s);
            setShowReminders(false);
          }}
        />
      )}
      {showClear && (
        <ClearModal
          onClose={() => setShowClear(false)}
          onClear={opts => {
            setState(s => ({
              ...s,
              weekendOverrides: opts.weekends ? new Set() : s.weekendOverrides,
              nationalHolidays: opts.national ? new Set() : s.nationalHolidays,
              customHolidays: opts.custom ? new Set() : s.customHolidays,
              plannedLeaves: opts.planned ? new Set() : s.plannedLeaves,
              halfDayLeaves: opts.planned ? new Set() : s.halfDayLeaves,
            }));
            setStatus("Cleared selected items");
            markPlanChanged();
            setShowClear(false);
          }}
        />
      )}
      {showDebug && (
        <DebugModal
          state={state}
          stats={stats}
          settings={settingsRef.current}
          onClose={() => setShowDebug(false)}
        />
      )}
    </div>
  );
}

function fmtNum(n: number): string {
  return n % 1 === 0 ? n.toString() : n.toFixed(1);
}

async function requestNotificationPermissionOnce() {
  try {
    if (!(await isPermissionGranted())) await requestPermission();
  } catch { /* ignore */ }
}

interface ControlsProps {
  state: PlanState;
  setState: React.Dispatch<React.SetStateAction<PlanState>>;
  onYearChange: (y: number) => void;
  onCountryChange: (name: string) => void;
  onOptimize: () => void;
  onSave: () => void;
  onLoad: () => void;
  onClear: () => void;
  onExportIcs: () => void;
  onHowTo: () => void;
  onReminders: () => void;
  onDebug: () => void;
  optimizing: boolean;
}

function ControlsPanel(p: ControlsProps) {
  const currentCountryName =
    Object.entries(COUNTRIES).find(([, v]) => v === p.state.countryCode)?.[0] ?? "United States";

  return (
    <div className="controls">
      <div className="controls-row">
        <label>Year:</label>
        <select value={p.state.year} onChange={e => p.onYearChange(parseInt(e.target.value, 10))}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <label>Country:</label>
        <select value={currentCountryName} onChange={e => p.onCountryChange(e.target.value)}>
          {COUNTRY_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <label>Week starts:</label>
        <select
          value={p.state.weekStartsMonday ? "mon" : "sun"}
          onChange={e => p.setState(s => ({ ...s, weekStartsMonday: e.target.value === "mon" }))}
        >
          <option value="mon">Mon → Sun</option>
          <option value="sun">Sun → Sat</option>
        </select>
      </div>

      <div className="controls-row">
        <label>Paid leaves:</label>
        <input
          type="number"
          min={0}
          value={p.state.paidLeavesAmount}
          onChange={e => p.setState(s => ({ ...s, paidLeavesAmount: e.target.value }))}
          style={{ width: 70 }}
        />
        <label>Calculate from:</label>
        <input
          type="date"
          value={p.state.calculateFrom}
          onChange={e => p.setState(s => ({ ...s, calculateFrom: e.target.value }))}
        />
      </div>

      <ConstraintsBox state={p.state} setState={p.setState} />

      <div className="button-row">
        <button className="btn btn-primary" disabled={p.optimizing} onClick={p.onOptimize}>🎯 Optimize</button>
        <button className="btn btn-secondary" onClick={p.onHowTo}>❓ How to</button>
        <button className="btn" onClick={p.onSave}>💾 Save</button>
        <button className="btn" onClick={p.onLoad}>📂 Load</button>
        <button className="btn" onClick={p.onClear}>🗑️ Clear</button>
        <span className="divider" />
        <button className="btn btn-info" onClick={p.onExportIcs}>📅 Export .ICS</button>
        <button className="btn btn-purple" onClick={() => window.print()}>🖨️ Print / PDF</button>
        <span className="divider" />
        <button className="btn btn-orange" onClick={p.onReminders}>🔔 Reminders</button>
        <button className="btn" onClick={p.onDebug} title="Open a copyable snapshot of the current state, for bug reports.">🐛 Debug</button>
      </div>
    </div>
  );
}

function ConstraintsBox({
  state, setState,
}: {
  state: PlanState;
  setState: React.Dispatch<React.SetStateAction<PlanState>>;
}) {
  const set = (patch: Partial<Constraints>) =>
    setState(s => ({ ...s, constraints: { ...s.constraints, ...patch } }));

  const c = state.constraints;

  return (
    <div className="constraints-box">
      <div className="constraints-header">
        Constraints: <span className="hint">(must have at least once per year)</span>
      </div>
      <div className="constraint-grid">
        <div className="row-label">Days Off:<small>(in a row)</small></div>
        <div className="constraint-cell">
          <span>Min 5</span>
          <input type="checkbox" checked={c.minDaysOff5} onChange={e => set({ minDaysOff5: e.target.checked })} />
        </div>
        <div className="constraint-cell">
          <span>Min 10</span>
          <input
            type="checkbox"
            checked={c.minDaysOff10}
            onChange={e => set({ minDaysOff10: e.target.checked, minDaysOff5: e.target.checked || c.minDaysOff5 })}
          />
        </div>
        <div className="constraint-cell max">
          <span>Max 5</span>
          <input
            type="checkbox"
            checked={c.maxDaysOff5}
            onChange={e => set({
              maxDaysOff5: e.target.checked,
              maxDaysOff10: e.target.checked ? false : c.maxDaysOff10,
              maxDaysOff14: e.target.checked ? false : c.maxDaysOff14,
            })}
          />
        </div>
        <div className="constraint-cell max">
          <span>Max 10</span>
          <input
            type="checkbox"
            checked={c.maxDaysOff10}
            onChange={e => set({
              maxDaysOff10: e.target.checked,
              maxDaysOff5: e.target.checked ? false : c.maxDaysOff5,
              maxDaysOff14: e.target.checked ? false : c.maxDaysOff14,
            })}
          />
        </div>
        <div className="constraint-cell max">
          <span>Max 14</span>
          <input
            type="checkbox"
            checked={c.maxDaysOff14}
            onChange={e => set({
              maxDaysOff14: e.target.checked,
              maxDaysOff5: e.target.checked ? false : c.maxDaysOff5,
              maxDaysOff10: e.target.checked ? false : c.maxDaysOff10,
            })}
          />
        </div>
        <div />

        <div className="row-label">Paid Leaves:<small>(in a row)</small></div>
        <div className="constraint-cell">
          <span>Min 5</span>
          <input type="checkbox" checked={c.minPaid5} onChange={e => set({ minPaid5: e.target.checked })} />
        </div>
        <div className="constraint-cell">
          <span>Min 10</span>
          <input
            type="checkbox"
            checked={c.minPaid10}
            onChange={e => set({ minPaid10: e.target.checked, minPaid5: e.target.checked || c.minPaid5 })}
          />
        </div>
        <div className="constraint-cell max">
          <span>Max 5</span>
          <input
            type="checkbox"
            checked={c.maxPaid5}
            onChange={e => set({ maxPaid5: e.target.checked, maxPaid10: e.target.checked ? false : c.maxPaid10 })}
          />
        </div>
        <div className="constraint-cell max">
          <span>Max 10</span>
          <input
            type="checkbox"
            checked={c.maxPaid10}
            onChange={e => set({ maxPaid10: e.target.checked, maxPaid5: e.target.checked ? false : c.maxPaid5 })}
          />
        </div>
        <div />
        <div />
      </div>
      <div className="constraint-note">
        • Days Off = total consecutive days off (includes weekends &amp; holidays) • Paid Leaves = consecutive paid leave days (excluding weekends &amp; holidays)
      </div>
    </div>
  );
}

function MonthPanel({
  month, state, onCellClick, onCellRightClick,
}: {
  month: number;
  state: PlanState;
  onCellClick: (d: IsoDate) => void;
  onCellRightClick: (d: IsoDate, e: React.MouseEvent) => void;
}) {
  const dayNames = state.weekStartsMonday
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const first = isoFromYMD(state.year, month, 1);
  const dim = daysInMonth(state.year, month);
  const startCol = state.weekStartsMonday
    ? ((dayOfWeek(first) + 6) % 7)
    : dayOfWeek(first);

  const totalCells = Math.ceil((startCol + dim) / 7) * 7;
  const cells: (IsoDate | null)[] = [];
  let day = 1;
  for (let i = 0; i < totalCells; i++) {
    if (i < startCol || day > dim) cells.push(null);
    else { cells.push(isoFromYMD(state.year, month, day)); day++; }
  }

  return (
    <div className="month">
      <div className="month-header">{monthName(state.year, month)}</div>
      <div className="dow-row">
        {dayNames.map(n => <div key={n} className="dow-cell">{n}</div>)}
      </div>
      <div className="day-grid">
        {cells.map((iso, i) =>
          iso === null ? (
            <div key={i} className="day-cell empty" />
          ) : (
            <DayCell key={iso} date={iso} state={state} onClick={onCellClick} onContext={onCellRightClick} />
          ),
        )}
      </div>
    </div>
  );
}

function DayCell({
  date, state, onClick, onContext,
}: {
  date: IsoDate;
  state: PlanState;
  onClick: (d: IsoDate) => void;
  onContext: (d: IsoDate, e: React.MouseEvent) => void;
}) {
  const { day } = parseIso(date);
  const planned = state.plannedLeaves.has(date);
  const custom = state.customHolidays.has(date);
  const national = state.nationalHolidays.has(date);
  const natural = isNaturalWeekend(date);
  const override = state.weekendOverrides.has(date);
  const half = planned && state.halfDayLeaves.has(date);

  let cls = "day-cell";
  let title = "";
  if (planned) {
    cls += half ? " planned half" : " planned";
    title = half
      ? "Planned leave (half day). Right-click to switch to full day."
      : "Planned leave (full day). Right-click to mark as half day.";
  } else if (custom) {
    cls += " custom";
  } else if (national && natural && !override) {
    cls += " national-on-weekend";
  } else if (national) {
    cls += " national";
  } else if (natural && !override) {
    cls += " weekend";
  } else if (state.plannedLeaves.size === 0 && isBridgeDay(date, state)) {
    cls += " bridge";
    title = "Bridge day - take 1 leave here to chain ≥4 consecutive days off. (Hidden after you have planned leaves.)";
  }

  return (
    <div className={cls} title={title} onClick={() => onClick(date)} onContextMenu={e => onContext(date, e)}>
      {half ? `${day}½` : day}
    </div>
  );
}

function HowToModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>How to Use More Time at Home</h2>
        <h3>Setup</h3>
        <p>1. Pick the Year and Country. National holidays auto-load.<br/>
           2. Enter how many Paid Leaves you have per year.<br/>
           3. Set 'Calculate from' if you want to start later in the year.</p>
        <h3>Calendar Colors</h3>
        <p>White = Working day · Blue = National Holiday · Pink = Custom Holiday (force a Planned Leave here) ·
           Green = Planned Leave · Yellow = Weekend · Red = Holiday on weekend · Peach = Bridge Day (single workday between off-days).</p>
        <h3>Click Behavior</h3>
        <p>Left-click cycles through types. Right-click a green Planned Leave to toggle it as a half-day.</p>
        <h3>Constraints</h3>
        <p>Min X = optimizer only creates blocks with at least X consecutive days. Max X = caps blocks at X.</p>
        <h3>Reminders</h3>
        <p>The 🔔 Reminders dialog shows a desktop notification a configurable number of days before each planned leave block. App must be running. Exported .ICS events also include a 7-day calendar alarm.</p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

function RemindersModal({
  settings, onClose, onSave,
}: {
  settings: AppSettings;
  onClose: () => void;
  onSave: (s: AppSettings) => void;
}) {
  const [enabled, setEnabled] = useState(settings.remindersEnabled);
  const [days, setDays] = useState(settings.daysBefore.toString());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Tray Reminders</h2>
        <p>Show a desktop notification before each planned leave block.</p>
        <label>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable reminders
        </label>
        <label>
          Notify
          <input
            type="number"
            min={0}
            max={365}
            value={days}
            onChange={e => setDays(e.target.value)}
            style={{ width: 60, margin: "0 6px" }}
          />
          day(s) before each leave block starts.
        </label>
        <p style={{ color: "#666" }}>
          App must be running for desktop notifications. For reminders that work without the app, use Export .ICS - the calendar event has a built-in 7-day alarm.
        </p>
        <div className="modal-actions">
          <button
            className="btn"
            onClick={async () => {
              try {
                const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
                if (!granted) return;
                await sendNotification({
                  title: "More Time at Home",
                  body: "Test reminder - this is how upcoming leave alerts will look.",
                });
              } catch { /* ignore */ }
            }}
          >
            Test now
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              const d = parseInt(days, 10);
              if (Number.isNaN(d) || d < 0 || d > 365) return;
              onSave({ ...settings, remindersEnabled: enabled, daysBefore: d });
            }}
          >
            Save
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

interface Stats {
  off: number;
  working: number;
  total: number;
  usedLeaves: number;
  halfCount: number;
  efficiency: number;
}

function DebugModal({
  state, stats, settings, onClose,
}: {
  state: PlanState;
  stats: Stats;
  settings: AppSettings;
  onClose: () => void;
}) {
  const snapshot = useMemo(() => buildDebugText(state, stats, settings), [state, stats, settings]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snapshot);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.getElementById("debug-textarea") as HTMLTextAreaElement | null;
      if (ta) { ta.select(); document.execCommand("copy"); }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 560, maxWidth: 760 }} onClick={e => e.stopPropagation()}>
        <h2>Debug Snapshot</h2>
        <p style={{ color: "#666" }}>
          Paste this into a GitHub issue or email when reporting a bug. Contains your current inputs, computed statistics, and reminder settings. Does NOT contain personal data beyond what you typed into the app.
        </p>
        <textarea
          id="debug-textarea"
          readOnly
          value={snapshot}
          style={{ width: "100%", height: 360, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11, padding: 8 }}
          onFocus={e => e.currentTarget.select()}
        />
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={copy}>{copied ? "Copied ✓" : "Copy to clipboard"}</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function buildDebugText(state: PlanState, stats: Stats, settings: AppSettings): string {
  const countryName =
    Object.entries(COUNTRIES).find(([, v]) => v === state.countryCode)?.[0] ?? "(unknown)";
  const ts = new Date().toISOString();
  const c = state.constraints;

  const sample = (s: Set<string>, n = 50): string => {
    if (s.size === 0) return "(none)";
    const arr = [...s].sort();
    if (arr.length <= n) return arr.join(", ");
    return `${arr.slice(0, n).join(", ")}  ... (+${arr.length - n} more)`;
  };

  const yesno = (b: boolean) => (b ? "yes" : "no");

  return [
    "=== More Time at Home - Debug Snapshot ===",
    `Generated:    ${ts}`,
    `App version:  ${APP_VERSION}`,
    `User agent:   ${navigator.userAgent}`,
    "",
    "--- User inputs ---",
    `Year:            ${state.year}`,
    `Country:         ${countryName} (${state.countryCode})`,
    `Week starts:     ${state.weekStartsMonday ? "Monday" : "Sunday"}`,
    `Paid leaves:     ${state.paidLeavesAmount}`,
    `Calculate from:  ${state.calculateFrom}`,
    "",
    "--- Constraints ---",
    `Days Off  Min 5:   ${yesno(c.minDaysOff5)}`,
    `Days Off  Min 10:  ${yesno(c.minDaysOff10)}`,
    `Days Off  Max 5:   ${yesno(c.maxDaysOff5)}`,
    `Days Off  Max 10:  ${yesno(c.maxDaysOff10)}`,
    `Days Off  Max 14:  ${yesno(c.maxDaysOff14)}`,
    `Paid Leaves Min 5:  ${yesno(c.minPaid5)}`,
    `Paid Leaves Min 10: ${yesno(c.minPaid10)}`,
    `Paid Leaves Max 5:  ${yesno(c.maxPaid5)}`,
    `Paid Leaves Max 10: ${yesno(c.maxPaid10)}`,
    "",
    "--- Statistics ---",
    `Paid leaves used:  ${stats.usedLeaves} (${stats.halfCount} half-day)`,
    `National holidays: ${state.nationalHolidays.size}`,
    `Custom holidays:   ${state.customHolidays.size}`,
    `Planned leaves:    ${state.plannedLeaves.size}`,
    `Half-day leaves:   ${state.halfDayLeaves.size}`,
    `Weekend overrides: ${state.weekendOverrides.size}`,
    `Total days off:    ${stats.off} (${((stats.off * 100) / stats.total).toFixed(1)}%)`,
    `Working days:      ${stats.working}`,
    `Total days/year:   ${stats.total}`,
    `Efficiency:        ${stats.efficiency.toFixed(2)} extra days per leave`,
    "",
    "--- Reminders settings ---",
    `Enabled:           ${yesno(settings.remindersEnabled)}`,
    `Days before:       ${settings.daysBefore}`,
    `Last ICS export:   ${settings.lastIcsExportPath ?? "(none)"}`,
    `Notified starts:   ${settings.notifiedStarts.length === 0 ? "(none)" : settings.notifiedStarts.join(", ")}`,
    "",
    "--- Date sets ---",
    `National holidays: ${sample(state.nationalHolidays)}`,
    `Custom holidays:   ${sample(state.customHolidays)}`,
    `Planned leaves:    ${sample(state.plannedLeaves)}`,
    `Half-day leaves:   ${sample(state.halfDayLeaves)}`,
    `Weekend overrides: ${sample(state.weekendOverrides)}`,
    "",
    "=== End ===",
  ].join("\n");
}

function ClearModal({
  onClose, onClear,
}: {
  onClose: () => void;
  onClear: (opts: { weekends: boolean; national: boolean; custom: boolean; planned: boolean }) => void;
}) {
  const [weekends, setWeekends] = useState(false);
  const [national, setNational] = useState(false);
  const [custom, setCustom] = useState(true);
  const [planned, setPlanned] = useState(true);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Clear Options</h2>
        <label><input type="checkbox" checked={weekends} onChange={e => setWeekends(e.target.checked)} /> Weekend overrides</label>
        <label><input type="checkbox" checked={national} onChange={e => setNational(e.target.checked)} /> National holidays</label>
        <label><input type="checkbox" checked={custom} onChange={e => setCustom(e.target.checked)} /> Custom holidays</label>
        <label><input type="checkbox" checked={planned} onChange={e => setPlanned(e.target.checked)} /> Planned leaves</label>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => onClear({ weekends, national, custom, planned })}>OK</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
