/**
 * Comprobaciones que no son pruebas de comportamiento pero que, si fallan, rompen la instalación.
 *
 * Existe porque el plugin se instala por ruta absoluta en un perfil real: un `exports` que apunta a un
 * fichero que no está, o un `cordis.patch.yml` con otro nombre, falla al montar el perfil y no aquí.
 * `npm run check` lo ejecuta; `npm test` no depende de él para no mezclar dos responsabilidades.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const problems = [];
const checks = [];

function ok(condition, message) {
  checks.push({ condition, message });
  if (!condition) problems.push(message);
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

ok(manifest.name === '@local/lifecode-skill-center', `el nombre del paquete es ${manifest.name}`);
ok(manifest.type === 'module', 'el paquete tiene que ser ESM');
ok(manifest.exports?.['.'] === './index.js', 'exports["."] tiene que ser ./index.js');
ok(manifest.exports?.['./client'] === './client.js', 'exports["./client"] tiene que ser ./client.js');
ok(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch tiene que apuntar al parche');
ok(manifest.dsh?.client?.platform === 'web', 'el cliente es de plataforma web');
ok(manifest.dependencies?.['@deepseek-ai/dsh-tools'] !== undefined, 'el adaptador necesita dsh-tools');

for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
  ok(existsSync(join(root, file)), `falta ${file}`);
}

const patch = existsSync(join(root, 'cordis.patch.yml')) ? readFileSync(join(root, 'cordis.patch.yml'), 'utf8') : '';
ok(/-\s*insert:/.test(patch), 'el parche tiene que insertar el plugin');
ok(patch.includes(manifest.name), 'el parche tiene que nombrar el paquete');
ok(/id:\s*lifecode-skill-center/.test(patch), 'el parche necesita un id estable');

/** El núcleo puro no puede depender del harness: por eso se puede probar antes de instalar. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(path);
  }
  return out;
}

for (const file of walk(join(root, 'lib'))) {
  const source = readFileSync(file, 'utf8');
  const name = relative(root, file);
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    ok(specifier.startsWith('./') || specifier.startsWith('node:'), `${name} importa «${specifier}», y el núcleo sólo puede importar node: o relativos`);
  }
  ok(!source.includes('@deepseek-ai/'), `${name} nombra un paquete del harness`);
}

const client = readFileSync(join(root, 'client.js'), 'utf8');
for (const match of client.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
  ok(match[1] === 'react', `client.js requiere «${match[1]}»; sólo puede requerir react`);
}
ok(!client.includes('@deepseek-ai/'), 'client.js no puede nombrar paquetes del harness');
ok(client.includes('window.__ModuleLoader__.load'), 'client.js tiene que registrarse con el cargador de módulos');

// Que cada fichero se pueda al menos parsear: un error de sintaxis en el cliente sólo se vería al abrir el panel.
for (const file of [...walk(join(root, 'lib')), join(root, 'index.js'), join(root, 'client.js'), ...walk(join(root, 'tests')), ...walk(join(root, 'tools'))]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  ok(result.status === 0, `${relative(root, file)} no parsea: ${(result.stderr ?? '').split('\n')[0]}`);
}

const passed = checks.filter((check) => check.condition).length;
for (const problem of problems) process.stderr.write(`✖ ${problem}\n`);
process.stdout.write(`\n${passed}/${checks.length} comprobaciones · ${problems.length === 0 ? 'todo en orden' : `${problems.length} problema(s)`}\n`);
process.exit(problems.length === 0 ? 0 : 1);
