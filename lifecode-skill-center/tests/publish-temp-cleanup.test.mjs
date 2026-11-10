// D3 · Una publicación fallida no debe dejar su temporal en el `.dsh`.
//
// El temporal propio existe para publicar de forma exclusiva; si la publicación no ocurre, su contenido no es
// evidencia de nada y sólo ensucia el workspace. La excepción deliberada es el `temp-exists` de otra pasada:
// ese contenido sí permite reanudar y se conserva.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { MANIFEST_SCHEMA, MANIFEST_SCHEMA_VERSION, manifestBytes, publishExclusive } from '../lib/manifest-ops.mjs';

const TEMP_DIRS = [];
function workspace(label) {
  const dir = mkdtempSync(join(tmpdir(), 'lsc-d3-' + label + '-'));
  TEMP_DIRS.push(dir);
  const dsh = join(dir, '.dsh');
  mkdirSync(dsh, { recursive: true });
  return { dir, dsh, manifestPath: join(dsh, 'lifecode-skill-center.json') };
}

after(() => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // queda al sistema
    }
  }
});

const bytes = manifestBytes({
  schema: MANIFEST_SCHEMA,
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  projectId: '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607',
  registeredAt: '2026-11-09T03:59:11.645Z',
});

function ownTemps(dsh) {
  return readdirSync(dsh).filter((name) => name.startsWith('.lifecode-tmp-'));
}

test('D3: el fallo por destino existente no deja el temporal', () => {
  const ws = workspace('exists');
  writeFileSync(ws.manifestPath, 'algo que ya estaba');
  const result = publishExclusive({ path: ws.manifestPath, bytes, dshRoot: ws.dsh });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'exists');
  assert.deepEqual(ownTemps(ws.dsh), [], 'no puede quedar el temporal de una publicación fallida');
});

test('D3: el fallo de verificación del temporal lo retira', () => {
  const ws = workspace('mismatch');
  // El filesystem inyectado devuelve bytes distintos al releer el temporal: simula la verificación fallida.
  const fs = {
    readFileSync: (target, ...rest) => {
      if (String(target).includes('.lifecode-tmp-')) return Buffer.from('contenido manipulado');
      return readFileSync(target, ...rest);
    },
  };
  const result = publishExclusive({ path: ws.manifestPath, bytes, dshRoot: ws.dsh, fs });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'temp-mismatch');
  assert.deepEqual(ownTemps(ws.dsh), [], 'el temporal manipulado no se queda en el .dsh');
});

test('control: la publicación correcta no deja temporales y el destino existe', () => {
  const ws = workspace('ok');
  const result = publishExclusive({ path: ws.manifestPath, bytes, dshRoot: ws.dsh });
  assert.equal(result.ok, true, result.code ?? '');
  assert.deepEqual(ownTemps(ws.dsh), []);
  assert.equal(readdirSync(ws.dsh).includes('lifecode-skill-center.json'), true);
});
