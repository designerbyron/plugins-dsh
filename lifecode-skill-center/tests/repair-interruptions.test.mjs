import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { manifestBytes, newManifest, readManifest, repairManifest } from '../lib/manifest-ops.mjs';

const PROJECT = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
const NOW = '2026-11-09T03:59:11.645Z';

/** Workspace con un manifiesto inválido (rama A) o sin manifiesto (rama B). */
function workspace(mode) {
  const cwd = mkdtempSync(join(tmpdir(), `interrupt-${mode}-`));
  const dshRoot = join(cwd, '.dsh');
  mkdirSync(dshRoot, { recursive: true });
  const manifestPath = join(dshRoot, 'lifecode-skill-center.json');
  if (mode === 'invalid') writeFileSync(manifestPath, '{ roto', 'utf8');
  return { dshRoot, manifestPath };
}

const manifest = newManifest({ projectId: PROJECT, registeredAt: NOW });

/**
 * Interrumpe la reparación en el gancho indicado y comprueba que la siguiente pasada, sin ganchos, deja el
 * manifiesto publicado. Los puntos de interrupción se inyectan con los ganchos reales de la implementación,
 * así que un cambio de orden en la operación rompe esta prueba en vez de esconderse.
 */
function interruptsAt(hookName, mode) {
  test(`reparación (${mode}) interrumpida en ${hookName} se reanuda en la siguiente pasada`, () => {
    const ws = workspace(mode);
    let interrupted;
    try {
      interrupted = repairManifest({
        dshRoot: ws.dshRoot,
        manifestPath: ws.manifestPath,
        manifest,
        branch: mode,
        now: NOW,
        hooks: { [hookName]: () => { throw new Error(`interrupción en ${hookName}`); } },
      });
    } catch {
      // Un gancho puede lanzar fuera del alcance controlado; eso también es una interrupción real.
      interrupted = { ok: false, code: 'interrupted' };
    }
    // La interrupción se comunica como fallo cerrado o, si el corte ocurrió después del punto de
    // publicación (`afterLink`), como la publicación ya hecha: en ambos casos, una sola publicación.
    if (interrupted.ok === true) {
      assert.equal(typeof interrupted.resumed, 'boolean', `${hookName}: un éxito debe decir si reanudó`);
    } else {
      assert.equal(typeof interrupted.code, 'string');
    }

    const resumed = repairManifest({
      dshRoot: ws.dshRoot,
      manifestPath: ws.manifestPath,
      manifest,
      branch: mode,
      now: NOW,
    });
    assert.equal(resumed.ok, true, `${hookName}: ${resumed.code} · ${resumed.message}`);
    const published = readManifest(ws.manifestPath);
    assert.equal(published.status, 'ok');
    assert.equal(published.manifest.projectId, PROJECT);
    assert.equal(published.sha256, resumed.manifestSha256);
  });
}

// Ganchos reales de la operación: temporales, enlace de cuarentena y publicación.
for (const mode of ['invalid', 'missing']) {
  interruptsAt('afterTempWrite', mode);
  interruptsAt('afterTempSync', mode);
  interruptsAt('beforeLink', mode);
}
interruptsAt('afterQuarantine', 'invalid');
interruptsAt('afterDetach', 'invalid');
interruptsAt('afterLink', 'invalid');

test('la evidencia de una interrupción no se pierde ni se duplica al reanudar', () => {
  const ws = workspace('invalid');
  let cut;
  try {
    cut = repairManifest({
      dshRoot: ws.dshRoot,
      manifestPath: ws.manifestPath,
      manifest,
      branch: 'invalid',
      now: NOW,
      hooks: { afterQuarantine: () => { throw new Error('corte'); } },
    });
  } catch {
    cut = { ok: false, code: 'interrupted' };
  }
  assert.equal(cut.ok, false, 'la pasada interrumpida no puede darse por buena');
  // Tras el corte hay cuarentena y el canónico inválido sigue en su sitio: nada se ha perdido.
  const quarantines = readdirSync(ws.dshRoot).filter((name) => name.includes('manifest-invalid'));
  assert.equal(quarantines.length, 1);
  assert.equal(readFileSync(ws.manifestPath, 'utf8'), '{ roto');

  const resumed = repairManifest({ dshRoot: ws.dshRoot, manifestPath: ws.manifestPath, manifest, branch: 'invalid', now: NOW });
  assert.equal(resumed.ok, true, resumed.message);
  assert.equal(readdirSync(ws.dshRoot).filter((name) => name.includes('manifest-invalid')).length, 1, 'no duplica la cuarentena');
  assert.equal(readManifest(ws.manifestPath).manifest.projectId, PROJECT);
});

test('una trayectoria completa deja el workspace sin temporales ni bloqueos', () => {
  const ws = workspace('invalid');
  const result = repairManifest({ dshRoot: ws.dshRoot, manifestPath: ws.manifestPath, manifest, branch: 'invalid', now: NOW });
  assert.equal(result.ok, true, result.message);
  const leftovers = readdirSync(ws.dshRoot).filter((name) => name.startsWith('.lifecode-tmp-'));
  assert.deepEqual(leftovers, [], 'no quedan temporales ni candados');
});

test('el manifiesto publicado es exactamente el canónico, byte a byte', () => {
  const ws = workspace('missing');
  const result = repairManifest({ dshRoot: ws.dshRoot, manifestPath: ws.manifestPath, manifest, branch: 'missing', now: NOW });
  assert.equal(result.ok, true, result.message);
  const bytes = readFileSync(ws.manifestPath);
  assert.deepEqual(bytes, manifestBytes(manifest));
});
