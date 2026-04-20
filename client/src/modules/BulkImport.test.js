import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BulkImport from './BulkImport';
import * as apiV2 from '../utils/apiV2';

jest.mock('../utils/apiV2');

// jsdom doesn't implement File.prototype.text() in every version — polyfill it so the
// module can read the uploaded CSV.
if (typeof File.prototype.text !== 'function') {
  // eslint-disable-next-line no-extend-native
  File.prototype.text = function text() {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsText(this);
    });
  };
}

function makeCsvFile(text, name = 'skills.csv') {
  return new File([text], name, { type: 'text/csv' });
}

beforeEach(() => jest.resetAllMocks());

describe('BulkImport — entity picker', () => {
  it('renders the 5 supported entity cards', () => {
    render(<BulkImport />);
    expect(screen.getByText('Empleados')).toBeInTheDocument();
    expect(screen.getByText('Empleado ↔ Skill')).toBeInTheDocument();
    expect(screen.getByText('Catálogo de Skills')).toBeInTheDocument();
    expect(screen.getByText('Catálogo de Áreas')).toBeInTheDocument();
    expect(screen.getByText('Clientes')).toBeInTheDocument();
  });

  it('advances to the upload step after picking an entity', async () => {
    render(<BulkImport />);
    fireEvent.click(screen.getByLabelText('Cargar Catálogo de Skills'));
    expect(await screen.findByText(/Subir CSV/)).toBeInTheDocument();
  });
});

describe('BulkImport — upload + preview', () => {
  it('parses the CSV, calls /preview and shows row counts', async () => {
    apiV2.apiPost.mockResolvedValue({
      entity: 'skills', total: 2,
      counts: { total: 2, created: 0, updated: 0, skipped: 0, error: 0 },
      dry_run: true,
      report: [
        { row_number: 2, status: 'preview', value: { name: 'React' } },
        { row_number: 3, status: 'preview', value: { name: 'Vue' } },
      ],
    });
    render(<BulkImport />);
    fireEvent.click(screen.getByLabelText('Cargar Catálogo de Skills'));
    await screen.findByText(/Subir CSV/);

    const input = screen.getByLabelText('Archivo CSV');
    const csv = 'name,category\nReact,framework\nVue,framework\n';
    fireEvent.change(input, { target: { files: [makeCsvFile(csv)] } });

    // Wait for POST /preview to be called with parsed rows (headers lowercased)
    await waitFor(() => expect(apiV2.apiPost).toHaveBeenCalledTimes(1));
    expect(apiV2.apiPost).toHaveBeenCalledWith(
      '/api/bulk-import/skills/preview',
      expect.objectContaining({ rows: [
        expect.objectContaining({ name: 'React', category: 'framework' }),
        expect.objectContaining({ name: 'Vue',   category: 'framework' }),
      ] }),
    );

    expect(await screen.findByText(/Revisión previa/)).toBeInTheDocument();
    expect(screen.getByText(/Total:\s*2/)).toBeInTheDocument();
    expect(screen.getByText(/Válidas:\s*2/)).toBeInTheDocument();
  });

  it('shows a validation warning when all rows fail backend validation', async () => {
    // Parser strips totally-blank rows, so to reach the preview with
    // invalid rows we need a row with some content that the BACKEND
    // rejects (simulated via the mocked preview response).
    apiV2.apiPost.mockResolvedValue({
      entity: 'skills',
      counts: { total: 1, created: 0, updated: 0, skipped: 0, error: 1 },
      dry_run: true,
      report: [{ row_number: 2, status: 'error', reason: 'Categoría inválida' }],
    });
    render(<BulkImport />);
    fireEvent.click(screen.getByLabelText('Cargar Catálogo de Skills'));
    await screen.findByText(/Subir CSV/);
    fireEvent.change(screen.getByLabelText('Archivo CSV'), {
      target: { files: [makeCsvFile('name,category\nReact,pottery\n')] },
    });
    await screen.findByText(/Revisión previa/);
    expect(screen.getByText(/Hay filas con errores/)).toBeInTheDocument();
  });

  it('surfaces preview errors inline', async () => {
    apiV2.apiPost.mockRejectedValue(new Error('Entidad no soportada'));
    render(<BulkImport />);
    fireEvent.click(screen.getByLabelText('Cargar Catálogo de Skills'));
    await screen.findByText(/Subir CSV/);
    fireEvent.change(screen.getByLabelText('Archivo CSV'), {
      target: { files: [makeCsvFile('name\nReact\n')] },
    });
    await waitFor(() => expect(screen.getByText(/Error en el preview/)).toBeInTheDocument());
  });
});

describe('BulkImport — commit', () => {
  it('calls /commit with the parsed rows and shows the result', async () => {
    apiV2.apiPost
      .mockResolvedValueOnce({   // preview
        counts: { total: 1, created: 0, updated: 0, skipped: 0, error: 0 },
        dry_run: true,
        report: [{ row_number: 2, status: 'preview', value: { name: 'React' } }],
      })
      .mockResolvedValueOnce({   // commit
        counts: { total: 1, created: 1, updated: 0, skipped: 0, error: 0 },
        report: [{ row_number: 2, status: 'created', id: 42 }],
      });

    render(<BulkImport />);
    fireEvent.click(screen.getByLabelText('Cargar Catálogo de Skills'));
    await screen.findByText(/Subir CSV/);
    fireEvent.change(screen.getByLabelText('Archivo CSV'), {
      target: { files: [makeCsvFile('name\nReact\n')] },
    });
    await screen.findByText(/Revisión previa/);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar carga/i }));

    await waitFor(() => expect(apiV2.apiPost).toHaveBeenCalledTimes(2));
    const [commitUrl, commitBody] = apiV2.apiPost.mock.calls[1];
    expect(commitUrl).toBe('/api/bulk-import/skills/commit');
    expect(commitBody.rows[0]).toMatchObject({ name: 'React' });

    expect(await screen.findByText(/Carga completada/)).toBeInTheDocument();
    expect(screen.getByText(/Creadas:\s*1/)).toBeInTheDocument();
  });
});
