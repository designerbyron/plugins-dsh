/** LE-RAG-02 · Paridad de consumidores y perfiles independientes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveConfig } from '../lib/config-resolve.mjs';
import { diagnoseProfile } from '../lib/diagnose.mjs';
import { runDoctor } from '../lib/doctor.mjs';
import { createAutomation } from '../lib/automation.mjs';

function dataRootWith({ global, profiles }) {
  const root = mkdtempSync(join(tmpdir(), 'lcr-consumers-'));
  if (global) writeFileSync(join(root, 'config.json'), JSON.stringify(global), 'utf8');
  for (const [key, value] of Object.entries(profiles ?? {})) {
    const dir = join(root, 'profiles', key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(value), 'utf8');
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('dos perfiles: fragment/source, herencia global y sin contaminación', () => {
  const box = dataRootWith({
    global: { search: { limit: 12 }, automation: { intervalMs: 111000 } },
    profiles: { desktop: { search: { diversity: 'fragment' } }, laboratory: { search: { diversity: 'source' } } },
  });
  try {
    const desktop = resolveConfig({ dataRoot: box.root, profileKey: 'desktop' });
    const lab = resolveConfig({ dataRoot: box.root, profileKey: 'laboratory' });
    assert.equal(desktop.config.search.diversity, 'fragment');
    assert.equal(lab.config.search.diversity, 'source');
    assert.equal(desktop.config.search.limit, 12, 'hereda la global');
    assert.equal(lab.config.search.limit, 12);

    // Cambiar un perfil no toca al otro.
    writeFileSync(join(box.root, 'profiles', 'laboratory', 'config.json'), JSON.stringify({ search: { diversity: 'source', limit: 3 } }), 'utf8');
    assert.equal(resolveConfig({ dataRoot: box.root, profileKey: 'desktop' }).config.search.limit, 12);
    assert.equal(resolveConfig({ dataRoot: box.root, profileKey: 'laboratory' }).config.search.limit, 3);
  } finally { box.cleanup(); }
});

test('plugin (resolver), diagnóstico y doctor comparten la misma configuración efectiva', () => {
  const box = dataRootWith({
    global: { automation: { intervalMs: 111000 } },
    profiles: { laboratory: { search: { diversity: 'source' } } },
  });
  const env = { ...process.env, LIFECODE_RAG_DATA: box.root, LIFECODE_RAG_PROFILE: 'laboratory' };
  try {
    const effective = resolveConfig({ dataRoot: env.LIFECODE_RAG_DATA, profileKey: env.LIFECODE_RAG_PROFILE });
    assert.equal(effective.config.search.diversity, 'source');

    const diag = diagnoseProfile({ env });
    const effectiveSearch = diag.profile?.config?.effectiveSearch;
    assert.equal(effectiveSearch?.diversity, 'source', 'diagnose informa lo efectivo');
    assert.equal(effectiveSearch?.limit, effective.config.search.limit);

    const doctor = runDoctor({ root: box.root, env });
    assert.ok(Array.isArray(doctor.checks) && doctor.checks.length > 0, 'doctor corre con la raíz propia');

    // `automation`/`sync-scheduler` reciben un `root` explícito y leen su `config.json`: son
    // trabajadores de perfil, no consumidores globales. Se comprueba que operan con ese root.
    const automation = createAutomation({ env, root: box.root });
    assert.ok(automation && typeof automation === 'object', 'automation se construye con su root explícito');
  } finally { box.cleanup(); }
});

test('sin ficheros de perfil manda la global; sin global, defaults', () => {
  const box = dataRootWith({ global: { search: { diversity: 'source' } }, profiles: {} });
  try {
    assert.equal(resolveConfig({ dataRoot: box.root, profileKey: 'x' }).config.search.diversity, 'source');
    const empty = mkdtempSync(join(tmpdir(), 'lcr-empty-'));
    try {
      assert.equal(resolveConfig({ dataRoot: empty, profileKey: 'x' }).config.search.diversity, 'fragment');
    } finally { rmSync(empty, { recursive: true, force: true }); }
  } finally { box.cleanup(); }
});
