import type { Pool, PoolClient } from 'pg';
import type { AuthUser } from '@shared/types';
import type { EventEmitter } from '@shared/events/emitter';
import { withTransaction } from '@shared/db/transaction';
import { NotFound, BadRequest, Conflict, Forbidden } from '@shared/errors';

/**
 * Heuristic map: quotation specialty keywords -> area.key in the areas table.
 * New terms can be added here without a migration.
 */
const SPECIALTY_TO_AREA_KEY: Record<string, string> = {
  'desarrollo': 'development', 'development': 'development', 'dev': 'development',
  'frontend': 'development', 'backend': 'development', 'fullstack': 'development', 'mobile': 'development',
  'qa': 'testing', 'testing': 'testing', 'quality': 'testing',
  'devops': 'devops_sre', 'sre': 'devops_sre', 'infra': 'infra_security',
  'seguridad': 'infra_security', 'security': 'infra_security',
  'data': 'data_ai', 'ai': 'data_ai', 'ml': 'data_ai', 'analytics': 'data_ai',
  'ux': 'ux_ui', 'ui': 'ux_ui', 'diseño': 'ux_ui', 'design': 'ux_ui',
  'product': 'product_management', 'pm': 'product_management', 'po': 'product_management',
  'project': 'project_management', 'pmo': 'project_management',
  'analista': 'functional_analysis', 'analisis': 'functional_analysis', 'funcional': 'functional_analysis',
};

export interface KickOffResult {
  contract: Record<string, unknown>;
  kick_off_date: string;
  created_requests: Record<string, unknown>[];
  skipped: { line_id: string; role_title: string; specialty: string; error: string }[];
}

export interface KickOffService {
  kickOff(contractId: string, kickOffDate: string, user: AuthUser, force?: boolean): Promise<KickOffResult>;
}

export function createKickOffService(db: Pool, events: EventEmitter): KickOffService {
  return {
    async kickOff(contractId, kickOffDate, user, force = false) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(kickOffDate)) {
        throw new BadRequest('kick_off_date es requerido (YYYY-MM-DD)');
      }

      return withTransaction(async (conn: PoolClient) => {
        /* ---- Load contract ---- */
        const { rows: cRows } = await conn.query(
          `SELECT id, name, status, winning_quotation_id,
                  delivery_manager_id, account_owner_id, capacity_manager_id
             FROM contracts WHERE id=$1 AND deleted_at IS NULL`,
          [contractId],
        );
        if (!cRows.length) throw new NotFound('Contrato', contractId);
        const contract = cRows[0];

        /* ---- Permission gate ---- */
        const isAdmin = ['admin', 'superadmin'].includes(user.role);
        const isStakeholder =
          contract.delivery_manager_id === user.id ||
          contract.account_owner_id === user.id ||
          contract.capacity_manager_id === user.id;
        if (!isAdmin && !isStakeholder) {
          throw new Forbidden('Sólo el delivery manager (o un admin) puede iniciar el kick-off de este contrato.');
        }

        if (['completed', 'cancelled'].includes(contract.status)) {
          throw new BadRequest(`Contrato está ${contract.status}, no se puede sembrar.`);
        }

        if (!contract.winning_quotation_id) {
          throw new BadRequest(
            'El contrato no tiene cotización ganadora vinculada. Edita el contrato y asocia una winning_quotation_id antes del kick-off.',
          );
        }

        /* ---- Idempotency check ---- */
        const { rows: existingRR } = await conn.query(
          `SELECT id FROM resource_requests WHERE contract_id=$1 AND deleted_at IS NULL LIMIT 1`,
          [contractId],
        );
        if (existingRR.length && !force) {
          throw new Conflict(
            'El contrato ya tiene solicitudes. Pasa ?force=1 para borrar las anteriores y resembrar.',
            { code: 'already_seeded' },
          );
        }
        if (existingRR.length && force) {
          await conn.query(
            `UPDATE resource_requests SET deleted_at = NOW()
              WHERE contract_id=$1 AND deleted_at IS NULL`,
            [contractId],
          );
        }

        /* ---- Load quotation lines ---- */
        const { rows: lines } = await conn.query(
          `SELECT id, sort_order, specialty, role_title, level, country,
                  quantity, duration_months, hours_per_week, phase
             FROM quotation_lines
            WHERE quotation_id = $1
            ORDER BY sort_order ASC, id ASC`,
          [contract.winning_quotation_id],
        );
        if (!lines.length) {
          throw new BadRequest('La cotización ganadora no tiene líneas. Nada que sembrar.');
        }

        /* ---- Load areas for specialty mapping ---- */
        const { rows: areaRows } = await conn.query(
          `SELECT id, key, name FROM areas WHERE active=true ORDER BY id`,
        );
        const areaByKey = new Map(areaRows.map((a: Record<string, unknown>) => [a.key as string, a]));
        const areaByName = new Map(areaRows.map((a: Record<string, unknown>) => [String(a.name).toLowerCase(), a]));
        const defaultAreaId = (areaByKey.get('development') || areaRows[0])?.id;
        if (!defaultAreaId) {
          throw new BadRequest('No hay áreas en el sistema. Ejecuta seeds primero.');
        }

        function resolveAreaId(specialty: string | null | undefined): string {
          if (!specialty) return defaultAreaId as string;
          const norm = String(specialty).toLowerCase().trim();
          const byName = areaByName.get(norm);
          if (byName) return byName.id as string;
          for (const [needle, key] of Object.entries(SPECIALTY_TO_AREA_KEY)) {
            if (norm.includes(needle)) {
              const a = areaByKey.get(key);
              if (a) return a.id as string;
            }
          }
          return defaultAreaId as string;
        }

        /* ---- Create resource requests ---- */
        const created: Record<string, unknown>[] = [];
        const skipped: { line_id: string; role_title: string; specialty: string; error: string }[] = [];
        const kickoffMs = new Date(kickOffDate + 'T00:00:00Z').getTime();

        for (const line of lines) {
          try {
            const lvl = Number(line.level);
            const levelStr = (Number.isFinite(lvl) && lvl >= 1 && lvl <= 11) ? `L${lvl}` : 'L3';
            const months = Number(line.duration_months) > 0 ? Number(line.duration_months) : 6;
            const endMs = kickoffMs + months * 30 * 86400000;
            const endDate = new Date(endMs).toISOString().slice(0, 10);
            const areaId = resolveAreaId(line.specialty);
            const roleTitle = (line.role_title && String(line.role_title).trim())
              || (line.specialty ? `${line.specialty} ${levelStr}` : `Recurso ${levelStr}`);
            const weeklyHours = Number(line.hours_per_week) > 0 ? Number(line.hours_per_week) : 40;
            const quantity = Number(line.quantity) > 0 ? Number(line.quantity) : 1;
            const notesParts: string[] = [];
            if (line.phase) notesParts.push(`Fase: ${line.phase}`);
            if (line.specialty) notesParts.push(`Specialty: ${line.specialty}`);
            notesParts.push(`Sembrado desde quotation_line ${line.id} en kick-off ${kickOffDate}`);

            const { rows: rrRows } = await conn.query(
              `INSERT INTO resource_requests
                 (contract_id, role_title, area_id, level, country,
                  weekly_hours, start_date, end_date, quantity, priority, notes, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'medium',$10,$11)
               RETURNING *`,
              [
                contractId, roleTitle, areaId, levelStr, line.country || null,
                weeklyHours, kickOffDate, endDate, quantity, notesParts.join(' · '), user.id,
              ],
            );
            created.push(rrRows[0]);
          } catch (lineErr) {
            skipped.push({
              line_id: line.id,
              role_title: line.role_title,
              specialty: line.specialty,
              error: (lineErr as Error).message,
            });
          }
        }

        /* ---- Update contract metadata ---- */
        const { rows: updated } = await conn.query(
          `UPDATE contracts
              SET start_date  = LEAST(start_date, $2::date),
                  metadata    = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                                  'kick_off_date',           $2::date,
                                  'kicked_off_at',           NOW(),
                                  'kicked_off_by',           $3::uuid,
                                  'kick_off_seeded_count',   $4::int
                                ),
                  updated_at  = NOW()
            WHERE id = $1
            RETURNING *`,
          [contractId, kickOffDate, user.id, created.length],
        );

        await events.emit(conn, {
          event_type: 'contract.kicked_off',
          entity_type: 'contract',
          entity_id: contractId,
          actor_user_id: user.id,
          payload: {
            kick_off_date: kickOffDate,
            seeded_requests: created.length,
            skipped_lines: skipped.length,
            force: !!force,
          },
        });

        return {
          contract: updated[0],
          kick_off_date: kickOffDate,
          created_requests: created,
          skipped,
        };
      });
    },
  };
}
