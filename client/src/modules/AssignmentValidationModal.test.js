import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AssignmentValidationModal from './AssignmentValidationModal';

const overridableValidation = {
  valid: false,
  can_override: true,
  requires_justification: true,
  checks: [
    { check: 'area_match',    status: 'pass', message: 'Áreas coinciden: Desarrollo.' },
    { check: 'level_match',   status: 'pass', message: 'Level exacto: L5.' },
    { check: 'capacity',      status: 'fail', overridable: true, message: 'Sin capacidad: 50h/40h.',
      detail: { capacity: 40, committed: 30, requested: 20, available: -10, utilization_after_pct: 125 } },
    { check: 'date_conflict', status: 'pass', message: 'Dentro del periodo.' },
  ],
  summary: { pass: 3, warn: 0, info: 0, fail: 1, overridable_fails: 1, non_overridable_fails: 0 },
};

const hardFailValidation = {
  valid: false,
  can_override: false,
  requires_justification: false,
  checks: [
    { check: 'area_match',    status: 'pass', message: 'ok' },
    { check: 'level_match',   status: 'pass', message: 'ok' },
    { check: 'capacity',      status: 'pass', message: 'ok' },
    { check: 'date_conflict', status: 'fail', overridable: false, message: 'La asignación no se solapa con la solicitud.' },
  ],
  summary: { pass: 3, warn: 0, info: 0, fail: 1, overridable_fails: 0, non_overridable_fails: 1 },
};

describe('AssignmentValidationModal', () => {
  it('renders checklist with all 4 checks', () => {
    render(<AssignmentValidationModal validation={overridableValidation} onConfirm={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByTestId('check-area_match')).toBeInTheDocument();
    expect(screen.getByTestId('check-level_match')).toBeInTheDocument();
    expect(screen.getByTestId('check-capacity')).toBeInTheDocument();
    expect(screen.getByTestId('check-date_conflict')).toBeInTheDocument();
  });

  it('shows justification textarea for overridable fails', () => {
    render(<AssignmentValidationModal validation={overridableValidation} onConfirm={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByLabelText(/Justificación de override/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear con justificación/i })).toBeDisabled();
  });

  it('enables the confirm button only when justification ≥ 10 chars', () => {
    render(<AssignmentValidationModal validation={overridableValidation} onConfirm={jest.fn()} onClose={jest.fn()} />);
    const ta = screen.getByLabelText(/Justificación de override/i);
    const btn = screen.getByRole('button', { name: /Crear con justificación/i });

    fireEvent.change(ta, { target: { value: 'corto' } });
    expect(btn).toBeDisabled();
    fireEvent.change(ta, { target: { value: 'Aprobado por COO para cubrir hito crítico' } });
    expect(btn).not.toBeDisabled();
  });

  it('calls onConfirm with the trimmed reason when confirmed', async () => {
    const onConfirm = jest.fn().mockResolvedValue();
    render(<AssignmentValidationModal validation={overridableValidation} onConfirm={onConfirm} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/Justificación/), { target: { value: '   Aprobado por COO para cubrir hito crítico.   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear con justificación/i }));
    expect(onConfirm).toHaveBeenCalledWith('Aprobado por COO para cubrir hito crítico.');
  });

  it('hides the confirm button and textarea when the fail is non-overridable', () => {
    render(<AssignmentValidationModal validation={hardFailValidation} onConfirm={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByLabelText(/Justificación/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crear con justificación/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cerrar/i })).toBeInTheDocument();
    // The banner must spell out that it's blocking
    expect(screen.getByRole('alert').textContent).toMatch(/bloqueantes|bloqueante|no puede crearse/i);
  });

  it('renders advisories when provided', () => {
    render(
      <AssignmentValidationModal
        validation={overridableValidation}
        advisories={[{ code: 'employee_on_leave', message: 'El empleado está en on_leave.' }]}
        onConfirm={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText(/on_leave/i)).toBeInTheDocument();
  });

  it('clicking Cerrar invokes onClose', () => {
    const onClose = jest.fn();
    render(<AssignmentValidationModal validation={hardFailValidation} onConfirm={jest.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Cerrar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('returns null when validation is absent (defensive)', () => {
    const { container } = render(<AssignmentValidationModal validation={null} onConfirm={jest.fn()} onClose={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
