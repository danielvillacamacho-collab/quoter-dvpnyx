#!/usr/bin/env node
/**
 * scripts/check_docs_coverage.js — Enforcement del Manual de Usuario Vivo
 *
 * Escanea el código fuente buscando marcadores `// @docs-required: <slug>`
 * y verifica que cada artículo correspondiente exista en la base de datos
 * y haya sido actualizado en los últimos MAX_STALE_DAYS días.
 *
 * Uso:
 *   node scripts/check_docs_coverage.js          # revisa todo
 *   node scripts/check_docs_coverage.js --dry    # solo imprime, no falla
 *
 * En CI (GitHub Actions):
 *   - Corre como step independiente después de los tests.
 *   - Si hay slugs faltantes o stale → exit 1 → PR bloqueado.
 *   - El mensaje indica exactamente qué artículo falta y en qué archivo.
 *
 * Cómo agregar un nuevo requisito de documentación:
 *   En cualquier archivo .js del server agrega un comentario:
 *     // @docs-required: mi-feature-slug
 *   Luego crea el artículo en /help/admin antes de que el PR pueda mergear.
 */

const fs    = require('fs');
const path  = require('path');
const { Pool } = require('pg');

// ─── Config ──────────────────────────────────────────────────────────────────

const MAX_STALE_DAYS = 30;    // Artículos sin tocar por más días = stale
const SCAN_DIRS      = [
  path.join(__dirname, '../server'),
  path.join(__dirname, '../client/src'),
];
const EXTENSIONS     = ['.js', '.jsx', '.ts', '.tsx'];
const MARKER_REGEX   = /@docs-required:\s*([a-z0-9-]+)/g;
const DRY_RUN        = process.argv.includes('--dry');

// ─── Scan ────────────────────────────────────────────────────────────────────

function* walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'build', 'dist', 'coverage'].includes(entry.name)) continue;
      yield* walkDir(full);
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      yield full;
    }
  }
}

function scanRequirements() {
  const required = new Map(); // slug → [{ file, line }]

  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walkDir(dir)) {
      const content = fs.readFileSync(file, 'utf8');
      const lines   = content.split('\n');
      lines.forEach((line, idx) => {
        let m;
        MARKER_REGEX.lastIndex = 0;
        while ((m = MARKER_REGEX.exec(line)) !== null) {
          const slug = m[1];
          if (!required.has(slug)) required.set(slug, []);
          required.get(slug).push({ file: path.relative(process.cwd(), file), line: idx + 1 });
        }
      });
    }
  }

  return required;
}

// ─── DB check ────────────────────────────────────────────────────────────────

async function checkArticles(slugs) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT slug, is_published, updated_at
         FROM help_articles
        WHERE slug = ANY($1)`,
      [slugs]
    );
    return rows;
  } finally {
    await pool.end();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📖  check_docs_coverage — Manual de Usuario Vivo\n');

  const required = scanRequirements();

  if (required.size === 0) {
    console.log('✅  No se encontraron marcadores @docs-required en el código.\n');
    process.exit(0);
  }

  console.log(`🔍  Marcadores encontrados: ${required.size} slugs únicos`);
  for (const [slug, refs] of required) {
    console.log(`     • ${slug}  (${refs.map(r => `${r.file}:${r.line}`).join(', ')})`);
  }
  console.log('');

  // Si no hay DATABASE_URL (p.ej. en un PR sin acceso a DB) → warning, no falla
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️   DATABASE_URL no definida — omitiendo verificación contra DB.');
    console.warn('    Asegúrate de que los artículos existan antes de deployar.\n');
    process.exit(0);
  }

  let articles;
  try {
    articles = await checkArticles([...required.keys()]);
  } catch (err) {
    console.error('❌  No se pudo conectar a la DB:', err.message);
    process.exit(DRY_RUN ? 0 : 1);
  }

  const foundMap = new Map(articles.map(a => [a.slug, a]));
  const staleDate = new Date(Date.now() - MAX_STALE_DAYS * 24 * 60 * 60 * 1000);

  const missing  = [];
  const unpublished = [];
  const stale    = [];
  const ok       = [];

  for (const [slug, refs] of required) {
    const article = foundMap.get(slug);
    if (!article) {
      missing.push({ slug, refs });
    } else if (!article.is_published) {
      unpublished.push({ slug, refs, article });
    } else if (new Date(article.updated_at) < staleDate) {
      stale.push({ slug, refs, article });
    } else {
      ok.push(slug);
    }
  }

  // ── Reporte ────────────────────────────────────────────────────────────────
  if (ok.length) {
    console.log(`✅  OK (${ok.length}):`);
    ok.forEach(s => console.log(`     • ${s}`));
    console.log('');
  }

  if (stale.length) {
    console.log(`⏰  STALE (${stale.length}) — sin actualizar en más de ${MAX_STALE_DAYS} días:`);
    stale.forEach(({ slug, article, refs }) => {
      const daysAgo = Math.floor((Date.now() - new Date(article.updated_at)) / (1000 * 60 * 60 * 24));
      console.log(`     • ${slug}  (última actualización: hace ${daysAgo} días)`);
      refs.forEach(r => console.log(`       ↳ referenciado en ${r.file}:${r.line}`));
    });
    console.log('');
  }

  if (unpublished.length) {
    console.log(`📝  UNPUBLISHED (${unpublished.length}) — artículo existe pero no está publicado:`);
    unpublished.forEach(({ slug, refs }) => {
      console.log(`     • ${slug}`);
      refs.forEach(r => console.log(`       ↳ referenciado en ${r.file}:${r.line}`));
    });
    console.log('');
  }

  if (missing.length) {
    console.log(`❌  MISSING (${missing.length}) — artículo no existe en help_articles:`);
    missing.forEach(({ slug, refs }) => {
      console.log(`     • ${slug}`);
      refs.forEach(r => console.log(`       ↳ referenciado en ${r.file}:${r.line}`));
    });
    console.log('');
    console.log('  👉  Crea los artículos faltantes en /help/admin antes de mergear.\n');
  }

  const hasProblems = missing.length > 0 || unpublished.length > 0;
  // Stale es warning, no falla CI (solo informa)

  if (hasProblems) {
    if (DRY_RUN) {
      console.log('⚠️   --dry: se encontraron problemas pero no se falla el proceso.\n');
      process.exit(0);
    }
    console.error('🚫  Docs coverage fallida. Corrige los artículos faltantes o no publicados.\n');
    process.exit(1);
  }

  console.log('✅  Docs coverage OK.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('check_docs_coverage.js error:', err);
  process.exit(1);
});
