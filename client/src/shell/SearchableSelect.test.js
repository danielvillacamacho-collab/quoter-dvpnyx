import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SearchableSelect from './SearchableSelect';

const sampleOptions = [
  { id: 'e1', label: 'Ana García',  hint: 'L4 · 40h cap.', searchText: 'Ana García L4' },
  { id: 'e2', label: 'Bruno Pérez', hint: 'L3 · 40h cap.', searchText: 'Bruno Pérez L3' },
  { id: 'e3', label: 'Carla Díaz',  hint: 'L5 · 30h cap.', searchText: 'Carla Díaz L5' },
];

/**
 * Wrapper que mantiene el `value` como state controlado — el componente
 * está pensado para vivir dentro de un form que ya posee el state, así
 * que los tests usan este harness en vez de uncontrolled.
 */
function Harness({ initial = '', options = sampleOptions, onChangeSpy, ...rest }) {
  const [value, setValue] = useState(initial);
  return (
    <SearchableSelect
      value={value}
      onChange={(v) => { setValue(v); onChangeSpy?.(v); }}
      options={options}
      aria-label="Empleado"
      {...rest}
    />
  );
}

describe('SearchableSelect', () => {
  it('renders the input with the provided aria-label and placeholder', () => {
    render(<Harness placeholder="— Selecciona —" />);
    const input = screen.getByLabelText('Empleado');
    expect(input).toHaveAttribute('placeholder', '— Selecciona —');
    expect(input).toHaveValue('');
  });

  it('opens the listbox on focus and shows all options', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText('Empleado'));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    expect(within(list).getByText('Ana García')).toBeInTheDocument();
    expect(within(list).getByText('Bruno Pérez')).toBeInTheDocument();
  });

  it('filters options by substring as the user types', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Empleado');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'bru' } });
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByText('Bruno Pérez')).toBeInTheDocument();
  });

  it('matches against searchText / hint, not just label', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Empleado');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'L5' } });
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByText('Carla Díaz')).toBeInTheDocument();
  });

  it('shows "Sin coincidencias" when nothing matches', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Empleado'), { target: { value: 'xyz' } });
    expect(screen.getByText('Sin coincidencias')).toBeInTheDocument();
  });

  it('commits selection on click and closes the listbox', () => {
    const spy = jest.fn();
    render(<Harness onChangeSpy={spy} />);
    fireEvent.focus(screen.getByLabelText('Empleado'));
    fireEvent.mouseDown(screen.getByText('Bruno Pérez'));
    expect(spy).toHaveBeenCalledWith('e2');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Empleado')).toHaveValue('Bruno Pérez');
  });

  it('navigates with ↓ and selects with Enter', () => {
    const spy = jest.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = screen.getByLabelText('Empleado');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight idx 1
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight idx 2
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith('e3');
  });

  it('closes on Escape without committing', () => {
    const spy = jest.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = screen.getByLabelText('Empleado');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ana' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('renders the clear button when a value is selected and clears via click', () => {
    const spy = jest.fn();
    render(<Harness initial="e1" onChangeSpy={spy} />);
    expect(screen.getByLabelText('Empleado')).toHaveValue('Ana García');
    const clear = screen.getByLabelText(/Limpiar Empleado/);
    fireEvent.click(clear);
    expect(spy).toHaveBeenCalledWith('');
  });

  it('does not render the clear button when no value is selected', () => {
    render(<Harness initial="" />);
    expect(screen.queryByLabelText(/Limpiar Empleado/)).toBeNull();
  });

  it('respects `disabled`: input cannot open the list', () => {
    render(<Harness initial="e1" disabled />);
    const input = screen.getByLabelText('Empleado');
    expect(input).toBeDisabled();
    fireEvent.focus(input);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the selected label when closed even after a query was typed', () => {
    render(<Harness initial="e2" />);
    const input = screen.getByLabelText('Empleado');
    expect(input).toHaveValue('Bruno Pérez'); // closed → selected label
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'qq' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('Bruno Pérez'); // restored on close
  });
});
