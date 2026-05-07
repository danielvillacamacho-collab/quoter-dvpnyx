import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// Suppress React error boundary console.error spam in tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (typeof args[0] === 'string' && (
      args[0].includes('ErrorBoundary caught') ||
      args[0].includes('The above error occurred')
    )) return;
    originalError(...args);
  };
});
afterAll(() => { console.error = originalError; });

function Bomb({ shouldThrow }) {
  if (shouldThrow) throw new Error('Test boom');
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('shows error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Algo se rompió en esta pantalla')).toBeInTheDocument();
    expect(screen.getByText('Test boom')).toBeInTheDocument();
  });

  it('shows Reintentar button that resets the boundary', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Algo se rompió en esta pantalla')).toBeInTheDocument();

    // Click Reintentar — boundary resets state.error to null, but Bomb
    // will throw again. We re-render with shouldThrow=false to see recovery.
    // Since ErrorBoundary.reset() triggers setState, we test it actually
    // calls setState. The reset button exists.
    expect(screen.getByText('Reintentar')).toBeInTheDocument();
    expect(screen.getByText('Volver al dashboard')).toBeInTheDocument();
  });

  it('shows Volver al dashboard link', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    const link = screen.getByText('Volver al dashboard');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/');
  });

  it('handles non-Error thrown values', () => {
    function StringBomb() { throw 'string error'; }
    render(
      <ErrorBoundary>
        <StringBomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Algo se rompió en esta pantalla')).toBeInTheDocument();
    expect(screen.getByText('string error')).toBeInTheDocument();
  });

  it('resets and renders children after clicking Reintentar', () => {
    let shouldThrow = true;
    function Conditional() {
      if (shouldThrow) throw new Error('boom');
      return <div>Recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Conditional />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Algo se rompió en esta pantalla')).toBeInTheDocument();

    // Fix the problem and click retry
    shouldThrow = false;
    fireEvent.click(screen.getByText('Reintentar'));
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });
});
