import React, { useState, useRef, useEffect, useCallback } from 'react';

const s = {
  btn: {
    background: 'var(--ds-accent, var(--purple-dark))',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--ds-radius, 6px)',
    padding: '7px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    position: 'relative',
  },
  menu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    background: 'var(--ds-surface, #fff)',
    border: '1px solid var(--ds-border)',
    borderRadius: 'var(--ds-radius, 6px)',
    boxShadow: '0 4px 12px rgba(0,0,0,.1)',
    minWidth: 120,
    zIndex: 10,
    overflow: 'hidden',
  },
  item: {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    fontSize: 13,
    color: 'var(--ds-text)',
    cursor: 'pointer',
  },
};

export default function ExportMenu({ onExportCSV, onExportExcel, onExportPdf, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  const handle = (fn) => () => { fn(); close(); };

  const options = [
    { label: 'CSV', fn: onExportCSV, show: true },
    { label: 'Excel', fn: onExportExcel, show: !!onExportExcel },
    { label: 'PDF', fn: onExportPdf, show: !!onExportPdf },
  ];

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        style={{ ...s.btn, opacity: disabled ? 0.5 : 1 }}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        Exportar ▾
      </button>
      {open && (
        <div style={s.menu}>
          {options.filter((o) => o.show).map((o) => (
            <button key={o.label} type="button" style={s.item} onClick={handle(o.fn)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
