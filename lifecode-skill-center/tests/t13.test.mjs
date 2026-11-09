import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAction } from '../lib/api.mjs';
import { skillProviderFor } from '../lib/provider.mjs';
import { appendEvent, centerFile, functionalSignature, loadState, withState } from '../lib/state.mjs';
import { candidate, tempProject, tempRoot } from './helpers.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LOADER = join(HERE, 'fixtures', 'loader.mjs');
const CREATOR = join(HERE, 'fixtures', 'creator.mjs');
const WRITER = join(HERE, 'fixtures', 'writer.mjs');

function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/** Deja un centro con un proyecto, una skill y la asignación encendida; no entrega catálogo todavía. */
function seed(root, cwd) {
  const created = runAction({ root, action: 'create', actor: 'ai', cwd, payload: candidate() });
  assert.equal(created.ok, true, JSON.stringify(created));
  const opened = runAction({ root, action: 'open', cwd });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const toggled = runAction({
    root,
    action: 'toggle',
    actor: 'human',
    cwd,
    payload: { projectId: opened.project.id, skillId: created.id, enabled: true },
  });
  assert.equal(toggled.ok, true, JSON.stringify(toggled));
  return { skillId: created.id, projectId: opened.project.id };
}

function snapshot(root) {
  const file = centerFile(root);
  const state = loadState(root).state;
  return {
    mtime: statSync(file).mtimeMs,
    updatedAt: state.updatedAt,
    events: state.events.length,
    loads: state.events.filter((event) => event.type === 'skill.loaded').length,
    hash: JSON.stringify(state.events),
  };
}

test('la primera entrega del catálogo registra un skill.loaded por skill y proyecto', async () => {
  const root = tempRoot('lsc-t13-primera');
  const cwd = tempProject('proyecto', root);
  seed(root, cwd);

  const provider = skillProviderFor({ root });
  const delivered = await provider.list({ cwd });
  assert.equal(delivered.length, 1);

  const after = snapshot(root);
  assert.equal(after.loads, 1, 'la primera entrega legítima se registra: no vale suprimir toda la telemetría');
  const event = loadState(root).state.events.find((entry) => entry.type === 'skill.loaded');
  assert.equal(event.actor, 'system', 'una carga de catálogo no es una persona');
});

test('tres entregas sin novedades dejan mtime, updatedAt y diario idénticos', async () => {
  const root = tempRoot('lsc-t13-tres');
  const cwd = tempProject('proyecto', root);
  seed(root, cwd);
  const provider = skillProviderFor({ root });
  await provider.list({ cwd }); // primera entrega: sí escribe
  const before = snapshot(root);

  for (let index = 0; index < 3; index += 1) {
    const delivered = await provider.list({ cwd });
    assert.equal(delivered.length, 1);
  }

  const after = snapshot(root);
  assert.equal(after.mtime, before.mtime, 'T13: una lectura del catálogo no puede escribir');
  assert.equal(after.updatedAt, before.updatedAt, 'el sello de escritura no se mueve sin cambios');
  assert.equal(after.events, before.events, 'el diario no crece al reentregar');
  assert.equal(after.loads, 1, 'el evento del día ya estaba: no se duplica');
});

test('el diario no recibe eventos duplicados aunque se entrecruce la entrega', async () => {
  const root = tempRoot('lsc-t13-duplicados');
  const cwd = tempProject('proyecto', root);
  seed(root, cwd);
  const provider = skillProviderFor({ root });

  await Promise.all([provider.list({ cwd }), provider.list({ cwd }), provider.list({ cwd })]);

  const state = loadState(root).state;
  const loads = state.events.filter((event) => event.type === 'skill.loaded');
  assert.equal(loads.length, 1, 'una entrega por día, skill y proyecto');
});

test('dos procesos entregando la misma skill a la vez dejan un solo evento', async () => {
  const root = tempRoot('lsc-t13-procesos');
  const cwd = tempProject('proyecto', root);
  seed(root, cwd);

  const [left, right] = await Promise.all([
    runNode(LOADER, [root, cwd, '3']),
    runNode(LOADER, [root, cwd, '3']),
  ]);

  assert.equal(left.code, 0, left.err);
  assert.equal(right.code, 0, right.err);
  const loads = loadState(root).state.events.filter((event) => event.type === 'skill.loaded');
  assert.equal(loads.length, 1, `un solo evento para el mismo día y sujeto, hay ${loads.length}`);
  assert.equal(existsSync(`${centerFile(root)}.lock`), false, 'el candado no puede quedarse tomado');
});

test('dos operaciones distintas a la vez persisten las dos', async () => {
  const root = tempRoot('lsc-t13-distintas');
  const base = tempProject('base', root);
  const cwd = tempProject('proyecto', root);

  const [writer, creator] = await Promise.all([
    runNode(WRITER, [root, base, 'z', '3']),
    runNode(CREATOR, [root, cwd, 'skill-de-concurrencia']),
  ]);

  assert.equal(writer.code, 0, writer.err);
  assert.equal(creator.code, 0, creator.err);

  const state = loadState(root).state;
  const registered = Object.values(state.projects).filter((project) => String(project.cwd).includes('/z-'));
  assert.equal(registered.length, 3, 'las aperturas del panel no se pierden');
  assert.ok(state.skills['skill-de-concurrencia'], 'la creación del agente tampoco se pierde');
});

test('panel y agente escribiendo a la vez no pierden cambios', async () => {
  const root = tempRoot('lsc-t13-panel-agente');
  const base = tempProject('base', root);
  const cwd = tempProject('proyecto', root);

  const [written, created] = await Promise.all([
    runNode(WRITER, [root, base, 'panel', '4']),
    runNode(CREATOR, [root, cwd, 'skill-del-agente']),
  ]);

  assert.equal(written.code, 0, written.err);
  assert.equal(created.code, 0, created.err);

  const state = loadState(root).state;
  assert.equal(Object.values(state.projects).filter((project) => String(project.cwd).includes('/panel-')).length, 4);
  assert.ok(state.skills['skill-del-agente']);
});

test('una mutación real devuelve saved:true y persiste', () => {
  const root = tempRoot('lsc-t13-saved');
  const cwd = tempProject('proyecto', root);
  seed(root, cwd);

  const outcome = withState(root, (state) => {
    appendEvent(state, { type: 'prueba.saved', skillId: 'x' });
    return { ok: true };
  });

  assert.equal(outcome.saved, true);
  assert.ok(loadState(root).state.events.some((event) => event.type === 'prueba.saved'));
});

test('una mutación que no cambia nada devuelve saved:false y no escribe', () => {
  const root = tempRoot('lsc-t13-noop');
  const cwd = tempProject('proyecto', root);
  seed(root, cwd);
  const before = snapshot(root);

  const outcome = withState(root, () => ({ ok: true }));

  assert.equal(outcome.saved, false);
  const after = snapshot(root);
  assert.equal(after.mtime, before.mtime, 'un no-op no puede tocar el fichero');
  assert.equal(after.hash, before.hash);
});

test('una mutación que lanza no guarda nada y libera el candado', () => {
  const root = tempRoot('lsc-t13-lanza');
  const cwd = tempProject('proyecto', root);
  seed(root, cwd);
  const before = snapshot(root);

  assert.throws(() => withState(root, () => { throw new Error('boom'); }), /boom/);
  assert.equal(existsSync(`${centerFile(root)}.lock`), false, 'el candado se libera en finally');

  const after = snapshot(root);
  assert.equal(after.mtime, before.mtime, 'media operación escrita es peor que ninguna');
  assert.equal(after.events, before.events);

  // El siguiente que llega puede escribir: el candado no se quedó tomado.
  const next = withState(root, (state) => { appendEvent(state, { type: 'prueba.despues' }); });
  assert.equal(next.saved, true);
});

test('la firma canónica ignora sellos de tiempo pero no el contenido funcional', () => {
  const base = { schemaVersion: 1, updatedAt: '2026-01-01T00:00:00.000Z', skills: { a: { id: 'a', versions: [{ version: '1.0.0', body: 'hola' }] } }, events: [{ type: 'uno' }, { type: 'dos' }] };

  const sameOtherOrder = { events: [{ type: 'uno' }, { type: 'dos' }], skills: { a: { versions: [{ body: 'hola', version: '1.0.0' }], id: 'a' } }, updatedAt: '2030-12-31T23:59:59.000Z', schemaVersion: 1 };
  assert.equal(functionalSignature(base), functionalSignature(sameOtherOrder), 'claves desordenadas y updatedAt distinto no son un cambio');

  const reorderedEvents = { ...base, events: [{ type: 'dos' }, { type: 'uno' }] };
  assert.notEqual(functionalSignature(base), functionalSignature(reorderedEvents), 'el orden del diario sí es semántico');

  const changedBody = { ...base, skills: { a: { id: 'a', versions: [{ version: '1.0.0', body: 'adios' }] } } };
  assert.notEqual(functionalSignature(base), functionalSignature(changedBody), 'el cuerpo de una versión es funcional');
});
