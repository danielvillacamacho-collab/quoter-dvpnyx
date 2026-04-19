import React from 'react';

/**
 * Sticky footer — always visible at the bottom-right of the main content.
 * Shows version + short git SHA so users can reference the exact build in
 * bug reports. SHA is injected at build time via REACT_APP_GIT_SHA.
 */
export default function Footer() {
  const version = process.env.REACT_APP_VERSION || '2.0.0-dev';
  const sha = (process.env.REACT_APP_GIT_SHA || 'local').slice(0, 7);
  return (
    <div
      className="app-footer"
      role="contentinfo"
      aria-label="Información de versión"
    >
      <span>v{version}</span>
      <span className="app-footer-sep">·</span>
      <span title="Short git SHA of this build">build {sha}</span>
    </div>
  );
}
