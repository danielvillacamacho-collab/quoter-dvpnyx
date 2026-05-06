import { fireEvent, waitFor, screen } from '@testing-library/react';

/**
 * changeSelect — helper para interactuar con FilterableSelect en tests.
 *
 * Reemplaza el patrón anterior de `fireEvent.change(select, {target:{value}})`.
 * Abre el combobox, busca la opción por su `data-value`, y la selecciona.
 *
 * @param {string} ariaLabel  — aria-label del combobox
 * @param {string} value      — el id/value de la opción a seleccionar
 *                               ('' para limpiar la selección)
 */
export async function changeSelect(ariaLabel, value) {
  const input = screen.getByLabelText(ariaLabel);

  if (value === '' || value == null) {
    // Clear: look for the × button
    const clearBtn = screen.queryByLabelText(`Limpiar ${ariaLabel}`);
    if (clearBtn) fireEvent.click(clearBtn);
    else fireEvent.change(input, { target: { value: '' } });
    return;
  }

  // Open the dropdown
  fireEvent.click(input);

  // Find the option with matching data-value and click it
  await waitFor(() => {
    const option = document.querySelector(
      `[role="listbox"] [data-value="${CSS.escape(value)}"]`
    );
    if (!option) throw new Error(`Option with value "${value}" not found`);
    fireEvent.mouseDown(option);
  });
}
