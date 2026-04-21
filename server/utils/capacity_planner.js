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
  CONTRACT_COLORS,
};
