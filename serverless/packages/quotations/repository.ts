import type { Pool, PoolClient } from 'pg';
import type { PaginatedResult } from '@shared/types';
import { parseSort } from '@shared/http/pagination';
import type {
  Quotation, QuotationLine, QuotationPhase, QuotationEpic,
  QuotationMilestone, QuotationFilters,
} from './types';
import { SORTABLE } from './types';

export interface QuotationRepository {
  findAll(params: {
    page: number; limit: number; offset: number;
    filters: QuotationFilters;
    sort: ReturnType<typeof parseSort>;
  }): Promise<PaginatedResult<Quotation>>;

  findById(id: string): Promise<Quotation | null>;

  create(
    data: Record<string, unknown>,
    children: {
      lines?: QuotationLine[];
      phases?: QuotationPhase[];
      epics?: QuotationEpic[];
      milestones?: QuotationMilestone[];
    },
    createdBy: string,
    conn: PoolClient,
  ): Promise<Quotation>;

  update(
    id: string,
    data: Record<string, unknown>,
    children: {
      lines?: QuotationLine[];
      phases?: QuotationPhase[];
      epics?: QuotationEpic[];
      milestones?: QuotationMilestone[];
      allocation?: Record<string, Record<string, number>>;
    },
    conn: PoolClient,
  ): Promise<Quotation | null>;

  softDelete(id: string): Promise<Quotation | null>;

  clone(id: string, createdBy: string, conn: PoolClient): Promise<Quotation | null>;

  loadParameters(conn: Pool | PoolClient): Promise<Record<string, Array<{ key: string; value: number | string }>>>;
}

export function createQuotationRepository(db: Pool): QuotationRepository {
  return {
    /* ---------------------------------------------------------------- */
    /*  LIST                                                             */
    /* ---------------------------------------------------------------- */
    async findAll({ page, limit, offset, filters, sort }) {
      const wheres = ['q.deleted_at IS NULL'];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

      if (filters.search) {
        wheres.push(`(LOWER(q.project_name) LIKE LOWER(${add('%' + filters.search + '%')}) OR LOWER(q.client_name) LIKE LOWER(${add('%' + filters.search + '%')}))`);
      }
      if (filters.type) wheres.push(`q.type = ${add(filters.type)}`);
      if (filters.status) wheres.push(`q.status = ${add(filters.status)}`);
      if (filters.client_id) wheres.push(`q.client_id = ${add(filters.client_id)}`);
      if (filters.opportunity_id) wheres.push(`q.opportunity_id = ${add(filters.opportunity_id)}`);
      if (filters.created_by) wheres.push(`q.created_by = ${add(filters.created_by)}`);

      const where = 'WHERE ' + wheres.join(' AND ');
      const countParams = [...params];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;

      const [countRes, rowsRes] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total FROM quotations q ${where}`, countParams),
        db.query(
          `SELECT q.*, u.name AS created_by_name,
             (SELECT COUNT(*)::int FROM quotation_lines WHERE quotation_id=q.id) AS line_count
           FROM quotations q
           JOIN users u ON q.created_by = u.id
           ${where}
           ORDER BY ${sort.orderBy || 'q.updated_at DESC'}
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          [...params, limit, offset],
        ),
      ]);

      const total = countRes.rows[0].total;
      return {
        data: rowsRes.rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      };
    },

    /* ---------------------------------------------------------------- */
    /*  DETAIL                                                           */
    /* ---------------------------------------------------------------- */
    async findById(id) {
      const { rows: [quot] } = await db.query(
        `SELECT q.*, u.name AS created_by_name
         FROM quotations q
         JOIN users u ON q.created_by = u.id
         WHERE q.id = $1 AND q.deleted_at IS NULL`,
        [id],
      );
      if (!quot) return null;

      const [linesR, phasesR, epicsR, milestonesR] = await Promise.all([
        db.query('SELECT * FROM quotation_lines WHERE quotation_id=$1 ORDER BY sort_order', [id]),
        db.query('SELECT * FROM quotation_phases WHERE quotation_id=$1 ORDER BY sort_order', [id]),
        db.query('SELECT * FROM quotation_epics WHERE quotation_id=$1 ORDER BY sort_order', [id]),
        db.query('SELECT * FROM quotation_milestones WHERE quotation_id=$1 ORDER BY sort_order', [id]),
      ]);

      return {
        ...quot,
        lines: linesR.rows,
        phases: phasesR.rows,
        epics: epicsR.rows,
        milestones: milestonesR.rows,
      };
    },

    /* ---------------------------------------------------------------- */
    /*  CREATE (inside transaction)                                      */
    /* ---------------------------------------------------------------- */
    async create(data, children, createdBy, conn) {
      const { rows: [quot] } = await conn.query(
        `INSERT INTO quotations (
           type, project_name, client_id, opportunity_id,
           client_name, commercial_name, preventa_name,
           discount_pct, notes, metadata, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          data.type, data.project_name, data.client_id, data.opportunity_id,
          data.client_name, data.commercial_name || null, data.preventa_name || null,
          data.discount_pct || 0, data.notes || null,
          JSON.stringify(data.metadata || {}), createdBy,
        ],
      );

      await insertChildren(conn, quot.id, children);

      return quot;
    },

    /* ---------------------------------------------------------------- */
    /*  UPDATE (inside transaction)                                      */
    /* ---------------------------------------------------------------- */
    async update(id, data, children, conn) {
      const { rows: [quot] } = await conn.query(
        `UPDATE quotations SET
           project_name    = COALESCE($1, project_name),
           client_name     = COALESCE($2, client_name),
           commercial_name = COALESCE($3, commercial_name),
           preventa_name   = COALESCE($4, preventa_name),
           status          = COALESCE($5, status),
           discount_pct    = COALESCE($6, discount_pct),
           notes           = COALESCE($7, notes),
           metadata        = COALESCE($8, metadata),
           parameters_snapshot = COALESCE($9, parameters_snapshot),
           sent_at         = CASE WHEN $10::boolean AND sent_at IS NULL THEN NOW() ELSE sent_at END,
           updated_at      = NOW()
         WHERE id = $11 AND deleted_at IS NULL
         RETURNING *`,
        [
          data.project_name ?? null,
          data.client_name ?? null,
          data.commercial_name ?? null,
          data.preventa_name ?? null,
          data.status ?? null,
          data.discount_pct ?? null,
          data.notes ?? null,
          data.metadata ? JSON.stringify(data.metadata) : null,
          data.parameters_snapshot ? JSON.stringify(data.parameters_snapshot) : null,
          data.status === 'sent',
          id,
        ],
      );
      if (!quot) return null;

      // Replace child collections when provided
      const phaseIdByIdx: string[] = [];

      if (children.lines) {
        await conn.query('DELETE FROM quotation_lines WHERE quotation_id=$1', [id]);
        for (let i = 0; i < children.lines.length; i++) {
          const l = children.lines[i];
          await conn.query(
            `INSERT INTO quotation_lines (
               quotation_id, sort_order, specialty, role_title, level, country,
               bilingual, tools, stack, modality, quantity, duration_months,
               hours_per_week, phase, cost_hour, rate_hour, rate_month, total
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [
              id, i, l.specialty, l.role_title, l.level, l.country,
              l.bilingual, l.tools, l.stack, l.modality, l.quantity, l.duration_months,
              l.hours_per_week, l.phase, l.cost_hour, l.rate_hour, l.rate_month, l.total,
            ],
          );
        }
      }

      if (children.phases) {
        await conn.query('DELETE FROM quotation_phases WHERE quotation_id=$1', [id]);
        for (let i = 0; i < children.phases.length; i++) {
          const p = children.phases[i];
          const { rows: [inserted] } = await conn.query(
            'INSERT INTO quotation_phases (quotation_id, sort_order, name, weeks, description) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [id, i, p.name, p.weeks, p.description],
          );
          phaseIdByIdx[i] = inserted.id;
        }
      }

      // Dual-write allocation to quotation_allocations table
      if (children.allocation && typeof children.allocation === 'object') {
        let idxMap = phaseIdByIdx;
        if (idxMap.length === 0) {
          const { rows: existingPhases } = await conn.query(
            'SELECT id, sort_order FROM quotation_phases WHERE quotation_id=$1 ORDER BY sort_order',
            [id],
          );
          idxMap = existingPhases.map((r: { id: string }) => r.id);
        }
        if (phaseIdByIdx.length === 0) {
          await conn.query('DELETE FROM quotation_allocations WHERE quotation_id=$1', [id]);
        }
        for (const [lineIdxStr, phaseMap] of Object.entries(children.allocation)) {
          const lineIdx = Number(lineIdxStr);
          if (!Number.isFinite(lineIdx) || !phaseMap || typeof phaseMap !== 'object') continue;
          for (const [phaseIdxStr, hoursRaw] of Object.entries(phaseMap as Record<string, number>)) {
            const phaseIdx = Number(phaseIdxStr);
            const hours = Number(hoursRaw);
            if (!Number.isFinite(phaseIdx) || !Number.isFinite(hours) || hours <= 0) continue;
            const phaseId = idxMap[phaseIdx];
            if (!phaseId) continue;
            await conn.query(
              `INSERT INTO quotation_allocations (quotation_id, line_sort_order, phase_id, weekly_hours)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (quotation_id, line_sort_order, phase_id)
               DO UPDATE SET weekly_hours = EXCLUDED.weekly_hours`,
              [id, lineIdx, phaseId, hours],
            );
          }
        }
      }

      if (children.milestones) {
        await conn.query('DELETE FROM quotation_milestones WHERE quotation_id=$1', [id]);
        for (let i = 0; i < children.milestones.length; i++) {
          const m = children.milestones[i];
          await conn.query(
            'INSERT INTO quotation_milestones (quotation_id, sort_order, name, phase, percentage, amount, expected_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [id, i, m.name, m.phase, m.percentage, m.amount, m.expected_date],
          );
        }
      }

      if (children.epics) {
        await conn.query('DELETE FROM quotation_epics WHERE quotation_id=$1', [id]);
        for (let i = 0; i < children.epics.length; i++) {
          const e = children.epics[i];
          await conn.query(
            'INSERT INTO quotation_epics (quotation_id, sort_order, name, priority, hours_by_profile, total_hours) VALUES ($1,$2,$3,$4,$5,$6)',
            [id, i, e.name, e.priority || 'Media', JSON.stringify(e.hours_by_profile || {}), e.total_hours || 0],
          );
        }
      }

      return quot;
    },

    /* ---------------------------------------------------------------- */
    /*  SOFT DELETE                                                       */
    /* ---------------------------------------------------------------- */
    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE quotations SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },

    /* ---------------------------------------------------------------- */
    /*  CLONE (deep copy)                                                */
    /* ---------------------------------------------------------------- */
    async clone(id, createdBy, conn) {
      const { rows: [orig] } = await conn.query(
        'SELECT * FROM quotations WHERE id = $1 AND deleted_at IS NULL',
        [id],
      );
      if (!orig) return null;

      const { rows: [newq] } = await conn.query(
        `INSERT INTO quotations (
           type, parent_id, version, project_name, client_id, opportunity_id,
           client_name, commercial_name, preventa_name,
           discount_pct, notes, metadata, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          orig.type, orig.id, orig.version + 1,
          orig.project_name + ' (copia)',
          orig.client_id, orig.opportunity_id,
          orig.client_name, orig.commercial_name, orig.preventa_name,
          orig.discount_pct, orig.notes, orig.metadata, createdBy,
        ],
      );

      // Copy all child tables
      await conn.query(
        `INSERT INTO quotation_lines (
           quotation_id, sort_order, specialty, role_title, level, country,
           bilingual, tools, stack, modality, quantity, duration_months,
           hours_per_week, phase, cost_hour, rate_hour, rate_month, total
         ) SELECT $1, sort_order, specialty, role_title, level, country,
           bilingual, tools, stack, modality, quantity, duration_months,
           hours_per_week, phase, cost_hour, rate_hour, rate_month, total
         FROM quotation_lines WHERE quotation_id = $2`,
        [newq.id, id],
      );

      await conn.query(
        `INSERT INTO quotation_phases (quotation_id, sort_order, name, weeks, description)
         SELECT $1, sort_order, name, weeks, description
         FROM quotation_phases WHERE quotation_id = $2`,
        [newq.id, id],
      );

      await conn.query(
        `INSERT INTO quotation_milestones (quotation_id, sort_order, name, phase, percentage, amount, expected_date)
         SELECT $1, sort_order, name, phase, percentage, amount, expected_date
         FROM quotation_milestones WHERE quotation_id = $2`,
        [newq.id, id],
      );

      await conn.query(
        `INSERT INTO quotation_epics (quotation_id, sort_order, name, priority, hours_by_profile, total_hours)
         SELECT $1, sort_order, name, priority, hours_by_profile, total_hours
         FROM quotation_epics WHERE quotation_id = $2`,
        [newq.id, id],
      );

      return newq;
    },

    /* ---------------------------------------------------------------- */
    /*  LOAD PARAMETERS (for calc engine)                                */
    /* ---------------------------------------------------------------- */
    async loadParameters(conn) {
      const { rows } = await conn.query('SELECT category, key, value FROM parameters');
      const grouped: Record<string, Array<{ key: string; value: number | string }>> = {};
      for (const r of rows) {
        if (!grouped[r.category]) grouped[r.category] = [];
        grouped[r.category].push({ key: r.key, value: r.value });
      }
      return grouped;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Internal helper: insert child rows for CREATE                      */
/* ------------------------------------------------------------------ */

async function insertChildren(
  conn: PoolClient,
  quotationId: string,
  children: {
    lines?: QuotationLine[];
    phases?: QuotationPhase[];
    epics?: QuotationEpic[];
    milestones?: QuotationMilestone[];
  },
) {
  if (children.lines?.length) {
    for (let i = 0; i < children.lines.length; i++) {
      const l = children.lines[i];
      await conn.query(
        `INSERT INTO quotation_lines (
           quotation_id, sort_order, specialty, role_title, level, country,
           bilingual, tools, stack, modality, quantity, duration_months,
           hours_per_week, phase, cost_hour, rate_hour, rate_month, total
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          quotationId, i, l.specialty, l.role_title, l.level, l.country,
          l.bilingual, l.tools, l.stack, l.modality, l.quantity, l.duration_months,
          l.hours_per_week, l.phase, l.cost_hour, l.rate_hour, l.rate_month, l.total,
        ],
      );
    }
  }

  if (children.phases?.length) {
    for (let i = 0; i < children.phases.length; i++) {
      const p = children.phases[i];
      await conn.query(
        'INSERT INTO quotation_phases (quotation_id, sort_order, name, weeks, description) VALUES ($1,$2,$3,$4,$5)',
        [quotationId, i, p.name, p.weeks, p.description],
      );
    }
  }

  if (children.epics?.length) {
    for (let i = 0; i < children.epics.length; i++) {
      const e = children.epics[i];
      await conn.query(
        'INSERT INTO quotation_epics (quotation_id, sort_order, name, priority, hours_by_profile, total_hours) VALUES ($1,$2,$3,$4,$5,$6)',
        [quotationId, i, e.name, e.priority || 'Media', JSON.stringify(e.hours_by_profile || {}), e.total_hours || 0],
      );
    }
  }

  if (children.milestones?.length) {
    for (let i = 0; i < children.milestones.length; i++) {
      const m = children.milestones[i];
      await conn.query(
        'INSERT INTO quotation_milestones (quotation_id, sort_order, name, phase, percentage, amount, expected_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [quotationId, i, m.name, m.phase, m.percentage, m.amount, m.expected_date],
      );
    }
  }
}
