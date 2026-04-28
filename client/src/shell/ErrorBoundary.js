import React from 'react';

/**
 * ErrorBoundary — atrapa errores de render para evitar que un crash en una
 * sola ruta tumbe TODA la app (sidebar, header, etc.) dejando pantalla en
 * blanco. React 18 desmonta el árbol entero ante un throw no atrapado, así
 * que envolvemos el outlet de rutas con esto y mostramos un fallback con
 * detalle del error y un botón para volver al dashboard.
 *
 * Bug reportado (2026-04): /time/team quedaba en blanco si el response
 * tenía una shape inesperada (e.g. data.employee undefined). Sin
 * boundary, JS throw → React unmount → pantalla blanca total.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, maxWidth: 640, margin: '40px auto', fontFamily: 'inherit' }}>
          <h2 style={{ color: '#b00020', marginTop: 0 }}>Algo se rompió en esta pantalla</h2>
          <p style={{ fontSize: 13, color: '#444' }}>
            La app no pudo renderizar esta vista. El resto de la aplicación sigue funcionando — usa el menú lateral para navegar a otra sección.
          </p>
          <pre style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, padding: 12, fontSize: 11, overflow: 'auto', maxHeight: 200 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" onClick={this.reset}
                    style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
              Reintentar
            </button>
            <a href="/" style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: 'var(--purple-dark, #4f46e5)', color: '#fff', textDecoration: 'none', fontSize: 13 }}>
              Volver al dashboard
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
