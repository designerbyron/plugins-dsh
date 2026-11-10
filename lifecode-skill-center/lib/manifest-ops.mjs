/**
 * Operaciones de manifiesto en disco: publicación exclusiva, bloqueo por workspace, cuarentena y
 * reparación.
 *
 * Lo que decide **qué** hacer vive en `identity.mjs` / `paths.mjs`; aquí sólo se ejecutan pasos de
 * filesystem con las propiedades medidas en esta máquina (LSC‑019/LSC‑025):
 *
 * - `writeFileSync(..., { flag: 'wx' })` falla con `EEXIST` si el destino existe: sirve para temporales.
 * - `renameSync` **sobrescribe** un destino existente en silencio: inservible como publicación.
 * - `linkSync(tmp, destino)` falla con `EEXIST` y publica de forma exclusiva: **ese** es el punto de
 *   publicación, y de dos procesos sólo uno gana.
 * - `fsync` de directorio devuelve `EPERM` en NTFS: se sincronizan los bytes, no la entrada de directorio.
 *
 * Las operaciones son recuperables por pasos (intención → publicación → marcador) y ningún paso borra
 * evidencia de otro.
 */

import * as nodeFs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { FILE_KINDS, basenameProblem, checkProjectedFile, checkPublishedFile, isInside } from './paths.mjs';

/** El literal que identifica un manifiesto. Contiene una barra **legítima** (LSC‑019). */
export const MANIFEST_SCHEMA = 'lifecode-skill-center/project';
export const MANIFEST_SCHEMA_VERSION = 1;

/** Campos permitidos, en el orden en que se serializan. Cualquier otro campo invalida el documento. */
export const MANIFEST_FIELDS = ['schema', 'schemaVersion', 'projectId', 'registeredAt'];

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** ¿Es una fecha UTC canónica (milisegundos y `Z`)? Sin esto, ordenar por fecha es mentira. */
export function isCanonicalUtc(value) {
  if (typeof value !== 'string' || UTC_PATTERN.test(value) !== true) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function isUuidV4(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Serialización canónica: mismo contenido ⇒ mismos bytes ⇒ misma huella, sin depender del orden de claves. */
export function manifestBytes(manifest) {
  const ordered = {};
  for (const field of MANIFEST_FIELDS) ordered[field] = manifest[field];
  return Buffer.from(`${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

/**
 * Valida un manifiesto ya parseado:
 * - `ok` con `projectId` y `registeredAt`,
 * - `future` si el `schemaVersion` es mayor que el que entiende este código,
 * - `invalid` en cualquier otro caso, con el motivo.
 */
export function validateManifest(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'invalid', reason: 'manifest-not-an-object' };
  }
  for (const key of Object.keys(parsed)) {
    if (MANIFEST_FIELDS.includes(key) !== true) return { status: 'invalid', reason: `unknown-field:${key}` };
  }
  if (parsed.schema !== MANIFEST_SCHEMA) return { status: 'invalid', reason: 'manifest-schema' };
  if (Number.isInteger(parsed.schemaVersion) !== true) return { status: 'invalid', reason: 'manifest-schema-version' };
  if (parsed.schemaVersion > MANIFEST_SCHEMA_VERSION) return { status: 'future', reason: `manifest-schema-version:${parsed.schemaVersion}` };
  if (parsed.schemaVersion < MANIFEST_SCHEMA_VERSION) return { status: 'invalid', reason: 'manifest-schema-version-old' };
  if (isUuidV4(parsed.projectId) !== true) return { status: 'invalid', reason: 'manifest-project-id' };
  if (isCanonicalUtc(parsed.registeredAt) !== true) return { status: 'invalid', reason: 'manifest-registered-at' };
  return { status: 'ok', projectId: parsed.projectId, registeredAt: parsed.registeredAt };
}

/** Lee un manifiesto sin lanzar: `missing`, `invalid`, `future` u `ok` con bytes y huella. */
export function readManifest(path, fs = nodeFs) {
  let bytes;
  try {
    bytes = fs.readFileSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing', path };
    // No se pudo leer: no es lo mismo que un manifiesto inválido, y el panel ya sabe pintar este estado.
    return { status: 'unreadable', path, reason: `io:${error.code ?? 'error'}` };
  }
  const sha256 = sha256Hex(bytes);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { status: 'invalid', path, sha256, size: bytes.length, reason: 'manifest-json' };
  }
  return { ...validateManifest(parsed), path, sha256, size: bytes.length, manifest: parsed };
}

export function newManifest({ projectId, registeredAt }) {
  return { schema: MANIFEST_SCHEMA, schemaVersion: MANIFEST_SCHEMA_VERSION, projectId, registeredAt };
}

/** Nombre de temporal propio; la limpieza sólo retira los que encajan con este patrón. */
export function tempName(operationId, attempt = 1) {
  return `.lifecode-tmp-${operationId}-${attempt}`;
}

export function newOperationId() {
  return randomUUID().replaceAll('-', '').slice(0, 16);
}

/**
 * Publica bytes en `path` de forma **exclusiva**:
 * temporal `wx` → escribir → `fsync` → releer y verificar huella → `linkSync(tmp, path)` → borrar temporal.
 *
 * `EEXIST` no es un fallo del programa: alguien publicó antes. Se devuelve lo que hay para que el
 * llamante decida (reanudar, conflicto o parada).
 */
export function publishExclusive({
  path,
  bytes,
  dshRoot,
  kind = FILE_KINDS.manifest,
  operationId = newOperationId(),
  hooks = {},
  fs = {},
} = {}) {
  // Un solo objeto de filesystem: el real por defecto y el que inyecta la prueba encima. Se pasa tal cual a
  // `paths.mjs` para que la comprobación y la escritura usen exactamente las mismas llamadas.
  const project = { ...nodeFs, ...fs };
  const projected = checkProjectedFile({ dir: dirname(path), name: basename(path), dshRoot, kind, fs: project });
  if (projected.ok !== true) return projected;

  const expectedSha = sha256Hex(bytes);
  const temporary = join(projected.dir, tempName(operationId));
  let reusedTemp = false;
  // Retirar el temporal propio antes de devolver un fallo determinista. `force` porque el caso normal es
  // que ya no esté; nunca se toca un temporal ajeno, que se detecta por su contenido.
  const dropTemporary = () => {
    try {
      project.rmSync(temporary, { force: true });
    } catch {
      // Si no se puede retirar, el fallo que se devuelve sigue siendo el importante.
    }
  };
  try {
    project.writeFileSync(temporary, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      return { ok: false, code: 'temp-failed', message: String(error.code ?? error.message), path: temporary };
    }
    // Una ejecución anterior se interrumpió después de escribir el temporal. Si su contenido es
    // exactamente el que se iba a publicar, se reutiliza: reintentar no puede fallar por un resto propio.
    let existingBytes = null;
    try {
      existingBytes = project.readFileSync(temporary);
    } catch {
      existingBytes = null;
    }
    if (existingBytes === null || sha256Hex(existingBytes) !== expectedSha) {
      return { ok: false, code: 'temp-exists', path: temporary };
    }
    reusedTemp = true;
  }
  try {
    if (reusedTemp !== true) hooks.afterTempWrite?.({ temporary });
    const handle = project.openSync(temporary, 'r+');
    try {
      project.fsyncSync(handle);
    } finally {
      project.closeSync(handle);
    }
    hooks.afterTempSync?.({ temporary });
    const written = project.readFileSync(temporary);
    if (sha256Hex(written) !== expectedSha) {
      dropTemporary();
      return { ok: false, code: 'temp-mismatch', message: 'los bytes escritos no coinciden con los previstos', path: temporary };
    }
  } catch (error) {
    // Deliberado: el temporal **se queda** cuando falló la escritura o el fsync. Su contenido es la única
    // evidencia de qué se llegó a escribir; retirarlo borraría la prueba del fallo.
    return { ok: false, code: 'temp-unverified', message: String(error.code ?? error.message), path: temporary };
  }

  try {
    hooks.beforeLink?.({ temporary, path });
    project.linkSync(temporary, path);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const existing = readManifest(path);
      dropTemporary();
      return { ok: false, code: 'exists', path, existingSha256: existing.sha256 ?? null, existingStatus: existing.status };
    }
    if (error.code === 'EPERM' || error.code === 'ENOSYS' || error.code === 'ENOTSUP') {
      dropTemporary();
      return { ok: false, code: 'publish-unsupported', message: `este filesystem no publica de forma exclusiva: ${error.code}`, path };
    }
    dropTemporary();
    return { ok: false, code: 'link-failed', message: String(error.code ?? error.message), path };
  }

  // El gancho posterior al enlace **no** puede convertir un éxito en un fallo: si lanza, la publicación ya
  // ocurrió y lo que falla es el observador, no la operación.
  try {
    hooks.afterLink?.({ path });
  } catch {
    // deliberado: la evidencia de la publicación es el propio enlace verificado justo debajo
  }
  const published = checkPublishedFile({ path, dshRoot, kind, fs: project });
  if (published.ok !== true) {
    dropTemporary();
    return { ok: false, code: 'escaped-after-publish', message: published.message, path, cause: published.code };
  }
  try {
    project.unlinkSync(temporary);
  } catch {
    // Un temporal que sobrevive no invalida la publicación: lo retira la limpieza conservadora.
  }
  return { ok: true, path, sha256: expectedSha, size: bytes.length, dev: published.dev, ino: published.ino, nlink: published.nlink };
}

/**
 * Retira el manifiesto canónico **archivándolo por enlace duro** en el mismo directorio. No borra la identidad:
 * el registro del centro y sus asignaciones siguen donde estaban; lo que desaparece es el ancla en el proyecto.
 */
export function detachManifest({ dshRoot, manifestPath, now = new Date().toISOString(), operationId, hooks = {}, fs = {} } = {}) {
  const project = { ...nodeFs, ...fs };
  // El manifiesto sólo se retira **dentro** del .dsh del workspace. Sin esta comprobación un `manifestPath`
  // apuntando fuera archivaba y borraba un archivo externo (D5).
  const projected = checkProjectedFile({ dir: dirname(manifestPath), name: basename(manifestPath), dshRoot, kind: FILE_KINDS.manifest, fs: project });
  if (projected.ok !== true) return projected;
  const lock = acquireWorkspaceLock({ dshRoot, operation: 'unlink', operationId, now, fs });
  if (lock.ok !== true) return lock;
  try {
    const current = readManifest(manifestPath, project);
    if (current.status === 'missing') {
      return { ok: true, resumed: true, archivedFile: null, sha256: null, size: 0, projectId: null };
    }
    if (current.status !== 'ok') {
      return { ok: false, code: 'manifest-invalid', message: 'el manifiesto canónico no es legible: repáralo antes de retirarlo' };
    }
    const archivedFile = archivedManifestName(current.sha256, now);
    const archivedPath = join(dshRoot, archivedFile);
    let existed = false;
    try {
      project.lstatSync(archivedPath);
      existed = true;
    } catch {
      existed = false;
    }
    if (existed !== true) {
      try {
        project.linkSync(manifestPath, archivedPath);
      } catch (error) {
        if (error.code === 'EPERM' || error.code === 'ENOSYS' || error.code === 'ENOTSUP') {
          return { ok: false, code: 'publish-unsupported', message: 'el filesystem no permite enlaces duros: no se retira el ancla sin evidencia' };
        }
        return { ok: false, code: 'archive-failed', message: String(error.code ?? error.message) };
      }
    }
    const archived = readManifest(archivedPath, project);
    if (archived.status !== 'ok' || archived.sha256 !== current.sha256) {
      return { ok: false, code: 'archive-mismatch', message: 'la evidencia archivada no tiene la huella del manifiesto retirado' };
    }
    hooks.beforeDetach?.({ archivedFile, sha256: current.sha256 });
    try {
      project.unlinkSync(manifestPath);
    } catch (error) {
      if (error.code !== 'ENOENT') return { ok: false, code: 'detach-failed', message: String(error.code ?? error.message) };
    }
    hooks.afterDetach?.({ archivedFile });
    return { ok: true, resumed: false, archivedFile, sha256: current.sha256, size: current.size, projectId: current.manifest.projectId };
  } finally {
    lock.release();
  }
}

/**
 * Bloqueo por workspace+operación con `linkSync`/**
 * Bloqueo por workspace+operación con `linkSync`: de dos procesos que lo intentan, uno recibe `EEXIST`.
 * Un bloqueo más viejo que `staleMs` se considera abandonado (la operación murió) y se retira dejándolo
 * dicho en el resultado.
 */
export function acquireWorkspaceLock({
  dshRoot,
  operation,
  operationId = newOperationId(),
  now = Date.now(),
  staleMs = 120000,
  fs = {},
} = {}) {
  const project = { ...nodeFs, ...fs };
  // El nombre del bloqueo identifica la **operación**, no la ejecución: dos procesos que reparan el mismo
  // workspace deben competir por el mismo fichero. El id de la ejecución va dentro del contenido y del temporal.
  const path = join(dshRoot, `.lifecode-tmp-lock-${operation}`);
  const temporary = `${path}.${operationId}.${process.pid}`;
  try {
    project.writeFileSync(
      temporary,
      JSON.stringify({ operation, operationId, pid: process.pid, at: new Date(now).toISOString() }),
      { flag: 'wx' },
    );
  } catch (error) {
    return { ok: false, code: 'lock-temp-failed', message: String(error.code ?? error.message) };
  }

  const take = () => {
    project.linkSync(temporary, path);
  };
  try {
    take();
  } catch (error) {
    if (error.code !== 'EEXIST') {
      project.rmSync(temporary, { force: true });
      return { ok: false, code: 'lock-failed', message: String(error.code ?? error.message) };
    }
    let stale = false;
    try {
      stale = now - project.lstatSync(path).mtimeMs > staleMs;
    } catch {
      stale = true;
    }
    if (stale !== true) {
      project.rmSync(temporary, { force: true });
      return { ok: false, code: 'workspace-busy', message: `hay otra operación ${operation} en curso` };
    }
    project.rmSync(path, { force: true });
    try {
      take();
    } catch (retry) {
      project.rmSync(temporary, { force: true });
      return { ok: false, code: 'workspace-busy', message: `no se pudo retirar el bloqueo abandonado: ${retry.code}` };
    }
  }

  project.rmSync(temporary, { force: true });
  return {
    ok: true,
    path,
    operation,
    operationId,
    release() {
      try {
        project.rmSync(path, { force: true });
      } catch {
        // Caduca solo.
      }
    },
  };
}

/** ¿Son el mismo objeto físico? (la comprobación que va pegada al `unlink`) */
export function sameFileIdentity(left, right) {
  if (left === null || right === null || left === undefined || right === undefined) return false;
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Reparación del manifiesto (LSC‑025):
 * - rama A `manifest-invalid`: se conserva el archivo inválido en cuarentena **verificada** y se publica
 *   el nuevo manifiesto;
 * - rama B `manifest-missing`: no hay nada que conservar y **no se inventa evidencia**
 *   (`quarantineFile: null`, `invalidSha256: null`).
 *
 * El comprobante que devuelve se registra en el centro en la **misma** mutación que su evento.
 */
export function repairManifest({
  dshRoot,
  manifestPath,
  manifest,
  branch,
  now = new Date().toISOString(),
  operationId,
  hooks = {},
} = {}) {
  if (branch !== 'invalid' && branch !== 'missing') return { ok: false, code: 'invalid-branch' };
  // El identificador por defecto es **derivado del contenido** (rama + huella + workspace): reintentar la
  // misma reparación reutiliza su temporal y su comprobante en vez de dejar restos nuevos en cada intento.
  if (typeof operationId !== 'string' || operationId === '') {
    const derived = sha256Hex(Buffer.from(`${branch}:${sha256Hex(manifestBytes(manifest))}:${dshRoot}`, 'utf8'));
    operationId = derived.slice(0, 16);
  }
  const lock = acquireWorkspaceLock({ dshRoot, operation: 'repair', operationId });
  if (lock.ok !== true) return lock;

  try {
    const bytes = manifestBytes(manifest);
    const incomingSha = sha256Hex(bytes);
    const manifestSha256 = sha256Hex(bytes);
    const current = readManifest(manifestPath);
    const artifacts = { operationId, branch, quarantineFile: null, invalidSha256: null, manifestSha256 };
    void incomingSha;

    // Si el manifiesto que se quiere publicar **ya está** publicado, la operación se completó antes (una
    // pasada anterior o un reintento tras una interrupción): se reanuda sin duplicar cuarentenas.
    if (current.status === 'ok' && current.sha256 === manifestSha256) {
      return { ok: true, resumed: true, ...artifacts };
    }

    if (branch === 'invalid') {
      // Una pasada anterior puede haber archivado la evidencia y retirado el canónico antes de publicar. Si
      // el canónico ya no está pero hay evidencia en cuarentena, la rama A continúa desde ahí en vez de
      // exigir un archivo inválido que ella misma se llevó.
      // Un manifiesto **válido** no es materia de reparación: si lo fuera, la rama A podría sustituirlo por
      // el contenido de una cuarentena cualquiera. Esto es lo que hacía D4.
      if (current.status === 'ok') {
        return { ok: false, code: 'repair-branch-mismatch', message: 'la rama A exige un manifiesto inválido: hay uno válido y no se toca' };
      }
      const evidence = current.status === 'invalid' ? null : findQuarantineEvidence(dshRoot, readManifest, nodeFs, { projectId: manifest?.projectId });
      if (current.status !== 'invalid' && evidence === null) {
        return { ok: false, code: 'repair-branch-mismatch', message: `la rama A exige un manifiesto inválido y hay "${current.status}"` };
      }
      // El nombre de la cuarentena lleva la marca de tiempo y el prefijo de la huella del archivo inválido:
      // así se puede comprobar que la evidencia corresponde a **ese** contenido y no a otro.
      const stamp = now.replaceAll(/[-:.]/gu, '').replace(/^(\d{8})T(\d{6})(\d{3})Z$/u, '$1T$2Z');
      const invalidSha = evidence?.sha256 ?? current.sha256 ?? '';
      const quarantineName = evidence?.name ?? `lifecode-skill-center.manifest-invalid-${stamp}-${String(invalidSha).slice(0, 8)}.json`;
      const problem = basenameProblem(quarantineName, FILE_KINDS.quarantineManifest);
      if (problem.ok !== true) return { ok: false, code: 'quarantine-name', message: problem.code };
      const quarantinePath = join(dshRoot, quarantineName);
      // La cuarentena se crea con un **enlace duro**, no con una copia: los bytes son los mismos y el
      // contenido queda atado a un objeto físico que se puede volver a medir. Después se retira el nombre
      // canónico para dejar el destino libre; el contenido sigue existiendo en la cuarentena.
      if (evidence !== null) {
        // La evidencia ya existe y es del mismo contenido: no se vuelve a enlazar (y desde luego no se
        // intenta enlazar un canónico que ya no está).
      } else
      try {
        nodeFs.linkSync(manifestPath, quarantinePath);
      } catch (error) {
        if (error.code === 'EEXIST') {
          // Una pasada anterior ya puso la evidencia y se interrumpió antes de retirar el canónico. Si la
          // cuarentena existente es **el mismo contenido**, la operación se reanuda; si es otra, es un
          // conflicto que una persona tiene que mirar.
          const existing = readManifest(quarantinePath);
          if (existing.sha256 !== current.sha256) {
            return { ok: false, code: 'quarantine-exists', message: 'hay otra evidencia en cuarentena con ese nombre' };
          }
        } else {
          return { ok: false, code: 'quarantine-failed', message: String(error.code ?? error.message) };
        }
      }
      hooks.afterQuarantine?.({ quarantinePath });
      const quarantined = readManifest(quarantinePath);
      if (quarantined.sha256 !== invalidSha) {
        return { ok: false, code: 'quarantine-mismatch', message: 'la cuarentena no coincide con el archivo inválido' };
      }
      // La comprobación de identidad física sólo tiene sentido mientras el canónico siga ahí: en una
      // reanudación ya se retiró, y lo que se verifica entonces es la huella de la evidencia.
      if (evidence === null) {
        const invalidIdentity = nodeFs.lstatSync(quarantinePath);
        const originalIdentity = nodeFs.lstatSync(manifestPath);
        if (invalidIdentity.dev !== originalIdentity.dev || invalidIdentity.ino !== originalIdentity.ino) {
          return { ok: false, code: 'quarantine-identity', message: 'la cuarentena no es el mismo objeto que el archivo inválido' };
        }
      }
      try {
        nodeFs.unlinkSync(manifestPath);
      } catch (error) {
        // Si el canónico ya no está (pasada anterior interrumpida tras retirarlo), se continúa.
        if (error.code !== 'ENOENT') {
          return { ok: false, code: 'quarantine-detach-failed', message: String(error.code ?? error.message) };
        }
      }
      hooks.afterDetach?.({ quarantinePath, manifestPath });
      artifacts.quarantineFile = quarantineName;
      artifacts.invalidSha256 = invalidSha;
    } else if (current.status !== 'missing' && current.status !== 'invalid') {
      // La rama B repara un manifiesto ausente; si hay uno válido, la operación correcta es otra.
      return { ok: false, code: 'repair-branch-mismatch', message: `la rama B exige un manifiesto ausente y hay "${current.status}"` };
    }

    const published = publishExclusive({ path: manifestPath, bytes, dshRoot, operationId, hooks });
    if (published.ok !== true) {
      if (published.code === 'exists' && published.existingSha256 === manifestSha256) {
        return { ok: true, resumed: true, ...artifacts };
      }
      return published;
    }
    hooks.afterPublish?.({ published });
    return { ok: true, resumed: false, ...artifacts };
  } finally {
    lock.release();
  }
}

/** ¿Es un temporal propio, dentro del centro? La limpieza sólo toca lo que responde que sí. */
export function isOwnTemp(path, dshRoot) {
  if (typeof path !== 'string' || path === '') return false;
  if (isInside(dshRoot, path) !== true) return false;
  return /[\\/]\.lifecode-tmp-[a-z0-9-]{8,64}-\d{1,3}$/u.test(path);
}

/** Esquema de los artefactos de intención y marcador del fork (inmutables una vez publicados). */
export const FORK_INTENT_SCHEMA = 'lifecode-skill-center/fork-intent';
export const FORK_PUBLISHED_SCHEMA = 'lifecode-skill-center/fork-published';

/** Intención de fork: describe **qué** se va a publicar antes de tocar el manifiesto del proyecto. */
export function forkIntentPayload({ projectId, newUuid, previousSha256, now }) {
  return {
    schema: FORK_INTENT_SCHEMA,
    schemaVersion: 1,
    sourceUuid: projectId,
    newUuid,
    previousSha256: typeof previousSha256 === 'string' ? previousSha256 : '',
    createdAt: now,
  };
}

/** Marcador de publicación: se escribe **después** de publicar el manifiesto nuevo. */
export function forkPublishedPayload({ projectId, newUuid, manifestSha256, archivedSha256, now }) {
  return {
    schema: FORK_PUBLISHED_SCHEMA,
    schemaVersion: 1,
    sourceUuid: projectId,
    newUuid,
    manifestSha256,
    archivedSha256: typeof archivedSha256 === 'string' ? archivedSha256 : '',
    publishedAt: now,
  };
}

/**
 * Publica un artefacto JSON con la misma mecánica exclusiva de los manifiestos: temporal sincronizado,
 * verificación de huella y un único `link` como punto de publicación.
 */
export function writeJsonArtifact({ dshRoot, name, kind, payload, operationId, hooks, fs } = {}) {
  return publishExclusive({ path: join(dshRoot, name), bytes: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8'), dshRoot, kind, operationId, hooks, fs });
}

/** Lee un artefacto JSON sin interpretarlo más allá de su forma (no valida su contrato). */
export function readJsonArtifact({ dshRoot, name, fs } = {}) {
  const project = { ...nodeFs, ...fs };
  const path = join(dshRoot, name);
  let bytes;
  try {
    bytes = project.readFileSync(path);
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'unreadable', path, error: String(error.code ?? error.message) };
  }
  try {
    return { status: 'ok', path, sha256: sha256Hex(bytes), size: bytes.length, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    return { status: 'invalid', path, sha256: sha256Hex(bytes), size: bytes.length };
  }
}

/**
 * Nombre del manifiesto archivado de un fork. Lleva la marca de tiempo y el prefijo de la huella del
 * manifiesto original, de modo que la evidencia se puede volver a medir y no se confunde con otro archivo.
 */
export function archivedManifestName(sha256, now) {
  const stamp = String(now).replaceAll(/[-:.]/gu, '').replace(/^(\d{8})T(\d{6})(\d{3})Z$/u, '$1T$2Z');
  return `lifecode-skill-center.manifest-${stamp}-${String(sha256).slice(0, 8)}.json`;
}

/**
 * Fork del manifiesto de un proyecto, con el orden que se midió en LSC-020: intención → archivo por enlace
 * duro → retirada del nombre canónico → publicación del nuevo → marcador. Cada paso deja evidencia, y una
 * pasada posterior reanuda desde donde quedó en vez de repetir trabajo.
 */
export function forkProjectManifest({ dshRoot, manifestPath, manifest, now, operationId, hooks = {}, fs } = {}) {
  const project = { ...nodeFs, ...fs };
  // El fork archiva el manifiesto de origen y retira su nombre canónico. Si el origen está fuera del .dsh del
  // workspace, la operación borraría un archivo ajeno (D6): se comprueba antes de tocar el disco.
  const projected = checkProjectedFile({ dir: dirname(manifestPath), name: basename(manifestPath), dshRoot, kind: FILE_KINDS.manifest, fs: project });
  if (projected.ok !== true) return projected;
  const id = typeof operationId === 'string' && operationId.length > 0 ? operationId : newOperationId();
  const bytes = manifestBytes(manifest);
  const manifestSha256 = sha256Hex(bytes);
  const intentPath = join(dshRoot, 'lifecode-skill-center.fork-intent.json');
  const markerPath = join(dshRoot, 'lifecode-skill-center.fork-published.json');

  const lock = acquireWorkspaceLock({ dshRoot, operation: 'fork', operationId: id, now, fs });
  if (lock.ok !== true) return lock;
  try {
    const current = readManifest(manifestPath, project);
    const marker = readJsonArtifact({ dshRoot, name: 'lifecode-skill-center.fork-published.json', fs });
    const intent = readJsonArtifact({ dshRoot, name: 'lifecode-skill-center.fork-intent.json', fs });

    // Reanudación: el marcador ya existe y el manifiesto canónico ya es el nuevo.
    if (marker.status === 'ok' && marker.value?.manifestSha256 === manifestSha256 && current.status === 'ok' && current.sha256 === manifestSha256) {
      return { ok: true, resumed: true, operationId: id, manifestSha256, archivedFile: marker.value?.archivedFile ?? null, intentSha256: intent.sha256 ?? null, markerSha256: marker.sha256 };
    }
    if (current.status !== 'ok') {
      return { ok: false, code: `fork-source-${current.status}`, message: `el manifiesto actual no se puede archivar: ${current.status}` };
    }
    if (current.manifest?.projectId === manifest.projectId) {
      return { ok: false, code: 'fork-same-identity', message: 'el fork necesita una identidad nueva' };
    }

    // 1. Intención: describe el fork antes de tocar nada y es la pista para reanudar tras una interrupción.
    let intentSha256 = intent.sha256 ?? null;
    if (intent.status !== 'ok' || intent.value?.newUuid !== manifest.projectId) {
      const written = writeJsonArtifact({
        dshRoot,
        name: 'lifecode-skill-center.fork-intent.json',
        kind: FILE_KINDS.forkIntent,
        payload: forkIntentPayload({ projectId: current.manifest.projectId, newUuid: manifest.projectId, previousSha256: current.sha256, now }),
        operationId: id,
        hooks,
        fs: project,
      });
      if (written.ok !== true && written.code !== 'exists') return { ...written, operationId: id };
      intentSha256 = written.ok === true ? written.sha256 ?? null : intent.sha256 ?? null;
    }

    // 2. Archivo del original por enlace duro: mismos bytes, medibles, sin copiar.
    const archivedName = archivedManifestName(current.sha256, now);
    const archivedPath = join(dshRoot, archivedName);
    let archivedSha256 = null;
    if (!project.existsSync?.(archivedPath) && existsOf(project, archivedPath) === false) {
      try {
        project.linkSync(manifestPath, archivedPath);
      } catch (error) {
        if (error.code !== 'EEXIST') return { ok: false, code: 'fork-archive-failed', message: String(error.code ?? error.message) };
      }
      const archived = readManifest(archivedPath, project);
      archivedSha256 = archived.sha256 ?? null;
      if (archivedSha256 !== current.sha256) {
        return { ok: false, code: 'fork-archive-mismatch', message: 'el archivo no coincide con el manifiesto original' };
      }
      const archivedStats = project.lstatSync(archivedPath);
      const originalStats = project.lstatSync(manifestPath);
      if (archivedStats.dev !== originalStats.dev || archivedStats.ino !== originalStats.ino) {
        return { ok: false, code: 'fork-archive-identity', message: 'el archivo no es el mismo objeto que el original' };
      }
    } else {
      archivedSha256 = readManifest(archivedPath, project).sha256 ?? null;
    }
    hooks.afterArchive?.({ archivedPath });

    // 3. Retirar el nombre canónico sólo cuando la evidencia ya está verificada.
    if (current.status === 'ok') {
      try {
        project.unlinkSync(manifestPath);
      } catch (error) {
        if (error.code !== 'ENOENT') return { ok: false, code: 'fork-detach-failed', message: String(error.code ?? error.message) };
      }
    }
    hooks.afterDetach?.({ manifestPath });

    // 4. Publicar el nuevo manifiesto.
    const published = publishExclusive({ path: manifestPath, bytes, dshRoot, kind: FILE_KINDS.manifest, operationId: id, hooks, fs: project });
    if (published.ok !== true) return { ...published, operationId: id };

    // 5. Marcador de publicación.
    const markerWritten = writeJsonArtifact({
      dshRoot,
      name: 'lifecode-skill-center.fork-published.json',
      kind: FILE_KINDS.forkPublished,
      payload: forkPublishedPayload({ projectId: current.manifest.projectId, newUuid: manifest.projectId, manifestSha256, archivedSha256, now }),
      operationId: id,
      hooks,
      fs: project,
    });
    if (markerWritten.ok !== true && markerWritten.code !== 'exists') return { ...markerWritten, operationId: id };

    return {
      ok: true,
      resumed: false,
      operationId: id,
      manifestSha256,
      archivedFile: archivedName,
      archivedSha256,
      intentSha256,
      markerSha256: markerWritten.sha256 ?? null,
    };
  } finally {
    lock.release();
  }
}

/** Existe sin lanzar: `fs.existsSync` no está en el objeto inyectable de las pruebas. */

/** Evidencia de una reparación interrumpida: cuarentena ya escrita y legible. */
function findQuarantineEvidence(dshRoot, readManifestFn, project, { projectId = '' } = {}) {
  let names = [];
  try {
    names = project.readdirSync(dshRoot);
  } catch {
    return null;
  }
  for (const name of names) {
    if (basenameProblem(name, FILE_KINDS.quarantineManifest).ok !== true) continue;
    const read = readManifestFn(join(dshRoot, name), project);
    if (typeof read.sha256 !== 'string' || (read.status !== 'ok' && read.status !== 'invalid')) continue;
    // Dos condiciones de procedencia, para no adoptar un archivo ajeno que casualmente se llame igual:
    //  1) el nombre lleva el prefijo de la huella de **su propio** contenido;
    //  2) si el contenido es válido (el caso del defecto), declara el mismo proyecto que el manifiesto que
    //     se va a publicar. Si es inválido, no hay proyecto que comprobar: los bytes son la evidencia.
    if (String(name).includes(String(read.sha256).slice(0, 8)) !== true) continue;
    if (read.status === 'ok' && projectId !== '' && read.manifest?.projectId !== projectId) continue;
    return { name, sha256: read.sha256 };
  }
  return null;
}

function existsOf(fs, path) {
  try {
    fs.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
