import {
  SUBTYPES_BY_TYPE,
  SUBTYPE_LABEL,
  formatSubtype,
  typeRequiresSubtype,
  subtypesFor,
} from './contractSubtype';

describe('contractSubtype', () => {
  describe('SUBTYPES_BY_TYPE', () => {
    it('has capacity subtypes', () => {
      expect(SUBTYPES_BY_TYPE.capacity.length).toBe(4);
      expect(SUBTYPES_BY_TYPE.capacity[0].value).toBe('staff_augmentation');
    });

    it('has project subtypes', () => {
      expect(SUBTYPES_BY_TYPE.project.length).toBe(2);
    });

    it('has resell subtypes', () => {
      expect(SUBTYPES_BY_TYPE.resell.length).toBe(4);
    });
  });

  describe('SUBTYPE_LABEL', () => {
    it('maps value to label for all subtypes', () => {
      expect(SUBTYPE_LABEL.staff_augmentation).toBe('Staff Augmentation');
      expect(SUBTYPE_LABEL.fixed_scope).toBe('Alcance fijo / POC');
      expect(SUBTYPE_LABEL.aws).toBe('AWS');
    });
  });

  describe('formatSubtype', () => {
    it('returns label for known value', () => {
      expect(formatSubtype('staff_augmentation')).toBe('Staff Augmentation');
      expect(formatSubtype('fixed_scope')).toBe('Alcance fijo / POC');
      expect(formatSubtype('azure')).toBe('Azure');
    });

    it('returns fallback for empty/null/undefined value', () => {
      expect(formatSubtype(null)).toBe('Sin especificar');
      expect(formatSubtype(undefined)).toBe('Sin especificar');
      expect(formatSubtype('')).toBe('Sin especificar');
    });

    it('returns custom fallback', () => {
      expect(formatSubtype('', { fallback: '—' })).toBe('—');
      expect(formatSubtype(null, { fallback: 'N/A' })).toBe('N/A');
    });

    it('returns raw value for unknown subtype', () => {
      expect(formatSubtype('unknown_type')).toBe('unknown_type');
    });
  });

  describe('typeRequiresSubtype', () => {
    it('returns true for capacity', () => {
      expect(typeRequiresSubtype('capacity')).toBe(true);
    });

    it('returns true for project', () => {
      expect(typeRequiresSubtype('project')).toBe(true);
    });

    it('returns true for resell', () => {
      expect(typeRequiresSubtype('resell')).toBe(true);
    });

    it('returns false for unknown type', () => {
      expect(typeRequiresSubtype('other')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(typeRequiresSubtype(null)).toBe(false);
      expect(typeRequiresSubtype(undefined)).toBe(false);
    });
  });

  describe('subtypesFor', () => {
    it('returns capacity subtypes', () => {
      const result = subtypesFor('capacity');
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ value: 'staff_augmentation', label: 'Staff Augmentation' });
    });

    it('returns project subtypes', () => {
      const result = subtypesFor('project');
      expect(result).toHaveLength(2);
    });

    it('returns resell subtypes', () => {
      const result = subtypesFor('resell');
      expect(result).toHaveLength(4);
    });

    it('returns empty array for unknown type', () => {
      expect(subtypesFor('unknown')).toEqual([]);
    });

    it('returns empty array for null/undefined', () => {
      expect(subtypesFor(null)).toEqual([]);
      expect(subtypesFor(undefined)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(subtypesFor('')).toEqual([]);
    });
  });
});
