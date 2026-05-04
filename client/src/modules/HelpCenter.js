/**
 * HelpCenter.js — Manual de usuario vivo
 *
 * Ruta: /help
 *
 * Dos vistas:
 *   1. Lista / navegación por categoría  →  /help
 *   2. Artículo individual               →  /help/:slug
 *
 * Los admins ven un botón "Editar" por artículo y pueden crear nuevos.
 * El contenido Markdown se renderiza con un renderer CSS-only (sin dependencias
 * externas): convierte cabeceras, negrita, cursiva, código, tablas y listas.
 *
 * @docs-required: ayuda-bienvenida
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiV2';
import { useAuth } from '../AuthContext';

// ─── Design tokens ────────────────────────────────────────────────────────────

const ds = {
  wrap:     { maxWidth: 1100, margin: '0 auto', padding: '24px 20px', display: 'flex', gap: 28, alignItems: 'flex-start' },
  sidebar:  { width: 220, flexShrink: 0, position: 'sticky', top: 24 },
  main:     { flex: 1, minWidth: 0 },
  h1:       { fontSize: 22, fontFamily: 'Montserrat', margin: '0 0 4px', color: 'var(--ds-text)' },
  sub:      { fontSize: 13, color: 'var(--ds-text-soft, var(--text-light))', marginBottom: 20 },
  card:     { background: 'var(--ds-surface,#fff)', borderRadius: 'var(--ds-radius,8px)', border: '1px solid var(--ds-border)', padding: '16px 20px', marginBottom: 12 },
  catLabel: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--ds-text-soft,var(--text-light))', marginBottom: 6, marginTop: 16 },
  navLink:  (active) => ({
    display: 'block', padding: '5px 10px', borderRadius: 6, fontSize: 13,
    textDecoration: 'none', cursor: 'pointer',
    color: active ? 'var(--ds-accent,var(--purple-dark))' : 'var(--ds-text)',
    background: active ? 'var(--ds-accent-light,rgba(99,102,241,.08))' : 'transparent',
    fontWeight: active ? 600 : 400,
    border: 'none', textAlign: 'left', width: '100%',
  }),
  btn:      { background: 'var(--ds-accent,var(--purple-dark))', color: '#fff', border: 'none', borderRadius: 'var(--ds-radius,6px)', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGhost: { background: 'transparent', color: 'var(--ds-accent,var(--purple-dark))', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius,6px)', padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  btnDanger:{ background: 'transparent', color: 'var(--ds-bad,#ef4444)', border: '1px solid var(--ds-bad,#ef4444)', borderRadius: 'var(--ds-radius,6px)', padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  input:    { padding: '7px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius,6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13, width: '100%', boxSizing: 'border-box' },
  textarea: { padding: '8px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius,6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13, width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', lineHeight: 1.5, resize: 'vertical' },
  label:    { fontSize: 12, fontWeight: 600, color: 'var(--ds-text-soft,var(--text-light))', display: 'block', marginBottom: 4 },
  badge:    (pub) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: pub ? 'var(--ds-ok-bg,#d1fae5)' : 'var(--ds-warn-bg,#fef9c3)', color: pub ? 'var(--ds-ok,#065f46)' : 'var(--ds-warn,#92400e)' }),
  search:   { padding: '7px 10px', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius,6px)', background: 'var(--ds-surface)', color: 'var(--ds-text)', fontSize: 13, width: '100%', boxSizing: 'border-box', marginBottom: 16 },
};

const CATEGORY_LABELS = {
  general:    '📋 General',
  crm:        '🎯 CRM / Oportunidades',
  delivery:   '🚀 Delivery',
  time:       '⏱ Time Tracking',
  reportes:   '📊 Reportes',
  finanzas:   '💰 Finanzas',
  plataforma: '⚙️ Plataforma',
};

const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS);

// ─── Markdown renderer (zero-deps) ───────────────────────────────────────────

function renderMarkdown(md) {
  if (!md) return '';
  let html = md
    // Sanitizar HTML (básico)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Cabeceras
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Negrita + cursiva
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Código inline
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Listas no ordenadas
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Listas ordenadas
    .replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>')
    // Separador
    .replace(/^---$/gm, '<hr/>');

  // Tablas markdown
  html = html.replace(/(?:^|\n)((?:\|.+\|\n?)+)/g, (match, tableBlock) => {
    const rows = tableBlock.trim().split('\n').filter(Boolean);
    if (rows.length < 2) return match;
    const isHeader = (r) => /^\|[-: |]+\|$/.test(r.trim());
    let out = '<table class="md-table">';
    let inBody = false;
    rows.forEach((row) => {
      if (isHeader(row)) { inBody = true; return; }
      const cells = row.split('|').slice(1, -1).map(c => c.trim());
      const tag   = !inBody ? 'th' : 'td';
      if (!inBody) out += '<thead><tr>';
      else if (!out.includes('<tbody>')) out += '<tbody><tr>';
      else out += '<tr>';
      cells.forEach(c => { out += `<${tag}>${c}</${tag}>`; });
      out += '</tr>';
      if (!inBody) out += '</thead>';
    });
    out += inBody ? '</tbody>' : '';
    out += '</table>';
    return out;
  });

  // Agrupar <li> en <ul> y <oli> en <ol>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  html = html.replace(/(<oli>.*<\/oli>\n?)+/g, m => `<ol>${m.replace(/<\/?oli>/g, m2 => m2.replace('oli','li'))}</ol>`);

  // Párrafos (líneas que no empiezan con tag HTML)
  html = html.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (/^<(h[1-4]|ul|ol|li|table|hr|thead|tbody|tr|th|td)/.test(trimmed)) return trimmed;
    return `<p>${trimmed}</p>`;
  }).join('\n');

  return html;
}

// ─── MarkdownView ─────────────────────────────────────────────────────────────

function MarkdownView({ content }) {
  return (
    <div
      className="md-body"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      style={{ lineHeight: 1.65, fontSize: 14, color: 'var(--ds-text)' }}
    />
  );
}

// ─── ArticleEditor ────────────────────────────────────────────────────────────

function ArticleEditor({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    slug:         initial?.slug         || '',
    title:        initial?.title        || '',
    category:     initial?.category     || 'general',
    sort_order:   initial?.sort_order   ?? 0,
    body_md:      initial?.body_md      || '',
    is_published: initial?.is_published ?? false,
  });
  const [preview, setPreview] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');
  const isNew = !initial?.slug;

  const handle = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (isNew) {
        await apiPost('/api/help', form);
      } else {
        const payload = { ...form };
        if (payload.slug !== initial.slug) payload.new_slug = payload.slug;
        delete payload.slug;
        await apiPut(`/api/help/${initial.slug}`, payload);
      }
      onSave();
    } catch (e) {
      setErr(e?.data?.error || e?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...ds.card, background: 'var(--ds-surface-raised,var(--ds-surface,#f8f8f8))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <strong style={{ fontSize: 15 }}>{isNew ? 'Nuevo artículo' : 'Editar artículo'}</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={ds.btnGhost} onClick={() => setPreview(p => !p)}>{preview ? 'Editar' : 'Vista previa'}</button>
          <button style={ds.btnGhost} onClick={onCancel}>Cancelar</button>
          <button style={ds.btn} onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>

      {err && <div style={{ color: 'var(--ds-bad,#ef4444)', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {preview ? (
        <div style={{ padding: '12px 0' }}>
          <h2 style={{ ...ds.h1, marginBottom: 4 }}>{form.title || '(sin título)'}</h2>
          <MarkdownView content={form.body_md} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={ds.label}>Slug *</label>
              <input style={ds.input} value={form.slug} onChange={handle('slug')} placeholder="mi-feature-slug" disabled={!isNew} title={!isNew ? 'Para renombrar el slug edita el campo y guarda' : undefined} />
              {isNew && <span style={{ fontSize: 11, color: 'var(--ds-text-soft)' }}>Solo minúsculas, números y guiones. Inmutable después de crear.</span>}
            </div>
            <div>
              <label style={ds.label}>Título *</label>
              <input style={ds.input} value={form.title} onChange={handle('title')} placeholder="Cómo funciona el CRM" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={ds.label}>Categoría *</label>
              <select style={{ ...ds.input }} value={form.category} onChange={handle('category')}>
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label style={ds.label}>Orden</label>
              <input style={ds.input} type="number" value={form.sort_order} onChange={handle('sort_order')} min={0} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={form.is_published} onChange={handle('is_published')} />
                Publicado (visible para usuarios)
              </label>
            </div>
          </div>
          <div>
            <label style={ds.label}>Contenido (Markdown)</label>
            <textarea
              style={{ ...ds.textarea, minHeight: 300 }}
              value={form.body_md}
              onChange={handle('body_md')}
              placeholder={'# Título\n\nEscribe en Markdown. Soporta **negrita**, *cursiva*, `código`, tablas y listas.\n\n## Sección\n\n- Punto 1\n- Punto 2'}
            />
            <span style={{ fontSize: 11, color: 'var(--ds-text-soft)' }}>Soporta cabeceras, negrita, cursiva, código, tablas y listas.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ArticleView ──────────────────────────────────────────────────────────────
// Recibe el artículo directamente del padre (ya viene en la respuesta de lista),
// eliminando la segunda llamada a GET /api/help/:slug que era problemática.

function ArticleView({ article, isAdmin, onEdit }) {
  const navigate = useNavigate();

  const handleDelete = async () => {
    if (!window.confirm(`¿Eliminar el artículo "${article?.title}"? Esta acción no se puede deshacer.`)) return;
    try {
      await apiDelete(`/api/help/${article.slug}`);
      navigate('/help');
    } catch (e) {
      alert(e?.body?.error || e?.message || 'Error al eliminar');
    }
  };

  if (!article) return <div style={{ color: 'var(--ds-bad,#ef4444)', fontSize: 13 }}>Artículo no encontrado.</div>;

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: 'var(--ds-text-soft)', marginBottom: 12 }}>
        <Link to="/help" style={{ color: 'var(--ds-accent)', textDecoration: 'none' }}>Manual de usuario</Link>
        {' › '}
        {CATEGORY_LABELS[article.category] || article.category}
        {' › '}
        <span>{article.title}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
        <div>
          <h1 style={ds.h1}>{article.title}</h1>
          <span style={ds.badge(article.is_published)}>
            {article.is_published ? 'Publicado' : 'Borrador'}
          </span>
          {article.updated_by_name && (
            <span style={{ fontSize: 11, color: 'var(--ds-text-soft)', marginLeft: 10 }}>
              Actualizado por {article.updated_by_name} · {new Date(article.updated_at).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button style={ds.btnGhost} onClick={onEdit}>✏️ Editar</button>
            <button style={ds.btnDanger} onClick={handleDelete}>Eliminar</button>
          </div>
        )}
      </div>

      <div style={ds.card}>
        <MarkdownView content={article.body_md} />
      </div>
    </div>
  );
}

// ─── HelpCenter (main) ────────────────────────────────────────────────────────

export default function HelpCenter() {
  const { slug }         = useParams();
  const navigate         = useNavigate();
  const { user }         = useAuth() || {};
  const isAdmin          = ['superadmin', 'admin'].includes(user?.role);

  const [articles, setArticles]   = useState([]);
  const [byCategory, setByCategory] = useState({});
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState('');
  const [editing, setEditing]     = useState(false);   // true = nueva, 'slug' = editar
  const [search, setSearch]       = useState('');
  const searchRef                 = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const data = await apiGet('/api/help');
      setArticles(data.data || []);
      setByCategory(data.byCategory || {});
    } catch (e) {
      setErr(e?.body?.error || e?.message || 'Error al cargar el manual');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filtro de búsqueda
  const filtered = search.trim()
    ? articles.filter(a =>
        a.title.toLowerCase().includes(search.toLowerCase()) ||
        a.slug.includes(search.toLowerCase())
      )
    : null;

  // Si estamos en modo edición de un artículo existente, obtenemos sus datos
  const editingArticle = editing && editing !== true
    ? articles.find(a => a.slug === editing)
    : null;

  // ── Render: editor nuevo ───────────────────────────────────────────────────
  if (editing === true) {
    return (
      <div style={ds.wrap}>
        <div style={ds.main}>
          <ArticleEditor
            initial={null}
            onSave={() => { load(); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    );
  }

  // ── Render: editor de artículo existente ──────────────────────────────────
  if (editing && editingArticle) {
    return (
      <div style={ds.wrap}>
        <div style={ds.main}>
          <ArticleEditor
            initial={editingArticle}
            onSave={() => { load(); setEditing(false); if (slug) navigate(`/help/${editingArticle.slug}`); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    );
  }

  // ── Render: artículo individual ───────────────────────────────────────────
  if (slug) {
    // El artículo ya viene en la respuesta de lista (body_md incluido).
    // No hacemos una segunda llamada a GET /api/help/:slug.
    const currentArticle = articles.find(a => a.slug === slug) || null;
    return (
      <div style={ds.wrap}>
        {/* Sidebar */}
        <nav style={ds.sidebar} aria-label="Navegación del manual">
          <Sidebar byCategory={byCategory} activeSlug={slug} isAdmin={isAdmin} onNew={() => setEditing(true)} />
        </nav>
        <div style={ds.main}>
          {loading
            ? <div style={{ fontSize: 13, color: 'var(--ds-text-soft)' }}>Cargando…</div>
            : <ArticleView
                article={currentArticle}
                isAdmin={isAdmin}
                onEdit={() => setEditing(slug)}
              />
          }
        </div>
      </div>
    );
  }

  // ── Render: índice ────────────────────────────────────────────────────────
  const categoriesToShow = filtered
    ? { 'Resultados de búsqueda': filtered }
    : byCategory;

  return (
    <div style={ds.wrap}>
      {/* Sidebar */}
      <nav style={ds.sidebar} aria-label="Navegación del manual">
        <Sidebar byCategory={byCategory} activeSlug={null} isAdmin={isAdmin} onNew={() => setEditing(true)} />
      </nav>

      {/* Main content */}
      <div style={ds.main}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <h1 style={ds.h1}>Manual de usuario</h1>
            <p style={ds.sub}>Documentación interna del Quoter DVPNYX.</p>
          </div>
          {isAdmin && (
            <button style={ds.btn} onClick={() => setEditing(true)}>+ Nuevo artículo</button>
          )}
        </div>

        {/* Búsqueda */}
        <input
          ref={searchRef}
          style={ds.search}
          placeholder="Buscar en el manual…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Buscar artículos"
        />

        {loading && <div style={{ fontSize: 13, color: 'var(--ds-text-soft)' }}>Cargando…</div>}
        {err     && <div style={{ color: 'var(--ds-bad,#ef4444)', fontSize: 13 }}>{err}</div>}

        {!loading && !err && Object.keys(categoriesToShow).length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--ds-text-soft)' }}>
            {search ? 'Sin resultados para esa búsqueda.' : 'No hay artículos publicados aún.'}
          </div>
        )}

        {Object.entries(categoriesToShow).map(([cat, arts]) => (
          <div key={cat} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--ds-text-soft)', marginBottom: 10, marginTop: 8 }}>
              {CATEGORY_LABELS[cat] || cat}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {arts.map(a => (
                <Link
                  key={a.slug}
                  to={`/help/${a.slug}`}
                  style={{ ...ds.card, textDecoration: 'none', display: 'block', marginBottom: 0, transition: 'box-shadow .15s' }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.08)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ds-text)', marginBottom: 4 }}>{a.title}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {isAdmin && !a.is_published && <span style={ds.badge(false)}>Borrador</span>}
                    <span style={{ fontSize: 11, color: 'var(--ds-text-soft)' }}>
                      {new Date(a.updated_at).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ byCategory, activeSlug, isAdmin, onNew }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ds-text)', marginBottom: 12, fontFamily: 'Montserrat' }}>
        📖 Manual de usuario
      </div>

      <Link to="/help" style={ds.navLink(!activeSlug)}>Inicio</Link>

      {Object.entries(byCategory).map(([cat, arts]) => (
        <div key={cat}>
          <div style={ds.catLabel}>{CATEGORY_LABELS[cat] || cat}</div>
          {arts.map(a => (
            <Link key={a.slug} to={`/help/${a.slug}`} style={ds.navLink(a.slug === activeSlug)}>
              {a.title}
            </Link>
          ))}
        </div>
      ))}

      {isAdmin && (
        <div style={{ marginTop: 20, borderTop: '1px solid var(--ds-border)', paddingTop: 14 }}>
          <div style={ds.catLabel}>Admin</div>
          <button style={{ ...ds.navLink(false), color: 'var(--ds-accent)' }} onClick={onNew}>+ Nuevo artículo</button>
        </div>
      )}
    </div>
  );
}
