/**
 * Sincronización por ámbito (PA5).
 *
 * Un ciclo observa **todas** las raíces autorizadas de un ámbito y reconcilia lo observado con lo que
 * el almacén ya tiene. Reglas que no se negocian:
 *
 * 1. Una observación incompleta (permisos, E/S, truncamiento por límite) **no** marca `missing`:
 *    `missing` sólo significa «recorrí la raíz entera y el fichero no estaba».
 * 2. `missing` no borra nada: conserva fuentes, chunks, vectores, etiquetas, auditoría y grants.
 *    El olvido definitivo sigue siendo una acción humana (`forget`).
 * 3. La reaparición con el mismo hash restaura `present` sin reindexar ni duplicar.
 * 4. Cada fichero se confirma en su propia transacción: una cancelación o un fallo deja lo anterior
 *    completo y lo siguiente sin empezar.
 * 5. El ciclo queda en el ledger `operations`/`operation_steps` (`kind='sync'`) y en la auditoría del
 *    registro y del ámbito.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

import { appendAudit } from './audit.mjs';
import { ftsIntegrityCheck, readMeta, withTransaction } from './db.mjs';
import { RagError } from './errors.mjs';
import { createEmbedder } from './embedders.mjs';
import { mimeOf } from './extract.mjs';
import { SKIP_DIRECTORIES } from './inputs.mjs';
import { ingestFiles } from './ingest.mjs';
import { beginOperation, finishOperation, listInterruptedOperations, recordStep } from './operations.mjs';
import { PROTECTED_SEGMENTS, isSensitiveName } from './policy.mjs';
import { appendRegistryAudit } from './registry.mjs';
import { openScopeStore } from './scope-stores.mjs';

export const SYNC_STATES = Object.freeze(['present', 'missing', 'unreadable']);
export const SYNC_OPERATION_KIND = 'sync';

/**
 * Reloj del presupuesto. Debe ser **monotónico**: `Date.now()` puede saltar hacia atrás (ajuste de
 * hora, NTP, cambio manual) y alargaría el tick sin límite, o saltar hacia delante y cortarlo antes de
 * tiempo. `performance.now()` no se ve afectado por el reloj del sistema. El reloj de pared
 * (`now`) se sigue usando para las marcas de tiempo que se guardan y se auditan.
 */
function defaultMonotonic() {
  return performance.now();
}

/** Clave estable de una fuente dentro de una raíz: ruta relativa en forma POSIX. */
export function sourceKeyOf(rootPath, filePath) {
  return relative(rootPath, filePath).split(sep).join('/');
}

/**
 * Recorre una raíz sin seguir enlaces y sin bajar a árboles que no aportan conocimiento.
 * Devuelve `complete:false` ante cualquier fallo o truncamiento: el llamador **no** puede deducir
 * desapariciones de un recorrido incompleto.
 */
export function walkRoot(rootPath, { limit = 20_000, skipDirectories = SKIP_DIRECTORIES } = {}) {
  const files = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const directory = stack.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (cause) {
      return {
        files,
        complete: false,
        error: { path: directory, code: cause?.code ?? 'source-unreadable', message: cause?.message ?? 'no se puede leer el directorio' },
      };
    }
    // Orden estable: el corte por `limit` debe recortar el MISMO subconjunto en cada pasada, o un
    // fichero puede no entrar nunca en el lote y el diagnóstico deja de ser reproducible.
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase();
        if (skipDirectories.has(lower) || PROTECTED_SEGMENTS.includes(lower)) continue;
        stack.push(child);
      } else if (entry.isFile()) {
        if (files.length >= limit) {
          return {
            files,
            complete: false,
            error: { path: rootPath, code: 'too-many-files', message: `la raíz supera el límite de ${limit} ficheros por pasada` },
          };
        }
        files.push(child);
      }
    }
  }
  return { files, complete: true, error: null };
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Lee un fichero y devuelve su huella. Nunca lanza: describe el fallo. */
export function probeFile(filePath, { maxBytes = null } = {}) {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return { ok: false, code: 'path-unsupported', message: 'no es un fichero regular' };
    // El límite se comprueba antes de leer: un fichero enorme no debe pagarse en cada pasada para
    // acabar rechazado (y reintentado) siempre por el mismo motivo.
    if (maxBytes !== null && stat.size > maxBytes) {
      return { ok: false, code: 'too-large', message: `el fichero supera ${maxBytes} bytes`, bytes: stat.size };
    }
    const bytes = readFileSync(filePath);
    return { ok: true, bytes: bytes.length, sha256: sha256Bytes(bytes) };
  } catch (error) {
    const code = error?.code === 'ENOENT' ? 'source-missing' : error?.code === 'EACCES' || error?.code === 'EPERM' ? 'source-unreadable' : 'source-unreadable';
    return { ok: false, code, message: error?.message ?? 'no se puede leer el fichero' };
  }
}

/** Filas de `sync_state` del ámbito, indexadas por `root_id \u0000 source_key`. */
export function readSyncRows(registryDb, { scopeKind, scopeId }) {
  const rows = registryDb
    .prepare(`SELECT root_id, source_key, status, last_seen_at, last_hash, missing_since, error_code, updated_at
      FROM sync_state WHERE scope_kind = ? AND scope_id = ?`)
    .all(scopeKind, scopeId);
  const map = new Map();
  for (const row of rows) map.set(`${row.root_id}\u0000${row.source_key}`, row);
  return map;
}

function writeSyncRow(registryDb, {
  scopeKind, scopeId, rootId, sourceKey, status, lastSeenAt = null, lastHash = null, missingSince = null, errorCode = null, now,
}) {
  if (!SYNC_STATES.includes(status)) {
    throw new RagError('invalid-argument', 'estado de sincronización inválido', { details: { status } });
  }
  registryDb.prepare(`INSERT INTO sync_state
    (scope_kind, scope_id, root_id, source_key, status, last_seen_at, last_hash, missing_since, error_code, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_kind, scope_id, root_id, source_key) DO UPDATE SET
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      last_hash = excluded.last_hash,
      missing_since = excluded.missing_since,
      error_code = excluded.error_code,
      updated_at = excluded.updated_at`)
    .run(scopeKind, scopeId, rootId, sourceKey, status,
      lastSeenAt === null ? null : String(lastSeenAt), lastHash, missingSince === null ? null : String(missingSince),
      errorCode, String(now));
}

/**
 * Publica en `sync_state` el resultado real de una ingesta.
 *
 * Sólo un fichero que la ingesta **confirmó** (`ingested` o `skipped`) se marca `present`; uno que
 * falló se marca `unreadable` conservando su hash anterior; y uno que no aparece en ninguna de las
 * dos listas se deja como estaba para que la pasada siguiente lo reintente. La regla importa: marcar
 * `present` antes de ingerir (dentro de `authorize`) permitía que un corte del proceso publicara el
 * hash nuevo sin la fuente, y la pasada siguiente lo leía como «sin cambios» y no lo indexaba nunca.
 *
 * @returns {{present:number, unreadable:number}} cuántas filas se publicaron de cada clase.
 */
export function markSyncOutcome({ registryDb, scopeKind, scopeId, batch, result, started }) {
  const confirmed = new Map();
  for (const entry of [...(result.ingested ?? []), ...(result.skipped ?? [])]) {
    if (typeof entry?.uri === 'string') confirmed.set(entry.uri, entry);
  }
  const failed = new Map();
  for (const error of result.errors ?? []) {
    if (typeof error?.path === 'string') failed.set(error.path, error);
  }
  let present = 0;
  let unreadable = 0;
  for (const item of batch) {
    if (confirmed.has(item.abs)) {
      withTransaction(registryDb, () => writeSyncRow(registryDb, {
        scopeKind, scopeId, rootId: item.rootId, sourceKey: item.key, status: 'present',
        lastSeenAt: started, lastHash: item.sha256, missingSince: null, errorCode: null, now: started,
      }));
      present += 1;
      continue;
    }
    const error = failed.get(item.abs);
    if (!error) continue;
    withTransaction(registryDb, () => writeSyncRow(registryDb, {
      scopeKind, scopeId, rootId: item.rootId, sourceKey: item.key, status: 'unreadable',
      lastSeenAt: started, lastHash: item.previous?.last_hash ?? null, missingSince: null,
      errorCode: error.code ?? 'internal', now: started,
    }));
    unreadable += 1;
  }
  return { present, unreadable };
}

/**
 * Publica en `sync_state` lo que el almacén del ámbito **demuestra** que ya está indexado.
 *
 * Se usa cuando la ingesta no llega a devolver su resultado (cancelación, revocación o fallo fatal):
 * `ingestFiles` confirma una transacción por fichero, así que «lo que está en `sources` con ese
 * hash» es exactamente lo confirmado. El resto se queda sin marca y la pasada siguiente lo reintenta.
 */
export function reconcileSyncFromStore({ registryDb, store, scopeKind, scopeId, batch, started }) {
  let present = 0;
  for (const item of batch) {
    const row = store
      .prepare('SELECT 1 AS ok FROM sources WHERE uri = ? AND sha256 = ? LIMIT 1')
      .get(item.abs, item.sha256);
    if (!row) continue;
    withTransaction(registryDb, () => writeSyncRow(registryDb, {
      scopeKind, scopeId, rootId: item.rootId, sourceKey: item.key, status: 'present',
      lastSeenAt: started, lastHash: item.sha256, missingSince: null, errorCode: null, now: started,
    }));
    present += 1;
  }
  return { present };
}

/** Estado de sincronización agregado por ámbito, para `sync status`. */export function syncStatus(registryDb, { scopeKind, scopeId } = {}) {
  const where = scopeKind && scopeId ? 'WHERE scope_kind = ? AND scope_id = ?' : '';
  const params = scopeKind && scopeId ? [scopeKind, scopeId] : [];
  const rows = registryDb
    .prepare(`SELECT scope_kind, scope_id, status, COUNT(*) AS n, MAX(updated_at) AS last_at
      FROM sync_state ${where} GROUP BY scope_kind, scope_id, status ORDER BY scope_kind, scope_id, status`)
    .all(...params);
  return rows.map((row) => ({ scope_kind: row.scope_kind, scope_id: row.scope_id, status: row.status, count: row.n, last_at: row.last_at }));
}

/**
 * Comprueba que el ámbito se puede sincronizar **ahora**.
 *
 * La sincronización la ejecuta el perfil (humano o automatización), no una consulta del modelo, así que
 * no consulta grants. Sí respeta el ciclo de vida: ámbito archivado, raíz revocada o sesión caída paran
 * el ciclo. Cuando la pasada la inicia una sesión (`sessionId`), se revalida también su autorización
 * vigente para no seguir trabajando para una sesión que ya perdió el ámbito.
 */
export function assertScopeSyncable({ registryDb, scope, sessionId = null, now = Date.now } = {}) {
  const table = scope.kind === 'prj' ? 'projects' : 'libraries';
  const row = registryDb.prepare(`SELECT id, name, status FROM ${table} WHERE id = ?`).get(scope.id);
  if (!row) {
    throw new RagError('scope-forbidden', 'el ámbito no existe en el registro', { details: { scope_id: scope.id, scope_kind: scope.kind } });
  }
  if (row.status !== 'active') {
    throw new RagError('scope-forbidden', 'el ámbito está archivado y no se sincroniza', {
      details: { scope_id: scope.id, scope_kind: scope.kind, reason: scope.kind === 'prj' ? 'project-archived' : 'library-archived' },
    });
  }
  const roots = registryDb
    .prepare(`SELECT id, path, state FROM roots WHERE scope_kind = ? AND scope_id = ? AND state = 'authorized' ORDER BY path`)
    .all(scope.kind, scope.id);
  if (roots.length === 0) {
    throw new RagError('sync-root-unavailable', 'el ámbito no tiene raíces autorizadas', {
      details: { scope_id: scope.id, scope_kind: scope.kind, reason: 'no-roots' },
    });
  }
  if (sessionId) {
    const session = registryDb.prepare('SELECT session_id, project_id, state FROM session_scope WHERE session_id = ?').get(sessionId);
    if (!session) {
      throw new RagError('session-invalid', 'la sesión que inició la sincronización no existe', { details: { session_id: sessionId } });
    }
    if (session.state !== 'active') {
      throw new RagError('session-expired', 'la sesión que inició la sincronización ya no está activa', {
        details: { session_id: sessionId, state: session.state },
      });
    }
    if (scope.kind === 'lib') {
      const grant = registryDb
        .prepare('SELECT id FROM grants WHERE project_id = ? AND library_id = ? AND revoked_at IS NULL')
        .get(session.project_id, scope.id);
      if (!grant) {
        throw new RagError('grant-revoked', 'la biblioteca ya no está concedida al proyecto de la sesión', {
          details: { session_id: sessionId, scope_id: scope.id, scope_kind: 'lib', reason: 'grant-revoked' },
        });
      }
    }
  }
  return { scope: { kind: scope.kind, id: scope.id, name: row.name }, roots };
}

/** Verificación de integridad del almacén tras aplicar cambios. */
export function verifyScopeStore(db, { model = null, checkFts = true } = {}) {
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;
  const counts = {
    sources: count('SELECT COUNT(*) AS n FROM sources'),
    chunks: count('SELECT COUNT(*) AS n FROM chunks'),
    vectors: count('SELECT COUNT(*) AS n FROM vectors'),
  };
  const orphans = count('SELECT COUNT(*) AS n FROM chunks c LEFT JOIN sources s ON s.id = c.source_id WHERE s.id IS NULL');
  const missingVectors = model
    ? count('SELECT COUNT(*) AS n FROM chunks c LEFT JOIN vectors v ON v.chunk_key = c.chunk_key AND v.model = ? WHERE v.chunk_key IS NULL', model)
    : 0;
  // `integrity-check` de FTS es O(índice): se paga sólo cuando la pasada escribió, no en cada tick.
  if (checkFts) ftsIntegrityCheck(db);
  return { counts, orphans, missingVectors, fts: checkFts ? 'ok' : 'not-checked' };
}

/**
 * Un ciclo de sincronización sobre un ámbito.
 *
 * @returns {Promise<{scope_kind:string, scope_id:string, operation:string|null, dry_run:boolean,
 *   scanned:number, observed:number, unchanged:number, new:number, changed:number, missing:number,
 *   unreadable:number, ingested:number, skipped:number, failed:number, cancelled:boolean,
 *   complete:boolean, roots:Array, verification:object|null, ms:number, errors:Array}>}
 */
export async function syncScope({
  registryDb, profileRoot, profileKey, scope, config, embedder = null, now = Date.now, signal = null,
  limit = null, budgetMs = null, monotonic = null, actor = 'automation', sessionId = null, dryRun = false,
} = {}) {
  if (!registryDb) throw new RagError('invalid-argument', 'la sincronización necesita el registro abierto');
  if (!profileRoot || !profileKey) throw new RagError('invalid-argument', 'la sincronización necesita el perfil resuelto');

  const started = now();
  const maxFiles = Math.max(1, limit ?? config?.automation?.maxFilesPerRun ?? 50);
  // Presupuesto de tiempo del tick (M6.7). `Infinity` = sin presupuesto (CLI y pruebas de motor).
  // El presupuesto se mide con reloj MONOTÓNICO (M6.8, R-07): un ajuste del reloj del sistema no puede
  // alargar ni acortar el tick. `started` (reloj de pared) sigue siendo la marca que se persiste.
  const budget = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : null;
  const clock = typeof monotonic === 'function' ? monotonic : defaultMonotonic;
  const deadline = budget === null ? Infinity : clock() + budget;
  const scopeKind = scope.kind;
  const scopeId = scope.id;
  const target = `${scopeKind}:${scopeId}`;
  const summary = {
    scope_kind: scopeKind, scope_id: scopeId, operation: null, dry_run: dryRun === true,
    scanned: 0, observed: 0, unchanged: 0, new: 0, changed: 0, missing: 0, unreadable: 0, unsupported: 0, reappeared: 0,
    sensitive: 0,
    ingested: 0, skipped: 0, failed: 0, cancelled: false, complete: true, outcome: null,
    budget_ms: budget, budget_exhausted: false, stop_reason: null,
    roots: [], verification: null, ms: 0, errors: [],
  };

  const { roots } = assertScopeSyncable({ registryDb, scope, sessionId, now });
  summary.roots = roots.map((root) => ({ root_id: root.id, path: root.path }));

  // El modelo se toma del proveedor REAL, no de la config en crudo: con un proveedor remoto la
  // etiqueta guardada en `vectors.model` es `remote:<modelo>` y comparar contra el nombre de la
  // configuración marcaría todos los chunks como «sin vector» y el ámbito como corrupto.
  //
  // Compuerta de egreso: un proveedor remoto sólo se usa si la capa que llama ya lo construyó tras
  // una aprobación humana. La sincronización automática no tiene canal de aprobación, así que no
  // puede enviar texto a un tercero por su cuenta (antes lo hacía: `createEmbedder` sin `requireEgress`).
  // Se decide ANTES de abrir la operación: un rechazo no debe dejar una fila `started` mintiendo.
  const localEmbedder = config?.embedding?.provider === 'local-hash-v1' || !config?.embedding?.provider;
  const provider = embedder ?? (localEmbedder ? createEmbedder(config) : null);
  if (!provider) {
    throw new RagError('egress-denied', 'la sincronización no puede usar un proveedor de embedding remoto sin aprobación', {
      details: { reason: 'automation-egress', provider: config?.embedding?.provider ?? null },
    });
  }
  const model = provider?.model ?? config?.embedding?.provider ?? null;

  // Una pasada anterior interrumpida no se repite a ciegas: se cierra como `reconciled` y se documenta.
  // La sincronización es idempotente (por hash), pero la fila abierta no puede quedar mintiendo.
  for (const interrupted of listInterruptedOperations(registryDb, { kind: SYNC_OPERATION_KIND })) {
    let previous = null;
    try { previous = interrupted.detail ? JSON.parse(interrupted.detail) : null; } catch { previous = null; }
    if (previous?.scope_id !== scopeId || previous?.scope_kind !== scopeKind) continue;
    finishOperation(registryDb, {
      operationId: interrupted.id,
      state: 'reconciled',
      now: started,
      detail: { ...(previous ?? {}), reason: 'sync-interrumpida-reconciliada', reconciled_at: started },
    });
  }

  const operation = dryRun
    ? null
    : beginOperation(registryDb, { kind: SYNC_OPERATION_KIND, now: started, detail: { scope_kind: scopeKind, scope_id: scopeId } });
  if (operation) summary.operation = operation.id;

  const rows = readSyncRows(registryDb, { scopeKind, scopeId });
  const observations = new Map();
  const observedKeys = new Set();
  const seenRoots = new Set();
  // Un único handle para comprobar presencia: se abre la primera vez que hace falta.
  let presenceStore;
  const presenceStoreOpen = () => {
    if (presenceStore === undefined) {
      try {
        presenceStore = openScopeStore({ profileRoot, profileKey, scope: { kind: scopeKind, id: scopeId }, create: false, now: started });
      } catch {
        presenceStore = null;
      }
    }
    return presenceStore ?? null;
  };

  try {
    // ---- Observar ----
    for (const root of roots) {
      if (signal?.aborted) { summary.cancelled = true; break; }
      const walkLimit = Math.max(maxFiles * 20, 1_000);
      const walk = walkRoot(root.path, { limit: walkLimit });
      summary.scanned += walk.files.length;
      if (!walk.complete) {
        summary.complete = false;
        summary.errors.push({ root_id: root.id, path: walk.error?.path ?? root.path, code: walk.error?.code ?? 'sync-root-unavailable', message: walk.error?.message ?? 'recorrido incompleto' });
        summary.roots[summary.roots.findIndex((item) => item.root_id === root.id)] = { root_id: root.id, path: root.path, complete: false, error: walk.error ?? null };
        // Recorrido incompleto: esta raíz NO entra en `seenRoots`, así que no puede deducir
        // desapariciones. Pero el prefijo que sí se recorrió se procesa igual: descartarlo dejaba la
        // raíz sin sincronizar nunca y, con el walk cortado siempre en el mismo punto, sin avance.
      } else {
        seenRoots.add(root.id);
        summary.roots[summary.roots.findIndex((item) => item.root_id === root.id)] = { root_id: root.id, path: root.path, complete: true, files: walk.files.length };
      }
      for (const file of walk.files) {
        const key = `${root.id}\u0000${sourceKeyOf(root.path, file)}`;
        if (observedKeys.has(key)) continue;
        observedKeys.add(key);
        observations.set(key, { rootId: root.id, rootPath: root.path, abs: file, key: sourceKeyOf(root.path, file), previous: rows.get(key) ?? null });
      }
    }

    // ---- Planificar ----
    const pending = [];
    const maxBytes = Number.isInteger(config?.maxFileBytes) ? config.maxFileBytes : null;
    for (const [key, item] of observations) {
      // Nombre con forma de secreto (`.env`, `*.pem`, `id_rsa`…). Se excluye por política y se cuenta
      // aparte: el índice no guarda credenciales y el operador ve cuántos ficheros se dejaron fuera.
      // No se marca `unreadable`: no es un fallo, es una exclusión deliberada y estable.
      if (isSensitiveName(basename(item.abs))) {
        summary.sensitive += 1;
        continue;
      }
      // Formato que el extractor no soporta (binarios, `.sqlite3`, imágenes…). El motor no puede
      // indexarlo: no se lee, no se marca `unreadable` y no se reintenta en cada pasada. Se cuenta
      // aparte para que el resultado siga siendo verificable y el recuento sea explícito.
      if (mimeOf(item.abs) === undefined) {
        summary.unsupported += 1;
        continue;
      }
      const probe = probeFile(item.abs, { maxBytes });
      if (!probe.ok) {
        summary.unreadable += 1;
        if (!dryRun) {
          withTransaction(registryDb, () => writeSyncRow(registryDb, {
            scopeKind, scopeId, rootId: item.rootId, sourceKey: item.key, status: 'unreadable',
            lastSeenAt: started, lastHash: item.previous?.last_hash ?? null, missingSince: null,
            errorCode: probe.code, now: started,
          }));
        }
        summary.errors.push({ path: item.abs, code: probe.code, message: probe.message });
        continue;
      }
      summary.observed += 1;
      const previous = item.previous;
      const restored = previous?.status === 'missing';
      // «Sin cambios» exige que el estado anterior fuera `present`: un `unreadable` con el mismo hash
      // no demuestra que la fuente esté indexada.
      if (previous && previous.status === 'present' && previous.last_hash === probe.sha256) {
        summary.unchanged += 1;
        if (!dryRun) {
          withTransaction(registryDb, () => writeSyncRow(registryDb, {
            scopeKind, scopeId, rootId: item.rootId, sourceKey: item.key, status: 'present',
            lastSeenAt: started, lastHash: probe.sha256, missingSince: null, errorCode: null, now: started,
          }));
        }
        continue;
      }
      const sourceExists = scopeHasSource({ store: presenceStoreOpen(), profileRoot, profileKey, scope, uri: item.abs, sha256: probe.sha256 });
      if (sourceExists === 'same') {
        // Reaparición con el mismo hash: se restaura `present` sin reindexar ni duplicar.
        if (restored) summary.reappeared += 1;
        else summary.unchanged += 1;
        if (!dryRun) {
          withTransaction(registryDb, () => writeSyncRow(registryDb, {
            scopeKind, scopeId, rootId: item.rootId, sourceKey: item.key, status: 'present',
            lastSeenAt: started, lastHash: probe.sha256, missingSince: null, errorCode: null, now: started,
          }));
        }
        continue;
      }
      if (previous?.last_hash && previous.last_hash !== probe.sha256) summary.changed += 1;
      else summary.new += 1;
      pending.push({ ...item, sha256: probe.sha256, bytes: probe.bytes });
    }

    // ---- Desapariciones (sólo con observación completa de su raíz) ----
    for (const [key, row] of rows) {
      if (row.status === 'missing') continue;
      const [rootId, sourceKey] = key.split('\u0000');
      if (!seenRoots.has(rootId)) continue;
      if (observedKeys.has(key)) continue;
      summary.missing += 1;
      if (dryRun) continue;
      withTransaction(registryDb, () => writeSyncRow(registryDb, {
        scopeKind, scopeId, rootId, sourceKey, status: 'missing',
        lastSeenAt: started, lastHash: row.last_hash, missingSince: started, errorCode: null, now: started,
      }));
    }

    if (operation) recordStep(registryDb, { operationId: operation.id, step: 'observe', now: started, effectKey: `${operation.id}:observe` });

    // ---- Aplicar ----
    if (!dryRun && pending.length > 0) {
      if (signal?.aborted) summary.cancelled = true;
      else if (budget !== null && clock() >= deadline) {
        // El presupuesto se agotó durante la observación: no se abre siquiera el lote. El trabajo queda
        // pendiente para el siguiente tick, sin marcar nada como indexado.
        summary.budget_exhausted = true;
        summary.complete = false;
      } else {
        const db = openScopeStore({ profileRoot, profileKey, scope: { kind: scopeKind, id: scopeId }, create: true, now: started });
        try {
          const batch = pending.slice(0, maxFiles);
          let result = null;
          let budgetStopped = false;
          try {
            result = await ingestFiles({
              db,
              files: batch.map((item) => item.abs),
              collection: 'default',
              now: started,
              config,
              embedder: provider,
              actor,
              authorize: async (file) => {
                if (signal?.aborted) {
                  throw new RagError('cancelled', 'la sincronización se canceló', { details: { reason: 'signal-aborted', where: 'sync:file' } });
                }
                // Presupuesto del tick: se corta entre fichero y fichero, nunca a mitad de una
                // transacción. Se lanza desde `authorize` (antes de preparar el fichero), así que
                // `ingestFiles` no llega a escribir nada del fichero siguiente.
                if (budget !== null && clock() >= deadline) {
                  throw new RagError('cancelled', 'la sincronización agotó el presupuesto del tick', {
                    details: { reason: 'budget-exhausted', where: 'sync:file', budget_ms: budget },
                  });
                }
                // Revalidación por fichero: una revocación o un archivado a mitad para el ciclo.
                assertScopeSyncable({ registryDb, scope, sessionId, now });
              },
            });
          } catch (error) {
            // Una ingesta interrumpida no devuelve lista de confirmados: se publica lo que el almacén
            // demuestra que sí entró (una transacción por fichero), y el resto queda para reintentar.
            const recovered = reconcileSyncFromStore({ registryDb, store: db, scopeKind, scopeId, batch, started });
            if (recovered.present > 0) summary.ingested += recovered.present;
            if (error?.details?.reason === 'budget-exhausted') {
              // Agotar el presupuesto no es un fallo del ámbito: la pasada es parcial y lo confirmado
              // se conserva. Se anota el paso `apply` para que el ledger no quede a medias.
              budgetStopped = true;
              summary.budget_exhausted = true;
              summary.complete = false;
            } else {
              throw error;
            }
          }
          if (budgetStopped) {
            if (operation) recordStep(registryDb, { operationId: operation.id, step: 'apply', now: now(), effectKey: `${operation.id}:apply` });
          } else {
            // `sync_state` se marca DESPUÉS de la ingesta. Marcarlo antes (dentro de `authorize`) dejaba
            // una ventana en la que un corte del proceso publicaba `present` con el hash nuevo sin que
            // la fuente existiera: la pasada siguiente lo veía «sin cambios» y nunca se indexaba.
            markSyncOutcome({ registryDb, scopeKind, scopeId, batch, result, started });
            summary.ingested = result.ingested.length;
            summary.skipped = result.skipped.length;
            summary.failed = result.errors.length;
            for (const error of result.errors) summary.errors.push(error);
            if (pending.length > batch.length) {
              summary.complete = false;
              summary.errors.push({ path: null, code: 'too-many-files', message: `quedan ${pending.length - batch.length} ficheros para la siguiente pasada` });
            }
            if (operation) recordStep(registryDb, { operationId: operation.id, step: 'apply', now: now(), effectKey: `${operation.id}:apply` });
          }
        } finally {
          try { db.close(); } catch { /* cerrar dos veces no es un fallo */ }
        }
      }
    }

    // ---- Verificar ----
    // Se verifica SIEMPRE, haya o no ingesta: una pasada sin cambios también debe detectar huérfanos y
    // vectores perdidos. La comprobación cara de FTS sólo se paga cuando la pasada escribió algo.
    const verificationDb = openScopeStore({ profileRoot, profileKey, scope: { kind: scopeKind, id: scopeId }, create: false, now: started });
    if (verificationDb) {
      try {
        summary.verification = verifyScopeStore(verificationDb, { model, checkFts: pending.length > 0 });
      } finally {
        try { verificationDb.close(); } catch { /* doble cierre */ }
      }
      if (summary.verification.orphans > 0 || summary.verification.missingVectors > 0) {
        throw new RagError('scope-store-corrupt', 'la verificación posterior a la sincronización encontró incoherencias', {
          details: { scope_id: scopeId, scope_kind: scopeKind, ...summary.verification },
        });
      }
      if (operation) recordStep(registryDb, { operationId: operation.id, step: 'verify', now: now(), effectKey: `${operation.id}:verify` });
    }

    summary.ms = Math.max(0, now() - started);
    // Un único predicado de éxito para el ledger, la auditoría y el CLI. `too-many-files` no es un
    // fallo por sí mismo, pero una pasada que dejó trabajo pendiente tampoco es un éxito completo.
    const realErrors = summary.errors.filter((error) => error.code !== 'too-many-files');
    summary.outcome = summary.cancelled ? 'skipped' : realErrors.length > 0 ? 'failed' : summary.complete ? 'ok' : 'partial';
    // Motivo de finalización, para que la observabilidad no tenga que deducirlo de los recuentos.
    summary.stop_reason = summary.cancelled
      ? 'cancelled'
      : realErrors.length > 0
        ? 'error'
        : summary.budget_exhausted
          ? 'budget'
          : summary.complete
            ? 'complete'
            : 'file-limit';
    if (operation) {
      finishOperation(registryDb, {
        operationId: operation.id,
        // M6.7 §6: alcanzar el límite de ficheros o el presupuesto no es un fallo del ledger. Todos
        // los pasos terminaron y cada efecto quedó confirmado; lo que falta es trabajo para el tick
        // siguiente, y eso queda escrito en `detail.complete`. Antes se cerraba `failed`, que se leía
        // como error de sincronización cuando no había ninguno (hallazgo de M6.5).
        state: summary.cancelled || realErrors.length > 0 ? 'failed' : 'committed',
        now: now(),
        detail: { ...summary, errors: summary.errors.slice(0, 20) },
      });
    }
    return summary;
  } catch (error) {
    summary.ms = Math.max(0, now() - started);
    if (error?.code === 'cancelled') summary.cancelled = true;
    if (operation) {
      try {
        finishOperation(registryDb, { operationId: operation.id, state: 'failed', now: now(), detail: { ...summary, failure: { code: error?.code ?? 'internal', message: error?.message ?? '' } } });
      } catch { /* la operación no puede ocultar el fallo original */ }
    }
    if (error instanceof RagError) throw error;
    throw new RagError('internal', `la sincronización falló: ${error?.message ?? 'error desconocido'}`, { cause: error });
  } finally {
    if (presenceStore) { try { presenceStore.close(); } catch { /* doble cierre */ } }
    // Auditoría en los dos dominios. Nunca puede convertir un ciclo correcto en un fallo.
    try {
      if (!dryRun) {
        const outcome = summary.outcome === 'partial' ? 'skipped' : summary.outcome ?? (summary.cancelled ? 'skipped' : summary.failed > 0 ? 'failed' : 'ok');
        appendRegistryAudit(registryDb, {
          at: now(),
          actor,
          session_id: sessionId,
          action: 'sync.run',
          target: scopeId,
          outcome,
          detail: { scope_kind: scopeKind, ...summary, errors: summary.errors.slice(0, 20) },
        });
      }
    } catch { /* la auditoría del registro no puede tumbar el ciclo */ }
    try {
      if (!dryRun && summary.observed + summary.missing > 0) {
        const db = openScopeStore({ profileRoot, profileKey, scope: { kind: scopeKind, id: scopeId }, create: false, now: now() });
        if (db) {
          try {
            withTransaction(db, () => appendAudit(db, {
              at: now(),
              actor,
              sessionId,
              tool: 'lifecode_rag_sync',
              action: 'sync.run',
              target: scopeId,
              outcome: (summary.outcome === 'partial' ? 'skipped' : summary.outcome) ?? (summary.cancelled ? 'skipped' : summary.failed > 0 ? 'failed' : 'ok'),
              details: { new: summary.new, changed: summary.changed, missing: summary.missing, unchanged: summary.unchanged, ingested: summary.ingested, failed: summary.failed },
            }));
          } finally {
            try { db.close(); } catch { /* idem */ }
          }
        }
      }
    } catch { /* idem */ }
  }
}

/** ¿El almacén ya tiene una fuente con esta URI y hash? Devuelve `'same'`, `'different'` o `null`. */
function scopeHasSource({ store, profileRoot, profileKey, scope, uri, sha256 }) {
  // Si la pasada ya tiene el almacén abierto, se reutiliza: abrir y cerrar por fichero ejecuta
  // `quick_check`, la validación de FTS y la cabeza de auditoría una vez por fichero observado.
  let db = store ?? null;
  const owns = db === null;
  try {
    if (!db) db = openScopeStore({ profileRoot, profileKey, scope: { kind: scope.kind, id: scope.id }, create: false });
    if (!db) return null;
    const row = db.prepare('SELECT sha256 FROM sources WHERE uri = ?').get(uri);
    if (!row) return null;
    return row.sha256 === sha256 ? 'same' : 'different';
  } catch {
    return null;
  } finally {
    if (owns && db) { try { db.close(); } catch { /* idem */ } }
  }
}

/**
 * Ámbitos activos con al menos una raíz autorizada: lo que una pasada automática puede tocar.
 * Un ámbito sin raíces no tiene nada que sincronizar y no se incluye (no es un error).
 */
export function activeSyncScopes(registryDb) {
  const rows = registryDb
    .prepare(`SELECT scope_kind, scope_id, COUNT(*) AS roots FROM roots WHERE state = 'authorized' GROUP BY scope_kind, scope_id`)
    .all();
  if (rows.length === 0) return [];
  const scopes = [];
  for (const row of rows) {
    const table = row.scope_kind === 'prj' ? 'projects' : 'libraries';
    const item = registryDb.prepare(`SELECT id, name, status FROM ${table} WHERE id = ?`).get(row.scope_id);
    if (!item || item.status !== 'active') continue;
    scopes.push({ kind: row.scope_kind, id: item.id, name: item.name, roots: row.roots });
  }
  return scopes.sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`));
}

/**
 * Sincronización de varios ámbitos: secuencial a propósito. Un perfil puede tener hasta ocho ámbitos
 * abiertos, pero sincronizar en paralelo multiplicaría la contención de escritura sin ganar nada.
 */
export async function syncScopes({ registryDb, profileRoot, profileKey, scopes, config, embedder = null, now = Date.now, signal = null, limit = null, budgetMs = null, monotonic = null, actor = 'automation', sessionId = null, dryRun = false }) {
  const results = [];
  for (const scope of scopes) {
    if (signal?.aborted) break;
    try {
      results.push(await syncScope({ registryDb, profileRoot, profileKey, scope, config, embedder, now, signal, limit, budgetMs, monotonic, actor, sessionId, dryRun }));
    } catch (error) {
      if (signal?.aborted) break;
      results.push({
        scope_kind: scope.kind, scope_id: scope.id, operation: null, dry_run: dryRun === true,
        scanned: 0, observed: 0, unchanged: 0, new: 0, changed: 0, missing: 0, unreadable: 0, unsupported: 0, reappeared: 0,
        ingested: 0, skipped: 0, failed: 1, cancelled: false, complete: false, roots: [], verification: null,
        ms: 0, errors: [{ path: null, code: error?.code ?? 'internal', message: error?.message ?? 'fallo de sincronización' }],
      });
    }
  }
  return results;
}

/**
 * Al olvidar una fuente su fila de `sync_state` quedaría diciendo `present` de algo que ya no está en
 * el almacén: la pasada siguiente lo vería «sin cambios» y el fichero no se reindexaría nunca.
 * Devuelve cuántas filas se descartaron.
 */
export function clearSyncState({ registryDb, scopeKind, scopeId, roots = [], uri }) {
  if (!registryDb || !uri) return 0;
  let cleared = 0;
  for (const root of roots) {
    if (!root?.path) continue;
    const key = sourceKeyOf(root.path, uri);
    if (key === '..' || key.startsWith('../')) continue;
    const info = registryDb
      .prepare('DELETE FROM sync_state WHERE scope_kind = ? AND scope_id = ? AND root_id = ? AND source_key = ?')
      .run(scopeKind, scopeId, root.id, key);
    cleared += Number(info?.changes ?? 0);
  }
  return cleared;
}

/** Metadatos de sincronización del almacén para diagnóstico (no cambia nada). */
export function storeSyncMeta(db) {
  return {
    scope_id: readMeta(db, 'scope_id'),
    store_state: readMeta(db, 'store_state'),
    index_revision: readMeta(db, 'index_revision'),
  };
}
