/**
 * Validación liviana de JSON shapes para campos JSONB.
 *
 * El sistema usa JSONB en muchos lugares (`metadata`, `payload`,
 * `parameters_snapshot`, `preferences`, `override_checks`). Sin schema,
 * cualquier código puede escribir cualquier shape, y consumidores
 * (incluyendo agentes IA) tienen que ser defensivos en cada lectura.
 *
 * NO usamos `ajv` para no agregar dependencia. Esto es validación
 * mínima — suficiente para shapes estables documentados. Si en el
 * futuro queremos JSON Schema completo (refs, draft-07), migrar a ajv
 * es de una hora.
 *
 * Tipos soportados:
 *   { type: 'string', minLength?, maxLength?, enum?, pattern? }
 *   { type: 'number' | 'integer', min?, max? }
 *   { type: 'boolean' }
 *   { type: 'object', properties: {...}, required?: [...], additionalProperties?: bool }
 *   { type: 'array', items: schema, minItems?, maxItems? }
 *   { type: 'date' }    — string ISO YYYY-MM-DD
 *   { type: 'uuid' }    — string UUID
 *   { nullable: true }   — válido también si null/undefined
 *   { oneOf: [schema, schema, ...] }
 *
 * Uso:
 *   const { validate, makeValidator } = require('./utils/json_schema');
 *   const errors = validate(payload, schema);
 *   if (errors.length) throw new Error(errors.join(', '));
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validate(value, schema, path = '$') {
  const errors = [];
  if (!schema) return errors;

  if (value == null) {
    if (schema.nullable) return errors;
    errors.push(`${path}: required`);
    return errors;
  }

  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.some((s) => validate(value, s, path).length === 0);
    if (!matched) errors.push(`${path}: no oneOf alternative matched`);
    return errors;
  }

  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') { errors.push(`${path}: expected string`); break; }
      if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: too short`);
      if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path}: too long`);
      if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern mismatch`);
      break;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) { errors.push(`${path}: expected integer`); break; }
      if (schema.min != null && value < schema.min) errors.push(`${path}: < min`);
      if (schema.max != null && value > schema.max) errors.push(`${path}: > max`);
      break;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) { errors.push(`${path}: expected number`); break; }
      if (schema.min != null && value < schema.min) errors.push(`${path}: < min`);
      if (schema.max != null && value > schema.max) errors.push(`${path}: > max`);
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      break;
    }
    case 'date': {
      if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
        errors.push(`${path}: expected YYYY-MM-DD`);
      }
      break;
    }
    case 'uuid': {
      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        errors.push(`${path}: expected UUID`);
      }
      break;
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path}: expected object`); break; }
      const props = schema.properties || {};
      const required = schema.required || [];
      for (const k of required) {
        if (!(k in value)) errors.push(`${path}.${k}: missing required`);
      }
      for (const [k, sub] of Object.entries(props)) {
        if (k in value) errors.push(...validate(value[k], sub, `${path}.${k}`));
      }
      if (schema.additionalProperties === false) {
        for (const k of Object.keys(value)) {
          if (!(k in props)) errors.push(`${path}.${k}: additional property not allowed`);
        }
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) { errors.push(`${path}: expected array`); break; }
      if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: too few items`);
      if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: too many items`);
      if (schema.items) {
        value.forEach((v, i) => errors.push(...validate(v, schema.items, `${path}[${i}]`)));
      }
      break;
    }
    default:
      // Sin type explícito, sólo aplicamos oneOf u otras keywords.
      break;
  }
  return errors;
}

/** Devuelve un validador reutilizable. Más eficiente si validas muchas rows. */
function makeValidator(schema) {
  return (value) => validate(value, schema);
}

/**
 * Schemas predefinidos para los JSONB más usados del sistema. Los
 * routes pueden importar de aquí y validar antes de INSERT.
 */
const SCHEMAS = {
  contractMetadata: {
    type: 'object',
    properties: {
      kick_off_date:         { type: 'date', nullable: true },
      kicked_off_at:         { type: 'string', nullable: true },
      kicked_off_by:         { type: 'uuid', nullable: true },
      kick_off_seeded_count: { type: 'integer', min: 0, nullable: true },
    },
    additionalProperties: true, // metadata libre — pero los keys conocidos están tipados
  },
  userPreferences: {
    type: 'object',
    properties: {
      scheme:     { type: 'string', enum: ['light', 'dark'], nullable: true },
      accentHue:  { type: 'integer', min: 0, max: 360,        nullable: true },
      density:    { type: 'integer', min: -1, max: 2,         nullable: true },
    },
    additionalProperties: true,
  },
  resourceRequestLanguageRequirements: {
    type: 'array',
    nullable: true,
    items: {
      type: 'object',
      properties: {
        language: { type: 'string', minLength: 2 },
        level:    { type: 'string', enum: ['basic', 'intermediate', 'advanced', 'native'] },
      },
      required: ['language', 'level'],
      additionalProperties: false,
    },
  },
};

module.exports = { validate, makeValidator, SCHEMAS };
