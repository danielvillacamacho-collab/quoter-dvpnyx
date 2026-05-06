#!/usr/bin/env node
/**
 * regen-spec-brief.js
 *
 * Regenera las secciones AUTO del brief que consume el agent que escribe
 * specs (`docs/SPEC_AGENT_BRIEF.md`). El header curado del brief NO se
 * toca: solo los bloques delimitados por
 *
 *     <!-- AUTO:<seccion>:start -->
 *     ...
 *     <!-- AUTO:<seccion>:end -->
 *
 * Ejecutar antes de invocar al agent:
 *
 *     node scripts/regen-spec-brief.js
 *
 * No tiene dependencias externas — usa solo regex y fs. Si la regex deja
 * de coincidir contra un archivo, el script imprime un warning pero NO
 * falla la corrida (mejor brief parcial que ningún brief).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BRIEF = path.join(ROOT, 'docs', 'SPEC_AGENT_BRIEF.md');

// ─── Helpers ────────────────────────────────────────────────────────

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

function listFiles(dir, predicate) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => predicate(f))
    .map((f) => path.join(dir, f));
}

function relative(p) {
  return path.relative(ROOT, p);
}

// ─── Mine: server routes ────────────────────────────────────────────

/**
 * Devuelve [{ file, mountPath, method, route, middleware, summary }]
 * mountPath se infiere desde server/index.js.
 */
function mineRoutes() {
  const routesDir = path.join(ROOT, 'server', 'routes');
  const indexFile = path.join(ROOT, 'server', 'index.js');
  const mounts = {};
  if (exists(indexFile)) {
    const idx = read(indexFile);
    const re = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g;
    let m;
    while ((m = re.exec(idx)) !== null) {
      mounts[m[2].replace(/\.js$/, '')] = m[1];
    }
  }

  const files = listFiles(routesDir, (f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  const out = [];
  for (const file of files) {
    const base = path.basename(file, '.js');
    const mount = mounts[base] || `/api/${base}`;
    const src = read(file);
    const lines = src.split('\n');

    // Capture preceding JSDoc summary (best-effort).
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*(?:,\s*([^,]+(?:,\s*[^,]+)*))?,\s*async/);
      if (!m) continue;
      const [, methodLower, route, mwRaw] = m;
      const middleware = (mwRaw || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !/^\(/.test(s));

      // Walk up to find a leading // or /** comment.
      let summary = '';
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        const prev = lines[j].trim();
        if (!prev) continue;
        if (prev.startsWith('//')) {
          summary = prev.replace(/^\/\/\s*/, '').slice(0, 80);
          break;
        }
        if (prev.startsWith('*')) {
          summary = prev.replace(/^\*\s*/, '').replace(/^@\w+\s*/, '').slice(0, 80);
          if (summary) break;
        }
        if (prev.startsWith('/**') || prev.startsWith('*/')) continue;
        break;
      }

      out.push({
        file: relative(file),
        mountPath: mount,
        method: methodLower.toUpperCase(),
        route,
        middleware,
        summary,
      });
    }
  }
  out.sort((a, b) => (a.mountPath + a.route).localeCompare(b.mountPath + b.route));
  return out;
}

// ─── Mine: DB schema (CREATE TABLE) ────────────────────────────────

function mineSchema() {
  const file = path.join(ROOT, 'server', 'database', 'migrate.js');
  if (!exists(file)) return [];
  const src = read(file);
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    const cols = body.split(/,(?![^()]*\))/)
      .map((s) => s.trim())
      .filter((s) => s && !/^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\b/i.test(s))
      .map((s) => {
        // Take first 2 tokens: column name + type
        const tokens = s.split(/\s+/).slice(0, 2).join(' ');
        return tokens;
      })
      .filter((s) => /^\w+\s+\w/.test(s));
    out.push({ name, columns: cols });
  }
  // Dedup (CREATE TABLE IF NOT EXISTS is idempotent so ok)
  const seen = new Set();
  return out.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Mine: client modules ──────────────────────────────────────────

function mineModules() {
  const dir = path.join(ROOT, 'client', 'src', 'modules');
  const files = listFiles(dir, (f) =>
    f.endsWith('.js') && !f.endsWith('.test.js') && !f.endsWith('.stories.js'));
  return files
    .map((f) => path.basename(f, '.js'))
    .sort();
}

// ─── Mine: roles ────────────────────────────────────────────────────

function mineRoles() {
  const file = path.join(ROOT, 'server', 'middleware', 'auth.js');
  if (!exists(file)) return null;
  const src = read(file);
  const grab = (re) => {
    const m = src.match(re);
    if (!m) return [];
    return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  };
  return {
    all: grab(/const ROLES\s*=\s*\[([^\]]+)\]/),
    seeAll: grab(/const SEE_ALL_ROLES\s*=\s*new Set\(\[([^\]]+)\]\)/),
    write: grab(/const WRITE_ROLES\s*=\s*new Set\(\[([^\]]+)\]\)/),
  };
}

// ─── Mine: existing specs ──────────────────────────────────────────

function mineSpecs() {
  const dir = path.join(ROOT, 'docs', 'specs');
  if (!exists(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        const head = read(full).split('\n').slice(0, 10).join(' ');
        const titleMatch = head.match(/^#\s+(.+)$/m);
        out.push({
          file: relative(full),
          title: titleMatch ? titleMatch[1].slice(0, 80) : path.basename(full),
        });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// ─── Render ─────────────────────────────────────────────────────────

function fmtRoutes(routes) {
  if (!routes.length) return '_(sin endpoints)_';
  // Group by mountPath + filename
  const grouped = {};
  for (const r of routes) {
    const key = `${r.mountPath} (${r.file})`;
    (grouped[key] ||= []).push(r);
  }
  const out = [];
  for (const key of Object.keys(grouped).sort()) {
    out.push(`\n### ${key}\n`);
    out.push('| Método | Ruta | Middleware | Resumen |');
    out.push('|---|---|---|---|');
    for (const r of grouped[key]) {
      const mw = r.middleware.length ? r.middleware.join(', ') : '`auth`';
      const summary = (r.summary || '').replace(/\|/g, '\\|');
      out.push(`| ${r.method} | \`${r.route}\` | ${mw} | ${summary} |`);
    }
  }
  return out.join('\n');
}

function fmtSchema(tables) {
  if (!tables.length) return '_(sin tablas detectadas)_';
  const out = [];
  for (const t of tables) {
    const cols = t.columns.slice(0, 12).join(', ') + (t.columns.length > 12 ? `, … (+${t.columns.length - 12})` : '');
    out.push(`- **${t.name}** — ${cols}`);
  }
  return out.join('\n');
}

function fmtModules(mods) {
  if (!mods.length) return '_(sin módulos)_';
  return mods.map((m) => `- \`${m}\``).join('\n');
}

function fmtRoles(roles) {
  if (!roles) return '_(no se pudo extraer auth.js)_';
  return [
    `- **Todos los roles:** ${roles.all.map((r) => `\`${r}\``).join(', ')}`,
    `- **\`SEE_ALL_ROLES\` (lectura cross-empleado):** ${roles.seeAll.map((r) => `\`${r}\``).join(', ')}`,
    `- **\`WRITE_ROLES\`:** ${roles.write.map((r) => `\`${r}\``).join(', ')}`,
  ].join('\n');
}

function fmtSpecs(specs) {
  if (!specs.length) return '_(sin specs aún)_';
  return specs.map((s) => `- [\`${s.file}\`](${path.relative(path.dirname(BRIEF), path.join(ROOT, s.file))}) — ${s.title}`).join('\n');
}

// ─── Splice into brief ─────────────────────────────────────────────

function splice(content, section, replacement) {
  const start = `<!-- AUTO:${section}:start -->`;
  const end = `<!-- AUTO:${section}:end -->`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(content)) {
    console.warn(`[warn] sección "${section}" no encontrada en el brief; saltando.`);
    return content;
  }
  return content.replace(re, `${start}\n${replacement}\n${end}`);
}

function main() {
  if (!exists(BRIEF)) {
    console.error(`[error] no existe ${relative(BRIEF)}. Crealo primero (con los marcadores AUTO:*).`);
    process.exit(1);
  }
  const routes = mineRoutes();
  const schema = mineSchema();
  const modules = mineModules();
  const roles = mineRoles();
  const specs = mineSpecs();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  let content = read(BRIEF);
  content = splice(content, 'stamp', `_Generado: ${stamp} · regenerar con \`node scripts/regen-spec-brief.js\`._`);
  content = splice(content, 'roles', fmtRoles(roles));
  content = splice(content, 'tables', fmtSchema(schema));
  content = splice(content, 'modules', fmtModules(modules));
  content = splice(content, 'routes', fmtRoutes(routes));
  content = splice(content, 'specs', fmtSpecs(specs));

  fs.writeFileSync(BRIEF, content, 'utf8');
  console.log(`[ok] ${relative(BRIEF)} regenerado.`);
  console.log(`     ${routes.length} endpoints · ${schema.length} tablas · ${modules.length} módulos · ${specs.length} specs.`);
}

main();
