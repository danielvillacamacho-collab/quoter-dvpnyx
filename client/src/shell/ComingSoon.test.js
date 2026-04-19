import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ComingSoon from './ComingSoon';

const mount = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path={path} element={<ComingSoon />} />
      <Route path="/" element={<div>Home mocked</div>} />
    </Routes>
  </MemoryRouter>
);

describe('ComingSoon', () => {
  it('shows the Clientes title for /clients', () => {
    mount('/clients');
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText(/Sprint 2/)).toBeInTheDocument();
  });

  it('shows the Time Tracking title for /time/me', () => {
    mount('/time/me');
    expect(screen.getByText(/Mis horas|Time Tracking/)).toBeInTheDocument();
  });

  it('falls back to a generic "Próximamente" for unknown routes', () => {
    mount('/something-unknown');
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
  });

  it('navigates back to "/" on button click', () => {
    mount('/contracts');
    fireEvent.click(screen.getByRole('button', { name: /Volver al Dashboard/i }));
    expect(screen.getByText('Home mocked')).toBeInTheDocument();
  });
});
