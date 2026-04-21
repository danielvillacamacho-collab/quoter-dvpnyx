import React from 'react';
import { render, screen } from '@testing-library/react';
import AssignmentValidationInline from './AssignmentValidationInline';

/**
 * Covers the four UI states the component must handle:
 *   1. empty (no inputs yet)
 *   2. loading
 *   3. error
 *   4. validation payload → checklist in canonical order + summary badge
 */

describe('AssignmentValidationInline', () => {
  it('renders the empty hint when no validation is provided', () => {
    render(<AssignmentValidationInline />);
    expect(screen.getByTestId('val-inline-empty')).toBeInTheDocument();
    expect(screen.getByText(/Selecciona solicitud/i)).toBeInTheDocument();
  });

  it('shows loading banner while pre-validating', () => {
    render(<AssignmentValidationInline loading />);
    expect(screen.getByTestId('val-inline-loading')).toBeInTheDocument();
    expect(screen.getByText(/Validando/i)).toBeInTheDocument();
  });

  it('shows error banner when pre-validate failed', () => {
    render(<AssignmentValidationInline error="network down" />);
    expect(screen.getByTestId('val-inline-error')).toBeInTheDocument();
    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });

  it('renders all four checks in canonical order with summary', () => {
    const validation = {
      valid: false,
      can_override: true,
      summary: { pass: 2, warn: 1, fail: 1, info: 0 },
      checks: [
        // Intentionally out-of-order from the API to verify sorting.
        { check: 'capacity',      status: 'warn', message: 'Parcial 30/40h' },
        { check: 'area_match',    status: 'pass', message: 'Áreas coinciden' },
        { check: 'date_conflict', status: 'pass', message: 'Sin conflictos' },
        { check: 'level_match',   status: 'fail', message: 'Gap de 2 niveles' },
      ],
    };
    const { container } = render(<AssignmentValidationInline validation={validation} />);
    expect(screen.getByTestId('val-inline')).toBeInTheDocument();
    // Summary badge
    expect(screen.getByLabelText(/Resumen de validación/i).textContent).toMatch(/2 OK/);
    // Canonical order: area, level, capacity, date
    const rows = container.querySelectorAll('[data-testid^="val-inline-check-"]');
    const order = Array.from(rows).map((r) => r.getAttribute('data-testid'));
    expect(order).toEqual([
      'val-inline-check-area_match',
      'val-inline-check-level_match',
      'val-inline-check-capacity',
      'val-inline-check-date_conflict',
    ]);
    // Each message surfaces
    expect(screen.getByText(/Áreas coinciden/)).toBeInTheDocument();
    expect(screen.getByText(/Gap de 2 niveles/)).toBeInTheDocument();
    expect(screen.getByText(/Parcial 30\/40h/)).toBeInTheDocument();
    expect(screen.getByText(/Sin conflictos/)).toBeInTheDocument();
  });

  it('omits checks the API did not return', () => {
    const validation = {
      valid: true,
      summary: { pass: 1, warn: 0, fail: 0, info: 0 },
      checks: [{ check: 'area_match', status: 'pass', message: 'OK' }],
    };
    const { container } = render(<AssignmentValidationInline validation={validation} />);
    expect(container.querySelectorAll('[data-testid^="val-inline-check-"]')).toHaveLength(1);
  });
});
