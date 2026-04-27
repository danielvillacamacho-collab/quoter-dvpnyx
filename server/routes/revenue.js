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
              c.total_value_usd,
              cl.id   AS client_id,
              cl.name AS client_name,
              cl.country AS client_country,
              u.id   AS owner_id,
              u.name AS owner_name
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
        `SELECT contract_id, yyyymm, projected_usd, real_usd, status, notes,
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

/* -------- UPSERT cell -------- */
router.put('/:contract_id/:yyyymm', async (req, res) => {
  const { contract_id, yyyymm } = req.params;
  if (!YYYYMM_RE.test(yyyymm)) return res.status(400).json({ error: 'yyyymm inválido' });
  const body = req.body || {};
  const { projected_usd, real_usd, notes } = body;

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    // Verify contract exists
    const { rows: cRows } = await conn.query(
      `SELECT id FROM contracts WHERE id=$1 AND deleted_at IS NULL`,
      [contract_id],
    );
    if (!cRows.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Contrato no encontrado' });
    }

    // Existing cell?
    const { rows: existing } = await conn.query(
      `SELECT * FROM revenue_periods WHERE contract_id=$1 AND yyyymm=$2 FOR UPDATE`,
      [contract_id, yyyymm],
    );

    // Soft block: si está closed y se intenta editar, dejamos pasar pero
    // anotamos en audit_log. Cuando entre el eng team, esto será un
    // trigger DB inmutable.
    const wasClosed = existing[0]?.status === 'closed';

    // Resolver valores finales en JS (evita el sentinel 'present' del UPDATE).
    // Reglas:
    //   - projected_usd ausente del body  → mantener existente (o 0 si nuevo).
    //   - projected_usd presente          → usar el valor (number).
    //   - real_usd ausente del body       → mantener existente (o null si nuevo).
    //   - real_usd presente y null        → setear a null (limpiar).
    //   - real_usd presente y number      → usar el valor.
    const realProvided = Object.prototype.hasOwnProperty.call(body, 'real_usd');
    const baseProjected = existing[0]?.projected_usd ?? 0;
    const baseReal = existing[0]?.real_usd ?? null;
    const baseNotes = existing[0]?.notes ?? null;
    const finalProjected = projected_usd != null ? Number(projected_usd) : Number(baseProjected);
    const finalReal = realProvided ? (real_usd == null ? null : Number(real_usd)) : baseReal;
    const finalNotes = notes != null ? notes : baseNotes;

    let row;
    if (!existing.length) {
      const { rows } = await conn.query(
        `INSERT INTO revenue_periods (contract_id, yyyymm, projected_usd, real_usd, notes,
                                      created_by, updated_by)
           VALUES ($1,$2,$3,$4::numeric,$5,$6,$6)
           RETURNING *`,
        [contract_id, yyyymm, finalProjected, finalReal, finalNotes, req.user.id],
      );
      row = rows[0];
    } else {
      const { rows } = await conn.query(
        `UPDATE revenue_periods SET
           projected_usd = $3,
           real_usd      = $4::numeric,
           notes         = $5,
           updated_by    = $6,
           updated_at    = NOW()
         WHERE contract_id=$1 AND yyyymm=$2
         RETURNING *`,
        [contract_id, yyyymm, finalProjected, finalReal, finalNotes, req.user.id],
      );
      row = rows[0];
    }

    // Audit (low-fidelity placeholder — eng team replaces with append-only history table).
    // Cast TODOS los params explícitos: cuando real_usd es null sin cast, PG falla con
    // "could not determine data type of parameter".
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details)
         VALUES ($1, 'revenue_period_upsert', 'revenue_period', $2,
                 jsonb_build_object('contract_id', $3::uuid, 'yyyymm', $4::text,
                                    'wasClosed', $5::boolean,
                                    'projected_usd', $6::numeric, 'real_usd', $7::numeric))`,
      [
        req.user.id, contract_id, contract_id, yyyymm,
        wasClosed,
        row.projected_usd, row.real_usd,
      ],
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
