// Identidad de proyectos v3, verificada **sólo sobre fixtures**.
//
// La migración productiva v2→v3 está reservada a una persona: aquí no se migra nada. Cada almacén nace en
// una carpeta temporal y el almacén real se mide antes y después para demostrar que esta suite no lo toca.
// Las pruebas se apoyan en los contratos reales de `lib/`; no se modifica el producto.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { IDENTITY_ACTIONS, identityPayload, runAction } from '../lib/api.mjs';
import {
  AUDIT,
  IDENTITY_STATES,
  INVENTORY,
  UNIQUENESS,
  VERIFICATION,
  buildIdentityView,
  classifyWorkspace,
} from '../lib/identity.mjs';
import {
  MANIFEST_FIELDS,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
  archivedManifestName,
  detachManifest,
  forkProjectManifest,
  manifestBytes,
  publishExclusive,
  readJsonArtifact,
  readManifest,
  repairManifest,
  sha256Hex,
  validateManifest,
} from '../lib/manifest-ops.mjs';
import {
  FILE_KINDS,
  PATH_CODES,
  basenameProblem,
  checkExistingFile,
  checkProjectedFile,
} from '../lib/paths.mjs';
import { centerFile, emptyState, loadState, saveState } from '../lib/state.mjs';

const NOW = '2026-11-09T03:59:11.645Z';
const UUID = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
const OTHER = '9b8c7d6e-5f40-4a31-82b9-0c1d2e3f4a5b';
const THIRD = '11111111-2222-4333-8444-555555555555';
const MISSING_HASH = 'a'.repeat(64);

const TEMP_DIRS = [];

/** Carpeta temporal propia, registrada para limpiarla al final. */
function tempDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `lsc-i3-${label}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

/** Almacén del centro en una caja de arena; v3 por omisión porque es la política que se verifica. */
function store(label, schemaVersion = 3) {
  const root = tempDir(`store-${label}`);
  saveState(root, { ...emptyState(NOW), schemaVersion }, { now: NOW });
  return root;
}

/** Proyecto temporal con su `.dsh`, sin manifiesto salvo que la prueba lo escriba. */
function workspace(label) {
  const dir = tempDir(`ws-${label}`);
  const dsh = join(dir, '.dsh');
  mkdirSync(dsh, { recursive: true });
  return { dir, dsh, manifestPath: join(dsh, 'lifecode-skill-center.json') };
}

function manifestSubject(projectId = UUID, registeredAt = NOW) {
  return {
    schema: MANIFEST_SCHEMA,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    projectId,
    registeredAt,
  };
}

function manifestOf(projectId = UUID, registeredAt = NOW) {
  return manifestBytes(manifestSubject(projectId, registeredAt));
}

/** Escribe bytes en el nombre canónico y devuelve su huella. */
function putManifest(ws, bytes) {
  writeFileSync(ws.manifestPath, bytes);
  return sha256Hex(bytes);
}

function putValidManifest(ws, projectId = UUID, registeredAt = NOW) {
  const bytes = manifestOf(projectId, registeredAt);
  return { bytes, sha256: putManifest(ws, bytes) };
}

function fingerprint(path) {
  try {
    const bytes = readFileSync(path);
    return { size: bytes.length, sha256: sha256Hex(bytes) };
  } catch {
    return null;
  }
}

function register(root, id, cwd, extra = {}) {
  const state = loadState(root).state;
  state.projects[id] = { id, name: id, cwd, createdAt: NOW, updatedAt: NOW, note: '', ...extra };
  saveState(root, state, { now: NOW });
}

function registryOf(entries) {
  return {
    list: () =>
      entries.map((entry, index) => ({
        id: entry.id ?? `ws-${index}`,
        path: entry.path,
        title: entry.title ?? `w${index}`,
        status: async () => entry.status ?? 'ok',
      })),
  };
}

function normalizePath(path) {
  return String(path).replaceAll('\\', '/').toLowerCase();
}

function itemFor(view, dir) {
  const found = view.items.find((item) => normalizePath(item.path) === normalizePath(dir));
  assert.ok(found, `la vista no incluye la fila de ${dir}`);
  return found;
}

/** Lo que el clasificador recibe de una ruta ya inspeccionada en disco. */
function observation(ws, { record = null, availability = 'ok', path = ws.dir } = {}) {
  const read = readManifest(ws.manifestPath);
  const manifest =
    read.status === 'ok'
      ? { status: 'ok', projectId: read.projectId, sha256: read.sha256 }
      : { status: read.status, ...(read.sha256 === undefined ? {} : { sha256: read.sha256 }) };
  return {
    workspaceId: 'w',
    path,
    availability,
    record,
    manifest,
    archive: { status: 'missing' },
    marker: { status: 'missing' },
    intent: { status: 'missing' },
    inspected: true,
    inspectionError: null,
    pathMissingConfirmed: false,
    oldPathIndeterminate: false,
  };
}

after(() => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Una carpeta temporal que no se deja borrar no invalida la medición.
    }
  }
});

// ---------------------------------------------------------------------------------------------------
// 1 · Bytes canónicos y validación
// ---------------------------------------------------------------------------------------------------

test('I3-01 · manifestBytes fija el orden, el formato y descarta campos ajenos al esquema', () => {
  const manifest = { registeredAt: NOW, projectId: UUID, schemaVersion: 1, schema: MANIFEST_SCHEMA };
  const bytes = manifestBytes(manifest);
  const text = bytes.toString('utf8');
  assert.equal(
    text,
    `{\n  "schema": "${MANIFEST_SCHEMA}",\n  "schemaVersion": 1,\n  "projectId": "${UUID}",\n  "registeredAt": "${NOW}"\n}\n`,
  );
  assert.equal(bytes.length, 171);
  assert.equal(sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(MANIFEST_FIELDS, ['schema', 'schemaVersion', 'projectId', 'registeredAt']);

  // `manifestBytes` sólo serializa los cuatro campos; el rechazo del campo extra lo hace el validador.
  assert.equal(manifestBytes({ ...manifest, extra: 'no pertenece' }).toString('utf8'), text);
});

test('I3-02 · validateManifest rechaza corrupción, campos extra, identidad inválida y esquema futuro', () => {
  const valid = validateManifest(manifestSubject());
  assert.equal(valid.status, 'ok');
  assert.equal(valid.projectId, UUID);
  assert.equal(valid.registeredAt, NOW);

  for (const value of [null, [], 'manifiesto', 42]) {
    assert.equal(validateManifest(value).reason, 'manifest-not-an-object');
  }

  assert.equal(validateManifest({ ...manifestSubject(), extra: 1 }).reason, 'unknown-field:extra');
  assert.equal(validateManifest({ ...manifestSubject(), schema: 'otro/esquema' }).reason, 'manifest-schema');
  assert.equal(validateManifest({ ...manifestSubject(), schemaVersion: 1.5 }).reason, 'manifest-schema-version');
  assert.equal(validateManifest({ ...manifestSubject(), schemaVersion: 0 }).reason, 'manifest-schema-version-old');
  assert.equal(validateManifest({ ...manifestSubject(), schemaVersion: 2 }).status, 'future');
  assert.equal(validateManifest({ ...manifestSubject(), schemaVersion: 2 }).reason, 'manifest-schema-version:2');
  assert.equal(validateManifest({ ...manifestSubject(), projectId: UUID.toUpperCase() }).reason, 'manifest-project-id');
  assert.equal(validateManifest({ ...manifestSubject(), projectId: THIRD.replace('-4', '-5') }).reason, 'manifest-project-id');
  assert.equal(validateManifest({ ...manifestSubject(), registeredAt: '2026-11-09T03:59:11Z' }).reason, 'manifest-registered-at');
  assert.equal(validateManifest({ ...manifestSubject(), registeredAt: 'ayer' }).reason, 'manifest-registered-at');
});

test('I3-03 · readManifest distingue ausente, JSON roto, nombre ocupado por un directorio y válido', () => {
  const ws = workspace('read');

  const missing = readManifest(ws.manifestPath);
  assert.equal(missing.status, 'missing');

  writeFileSync(ws.manifestPath, '{ esto no es JSON');
  const broken = readManifest(ws.manifestPath);
  assert.equal(broken.status, 'invalid');
  assert.equal(broken.reason, 'manifest-json');
  assert.equal(broken.sha256, sha256Hex(Buffer.from('{ esto no es JSON')));
  assert.ok(broken.size > 0);

  const occupied = workspace('read-dir');
  mkdirSync(occupied.manifestPath, { recursive: true });
  const unreadable = readManifest(occupied.manifestPath);
  // D2 corregido: un fallo de E/S no es un manifiesto inválido.
  assert.equal(unreadable.status, 'unreadable');
  assert.match(unreadable.reason, /^io:/u);

  const good = putValidManifest(ws);
  const read = readManifest(ws.manifestPath);
  assert.equal(read.status, 'ok');
  assert.equal(read.projectId, UUID);
  assert.equal(read.sha256, good.sha256);
  assert.equal(read.size, good.bytes.length);
});

// ---------------------------------------------------------------------------------------------------
// 2 · Publicación exclusiva
// ---------------------------------------------------------------------------------------------------

test('I3-04 · publicar dos veces no sobrescribe: EEXIST canónico y el primero queda intacto', () => {
  const ws = workspace('publish');
  const firstBytes = manifestOf(UUID);
  const first = publishExclusive({ path: ws.manifestPath, bytes: firstBytes, dshRoot: ws.dsh });
  assert.equal(first.ok, true, first.message ?? 'la primera publicación debe funcionar');
  assert.equal(first.sha256, sha256Hex(firstBytes));
  assert.equal(first.size, firstBytes.length);

  const same = publishExclusive({ path: ws.manifestPath, bytes: firstBytes, dshRoot: ws.dsh });
  assert.equal(same.ok, false);
  assert.equal(same.code, 'exists');
  assert.equal(same.existingSha256, first.sha256);
  assert.equal(same.existingStatus, 'ok');

  const otherBytes = manifestOf(OTHER);
  const other = publishExclusive({ path: ws.manifestPath, bytes: otherBytes, dshRoot: ws.dsh });
  assert.equal(other.ok, false);
  assert.equal(other.code, 'exists');
  assert.equal(other.existingSha256, first.sha256, 'informa la huella del que sí está');
  assert.deepEqual(readFileSync(ws.manifestPath), firstBytes);

  // Nota medida (defecto I3-D3 del informe): las publicaciones que terminan en `exists` dejan su temporal
  // `.lifecode-tmp-*` en el `.dsh`; sólo el camino de éxito lo retira. La prueba no lo tolera como
  // contrato, sólo comprueba que el canónico no se sobrescribe.
});

test('I3-05 · el nombre canónico no se puede sustituir por otro ni publicar fuera de la raíz', () => {
  const ws = workspace('contain');
  const bytes = manifestOf();

  assert.equal(basenameProblem('..', FILE_KINDS.manifest).code, PATH_CODES.traversal);
  assert.equal(basenameProblem('../lifecode-skill-center.json', FILE_KINDS.manifest).code, PATH_CODES.traversal);
  assert.equal(basenameProblem('CON', FILE_KINDS.manifest).code, PATH_CODES.reserved);
  assert.equal(basenameProblem('a*b', FILE_KINDS.manifest).code, PATH_CODES.badName);
  assert.equal(
    checkProjectedFile({
      dir: ws.dsh,
      name: '../lifecode-skill-center.json',
      dshRoot: ws.dsh,
      kind: FILE_KINDS.manifest,
    }).code,
    PATH_CODES.traversal,
  );

  const wrongName = publishExclusive({
    path: join(ws.dsh, 'otro-nombre.json'),
    bytes,
    dshRoot: ws.dsh,
  });
  assert.equal(wrongName.ok, false);
  assert.equal(wrongName.code, PATH_CODES.badName);
  assert.equal(existsSync(join(ws.dsh, 'otro-nombre.json')), false);

  const outside = publishExclusive({
    path: join(ws.dir, 'lifecode-skill-center.json'),
    bytes,
    dshRoot: ws.dsh,
  });
  assert.equal(outside.ok, false);
  assert.equal(outside.code, PATH_CODES.outside);
  assert.equal(existsSync(join(ws.dir, 'lifecode-skill-center.json')), false);
});

test('I3-06 · un enlace simbólico que sale de la raíz se rechaza antes de escribir', (t) => {
  const ws = workspace('junction');
  const outside = tempDir('junction-outside');
  const junction = join(ws.dsh, 'escape');
  try {
    symlinkSync(outside, junction, 'junction');
  } catch (error) {
    t.skip(`el sistema no permite crear junctions: ${error.code ?? error.message}`);
    return;
  }

  const bytes = manifestOf();
  const escaped = publishExclusive({
    path: join(junction, 'lifecode-skill-center.json'),
    bytes,
    dshRoot: ws.dsh,
  });
  assert.equal(escaped.ok, false);
  assert.equal(escaped.code, PATH_CODES.outside);
  assert.equal(existsSync(join(outside, 'lifecode-skill-center.json')), false);

  // Un enlace con el nombre canónico tampoco se acepta como manifiesto.
  const linkedName = workspace('junction-name');
  try {
    symlinkSync(outside, linkedName.manifestPath, 'junction');
  } catch (error) {
    t.skip(`el sistema no permite crear junctions: ${error.code ?? error.message}`);
    return;
  }
  const checked = checkExistingFile({
    path: linkedName.manifestPath,
    dshRoot: linkedName.dsh,
    kind: FILE_KINDS.manifest,
  });
  assert.equal(checked.ok, false);
  // La contención se evalúa antes del `lstat`: el enlace que sale se rechaza como fuera de la raíz.
  assert.equal(checked.code, PATH_CODES.outside);
});

// ---------------------------------------------------------------------------------------------------
// 3 · Reparación, desvinculación y fork sobre fixtures
// ---------------------------------------------------------------------------------------------------

test('I3-07 · rama A: un manifiesto inválido queda en cuarentena verificada y se publica el nuevo', () => {
  const ws = workspace('repair-invalid');
  const broken = Buffer.from('{ esto no es JSON', 'utf8');
  writeFileSync(ws.manifestPath, broken);
  const brokenSha = sha256Hex(broken);
  const desired = manifestSubject(OTHER);

  const result = repairManifest({
    dshRoot: ws.dsh,
    manifestPath: ws.manifestPath,
    manifest: desired,
    branch: 'invalid',
    now: NOW,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.branch, 'invalid');
  assert.equal(result.resumed, false);
  assert.equal(result.invalidSha256, brokenSha);
  assert.match(
    result.quarantineFile,
    /^lifecode-skill-center\.manifest-invalid-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/u,
  );
  assert.equal(result.quarantineFile.endsWith(`-${brokenSha.slice(0, 8)}.json`), true);

  const quarantinePath = join(ws.dsh, result.quarantineFile);
  assert.deepEqual(readFileSync(quarantinePath), broken, 'la evidencia son los bytes originales');
  assert.equal(sha256Hex(readFileSync(quarantinePath)), brokenSha);
  assert.equal(result.manifestSha256, sha256Hex(manifestBytes(desired)));

  const published = readManifest(ws.manifestPath);
  assert.equal(published.status, 'ok');
  assert.equal(published.projectId, OTHER);

  // La huella del comprobante se deriva de rama + contenido + workspace: repetir reanuda.
  const expectedOperation = sha256Hex(
    Buffer.from(`invalid:${sha256Hex(manifestBytes(desired))}:${ws.dsh}`, 'utf8'),
  ).slice(0, 16);
  assert.equal(result.operationId, expectedOperation);

  const again = repairManifest({
    dshRoot: ws.dsh,
    manifestPath: ws.manifestPath,
    manifest: desired,
    branch: 'invalid',
    now: NOW,
  });
  assert.equal(again.ok, true);
  assert.equal(again.resumed, true);
  assert.equal(again.quarantineFile, null);
  assert.equal(
    readdirSync(ws.dsh).filter((name) => name.includes('manifest-invalid')).length,
    1,
    'no se duplica la evidencia',
  );
});

test('I3-08 · rama B: un manifiesto ausente se publica sin inventar evidencia', () => {
  const ws = workspace('repair-missing');
  const desired = manifestSubject(THIRD);

  const result = repairManifest({
    dshRoot: ws.dsh,
    manifestPath: ws.manifestPath,
    manifest: desired,
    branch: 'missing',
    now: NOW,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.branch, 'missing');
  assert.equal(result.resumed, false);
  assert.equal(result.quarantineFile, null);
  assert.equal(result.invalidSha256, null);
  assert.equal(
    readdirSync(ws.dsh).filter((name) => name.includes('manifest-invalid')).length,
    0,
  );
  assert.equal(readManifest(ws.manifestPath).projectId, THIRD);

  const again = repairManifest({
    dshRoot: ws.dsh,
    manifestPath: ws.manifestPath,
    manifest: desired,
    branch: 'missing',
    now: NOW,
  });
  assert.equal(again.resumed, true);
  assert.equal(again.quarantineFile, null);
});

test('I3-09 · la rama equivocada no toca un manifiesto válido', () => {
  const ws = workspace('repair-mismatch');
  const original = putValidManifest(ws, UUID);
  const before = readFileSync(ws.manifestPath);

  for (const branch of ['missing', 'invalid']) {
    const result = repairManifest({
      dshRoot: ws.dsh,
      manifestPath: ws.manifestPath,
      manifest: manifestSubject(OTHER),
      branch,
      now: NOW,
    });
    assert.equal(result.ok, false, `la rama ${branch} no debe aceptar un válido`);
    assert.equal(result.code, 'repair-branch-mismatch');
    assert.deepEqual(readFileSync(ws.manifestPath), before);
  }

  const unknown = repairManifest({
    dshRoot: ws.dsh,
    manifestPath: ws.manifestPath,
    manifest: manifestSubject(OTHER),
    branch: 'otra',
    now: NOW,
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'invalid-branch');
  assert.equal(readManifest(ws.manifestPath).sha256, original.sha256);
});

test('I3-10 · detach archiva por enlace duro, retira el canónico y reanuda sin duplicar', () => {
  const ws = workspace('detach');
  const original = putValidManifest(ws, UUID);
  const beforeStats = lstatSync(ws.manifestPath);

  const result = detachManifest({ dshRoot: ws.dsh, manifestPath: ws.manifestPath, now: NOW });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.resumed, false);
  assert.equal(result.projectId, UUID);
  assert.equal(result.sha256, original.sha256);
  assert.match(result.archivedFile, /^lifecode-skill-center\.manifest-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/u);
  assert.equal(result.archivedFile, archivedManifestName(original.sha256, NOW));

  const archivedPath = join(ws.dsh, result.archivedFile);
  assert.deepEqual(readFileSync(archivedPath), original.bytes);
  const archivedStats = lstatSync(archivedPath);
  assert.equal(archivedStats.dev, beforeStats.dev);
  assert.equal(archivedStats.ino, beforeStats.ino, 'es el mismo objeto físico, no una copia');
  assert.equal(existsSync(ws.manifestPath), false);

  const again = detachManifest({ dshRoot: ws.dsh, manifestPath: ws.manifestPath, now: NOW });
  assert.equal(again.ok, true);
  assert.equal(again.resumed, true);
  assert.equal(again.archivedFile, null);
});

test('I3-11 · detach se niega ante un manifiesto inválido y no deja basura', () => {
  const ws = workspace('detach-invalid');
  const broken = Buffer.from('{ roto', 'utf8');
  writeFileSync(ws.manifestPath, broken);

  const result = detachManifest({ dshRoot: ws.dsh, manifestPath: ws.manifestPath, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'manifest-invalid');
  assert.deepEqual(readFileSync(ws.manifestPath), broken, 'no se retira lo que no se puede verificar');

  const missing = workspace('detach-missing');
  const absent = detachManifest({ dshRoot: missing.dsh, manifestPath: missing.manifestPath, now: NOW });
  assert.equal(absent.ok, true);
  assert.equal(absent.resumed, true);
  assert.equal(absent.archivedFile, null);
});

test('I3-12 · fork archiva el original, escribe intención y marcador, y publica la identidad nueva', () => {
  const ws = workspace('fork');
  const source = putValidManifest(ws, UUID);
  const sourceStats = lstatSync(ws.manifestPath);
  const desired = manifestSubject(OTHER);

  const result = forkProjectManifest({
    dshRoot: ws.dsh,
    manifestPath: ws.manifestPath,
    manifest: desired,
    now: NOW,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.resumed, false);
  assert.equal(result.manifestSha256, sha256Hex(manifestBytes(desired)));
  assert.equal(result.archivedSha256, source.sha256);
  assert.match(result.archivedFile, /^lifecode-skill-center\.manifest-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/u);

  const archivedPath = join(ws.dsh, result.archivedFile);
  assert.deepEqual(readFileSync(archivedPath), source.bytes);
  assert.equal(lstatSync(archivedPath).ino, sourceStats.ino);

  const intent = readJsonArtifact({ dshRoot: ws.dsh, name: 'lifecode-skill-center.fork-intent.json' });
  assert.equal(intent.status, 'ok');
  assert.equal(intent.value.sourceUuid, UUID);
  assert.equal(intent.value.newUuid, OTHER);
  assert.equal(intent.value.previousSha256, source.sha256);
  // El payload real guarda `previousSha256`; el clasificador busca `newManifestSha256`, que no existe.
  assert.equal(intent.value.newManifestSha256, undefined);

  const marker = readJsonArtifact({ dshRoot: ws.dsh, name: 'lifecode-skill-center.fork-published.json' });
  assert.equal(marker.status, 'ok');
  assert.equal(marker.value.manifestSha256, result.manifestSha256);
  assert.equal(marker.value.archivedSha256, source.sha256);

  const published = readManifest(ws.manifestPath);
  assert.equal(published.status, 'ok');
  assert.equal(published.projectId, OTHER);

  // `forkProjectManifest` no devuelve `previousSha256`, aunque api.mjs:1764 lo consume.
  assert.equal(result.previousSha256, undefined);

  const again = forkProjectManifest({
    dshRoot: ws.dsh,
    manifestPath: ws.manifestPath,
    manifest: desired,
    now: NOW,
  });
  assert.equal(again.ok, true);
  assert.equal(again.resumed, true);
});

test('I3-13 · fork rechaza el mismo UUID y un origen ausente sin tocar el manifiesto', () => {
  const ws = workspace('fork-same');
  const original = putValidManifest(ws, UUID);
  const same = forkProjectManifest({
    dshRoot: ws.dsh,
    manifestPath: ws.manifestPath,
    manifest: manifestSubject(UUID),
    now: NOW,
  });
  assert.equal(same.ok, false);
  assert.equal(same.code, 'fork-same-identity');
  assert.equal(readManifest(ws.manifestPath).sha256, original.sha256);

  const empty = workspace('fork-empty');
  const absent = forkProjectManifest({
    dshRoot: empty.dsh,
    manifestPath: empty.manifestPath,
    manifest: manifestSubject(OTHER),
    now: NOW,
  });
  assert.equal(absent.ok, false);
  assert.equal(absent.code, 'fork-source-missing');
  assert.equal(existsSync(empty.manifestPath), false);
});

// ---------------------------------------------------------------------------------------------------
// 4 · La vista de identidad sobre almacenes v3
// ---------------------------------------------------------------------------------------------------

test('I3-14 · la vista distingue linked, adopted, detached-manifest y fork-registered', () => {
  const root = store('view-happy');
  const linked = workspace('view-linked');
  const linkedSha = putValidManifest(linked, UUID);
  register(root, 'linked', linked.dir, { uuid: UUID, manifestSha256: linkedSha.sha256 });

  const adopted = workspace('view-adopted');
  const adoptedSha = putValidManifest(adopted, OTHER);
  register(root, 'adopted', adopted.dir, {
    uuid: OTHER,
    manifestSha256: adoptedSha.sha256,
    adoptedAt: NOW,
  });

  const detached = workspace('view-detached');
  const detachedSha = putValidManifest(detached, THIRD);
  register(root, 'detached', detached.dir, {
    uuid: THIRD,
    manifestSha256: detachedSha.sha256,
    detachedFrom: join(tempDir('old-home'), 'proyecto'),
    detachedAt: NOW,
  });

  const forked = workspace('view-forked');
  const forkedSha = putValidManifest(forked, '4f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607');
  register(root, 'forked', forked.dir, {
    uuid: '4f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607',
    manifestSha256: forkedSha.sha256,
    forkedFrom: UUID,
    forkOperationId: 'op-fork-1',
  });

  const view = identityPayload({
    root,
    registry: registryOf([{ path: linked.dir }, { path: adopted.dir }, { path: detached.dir }, { path: forked.dir }]),
  });
  assert.equal(view.total, 4);
  assert.equal(itemFor(view, linked.dir).identity, 'linked');
  assert.equal(itemFor(view, linked.dir).verification, VERIFICATION.verified);
  assert.equal(itemFor(view, adopted.dir).identity, 'adopted');
  assert.equal(itemFor(view, detached.dir).identity, 'detached-manifest');
  assert.equal(itemFor(view, forked.dir).identity, 'fork-registered');
});

test('I3-15 · la vista distingue missing, only, unmanaged y legacy sin inventar identidad', () => {
  const root = store('view-base');
  const missing = workspace('view-missing');
  register(root, 'missing', missing.dir, { uuid: UUID });

  const only = workspace('view-only');
  putValidManifest(only, OTHER);

  const unmanaged = workspace('view-unmanaged');

  const legacy = workspace('view-legacy');
  putValidManifest(legacy, THIRD);
  register(root, 'legacy', legacy.dir, {});

  const view = identityPayload({
    root,
    registry: registryOf([{ path: missing.dir }, { path: only.dir }, { path: unmanaged.dir }, { path: legacy.dir }]),
  });
  assert.equal(itemFor(view, missing.dir).identity, 'manifest-missing');
  assert.ok(itemFor(view, missing.dir).reasons.includes('no-manifest'));
  assert.equal(itemFor(view, only.dir).identity, 'manifest-only');
  assert.ok(itemFor(view, only.dir).reasons.includes('no-record'));
  assert.equal(itemFor(view, unmanaged.dir).identity, 'unmanaged');
  assert.equal(itemFor(view, legacy.dir).identity, 'legacy-manifest-only');
  assert.ok(itemFor(view, legacy.dir).reasons.includes('legacy-record-without-uuid'));
});

test('I3-16 · la vista rechaza un manifiesto corrupto o de esquema futuro', () => {
  const root = store('view-broken');
  const corrupt = workspace('view-corrupt');
  writeFileSync(corrupt.manifestPath, '{ roto');
  register(root, 'corrupt', corrupt.dir, { uuid: UUID });

  const future = workspace('view-future');
  putManifest(future, manifestBytes({ ...manifestSubject(OTHER), schemaVersion: 2 }));

  const view = identityPayload({
    root,
    registry: registryOf([{ path: corrupt.dir }, { path: future.dir }]),
  });
  const corruptItem = itemFor(view, corrupt.dir);
  assert.equal(corruptItem.identity, 'manifest-invalid');
  assert.equal(corruptItem.verification, VERIFICATION.unverified);
  assert.ok(corruptItem.reasons.includes('manifest-invalid'));

  const futureItem = itemFor(view, future.dir);
  assert.equal(futureItem.identity, 'manifest-future');
  assert.equal(futureItem.verification, VERIFICATION.unverified);
});

test('I3-17 · un UUID ajeno o una huella distinta en la misma ruta son path-conflict', () => {
  const root = store('view-conflict');
  const byUuid = workspace('view-conflict-uuid');
  putValidManifest(byUuid, OTHER);
  register(root, 'by-uuid', byUuid.dir, { uuid: UUID, manifestSha256: 'b'.repeat(64) });

  const byHash = workspace('view-conflict-hash');
  const byHashSha = putValidManifest(byHash, THIRD);
  register(root, 'by-hash', byHash.dir, { uuid: THIRD, manifestSha256: MISSING_HASH });

  const view = identityPayload({
    root,
    registry: registryOf([{ path: byUuid.dir }, { path: byHash.dir }]),
  });
  const uuidItem = itemFor(view, byUuid.dir);
  assert.equal(uuidItem.identity, 'path-conflict');
  assert.ok(uuidItem.reasons.includes('manifest-uuid-elsewhere'));
  const hashItem = itemFor(view, byHash.dir);
  assert.equal(hashItem.identity, 'path-conflict');
  assert.ok(hashItem.reasons.includes('manifest-hash-differs'));
  assert.equal(byHashSha.sha256.length, 64);
});

test('I3-18 · moved-manifest sólo se afirma con la ruta vieja ausente y el inventario completo', () => {
  const oldHome = workspace('moved-old');
  rmSync(oldHome.dir, { recursive: true, force: true });
  const newHome = workspace('moved-new');
  const sha = putValidManifest(newHome, UUID).sha256;
  const record = { projectId: 'p', cwd: oldHome.dir, uuid: UUID, manifestSha256: sha };

  const movedObservation = {
    ...observation(newHome, { record }),
    pathMissingConfirmed: true,
    oldPathIndeterminate: true,
  };
  const moved = classifyWorkspace(movedObservation, { inventory: INVENTORY.complete });
  assert.equal(moved.identity, 'moved-manifest');
  assert.equal(moved.verification, VERIFICATION.verified);
  assert.ok(moved.reasons.includes('old-path-confirmed-absent'));

  const notConfirmed = classifyWorkspace(
    { ...movedObservation, pathMissingConfirmed: false },
    { inventory: INVENTORY.complete },
  );
  assert.equal(notConfirmed.identity, 'linked');
  assert.equal(notConfirmed.verification, VERIFICATION.unverified);
  assert.ok(notConfirmed.reasons.includes('old-path-indeterminate'));

  const incomplete = classifyWorkspace(
    { ...movedObservation, oldPathIndeterminate: false },
    { inventory: INVENTORY.incomplete },
  );
  assert.equal(incomplete.identity, 'linked');
  assert.equal(incomplete.verification, VERIFICATION.unverified);
  assert.ok(incomplete.reasons.includes('inventory-incomplete'));
});

test('I3-19 · dos manifiestos con el mismo UUID son uuid-duplicated sólo con inventario completo', () => {
  const a = workspace('dup-a');
  const b = workspace('dup-b');
  const shaA = putValidManifest(a, UUID).sha256;
  const shaB = putValidManifest(b, UUID).sha256;

  const observations = [
    {
      path: a.dir,
      record: null,
      manifest: { status: 'ok', projectId: UUID, sha256: shaA },
      inspected: true,
    },
    {
      path: b.dir,
      record: null,
      manifest: { status: 'ok', projectId: UUID, sha256: shaB },
      inspected: true,
    },
  ];

  const complete = buildIdentityView({
    observations,
    records: [],
    workspaces: [],
    inventory: { status: INVENTORY.complete },
  });
  assert.deepEqual(
    complete.items.map((item) => item.identity),
    ['uuid-duplicated', 'uuid-duplicated'],
  );
  assert.equal(complete.uniqueness.status, UNIQUENESS.duplicated);
  assert.deepEqual(complete.uniqueness.duplicates, [UUID]);

  const incomplete = buildIdentityView({
    observations,
    records: [],
    workspaces: [],
    inventory: { status: INVENTORY.incomplete },
  });
  assert.deepEqual(
    incomplete.items.map((item) => item.identity),
    ['manifest-only', 'manifest-only'],
  );
  assert.equal(incomplete.uniqueness.status, UNIQUENESS.unverified);
});

test('I3-20 · los estados de fork se deciden con los artefactos reales, no con la vista proyectada', () => {
  const ws = workspace('fork-states');
  const source = putValidManifest(ws, UUID);
  const desired = manifestSubject(OTHER);
  const forked = forkProjectManifest({
    dshRoot: ws.dsh,
    manifestPath: ws.manifestPath,
    manifest: desired,
    now: NOW,
  });
  assert.equal(forked.ok, true, JSON.stringify(forked));

  const intent = readJsonArtifact({ dshRoot: ws.dsh, name: 'lifecode-skill-center.fork-intent.json' });
  const marker = readJsonArtifact({ dshRoot: ws.dsh, name: 'lifecode-skill-center.fork-published.json' });
  const newSha = forked.manifestSha256;
  const record = {
    projectId: 'p',
    cwd: ws.dir,
    uuid: OTHER,
    manifestSha256: newSha,
    fork: {
      newUuid: OTHER,
      manifestSha256: newSha,
      archivedFile: forked.archivedFile,
      forkPreviousManifestSha256: source.sha256,
    },
  };
  const base = {
    path: ws.dir,
    record,
    availability: 'ok',
    manifest: { status: 'ok', projectId: OTHER, sha256: newSha },
    archive: { status: 'ok', sha256: source.sha256, name: forked.archivedFile },
    marker: { status: 'missing' },
    intent: { status: 'ok', ...intent.value },
    inspected: true,
  };

  assert.equal(classifyWorkspace(base).identity, 'fork-manifest-published');
  assert.equal(
    classifyWorkspace({ ...base, marker: { status: 'ok', value: marker.value } }).identity,
    'fork-published',
  );
  assert.equal(
    classifyWorkspace({
      ...base,
      manifest: { status: 'missing' },
      archive: { status: 'missing' },
      marker: { status: 'missing' },
    }).identity,
    'fork-intent-only',
  );
  assert.equal(
    classifyWorkspace({
      ...base,
      manifest: { status: 'missing' },
      marker: { status: 'missing' },
    }).identity,
    'fork-manifest-archived',
  );
  assert.equal(
    classifyWorkspace({ ...base, marker: { status: 'invalid' } }).identity,
    'fork-conflict',
  );
  assert.equal(
    classifyWorkspace({
      ...base,
      intent: { status: 'ok', ...intent.value, newManifestSha256: 'f'.repeat(64) },
    }).identity,
    'fork-conflict',
  );
});

test('I3-21 · identity-unknown se reserva para una ruta que no se pudo inspeccionar', () => {
  const ws = workspace('unknown');
  putValidManifest(ws, UUID);

  const unknown = classifyWorkspace(
    { ...observation(ws), inspected: false, inspectionError: 'missing-dir' },
    { inventory: INVENTORY.incomplete },
  );
  assert.equal(unknown.identity, IDENTITY_STATES.identityUnknown);
  assert.equal(unknown.availability, 'missing-dir');
  assert.equal(unknown.verification, VERIFICATION.unverified);
  assert.ok(unknown.reasons.includes('path-unreadable'));
  assert.ok(unknown.reasons.includes('inventory-incomplete'));
});

test('I3-22 · la vista declara duplicados por UUID y no los resuelve por su cuenta', () => {
  // D1 cerrado: los duplicados son una propiedad del conjunto, así que se calculan antes de clasificar y se
  // pasan al clasificador. La vista los **declara** con sus rutas; no elige ganador.
  const root = store('view-duplicates');
  const a = workspace('view-dup-a');
  const b = workspace('view-dup-b');
  const shaA = putValidManifest(a, UUID).sha256;
  const shaB = putValidManifest(b, UUID).sha256;
  register(root, 'a', a.dir, { uuid: UUID, manifestSha256: shaA });
  register(root, 'b', b.dir, { uuid: UUID, manifestSha256: shaB });

  const view = identityPayload({
    root,
    registry: registryOf([{ path: a.dir }, { path: b.dir }]),
  });
  assert.equal(view.total, 2);
  assert.equal(itemFor(view, a.dir).identity, 'uuid-duplicated');
  assert.equal(itemFor(view, b.dir).identity, 'uuid-duplicated');
  assert.equal(view.uniqueness, 'uuid-duplicated');
  assert.equal(view.duplicates.uuid.length, 1);
  assert.equal(view.duplicates.uuid[0].value, UUID);
  assert.deepEqual(view.duplicates.uuid[0].items.slice().sort(), [a.dir, b.dir].sort());
  assert.deepEqual(view.duplicates.path, []);
  assert.deepEqual(view.forks, { total: 0, byState: {} });

  // Control: un proyecto solo no se declara duplicado de sí mismo.
  const soloRoot = store('view-single');
  const solo = workspace('view-single-ws');
  const shaSolo = putValidManifest(solo, UUID).sha256;
  register(soloRoot, 'solo', solo.dir, { uuid: UUID, manifestSha256: shaSolo });
  const soloView = identityPayload({ root: soloRoot, registry: registryOf([{ path: solo.dir }]) });
  assert.equal(soloView.uniqueness, 'ok');
  assert.deepEqual(soloView.duplicates.uuid, []);
  assert.deepEqual(soloView.duplicates.path, []);
});
test('I3-23 · un manifiesto ilegible deja el inventario incompleto y no se presenta como verificado', () => {
  // D2 corregido: readManifest devuelve `unreadable` en fallos de E/S, identityPayload lo cuenta como
  // fallo del inventario y la fila queda indeterminada en vez de afirmarse inválida.
  const root = store('view-unreadable');
  const ws = workspace('view-unreadable-ws');
  mkdirSync(ws.manifestPath, { recursive: true });
  register(root, 'p', ws.dir, { uuid: UUID });

  const view = identityPayload({ root, registry: registryOf([{ path: ws.dir }]) });
  const item = itemFor(view, ws.dir);
  assert.equal(view.inventory.status, INVENTORY.incomplete);
  assert.equal(item.identity, 'identity-unknown');
  assert.equal(item.verification, VERIFICATION.unverified);
  // La disponibilidad de la carpeta tampoco se puede afirmar cuando el manifiesto no se pudo leer.
  assert.equal(item.availability, 'unknown');
  assert.ok(item.reasons.includes('inventory-unreadable'), 'el motivo nombra el fallo de lectura del inventario');
  assert.ok(item.reasons.includes('inventory-incomplete'), 'un solo fallo deja el inventario incompleto');
  assert.equal(item.reasons.includes('manifest-invalid'), false, 'no se afirma que el manifiesto esté inválido');
});

// ---------------------------------------------------------------------------------------------------
// 5 · v2 sigue bloqueado y el almacén no cambia
// ---------------------------------------------------------------------------------------------------

test('I3-24 · en v2 toda operación de identidad responde 409/migration-required y no escribe un byte', () => {
  const root = store('v2-blocked', 2);
  const projectDir = tempDir('v2-project');
  const knowledgePath = join(root, 'knowledge.json');
  writeFileSync(knowledgePath, '{"sentinel":"no tocar"}\n', 'utf8');

  const centerPath = centerFile(root);
  const centerBefore = readFileSync(centerPath);
  const knowledgeBefore = readFileSync(knowledgePath);

  for (const action of IDENTITY_ACTIONS) {
    const result = runAction({
      root,
      action,
      actor: 'human',
      now: NOW,
      payload: { projectId: UUID, cwd: projectDir, branch: 'missing' },
    });
    assert.equal(result.ok, false, `${action} debía quedar bloqueada en v2`);
    assert.equal(result.code, 'migration-required', action);
    assert.equal(result.status, 409, action);
    assert.equal(result.identity.available, false, action);
    assert.equal(result.identity.requiredSchemaVersion, 3, action);
  }

  // La vista es de lectura y tampoco puede migrar.
  const view = identityPayload({ root, registry: registryOf([{ path: projectDir }]) });
  assert.equal(view.ok, true);
  assert.equal(view.total, 1);

  assert.deepEqual(readFileSync(centerPath), centerBefore, 'center.json queda byte a byte igual');
  assert.deepEqual(readFileSync(knowledgePath), knowledgeBefore, 'knowledge.json queda byte a byte igual');
  assert.equal(existsSync(join(projectDir, '.dsh')), false, 'la política se evalúa antes de crear nada');
});

test('I3-25 · en v3 la reparación por API publica el manifiesto y deja comprobante y evento', () => {
  const root = store('v3-repair');
  const project = workspace('v3-repair-ws');
  const knowledgePath = join(root, 'knowledge.json');
  writeFileSync(knowledgePath, '{"sentinel":"no tocar"}\n', 'utf8');
  const knowledgeBefore = readFileSync(knowledgePath);

  const result = runAction({
    root,
    action: 'repair',
    actor: 'human',
    now: NOW,
    payload: { projectId: UUID, cwd: project.dir, branch: 'missing' },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.branch, 'missing');
  assert.equal(result.resumed, false);
  assert.equal(result.quarantineFile, null);

  const published = readManifest(project.manifestPath);
  assert.equal(published.status, 'ok');
  assert.equal(published.projectId, UUID);
  assert.equal(published.sha256, result.manifestSha256);

  const stored = loadState(root).state;
  const operation = stored.operations[result.operationId];
  assert.ok(operation, 'el comprobante existe');
  assert.equal(operation.kind, 'repair-manifest');
  assert.equal(operation.uuid, UUID);
  assert.equal(operation.targetSha256, result.manifestSha256);
  assert.equal(
    stored.events.filter((event) => event.type === 'project.manifest-anchored').length,
    1,
  );
  assert.deepEqual(readFileSync(knowledgePath), knowledgeBefore, 'knowledge.json no se toca');
});

test('I3-26 · `repair-manifest` repara la rama inválida por API y conserva la evidencia', () => {
  const root = store('v3-repair-invalid');
  const project = workspace('v3-repair-invalid-ws');
  const broken = Buffer.from('{ roto', 'utf8');
  writeFileSync(project.manifestPath, broken);

  const result = runAction({
    root,
    action: 'repair-manifest',
    actor: 'human',
    now: NOW,
    payload: { projectId: OTHER, cwd: project.dir, branch: 'invalid' },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.branch, 'invalid');
  assert.match(
    result.quarantineFile,
    /^lifecode-skill-center\.manifest-invalid-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/u,
  );
  assert.deepEqual(readFileSync(join(project.dsh, result.quarantineFile)), broken);
  assert.equal(readManifest(project.manifestPath).projectId, OTHER);
});

// ---------------------------------------------------------------------------------------------------
// 6 · Puerta de hermeticidad: el almacén real, medido antes y después
// ---------------------------------------------------------------------------------------------------

const REAL_STORE = join(homedir(), '.dsh', 'lifecode-skill-center');
const REAL_FILES = ['center.json', 'knowledge.json'].map((name) => {
  const path = join(REAL_STORE, name);
  return { name, path, before: fingerprint(path) };
});

test('I3-27 · el almacén real de usuario queda byte a byte igual', (t) => {
  if (REAL_FILES.every((file) => file.before === null)) {
    t.skip('esta máquina no tiene almacén real; no hay nada que comparar');
    return;
  }
  for (const file of REAL_FILES) {
    assert.deepEqual(
      fingerprint(file.path),
      file.before,
      `${file.name} cambió durante la suite de identidad v3`,
    );
  }
});
