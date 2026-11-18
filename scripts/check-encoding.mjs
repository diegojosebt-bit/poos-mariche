#!/usr/bin/env node
/**
 * Guardián de codificación.
 *
 * Detecta el clásico "doble UTF-8" (texto UTF-8 leído como Windows-1252 y
 * reescrito como UTF-8): aparece como "estÃ¡", "sesiÃ³n", "â€¢", "Â¿" y deja
 * caracteres de control C1 (U+0080..U+009F) enterrados en el código.
 *
 * Uso:  npm run check:encoding
 * Sale con código 1 si encuentra restos.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'public', 'scripts', 'docs'];
const EXTRA_FILES = ['package.json', 'tailwind.config.ts', 'next.config.js'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'backups', 'out', 'dist']);
// Este archivo documenta los patrones con ejemplos literales: se excluye a sí mismo.
const SKIP_FILES = new Set(['scripts/check-encoding.mjs']);
const EXT = /\.(tsx?|jsx?|mjs|cjs|json|md|css|html|ya?ml)$/i;
const MAX_BYTES = 2_000_000;

// Mojibake típico + caracteres de control C1 (nunca son legítimos en el fuente).
const PATTERNS = [
  { name: 'doble codificación (Ã/Â)', re: /[\u00C3][\u0080-\u00BF]|[\u00C2][\u0080-\u00BF]/ },
  { name: 'secuencia â€', re: /\u00E2\u20AC/ },
  { name: 'carácter de reemplazo U+FFFD', re: /\uFFFD/ },
  { name: 'carácter de control C1', re: /[\u0080-\u009F]/ },
];

const problems = [];

function checkFile(file) {
  const normalized = file.replace(/\\/g, '/');
  if (SKIP_FILES.has(normalized)) return;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        problems.push({ file, line: index + 1, name, sample: line.trim().slice(0, 90) });
        break;
      }
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (EXT.test(entry) && st.size <= MAX_BYTES) {
      checkFile(full);
    }
  }
}

for (const root of ROOTS) {
  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {
    // directorio inexistente: se ignora
  }
}
for (const file of EXTRA_FILES) {
  try {
    if (statSync(file).isFile()) checkFile(file);
  } catch {
    // archivo inexistente: se ignora
  }
}

if (problems.length === 0) {
  console.log('✓ Codificación correcta: sin mojibake ni caracteres de control.');
  process.exit(0);
}

console.error(`✗ Se encontraron ${problems.length} línea(s) con codificación rota:\n`);
for (const p of problems.slice(0, 60)) {
  console.error(`  ${p.file}:${p.line}  [${p.name}]  ${p.sample}`);
}
if (problems.length > 60) console.error(`  … y ${problems.length - 60} más.`);
console.error('\nSugerencia: reescribir el archivo en UTF-8 desde el editor (no con Set-Content).');
process.exit(1);
