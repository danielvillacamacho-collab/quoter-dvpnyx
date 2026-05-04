/**
 * SPEC-CRM-00 v1.1 PR4 — Alert definitions + notification creator.
 *
 * Alertas CRM:
 *   A1 — Oportunidad estancada (>30 días en la misma etapa activa)
 *   A2 — Próximo paso vencido (next_step_due_date < hoy)
 *   A3 — Champion o Economic Buyer no identificado en etapa avanzada
 *   A4 — Margen bajo (implementado en PR3 vía check-margin)
 *   A5 — Cierre esperado próximo (expected_close_date dentro de 7 días)
 *
 * Cada alerta crea una `notification` en la tabla existente. Dedup:
 * INSERT ... WHERE NOT EXISTS (...24 hours). No se usa tabla separada.
 */

const ALERT_DEFS = {
  A1_STALE: {
    code: 'a1_stale',
    type: 'opportunity_stale',
    threshold_days: 30,
    title: (name) => `⚠ A1: Oportunidad estancada — ${name}`,
    body: (days, stage) =>
      `Lleva ${days} días en "${stage}" sin cambio de etapa. Revisa si necesita acción o está fuera del pipeline.`,
  },
  A2_NEXT_STEP: {
    code: 'a2_next_step',
    type: 'next_step_overdue',
    title: (name) => `⚠ A2: Próximo paso vencido — ${name}`,
    body: (dueDate, step) =>
      `El paso "${step || 'sin definir'}" venció el ${dueDate}. Actualiza el siguiente paso.`,
  },
  A3_MEDDPICC: {
    code: 'a3_meddpicc',
    type: 'meddpicc_gap',
    title: (name) => `⚠ A3: Champion/EB pendiente — ${name}`,
    body: (gaps) =>
      `Falta identificar: ${gaps.join(', ')}. Hazlo antes de avanzar.`,
  },
  A5_CLOSE_SOON: {
    code: 'a5_close_soon',
    type: 'close_date_near',
    threshold_days: 7,
    title: (name) => `⚠ A5: Cierre próximo — ${name}`,
    body: (closeDate) =>
      `La fecha de cierre esperado (${closeDate}) está dentro de los próximos 7 días. Confirma el estado actual.`,
  },
};

// Stages donde A3 (Champion/EB) aplica.
const A3_STAGES = new Set([
  'solution_design', 'proposal_validated', 'negotiation', 'verbal_commit',
]);

/**
 * Crea una notificación de alerta con dedup de 24 h.
 * Devuelve el id de la notificación creada, o null si ya existía o falló.
 */
async function createAlertNotification(pool, {
  user_id, type, title, body, opp_id, link,
}) {
  if (!user_id || !type || !opp_id) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, link, entity_type, entity_id)
       SELECT $1, $2, $3, $4, $5, 'opportunity', $6
       WHERE NOT EXISTS (
         SELECT 1 FROM notifications
         WHERE user_id = $1 AND type = $2 AND entity_id = $6
           AND created_at > NOW() - INTERVAL '24 hours'
       )
       RETURNING id`,
      [user_id, type, title, body || '', link || `/opportunities/${opp_id}`, opp_id],
    );
    return rows[0]?.id || null;
  } catch (err) {
    // Non-fatal: alert failures never block the user action.
    // eslint-disable-next-line no-console
    console.error('createAlertNotification failed (non-fatal):', err.message);
    return null;
  }
}

/**
 * Evalúa si una opp califica para A3 (Champion/EB gap).
 * Devuelve array de gaps (['Champion', 'Economic Buyer']) o null.
 */
function checkA3({ status, champion_identified, economic_buyer_identified }) {
  if (!A3_STAGES.has(status)) return null;
  const gaps = [];
  if (!champion_identified) gaps.push('Champion');
  if (!economic_buyer_identified) gaps.push('Economic Buyer');
  return gaps.length > 0 ? gaps : null;
}

/**
 * RBAC role sets — centralizado para reuso entre routes y este módulo.
 */
const SEE_ALL_ROLES = new Set(['superadmin', 'admin', 'director']);

/**
 * Escanea oportunidades activas y genera notificaciones A1/A2/A3/A5.
 *
 * Diseñado para POST /api/opportunities/check-alerts (cron diario o manual).
 * Respeta scoping por rol: admin/director escanea todo; lead solo su squad;
 * member solo las suyas.
 */
async function runAlertScan(pool, { user } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const params = [];
  const addP = (v) => { params.push(v); return `$${params.length}`; };

  // Scoping
  let scopeWhere = '';
  const role = user?.role || 'member';
  if (SEE_ALL_ROLES.has(role)) {
    // no scoping — ve todo
  } else if (role === 'lead' && user?.squad_id) {
    scopeWhere = ` AND o.squad_id = ${addP(user.squad_id)}`;
  } else if (user?.id) {
    scopeWhere = ` AND (o.account_owner_id = ${addP(user.id)} OR o.presales_lead_id = ${addP(user.id)})`;
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.name, o.status, o.account_owner_id,
            o.last_stage_change_at, o.next_step, o.next_step_due_date,
            o.expected_close_date, o.champion_identified, o.economic_buyer_identified,
            EXTRACT(DAY FROM NOW() - o.last_stage_change_at)::int AS days_in_stage
       FROM opportunities o
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN ('closed_won','closed_lost','postponed')
        ${scopeWhere}
      ORDER BY o.last_stage_change_at ASC`,
    params,
  );

  let created = 0;
  const details = [];

  for (const opp of rows) {
    const userId = opp.account_owner_id;
    if (!userId) continue;

    // A1: Estancada (>30 días sin cambio de etapa).
    if (opp.days_in_stage != null && opp.days_in_stage >= ALERT_DEFS.A1_STALE.threshold_days) {
      const def = ALERT_DEFS.A1_STALE;
      const id = await createAlertNotification(pool, {
        user_id: userId, type: def.type,
        title: def.title(opp.name), body: def.body(opp.days_in_stage, opp.status),
        opp_id: opp.id,
      });
      if (id) { created++; details.push({ alert: def.code, opp_id: opp.id }); }
    }

    // A2: Próximo paso vencido.
    if (opp.next_step_due_date && String(opp.next_step_due_date).slice(0, 10) < today) {
      const def = ALERT_DEFS.A2_NEXT_STEP;
      const id = await createAlertNotification(pool, {
        user_id: userId, type: def.type,
        title: def.title(opp.name),
        body: def.body(String(opp.next_step_due_date).slice(0, 10), opp.next_step),
        opp_id: opp.id,
      });
      if (id) { created++; details.push({ alert: def.code, opp_id: opp.id }); }
    }

    // A3: Champion/EB gap en etapa avanzada.
    const a3gaps = checkA3(opp);
    if (a3gaps) {
      const def = ALERT_DEFS.A3_MEDDPICC;
      const id = await createAlertNotification(pool, {
        user_id: userId, type: def.type,
        title: def.title(opp.name), body: def.body(a3gaps),
        opp_id: opp.id,
      });
      if (id) { created++; details.push({ alert: def.code, opp_id: opp.id }); }
    }

    // A5: Cierre esperado dentro de 7 días.
    if (opp.expected_close_date) {
      const closeDate = String(opp.expected_close_date).slice(0, 10);
      const daysUntil = Math.ceil(
        (new Date(closeDate).getTime() - new Date(today).getTime()) / 86400000,
      );
      if (daysUntil >= 0 && daysUntil <= ALERT_DEFS.A5_CLOSE_SOON.threshold_days) {
        const def = ALERT_DEFS.A5_CLOSE_SOON;
        const id = await createAlertNotification(pool, {
          user_id: userId, type: def.type,
          title: def.title(opp.name), body: def.body(closeDate),
          opp_id: opp.id,
        });
        if (id) { created++; details.push({ alert: def.code, opp_id: opp.id }); }
      }
    }
  }

  return { checked: rows.length, created, details };
}

module.exports = {
  ALERT_DEFS,
  A3_STAGES,
  SEE_ALL_ROLES,
  createAlertNotification,
  checkA3,
  runAlertScan,
};
