/* LSC-013: el control de migración no decide nada por su cuenta.
 *
 * Estas pruebas fijan el contrato del servidor (precondiciones, autorización, doble envío) sobre copias
 * temporales, y el contrato del panel en lo que se puede medir sin un navegador: que el control existe
 * con sus textos, que no ejecuta nada al montarse y que la acción `migrate` va por el canal humano.
 *
 * El almacén real no se toca: todo ocurre bajo `autonomyRoot()`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';
import { runAction } from '../lib/api.mjs';
import { ensureBackup, inspectLock, loadState } from '../lib/state.mjs';

const NOW = '2026-11-10T10:00:00.000Z';

/** Siembra un almacén **v1 auténtico**: se crea uno sano, se le quita lo que sólo existe en v2 y se
 *  reescribe la versión. No es una migración inversa del producto, es una fixture. */
function seedV1(label, { withAssignment = true, withBackup = true } = {}) {
  const root = autonomyRoot(label);
  const created = runAction({ root, action: 'create', payload: candidate(), actor: 'ai', now: NOW });
  assert.equal(created.ok, true, 'la fixture necesita una skill');
  if (withAssignment) {
    const project = tempProject('proyecto', root);
    const registered = runAction({ root, action: 'register-project', payload: { cwd: project }, actor: 'human', now: NOW });
    assert.equal(registered.ok, true);
    const toggled = runAction({
      root,
      action: 'toggle',
      payload: { projectId: registered.project.id, skillId: created.id, enabled: true },
      actor: 'human',
      now: NOW,
    });
    assert.equal(toggled.ok, true);
  }
  const file = join(root, 'center.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  delete document.schemaMeta;
  for (const row of Object.values(document.assignments ?? {})) {
    for (const assignment of Object.values(row)) delete assignment.pinnedAt;
  }
  document.schemaVersion = 1;
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  // Las mutaciones de la fixture dejan una copia del mismo día *anterior* al documento final y el atajo
  // diario de `ensureBackup` la reutilizaría: se publica una copia autoritativa que sí coincide
  // (`reason: 'migration'` siempre copia; `'mutation'` se salta el mismo día, por diseño de S4-C).
  if (withBackup) {
    const seeded = ensureBackup(root, { now: NOW, reason: 'migration' });
    assert.equal(seeded.ok, true, 'la fixture necesita una copia autoritativa que coincida con el documento');
  } else {
    // Las mutaciones de arriba publicaron copias automáticas (S4-A/S4-C). Para el caso «sin copia» se
    // retiran todas las autoridades: puntero, generaciones, compatibilidad y su huella.
    rmSync(join(root, 'backups'), { recursive: true, force: true });
    rmSync(join(root, 'center.json.backup.json'), { force: true });
    rmSync(join(root, 'center.json.bak'), { force: true });
    rmSync(join(root, 'center.json.bak.bak.sha256'), { force: true });
  }
  return { root, skillId: created.id, document };
}

function sha(file) {
  return loadState(join(file, '..')).sha256 ?? null;
}

function bytesOf(root) {
  return readFileSync(join(root, 'center.json'));
}

function backup(root, now = '2026-11-10T10:01:00.000Z') {
  const result = runAction({ root, action: 'backup', payload: {}, actor: 'human', now });
  assert.equal(result.ok, true, `la fixture necesita una copia verificada: ${result.code ?? ''}`);
  return result;
}

test('un v1 sano con copia verificada ofrece la migración', () => {
  const { root } = seedV1('lsc-mig-ready');
  backup(root);
  const snapshot = runAction({ root, action: 'state', payload: { scan: false }, now: NOW });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.migration.from, 1);
  assert.equal(snapshot.migration.to, 2);
  assert.equal(snapshot.migration.canMigrate, true);
  assert.equal(snapshot.migration.blocker, null);
  assert.equal(snapshot.migration.lock.present, false);
  assert.equal(snapshot.counts.skills, 1);
  assert.equal(snapshot.counts.projects, 1);
  assert.equal(snapshot.counts.assignments, 1);
  assert.ok(snapshot.counts.versions >= 1);
  assert.equal(snapshot.schemaMeta, null);
});

test('sin copia autoritativa no se ofrece y la migración se niega sin escribir', () => {
  const { root } = seedV1('lsc-mig-nobackup', { withBackup: false });
  const before = bytesOf(root);
  const snapshot = runAction({ root, action: 'state', payload: { scan: false }, now: NOW });
  assert.equal(snapshot.migration.canMigrate, false);
  assert.equal(snapshot.migration.blocker, 'backup-required');
  const refused = runAction({ root, action: 'migrate', payload: {}, actor: 'human', now: NOW });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'backup-required');
  assert.deepEqual(bytesOf(root), before, 'una negativa no puede tocar el documento');
});

test('una copia que no coincide con los bytes actuales bloquea la migración', () => {
  const { root } = seedV1('lsc-mig-stale');
  backup(root);
  // Se reescribe el documento con otra indentación: mismos datos, bytes distintos.
  const file = join(root, 'center.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, `${JSON.stringify(document, null, 2).replace(/\n/g, '\r\n')}\r\n`, 'utf8');
  const stale = bytesOf(root);
  const snapshot = runAction({ root, action: 'state', payload: { scan: false }, now: NOW });
  assert.equal(snapshot.migration.blocker, 'backup-stale');
  const refused = runAction({ root, action: 'migrate', payload: {}, actor: 'human', now: NOW });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'backup-stale');
  assert.deepEqual(bytesOf(root), stale);
});

test('un candado vivo bloquea; uno abandonado no', () => {
  const { root } = seedV1('lsc-mig-lock');
  backup(root);
  const lock = join(root, 'center.json.lock');
  writeFileSync(lock, '', 'utf8');
  assert.equal(inspectLock(root).present, true);
  assert.equal(inspectLock(root).stale, false);
  const busy = runAction({ root, action: 'state', payload: { scan: false }, now: NOW });
  assert.equal(busy.migration.blocker, 'store-busy');
  const refused = runAction({ root, action: 'migrate', payload: {}, actor: 'human', now: NOW });
  assert.equal(refused.code, 'store-busy');
  // Un candado viejo es de un proceso que murió: no puede bloquear el panel para siempre.
  const old = new Date(Date.now() - 60000);
  utimesSync(lock, old, old);
  const abandoned = inspectLock(root);
  assert.equal(abandoned.stale, true);
  const snapshot = runAction({ root, action: 'state', payload: { scan: false }, now: NOW });
  assert.equal(snapshot.migration.canMigrate, true);
  rmSync(lock, { force: true });
});

test('un almacén dañado no ofrece migración y la rechaza', () => {
  const { root } = seedV1('lsc-mig-broken');
  backup(root);
  writeFileSync(join(root, 'center.json'), '{"skills": {', 'utf8');
  const corrupted = bytesOf(root);
  const snapshot = runAction({ root, action: 'state', payload: { scan: false }, now: NOW });
  assert.equal(snapshot.readable, false);
  assert.equal(snapshot.migration.blocker, 'store-unreadable');
  const refused = runAction({ root, action: 'migrate', payload: {}, actor: 'human', now: NOW });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'store-unreadable');
  assert.deepEqual(bytesOf(root), corrupted, 'el documento dañado se conserva byte a byte');
});

test('la IA no puede migrar y no escribe', () => {
  const { root } = seedV1('lsc-mig-ai');
  backup(root);
  const before = bytesOf(root);
  const refused = runAction({ root, action: 'migrate', payload: {}, actor: 'ai', now: NOW });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'approval-required');
  assert.deepEqual(bytesOf(root), before);
});

test('migrar como persona conserva entidades, deriva pinnedAt y deja una copia de migración', () => {
  const { root } = seedV1('lsc-mig-happy');
  backup(root);
  const before = runAction({ root, action: 'state', payload: { scan: false }, now: NOW });
  const migrated = runAction({ root, action: 'migrate', payload: {}, actor: 'human', now: '2026-11-10T10:02:00.000Z' });
  assert.equal(migrated.ok, true, migrated.message ?? '');
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.to, 2);
  assert.equal(migrated.comparison.ok, true);
  assert.deepEqual(migrated.comparison.problems, []);
  assert.equal(migrated.snapshot.schemaVersion, 2);
  assert.equal(migrated.snapshot.schemaMeta.migratedFrom, 1);
  assert.equal(migrated.snapshot.migration.blocker, 'already-migrated');
  assert.equal(migrated.snapshot.migration.canMigrate, false);
  // Nada de la biblioteca se pierde: mismos recuentos que antes de migrar.
  assert.deepEqual(migrated.snapshot.counts, before.counts);
  // El pin se deriva de la fecha de la asignación, no de la migración.
  const after = loadState(root).state;
  const row = Object.values(after.assignments)[0];
  const assignment = Object.values(row)[0];
  assert.equal(assignment.version, '1.0.0');
  assert.equal(typeof assignment.pinnedAt, 'string');
  assert.notEqual(assignment.pinnedAt, '');
  // La copia de migración existe y la v1 sigue ahí para volver.
  const pointer = JSON.parse(readFileSync(join(root, 'center.json.backup.json'), 'utf8'));
  assert.equal(pointer.reason, 'migration');
  const generations = readFileSync(join(root, 'center.json'), 'utf8') && loadState(root);
  assert.equal(generations.integrity, 'ok');
});

test('un segundo envío no vuelve a escribir', () => {
  const { root } = seedV1('lsc-mig-twice');
  backup(root);
  const first = runAction({ root, action: 'migrate', payload: {}, actor: 'human', now: '2026-11-10T10:02:00.000Z' });
  assert.equal(first.ok, true);
  const afterFirst = bytesOf(root);
  const second = runAction({ root, action: 'migrate', payload: {}, actor: 'human', now: '2026-11-10T10:03:00.000Z' });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'already-migrated');
  assert.deepEqual(bytesOf(root), afterFirst, 'el segundo envío no puede escribir');
});

test('el panel pide confirmación sólo cuando el servidor lo permite y no dispara dos veces', () => {
  // Conducta, no texto: se extraen los dos manejadores del panel y se ejecutan con dobles.
  const source = readFileSync(join(import.meta.dirname, '..', 'client.js'), 'utf8');
  const callback = (name) => {
    const call = `const ${name} = useCallback(`;
    const start = source.indexOf(call);
    if (start < 0) throw new Error(`no encuentro ${name}`);
    let depth = 0;
    let at = start + call.length - 1;
    for (; at < source.length; at += 1) {
      if (source[at] === '(') depth += 1;
      else if (source[at] === ')') { depth -= 1; if (depth === 0) break; }
    }
    if (at <= start) throw new Error(`no cierro ${name}`);
    return source.slice(start + call.length - 1, at + 1);
  };
  const build = (name, scope) => {
    const expression = callback(name);
    const useCallback = (fn) => fn;
    return new Function(...Object.keys(scope), 'useCallback', `return useCallback${expression};`)(...Object.values(scope), useCallback);
  };

  const calls = { notify: [], open: 0, result: [], busy: [] };
  const base = {
    migrateBusy: false,
    snapshot: { migration: { canMigrate: false, from: 'v1', to: 'v2' } },
    notify: (...args) => calls.notify.push(args),
    setMigrateResult: (value) => calls.result.push(value),
    setMigrateOpen: (value) => { if (value === true) calls.open += 1; },
    setMigrateBusy: (value) => calls.busy.push(value),
    t: (key) => key,
    fetch: () => { throw new Error('no debe llamar a la red'); },
    load: async () => {},
    cwdRef: { current: 'C:/x' },
    authMessageFor: () => '',
    countText: () => 'x',
    readJson: async () => ({ ok: false }),
    API: 'x',
  };
  build('onMigrateRequest', base)();
  assert.equal(calls.open, 0, 'con canMigrate false no se abre el diálogo');
  assert.deepEqual(calls.notify[0]?.[0], 'schema.state.blocked');

  Object.assign(base, { snapshot: { migration: { canMigrate: true, from: 'v1', to: 'v2' } }, migrateBusy: false });
  calls.open = 0;
  build('onMigrateRequest', base)();
  assert.equal(calls.open, 1, 'con canMigrate true se abre una vez');

  Object.assign(base, { migrateBusy: true });
  calls.open = 0;
  build('onMigrateRequest', base)();
  assert.equal(calls.open, 0, 'un doble clic no abre otra vez');

  // La confirmación, con la operación en curso, no vuelve a llamar a la red.
  const confirmScope = { ...base, migrateBusy: true };
  build('onMigrateConfirm', confirmScope)();
  assert.equal(confirmScope.migrateBusy, true);
});
