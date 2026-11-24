/**
 * Genera `UX-02-2.1-DELIVERABLES.sha256` en LF y modo binario (`hash *ruta`), con rutas relativas a
 * la raíz del repositorio, para que `sha256sum -c` funcione desde `plugins-dhs-release`.
 *
 * Uso: node make-manifest.mjs   (se ejecuta UNA sola vez, al final; cualquier edición posterior
 * invalida el manifiesto y exige regenerarlo)
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const acto = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const MANIFEST = join(acto, 'UX-02-2.1-DELIVERABLES.sha256');

const producto = [
  'lifecode-rag/lib/workspaces-projection.mjs',
  'lifecode-rag/lib/harness-workspaces.mjs',
  'lifecode-rag/lib/pa-api.mjs',
  'lifecode-rag/index.js',
  'lifecode-rag/client.js',
  'lifecode-rag/docs/PA-UI-0-API-CONTRACT.md',
  'lifecode-rag/README.md',
  'lifecode-rag/package.json',
  'lifecode-rag/tests/workspaces-projection.test.mjs',
  'lifecode-rag/tests/pa-workspaces.test.mjs',
  'lifecode-rag/tests/client.test.mjs',
  'lifecode-rag/tests/adapter.test.mjs',
  'lifecode-rag/tests/pa-admin.test.mjs',
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (statSync(path).isFile()) out.push(path);
  }
  return out;
}

const documentos = readdirSync(acto)
  .filter((name) => name.startsWith('UX-02-2.1-') && name.endsWith('.md'))
  .sort()
  .map((name) => join(acto, name));

const evidencia = walk(join(acto, 'evidence')).sort((a, b) => a.localeCompare(b));

const rutas = [...producto, ...documentos, ...evidencia]
  .map((path) => (path.startsWith('/') || /^[A-Za-z]:/.test(path) ? path : join(repo, path)))
  .filter((path) => path !== MANIFEST);

const lineas = rutas.map((path) => {
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  const rel = relative(repo, path).split('\\').join('/');
  return `${hash} *${rel}`;
});

// LF explícito y bytes: `open(..., 'w')` en Windows traduciría \n a CRLF y `sha256sum -c` fallaría.
writeFileSync(MANIFEST, Buffer.from(`${lineas.sort().join('\n')}\n`, 'utf8'));
console.log(`${lineas.length} ficheros en ${relative(repo, MANIFEST)}`);
