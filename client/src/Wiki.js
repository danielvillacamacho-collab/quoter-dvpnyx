import React, { useState } from 'react';
import { WIKI_DATA } from './wikiData';

/* ========== styles ========== */
const s = {
  card: { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', padding: 20, marginBottom: 20 },
  h1:   { fontSize: 24, color: 'var(--purple-dark)', fontFamily: 'Montserrat', marginBottom: 6 },
  sub:  { fontSize: 13, color: 'var(--text-light)', marginBottom: 20 },
  h2:   { fontSize: 16, color: 'var(--purple-dark)', fontFamily: 'Montserrat', margin: '8px 0 12px' },
  bucketHeader: { fontSize: 12, fontWeight: 700, color: 'var(--teal-mid)', textTransform: 'uppercase', letterSpacing: 1, margin: '18px 0 8px' },
  tabs: { display: 'flex', gap: 4, overflowX: 'auto', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' },
  tab: (active) => ({
    padding: '8px 14px', borderRadius: '8px 8px 0 0',
    background: active ? 'var(--purple-dark)' : 'transparent',
    color: active ? '#fff' : 'var(--text-light)',
    border: active ? 'none' : '1px solid var(--border)',
    cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    fontFamily: 'Montserrat',
  }),
  levelCard: {
    background: '#fafafa',
    border: '1px solid var(--border)',
    borderLeft: '4px solid var(--purple-dark)',
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  levelHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' },
  levelCode: { fontFamily: 'Montserrat', fontWeight: 800, fontSize: 18, color: 'var(--purple-dark)' },
  levelBadge: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  field: { marginTop: 8 },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: 'var(--teal-mid)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  fieldText: { fontSize: 13, color: 'var(--text)', lineHeight: 1.5 },
  tierHeader: (color) => ({
    padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#fff',
    background: color, textAlign: 'left', whiteSpace: 'nowrap',
  }),
  td: { padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' },
};

const bucketColor = (bucket) => {
  if (!bucket) return 'var(--text-light)';
  const b = bucket.toUpperCase();
  if (b.startsWith('JUNIOR')) return 'var(--teal-mid)';
  if (b.startsWith('SEMI'))   return 'var(--orange)';
  if (b.startsWith('SENIOR')) return 'var(--purple-dark)';
  if (b.startsWith('LÍDER') || b.startsWith('LIDER')) return 'var(--purple-mid)';
  return 'var(--text-light)';
};

const tierColor = (name) => {
  const n = (name || '').toLowerCase();
  if (n.startsWith('estándar') || n.startsWith('estandar')) return 'var(--teal-mid)';
  if (n.startsWith('especializada')) return 'var(--purple-dark)';
  if (n.startsWith('alta'))  return 'var(--orange)';
  return 'var(--purple-dark)';
};

function LevelsView({ specialtyKey }) {
  const spec = WIKI_DATA.specialties[specialtyKey];
  if (!spec) return null;
  // group levels by bucket in declaration order
  const grouped = [];
  let current = null;
  spec.levels.forEach(lv => {
    if (!current || current.bucket !== lv.bucket) {
      current = { bucket: lv.bucket, items: [] };
      grouped.push(current);
    }
    current.items.push(lv);
  });
  return (
    <div>
      <h2 style={s.h2}>{spec.title}</h2>
      {grouped.map((g, i) => (
        <div key={i}>
          <div style={{ ...s.bucketHeader, color: bucketColor(g.bucket) }}>{g.bucket}</div>
          {g.items.map(lv => (
            <div key={lv.code} style={{ ...s.levelCard, borderLeftColor: bucketColor(g.bucket) }}>
              <div style={s.levelHead}>
                <span style={s.levelCode}>{lv.code}</span>
                <span style={{ ...s.levelBadge, background: bucketColor(g.bucket) + '20', color: bucketColor(g.bucket) }}>{lv.category}</span>
              </div>
              <div style={s.field}>
                <div style={s.fieldLabel}>Hard Skills</div>
                <div style={s.fieldText}>{lv.hard}</div>
              </div>
              <div style={s.field}>
                <div style={s.fieldLabel}>Soft Skills</div>
                <div style={s.fieldText}>{lv.soft}</div>
              </div>
              <div style={s.field}>
                <div style={s.fieldLabel}>Perfil típico / cuándo recomendarlo</div>
                <div style={{ ...s.fieldText, fontStyle: 'italic', color: 'var(--purple-mid)' }}>{lv.profile}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function StackView() {
  const { stackTiers, stackRows } = WIKI_DATA;
  return (
    <div>
      {/* Multiplier summary */}
      <div style={{ ...s.card, marginBottom: 16 }}>
        <h2 style={s.h2}>Categorías de Stack Tecnológico</h2>
        <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 14 }}>
          Cada perfil se clasifica en una de estas 3 categorías. El multiplicador se aplica al costo/hora calculado.
        </div>
        <div className="table-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
            <thead>
              <tr>
                <th style={s.tierHeader('var(--purple-dark)')}>Categoría</th>
                <th style={s.tierHeader('var(--purple-dark)')}>Multiplicador</th>
                <th style={s.tierHeader('var(--purple-dark)')}>Criterio</th>
              </tr>
            </thead>
            <tbody>
              {stackTiers.map(t => (
                <tr key={t.name}>
                  <td style={{ ...s.td, fontWeight: 700, color: tierColor(t.name) }}>{t.name}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontWeight: 700 }}>×{Number(t.multiplier).toFixed(2)}</td>
                  <td style={s.td}>{t.criterion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-specialty stack grid */}
      <div style={s.card}>
        <h2 style={s.h2}>¿Qué tecnología cae en qué categoría?</h2>
        <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 14 }}>
          Guía rápida para decidir a qué categoría pertenece cada perfil, por especialidad.
        </div>
        <div className="table-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...s.tierHeader('var(--purple-dark)'), minWidth: 180 }}>Especialidad</th>
                <th style={{ ...s.tierHeader('var(--teal-mid)'), minWidth: 220 }}>Estándar (×0.90)</th>
                <th style={{ ...s.tierHeader('var(--purple-dark)'), minWidth: 220 }}>Especializada (×1.00)</th>
                <th style={{ ...s.tierHeader('var(--orange)'), minWidth: 220 }}>Alta Demanda / Nicho (×1.20)</th>
              </tr>
            </thead>
            <tbody>
              {stackRows.map(r => (
                <tr key={r.specialty}>
                  <td style={{ ...s.td, fontWeight: 700, color: 'var(--purple-dark)' }}>{r.specialty}</td>
                  <td style={s.td}>{r.standard}</td>
                  <td style={s.td}>{r.specialized}</td>
                  <td style={s.td}>{r.high_demand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Wiki() {
  const specialtyKeys = Object.keys(WIKI_DATA.specialties);
  const [section, setSection] = useState('stack');   // 'stack' | 'levels'
  const [specialty, setSpecialty] = useState(specialtyKeys[0]);

  return (
    <div>
      <h1 style={s.h1}>📚 Wiki — Guía de referencia</h1>
      <div style={s.sub}>
        Material informativo extraído del modelo oficial. No se usa en los cálculos —
        solo para alinear criterio entre pre-venta y comercial.
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" style={s.tab(section === 'stack')} onClick={() => setSection('stack')}>
          🧱 Stack tecnológico
        </button>
        <button type="button" style={s.tab(section === 'levels')} onClick={() => setSection('levels')}>
          🎓 Niveles por especialidad
        </button>
      </div>

      {section === 'stack' && <StackView />}

      {section === 'levels' && (
        <>
          <div style={s.tabs} role="tablist" aria-label="Especialidad">
            {specialtyKeys.map(k => (
              <button
                key={k}
                role="tab"
                aria-selected={specialty === k}
                style={s.tab(specialty === k)}
                onClick={() => setSpecialty(k)}
              >
                {WIKI_DATA.specialties[k].title}
              </button>
            ))}
          </div>
          <div style={s.card}>
            <LevelsView specialtyKey={specialty} />
          </div>
        </>
      )}
    </div>
  );
}
