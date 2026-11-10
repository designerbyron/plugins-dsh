// Regresiones de los tres defectos **altos** que la auditoría de identidad v3 midió y no corrigió.
//
// La suite `identity-v3.test.mjs` documenta el comportamiento correcto de las diez operaciones; esta se
// centra en las tres formas de dañar un proyecto que encontró el auditor, para que no vuelvan:
//   D4 — `repairManifest` rama A adoptaba una cuarentena ajena y borraba un manifiesto **válido**.
//   D5 — `detachManifest` archivaba y borraba un archivo **fuera** del `.dsh` del workspace.
//   D6 — `forkProjectManifest` borraba el manifiesto de origen sin comprobar contención.
//
// Todo ocurre en fixtures: el almacén real no se abre y se mide antes y después por si acaso.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import {
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
  detachManifest,
  forkProjectManifest,
  manifestBytes,
  readManifest,
  repairManifest,
  sha256Hex,
} from '../lib/manifest-ops.mjs';
import { FILE_KINDS, basenameProblem } from '../lib/paths.mjs';

const NOW = '2026-11-09T03:59:11.645Z';
const UUID = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
const OTHER = '9b8c7d6e-5f40-4a31-82b9-0c1d2e3f4a5b';

const TEMP_DIRS = [];
function tempDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `lsc-guards-${label}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

function workspace(label) {
  const dir = tempDir(`ws-${label}`);
  const dsh = join(dir, '.dsh');
  mkdirSync(dsh, { recursive: true });
  return { dir, dsh, manifestPath: join(dsh, 'lifecode-skill-center.json') };
}

function manifestBytesOf(projectId) {
  return manifestBytes({ schema: MANIFEST_SCHEMA, schemaVersion: MANIFEST_SCHEMA_VERSION, projectId, registeredAt: NOW });
}

function fingerprint(path) {
  try {
    const bytes = readFileSync(path);
    return { size: bytes.length, sha256: sha256Hex(bytes) };
  } catch {
    return null;
  }
}

/** Huella del almacén real del usuario, para demostrar que estas pruebas no lo tocan. */
function realStoreFingerprint() {
  const path = join(homedir(), '.dsh', 'lifecode-skill-center');
  const read = (name) => {
    try {
      return createHash('sha256').update(readFileSync(join(path, name))).digest('hex');
    } catch {
      return 'missing';
    }
  };
  try {
    const names = readdirSync(path).sort().join(',');
    return { center: read('center.json'), knowledge: read('knowledge.json'), names };
  } catch {
    return { center: 'missing', knowledge: 'missing', names: '' };
  }
}

const realBefore = realStoreFingerprint();

after(() => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // el temporal se deja al sistema si está en uso
    }
  }
  assert.deepEqual(realStoreFingerprint(), realBefore, 'estas pruebas no pueden tocar el almacén real');
});

/** Nombre de cuarentena con el prefijo de la huella de su propio contenido. */
function quarantineNameFor(bytes, stamp = '20261109T035911Z') {
  const name = `lifecode-skill-center.manifest-invalid-${stamp}-${sha256Hex(bytes).slice(0, 8)}.json`;
  assert.equal(basenameProblem(name, FILE_KINDS.quarantineManifest).ok, true, `nombre de cuarentena inválido: ${name}`);
  return name;
}

test('D4: la rama A no sustituye un manifiesto válido por una cuarentena ajena', () => {
  const ws = workspace('d4');
  const canonical = manifestBytesOf(UUID);
  writeFileSync(ws.manifestPath, canonical);
  const canonicalBefore = fingerprint(ws.manifestPath);

  // Cuarentena con un manifiesto **válido** de otro proyecto, con nombre bien formado.
  const foreign = manifestBytesOf(OTHER);
  const quarantineName = quarantineNameFor(foreign);
  writeFileSync(join(ws.dsh, quarantineName), foreign);

  const result = repairManifest({ dshRoot: ws.dsh, manifestPath: ws.manifestPath, manifest: JSON.parse(manifestBytesOf(OTHER).toString('utf8')), branch: 'invalid', now: NOW });

  assert.equal(result.ok, false, 'reparar un manifiesto válido no puede salir bien');
  assert.equal(result.code, 'repair-branch-mismatch');
  assert.deepEqual(fingerprint(ws.manifestPath), canonicalBefore, 'el manifiesto válido queda byte a byte igual');
  assert.deepEqual(fingerprint(join(ws.dsh, quarantineName)), { size: foreign.length, sha256: sha256Hex(foreign) }, 'la cuarentena no se toca');
});

test('D4: tampoco si la cuarentena declara el mismo proyecto (sigue sin haber nada que reparar)', () => {
  const ws = workspace('d4b');
  const canonical = manifestBytesOf(UUID);
  writeFileSync(ws.manifestPath, canonical);
  const canonicalBefore = fingerprint(ws.manifestPath);

  const sameProject = manifestBytesOf(UUID);
  const quarantineName = quarantineNameFor(sameProject);
  writeFileSync(join(ws.dsh, quarantineName), sameProject);

  const result = repairManifest({ dshRoot: ws.dsh, manifestPath: ws.manifestPath, manifest: JSON.parse(manifestBytesOf(OTHER).toString('utf8')), branch: 'invalid', now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'repair-branch-mismatch');
  assert.deepEqual(fingerprint(ws.manifestPath), canonicalBefore);
});

test('D5: retirar un ancla fuera del workspace se rechaza y no borra nada', () => {
  const ws = workspace('d5');
  const outside = tempDir('externo');
  const externalFile = join(outside, 'lifecode-skill-center.json');
  const bytes = manifestBytesOf(UUID);
  writeFileSync(externalFile, bytes);
  const before = fingerprint(externalFile);

  const result = detachManifest({ dshRoot: ws.dsh, manifestPath: externalFile, now: NOW });

  assert.equal(result.ok, false, 'el ancla externa no se puede retirar');
  assert.match(String(result.code), /^path-/u, `código de ruta esperado, fue ${result.code}`);
  assert.deepEqual(fingerprint(externalFile), before, 'el archivo externo sigue intacto');
  assert.equal(existsSync(externalFile), true);
  // Y no deja evidencia dentro del workspace de un proyecto ajeno.
  assert.deepEqual(readdirSync(ws.dsh).filter((name) => name.startsWith('lifecode-skill-center.manifest-')), []);
});

test('D6: el fork se niega a archivar y borrar un manifiesto de origen externo', () => {
  const ws = workspace('d6');
  const outside = tempDir('externo-fork');
  const externalFile = join(outside, 'lifecode-skill-center.json');
  const bytes = manifestBytesOf(UUID);
  writeFileSync(externalFile, bytes);
  const before = fingerprint(externalFile);

  const result = forkProjectManifest({ dshRoot: ws.dsh, manifestPath: externalFile, manifest: JSON.parse(manifestBytesOf(OTHER).toString('utf8')), now: NOW });

  assert.equal(result.ok, false, 'el fork de un origen externo no puede salir bien');
  assert.match(String(result.code), /^path-/u, `código de ruta esperado, fue ${result.code}`);
  assert.deepEqual(fingerprint(externalFile), before, 'el manifiesto de origen sigue intacto');
  assert.equal(existsSync(join(ws.dsh, 'lifecode-skill-center.fork-intent.json')), false, 'no se escribe intención de un fork rechazado');
});

test('control: las tres operaciones siguen funcionando dentro del workspace', () => {
  const ws = workspace('ok');
  const bytes = manifestBytesOf(UUID);
  writeFileSync(ws.manifestPath, bytes);

  const detached = detachManifest({ dshRoot: ws.dsh, manifestPath: ws.manifestPath, now: NOW });
  assert.equal(detached.ok, true, `detach dentro del workspace: ${detached.code ?? ''}`);
  assert.equal(existsSync(ws.manifestPath), false);

  const repaired = repairManifest({ dshRoot: ws.dsh, manifestPath: ws.manifestPath, manifest: JSON.parse(bytes.toString('utf8')), branch: 'missing', now: NOW });
  assert.equal(repaired.ok, true, `reparar una ausencia dentro del workspace: ${repaired.code ?? ''}`);
  assert.equal(readManifest(ws.manifestPath).sha256, sha256Hex(bytes));
});
