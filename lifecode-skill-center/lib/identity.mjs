/**
 * Clasificador de identidad de proyectos (LSC‑023 → LSC‑025).
 *
 * Un solo resultado por ruta, decidido en este orden (el orden **es** la precedencia, no una lista de
 * comprobaciones sueltas): fork-conflict, uuid-duplicated, path-conflict, los cuatro estados de fork
 * incompleto, fork-registered, detached-manifest, linked/adopted/moved-manifest, manifest-future,
 * manifest-invalid, manifest-missing, legacy-manifest-only, manifest-only, unmanaged, identity-unknown.
 *
 * Reglas que este módulo hace cumplir y que son fáciles de romper sin querer:
 * - el manifiesto **no** aporta ruta: sólo `projectId` y `registeredAt`; toda ruta sale del registro o
 *   de `workspaceRegistry`;
 * - `moved-manifest` exige UUID igual, **huella vigente igual** y ausencia **comprobada** de la ruta
 *   antigua; con inventario incompleto no se afirma;
 * - con inventario incompleto **no** se emite `uuid-duplicated` por una posibilidad: la duplicidad
 *   exige dos apariciones leídas;
 * - `verification` es la integridad de la comprobación **global**, no la lectura del workspace actual.
 */
import { normalizeCwd } from './format.mjs';

/** Los 19 estados. `security-veto` no es un estado: detiene antes de clasificar. */
export const IDENTITY_STATES = {
  forkConflict: 'fork-conflict',
  uuidDuplicated: 'uuid-duplicated',
  pathConflict: 'path-conflict',
  forkIntentOnly: 'fork-intent-only',
  forkManifestArchived: 'fork-manifest-archived',
  forkManifestPublished: 'fork-manifest-published',
  forkPublished: 'fork-published',
  forkRegistered: 'fork-registered',
  detachedManifest: 'detached-manifest',
  linked: 'linked',
  adopted: 'adopted',
  movedManifest: 'moved-manifest',
  manifestFuture: 'manifest-future',
  manifestInvalid: 'manifest-invalid',
  manifestMissing: 'manifest-missing',
  legacyManifestOnly: 'legacy-manifest-only',
  manifestOnly: 'manifest-only',
  unmanaged: 'unmanaged',
  identityUnknown: 'identity-unknown',
};

/** Orden de evaluación, público para que las pruebas puedan afirmarlo. */
export const STATE_PRECEDENCE = [
  IDENTITY_STATES.forkConflict,
  IDENTITY_STATES.uuidDuplicated,
  IDENTITY_STATES.pathConflict,
  IDENTITY_STATES.forkIntentOnly,
  IDENTITY_STATES.forkManifestArchived,
  IDENTITY_STATES.forkManifestPublished,
  IDENTITY_STATES.forkPublished,
  IDENTITY_STATES.forkRegistered,
  IDENTITY_STATES.detachedManifest,
  IDENTITY_STATES.linked,
  IDENTITY_STATES.adopted,
  IDENTITY_STATES.movedManifest,
  IDENTITY_STATES.manifestFuture,
  IDENTITY_STATES.manifestInvalid,
  IDENTITY_STATES.manifestMissing,
  IDENTITY_STATES.legacyManifestOnly,
  IDENTITY_STATES.manifestOnly,
  IDENTITY_STATES.unmanaged,
  IDENTITY_STATES.identityUnknown,
];

export const AVAILABILITY = { ok: 'ok', missingDir: 'missing-dir', unknown: 'unknown' };
export const VERIFICATION = { verified: 'verified', unverified: 'unverified' };
export const AUDIT = { ok: 'ok', gap: 'audit-gap', unknown: 'unknown' };
export const INVENTORY = { complete: 'complete', incomplete: 'incomplete' };
export const UNIQUENESS = { unique: 'unique', duplicated: 'duplicated', unverified: 'unverified' };
export const OPERATIONS = {
  link: 'link',
  adopt: 'adopt',
  unlink: 'unlink',
  relink: 'relink',
  move: 'move',
  fork: 'fork',
  repair: 'repair',
  reconcile: 'reconcile',
};

/** Códigos de motivo: texto estable para la UI, no frases construidas al vuelo. */
export const REASONS = {
  inventoryIncomplete: 'inventory-incomplete',
  inventoryUnreadable: 'inventory-unreadable',
  noRegistry: 'inventory-no-registry',
  pathUnreadable: 'path-unreadable',
  pathContained: 'path-contained',
  duplicateRecordPath: 'duplicate-record-path',
  duplicateWorkspacePath: 'duplicate-workspace-path',
  duplicateUuid: 'duplicate-uuid',
  manifestUuidElsewhere: 'manifest-uuid-elsewhere',
  manifestHashDiffers: 'manifest-hash-differs',
  manifestHashMatches: 'manifest-hash-matches',
  manifestRegisteredAtDiffers: 'manifest-registered-at-differs',
  legacyRecord: 'legacy-record-without-uuid',
  noRecord: 'no-record',
  noManifest: 'no-manifest',
  forkIntentPresent: 'fork-intent-present',
  forkArchivedPresent: 'fork-archived-present',
  forkMarkerPresent: 'fork-marker-present',
  forkFieldsPresent: 'fork-fields-present',
  forkEvidenceMissing: 'fork-evidence-missing',
  forkEvidenceUnverified: 'fork-evidence-unverified',
  detachedFields: 'detached-fields-present',
  oldPathConfirmedAbsent: 'old-path-confirmed-absent',
  oldPathIndeterminate: 'old-path-indeterminate',
  auditGap: 'audit-gap',
};

const canonical = (value) => normalizeCwd(String(value ?? ''));

function uniquePaths(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = canonical(entry.path).toLowerCase();
    if (key === '') continue;
    const list = map.get(key) ?? [];
    list.push(entry);
    map.set(key, list);
  }
  return map;
}

/**
 * ¿Dos apariciones del mismo UUID son legítimas? El registro y **su propio** manifiesto comparten
 * UUID por diseño; dos registros o dos manifiestos, no.
 */
function duplicateUuidReasons({ records, readableManifests, inventoryComplete }) {
  const seen = new Map();
  const add = (uuid, origin) => {
    if (typeof uuid !== 'string' || uuid === '') return;
    const list = seen.get(uuid) ?? [];
    list.push(origin);
    seen.set(uuid, list);
  };
  for (const record of records) add(record.uuid, 'record');
  for (const manifest of readableManifests) add(manifest.uuid, 'manifest');

  const duplicates = [];
  for (const [uuid, origins] of seen) {
    const recordCount = origins.filter((o) => o === 'record').length;
    const manifestCount = origins.filter((o) => o === 'manifest').length;
    // Legítimo: un registro + un manifiesto (el suyo). Duplicidad: dos registros, o dos manifiestos.
    const duplicated = recordCount > 1 || manifestCount > 1;
    if (duplicated === false) continue;
    if (inventoryComplete !== true) continue; // sin inventario completo no se afirma duplicidad
    duplicates.push(uuid);
  }
  return duplicates;
}

/**
 * Clasifica **una** ruta. `observation` es lo medido; `context` es el inventario global. La función es
 * pura: no toca disco y no escribe nada.
 */
export function classifyWorkspace(observation, context = {}) {
  const {
    record = null,
    availability = AVAILABILITY.ok,
    manifest = { status: 'missing' },
    archive = { status: 'missing' },
    marker = { status: 'missing' },
    intent = { status: 'missing' },
    inspected = true,
    inspectionError = null,
    pathMissingConfirmed = false,
    oldPathIndeterminate = false,
  } = observation;
  const {
    inventory = INVENTORY.complete,
    duplicateRecords = [],
    duplicateWorkspaces = [],
    uuidDuplicates = [],
    auditEvents = null,
  } = context;

  const reasons = [];
  const warnings = [];
  const manifestOk = manifest.status === 'ok';
  const manifestUuid = manifestOk ? String(manifest.projectId ?? '') : '';
  const manifestHash = manifestOk ? String(manifest.sha256 ?? '') : '';
  const recordHash = record !== null ? String(record.manifestSha256 ?? '') : '';
  const recordUuid = record !== null ? String(record.uuid ?? '') : '';
  const fork = record !== null && record.fork !== undefined && record.fork !== null ? record.fork : null;

  const dimensions = (identity, extra = {}) => ({
    identity,
    availability: extra.availability ?? availability,
    // Con la carpeta ausente no se puede verificar nada: la dimensión de verificación no puede salir «verified»
    // sólo porque el inventario se recorrió entero (defecto real de la vista de identidad).
    verification: extra.verification
      ?? (availability === AVAILABILITY.ok && inventory === INVENTORY.complete
        ? VERIFICATION.verified
        : VERIFICATION.unverified),
    audit: extra.audit ?? AUDIT.ok,
    reasons: [...reasons, ...(extra.reasons ?? [])],
    warnings: [...warnings, ...(extra.warnings ?? [])],
  });

  if (inspected !== true) {
    const code = inspectionError ?? 'unknown';
    reasons.push(code === 'missing-dir' ? REASONS.pathUnreadable : REASONS.inventoryUnreadable);
    return dimensions(IDENTITY_STATES.identityUnknown, {
      availability: code === 'missing-dir' ? AVAILABILITY.missingDir : AVAILABILITY.unknown,
      verification: VERIFICATION.unverified,
      reasons: [REASONS.inventoryIncomplete],
    });
  }

  // 1 · fork-conflict: campos de fork presentes y algún elemento contradice la intención.
  if (fork !== null) {
    const intentOk = intent.status === 'ok';
    const problems = [];
    if (intent.status === 'invalid') problems.push('intent-invalid');
    if (manifestOk && intentOk && intent.newManifestSha256 !== undefined && manifestHash !== String(intent.newManifestSha256)) {
      problems.push('published-hash-differs-from-intent');
    }
    if (manifestOk && intentOk && intent.newUuid !== undefined && manifestUuid !== String(intent.newUuid)) {
      problems.push('published-uuid-differs-from-intent');
    }
    if (marker.status === 'invalid') problems.push('marker-invalid');
    if (fork.archivedFile !== undefined && archive.status === 'missing' && manifestOk && manifestHash === String(intent.newManifestSha256 ?? '')) {
      // El canónico nuevo existe y el archivado del anterior no: la evidencia de procedencia se perdió.
      warnings.push(REASONS.forkEvidenceMissing);
    }
    if (archive.status === 'unverified') warnings.push(REASONS.forkEvidenceUnverified);
    if (problems.length > 0) {
      reasons.push(...problems);
      return dimensions(IDENTITY_STATES.forkConflict, { reasons: [] });
    }
  }

  // 2 · uuid-duplicated (sólo con inventario completo: una posibilidad no es una duplicidad).
  // Un UUID repetido sólo se puede afirmar habiendo mirado todas las rutas conocidas: con inventario
  // incompleto, «no lo he visto en otro sitio» no es «está en otro sitio» (LSC‑023).
  const uuidForDup = manifestOk && manifestUuid !== '' ? manifestUuid : recordUuid;
  if (inventory === INVENTORY.complete && uuidForDup !== '' && uuidDuplicates.includes(uuidForDup)) {
    reasons.push(REASONS.duplicateUuid);
    return dimensions(IDENTITY_STATES.uuidDuplicated);
  }

  // 3 · path-conflict
  const workspacePath = canonical(observation.path).toLowerCase();
  if (duplicateRecords.includes(workspacePath) || duplicateWorkspaces.includes(workspacePath)) {
    reasons.push(duplicateRecords.includes(workspacePath) ? REASONS.duplicateRecordPath : REASONS.duplicateWorkspacePath);
    return dimensions(IDENTITY_STATES.pathConflict);
  }
  // Un fork en curso **cambia** el UUID del manifiesto respecto al del registro viejo: esa discrepancia es
  // la evidencia del fork, no un conflicto de ruta. Sólo sin fork es una contradicción.
  if (fork === null && record !== null && manifestOk && manifestUuid !== '' && recordUuid !== '' && manifestUuid !== recordUuid) {
    reasons.push(REASONS.manifestUuidElsewhere);
    return dimensions(IDENTITY_STATES.pathConflict);
  }
  if (record !== null && manifestOk && recordHash !== '' && manifestHash !== recordHash) {
    // Sin fork de por medio, un manifiesto con huella distinta en la misma ruta no es un movimiento:
    // es una contradicción entre lo registrado y lo que hay.
    if (fork === null) {
      reasons.push(REASONS.manifestHashDiffers);
      return dimensions(IDENTITY_STATES.pathConflict);
    }
  }

  // 4–7 · fork incompleto / publicado
  if (fork !== null) {
    const newUuid = String(fork.newUuid ?? intent.newUuid ?? '');
    const newHash = String(fork.manifestSha256 ?? intent.newManifestSha256 ?? '');
    const canonicalIsNew = manifestOk && newUuid !== '' && manifestUuid === newUuid && manifestHash === newHash;
    if (canonicalIsNew !== true) {
      if (archive.status === 'ok' && archivesMatch(archive, intent, fork)) {
        reasons.push(REASONS.forkArchivedPresent);
        return dimensions(IDENTITY_STATES.forkManifestArchived);
      }
      reasons.push(REASONS.forkIntentPresent);
      return dimensions(IDENTITY_STATES.forkIntentOnly);
    }
    if (marker.status !== 'ok') {
      reasons.push(REASONS.forkMarkerPresent);
      return dimensions(IDENTITY_STATES.forkManifestPublished);
    }
    reasons.push(REASONS.forkMarkerPresent);
    return dimensions(IDENTITY_STATES.forkPublished);
  }

  // 8 · fork-registered: el registro declara la copia y el manifiesto vigente coincide.
  if (record !== null && record.forkedFrom !== undefined && record.forkOperationId !== undefined) {
    if (manifestOk && recordHash !== '' && manifestHash === recordHash) {
      reasons.push(REASONS.forkFieldsPresent);
      return dimensions(IDENTITY_STATES.forkRegistered);
    }
  }

  // 9 · detached-manifest
  if (record !== null && (record.detachedFrom !== undefined || record.detachedAt !== undefined)) {
    if (manifestOk && recordHash !== '' && manifestHash === recordHash) {
      reasons.push(REASONS.detachedFields);
      return dimensions(IDENTITY_STATES.detachedManifest);
    }
  }

  // 10–12 · linked / adopted / moved-manifest
  if (record !== null && recordUuid !== '' && manifestOk) {
    const samePath = canonical(record.cwd).toLowerCase() === workspacePath;
    const hashMatches = recordHash !== '' && manifestHash === recordHash;
    if (samePath && hashMatches && manifestUuid === recordUuid) {
      if (record.adoptedAt !== undefined) {
        reasons.push(REASONS.manifestHashMatches);
        return dimensions(IDENTITY_STATES.adopted);
      }
      reasons.push(REASONS.manifestHashMatches);
      return dimensions(IDENTITY_STATES.linked);
    }
    if (samePath === false && hashMatches && manifestUuid === recordUuid) {
      if (pathMissingConfirmed === true && inventory === INVENTORY.complete) {
        reasons.push(REASONS.oldPathConfirmedAbsent, REASONS.manifestHashMatches);
        return dimensions(IDENTITY_STATES.movedManifest);
      }
      // El registro apunta a otra ruta con el mismo UUID y huella: se puede mostrar como vinculado, pero la
      // afirmación «se movió» no está demostrada. El motivo se añade una sola vez.
      return dimensions(IDENTITY_STATES.linked, {
        verification: VERIFICATION.unverified,
        reasons: [oldPathIndeterminate === true ? REASONS.oldPathIndeterminate : REASONS.inventoryIncomplete],
      });
    }
  }

  // 13–14 · manifiesto presente pero inutilizable
  if (manifest.status === 'future') {
    reasons.push('manifest-future-version');
    return dimensions(IDENTITY_STATES.manifestFuture, { verification: VERIFICATION.unverified });
  }
  if (manifest.status === 'invalid') {
    reasons.push('manifest-invalid');
    return dimensions(IDENTITY_STATES.manifestInvalid, { verification: VERIFICATION.unverified });
  }

  // 14b · manifiesto presente pero ilegible: la identidad no se puede afirmar
  if (manifest.status === 'unreadable') {
    reasons.push(REASONS.pathUnreadable);
    return dimensions(IDENTITY_STATES.identityUnknown, { verification: VERIFICATION.unverified });
  }

  // 15–17 · manifiesto ausente
  if (manifest.status === 'missing') {
    if (record !== null) {
      return dimensions(IDENTITY_STATES.manifestMissing, { reasons: [REASONS.noManifest] });
    }
    reasons.push(REASONS.unmanaged);
    return dimensions(IDENTITY_STATES.unmanaged);
  }

  // 18 · manifiesto válido sin registro que lo reclame, o registro legacy en la misma ruta
  if (manifestOk && record === null) {
    reasons.push(REASONS.noRecord);
    return dimensions(IDENTITY_STATES.manifestOnly);
  }
  if (manifestOk && record !== null && recordUuid === '') {
    reasons.push(REASONS.legacyRecord);
    return dimensions(IDENTITY_STATES.legacyManifestOnly);
  }

  // 19 · sin identidad verificable
  reasons.push(REASONS.inventoryIncomplete);
  return dimensions(IDENTITY_STATES.identityUnknown, { verification: VERIFICATION.unverified });
}

function archivesMatch(archive, intent, fork) {
  const expected = String(intent.previousManifestSha256 ?? fork.forkPreviousManifestSha256 ?? '');
  if (expected === '') return true;
  return String(archive.sha256 ?? '') === expected;
}

/**
 * Inventario completo: se inspeccionaron **todas** las rutas conocidas (registro ∪ workspaces) y todas
 * las que tenían manifiesto se leyeron. Un solo fallo lo deja incompleto, y con el inventario incompleto
 * no se afirma unicidad ni se ejecutan operaciones de identidad.
 */
export function inventoryStatus({ records = [], workspaces = [], inspectedPaths = [], failedPaths = [] } = {}) {
  const known = uniquePaths([
    ...records.map((r) => ({ path: r.cwd })),
    ...workspaces.map((w) => ({ path: w.path })),
  ]);
  const inspected = new Set(inspectedPaths.map((p) => canonical(p).toLowerCase()));
  const missing = [...known.keys()].filter((key) => inspected.has(key) === false);
  const reasons = [];
  for (const failure of failedPaths) reasons.push(failure.code ?? REASONS.inventoryUnreadable);
  if (missing.length > 0) reasons.push(REASONS.inventoryIncomplete);
  return {
    status: missing.length === 0 && failedPaths.length === 0 ? INVENTORY.complete : INVENTORY.incomplete,
    considered: known.size,
    inspected: [...inspected].length,
    missing,
    reasons,
  };
}

/**
 * Construye la vista completa: clasifica cada workspace con el contexto global y calcula unicidad y
 * advertencias. No escribe nada; con `inventory.status !== complete` la unicidad es `unverified`.
 */
export function buildIdentityView({ observations = [], records = [], workspaces = [], inventory, audit = null } = {}) {
  const status = inventory ?? inventoryStatus({ records, workspaces });
  const complete = status.status === INVENTORY.complete;

  const recordPaths = uniquePaths(records.map((r) => ({ path: r.cwd })));
  const workspacePaths = uniquePaths(workspaces.map((w) => ({ path: w.path })));
  const duplicateRecords = [...recordPaths.entries()].filter(([, list]) => list.length > 1).map(([key]) => key);
  const duplicateWorkspaces = [...workspacePaths.entries()].filter(([, list]) => list.length > 1).map(([key]) => key);

  const readableManifests = observations
    .filter((o) => o.manifest !== undefined && o.manifest.status === 'ok')
    .map((o) => ({ uuid: String(o.manifest.projectId ?? '') }));
  const uuidDuplicates = duplicateUuidReasons({
    records,
    readableManifests,
    inventoryComplete: complete,
  });

  const items = observations.map((observation) =>
    classifyWorkspace(observation, {
      inventory: status.status,
      duplicateRecords,
      duplicateWorkspaces,
      uuidDuplicates,
      auditEvents: audit,
    }),
  );

  const uniqueness = complete === false
    ? { status: UNIQUENESS.unverified, duplicates: [], reason: REASONS.inventoryIncomplete }
    : uuidDuplicates.length > 0
      ? { status: UNIQUENESS.duplicated, duplicates: uuidDuplicates }
      : { status: UNIQUENESS.unique, duplicates: [] };

  const gaps = observations.filter((o) => o.auditGap === true).length;
  return {
    items,
    inventory: status,
    uniqueness,
    counts: countStates(items),
    audit: { gaps, status: complete === false ? AUDIT.unknown : gaps > 0 ? AUDIT.gap : AUDIT.ok },
  };
}

/** Cuántas rutas hay en cada estado (para los contadores de la UI). */
export function countStates(items) {
  const counts = {};
  for (const state of STATE_PRECEDENCE) counts[state] = 0;
  for (const item of items) {
    const state = item?.identity;
    if (typeof state === 'string' && counts[state] !== undefined) counts[state] += 1;
  }
  return counts;
}

/**
 * ¿Puede ejecutarse una operación de identidad? Requisitos: centro en v3 (identidad disponible),
 * inventario completo, verificación `verified`, sin duplicidad ni conflicto abiertos y, para `move` y
 * `reconcile`, copia previa verificada. Devuelve el motivo cuando dice que no.
 */
export function identityActionGate({
  operation,
  schemaVersion = 2,
  requiredSchemaVersion = 3,
  inventory = { status: INVENTORY.incomplete },
  uniqueness = { status: UNIQUENESS.unverified },
  states = [],
  backupVerified = false,
} = {}) {
  if (typeof operation !== 'string' || !Object.values(OPERATIONS).includes(operation)) {
    return { ok: false, code: 'unknown-operation', message: `operación de identidad desconocida: ${operation}` };
  }
  if (!Number.isInteger(schemaVersion) || schemaVersion < requiredSchemaVersion) {
    return {
      ok: false,
      status: 409,
      code: 'migration-required',
      message: `las operaciones de identidad exigen el esquema v${requiredSchemaVersion}; este centro está en v${schemaVersion}`,
    };
  }
  // `repair` trabaja sobre un manifiesto concreto de una ruta que la persona acaba de indicar: no crea
  // identidad ni decide entre proyectos, así que no necesita el inventario global. Sigue avisando de que la
  // unicidad no se pudo comprobar (queda como hueco de auditoría, no como bloqueo).
  if (operation === OPERATIONS.repair) {
    return inventory.status === INVENTORY.complete
      ? { ok: true }
      : { ok: true, audit: 'audit-gap', reason: 'repair-local', warnings: ['inventory-incomplete'] };
  }
  if (inventory.status !== INVENTORY.complete) {
    return { ok: false, status: 409, code: 'inventory-incomplete', message: 'el inventario global no está completo' };
  }
  if (uniqueness.status !== UNIQUENESS.unique) {
    return {
      ok: false,
      status: 409,
      code: uniqueness.status === UNIQUENESS.duplicated ? 'uuid-duplicated' : 'inventory-unverified',
      message: 'la unicidad de identidad no se pudo afirmar',
    };
  }
  const blocking = states.filter((state) => ['fork-conflict', 'uuid-duplicated', 'path-conflict'].includes(state));
  if (blocking.length > 0) {
    return { ok: false, status: 409, code: blocking[0], message: `hay un conflicto abierto: ${blocking[0]}` };
  }
  if ((operation === OPERATIONS.move || operation === OPERATIONS.reconcile) && backupVerified !== true) {
    return { ok: false, status: 409, code: 'backup-required', message: 'esta operación exige una copia previa verificada' };
  }
  return { ok: true };
}
