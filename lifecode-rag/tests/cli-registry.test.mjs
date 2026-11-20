/**
 * CLI de registro: crear proyecto, autorizar raíz y fijar la selección de una sesión.
 * Todo ocurre en una raíz temporal (`LIFECODE_RAG_ROOT`); nunca toca el perfil real.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dirname, '..', 'bin', 'lifecode-rag.mjs');

function box() {
  const root = mkdtempSync(join(tmpdir(), 'lcr-cli-'));
  const docs = join(root, 'docs');
  mkdirSync(docs, { recursive: true });
  return { root, docs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(boxed, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LIFECODE_RAG_ROOT: join(boxed.root, 'profile'), DSH_PROFILE: 'cli-test' },
  });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { json = null; }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

test('project create | list, root add, select y session show', () => {
  const boxed = box();
  try {
    const created = run(boxed, ['project', 'create', '--name', 'Proyecto CLI', '--create']);
    assert.equal(created.code, 0);
    assert.match(created.json.project.id, /^prj_/);

    const listed = run(boxed, ['project', 'list']);
    assert.equal(listed.code, 0);
    assert.equal(listed.json.projects, 1);

    const root = run(boxed, ['root', 'add', '--project', created.json.project.id, '--path', boxed.docs]);
    assert.equal(root.code, 0);
    assert.equal(root.json.root.scopeId, created.json.project.id);
    assert.ok(root.json.root.pathKey.endsWith('/docs'));

    const roots = run(boxed, ['root', 'list']);
    assert.equal(roots.json.roots, 1);

    const selected = run(boxed, ['select', '--session', 'sesion-1', '--project', created.json.project.id]);
    assert.equal(selected.code, 0);
    assert.equal(selected.json.created, true);
    assert.equal(selected.json.selection.source, 'explicit');
    assert.equal(selected.json.selection.by, 'human');

    const again = run(boxed, ['select', '--session', 'sesion-1', '--project', created.json.project.id]);
    assert.equal(again.json.created, false, 'repetir la misma selección es idempotente');
    assert.equal(again.json.selection.revision, 1);

    const shown = run(boxed, ['session', 'show', '--session', 'sesion-1']);
    assert.equal(shown.code, 0);
    assert.equal(shown.json.session.project_id, created.json.project.id);
    assert.equal(shown.json.session.state, 'active');
  } finally {
    boxed.cleanup();
  }
});

test('errores: proyecto inexistente, raíz duplicada y sesión desconocida', () => {
  const boxed = box();
  try {
    const created = run(boxed, ['project', 'create', '--name', 'P', '--create']);
    const projectId = created.json.project.id;

    const missing = run(boxed, ['root', 'add', '--project', 'prj_noexiste', '--path', boxed.docs]);
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /no existe el proyecto/);

    assert.equal(run(boxed, ['root', 'add', '--project', projectId, '--path', boxed.docs]).code, 0);
    const duplicate = run(boxed, ['root', 'add', '--project', projectId, '--path', boxed.docs]);
    assert.notEqual(duplicate.code, 0, 'la misma raíz no se registra dos veces');

    const unknown = run(boxed, ['session', 'show', '--session', 'sesion-fantasma']);
    assert.equal(unknown.code, 1);
    assert.equal(unknown.json.session, null);

    const badSelect = run(boxed, ['select', '--session', 's', '--project', 'prj_noexiste']);
    assert.notEqual(badSelect.code, 0);
  } finally {
    boxed.cleanup();
  }
});

test('sin --create no inventa un perfil', () => {
  const boxed = box();
  try {
    const result = run(boxed, ['project', 'list']);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /registro no disponible/);
  } finally {
    boxed.cleanup();
  }
});
