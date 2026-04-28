const {
  SUBTYPES_BY_TYPE, ALL_SUBTYPES, VALID_BY_TYPE, validateContractSubtype,
} = require('./contract_subtype');

describe('catálogo', () => {
  it('capacity tiene 4 subtipos, project 2, resell 0', () => {
    expect(SUBTYPES_BY_TYPE.capacity).toHaveLength(4);
    expect(SUBTYPES_BY_TYPE.project).toHaveLength(2);
    expect(SUBTYPES_BY_TYPE.resell).toHaveLength(0);
  });
  it('ALL_SUBTYPES tiene 6 valores', () => {
    expect(ALL_SUBTYPES.size).toBe(6);
  });
  it('valores canónicos exactos (sensible a typos)', () => {
    expect(ALL_SUBTYPES.has('staff_augmentation')).toBe(true);
    expect(ALL_SUBTYPES.has('mission_driven_squad')).toBe(true);
    expect(ALL_SUBTYPES.has('managed_service')).toBe(true);
    expect(ALL_SUBTYPES.has('time_and_materials')).toBe(true);
    expect(ALL_SUBTYPES.has('fixed_scope')).toBe(true);
    expect(ALL_SUBTYPES.has('hour_pool')).toBe(true);
  });
  it('VALID_BY_TYPE refleja el catálogo', () => {
    expect(VALID_BY_TYPE.capacity.has('staff_augmentation')).toBe(true);
    expect(VALID_BY_TYPE.capacity.has('hour_pool')).toBe(false);
    expect(VALID_BY_TYPE.project.has('hour_pool')).toBe(true);
  });
});

describe('validateContractSubtype', () => {
  describe('type=resell', () => {
    it('null/empty/undefined → ok con value=null', () => {
      expect(validateContractSubtype('resell', null)).toEqual({ ok: true, value: null });
      expect(validateContractSubtype('resell', '')).toEqual({ ok: true, value: null });
      expect(validateContractSubtype('resell', undefined)).toEqual({ ok: true, value: null });
    });
    it('cualquier subtype → error', () => {
      const r = validateContractSubtype('resell', 'fixed_scope');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('subtype_not_allowed_for_resell');
    });
  });

  describe('type=capacity', () => {
    it('null + required=true → error subtype_required', () => {
      const r = validateContractSubtype('capacity', null);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('subtype_required');
      expect(r.error).toMatch(/subtipo/i);
    });
    it('null + required=false → ok con value=null', () => {
      const r = validateContractSubtype('capacity', null, { required: false });
      expect(r).toEqual({ ok: true, value: null });
    });
    it('subtipo válido → ok', () => {
      const r = validateContractSubtype('capacity', 'staff_augmentation');
      expect(r).toEqual({ ok: true, value: 'staff_augmentation' });
    });
    it('subtipo de project → error subtype_invalid_for_type', () => {
      const r = validateContractSubtype('capacity', 'fixed_scope');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('subtype_invalid_for_type');
    });
    it('subtipo desconocido → error subtype_invalid_for_type', () => {
      const r = validateContractSubtype('capacity', 'turbo_dev');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('subtype_invalid_for_type');
    });
    it('trim de whitespace', () => {
      const r = validateContractSubtype('capacity', '  staff_augmentation  ');
      expect(r).toEqual({ ok: true, value: 'staff_augmentation' });
    });
  });

  describe('type=project', () => {
    it('null + required=true → error', () => {
      const r = validateContractSubtype('project', null);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('subtype_required');
    });
    it('subtipo válido → ok', () => {
      expect(validateContractSubtype('project', 'fixed_scope')).toEqual({ ok: true, value: 'fixed_scope' });
      expect(validateContractSubtype('project', 'hour_pool')).toEqual({ ok: true, value: 'hour_pool' });
    });
    it('subtipo de capacity → error', () => {
      const r = validateContractSubtype('project', 'staff_augmentation');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('subtype_invalid_for_type');
    });
  });

  describe('type desconocido o null', () => {
    it('subtipo válido pero type vacío → ok pasa-thru (otra validación lo rechazará)', () => {
      // Defensive: si type no llegó, no doble-validamos. El validador del type
      // reportará el error real.
      const r = validateContractSubtype(undefined, 'fixed_scope');
      expect(r).toEqual({ ok: true, value: 'fixed_scope' });
    });
    it('subtipo desconocido + type vacío → error subtype_unknown', () => {
      const r = validateContractSubtype(undefined, 'foo');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('subtype_unknown');
    });
  });
});
