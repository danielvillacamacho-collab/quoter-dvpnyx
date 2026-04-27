/**
 * Revenue recognition (RR-MVP-00.1, Abril 2026).
 *
 * REEMPLAZA el Excel "Portafolio_de_cuentas_por_Delivery_Manager.xlsx"
 * para que DMs/CFO puedan operar el cierre mensual sin hoja paralela.
 *
 * SCOPE INTENCIONAL: trabajo funcional placeholder. Cuando el equipo de
 * ingeniería entre a refactorizar, ver SPEC-RR-00 para el modelo
 * NIIF 15-friendly real (immutability triggers, plan_frozen_at,
 * service_period_history append-only, multi-currency, atomic worker
 * async, 4 motores polimórficos por tipo de contrato). Aquí solo hay:
 *
 *   - 1 motor: monthly_projection plano (un número proyectado y un
 *     número real por mes y contrato).
 *   - status 'open' / 'closed' por celda. Sin trigger inmutable: si el
 *     CFO necesita corregir, edita y queda en audit_log.
 *   - USD único. Multi-currency queda explícitamente diferido.
 *   - audit log usa la tabla audit_log existente (no append-only
 *     dedicada — eso lo hará el eng team).
 *
 * Endpoints:
 *   GET /api/revenue?from=YYYYMM&to=YYYYMM[&type=&owner_id=&country=]
 *     → matriz contracts × meses con totales por columna y global.
 *   PUT /api/revenue/:contract_id/:yyyymm
 *     → upsert. body: { projected_usd?, real_usd?, status?, notes? }
 *   POST /api/revenue/:contract_id/:yyyymm/close
 *     → marca status='closed', requiere real_usd no nulo.
 */

const router = require('express').Router();
const pool = require('../database/pool');
const { auth } = require('../middleware/auth');

router.use(auth);

const YYYYMM_RE = /^[0-9]{6}$/;

function expandMonths(from, to) {
  if (!YYYYMM_RE.test(from) || !YYYYMM_RE.test(to)) return [];
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(4));
  const yEnd = Number(to.slice(0, 4));
  const mEnd = Number(to.slice(4));
  let safety = 0;
  while ((y < yEnd || (y === yEnd && m <= mEnd)) && safety < 240) {
    out.push(`${y.toString().padStart(4, '0')}${m.toString().padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
    safety += 1;
  }
  return out;
}

/* -------- LIST (matrix) -------- */
router.get('/', async (req, res) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (!YYYYMM_RE.test(from) || !YYYYMM_RE.test(to)) {
      return res.status(400).json({ error: 'from/to inválidos (formato YYYYMM)' });
    }
    const months = expandMonths(from, to);
    if (!months.length) return res.status(400).json({ error: 'Rango de meses vacío' });

    const wheres = ['c.deleted_at IS NULL'];
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };
    if (req.query.type)     wheres.push(`c.type = ${add(req.query.type)}`);
    if (req.query.owner_id) wheres.push(`c.account_owner_id = ${add(req.query.owner_id)}`);
    if (req.query.country)  wheres.push(`cl.country = ${add(req.query.country)}`);

    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';

    const { rows: contracts } = await pool.query(
      `SELECT c.id, c.name, c.type, c.status, c.start_date, c.end_date,
              c.total_value_usd, c.original_currency,
              cl.id   AS client_id,
              cl.name AS client_name,
              cl.country AS client_country,
              u.id   AS owner_id,
              u.name AS owner_name,
              EXISTS(SELECT 1 FROM revenue_periods rp WHERE rp.contract_id=c.id) AS plan_declared
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN users u    ON u.id  = c.account_owner_id
         ${where}
         ORDER BY c.start_date DESC, c.name ASC`,
      params,
    );

    const ids = contracts.map((c) => c.id);
    let periodsByContract = new Map();
    if (ids.length) {
      const { rows: periods } = await pool.query(
        `SELECT contract_id, yyyymm, projected_usd, projected_pct, real_usd, status, notes,
                closed_at, closed_by, updated_at, updated_by
           FROM revenue_periods
          WHERE contract_id = ANY($1::uuid[]) AND yyyymm BETWEEN $2 AND $3`,
        [ids, from, to],
      );
      periods.forEach((p) => {
        const key = p.contract_id;
        if (!periodsByContract.has(key)) periodsByContract.set(key, {});
        periodsByContract.get(key)[p.yyyymm] = p;
      });
    }

    // Build matrix + totals
    const rows = contracts.map((c) => {
      const cells = {};
      let row_projected = 0; let row_real = 0;
      months.forEach((m) => {
        const cell = (periodsByContract.get(c.id) || {})[m] || null;
        const p = cell ? Number(cell.projected_usd || 0) : 0;
        const r = cell && cell.real_usd != null ? Number(cell.real_usd) : null;
        row_projected += p; if (r != null) row_real += r;
        cells[m] = cell ? {
          projected_usd: p,
          projected_pct: cell.projected_pct != null ? Number(cell.projected_pct) : null,
          real_usd: r,
          status: cell.status,
          notes: cell.notes,
          closed_at: cell.closed_at,
          closed_by: cell.closed_by,
          updated_at: cell.updated_at,
          updated_by: cell.updated_by,
        } : null;
      });
      return { contract: c, cells, row_total: { projected_usd: row_projected, real_usd: row_real } };
    });

    // Column totals + global
    const col_totals = {};
    months.forEach((m) => { col_totals[m] = { projected_usd: 0, real_usd: 0 }; });
    let global_projected = 0; let global_real = 0;
    rows.forEach((r) => {
      months.forEach((m) => {
        const c = r.cells[m];
        if (c) {
          col_totals[m].projected_usd += c.projected_usd;
          if (c.real_usd != null) col_totals[m].real_usd += c.real_usd;
          global_projected += c.projected_usd;
          if (c.real_usd != null) global_real += c.real_usd;
        }
      });
    });

    res.json({
      months, rows, col_totals,
      global_total: { projected_usd: global_projected, real_usd: global_real },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /revenue failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/* ====================================================================
 * RR-MVP-00.2 — Plan de reconocimiento (PROY).
 *
 * Pantalla aparte donde el operations_owner declara la curva de
 * reconocimiento esperada de un contrato.
 *
 *   - type='project'         → entrada en `pct` (0..1) por mes.
 *                              projected_usd = pct × contracts.total_value_usd
 *   - type='capacity'/'resell' → entrada directa en USD por mes.
 *
 * En la grilla matricial principal, PROY queda read-only. El usuario
 * solo manipula REAL allí.
 *
 * Las rutas /plan deben ir ANTES de /:yyyymm porque Express matchea
 * por orden y `plan` no es un yyyymm válido.
 * ==================================================================== */

router.get('/:contract_id/plan', async (req, res) => {
  try {
    const { rows: cRows } = await pool.query(
      `SELECT c.id, c.name, c.type, c.status, c.start_date, c.end_date,
              c.total_value_usd, c.original_currency,
              cl.id AS client_id, cl.name AS client_name, cl.country AS client_country,
              u.name AS owner_name
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN users u    ON u.id  = c.account_owner_id
        WHERE c.id=$1 AND c.deleted_at IS NULL`,
      [req.params.contract_id],
    );
    if (!cRows.length) return res.status(404).json({ error: 'Contrato no encontrado' });

    const { rows: periods } = await pool.query(
      `SELECT yyyymm, projected_usd, projected_pct, real_usd, status, notes,
              closed_at, closed_by, updated_at, updated_by
         FROM revenue_periods
        WHERE contract_id=$1
        ORDER BY yyyymm ASC`,
      [req.params.contract_id],
    );

    res.json({ contract: cRows[0], periods });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /revenue/:contract_id/plan failed:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/:contract_id/plan', async (req, res) => {
  const { contract_id } = req.params;
  const body = req.body || {};
  const entries = Array.isArray(body.entries) ? body.entries : null;
  if (!entries) return res.status(400).json({ error: 'entries[] es requerido' });
  if (!entries.every((e) => YYYYMM_RE.test(String(e.yyyymm || '')))) {
    return res.status(400).json({ error: 'Todas las entries deben tener un yyyymm válido' });
  }

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows: cRows } = await conn.query(
      `SELECT id, type, total_value_usd, original_currency FROM contracts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
      [contract_id],
    );
    if (!cRows.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Contrato no encontrado' });
    }

    // RR-MVP-00.3: el plan editor también permite ajustar el valor del
    // contrato y la moneda en el mismo save. Se permite solo si vienen
    // explícitos en el body. Así el operations_owner que entra a declarar
    // el plan puede corregir el valor sin saltar al módulo de contratos
    // (que es admin-only).
    let totalValue = Number(cRows[0].total_value_usd || 0);
    let originalCurrency = cRows[0].original_currency || 'USD';
    const newValueProvided = body.total_value_usd != null;
    const newCurrencyProvided = typeof body.original_currency === 'string' && body.original_currency.trim();
    if (newValueProvided || newCurrencyProvided) {
      const nextValue = newValueProvided ? Number(body.total_value_usd) : totalValue;
      if (newValueProvided && (isNaN(nextValue) || nextValue < 0)) {
        await conn.query('ROLLBACK');
        return res.status(400).json({ error: 'total_value_usd inválido' });
      }
      const nextCurrency = newCurrencyProvided ? String(body.original_currency).trim().toUpperCase().slice(0, 3) : originalCurrency;
      await conn.query(
        `UPDATE contracts SET total_value_usd = $2, original_currency = $3, updated_at = NOW() WHERE id = $1`,
        [contract_id, nextValue, nextCurrency],
      );
      totalValue = nextValue;
      originalCurrency = nextCurrency;
    }

    const contract = cRows[0];
    const isProject = contract.type === 'project';

    for (const e of entries) {
      if (isProject) {
        if (e.pct == null || isNaN(Number(e.pct))) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: `Entry ${e.yyyymm}: pct requerido para contratos de tipo project` });
        }
        const pct = Number(e.pct);
        if (pct < 0 || pct > 1) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: `Entry ${e.yyyymm}: pct debe estar entre 0 y 1` });
        }
      } else {
        if (e.projected_usd == null || isNaN(Number(e.projected_usd))) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: `Entry ${e.yyyymm}: projected_usd requerido para contratos no-project` });
        }
      }
    }

    let warnings = [];
    if (isProject) {
      const sumPct = entries.reduce((s, e) => s + Number(e.pct || 0), 0);
      if (sumPct > 1.0001) {
        warnings.push({ code: 'pct_sum_exceeds_1', message: `La suma de % declarados es ${(sumPct * 100).toFixed(2)}% (>100%). Revisa la curva.` });
      }
    }

    const upserted = [];
    for (const e of entries) {
      const yyyymm = String(e.yyyymm);
      const projectedPct = isProject ? Number(e.pct) : null;
      const projectedUsd = isProject
        ? Number(e.pct) * totalValue
        : Number(e.projected_usd);

      const { rows } = await conn.query(
        `INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, projected_pct,
                                      created_by, updated_by)
           VALUES ($1, $2, $3::numeric, $4::numeric, $5, $5)
         ON CONFLICT (contract_id, yyyymm) DO UPDATE SET
           projected_usd = EXCLUDED.projected_usd,
           projected_pct = EXCLUDED.projected_pct,
           updated_by    = EXCLUDED.updated_by,
           updated_at    = NOW()
         RETURNING contract_id, yyyymm, projected_usd, projected_pct, real_usd, status`,
        [contract_id, yyyymm, projectedUsd, projectedPct, req.user.id],
      );
      upserted.push(rows[0]);
    }

    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'revenue_plan_declared', 'contract', $2,
                 jsonb_build_object('contract_id', $3::uuid,
                                    'is_project', $4::boolean,
                                    'entries_count', $5::int))`,
      [req.user.id, contract_id, contract_id, isProject, entries.length],
    );

    await conn.query('COMMIT');
    res.json({ entries: upserted, warnings, contract: { id: contract_id, type: contract.type, total_value_usd: totalValue, original_currency: originalCurrency } });
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('PUT /revenue/:contract_id/plan failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

/* -------- UPSERT cell (REAL only) -------- */
// CRM-MVP-00.2: el PROY ya no se edita aquí (lo gestiona /plan). Este
// endpoint sólo actualiza real_usd y notes desde la grilla.
router.put('/:contract_id/:yyyymm', async (req, res) => {
  const { contract_id, yyyymm } = req.params;
  if (!YYYYMM_RE.test(yyyymm)) return res.status(400).json({ error: 'yyyymm inválido' });
  const body = req.body || {};
  const { real_usd, notes } = body;

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows: cRows } = await conn.query(
      `SELECT id FROM contracts WHERE id=$1 AND deleted_at IS NULL`,
      [contract_id],
    );
    if (!cRows.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Contrato no encontrado' });
    }

    const { rows: existing } = await conn.query(
      `SELECT * FROM revenue_periods WHERE contract_id=$1 AND yyyymm=$2 FOR UPDATE`,
      [contract_id, yyyymm],
    );
    if (!existing.length) {
      await conn.query('ROLLBACK');
      return res.status(409).json({ error: 'Aún no hay plan declarado para este mes. Usa "Editar plan" antes de capturar reales.' });
    }
    const wasClosed = existing[0].status === 'closed';
    const realProvided = Object.prototype.hasOwnProperty.call(body, 'real_usd');
    const finalReal = realProvided ? (real_usd == null ? null : Number(real_usd)) : existing[0].real_usd;
    const finalNotes = notes != null ? notes : existing[0].notes;

    const { rows } = await conn.query(
      `UPDATE revenue_periods SET
         real_usd   = $3::numeric,
         notes      = $4,
         updated_by = $5,
         updated_at = NOW()
       WHERE contract_id=$1 AND yyyymm=$2
       RETURNING *`,
      [contract_id, yyyymm, finalReal, finalNotes, req.user.id],
    );
    const row = rows[0];

    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'revenue_period_real_update', 'revenue_period', $2,
                 jsonb_build_object('contract_id', $3::uuid, 'yyyymm', $4::text,
                                    'wasClosed', $5::boolean,
                                    'real_usd', $6::numeric))`,
      [req.user.id, contract_id, contract_id, yyyymm, wasClosed, row.real_usd],
    );

    await conn.query('COMMIT');
    res.json(row);
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('PUT /revenue/:contract_id/:yyyymm failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});

/* -------- CLOSE month -------- */
router.post('/:contract_id/:yyyymm/close', async (req, res) => {
  const { contract_id, yyyymm } = req.params;
  if (!YYYYMM_RE.test(yyyymm)) return res.status(400).json({ error: 'yyyymm inválido' });
  const body = req.body || {};

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows: existing } = await conn.query(
      `SELECT * FROM revenue_periods WHERE contract_id=$1 AND yyyymm=$2 FOR UPDATE`,
      [contract_id, yyyymm],
    );
    if (!existing.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Período no existe — agrega proyección antes de cerrar' });
    }
    const newReal = body.real_usd != null ? Number(body.real_usd) : existing[0].real_usd;
    if (newReal == null) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: 'real_usd es requerido para cerrar el mes' });
    }
    const { rows } = await conn.query(
      `UPDATE revenue_periods SET
         status='closed',
         real_usd=$3,
         notes=COALESCE($4, notes),
         closed_at=NOW(),
         closed_by=$5,
         updated_by=$5,
         updated_at=NOW()
       WHERE contract_id=$1 AND yyyymm=$2
       RETURNING *`,
      [contract_id, yyyymm, newReal, body.notes || null, req.user.id],
    );
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'revenue_period_close', 'revenue_period', $2,
                 jsonb_build_object('contract_id', $3::uuid, 'yyyymm', $4::text, 'real_usd', $5::numeric))`,
      [req.user.id, contract_id, contract_id, yyyymm, newReal],
    );
    await conn.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('POST /revenue/:contract_id/:yyyymm/close failed:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    conn.release();
  }
});


module.exports = router;
module.exports._internal = { expandMonths };
