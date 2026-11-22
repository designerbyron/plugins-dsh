/**
 * Comprobaciones estructurales del plugin, sin abrir el almacén ni el host.
 * Se ejecuta con `node tools/check.mjs`; sale con código 1 si algo no cumple.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative as relativePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createToolDefinitions } from '../lib/tools.mjs';
import { validateConfig } from '../lib/paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const problems = [];

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(path);
  }
  return out;
}

for (const path of walk(ROOT)) {
  const source = readFileSync(path, 'utf8');
  const relative = relativePath(ROOT, path).replaceAll('\\', '/');
  if (/from\s+['"]@deepseek-ai\/|require\(\s*['"]@deepseek-ai\//.test(source)) {
    problems.push(`${path}: importa un paquete @deepseek-ai/*`);
  }
  // EF local-first: la recuperación no sale a la red. Excepciones deliberadas y acotadas:
  //  - `lib/embedders.mjs` es el único punto que puede hablar con un proveedor remoto opt-in,
  //    y exige configuración explícita, credencial y aprobación por llamada en `lib/tools.mjs`;
  //  - `client.js` usa `fetch` contra la API local del propio panel (mismo origen);
  //  - `demo/` y las pruebas hablan con servidores locales en 127.0.0.1.
  const networkAllowed = relative === 'lib/embedders.mjs'
    || relative === 'client.js'
    || relative.startsWith('demo/')
    || relative.startsWith('tests/');
  if (!networkAllowed && /node:(http|https|net|dns)\b|\bfetch\s*\(/.test(source)) {
    problems.push(`${path}: usa red (${/node:(http|https|net|dns)\b/.exec(source)?.[0] ?? 'fetch'}) en una ruta local`);
  }
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  if (manifest[field] && Object.keys(manifest[field]).length > 0) {
    problems.push(`package.json: ${field} debe estar vacío (plugin sin dependencias)`);
  }
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') problems.push('package.json: falta dsh.bundle.patch');

// G3 (K1): el bundle del cliente tiene que ser **resoluble**. `exports["./client"]` es requisito de
// carga; `dsh.client.inject` es orden de activación y no se exige (enmienda documental de G3).
const clientExport = manifest.exports?.['./client'];
const clientRel = typeof clientExport === 'string' ? clientExport : clientExport?.default;
if (typeof clientRel !== 'string') problems.push('package.json: falta exports["./client"] (G3)');
if (manifest.exports?.['.'] !== './index.js') problems.push('package.json: exports["."] debe apuntar a ./index.js');
if (manifest.dsh?.client?.platform !== 'web') problems.push('package.json: dsh.client.platform debe ser "web"');
if (manifest.dsh?.client?.inject !== undefined) problems.push('package.json: dsh.client.inject no es requisito de carga y no se declara');
if (typeof clientRel === 'string') {
  if (!existsSync(join(ROOT, clientRel))) problems.push(`package.json: ${clientRel} no existe`);
  else {
    const clientSource = readFileSync(join(ROOT, clientRel), 'utf8');
    if (!clientSource.includes(`id: '${manifest.name}'`)) problems.push('client.js: el id del loader no coincide con el nombre del paquete');
    if (/ctx\.slots\.inject\(\s*[A-Z_]+\s*\)\s*;/.test(clientSource)) problems.push('client.js: usa la API de slots obsoleta inject(slot)');
    if (!clientSource.includes('ctx.slots.inject(SIDEBAR_SLOT, () =>')) problems.push('client.js: la fila no se registra con inject(slot, cb)');
  }
}

const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
// El nombre de la fila debe ser el del paquete declarado, no una cadena fija: así el renombrado para
// publicación no puede dejar el patch apuntando a un paquete que ya no existe.
const patchName = /name:\s*'([^']+)'/.exec(patch)?.[1];
if (!/id:\s*lifecode-rag/.test(patch) || patchName !== manifest.name) {
  problems.push(`cordis.patch.yml: no inserta la fila esperada (id lifecode-rag + name ${manifest.name})`);
}

// `exports["./lib/*"]` se resuelve con el patrón aplicado al especificador: si el destino vuelve a
// añadir `.mjs`, `pkg/lib/tools.mjs` pediría `tools.mjs.mjs`. Esto sólo se ve desde fuera del paquete,
// así que se comprueba aquí con la autorreferencia por nombre (Node la permite dentro del propio paquete).
try {
  const selfRequire = createRequire(join(ROOT, 'package.json'));
  for (const specifier of [`${manifest.name}/lib/tools.mjs`, `${manifest.name}/lib/tools`]) {
    const resolved = selfRequire.resolve(specifier);
    if (!existsSync(resolved)) problems.push(`package.json: ${specifier} no resuelve a un fichero existente`);
  }
} catch (error) {
  problems.push(`package.json: exports["lib/*"] no resuelve el import del consumidor (${error.code ?? error.message})`);
}

const definitions = createToolDefinitions({ config: validateConfig({}), root: join(ROOT, '.check-store'), services: {} });
const names = definitions.map((definition) => definition.name).sort();
const expected = [
  'lifecode_rag_context', 'lifecode_rag_forget', 'lifecode_rag_get', 'lifecode_rag_ingest',
  'lifecode_rag_list', 'lifecode_rag_reindex', 'lifecode_rag_search',
];
if (JSON.stringify(names) !== JSON.stringify(expected)) problems.push(`herramientas: ${names.join(', ')}`);

for (const definition of definitions) {
  if (!definition.parameters || definition.parameters.type !== 'object') problems.push(`${definition.name}: parámetros sin objeto`);
  if (!definition.output?.schema || typeof definition.output.render !== 'function') problems.push(`${definition.name}: salida incompleta`);
}

if (problems.length > 0) {
  console.error('✗ comprobaciones fallidas:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`✓ ${definitions.length} herramientas, sin dependencias de @deepseek-ai/*, manifiesto y parche correctos (G3: exports["./client"] resoluble, cliente con la API de slots vigente)`);
