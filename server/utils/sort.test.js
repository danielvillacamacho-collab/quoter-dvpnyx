const { parseSort } = require('./sort');

const SORTABLE = {
  name:       'c.name',
  created_at: 'c.created_at',
  status:     'c.status',
  amount:     'c.amount_usd',
};

describe('parseSort — defaults', () => {
  it('usa defaultField + defaultDir cuando no llega query', () => {
    const out = parseSort({}, SORTABLE, { defaultField: 'created_at', defaultDir: 'desc' });
    expect(out.field).toBe('created_at');
    expect(out.dir).toBe('desc');
    expect(out.column).toBe('c.created_at');
    expect(out.orderBy).toBe('c.created_at DESC NULLS LAST');
  });

  it('default ASC cuando se especifica', () => {
    const out = parseSort({}, SORTABLE, { defaultField: 'name', defaultDir: 'asc' });
    expect(out.dir).toBe('asc');
    expect(out.orderBy).toBe('c.name ASC NULLS LAST');
  });

  it('sin defaultField → orderBy null (caller debe omitir ORDER BY)', () => {
    const out = parseSort({}, SORTABLE);
    expect(out.field).toBeNull();
    expect(out.orderBy).toBeNull();
  });
});

describe('parseSort — whitelist', () => {
  it('acepta field en la whitelist', () => {
    const out = parseSort({ sort: 'status', dir: 'asc' }, SORTABLE);
    expect(out.field).toBe('status');
    expect(out.dir).toBe('asc');
  });

  it('rechaza field NO en whitelist y cae al default', () => {
    const out = parseSort({ sort: 'password_hash' }, SORTABLE, { defaultField: 'name', defaultDir: 'asc' });
    expect(out.field).toBe('name');
  });

  it('rechaza field con SQL injection y cae al default', () => {
    const out = parseSort({ sort: 'name; DROP TABLE users--' }, SORTABLE, { defaultField: 'created_at', defaultDir: 'desc' });
    expect(out.field).toBe('created_at');
    expect(out.orderBy).not.toMatch(/DROP/);
  });

  it('field vacío cae al default', () => {
    const out = parseSort({ sort: '' }, SORTABLE, { defaultField: 'name', defaultDir: 'asc' });
    expect(out.field).toBe('name');
  });
});

describe('parseSort — dir aliases', () => {
  it('ascending / up / a → asc', () => {
    expect(parseSort({ sort: 'name', dir: 'ascending' }, SORTABLE).dir).toBe('asc');
    expect(parseSort({ sort: 'name', dir: 'up' }, SORTABLE).dir).toBe('asc');
    expect(parseSort({ sort: 'name', dir: 'A' }, SORTABLE).dir).toBe('asc');
  });

  it('descending / down / d → desc', () => {
    expect(parseSort({ sort: 'name', dir: 'descending' }, SORTABLE).dir).toBe('desc');
    expect(parseSort({ sort: 'name', dir: 'DOWN' }, SORTABLE).dir).toBe('desc');
  });

  it('dir inválido cae al default', () => {
    const out = parseSort({ sort: 'name', dir: 'sideways' }, SORTABLE, { defaultDir: 'asc' });
    expect(out.dir).toBe('asc');
  });

  it('acepta param `order` como alias de `dir`', () => {
    const out = parseSort({ sort: 'name', order: 'desc' }, SORTABLE);
    expect(out.dir).toBe('desc');
  });
});

describe('parseSort — opciones extra', () => {
  it('nullsLast=false omite el NULLS LAST', () => {
    const out = parseSort({ sort: 'name' }, SORTABLE, { defaultDir: 'asc', nullsLast: false });
    expect(out.orderBy).toBe('c.name ASC');
  });

  it('tieBreaker se concatena', () => {
    const out = parseSort({ sort: 'status' }, SORTABLE, {
      defaultDir: 'desc', tieBreaker: 'c.id ASC',
    });
    expect(out.orderBy).toBe('c.status DESC NULLS LAST, c.id ASC');
  });

  it('mapea a una expresión SQL compleja (join alias)', () => {
    const out = parseSort({ sort: 'amount' }, SORTABLE, { defaultDir: 'desc' });
    expect(out.column).toBe('c.amount_usd');
    expect(out.orderBy).toBe('c.amount_usd DESC NULLS LAST');
  });
});
