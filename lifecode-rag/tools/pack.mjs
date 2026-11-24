#!/usr/bin/env node
/**
 * Empaqueta la distribución publicable de LifeCode RAG.
 *
 * El manifiesto del repositorio declara los comandos de desarrollo (`test`, `check`, `bench`, `demo`…), cuyos
 * destinos viven en `tools/` y `demo/`, que **no** se publican. Publicar ese manifiesto tal cual anuncia seis
 * comandos que no se pueden ejecutar y un `test` que sale con 0 sin ejecutar nada.
 *
 * Este script produce el paquete por el camino estándar (`npm pack`), pero empaqueta el manifiesto **derivado**:
 * el del repositorio sin `scripts` ni `devDependencies`. No toca el árbol de trabajo: `npm pack` se ejecuta sobre
 * una copia temporal extraída del propio paquete.
 *
 * Uso:  node tools/pack.mjs --out <carpeta>   (o: npm run pack:dist -- --out <carpeta>)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const REMOVED_KEYS = ['scripts', 'devDependencies'];
const FORBIDDEN = /^(tests|tools|demo|bench|eval|plans|_audit|node_modules)\//;
const ALWAYS_EQUAL = ['name', 'version', 'type', 'main', 'exports', 'dsh', 'engines', 'files', 'bin', 'icon'];

const argOf = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};
const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(1);
};
// Se invoca la CLI de npm con `node` directamente: evita `shell: true` (y su aviso DEP0190) y el escapado de
// rutas con espacios. Si no se localiza la CLI, se cae al ejecutable del PATH.
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npm = (args, cwd) =>
  existsSync(npmCli)
    ? execFileSync(process.execPath, [npmCli, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
        cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
const untar = (tgz, into) =>
  execFileSync(
    'tar',
    [...(process.platform === 'win32' ? ['--force-local'] : []), '-xzf', tgz, '-C', into],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
const walk = (dir, root = dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
};

const out = argOf('--out');
if (!out) fail('falta --out <carpeta destino> (el paquete no se escribe en el árbol de trabajo a propósito)');
const root = resolve(import.meta.dirname, '..');
if (!existsSync(join(root, 'lib')) || !existsSync(join(root, 'package.json'))) {
  fail(`no parece la raíz del plugin: ${root}`);
}
const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!source.scripts) fail('el manifiesto del repositorio ya no declara scripts: revisar este script antes de seguir');

const work = mkdtempSync(join(tmpdir(), 'lcr-pack-'));
try {
  // 1. Empaquetado estándar: npm decide el conjunto de ficheros (respeta `files` y las exclusiones de npm).
  npm(['pack', '--pack-destination', work, '--silent'], root);
  const first = readdirSync(work).find((entry) => entry.endsWith('.tgz'));
  if (!first) fail('npm pack no produjo ningún .tgz');

  // 2. Se extrae y se deriva el manifiesto en la copia, nunca en el árbol de trabajo.
  const stage = join(work, 'stage');
  mkdirSync(stage, { recursive: true });
  untar(join(work, first), stage);
  const pkgPath = join(stage, 'package', 'package.json');
  const published = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const key of REMOVED_KEYS) delete published[key];
  writeFileSync(pkgPath, `${JSON.stringify(published, null, 2)}\n`);

  // 3. Segundo empaquetado, ya con el manifiesto derivado, también por el mecanismo estándar.
  const second = join(work, 'second');
  mkdirSync(second, { recursive: true });
  npm(['pack', '--pack-destination', second, '--silent'], join(stage, 'package'));
  const tgz = join(second, readdirSync(second).find((entry) => entry.endsWith('.tgz')));

  // 4. Verificación del resultado: contenido, manifiesto y correspondencia byte a byte con el árbol de trabajo.
  const check = join(work, 'check');
  mkdirSync(check, { recursive: true });
  untar(tgz, check);
  const packedRoot = join(check, 'package');
  const files = walk(packedRoot).sort();
  const problems = [];
  for (const file of files) {
    if (FORBIDDEN.test(file)) problems.push(`artefacto de desarrollo en el paquete: ${file}`);
    const sourceFile = join(root, file);
    if (!existsSync(sourceFile)) {
      problems.push(`sin origen en el árbol de trabajo: ${file}`);
      continue;
    }
    if (file === 'package.json') continue;
    if (!readFileSync(join(packedRoot, file)).equals(readFileSync(sourceFile))) {
      problems.push(`difiere del árbol de trabajo: ${file}`);
    }
  }
  const manifest = JSON.parse(readFileSync(join(packedRoot, 'package.json'), 'utf8'));
  for (const key of REMOVED_KEYS) if (key in manifest) problems.push(`el manifiesto publicado todavía declara ${key}`);
  for (const key of ALWAYS_EQUAL) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(source[key])) problems.push(`el manifiesto publicado cambió ${key}`);
  }
  if (manifest.version !== source.version) problems.push('la versión publicada no coincide con la del repositorio');
  if (!files.includes('docs/CONTRATO-EXTENSIONES-1.4.md')) problems.push('falta docs/CONTRATO-EXTENSIONES-1.4.md');

  if (problems.length > 0) fail(`verificación fallida:\n  - ${problems.join('\n  - ')}`);

  // 5. Entrega: el artefacto se copia al destino indicado, nunca dentro del árbol de trabajo por defecto.
  const destination = resolve(out);
  mkdirSync(destination, { recursive: true });
  const target = join(destination, basename(tgz));
  rmSync(target, { force: true }); // en Windows rename no sobrescribe
  renameSync(tgz, target);

  const bytes = readFileSync(target);
  console.log(
    JSON.stringify(
      {
        file: basename(target),
        version: manifest.version,
        files: files.length,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        removedFromManifest: REMOVED_KEYS.filter((key) => key in source),
        keptScripts: Object.keys(manifest.scripts ?? {}),
        contract: files.includes('docs/CONTRATO-EXTENSIONES-1.4.md'),
      },
      null,
      2,
    ),
  );
} finally {
  if (!process.argv.includes('--keep-temp')) rmSync(work, { recursive: true, force: true });
  else console.log(`temporal conservado: ${work}`);
}
