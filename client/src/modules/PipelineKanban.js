/*
 * PipelineKanban — vista comercial principal del CRM-MVP-00.1.
 *
 * Drag & drop de oportunidades entre 7 columnas (stages). Suma USD y
 * weighted por columna y global. Filtros por owner / cliente / monto
 * mínimo / fecha de cierre. Modal de transition con warnings soft.
 *
 * No usa React Query (no está en el stack). Estado local + fetch directo
 * vía apiV2. Optimistic updates manejados con un useState "card pendiente".
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor,
  useSensor, useSensors, useDroppable, useDraggable,
} from '@dnd-kit/core';
import { apiGet, apiPost } from '../utils/apiV2';
import { STAGES, STAGE_BY_ID, computeTransitionWarnings } from '../utils/pipeline';

const fmtUSD = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n || 0));
const fmtUSDcompact = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

const s = {
  page: { padding: 18 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: 0 },
  globalSummary: { fontSize: 13, color: 'var(--text-light)' },
  filters: { display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' },
  filterInput: { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: '#fff' },
  board: { display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 16 },
  column: (color) => ({
    minWidth: 240, maxWidth: 280, flexShrink: 0,
    background: '#f7f7f9', border: `1px solid ${color}33`, borderTop: `3px solid ${color}`,
    borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '78vh',
  }),
  colHeader: { padding: '4px 6px' },
  colTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  colSubtitle: { fontSize: 10, color: 'var(--text-light)', marginTop: 2 },
  colTotals: { fontSize: 11, color: 'var(--text-light)', marginTop: 4 },
  cardsScroll: { overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2 },
  emptyCol: { fontSize: 11, color: 'var(--text-light)', fontStyle: 'italic', textAlign: 'center', padding: 16 },
  card: { background: '#fff', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--border)', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', cursor: 'grab' },
  cardClient: { fontSize: 11, color: 'var(--text-light)', fontWeight: 600 },
  cardName: { fontSize: 13, color: 'var(--text)', fontWeight: 600, marginTop: 1, lineHeight: 1.25 },
  cardMeta: { fontSize: 10, color: 'var(--text-light)', marginTop: 5, display: 'flex', justifyContent: 'space-between' },
  cardAmount: { fontSize: 12, fontWeight: 700, color: 'var(--purple-dark)' },
  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modal: { background: '#fff', borderRadius: 10, padding: 22, maxWidth: 460, width: '90%', maxHeight: '86vh', overflowY: 'auto' },
  warnBox: { background: '#fff7e6', color: '#92400e', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 10 },
  errBox: { background: '#fde8eb', color: '#b00020', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 10 },
};

/* ============== CARD ============== */
function OpportunityCard({ opp, onClick }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: opp.id, data: { opp } });
  const style = {
    ...s.card,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={style} onClick={onClick}
         role="button" tabIndex={0} aria-label={`Oportunidad ${opp.name}`}>
      <div style={s.cardClient}>{opp.client_name || '—'}</div>
      <div style={s.cardName}>{opp.name}</div>
      <div style={s.cardMeta}>
        <span style={s.cardAmount}>{fmtUSD(opp.booking_amount_usd)}</span>
        <span>{opp.owner_name || '—'}</span>
      </div>
      <div style={s.cardMeta}>
        <span>📅 {fmtDate(opp.expected_close_date)}</span>
        <span>{opp.days_in_current_stage != null ? `${opp.days_in_current_stage}d aquí` : ''}</span>
      </div>
      {opp.next_step && (
        <div style={{ fontSize: 10, color: 'var(--purple-dark)', marginTop: 4, fontStyle: 'italic' }}>
          ⚡ {opp.next_step}{opp.next_step_due_date ? ` · ${fmtDate(opp.next_step_due_date)}` : ''}
        </div>
      )}
    </div>
  );
}

/* ============== COLUMN ============== */
function KanbanColumn({ stage, onCardClick }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div ref={setNodeRef} style={{ ...s.column(stage.color), background: isOver ? `${stage.color}15` : '#f7f7f9' }} aria-label={`Columna ${stage.label}`}>
      <div style={s.colHeader}>
        <div style={s.colTitle}>
          <span style={{ display: 'inline-block', width: 8, height: 8, background: stage.color, borderRadius: 50, marginRight: 6 }} />
          {stage.label}
        </div>
        <div style={s.colSubtitle}>{stage.prob}% probabilidad</div>
        <div style={s.colTotals}>
          <strong>{stage.summary.count}</strong> deals · {fmtUSDcompact(stage.summary.total_amount_usd)} · wt {fmtUSDcompact(stage.summary.weighted_amount_usd)}
        </div>
      </div>
      <div style={s.cardsScroll}>
        {stage.opportunities.length === 0 ? (
          <div style={s.emptyCol}>Sin oportunidades aquí.</div>
        ) : stage.opportunities.map((opp) => (
          <OpportunityCard key={opp.id} opp={opp} onClick={(e) => { if (!e.defaultPrevented) onCardClick(opp); }} />
        ))}
        {stage.summary.has_more && (
          <div style={{ fontSize: 10, color: 'var(--text-light)', textAlign: 'center', padding: 6 }}>
            +{stage.summary.count - stage.opportunities.length} más (filtra para ver)
          </div>
        )}
      </div>
    </div>
  );
}

/* ============== TRANSITION MODAL ============== */
function TransitionModal({ opp, fromStage, toStage, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [winningQuotation, setWinningQuotation] = useState('');
  const [outcomeReason, setOutcomeReason] = useState('');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [quotations, setQuotations] = useState([]);
  const fromS = STAGE_BY_ID[fromStage];
  const toS = STAGE_BY_ID[toStage];
  const requiresWinning = toStage === 'won';
  const requiresOutcomeReason = toStage === 'lost' || toStage === 'cancelled';

  const warnings = useMemo(
    () => computeTransitionWarnings({ fromStage, toStage, opportunity: opp }),
    [fromStage, toStage, opp],
  );

  // Cargar cotizaciones de la oportunidad si vamos a 'won'
  useEffect(() => {
    if (!requiresWinning) return;
    apiGet(`/api/quotations?opportunity_id=${opp.id}`)
      .then((d) => setQuotations(Array.isArray(d) ? d : (d?.data || [])))
      .catch(() => setQuotations([]));
  }, [opp.id, requiresWinning]);

  const handleConfirm = async () => {
    if (requiresWinning && !winningQuotation) { setError('Selecciona la cotización ganadora.'); return; }
    if (requiresOutcomeReason && !outcomeReason) { setError('Indica la razón del resultado.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const body = {
        new_status: toStage,
        outcome_notes: reason || outcomeNotes || undefined,
      };
      if (requiresWinning) body.winning_quotation_id = winningQuotation;
      if (requiresOutcomeReason) body.outcome_reason = outcomeReason;
      const result = await apiPost(`/api/opportunities/${opp.id}/status`, body);
      onConfirm(result);
    } catch (e) {
      setError(e.message || 'Error al cambiar etapa');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={s.modalBackdrop} onClick={onCancel}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 style={{ margin: 0, fontSize: 16, color: 'var(--purple-dark)', fontFamily: 'Montserrat' }}>
          Mover a "{toS?.label}"
        </h3>
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-light)' }}>
          {opp.client_name} · {opp.name}
        </div>
        <div style={{ marginTop: 6, fontSize: 13 }}>
          De: <strong>{fromS?.label}</strong> ({fromS?.prob}%) → A: <strong>{toS?.label}</strong> ({toS?.prob}%)
        </div>

        {warnings.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {warnings.map((w) => <div key={w.code} style={s.warnBox}>⚠ {w.message}</div>)}
          </div>
        )}
        {error && <div style={{ ...s.errBox, marginTop: 12 }}>{error}</div>}

        {requiresWinning && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>
              Cotización ganadora *
            </label>
            <select value={winningQuotation} onChange={(e) => setWinningQuotation(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
              <option value="">— Selecciona una cotización —</option>
              {quotations.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.project_name || q.id} · {q.status} · {fmtUSD(q.total_usd)}
                </option>
              ))}
            </select>
            {quotations.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
                Esta oportunidad aún no tiene cotizaciones. Crea una desde el detalle antes de marcarla como ganada.
              </div>
            )}
          </div>
        )}

        {requiresOutcomeReason && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>
              Razón del resultado *
            </label>
            <select value={outcomeReason} onChange={(e) => setOutcomeReason(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
              <option value="">—</option>
              <option value="price">Precio</option>
              <option value="timing">Tiempo / fecha</option>
              <option value="competition">Competencia</option>
              <option value="technical_fit">Ajuste técnico</option>
              <option value="client_internal">Decisión interna del cliente</option>
              <option value="other">Otro</option>
            </select>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>
            Notas (opcional)
          </label>
          <textarea
            value={requiresOutcomeReason ? outcomeNotes : reason}
            onChange={(e) => requiresOutcomeReason ? setOutcomeNotes(e.target.value) : setReason(e.target.value)}
            placeholder={toS?.terminal ? 'Describe cómo se resolvió la oportunidad' : 'Razón del cambio de etapa'}
            style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onCancel} disabled={submitting}
                  style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button type="button" onClick={handleConfirm} disabled={submitting}
                  style={{ padding: '8px 16px', border: 'none', borderRadius: 6, background: 'var(--purple-dark)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}>
            {submitting ? 'Guardando…' : 'Confirmar transición'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============== MAIN PAGE ============== */
export default function PipelineKanban() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ stages: [], global_summary: { total_opportunities: 0, total_amount_usd: 0, weighted_amount_usd: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingTransition, setPendingTransition] = useState(null); // { opp, fromStage, toStage }
  const [activeOpp, setActiveOpp] = useState(null);
  const [users, setUsers] = useState([]);

  // Filtros desde URL (compartibles)
  const filters = {
    owner_id: searchParams.get('owner_id') || '',
    min_amount_usd: searchParams.get('min_amount_usd') || '',
    from_expected_close: searchParams.get('from_expected_close') || '',
    to_expected_close: searchParams.get('to_expected_close') || '',
  };
  const setFilter = (k, v) => {
    const next = new URLSearchParams(searchParams);
    if (v) next.set(k, v); else next.delete(k);
    setSearchParams(next);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
      const url = `/api/opportunities/kanban${qs.toString() ? `?${qs}` : ''}`;
      const result = await apiGet(url);
      setData(result);
    } catch (e) {
      setError(e.message || 'Error cargando pipeline');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiGet('/api/users').then(setUsers).catch(() => {}); }, []);

  const handleDragStart = (e) => {
    const opp = e.active.data?.current?.opp;
    if (opp) setActiveOpp(opp);
  };

  const handleDragEnd = (e) => {
    setActiveOpp(null);
    const fromStage = e.active.data?.current?.opp?.status;
    const toStage = e.over?.id;
    const opp = e.active.data?.current?.opp;
    if (!opp || !toStage || fromStage === toStage) return;
    setPendingTransition({ opp, fromStage, toStage });
  };

  const handleTransitionConfirm = (updated) => {
    setPendingTransition(null);
    // Optimistic refresh
    load();
    if (updated?.warnings?.length > 0) {
      // eslint-disable-next-line no-alert
      alert(`Transición guardada con avisos:\n${updated.warnings.map((w) => '· ' + w.message).join('\n')}`);
    }
  };

  const stages = data.stages.length ? data.stages : STAGES.map((s) => ({
    ...s,
    summary: { count: 0, total_amount_usd: 0, weighted_amount_usd: 0, has_more: false },
    opportunities: [],
  }));

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>📊 Pipeline Comercial</h2>
          <div style={s.globalSummary}>
            <strong>{data.global_summary.total_opportunities}</strong> oportunidades ·{' '}
            Total <strong>{fmtUSD(data.global_summary.total_amount_usd)}</strong> ·{' '}
            Weighted <strong>{fmtUSD(data.global_summary.weighted_amount_usd)}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link to="/opportunities" style={{ padding: '6px 14px', border: '1px solid var(--purple-dark)', borderRadius: 6, color: 'var(--purple-dark)', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
            ☰ Vista lista
          </Link>
          <button type="button" onClick={() => nav('/opportunities/new')}
                  style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: 'var(--purple-dark)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            + Nueva oportunidad
          </button>
        </div>
      </div>

      <div style={s.filters}>
        <select aria-label="Filtrar por owner" value={filters.owner_id} onChange={(e) => setFilter('owner_id', e.target.value)} style={s.filterInput}>
          <option value="">Todos los owners</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
        <input
          type="number" min={0} step={1000}
          placeholder="Monto mínimo USD"
          aria-label="Monto mínimo USD"
          value={filters.min_amount_usd}
          onChange={(e) => setFilter('min_amount_usd', e.target.value)}
          style={{ ...s.filterInput, width: 130 }}
        />
        <input
          type="date" aria-label="Cierre desde" value={filters.from_expected_close}
          onChange={(e) => setFilter('from_expected_close', e.target.value)} style={s.filterInput}
        />
        <input
          type="date" aria-label="Cierre hasta" value={filters.to_expected_close}
          onChange={(e) => setFilter('to_expected_close', e.target.value)} style={s.filterInput}
        />
        {(filters.owner_id || filters.min_amount_usd || filters.from_expected_close || filters.to_expected_close) && (
          <button type="button" onClick={() => setSearchParams({})}
                  style={{ ...s.filterInput, cursor: 'pointer', color: 'var(--purple-dark)', fontWeight: 600 }}>
            ✕ Limpiar
          </button>
        )}
      </div>

      {error && <div style={s.errBox}>{error}</div>}
      {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Cargando pipeline…</div>}

      {!loading && (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div style={s.board}>
            {stages.map((stage) => (
              <KanbanColumn
                key={stage.id} stage={stage}
                onCardClick={(opp) => nav(`/opportunities/${opp.id}`)}
              />
            ))}
          </div>
          <DragOverlay>
            {activeOpp ? (
              <div style={{ ...s.card, transform: 'rotate(-2deg)' }}>
                <div style={s.cardClient}>{activeOpp.client_name || '—'}</div>
                <div style={s.cardName}>{activeOpp.name}</div>
                <div style={s.cardAmount}>{fmtUSD(activeOpp.booking_amount_usd)}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {pendingTransition && (
        <TransitionModal
          opp={pendingTransition.opp}
          fromStage={pendingTransition.fromStage}
          toStage={pendingTransition.toStage}
          onConfirm={handleTransitionConfirm}
          onCancel={() => setPendingTransition(null)}
        />
      )}
    </div>
  );
}
