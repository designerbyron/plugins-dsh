// Comprobación del producto: la lista que dice si el centro está sano. Cada prueba busca un estado real
// distinto, no una respuesta inventada: sin copia, con deriva, con candado, con documento ilegible.
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { API_PREFIX, doctorPayload, handleApiRequest, runAction } from '../lib/api.mjs';
import { ensureBackup, materializedRoot } from '../lib/state.mjs';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';

function seeded() {
  const root = autonomyRoot('doctor');
  const cwd = tempProject('doctor', autonomyRoot('doctor-cwd'));
  const created = runAction({ root, action: 'create', cwd, now: NOW, actor: 'ai', payload: candidate({ id: 'doctor-skill' }) });
  assert.equal(created.ok, true);
  return { root, cwd, created };
}

const statusOf = (report, id) => report.checks.find((check) => check.id === id)?.status;

test('un centro recién creado sale sano en lo esencial y avisa de lo que no tiene', () => {
  const { root } = seeded();
  const report = doctorPayload({ root, registry: { list: () => [] }, now: NOW });
  assert.equal(report.ok, true);
  assert.equal(statusOf(report, 'store-integrity'), 'ok');
  assert.equal(statusOf(report, 'schema-version'), 'ok');
  assert.equal(statusOf(report, 'lock'), 'ok');
  assert.equal(statusOf(report, 'events'), 'ok');
  assert.equal(statusOf(report, 'backup'), 'warn', 'sin copia todavía');
  assert.equal(report.counts.skills, 1);
});

test('con una copia autoritativa, la comprobación de copia pasa a ok', () => {
  const { root } = seeded();
  const backup = ensureBackup(root, { now: NOW, reason: 'manual' });
  assert.equal(backup.ok, true);
  const report = doctorPayload({ root, registry: { list: () => [] }, now: NOW });
  assert.equal(statusOf(report, 'backup'), 'ok');
});

test('si el materializado no coincide con lo encendido, hay aviso y dice cuántos', () => {
  const { root, cwd } = seeded();
  const opened = runAction({ root, action: 'open', cwd, now: NOW });
  runAction({ root, action: 'toggle', now: NOW, actor: 'human', payload: { projectId: opened.project.id, skillId: 'doctor-skill', enabled: true } });

  const clean = doctorPayload({ root, registry: { list: () => [] }, now: NOW });
  assert.equal(statusOf(clean, 'materialized'), 'ok');

  rmSync(materializedRoot(root), { recursive: true, force: true });
  const drifted = doctorPayload({ root, registry: { list: () => [] }, now: NOW });
  assert.equal(statusOf(drifted, 'materialized'), 'warn');
});

test('un candado vivo se reporta como aviso, no como fallo', () => {
  const { root } = seeded();
  writeFileSync(join(root, 'center.json.lock'), 'lock');
  const report = doctorPayload({ root, registry: { list: () => [] }, now: NOW });
  assert.equal(statusOf(report, 'lock'), 'warn');
  assert.equal(report.ok, true);
});

test('un documento ilegible es el único fallo que apaga el ok', () => {
  const { root } = seeded();
  writeFileSync(join(root, 'center.json'), '{"sector":');
  const report = doctorPayload({ root, registry: null, now: NOW });
  assert.equal(statusOf(report, 'store-integrity'), 'fail');
  assert.equal(report.ok, false);
  assert.equal(statusOf(report, 'identity-inventory'), 'warn', 'sin Host no hay inventario, y eso se dice');
});

test('con el servicio del Host resuelto, el inventario de identidad deja de avisar', () => {
  const { root } = seeded();
  const withRegistry = handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/doctor`, search: '', registry: { list: () => [{ id: 'ws-1' }, { id: 'ws-2' }] }, now: NOW });
  assert.equal(statusOf(withRegistry.body, 'identity-inventory'), 'ok');
  assert.equal(withRegistry.body.checks.find((check) => check.id === 'identity-inventory').detail, '2 workspace(s) del Host');
});

test('la ruta /doctor responde 200 y no escribe', () => {
  const { root } = seeded();
  mkdirSync(join(root, 'backups'), { recursive: true });
  const before = handleApiRequest({ root, method: 'GET', pathname: API_PREFIX, search: '?scan=0', now: NOW });
  const response = handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/doctor`, search: '', registry: { list: () => [] }, now: NOW });
  const after = handleApiRequest({ root, method: 'GET', pathname: API_PREFIX, search: '?scan=0', now: NOW });
  assert.equal(response.status, 200);
  assert.equal(response.body.checks.length >= 8, true);
  assert.equal(response.body.summary.fail, 0);
  assert.equal(after.body.integrity.sha256, before.body.integrity.sha256);
});
