#!/usr/bin/env node
/*
 * R16.4 — comprobación de PORTABILIDAD con código real y cajas temporales.
 *
 * Ejercita los módulos de distribución (`lib/distribute.mjs`) y el almacén (`lib/state.mjs`) sin pasar por
 * el adaptador del Host, para demostrar que el contrato del paquete vale por sí mismo: exportar, leer,
 * importar en un segundo centro, auditar procedencia, no sobrescribir, no salir de la raíz y fallar cerrado.
 * Termina con PASS/FAIL por paso y exit code real. NUNCA usa `~/.dsh`: todo vive en `mkdtempSync`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BUNDLE_SCHEMA,
  BUNDLE_SCHEMA_VERSION,
  MAX_BUNDLE_BYTES,
  bundleChecksum,
  importBundle,
  invalidBundleReferences,
  possibleSecretWarnings,
  privateReferences,
  readBundle,
  writeBundle,
} from '../lib/distribute.mjs';
import { createSkill } from '../lib/operations.mjs';
import { centerFile, loadState, withState } from '../lib/state.mjs';

const NOW = '2026-11-09T23:00:00.000Z';
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  const mark = condition ? 'PASS' : 'FAIL';
  process.stdout.write(`${mark}  ${name}${detail === '' ? '' : `  (${detail})`}\n`);
}

function skillFixture(overrides = {}) {
  return {
    id: 'demo-portabilidad',
    title: 'Demo portabilidad',
    description: 'Demuestra que un paquete se exporta, se lee y se importa sin tocar el centro de origen.',
    whenToUse: 'Úsala cuando haya que verificar la portabilidad de una skill entre dos centros.',
    body: [
      '## Procedimiento',
      '',
      'Exporta la skill, lee el paquete y vuelve a importarlo en un centro limpio. Comprueba la procedencia y que el origen no cambió.',
      '',
      '## Evidencia',
      '',
      'Adjunta el checksum del paquete y el digesto de los dos almacenes antes y después.',
    ].join('\n'),
    tags: ['dsh', 'portabilidad'],
    ...overrides,
  };
}

function digestOf(root) {
  const file = centerFile(root);
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'missing';
}

function treeDigest(dir) {
  const hash = createHash('sha256');
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      const rel = `${prefix}${entry.name}`;
      hash.update(rel);
      if (entry.isDirectory()) walk(full, `${rel}/`);
      else hash.update(readFileSync(full));
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return hash.digest('hex');
}

function newCenter(box) {
  const root = join(box, 'center');
  mkdirSync(root, { recursive: true });
  return root;
}

const boxA = mkdtempSync(join(tmpdir(), 'r164-portability-a-'));
const boxB = mkdtempSync(join(tmpdir(), 'r164-portability-b-'));
const rootA = newCenter(boxA);
const rootB = newCenter(boxB);

try {
  // 1) La skill existe en A por la misma puerta que cualquier creación.
  const created = withState(rootA, (state) => createSkill(state, skillFixture(), { now: NOW, actor: 'human' }), { now: NOW }).result;
  check('crear skill en el centro A', created?.ok === true, created?.code ?? 'ok');

  // 2) Exportar produce un fichero real en exports/ con checksum y JSON.
  const written = writeBundle({ root: rootA, state: loadState(rootA).state, skillId: 'demo-portabilidad', now: NOW });
  check('exportar escribe exports/<id>-<version>.json', written.ok === true && existsSync(written.file), written.code ?? written.file);
  check('el checksum es 64 hex', /^[0-9a-f]{64}$/u.test(String(written.checksum)));
  const fileBytes = existsSync(written.file) ? readFileSync(written.file).length : -1;
  const originDigest = digestOf(rootA);
  const originTree = treeDigest(rootA);

  // 3) Exportar dos veces no pisa el paquete.
  const twice = writeBundle({ root: rootA, state: loadState(rootA).state, skillId: 'demo-portabilidad', now: NOW });
  check('segunda exportación ⇒ bundle-exists sin pisar', twice.ok === false && twice.code === 'bundle-exists' && readFileSync(written.file).length === fileBytes, twice.code);

  // 4) Lectura honesta del paquete.
  const text = readFileSync(written.file, 'utf8');
  const read = readBundle(text);
  check('el paquete declara schema y versión', read.bundle?.schema === BUNDLE_SCHEMA && read.bundle?.schemaVersion === BUNDLE_SCHEMA_VERSION);
  check('readBundle acepta el paquete y conserva checksum', read.ok === true && read.checksum === written.checksum, read.code ?? 'ok');
  check('readBundle no escribe (digesto de A intacto)', digestOf(rootA) === originDigest && treeDigest(rootA) === originTree);
  check('JSON malformado ⇒ invalid-bundle', readBundle('{ roto').code === 'invalid-bundle');
  check('objeto sin schema ⇒ invalid-bundle', readBundle(JSON.stringify({ schemaVersion: 1 })).code === 'invalid-bundle');
  check('schemaVersion no soportada ⇒ unsupported-schema', readBundle(JSON.stringify({ ...JSON.parse(text), schemaVersion: 2 })).code === 'unsupported-schema');
  const tampered = JSON.parse(text);
  tampered.skill.body += ' añadido';
  check('contenido sin checksum ⇒ checksum-mismatch', readBundle(JSON.stringify(tampered)).code === 'checksum-mismatch');
  check('paquete > 512 KiB ⇒ bundle-too-large', readBundle('x'.repeat(MAX_BUNDLE_BYTES + 1)).code === 'bundle-too-large');

  // 5) Referencias y secretos: rechazo/aviso sin ejecutar nada.
  check('referencias con ".." ⇒ invalidBundleReferences', invalidBundleReferences({ '../fuera.md': 'x' }).length === 1);
  check('referencia segura ⇒ sin invalidBundleReferences', invalidBundleReferences({ 'references/segura.md': 'x' }).length === 0);
  const privateWarnings = privateReferences({ 'references/nota.md': 'ver C:\\Users\\alguien\\secreto.txt' });
  check('ruta privada en contenido ⇒ warning absolute-path', privateWarnings.some((warning) => warning.reason === 'absolute-path'), privateWarnings.map((warning) => warning.reason).join(','));
  const secretWarnings = possibleSecretWarnings({ skill: { body: 'configura api_key = "sk-abcdefghijklmnop" aquí' } });
  check('posible secreto ⇒ warning possible-secret (no bloquea)', secretWarnings.some((warning) => warning.reason === 'possible-secret'));

  // 6) Importar en un segundo centro conserva procedencia y no toca el origen.
  const bundle = read.bundle;
  const imported = withState(rootB, (state) => importBundle(state, bundle, {
    now: NOW,
    from: 'centro-a',
    createSkill: (stateValue, candidate) => createSkill(stateValue, candidate, { now: NOW, actor: 'human' }),
  }), { now: NOW }).result;
  check('importar en B ⇒ ok, sin renombrar', imported?.ok === true && imported.renamed === false, imported?.code ?? 'ok');
  check('el origen A no cambia', digestOf(rootA) === originDigest && treeDigest(rootA) === originTree);
  const stateB = loadState(rootB).state;
  const origin = stateB.skills?.['demo-portabilidad']?.origin;
  check('procedencia importada completa en B', origin?.kind === 'import' && origin?.bundleChecksum === written.checksum && origin?.originalSkillId === 'demo-portabilidad' && origin?.originalVersion === '1.0.0');
  const event = (stateB.events ?? []).find((entry) => entry.code === 'skill-imported');
  check('evento skill-imported con checksum', event?.checksum === written.checksum && event?.renamed === false && event?.from === 'centro-a');

  // 7) Repetir el mismo paquete no escribe ni duplica.
  const digestB = digestOf(rootB);
  const repeat = withState(rootB, (state) => importBundle(state, bundle, {
    now: NOW,
    createSkill: (stateValue, candidate) => createSkill(stateValue, candidate, { now: NOW, actor: 'human' }),
  }), { now: NOW }).result;
  check('repetir ⇒ already-imported', repeat?.ok === false && repeat?.code === 'already-imported', repeat?.code);
  check('repetir no escribe B', digestOf(rootB) === digestB && Object.keys(loadState(rootB).state.skills).length === 1);

  // 8) Conflicto de id con paquete DISTINTO: no sobrescribe; la copia explícita se renombra.
  const boxC = mkdtempSync(join(tmpdir(), 'r164-portability-c-'));
  const rootC = newCenter(boxC);
  withState(rootC, (state) => createSkill(state, skillFixture({ body: `${skillFixture().body}\n\n## Otra versión\n\ncontenido distinto` }), { now: NOW, actor: 'human' }), { now: NOW });
  const third = writeBundle({ root: rootC, state: loadState(rootC).state, skillId: 'demo-portabilidad', now: NOW });
  const bundleForConflict = readBundle(readFileSync(third.file, 'utf8')).bundle;
  const conflict = withState(rootB, (state) => importBundle(state, bundleForConflict, {
    now: NOW,
    createSkill: (stateValue, candidate) => createSkill(stateValue, candidate, { now: NOW, actor: 'human' }),
  }), { now: NOW }).result;
  check('id ocupado con paquete distinto ⇒ conflict, sin sobrescribir', conflict?.ok === false && conflict?.code === 'conflict', conflict?.code);
  const digestConflict = digestOf(rootB);
  const copy = withState(rootB, (state) => importBundle(state, bundleForConflict, {
    now: NOW,
    onConflict: 'copy',
    createSkill: (stateValue, candidate) => createSkill(stateValue, candidate, { now: NOW, actor: 'human' }),
  }), { now: NOW }).result;
  check('onConflict copy ⇒ copia renombrada', copy?.ok === true && copy?.renamed === true && copy?.skill === 'demo-portabilidad-copia', copy?.code ?? copy?.skill);
  check('la copia no sobrescribe el original', digestOf(rootB) !== digestConflict && loadState(rootB).state.skills['demo-portabilidad']?.origin?.kind === 'import');
  rmSync(boxC, { recursive: true, force: true });

  // 9) Tope de escritura y cero escritura fuera de la raíz.
  const huge = {
    skills: {
      enorme: {
        id: 'enorme', title: 'enorme', status: 'published', currentVersion: '1.0.0',
        versions: [{ version: '1.0.0', body: 'x'.repeat(MAX_BUNDLE_BYTES + 1024), description: '', whenToUse: '', tags: [] }],
      },
    },
  };
  const hugeBox = mkdtempSync(join(tmpdir(), 'r164-portability-huge-'));
  const hugeRoot = newCenter(hugeBox);
  const hugeWrite = writeBundle({ root: hugeRoot, state: huge, skillId: 'enorme', now: NOW });
  check('escribir > 512 KiB ⇒ bundle-too-large y sin exports/', hugeWrite.ok === false && hugeWrite.code === 'bundle-too-large' && !existsSync(join(hugeRoot, 'exports')));
  rmSync(hugeBox, { recursive: true, force: true });

  const outside = readdirSync(boxB).filter((name) => name !== 'center');
  check('nada se escribe fuera de la raíz del centro', outside.length === 0, outside.join(','));
  // El paquete de A sólo vive en su exports/; B no recibe copia del fichero.
  check('B no guarda el fichero del paquete', !existsSync(join(rootB, 'exports')));
  check('digesto final de A intacto', digestOf(rootA) === originDigest && treeDigest(rootA) === originTree);
} finally {
  rmSync(boxA, { recursive: true, force: true });
  rmSync(boxB, { recursive: true, force: true });
}

const failed = results.filter((entry) => entry.ok === false).length;
process.stdout.write(`\nR16.4 portabilidad: ${results.length - failed}/${results.length} PASS · ${failed} FAIL\n`);
process.stdout.write(`almacén real: no se usó (todas las raíces eran temporales)\n`);
process.exit(failed === 0 ? 0 : 1);
