import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import useReportFilters from './useReportFilters';

function wrapper({ children }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function wrapperWithParams(search) {
  return ({ children }) => (
    <MemoryRouter initialEntries={[`/reports${search}`]}>{children}</MemoryRouter>
  );
}

describe('useReportFilters', () => {
  it('returns default filter values when no search params', () => {
    const { result } = renderHook(
      () => useReportFilters({ type: '', owner: '' }),
      { wrapper },
    );
    expect(result.current.filters).toEqual({ type: '', owner: '' });
  });

  it('reads filter values from URL search params', () => {
    const { result } = renderHook(
      () => useReportFilters({ type: '', owner: '' }),
      { wrapper: wrapperWithParams('?type=capacity&owner=alice') },
    );
    expect(result.current.filters.type).toBe('capacity');
    expect(result.current.filters.owner).toBe('alice');
  });

  it('setFilter updates a single filter', () => {
    const { result } = renderHook(
      () => useReportFilters({ type: '', country: '' }),
      { wrapper },
    );
    act(() => { result.current.setFilter('type', 'project'); });
    expect(result.current.filters.type).toBe('project');
    expect(result.current.filters.country).toBe('');
  });

  it('setFilter with empty value removes the param', () => {
    const { result } = renderHook(
      () => useReportFilters({ type: '' }),
      { wrapper: wrapperWithParams('?type=capacity') },
    );
    expect(result.current.filters.type).toBe('capacity');
    act(() => { result.current.setFilter('type', ''); });
    expect(result.current.filters.type).toBe('');
  });

  it('resetFilters clears all filter params', () => {
    const { result } = renderHook(
      () => useReportFilters({ type: '', owner: '' }),
      { wrapper: wrapperWithParams('?type=capacity&owner=bob') },
    );
    expect(result.current.filters.type).toBe('capacity');
    act(() => { result.current.resetFilters(); });
    expect(result.current.filters.type).toBe('');
    expect(result.current.filters.owner).toBe('');
  });

  it('toQueryString returns query string from current filters', () => {
    const { result } = renderHook(
      () => useReportFilters({ type: '', owner: '' }),
      { wrapper: wrapperWithParams('?type=capacity') },
    );
    expect(result.current.toQueryString()).toBe('?type=capacity');
  });

  it('toQueryString returns empty string when no filters set', () => {
    const { result } = renderHook(
      () => useReportFilters({ type: '', owner: '' }),
      { wrapper },
    );
    expect(result.current.toQueryString()).toBe('');
  });
});
