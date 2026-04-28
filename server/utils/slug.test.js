const { slugify, uniqueSlug } = require('./slug');

describe('slugify', () => {
  it('lowercase + guiones para texto simple', () => {
    expect(slugify('Bancolombia CorePay Q2 2026')).toBe('bancolombia-corepay-q2-2026');
  });
  it('elimina diacríticos', () => {
    expect(slugify('Programa Académico — Año 1')).toBe('programa-academico-ano-1');
    expect(slugify('niño feliz')).toBe('nino-feliz');
  });
  it('trim espacios y guiones extremos', () => {
    expect(slugify('  hola  mundo  ')).toBe('hola-mundo');
    expect(slugify('---test---')).toBe('test');
  });
  it('null para empty / null / whitespace', () => {
    expect(slugify('')).toBeNull();
    expect(slugify('   ')).toBeNull();
    expect(slugify(null)).toBeNull();
    expect(slugify(undefined)).toBeNull();
    expect(slugify('!!!')).toBeNull();
  });
  it('trunca por palabra al respetar maxLength', () => {
    const long = 'una frase muy larga que va a sobrepasar el limite establecido por el caller';
    const out = slugify(long, { maxLength: 30 });
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith('-')).toBe(false);
  });
  it('reemplaza caracteres especiales', () => {
    expect(slugify('Email: foo@bar.com!')).toBe('email-foo-bar-com');
  });
});

describe('uniqueSlug', () => {
  it('devuelve el slug base si no existe', async () => {
    const exists = jest.fn(async () => false);
    const out = await uniqueSlug('Acme Corp', exists);
    expect(out).toBe('acme-corp');
    expect(exists).toHaveBeenCalledTimes(1);
  });
  it('agrega sufijo -2 si el primero está ocupado', async () => {
    const used = new Set(['acme-corp']);
    const exists = jest.fn(async (s) => used.has(s));
    const out = await uniqueSlug('Acme Corp', exists);
    expect(out).toBe('acme-corp-2');
  });
  it('escala -2 -3 hasta encontrar libre', async () => {
    const used = new Set(['acme-corp', 'acme-corp-2', 'acme-corp-3', 'acme-corp-4']);
    const exists = jest.fn(async (s) => used.has(s));
    const out = await uniqueSlug('Acme Corp', exists);
    expect(out).toBe('acme-corp-5');
  });
  it('respeta maxLength incluso con sufijo', async () => {
    // El slug base para 'Una Frase Muy Larga Aquí' con maxLength=12 cae en
    // 'una-frase' (truncate respeta límite de palabra). Lo ocupamos para
    // forzar el sufijo y verificamos que el resultado siga bajo 12 chars.
    const used = new Set(['una-frase']);
    const exists = jest.fn(async (s) => used.has(s));
    const out = await uniqueSlug('Una Frase Muy Larga Aquí', exists, { maxLength: 12 });
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out).toMatch(/-\d+$/);
  });
  it('null cuando el input no genera slug', async () => {
    const exists = jest.fn(async () => false);
    expect(await uniqueSlug('', exists)).toBeNull();
    expect(exists).not.toHaveBeenCalled();
  });
});
