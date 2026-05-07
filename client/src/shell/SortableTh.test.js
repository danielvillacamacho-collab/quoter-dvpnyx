import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SortableTh from './SortableTh';

function Table({ children }) {
  return <table><thead><tr>{children}</tr></thead></table>;
}

describe('SortableTh', () => {
  it('renders as plain <th> when no sort prop', () => {
    render(<Table><SortableTh>Name</SortableTh></Table>);
    const th = screen.getByText('Name');
    expect(th.tagName).toBe('TH');
    expect(th).not.toHaveAttribute('role');
  });

  it('renders as plain <th> when no field prop', () => {
    const sort = { field: 'name', dir: 'asc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort}>Name</SortableTh></Table>);
    const th = screen.getByText('Name');
    expect(th).not.toHaveAttribute('role');
  });

  it('renders as sortable button when sort + field provided', () => {
    const sort = { field: 'name', dir: 'asc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="name">Name</SortableTh></Table>);
    const th = screen.getByRole('button', { name: /Ordenar por Name/ });
    expect(th).toBeInTheDocument();
    expect(th.tagName).toBe('TH');
  });

  it('shows ascending arrow when sort matches field and dir=asc', () => {
    const sort = { field: 'name', dir: 'asc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="name">Name</SortableTh></Table>);
    expect(screen.getByText('▲')).toBeInTheDocument();
  });

  it('shows descending arrow when sort matches field and dir=desc', () => {
    const sort = { field: 'name', dir: 'desc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="name">Name</SortableTh></Table>);
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('shows neutral arrow when sort does not match field', () => {
    const sort = { field: 'other', dir: 'asc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="name">Name</SortableTh></Table>);
    expect(screen.getByText('⇅')).toBeInTheDocument();
  });

  it('calls setSort on click', () => {
    const setSort = jest.fn();
    const sort = { field: 'name', dir: 'asc', setSort };
    render(<Table><SortableTh sort={sort} field="amount">Amount</SortableTh></Table>);
    fireEvent.click(screen.getByRole('button'));
    expect(setSort).toHaveBeenCalledWith('amount');
  });

  it('calls setSort on Enter key', () => {
    const setSort = jest.fn();
    const sort = { field: 'name', dir: 'asc', setSort };
    render(<Table><SortableTh sort={sort} field="amount">Amount</SortableTh></Table>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(setSort).toHaveBeenCalledWith('amount');
  });

  it('calls setSort on Space key', () => {
    const setSort = jest.fn();
    const sort = { field: 'name', dir: 'asc', setSort };
    render(<Table><SortableTh sort={sort} field="amount">Amount</SortableTh></Table>);
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(setSort).toHaveBeenCalledWith('amount');
  });

  it('sets aria-sort=ascending for active asc column', () => {
    const sort = { field: 'name', dir: 'asc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="name">Name</SortableTh></Table>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('sets aria-sort=descending for active desc column', () => {
    const sort = { field: 'name', dir: 'desc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="name">Name</SortableTh></Table>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-sort', 'descending');
  });

  it('sets aria-sort=none for inactive column', () => {
    const sort = { field: 'other', dir: 'asc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="name">Name</SortableTh></Table>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-sort', 'none');
  });

  it('uses custom ariaLabel when provided', () => {
    const sort = { field: 'n', dir: 'asc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="name" ariaLabel="Sort Name">Name</SortableTh></Table>);
    expect(screen.getByRole('button', { name: 'Sort Name' })).toBeInTheDocument();
  });

  it('uses field as fallback label when children is not string', () => {
    const sort = { field: 'n', dir: 'asc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="amount"><span>Monto</span></SortableTh></Table>);
    expect(screen.getByRole('button', { name: /Ordenar por amount/ })).toBeInTheDocument();
  });

  it('passes extra props to th element', () => {
    const sort = { field: 'n', dir: 'asc', setSort: jest.fn() };
    render(<Table><SortableTh sort={sort} field="name" data-testid="my-th">Name</SortableTh></Table>);
    expect(screen.getByTestId('my-th')).toBeInTheDocument();
  });
});
