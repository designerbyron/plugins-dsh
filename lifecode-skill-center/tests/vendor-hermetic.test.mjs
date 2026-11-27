/**
 * E8: hermeticidad y pureza del núcleo. El importador no puede importar Skill-Compiler, hacer red ni
 * escribir ficheros: la única escritura pasa por `withState` dentro de una transacción measurable.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { defaultRoot } from '../lib/state.mjs';
import { vendorCandidateFromManifest } from '../lib/vendor.mjs';
import { vendorFixture } from './helpers-vendor.mjs';
import { SYNTHETIC_ADAPTER_SCRIPT } from './fixtures/synthetic-source.mjs';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const libFiles = walk(join(pluginRoot, 'lib'));
const libSources = new Map(libFiles.map((file) => [relative(pluginRoot, file), readFileSync(file, 'utf8')]));

test('ningún fichero de lib/** importa Skill-Compiler ni un módulo ./vendor', () => {
  for (const [name, source] of libSources) {
    assert.equal(/@local\/skill-compiler|skill-compiler\/lib/.test(source), false, name);
    // La prohibición es el directorio `./vendor` (código upstream copiado), no el módulo del núcleo
    // `./vendor.mjs`, que `lib/api.mjs` importa legítimamente para el despacho de acciones.
    assert.equal(/\.\/vendor[\\/]/.test(source), false, name);
  }
});

test('lib/vendor.mjs no hace red ni escribe: sólo inyecta bytes y muta el estado', () => {
  const source = libSources.get('lib\\vendor.mjs') ?? libSources.get('lib/vendor.mjs');
  assert.ok(source, 'falta lib/vendor.mjs en el inventario');
  for (const forbidden of [/\bfetch\s*\(/, /https?\.(?:request|get)\s*\(/, /net\.connect\s*\(/]) {
    assert.equal(forbidden.test(source), false, String(forbidden));
  }
  for (const forbidden of [/\bwriteFileSync\s*\(/, /\brenameSync\s*\(/, /\bunlinkSync\s*\(/, /\brmSync\s*\(/]) {
    assert.equal(forbidden.test(source), false, String(forbidden));
  }
  assert.match(source, /withState/);
});

test('la puerta tools/check.mjs vigila la regla de estrategia C', () => {
  const check = readFileSync(join(pluginRoot, 'tools', 'check.mjs'), 'utf8');
  assert.match(check, /@local[\\/]+skill-compiler/);
  assert.match(check, /importa el directorio \.\/vendor/);
  assert.match(check, /writeFileSync/);
});

test('las pruebas de vendor usan raíces temporales, nunca el almacén real', () => {
  const testsDir = join(pluginRoot, 'tests');
  // Se excluye este propio fichero: menciona `withState` como patrón, no como llamada.
  for (const file of readdirSync(testsDir).filter((name) => name.startsWith('vendor-') && name !== 'vendor-hermetic.test.mjs')) {
    const source = readFileSync(join(testsDir, file), 'utf8');
    assert.equal(/defaultRoot\s*\(/.test(source), false, file);
    // Sólo las pruebas que escriben estado necesitan arena; las puras only-in-memory no la necesitan.
    if (/\bwithState\s*\(|\bloadState\s*\(|\bwriteFileSync\s*\(/.test(source)) {
      assert.ok(/tempRoot|mkdtempSync|tmpdir\s*\(/.test(source), `${file} escribe estado sin caja de arena`);
    }
  }
});

test('leer y verificar un candidato no altera la huella del almacén real', () => {
  const store = join(defaultRoot(), 'center.json');
  const fingerprint = () => existsSync(store)
    ? createHash('sha256').update(readFileSync(store)).digest('hex')
    : null;
  const before = fingerprint();
  const fixture = vendorFixture();
  const candidate = vendorCandidateFromManifest(fixture.manifest, { files: fixture.files });
  assert.equal(candidate.ok, true);
  assert.equal(fingerprint(), before);
});

test('el adaptador sintético permite inyectar binarios y no ejecuta el contenido importado', () => {
  const source = SYNTHETIC_ADAPTER_SCRIPT;
  assert.match(source, /CURL_BIN="\$\{CURL_BIN:-curl\}"/);
  assert.match(source, /JQ_BIN="\$\{JQ_BIN:-jq\}"/);
  assert.equal(/\beval\s/.test(source), false);
  assert.equal(/(^|[^A-Za-z])source\s/m.test(source), false);
  assert.equal(/\|\s*(bash|sh|zsh)\b/.test(source), false);
});
