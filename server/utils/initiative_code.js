/**
 * Generación del código humano de iniciativas internas.
 *
 *   Formato: II-{AREA}-{YYYY}-{SEQ5}
 *   Ejemplo: II-PROD-2026-00001
 *
 * El código se genera dentro de una transacción que ya tiene un advisory
 * lock por (area, año), tomado por el route. La función `nextSequence`
 * solo lee el MAX(seq) actual; el lock garantiza que dos creaciones
 * concurrentes no colisionen.
 */

'use strict';

// Mapa estable business_area_id → 4 letras del código.
// Cualquier valor nuevo en business_areas debe agregarse aquí o el
// código quedaría como 'XXXX' (defensivo, no falla).
const AREA_CODE = {
  product:    'PROD',
  operations: 'OPER',
  hr:         'HR',
  finance:    'FIN',
  commercial: 'COMM',
  technology: 'TECH',
};

function areaCode(businessAreaId) {
  return AREA_CODE[String(businessAreaId)] || 'XXXX';
}

/** Construye el código a partir de partes ya conocidas. */
function buildInitiativeCode(businessAreaId, year, seq) {
  const yr = parseInt(year, 10);
  const seqInt = parseInt(seq, 10);
  if (!Number.isFinite(yr) || yr < 2000 || yr > 2100) {
    throw new Error(`year inválido: ${year}`);
  }
  if (!Number.isFinite(seqInt) || seqInt < 1 || seqInt > 99999) {
    throw new Error(`seq inválido: ${seq}`);
  }
  return `II-${areaCode(businessAreaId)}-${yr}-${String(seqInt).padStart(5, '0')}`;
}

/** Saca el siguiente seq leyendo MAX(...) +1 dentro del (área, año). */
async function nextSequence(conn, businessAreaId, year) {
  const code = areaCode(businessAreaId);
  const yr = parseInt(year, 10);
  // Pattern es 'II-PROD-2026-%' — usamos LIKE para no escanear demasiado.
  const prefix = `II-${code}-${yr}-`;
  const { rows } = await conn.query(
    `SELECT initiative_code FROM internal_initiatives
      WHERE initiative_code LIKE $1
      ORDER BY initiative_code DESC
      LIMIT 1`,
    [`${prefix}%`]
  );
  if (rows.length === 0) return 1;
  const last = rows[0].initiative_code;
  const m = last.match(/-(\d{5})$/);
  if (!m) return 1;
  const parsed = parseInt(m[1], 10);
  return Number.isFinite(parsed) ? parsed + 1 : 1;
}

/**
 * Toma un advisory lock estable para (área, año) durante la transacción.
 * Se libera automáticamente al COMMIT/ROLLBACK.
 *
 * Hash simple FNV-1a de la cadena 'II-PROD-2026' para obtener un int4
 * estable. El espacio de colisiones (~ 4MM combinaciones área×año) es
 * trivial vs 2^32, suficiente para serializar inserts.
 */
async function acquireSequenceLock(conn, businessAreaId, year) {
  const key = `II-${areaCode(businessAreaId)}-${parseInt(year, 10)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Convert to signed 32-bit for pg_advisory_xact_lock(bigint) safe range.
  const lockKey = h | 0;
  await conn.query('SELECT pg_advisory_xact_lock($1::int)', [lockKey]);
}

module.exports = {
  AREA_CODE,
  areaCode,
  buildInitiativeCode,
  nextSequence,
  acquireSequenceLock,
};
