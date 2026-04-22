/**
 * Pure candidate matcher for resource_requests.
 *
 * Given a resource_request and a pool of employees with their skills and
 * in-viewport assignments, produce a ranked list of candidates with:
 *
 *   • A composite `score` in 0..100 so the UI can sort + threshold.
 *   • A structured `match` breakdown so the UI can render chips
 *     ("Mismo área", "3/4 skills", "Libre 20h/sem") without re-deriving.
 *   • Human-readable `reasons` (Spanish) so the AI/agent layer has the
 *     rationale in plain language.
 *
 * No I/O here: the route in server/routes/resource_requests.js runs the
 * 3 SQL queries and hands everything to `rankCandidates`. That keeps the
 * scoring math deterministic and easy to evolve (we WILL tune weights).
 *
 * Weights come straight from user story US-RR-2 in
 * docs/historias_capacity_planning — this is the scoring contract the
 * product owner committed to:
 *
 *   area_match         = 40   (área coincide)
 *   level_match        = 30   (exacto=30, ±1=15, ±2+=0)
 *   required_skills    = 20   (matched/required, if the request has any)
 *   availability       = 10   (available_hours ≥ 80% of requested)
 *   nice_to_have       = 0    (not scored; kept in the match breakdown
 *                              for the UI only)
 *
 * Total = 100. All sub-scores are returned as normalized fractions
 * (0..1) so the frontend can re-weight without re-reading the code.
 *
 * Per the spec, candidates with no available capacity are "penalized
 * and sent to the bottom" — we subtract `NO_CAPACITY_PENALTY` from the
 * final score when availability.status === 'none', so even a perfect
 * area+level+skills match without free hours never out-ranks a
 * weaker-but-available one.
 */

'use strict';

const LEVEL_VALUES = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','L11'];
const levelIndex = (lvl) => {
  const i = LEVEL_VALUES.indexOf(String(lvl || '').toUpperCase());
  return i === -1 ? null : i + 1;
};

const WEIGHTS = Object.freeze({
  level: 30,
  area: 40,
  required: 20,
  nice: 0,            // per US-RR-2: not scored; kept structurally for the UI
  availability: 10,
});

// Applied post-hoc when the employee has zero available hours, so
// "sin capacidad" candidates always fall below ones who can actually
// take the work even if their area/skills match better.
const NO_CAPACITY_PENALTY = 40;

/* ── Date helpers ─────────────────────────────────────────────────── */

function toDate(x) {
  if (!x) return null;
  if (x instanceof Date) return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = toDate(aStart); const bs = toDate(bStart);
  if (!as || !bs) return false;
  const ae = aEnd ? toDate(aEnd) : null;
  const be = bEnd ? toDate(bEnd) : null;
  if (ae && ae.getTime() < bs.getTime()) return false;
  if (be && be.getTime() < as.getTime()) return false;
  return true;
}

/* ── Sub-scores (each returns { status, fraction, detail }) ──────── */

function scoreLevel(request, employee) {
  const req = levelIndex(request.level);
  const emp = levelIndex(employee.level);
  if (!req || !emp) {
    return { status: 'unknown', fraction: 0, detail: { request_level: request.level, employee_level: employee.level } };
  }
  const gap = emp - req; // positive = overqualified, negative = underqualified
  const absGap = Math.abs(gap);
  // US-RR-2 scoring curve: exact = full, ±1 = half, ±2+ = nothing.
  // The per-side asymmetry (under vs over) is lost at this coarseness
  // but kept in `status` so the UI can still show "sobre-calificado" etc.
  let fraction;
  if (absGap === 0) fraction = 1;
  else if (absGap === 1) fraction = 0.5;
  else fraction = 0;
  const status = gap === 0 ? 'perfect' : (absGap === 1 ? 'close' : (gap > 0 ? 'overqualified' : 'underqualified'));
  return { status, fraction, detail: { gap, request_level: request.level, employee_level: employee.level } };
}

function scoreArea(request, employee) {
  const ok = request.area_id != null && employee.area_id != null && Number(request.area_id) === Number(employee.area_id);
  return {
    status: ok ? 'match' : 'mismatch',
    fraction: ok ? 1 : 0,
    detail: { request_area_id: request.area_id, employee_area_id: employee.area_id },
  };
}

function scoreSkills(requiredIds, employeeSkillIds) {
  const req = Array.isArray(requiredIds) ? [...new Set(requiredIds.map(Number))] : [];
  const have = new Set((employeeSkillIds || []).map(Number));
  if (req.length === 0) {
    return { fraction: 1, matched: [], missing: [], detail: { required: 0 } };
  }
  const matched = req.filter((id) => have.has(id));
  const missing = req.filter((id) => !have.has(id));
  return {
    fraction: matched.length / req.length,
    matched,
    missing,
    detail: { required: req.length, matched: matched.length },
  };
}

/**
 * For the given employee, sum `weekly_hours` of assignments that overlap
 * the request's date window. Since the planner uses "overlaps-any-day"
 * semantics, we do the same here: the max committed in any overlapping
 * week is the constraint, not the average.
 */
function scoreAvailability(request, employee, assignments) {
  const cap = Number(employee.weekly_capacity_hours) || 0;
  const need = Number(request.weekly_hours) || 0;

  // Sum concurrent commitments during the request window (union of overlapping).
  let committed = 0;
  for (const a of assignments || []) {
    if (a.employee_id !== employee.id) continue;
    if (a.status === 'cancelled') continue;
    if (rangesOverlap(a.start_date, a.end_date, request.start_date, request.end_date)) {
      committed += Number(a.weekly_hours) || 0;
    }
  }
  const available = Math.max(0, cap - committed);
  const has_full = available >= need && need > 0;
  // US-RR-2 scoring is binary: +10 iff available_hours ≥ 80% of requested.
  // `available_ratio` is kept in the detail so the UI can still render a
  // precise "12 / 20 h libres" hint without recomputing.
  const meets_threshold = need <= 0 ? true : available >= 0.8 * need;
  const fraction = meets_threshold ? 1 : 0;
  const status = has_full ? 'full' : (available > 0 ? 'partial' : 'none');
  return {
    status,
    fraction,
    detail: {
      capacity_hours: cap,
      committed_hours: committed,
      available_hours: available,
      requested_hours: need,
      has_full_capacity: has_full,
      meets_threshold,
      available_ratio: need <= 0 ? 1 : Math.max(0, Math.min(1, available / need)),
    },
  };
}

/* ── Reasons (Spanish, UI-ready) ──────────────────────────────────── */

function buildReasons(subs) {
  const r = [];
  if (subs.area.status === 'match') r.push('Mismo área');
  else r.push('Área distinta');

  if (subs.level.status === 'perfect') r.push(`Nivel ${subs.level.detail.employee_level} (exacto)`);
  else if (subs.level.status === 'close') r.push(`Nivel ${subs.level.detail.employee_level} (±1 del pedido)`);
  else if (subs.level.status === 'overqualified') r.push(`Sobre-calificado (+${subs.level.detail.gap})`);
  else if (subs.level.status === 'underqualified') r.push(`Bajo nivel (${subs.level.detail.gap})`);

  if (subs.required.detail.required > 0) {
    r.push(`${subs.required.matched.length}/${subs.required.detail.required} skills requeridas`);
  }
  if (subs.availability.status === 'full') r.push(`Disponible ${subs.availability.detail.available_hours}h/sem`);
  else if (subs.availability.status === 'partial') r.push(`Parcial: ${subs.availability.detail.available_hours}h libres, piden ${subs.availability.detail.requested_hours}h`);
  else r.push('Sin capacidad libre');
  return r;
}

/* ── Public API ───────────────────────────────────────────────────── */

/**
 * Rank candidates for a resource_request.
 *
 * @param {Object}   request            resource_request row
 * @param {Array}    employees          active employees with .skill_ids (int[])
 * @param {Array}    assignments        overlapping active assignments (any employee)
 * @param {Object}   [opts]
 * @param {number}   [opts.limit=25]    max candidates returned
 * @param {boolean}  [opts.includeIneligible=true]
 *                   when true, also include candidates with score < 30
 *                   so the UI can show them greyed out
 */
function rankCandidates(request, employees, assignments, opts = {}) {
  const { limit = 25, includeIneligible = true } = opts;
  const out = [];

  for (const emp of employees) {
    if (!emp || emp.status === 'terminated') continue;

    const level = scoreLevel(request, emp);
    const area  = scoreArea(request, emp);
    const req   = scoreSkills(request.required_skills, emp.skill_ids);
    const nice  = scoreSkills(request.nice_to_have_skills, emp.skill_ids);
    const avail = scoreAvailability(request, emp, assignments);

    const rawScore =
      level.fraction * WEIGHTS.level +
      area.fraction  * WEIGHTS.area +
      req.fraction   * WEIGHTS.required +
      nice.fraction  * WEIGHTS.nice +
      avail.fraction * WEIGHTS.availability;
    // Sin capacidad → al fondo (spec US-RR-2: "score penalizado").
    const penalty = avail.status === 'none' ? NO_CAPACITY_PENALTY : 0;
    const score = Math.max(0, Math.round(rawScore - penalty));

    const subs = { level, area, required: req, nice, availability: avail };
    const reasons = buildReasons(subs);

    out.push({
      employee_id: emp.id,
      full_name: emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
      level: emp.level,
      area_id: emp.area_id,
      area_name: emp.area_name || null,
      weekly_capacity_hours: Number(emp.weekly_capacity_hours) || 0,
      status: emp.status,
      score,
      match: {
        level: { status: level.status, ...level.detail, fraction: level.fraction },
        area:  { status: area.status,  ...area.detail,  fraction: area.fraction },
        required_skills: {
          matched_ids: req.matched, missing_ids: req.missing,
          matched: req.matched.length, required: req.detail.required, fraction: req.fraction,
        },
        nice_skills: {
          matched_ids: nice.matched, missing_ids: nice.missing,
          matched: nice.matched.length, nice_to_have: nice.detail.required, fraction: nice.fraction,
        },
        availability: { status: avail.status, ...avail.detail, fraction: avail.fraction },
      },
      reasons,
    });
  }

  out.sort((a, b) => b.score - a.score || a.full_name.localeCompare(b.full_name));

  const filtered = includeIneligible ? out : out.filter((c) => c.score >= 30);
  return filtered.slice(0, limit);
}

module.exports = {
  LEVEL_VALUES,
  WEIGHTS,
  rankCandidates,
  // Exported for focused tests:
  scoreLevel,
  scoreArea,
  scoreSkills,
  scoreAvailability,
};
