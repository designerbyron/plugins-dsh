/*
 * Pruebas R16.4: paquetes portables (inspect-bundle / import-bundle / export-skill con procedencia).
 *
 * Todo vive en cajas de arena `mkdtempSync`: ni el almacén real, ni la biblioteca compartida, ni proyectos
 * productivos se tocan. Las fuentes del Host se simulan con adaptadores mínimos y la evidencia del
 * preflight se mide de verdad (`inventoryEvidence`) igual que hace `index.js` antes de despachar.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { API_PREFIX, handleApiRequest, inventoryEvidence, runAction } from '../lib/api.mjs';
import { bundleChecksum, importBundle, readBundle } from '../lib/distribute.mjs';
import { emptyState, loadState, normalizeState, saveState } from '../lib/state.mjs';
import { candidate, tempRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fileDigest(path) {
  return existsSync(path) ? sha256(readFileSync(path)) : 'missing';
}

function treeDigest(directory) {
  if (!existsSync(directory)) return 'missing';
  const rows = [];
  const walk = (current, prefix) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      const info = statSync(full);
      if (info.isDirectory()) walk(full, relative);
      else rows.push(`${relative}:${sha256(readFileSync(full))}`);
    }
  };
  walk(directory, '');
  return sha256(rows.join('\n'));
}

function fakeSkills(skills = [], { complete = true } = {}) {
  return { snapshot: async () => ({ skills, complete }) };
}

function fakeLoader(entries = []) {
  return { entries: () => entries };
}

async function postAction({ root, body, hostCwd = '', dshHome = '', agentsHome = '', inventory = null, collisions = null, hostSources = null, skills = null }) {
  return handleApiRequest({
    root,
    method: 'POST',
    pathname: API_PREFIX,
    search: '',
    body,
    hostCwd,
    skills,
    dshHome,
    agentsHome,
    inventory,
    collisions,
    hostSources,
    now: NOW,
  });
}

async function measureEvidence({ root, cwd, skills = null, loader = null, dshHome = '', agentsHome = '' }) {
  const measured = await inventoryEvidence({ root, skills: skills ?? fakeSkills([]), loader: loader ?? fakeLoader([]), hostCwd: cwd, cwd, now: NOW, dshHome, agentsHome });
  if (measured.unavailable !== undefined) {
    return {
      inventory: null,
      collisions: null,
      hostSources: [{ id: 'skills-registry', status: 'unavailable', reason: 'el Host no ofrece el catálogo de skills' }],
    };
  }
  const row = measured.inventory.sources.find((source) => source.id === 'skills-registry')
    ?? { id: 'skills-registry', status: 'incomplete', reason: 'el catálogo no se declaró completo' };
  return { inventory: measured.inventory, collisions: measured.collisions, hostSources: [row] };
}

/** Crea una skill en `root` y la exporta: devuelve el JSON del paquete y el resultado de exportación. */
async function exportedBundle({ root, id = 'paquete-uno' } = {}) {
  const created = runAction({ root, action: 'create', payload: candidate({ id }), actor: 'human', now: NOW });
  assert.equal(created.ok, true, JSON.stringify(created).slice(0, 300));
  const exported = await postAction({ root, body: { action: 'export-skill', payload: { skillId: id, version: '1.0.0' } } });
  assert.equal(exported.status, 200, JSON.stringify(exported.body).slice(0, 300));
  assert.equal(typeof exported.body.json, 'string');
  return { json: exported.body.json, exported: exported.body };
}

function parseBundle(json) {
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------------------------------
// inspect-bundle: sólo lectura
// ---------------------------------------------------------------------------------------------------

test('inspect-bundle válido: vista previa completa y CERO escrituras', async () => {
  const root = tempRoot('lsc-r164-inspect');
  const bundle = await exportedBundle({ root, id: candidate().id });
  const centerBefore = fileDigest(join(root, 'center.json'));
  const exportsBefore = treeDigest(join(root, 'exports'));
  const evidence = await measureEvidence({ root, cwd: root });

  const response = await postAction({ root, body: { action: 'inspect-bundle', bundle: bundle.json }, ...evidence });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 400));
  const body = response.body;
  assert.equal(body.ok, true);
  assert.equal(body.inspected, true);
  assert.equal(body.checksumMatches, true);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.schemaCompatible, true);
  const preview = body.preview;
  assert.equal(preview.name, preview.description, 'el nombre visible es el título humano del paquete');
  assert.equal(preview.identity.skillId, candidate().id);
  assert.equal(preview.compatibility.compatible, true);
  assert.equal(preview.compatibility.schemaVersion, 1);
  assert.equal(preview.integrity.checksumMatches, true);
  assert.equal(preview.portability.portable, true);
  assert.equal(preview.origin.app, 'lifecode-skill-center');
  assert.equal(preview.origin.skillId, candidate().id);
  assert.equal(preview.identity.skillId, candidate().id);
  assert.equal(preview.conflicts.sameId.exists, true, 'el mismo centro ya tiene esa id');
  assert.equal(preview.plan.action, 'copy', 'un id en uso sin decisión explícita propone copia, no sobrescribir');
  assert.equal(fileDigest(join(root, 'center.json')), centerBefore);
  assert.equal(treeDigest(join(root, 'exports')), exportsBefore);
});

test('inspect-bundle: JSON malformado, esquema desconocido y checksum manipulado son errores honestos', async () => {
  const root = tempRoot('lsc-r164-errors');
  const bundle = await exportedBundle({ root });
  const evidence = await measureEvidence({ root, cwd: root });

  const malformed = await postAction({ root, body: { action: 'inspect-bundle', bundle: '{ esto no es json' }, ...evidence });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'invalid-bundle');

  const wrongSchema = parseBundle(bundle.json);
  wrongSchema.schemaVersion = 2;
  const unsupported = await postAction({ root, body: { action: 'inspect-bundle', bundle: wrongSchema }, ...evidence });
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.code, 'unsupported-schema');

  const tampered = parseBundle(bundle.json);
  tampered.skill.body = `${tampered.skill.body}\n\ninyectado a mano`;
  const checksum = await postAction({ root, body: { action: 'inspect-bundle', bundle: tampered }, ...evidence });
  assert.equal(checksum.status, 400);
  assert.equal(checksum.body.code, 'checksum-mismatch');
});

test('inspect-bundle: referencias fuera de la carpeta ⇒ invalid-references; secreto evidente ⇒ warning que no bloquea', async () => {
  const root = tempRoot('lsc-r164-secret');
  const bundle = await exportedBundle({ root });
  const evidence = await measureEvidence({ root, cwd: root });

  const escaping = parseBundle(bundle.json);
  escaping.skill.references = [{ path: '../fuera.md', content: 'x' }];
  const refs = await postAction({ root, body: { action: 'inspect-bundle', bundle: escaping }, ...evidence });
  assert.equal(refs.status, 400);
  assert.equal(refs.body.code, 'invalid-references');

  const leaky = parseBundle(bundle.json);
  leaky.skill.body = `${leaky.skill.body}\n\npassword: hunter2\napi_key: abc123`;
  leaky.checksum = bundleChecksum({ body: leaky.skill.body, description: leaky.skill.description, whenToUse: leaky.skill.whenToUse, tags: leaky.skill.tags });
  const secret = await postAction({ root, body: { action: 'inspect-bundle', bundle: leaky }, ...evidence });
  assert.equal(secret.status, 200, JSON.stringify(secret.body).slice(0, 300));
  assert.equal(secret.body.preview.portability.portable, true);
  assert.ok(secret.body.preview.portability.warnings.some((item) => item.reason === 'possible-secret'));
});

test('inspect-bundle: un paquete mayor de 512 KiB no se lee', async () => {
  const root = tempRoot('lsc-r164-big');
  const before = fileDigest(join(root, 'center.json'));
  const response = await postAction({ root, body: { action: 'inspect-bundle', bundle: 'x'.repeat(512 * 1024 + 1) } });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'bundle-too-large');
  assert.equal(fileDigest(join(root, 'center.json')), before);
});

// ---------------------------------------------------------------------------------------------------
// import-bundle: confirmación, decisiones y preflight
// ---------------------------------------------------------------------------------------------------

test('import-bundle sin confirmed ⇒ 400 y cero escrituras', async () => {
  const root = tempRoot('lsc-r164-confirm');
  const source = tempRoot('lsc-r164-confirm-src');
  const bundle = await exportedBundle({ root: source });
  const before = fileDigest(join(root, 'center.json'));
  const response = await postAction({ root, body: { action: 'import-bundle', bundle: bundle.json } });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'confirmation-required');
  assert.equal(fileDigest(join(root, 'center.json')), before);
});

test('import-bundle: id ocupado sin onConflict ⇒ imported:false conflict; con onConflict copy ⇒ copia con procedencia y evento', async () => {
  const root = tempRoot('lsc-r164-import');
  const source = tempRoot('lsc-r164-import-src');
  const bundle = await exportedBundle({ root: source, id: candidate().id });
  const first = runAction({ root, action: 'create', payload: candidate({ id: candidate().id }), actor: 'human', now: NOW });
  assert.equal(first.ok, true);
  const before = fileDigest(join(root, 'center.json'));
  const evidence = await measureEvidence({ root, cwd: root });

  const conflict = await postAction({ root, body: { action: 'import-bundle', bundle: bundle.json, confirmed: true }, ...evidence });
  assert.equal(conflict.status, 200, JSON.stringify(conflict.body).slice(0, 400));
  assert.equal(conflict.body.imported, false);
  assert.equal(conflict.body.code, 'conflict');
  assert.equal(fileDigest(join(root, 'center.json')), before, 'un conflicto no escribe');

  const copied = await postAction({ root, body: { action: 'import-bundle', bundle: bundle.json, confirmed: true, onConflict: 'copy', from: 'centro-origen' }, ...evidence });
  assert.equal(copied.status, 200, JSON.stringify(copied.body).slice(0, 400));
  assert.equal(copied.body.imported, true);
  assert.equal(copied.body.renamed, true);
  assert.equal(copied.body.renamedFrom, candidate().id);
  assert.equal(copied.body.skill, `${candidate().id}-copia`);
  assert.equal(copied.body.origin.kind, 'import');
  assert.equal(copied.body.origin.from, 'centro-origen');
  assert.equal(copied.body.origin.originalSkillId, candidate().id);
  assert.equal(typeof copied.body.origin.bundleChecksum, 'string');

  const document = JSON.parse(readFileSync(join(root, 'center.json'), 'utf8'));
  const row = document.skills[`${candidate().id}-copia`];
  assert.ok(row, 'la copia quedó en el estado');
  assert.equal(row.origin.kind, 'import');
  assert.equal(row.origin.bundleChecksum, copied.body.origin.bundleChecksum);
  assert.equal(row.origin.originalVersion, '1.0.0');
  assert.match(row.origin.importedAt, /^\d{4}-\d{2}-\d{2}T/);
  const events = document.events ?? [];
  const event = [...events].reverse().find((item) => item.code === 'skill-imported');
  assert.ok(event, 'el diario registra la importación');
  assert.equal(event.checksum, copied.body.origin.bundleChecksum);
  assert.equal(event.renamed, true);
  assert.equal(event.skillId, `${candidate().id}-copia`);
  assert.equal(event.originalSkillId, candidate().id);
  assert.equal(event.originalVersion, '1.0.0');
  assert.equal(event.from, 'centro-origen');
});

test('import-bundle: el mismo paquete dos veces ⇒ already-imported sin segunda escritura', async () => {
  const root = tempRoot('lsc-r164-repeat');
  const source = tempRoot('lsc-r164-repeat-src');
  const bundle = await exportedBundle({ root: source, id: 'repetible' });
  const evidence = await measureEvidence({ root, cwd: root });

  const first = await postAction({ root, body: { action: 'import-bundle', bundle: bundle.json, confirmed: true }, ...evidence });
  assert.equal(first.status, 200, JSON.stringify(first.body).slice(0, 300));
  assert.equal(first.body.imported, true);
  assert.equal(first.body.renamed, false);
  const afterFirst = fileDigest(join(root, 'center.json'));

  const second = await postAction({ root, body: { action: 'import-bundle', bundle: bundle.json, confirmed: true }, ...evidence });
  assert.equal(second.status, 200);
  assert.equal(second.body.imported, false);
  assert.equal(second.body.code, 'already-imported');
  assert.equal(fileDigest(join(root, 'center.json')), afterFirst);
});

test('import-bundle: preflight bloquea por nombre ambiguo y no deja escritura', async () => {
  const target = tempRoot('lsc-r164-block');
  const cwd = tempRoot('lsc-r164-block-work');
  const dshHome = tempRoot('lsc-r164-block-dsh');
  const source = tempRoot('lsc-r164-block-src');
  const bundle = await exportedBundle({ root: source, id: 'ambiguo-import' });

  const writeSkill = (parent, name, body) => {
    const directory = join(parent, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: una descripción suficientemente larga para el inventario de prueba.\nwhenToUse: cuando haga falta.\n---\n\n${body}\n`);
  };
  writeSkill(join(cwd, '.dsh', 'skills'), 'ambiguo-import', 'Cuerpo uno, distinto.');
  writeSkill(join(dshHome, 'skills'), 'ambiguo-import', 'Cuerpo dos, distinto del primero.');
  const evidence = await measureEvidence({ root: target, cwd, dshHome });
  assert.ok(evidence.collisions.ambiguousNames.includes('ambiguo-import'));
  const before = fileDigest(join(target, 'center.json'));

  const response = await postAction({ root: target, body: { action: 'import-bundle', bundle: bundle.json, confirmed: true }, hostCwd: cwd, dshHome, ...evidence });
  assert.equal(response.status, 409, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.code, 'preflight-blocked');
  assert.ok(response.body.findings.some((item) => item.code === 'ambiguous-identity' && item.severity === 'block'));
  assert.equal(fileDigest(join(target, 'center.json')), before);
});

test('import-bundle: nombre ya usado por otra skill no la sobrescribe', async () => {
  const root = tempRoot('lsc-r164-name');
  const source = tempRoot('lsc-r164-name-src');
  const bundle = await exportedBundle({ root: source, id: 'otra-id' });
  const existing = runAction({ root, action: 'create', payload: candidate({ id: 'existente' }), actor: 'human', now: NOW });
  assert.equal(existing.ok, true);
  const existingVersion = JSON.parse(readFileSync(join(root, 'center.json'), 'utf8')).skills.existente.currentVersion;
  const evidence = await measureEvidence({ root, cwd: root });

  const response = await postAction({ root, body: { action: 'import-bundle', bundle: bundle.json, confirmed: true }, ...evidence });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.imported, true);
  assert.equal(response.body.skill, 'otra-id');
  const document = JSON.parse(readFileSync(join(root, 'center.json'), 'utf8'));
  assert.equal(document.skills.existente.currentVersion, existingVersion, 'la skill existente no cambia');
});

test('dos centros aislados: importar en el destino no toca el origen', async () => {
  const source = tempRoot('lsc-r164-isolated-src');
  const target = tempRoot('lsc-r164-isolated-dst');
  const bundle = await exportedBundle({ root: source, id: 'aislada' });
  const sourceBefore = treeDigest(source);
  const evidence = await measureEvidence({ root: target, cwd: target });
  const response = await postAction({ root: target, body: { action: 'import-bundle', bundle: bundle.json, confirmed: true, onConflict: 'copy' }, ...evidence });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  assert.equal(response.body.imported, true);
  assert.equal(treeDigest(source), sourceBefore, 'el centro de origen queda intacto');
  assert.ok(existsSync(join(target, 'center.json')));
});

test('importBundle directo: si la creación lanza, el documento de trabajo no queda a medias', async () => {
  const source = tempRoot('lsc-r164-interrupt-src');
  const bundle = await exportedBundle({ root: source, id: 'interrumpida' });
  const read = readBundle(bundle.json);
  assert.equal(read.ok, true);
  const state = emptyState(NOW);
  const before = JSON.stringify(state);
  assert.throws(() => importBundle(state, read.bundle, {
    now: NOW,
    createSkill: () => {
      throw new Error('fallo simulado de escritura');
    },
  }));
  assert.equal(JSON.stringify(state), before, 'el estado no se modifica si la creación falla');
});

test('export-skill incluye procedencia y json para la interfaz', async () => {
  const root = tempRoot('lsc-r164-export');
  const bundle = await exportedBundle({ root, id: 'exportable' });
  assert.equal(bundle.exported.portable, true);
  assert.equal(typeof bundle.exported.sha256, 'string');
  assert.equal(bundle.exported.origin.app, 'lifecode-skill-center');
  assert.equal(bundle.exported.origin.skillId, 'exportable');
  const parsed = parseBundle(bundle.json);
  assert.equal(parsed.origin.app, 'lifecode-skill-center');
  assert.equal(parsed.schemaVersion, 1);
});

// ---------------------------------------------------------------------------------------------------
// Procedencia durable: round-trip real por saveState/loadState
// ---------------------------------------------------------------------------------------------------

test('round-trip: origin importado y evento conservan sus campos de auditoría al recargar', async () => {
  const source = tempRoot('lsc-r164-round-src');
  const root = tempRoot('lsc-r164-round');
  const bundle = await exportedBundle({ root: source, id: 'durable' });
  const evidence = await measureEvidence({ root, cwd: root });
  const imported = await postAction({ root, body: { action: 'import-bundle', bundle: bundle.json, confirmed: true, from: 'origen' }, ...evidence });
  assert.equal(imported.body.imported, true, JSON.stringify(imported.body).slice(0, 300));

  const loaded = loadState(root);
  assert.equal(loaded.integrity === 'ok' || loaded.state !== null, true);
  const row = loaded.state.skills.durable;
  assert.equal(row.origin.kind, 'import');
  assert.equal(row.origin.from, 'origen');
  assert.equal(row.origin.fromVersion, '1.0.0');
  assert.equal(row.origin.bundleChecksum, imported.body.origin.bundleChecksum);
  assert.equal(row.origin.originalSkillId, 'durable');
  assert.equal(row.origin.originalVersion, '1.0.0');
  assert.match(row.origin.importedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const event = [...loaded.state.events].reverse().find((item) => item.code === 'skill-imported');
  assert.ok(event);
  assert.equal(event.checksum, imported.body.origin.bundleChecksum);
  assert.equal(event.renamed, false);
  assert.equal(event.originalSkillId, 'durable');
});

test('round-trip: un centro anterior a R16.4 no gana claves nuevas al normalizar', () => {
  const legacy = emptyState(NOW);
  legacy.skills.vieja = {
    id: 'vieja',
    title: 'Vieja',
    description: 'Una skill anterior a la procedencia de paquetes y su auditoría.',
    whenToUse: 'Cuando haga falta comprobar que normalizar no inventa campos.',
    tags: ['legacy'],
    status: 'published',
    currentVersion: '1.0.0',
    createdAt: NOW,
    updatedAt: NOW,
    origin: { kind: 'human', from: null, fromVersion: null, note: '' },
    versions: [
      {
        version: '1.0.0',
        body: '## Procedimiento\n\nUna skill anterior a R16.4 con cuerpo suficiente para normalizar.\n',
        description: 'Una skill anterior a la procedencia de paquetes y su auditoría.',
        whenToUse: 'Cuando haga falta comprobar que normalizar no inventa campos.',
        tags: ['legacy'],
        references: [],
        createdAt: NOW,
      },
    ],
  };
  legacy.events.push({ id: 'ev-1', at: NOW, type: 'skill.created', skillId: 'vieja', projectId: '', version: '1.0.0', actor: 'human', note: '' });
  const normalized = normalizeState(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(normalized.skills.vieja.origin, { kind: 'human', from: null, fromVersion: null, note: '' });
  assert.deepEqual(normalized.events[0], legacy.events[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.skills.vieja.origin, 'bundleChecksum'), false);
});
