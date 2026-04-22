/**
 * Pure helpers for the weekly Capacity Planner.
 *
 * Everything here is deterministic and free of I/O so we can unit-test
 * the math (weeks, overlap, utilization, color palette) without
 * spinning up the DB. The HTTP route (`server/routes/capacity.js`) is
 * the only thing that runs queries; all derivation lives here.
 *
 * Domain choices:
 *
 *   • Weeks are ISO (Mon→Sun). Given any calendar date, `mondayOf`
 *     returns the Monday of that week in UTC so timezone drift on the
 *     EC2 host never shifts the bars.
 *
 *   • An assignment contributes its full `weekly_hours` to every week
 *     that overlaps `[start_date, end_date]` by at least one day.
 *     This mirrors how Runn/Clockify render allocations — people are
 *     booked by week, not by day. Partial-week days are not
 *     prorated; the utilization bar answers "is this person loaded?"
 *     rather than "how many hours exactly." Timesheet reports live
 *     elsewhere and use actuals.
 *
 *   • Colors are assigned deterministically from the contract_id so
 *     the same contract gets the same color across reloads and
 *     filter changes (visual continuity matters for pattern
 *     recognition).
 */

'use strict';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** 10-color palette — colorblind-friendly, stable across builds. */
const CONTRACT_COLORS = Object.freeze([
  '#6B5B95', // violet
  '#2A8FA0', // teal
  '#E98B3F', // orange
  '#4B9F6B', // green
  '#C7506B', // raspberry
  '#4575B4', // blue
  '#D6A03E', // amber
  '#8E6BD6', // lavender
  '#3CA66B', // emerald
  '#B45C8F', // plum
]);

/* ── Date helpers (UTC only) ────────────────────────────────────── */

function parseDateUTC(s) {
  if (s == null) return null;
  if (s instanceof Date) {
    const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const str = String(s).trim();
  // Accept 'YYYY-MM-DD' and ISO timestamps; always coerce to UTC midnight.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]) - 1; const da = Number(m[3]);
  const d = new Date(Date.UTC(y, mo, da));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo || d.getUTCDate() !== da) return null;
  return d;
}

function formatDateUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

/** Monday of the ISO week containing `d` (UTC). */
function mondayOf(d) {
  const copy = new Date(d.getTime());
  const dow = copy.getUTCDay();           // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;  // shift to Monday
  copy.setUTCDate(copy.getUTCDate() + diff);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addDays(d, n) {
  const c = new Date(d.getTime());
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

/**
 * ISO 8601 week number in UTC. Returns an integer 1..53.
 */
function isoWeekNumber(d) {
  // Copy date so we don't mutate
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday in current week decides the year
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t - yearStart) / ONE_DAY_MS) + 1) / 7);
}

/* ── Week window construction ───────────────────────────────────── */

/**
 * Build an array of `weeks` week-windows starting from the Monday of
 * the week containing `startDate`.
 *
 * Each window:
 *   { index, start_date: 'YYYY-MM-DD', end_date: 'YYYY-MM-DD',
 *     iso_week, label: 'S17', short_label: 'Abr 20' }
 */
function buildWeekWindows(startDate, weeks = 12) {
  const parsed = parseDateUTC(startDate);
  if (!parsed) throw new Error('Invalid startDate');
  const raw = Number(weeks);
  const w = Math.max(1, Math.min(26, Math.trunc(Number.isFinite(raw) ? raw : 12)));
  const mon = mondayOf(parsed);
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const out = [];
  for (let i = 0; i < w; i += 1) {
    const ws = addDays(mon, i * 7);
    const we = addDays(ws, 6);
    out.push({
      index: i,
      start_date: formatDateUTC(ws),
      end_date:   formatDateUTC(we),
      iso_week:   isoWeekNumber(ws),
      label:      `S${isoWeekNumber(ws)}`,
      short_label: `${months[ws.getUTCMonth()]} ${ws.getUTCDate()}`,
    });
  }
  return out;
}

/* ── Overlap + utilization ──────────────────────────────────────── */

/**
 * Returns true when the closed window [aStart, aEnd] overlaps
 * [bStart, bEnd] by at least one day. Open-ended ranges (null/undefined
 * end) extend to +infinity.
 */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = parseDateUTC(aStart); const bs = parseDateUTC(bStart);
  if (!as || !bs) return false;
  const ae = aEnd ? parseDateUTC(aEnd) : null;
  const be = bEnd ? parseDateUTC(bEnd) : null;
  if (ae && ae.getTime() < as.getTime()) return false;
  if (be && be.getTime() < bs.getTime()) return false;
  // overlap condition: !(aEnd < bStart || bEnd < aStart)
  if (ae && ae.getTime() < bs.getTime()) return false;
  if (be && be.getTime() < as.getTime()) return false;
  return true;
}

/**
 * Compute [firstWeekIdx, lastWeekIdx] (inclusive, null if no overlap)
 * for an assignment's active range within the given week windows.
 */
function weekRangeForAssignment(assignmentStart, assignmentEnd, weekWindows) {
  let first = -1; let last = -1;
  for (let i = 0; i < weekWindows.length; i += 1) {
    const ww = weekWindows[i];
    if (rangesOverlap(assignmentStart, assignmentEnd, ww.start_date, ww.end_date)) {
      if (first === -1) first = i;
      last = i;
    }
  }
  return first === -1 ? null : [first, last];
}

/**
 * Utilization bucket: 0 (no booking), 1–75 (light), 76–100 (good),
 * 101+ (overbooked). The UI maps these to chip colors.
 */
function utilizationBucket(pct) {
  if (!Number.isFinite(pct) || pct <= 0) return 'idle';
  if (pct <= 75) return 'light';
  if (pct <= 100) return 'healthy';
  return 'overbooked';
}

/**
 * For a single employee + her assignments, produce one entry per week
 * window with hours, utilization_pct, and bucket.
 *
 * Non-terminated assignments with any overlap contribute full
 * `weekly_hours`. Terminated/cancelled are ignored.
 */
function computeWeeklyForEmployee(employee, assignments, weekWindows) {
  const cap = Number(employee.weekly_capacity_hours) || 0;
  const weekly = weekWindows.map((ww) => ({
    week_index: ww.index,
    start_date: ww.start_date,
    hours: 0,
    utilization_pct: 0,
    bucket: 'idle',
  }));
  for (const a of assignments) {
    if (a.status === 'cancelled') continue;
    const hrs = Number(a.weekly_hours) || 0;
    if (hrs <= 0) continue;
    for (let i = 0; i < weekWindows.length; i += 1) {
      const ww = weekWindows[i];
      if (rangesOverlap(a.start_date, a.end_date, ww.start_date, ww.end_date)) {
        weekly[i].hours += hrs;
      }
    }
  }
  for (const w of weekly) {
    const pct = cap > 0 ? (w.hours / cap) * 100 : 0;
    w.utilization_pct = Math.round(pct * 10) / 10;
    w.bucket = utilizationBucket(pct);
  }
  return weekly;
}

/* ── Contract colors ────────────────────────────────────────────── */

function colorFor(contractId, palette = CONTRACT_COLORS) {
  if (!contractId) return palette[0];
  let h = 0;
  const s = String(contractId);
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % palette.length;
  return palette[idx];
}

/* ── Meta aggregates ────────────────────────────────────────────── */

/**
 * Given employees-with-weekly already computed, return the 4 meta
 * numbers the UI shows in the header cards.
 */
function aggregateMeta(employees, openRequests = []) {
  const activeEmployees = employees.filter((e) =>
    (e.weekly || []).some((w) => w.hours > 0),
  );
  let sum = 0; let count = 0; let overbooked = 0;
  for (const e of employees) {
    for (const w of (e.weekly || [])) {
      if (w.hours > 0) { sum += w.utilization_pct; count += 1; }
      if (w.bucket === 'overbooked') { overbooked += 1; break; }
    }
  }
  // Overbooked `break` above counts each employee at most once.
  return {
    total_employees: employees.length,
    active_employees: activeEmployees.length,
    avg_utilization_pct: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
    overbooked_count: overbooked,
    open_request_count: openRequests.length,
  };
}

/* ── Alerts (US-PLN-6) ──────────────────────────────────────────── */

const LEVEL_ORDER = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'];
const levelRank = (lvl) => {
  const i = LEVEL_ORDER.indexOf(String(lvl || '').toUpperCase());
  return i === -1 ? null : i + 1;
};

/**
 * Collapse a sorted ascending array of integers to "Sx", "Sx-Sy", "Sx,Sy"
 * so overbooking alerts read naturally: "S17-S18" instead of "S17, S18".
 */
function formatWeekRanges(indices, weekWindows) {
  if (!indices.length) return '';
  const labels = indices
    .slice()
    .sort((a, b) => a - b)
    .map((i) => weekWindows[i]?.label)
    .filter(Boolean);
  if (!labels.length) return '';
  // Re-collapse to contiguous runs using the sorted original indices.
  const sorted = indices.slice().sort((a, b) => a - b);
  const runs = [];
  let runStart = sorted[0];
  let prev = sorted[0];
  for (let k = 1; k < sorted.length; k += 1) {
    if (sorted[k] === prev + 1) { prev = sorted[k]; continue; }
    runs.push([runStart, prev]);
    runStart = sorted[k]; prev = sorted[k];
  }
  runs.push([runStart, prev]);
  return runs
    .map(([a, b]) => a === b
      ? weekWindows[a]?.label
      : `${weekWindows[a]?.label}-${weekWindows[b]?.label}`)
    .filter(Boolean)
    .join(', ');
}

/**
 * Build the "Alertas" strip rendered at the bottom of the planner.
 *
 * Alert shape:
 *   { type, severity, message,
 *     employee_id?, request_id?, week_indices?, peak_pct? }
 *
 * Types:
 *   - overbooked      (red)   weeks where an employee's bucket = overbooked
 *   - level_mismatch  (amber) assignments where employee level < request level
 *                             (gap >= 2) or is under by 1 (informational amber)
 *   - open_request    (amber) every open / partially-filled request in the
 *                             viewport
 *
 * The function is pure and does not mutate inputs.
 */
function computeAlerts(employees, openRequests = [], weekWindows = []) {
  const alerts = [];

  // Overbooking — per-employee, collapsed by week.
  for (const e of employees) {
    const overWeeks = [];
    let peak = 0;
    for (const w of (e.weekly || [])) {
      if (w.bucket === 'overbooked') {
        overWeeks.push(w.week_index);
        if (w.utilization_pct > peak) peak = w.utilization_pct;
      }
    }
    if (overWeeks.length) {
      const ranges = formatWeekRanges(overWeeks, weekWindows);
      alerts.push({
        type: 'overbooked',
        severity: 'red',
        employee_id: e.id,
        week_indices: overWeeks,
        peak_pct: peak,
        message: `${e.full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim()} sobre-asignado ${ranges} (${Math.round(peak)}%).`,
      });
    }
  }

  // Level mismatches — per-assignment. Requires the assignment row to
  // carry request_level (enriched by the route).
  for (const e of employees) {
    const empLvl = levelRank(e.level);
    if (empLvl == null) continue;
    for (const a of (e.assignments || [])) {
      const reqLvl = levelRank(a.request_level);
      if (reqLvl == null) continue;
      const gap = reqLvl - empLvl;
      if (gap >= 2) {
        alerts.push({
          type: 'level_mismatch',
          severity: 'red',
          employee_id: e.id,
          request_id: a.resource_request_id || null,
          gap,
          message: `${e.full_name || `${e.first_name} ${e.last_name}`.trim()} es ${e.level}, la solicitud "${a.role_title || a.contract_name}" pide ${a.request_level} (gap ${gap}).`,
        });
      } else if (gap === 1) {
        alerts.push({
          type: 'level_mismatch',
          severity: 'amber',
          employee_id: e.id,
          request_id: a.resource_request_id || null,
          gap,
          message: `${e.full_name || `${e.first_name} ${e.last_name}`.trim()} es ${e.level}, la solicitud pide ${a.request_level} (un nivel por debajo).`,
        });
      }
    }
  }

  // Uncovered open requests.
  for (const rr of openRequests) {
    if ((rr.missing || 0) <= 0) continue;
    const firstWeek = rr.week_range ? weekWindows[rr.week_range[0]] : null;
    const since = firstWeek ? ` desde ${firstWeek.label}` : '';
    alerts.push({
      type: 'open_request',
      severity: 'amber',
      request_id: rr.id,
      message: `${rr.client_name || rr.contract_name}: ${rr.role_title} ${rr.level || ''} sin cubrir${since} (${rr.missing} vacantes).`.replace(/\s+/g, ' ').trim(),
    });
  }

  // Sort: red before amber, then by type so the UI groups cleanly.
  const sevRank = { red: 0, amber: 1 };
  const typeRank = { overbooked: 0, level_mismatch: 1, open_request: 2 };
  alerts.sort((x, y) => {
    const s = (sevRank[x.severity] ?? 9) - (sevRank[y.severity] ?? 9);
    if (s !== 0) return s;
    return (typeRank[x.type] ?? 9) - (typeRank[y.type] ?? 9);
  });
  return alerts;
}

module.exports = {
  // date helpers
  parseDateUTC,
  formatDateUTC,
  mondayOf,
  addDays,
  isoWeekNumber,
  // planner core
  buildWeekWindows,
  rangesOverlap,
  weekRangeForAssignment,
  utilizationBucket,
  computeWeeklyForEmployee,
  colorFor,
  aggregateMeta,
  computeAlerts,
  CONTRACT_COLORS,
};
