import { renderHook, act } from '@testing-library/react';
import { useSort } from './useSort';

describe('useSort', () => {
  it('estado inicial vacío', () => {
    const { result } = renderHook(() => useSort());
    expect(result.current.field).toBeNull();
    expect(result.current.dir).toBe('desc');
  });

  it('estado inicial con valores', () => {
    const { result } = renderHook(() => useSort({ field: 'name', dir: 'asc' }));
    expect(result.current.field).toBe('name');
    expect(result.current.dir).toBe('asc');
  });

  it('1er click en campo nuevo → asc', () => {
    const { result } = renderHook(() => useSort());
    act(() => result.current.setSort('name'));
    expect(result.current.field).toBe('name');
    expect(result.current.dir).toBe('asc');
  });

  it('2do click en mismo campo → toggle a desc', () => {
    const { result } = renderHook(() => useSort());
    act(() => result.current.setSort('name'));  // asc
    act(() => result.current.setSort('name'));  // desc
    expect(result.current.dir).toBe('desc');
  });

  it('3er click en mismo campo → de vuelta asc', () => {
    const { result } = renderHook(() => useSort());
    act(() => result.current.setSort('name'));  // asc
    act(() => result.current.setSort('name'));  // desc
    act(() => result.current.setSort('name'));  // asc
    expect(result.current.dir).toBe('asc');
  });

  it('cambiar de campo resetea dir a asc', () => {
    const { result } = renderHook(() => useSort());
    act(() => result.current.setSort('name'));   // asc
    act(() => result.current.setSort('name'));   // desc
    act(() => result.current.setSort('status')); // nuevo campo → asc
    expect(result.current.field).toBe('status');
    expect(result.current.dir).toBe('asc');
  });

  it('applyToQs agrega los params al URLSearchParams', () => {
    const { result } = renderHook(() => useSort({ field: 'created_at', dir: 'desc' }));
    const qs = new URLSearchParams();
    result.current.applyToQs(qs);
    expect(qs.get('sort')).toBe('created_at');
    expect(qs.get('dir')).toBe('desc');
  });

  it('applyToQs no agrega nada si no hay field', () => {
    const { result } = renderHook(() => useSort());
    const qs = new URLSearchParams();
    result.current.applyToQs(qs);
    expect(qs.get('sort')).toBeNull();
    expect(qs.get('dir')).toBeNull();
  });
});
