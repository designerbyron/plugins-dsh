/**
 * El pegamento: documento del centro + disco + telemetría, en una sola capa que consumen la ruta HTTP
 * del panel y las herramientas del agente.
 *
 * Aquí no hay criterio de producto; el criterio vive en `operations.mjs` y `evaluate.mjs`. Este módulo
 * responde dos preguntas: «¿qué hay ahora?» (`buildSnapshot`) y «haz esto» (`runAction`). Ambos son
 * síncronos sobre el documento y escriben con `withState`, que guarda con rename atómico y no deja
 * nada a medias si la mutación falla.
 */

import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarize } from './analytics.mjs';
import { ACTIVITY_CATEGORY_FILTERS, ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT, activityForResult, buildActivityFeed, decodeActivityCursor, knowledgeEventId, normalizeEvent } from './activity.mjs';
import { buildInsights, parseFilters, EVENT_TYPES } from './insights.mjs';
import { candidateWords, rank } from './detect.mjs';
import { evaluationSummary } from './evaluate.mjs';
import { writeCenterReport } from './export.mjs';
import { BUNDLE_SCHEMA, BUNDLE_SCHEMA_VERSION, MAX_BUNDLE_BYTES, importBundle, invalidBundleReferences, isSafeBundlePart, possibleSecretWarnings, privateReferences, readBundle, writeBundle } from './distribute.mjs';
import { compareVersions, normalizeCwd, projectIdFor, projectNameFor } from './format.mjs';
import { inspectProject, syncProject } from './materialize.mjs';
import {
  assignedSkills,
  createSkill,
  currentVersionOf,
  decideImprovement,
  diffBodies,
  ensureProject,
  evaluateStored,
  findProject,
  forkSkill,
  proposeImprovement,
  publishVersion,
  rollbackAssignment,
  toggleAssignment,
  advanceAssignments,
} from './operations.mjs';
import { dismissRequest, fulfillRequest, openRequest, requestView } from './requests.mjs';
import { candidateFromSkillFile } from './skillfile.mjs';
import { scanExternalSkills } from './sources.mjs';
import {
  AVAILABILITY_MISSING_DIR,
  AVAILABILITY_OK,
  AVAILABILITY_UNKNOWN,
  WORKSPACE_UNAVAILABLE,
  buildWorkspaceInventory,
  workspaceOf,
  workspaceRegistryShape,
} from './workspaces.mjs';
import { IDENTITY_SCHEMA_VERSION, identityAvailable } from './state.mjs';
import { INVENTORY, OPERATIONS, classifyWorkspace, identityActionGate, inventoryStatus } from './identity.mjs';
import {
  INTEGRITY_OK,
  SCHEMA_VERSION,
  canWrite,
  compareDocuments,
  defaultRoot,
  emptyState,
  ensureBackup,
  inspectLock,
  loadState,
  materializedRoot,
  migrateStore,
  restoreFromBackup,
  restoreStore,
  recordOperation,
  operationOf,
  verifyBackup,
  withState,
} from './state.mjs';
import { appendEvent } from './state.mjs';
import { recordDecision, settleDecision, unsettledDecisions, loadKnowledge, withKnowledge, receiveInsight, knowledgeSummary, policyFor, setPolicy, triageInsight, POLICY_MODES, INSIGHT_STATES, DECISION_OUTCOMES, EVIDENCE_LEVELS } from './knowledge.mjs';
import { chooseOperation, evaluateDecision } from './decisions.mjs';
import { similarSkills } from './similarity.mjs';
import { detachManifest, forkProjectManifest, isCanonicalUtc, isUuidV4, manifestBytes, newManifest, publishExclusive, readJsonArtifact, readManifest, repairManifest, sha256Hex } from './manifest-ops.mjs';
// El dominio R16 se importa por espacio de nombres para no acoplar este despacho a un alias concreto:
// `inventory`, `preflight` y `projects` son puros y su superficie cerrada es la del contrato §5.
import * as inventoryModule from './inventory.mjs';
import { detectCollisions } from './collisions.mjs';
import * as preflightModule from './preflight.mjs';
import * as projectsModule from './projects.mjs';

export const API_VERSION = 1;

/**
 * Contrato HTTP que implementa este backend (R16.2). Es aditivo: `apiVersion` sigue siendo 1 y las
 * rutas viejas no cambian; el handshake de `capabilities` permite que un panel nuevo sepa con quién habla
 * sin confundir un 404 de ruta con una versión vieja.
 */
export const API_CONTRACT_VERSION = 2;

/** Las capacidades que este backend declara en `GET /api/capabilities`. */
export const CAPABILITY_IDS = [
  'capabilities',
  'projects',
  'inventory',
  'inspect-project',
  'register-project',
  'adopt-project',
  'materialize-project',
  'preflight',
  'legacy-workspaces',
  'activity',
];
export const EXTERNAL_LIMIT = 140;

/**
 * La base de la API del panel, sin barra final.
 *
 * Medido en el harness vivo: la ruta con nombre se casa por `path` o `path + '/'`, nunca por
 * `path + 'x'`; registrada como `.../api/`, sólo respondía la base exacta y `.../api/state` caía en el
 * 404 del fallback del SPA.
 */
export const API_PREFIX = '/lifecode-skill-center/api';

/** Las acciones que cambian el catálogo que ve el agente: hay que invalidarlo después. */
export const CHANGES_CATALOG = new Set(['create', 'publish', 'improve', 'decide', 'toggle', 'rollback', 'fork', 'import', 'import-bundle', 'evaluate', 'advance']);

/** Los códigos de acción que tienen un estado HTTP propio; el resto conserva el 200 con `ok:false`. */
const ACTION_HTTP_STATUS = Object.freeze({
  'store-unreadable': 409,
  'preflight-blocked': 409,
  'evidence-incomplete': 409,
  'identity-conflict': 409,
  'project-exists': 409,
  'not-adoptable': 409,
  'project-not-found': 404,
  'host-action-unsupported': 501,
  'identity-from-client': 400,
  'invalid-cwd': 400,
  'invalid-id': 400,
  'confirmation-required': 400,
  'invalid-bundle': 400,
  'bundle-too-large': 400,
  'unsupported-schema': 400,
  'checksum-mismatch': 400,
  'invalid-references': 400,
});

/**
 * Los dos canales admitidos por la ruta del panel.
 *
 * El canal lo decide el adaptador comparando el peer admitido con `connection.browserPeer`, **nunca** el
 * cuerpo ni una cabecera: `body.actor` y `x-lifecode-actor` no conceden nada (acto LSC-005).
 */
/**
 * Acciones de identidad portable. Exigen documento v3, inventario completo y confirmación humana.
 *
 * En S6‘A la política ya está viva —un centro v2 las rechaza con `migration-required` sin escribir un
 * byte— pero su implementación llega en S6‘B…S6‘E; hasta entonces responden `identity-operation-pending`.
 */
/**
 * Nombres de acción de la API para las operaciones de identidad.
 *
 * Van **prefijados** a propósito: `fork` ya significaba «clonar una skill» en esta API desde antes de que
 * existiera la identidad de proyectos. Reutilizar el nombre habría convertido el clonado de skills en un
 * 409 de migración en cuanto se añadió la puerta de identidad.
 */
const IDENTITY_ACTION_OPERATIONS = new Map([
  ['identity-link', OPERATIONS.link],
  ['identity-adopt', OPERATIONS.adopt],
  ['identity-unlink', OPERATIONS.unlink],
  ['identity-relink', OPERATIONS.relink],
  ['identity-move', OPERATIONS.move],
  ['identity-fork', OPERATIONS.fork],
  ['identity-reconcile', OPERATIONS.reconcile],
  ['repair', OPERATIONS.repair],
  ['repair-manifest', OPERATIONS.repair],
]);

/**
 * Hasta que el inventario global esté cableado (S6‘B), la puerta de identidad debe decir «no» en vez de
 * asumir que el inventario está completo: sin inventario no hay unicidad de UUID demostrable.
 */

/**
 * Vista de identidad para el panel: clasifica cada carpeta conocida (registros del centro y workspaces del
 * Host) y devuelve el estado, las cuatro dimensiones y los motivos. Sólo lectura: no crea, no adopta, no mueve.
 */
export function identityPayload({ root, registry, workspaceItems = null } = {}) {
  const loaded = loadState(root);
  const scope = identityInventory({ state: loaded.state, registry, workspaceItems });
  const context = { inventory: scope.inventory.status };
  const observations = [];
  const seen = new Set();
  const paths = [];
  for (const record of scope.records) {
    if (record.cwd !== '') paths.push({ path: record.cwd, record });
  }
  for (const workspace of scope.workspaces) {
    const key = normalizeCwd(workspace.path).toLowerCase();
    if (key === '') continue;
    const known = paths.some((entry) => normalizeCwd(entry.path).toLowerCase() === key);
    if (known !== true) paths.push({ path: workspace.path, record: null, workspaceId: workspace.workspaceId });
    else {
      const match = paths.find((entry) => normalizeCwd(entry.path).toLowerCase() === key);
      match.workspaceId = workspace.workspaceId;
    }
  }
  for (const entry of paths) {
    const key = normalizeCwd(entry.path).toLowerCase();
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    const dshRoot = join(entry.path, '.dsh');
    const manifest = readManifest(join(dshRoot, 'lifecode-skill-center.json'));
    const marker = readJsonArtifact({ dshRoot, name: 'lifecode-skill-center.fork-published.json' });
    const intent = readJsonArtifact({ dshRoot, name: 'lifecode-skill-center.fork-intent.json' });
    let pathMissingConfirmed = false;
    let availability = 'ok';
    try {
      pathMissingConfirmed = statSync(entry.path).isDirectory() !== true;
      if (pathMissingConfirmed === true) availability = 'unknown';
    } catch {
      pathMissingConfirmed = entry.record !== null;
      availability = 'missing-dir';
    }
    observations.push({
      entry,
      observation: {
        workspaceId: entry.workspaceId ?? '',
        path: entry.path,
        availability,
        record: entry.record,
        manifest: { status: manifest.status, projectId: manifest.manifest?.projectId ?? null, sha256: manifest.sha256 ?? null },
        archive: { status: marker.status },
        marker: { status: marker.status },
        intent: { status: intent.status },
        inspected: manifest.status !== 'unreadable',
        inspectionError: manifest.status === 'unreadable' ? 'path-unreadable' : null,
        pathMissingConfirmed,
        oldPathIndeterminate: false,
      },
    });
  }

  // D1 · los duplicados son del conjunto: se calculan antes de clasificar y se pasan al clasificador.
  const recordPaths = new Map();
  for (const record of scope.records) {
    if (record.cwd === '') continue;
    const key = normalizeCwd(record.cwd).toLowerCase();
    recordPaths.set(key, (recordPaths.get(key) ?? 0) + 1);
  }
  const duplicateRecords = [...recordPaths.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const workspacePaths = new Map();
  for (const workspace of scope.workspaces) {
    const key = normalizeCwd(workspace.path).toLowerCase();
    if (key === '') continue;
    workspacePaths.set(key, (workspacePaths.get(key) ?? 0) + 1);
  }
  const duplicateWorkspaces = [...workspacePaths.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const uuidCounts = new Map();
  for (const { observation } of observations) {
    // Una sola cuenta por workspace: el registro y su manifiesto declaran el **mismo** UUID, y sumarlos
    // convertía cualquier proyecto normal en un duplicado de sí mismo.
    const fromRecord = String(observation.record?.uuid ?? '');
    const fromManifest = observation.manifest.status === 'ok' ? String(observation.manifest.projectId ?? '') : '';
    const uuid = fromRecord !== '' ? fromRecord : fromManifest;
    if (uuid !== '') uuidCounts.set(uuid, (uuidCounts.get(uuid) ?? 0) + 1);
  }
  const uuidDuplicates = [...uuidCounts.entries()].filter(([, count]) => count > 1).map(([uuid]) => uuid);

  const classifyContext = {
    inventory: scope.inventory.status,
    duplicateRecords,
    duplicateWorkspaces,
    uuidDuplicates,
  };
  const items = [];
  for (const { entry, observation } of observations) {
    const classified = classifyWorkspace(observation, classifyContext);
    items.push({
      workspaceId: observation.workspaceId,
      path: entry.path,
      projectId: entry.record === null ? null : entry.record.projectId,
      uuid: entry.record === null ? null : entry.record.uuid ?? null,
      ...classified,
    });
  }
  const counts = {};
  for (const item of items) counts[item.identity] = (counts[item.identity] ?? 0) + 1;

  // D1 · duplicados declarados, nunca resueltos: agrupamos por uuid y por ruta canónica y sólo nos
  // quedamos con los grupos de más de uno. La vista no elige «el bueno»; una persona decide.
  const groupsByUuid = new Map();
  const groupsByPath = new Map();
  for (const item of items) {
    const uuid = String(item.uuid ?? '');
    if (uuid !== '') {
      if (!groupsByUuid.has(uuid)) groupsByUuid.set(uuid, []);
      groupsByUuid.get(uuid).push(item.path);
    }
    const canonicalPath = normalizeCwd(item.path).toLowerCase();
    if (canonicalPath !== '') {
      if (!groupsByPath.has(canonicalPath)) groupsByPath.set(canonicalPath, []);
      groupsByPath.get(canonicalPath).push(item.path);
    }
  }
  const duplicateUuids = [...groupsByUuid.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([value, paths]) => ({ value, items: paths }));
  const duplicatePaths = [...groupsByPath.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([value, paths]) => ({ value, items: paths }));
  const uniqueness = duplicateUuids.length > 0 ? 'uuid-duplicated' : duplicatePaths.length > 0 ? 'path-conflict' : 'ok';

  // D11 · los estados de fork ya se clasifican uno a uno; aquí se cuentan para que el panel pueda decir
  // cuántos proyectos están a medio forkear sin recorrer las filas.
  const forkCounts = {};
  let forkTotal = 0;
  for (const item of items) {
    if (String(item.identity).startsWith('fork-')) {
      forkCounts[item.identity] = (forkCounts[item.identity] ?? 0) + 1;
      forkTotal += 1;
    }
  }

  return {
    ok: true,
    readable: canWrite(loaded.integrity),
    inventory: scope.inventory,
    items,
    counts,
    total: items.length,
    uniqueness,
    duplicates: { uuid: duplicateUuids, path: duplicatePaths },
    forks: { total: forkTotal, byState: forkCounts },
  };
}

/**
 * Inventario de identidad calculado en el acto:/**
 * Inventario de identidad calculado en el acto: registros del centro + workspaces del Host + el manifiesto de
 * cada ruta conocida. Todo es síncrono (`workspaceRegistry.list()` lo es) para que la puerta de identidad
 * pueda decidir dentro de `runAction` sin convertir la API en asíncrona.
 */
function identityInventory({ state, registry, workspaceItems = null }) {
  // La clasificación necesita ver la huella del manifiesto y el rastro del fork/detach: si la proyección
  // recorta esos campos, un proyecto perfectamente vinculado se clasifica como «identity-unknown» (defecto real
  // encontrado por la sonda de la vista de identidad).
  const pick = (value) => (typeof value === 'string' && value !== '' ? value : null);
  const records = Object.values(state.projects ?? {}).map((project) => {
    const record = { projectId: String(project.id ?? ''), cwd: String(project.cwd ?? '') };
    // Sólo se copian los campos que existen: el clasificador distingue «ausente» (undefined) de «vacío», y un
    // null copiado a la fuerza convertía cualquier proyecto normal en «fork-registered» (defecto real medido).
    for (const [key, source] of [['uuid', 'uuid'], ['manifestSha256', 'manifestSha256'],
      ['manifestRegisteredAt', 'manifestRegisteredAt'], ['adoptedAt', 'adoptedAt'],
      ['detachedFrom', 'detachedFrom'], ['detachedAt', 'detachedAt'], ['detachedSha256', 'detachedSha256'],
      ['forkedFrom', 'forkedFrom'], ['forkOperationId', 'forkOperationId'], ['forkedAt', 'forkedAt']]) {
      const value = pick(project[source]);
      if (value !== null) record[key] = value;
    }
    return record;
  });
  let workspaces = [];
  // Cuando el inventario ya listó el registro en esta misma petición, se reutiliza esa lectura: un panel que
  // pide la pestaña de proyectos hace **una** consulta al Host, no dos (directiva §7, sin sondeo de más).
  const listed = Array.isArray(workspaceItems)
    ? workspaceItems
    : (registry !== undefined && registry !== null && typeof registry.list === 'function'
      ? (() => { try { return registry.list(); } catch { return []; } })()
      : []);
  if (Array.isArray(listed)) {
    workspaces = listed.map((item) => ({
      workspaceId: String(item?.id ?? ''),
      path: String(item?.path ?? ''),
      title: String(item?.title ?? ''),
    }));
  }
  const known = new Set(records.map((record) => normalizeCwd(record.cwd).toLowerCase()).filter((path) => path !== ''));
  const observations = [];
  const inspectedPaths = [];
  const failedPaths = [];
  const inspect = (path) => {
    const manifest = readManifest(join(path, '.dsh', 'lifecode-skill-center.json'));
    if (manifest.status === 'unreadable') failedPaths.push({ path, code: 'path-unreadable' });
    else inspectedPaths.push(path);
    return {
      status: manifest.status,
      projectId: manifest.manifest?.projectId ?? null,
      sha256: manifest.sha256 ?? null,
    };
  };
  for (const record of records) {
    if (record.cwd === '') continue;
    observations.push({ workspaceId: '', path: record.cwd, manifest: inspect(record.cwd), record });
  }
  for (const workspace of workspaces) {
    const key = normalizeCwd(workspace.path).toLowerCase();
    if (key === '' || known.has(key)) {
      const match = records.find((record) => normalizeCwd(record.cwd).toLowerCase() === key);
      if (match !== undefined) {
        const observation = observations.find((item) => item.record === match);
        if (observation !== undefined) observation.workspaceId = workspace.workspaceId;
      }
      continue;
    }
    known.add(key);
    observations.push({ workspaceId: workspace.workspaceId, path: workspace.path, manifest: inspect(workspace.path) });
  }
  const computed = inventoryStatus({ records, workspaces, inspectedPaths, failedPaths });
  // Sin registro de workspaces no hay forma de saber qué carpetas existen fuera de las ya registradas: el
  // inventario no puede declararse completo nunca (una identidad podría vivir en un workspace no visto).
  const inventory = registry === undefined || registry === null || typeof registry.list !== 'function'
    ? { ...computed, status: INVENTORY.incomplete, reasons: [...new Set([...computed.reasons, 'inventory-no-registry'])] }
    : computed;
  const uniqueness = inventory.status === INVENTORY.complete ? { status: 'unique' } : { status: 'unverified' };
  return { records, workspaces, observations, inventory, uniqueness };
}

/** Nombres de acción que la API entiende como operaciones de identidad (prefijados: fork ya era clonar skills). */
export const IDENTITY_ACTIONS = Object.freeze([...IDENTITY_ACTION_OPERATIONS.keys()]);

export const CHANNEL_BROWSER = 'browser';
export const CHANNEL_API = 'api';

/**
 * Una de las dos respuestas que se sirven sin admisión (la otra es `capabilitiesPayload`).
 *
 * Dice si el Host ofrece `connection` y nada más: ni rutas, ni skills, ni proyectos, ni contadores, ni
 * credenciales. Existe para que el panel distinga «no hay credencial» de «este harness no puede
 * autenticar» sin abrir una rendija de lectura.
 *
 * `capabilities` tampoco lee nada: es un documento estático del contrato del plugin (id, versión,
 * capacidades y rutas). Las dos juntas permiten que un panel contra un backend viejo o sin `connection`
 * sepa qué está mirando, sin exponer almacén, rutas de disco, recuentos ni servicios.
 */
export function healthPayload({ auth = 'unavailable' } = {}) {
  return { ok: true, apiVersion: API_VERSION, auth: auth === 'host' ? 'host' : 'unavailable' };
}

/** Un objeto de verdad: ni `null` ni un array. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * La subruta de la API a la que corresponde un `pathname`, o `null` si no es de la API.
 * Devuelve `''` para la propia base.
 */
export function apiRouteOf(pathname) {
  const value = typeof pathname === 'string' ? pathname : '';
  if (value === API_PREFIX) return '';
  if (value.startsWith(`${API_PREFIX}/`)) return value.slice(API_PREFIX.length + 1);
  return null;
}

/** Toda respuesta de la API tiene la misma forma: estado, cuerpo y si hay que invalidar el catálogo. */
function answer(status, body, invalidate = false) {
  return { status, body, invalidate: invalidate === true };
}

/** Resultado uniforme cuando el almacén no se puede leer: la operación NO se hizo y se dice por qué. */
function unreadableResult(loaded, message) {
  return {
    ok: false,
    code: 'store-unreadable',
    status: 409,
    message,
    integrity: {
      status: loaded.integrity,
      path: loaded.path,
      size: loaded.size,
      sha256: loaded.sha256,
      error: loaded.error,
      archivedAs: null,
    },
  };
}

function unreadableResultFromStore(rejection, message) {
  return {
    ok: false,
    code: 'store-unreadable',
    status: 409,
    message,
    integrity: {
      status: rejection.integrity,
      path: rejection.path,
      size: rejection.size,
      sha256: rejection.sha256,
      error: rejection.error,
      archivedAs: null,
    },
  };
}

function notFound() {
  return answer(404, { ok: false, code: 'not-found', message: `esa ruta no es de la API (${API_PREFIX})` });
}

/**
 * Foto del registro de conocimiento: bandeja de hallazgos, decisiones de la IA y política por proyecto.
 * Leer no escribe. Si el registro está dañado se dice y NO se publican cifras inventadas: el panel
 * tiene que poder distinguir «no hay nada» de «no lo sé».
 */
export function knowledgeView({ root = centerRoot(), now = new Date().toISOString(), state = '', projectId = '', limit = 40 } = {}) {
  const loaded = loadKnowledge(root);
  const readable = loaded.integrity === 'ok' || loaded.integrity === 'missing';
  const base = {
    apiVersion: API_VERSION,
    generatedAt: now,
    path: loaded.file,
    integrity: { status: loaded.integrity, size: loaded.size, sha256: loaded.sha256, reason: loaded.reason ?? '' },
    readable,
  };
  if (!readable) {
    return { ...base, ok: false, code: 'knowledge-unreadable', message: 'el registro de conocimiento no se puede leer: no se publican hallazgos ni decisiones sobre datos dudosos' };
  }
  const document = loaded.document;
  const insights = (document.insights ?? [])
    .filter((insight) => (state === '' || insight.state === state) && (projectId === '' || insight.projectId === projectId))
    .slice()
    .sort((left, right) => String(right.receivedAt ?? '').localeCompare(String(left.receivedAt ?? '')));
  const decisions = (document.decisions ?? [])
    .slice()
    .sort((left, right) => String(right.at ?? right.createdAt ?? '').localeCompare(String(left.at ?? left.createdAt ?? '')))
    .slice(0, limit);
  // Contradicciones visibles: dos hallazgos de la misma categoría y el mismo proyecto que declaran
  // resultados distintos sobre la misma ubicación. No se resuelven solas: se enseñan.
  const byLocation = new Map();
  for (const insight of insights) {
    for (const evidence of insight.evidence ?? []) {
      if (String(evidence.location ?? '') === '') continue;
      const key = `${insight.category}|${insight.projectId}|${evidence.location}`;
      const entry = byLocation.get(key) ?? { category: insight.category, projectId: insight.projectId, location: evidence.location, results: new Map() };
      const result = String(evidence.result ?? '').trim();
      if (result !== '') entry.results.set(result, [...(entry.results.get(result) ?? []), insight.insightId]);
      byLocation.set(key, entry);
    }
  }
  const contradictions = [...byLocation.values()]
    .filter((entry) => entry.results.size > 1)
    .map((entry) => ({ category: entry.category, projectId: entry.projectId, location: entry.location, results: [...entry.results.entries()].map(([result, ids]) => ({ result, insightIds: ids })) }));
  return {
    ...base,
    ok: true,
    summary: knowledgeSummary(document),
    policy: (() => {
      const effective = policyFor(document, '');
      return {
        mode: effective.mode,
        provenance: effective.source,
        legacyUnverified: effective.source === 'legacy-unverified',
        storedGlobalMode: effective.storedMode ?? String(document.policy?.mode ?? ''),
        grantedAt: effective.grantedAt ?? '',
        projects: document.policy?.projects ?? {},
      };
    })(),
    pendingSettlements: unsettledDecisions(document),
    states: INSIGHT_STATES,
    levels: EVIDENCE_LEVELS,
    outcomes: DECISION_OUTCOMES,
    modes: POLICY_MODES,
    insights: insights.slice(0, limit),
    decisions,
    contradictions,
  };
}

/**
 * Handshake de capacidades (R16.2). Puro: no lee el almacén, ni el filesystem, ni servicios del Host.
 *
 * Existe porque el cliente nuevo puede hablar con un backend viejo (el GUI vivo conserva el proceso del
 * commit anterior hasta reiniciar): con esta respuesta el panel distingue «no me conoces» (404 de ruta)
 * de «te conozco pero me faltan capacidades» (200 con `capabilities`). `apiVersion` sigue siendo 1 por
 * compatibilidad; el contrato que evoluciona es `contractVersion`.
 */
export function capabilitiesPayload({ now = new Date().toISOString(), pluginVersion = '', implementation = '' } = {}) {
  return {
    ok: true,
    kind: 'capabilities',
    plugin: { id: 'lifecode-skill-center', version: String(pluginVersion ?? '') },
    apiVersion: API_VERSION,
    contractVersion: API_CONTRACT_VERSION,
    implementation: String(implementation ?? '') || 'r16.2',
    contract: {
      name: 'lifecode-skill-center/api',
      prefix: API_PREFIX,
      minClientContract: API_CONTRACT_VERSION,
      maxClientContract: API_CONTRACT_VERSION,
    },
    capabilities: [...CAPABILITY_IDS],
    routes: {
      'GET /api/capabilities': 'capabilities',
      'GET /api/workspaces': 'legacy-workspaces',
      'GET /api/inventory': 'inventory',
      'GET /api/projects': 'projects',
      'GET /api/activity': 'activity',
      'POST /api#inspect-project': 'inspect-project',
      'POST /api#register-project': 'register-project',
      'POST /api#adopt-project': 'adopt-project',
      'POST /api#materialize-project': 'materialize-project',
    },
    generatedAt: now,
  };
}

/**
 * El despacho de la API del panel: método + ruta + cuerpo entran, estado HTTP y cuerpo JSON salen.
 *
 * Vive aquí y no en `index.js` a propósito. El adaptador es la única pieza que no se puede probar antes
 * de instalar; si la semántica de la API viviera allí, cada defecto de la interfaz habría que buscarlo
 * dentro del harness. `outcome.invalidate` dice al adaptador si tiene que tirar el catálogo cacheado.
 */
export function handleApiRequest({
  root = centerRoot(),
  registry = null,
  method = 'GET',
  pathname = '/',
  search = '',
  body = null,
  hostCwd = '',
  channel = CHANNEL_BROWSER,
  now = new Date().toISOString(),
  skills = null,
  loader = null,
  sessions = null,
  dshHome = '',
  agentsHome = '',
  materializedRoot: materialized = '',
  hostSources = null,
  inventory: evidenceInventory = null,
  collisions: evidenceCollisions = null,
  pluginVersion = '',
  implementation = '',
} = {}) {
  const verb = String(method ?? 'GET').toUpperCase();
  const route = apiRouteOf(pathname);
  if (route === null) return notFound();

  if (verb === 'GET' || verb === 'HEAD') {
    const params = new URLSearchParams(typeof search === 'string' ? search.replace(/^\?/, '') : '');
    const cwd = params.get('cwd') ?? '';
    // El barrido del disco no va por defecto en la ruta que el panel refresca cada 20 s: se pide con
    // `scan=1` (y hoy sólo lo pide una prueba). El panel usa la acción `detect` cuando alguien pulsa «Buscar fuera».
    const scan = params.get('scan') === '1';
    const daysParam = Number.parseInt(params.get('days') ?? '', 10);
    // La ventana se acota aquí: la gráfica no puede pedir «un año» y traer cien barras al DOM.
    const analyticsDays = Number.isFinite(daysParam) ? Math.min(90, Math.max(7, daysParam)) : 14;
    const analyticsProject = String(params.get('project') ?? '').slice(0, 120);
    const analyticsSkill = String(params.get('skill') ?? '').slice(0, 120);
    const analyticsFrom = String(params.get('from') ?? '').slice(0, 32);
    const analyticsTo = String(params.get('to') ?? '').slice(0, 32);
    const analyticsType = String(params.get('type') ?? '').slice(0, 60);
    const analyticsVersion = String(params.get('version') ?? '').slice(0, 40);
    const analyticsStatus = String(params.get('status') ?? '').slice(0, 40);
    // Handshake sin servicios: va ANTES de `workspaces` y no toca registry/skills/almacén. Responde 200
    // incluso con el backend viejo delante, que es justo lo que el panel necesita saber.
    if (route === 'capabilities') {
      return answer(200, capabilitiesPayload({ now, pluginVersion, implementation }));
    }
    // El feed de actividad es una lectura del diario del propio almacén: no necesita servicios del Host
    // y no escribe nada. Si el documento no se puede leer, lo dice con 409 en vez de una página vacía.
    if (route === 'activity') {
      return activityPayload({ root, search, hostCwd, now });
    }
    // El inventario de workspaces necesita el servicio del Host, que sólo el adaptador puede resolver.
    // Sin él se contesta la verdad de este despacho (no lo tengo) en vez de devolver el estado como si
    // fuera el inventario: un panel que recibe la foto equivocada es peor que uno que dice «no disponible».
    if (route === 'workspaces') {
      if (registry === null || registry === undefined) return answer(503, unavailableWorkspaces());
      return workspacesPayload({ root, registry, hostCwd, now });
    }
    if (route === 'inventory') {
      return inventoryPayload({
        root,
        registry,
        skills,
        loader,
        hostCwd,
        cwd,
        now,
        dshHome,
        agentsHome,
        materializedRoot: materialized,
        limit: params.get('limit') ?? undefined,
      });
    }
    if (route === 'projects') {
      return projectsPayload({
        root,
        registry,
        hostCwd,
        cwd,
        skills,
        loader,
        sessions,
        now,
        dshHome,
        agentsHome,
        materializedRoot: materialized,
      });
    }
    if (route === 'insights') {
      const loaded = loadState(root);
      if (!canWrite(loaded.integrity)) {
        return answer(409, {
          ok: false,
          code: 'store-unreadable',
          apiVersion: API_VERSION,
          message: 'el almacén del centro no se puede leer: no se publican indicadores sobre datos dudosos',
        });
      }
      const filters = parseFilters(params, { now, days: analyticsDays });
      const insights = buildInsights(loaded.state, { now, filters });
      return answer(200, {
        ...insights,
        apiVersion: API_VERSION,
        eventTypes: EVENT_TYPES,
        integrity: { status: loaded.integrity, size: loaded.size, sha256: loaded.sha256 },
      });
    }
    if (route === 'knowledge') {
      const view = knowledgeView({
        root,
        now,
        state: String(params.get('state') ?? '').slice(0, 40),
        projectId: String(params.get('project') ?? '').slice(0, 120),
      });
      // 409 quando el registro no se puede leer: el panel tiene que decir «no lo sé», no «no hay nada».
      return answer(view.ok === true ? 200 : 409, view);
    }
    if (route === 'doctor') return answer(200, doctorPayload({ root, registry, now }));
    if (route === 'diff') {
      const skillId = String(params.get('id') ?? '');
      const from = String(params.get('from') ?? '');
      const to = String(params.get('to') ?? '');
      if (skillId === '' || from === '' || to === '') {
        return answer(400, { ok: false, code: 'bad-request', message: 'faltan «id», «from» o «to»' });
      }
      const diff = skillDiff({ root, skillId, from, to, now });
      // 409 cuando el centro no se puede leer: no es «no existe», es «no puedo saberlo».
      const diffStatus = diff.ok === true ? 200 : diff.code === 'store-unreadable' ? 409 : 404;
      return answer(diffStatus, diff);
    }
    if (route === 'skill') {
      const skillId = String(params.get('id') ?? '');
      if (skillId === '') return answer(400, { ok: false, code: 'bad-request', message: 'falta «id» de la skill' });
      const detail = skillDetail({ root, skillId, now });
      const detailStatus = detail.ok === true ? 200 : detail.code === 'store-unreadable' ? 409 : 404;
      return answer(detailStatus, detail);
    }
    if (route !== '' && route !== 'state') return notFound();
    return answer(200, buildSnapshot({ root, cwd: cwd !== '' ? cwd : hostCwd, hostCwd, scan, dshHome, agentsHome, materializedRoot, now, analyticsDays, analyticsProject, analyticsSkill, analyticsFrom, analyticsTo, analyticsType, analyticsVersion, analyticsStatus }));
  }

  if (verb !== 'POST') {
    return answer(405, { ok: false, code: 'method', message: 'usa GET para el estado y POST para las acciones' });
  }

  // La actividad es un diario de lectura: no hay acciones que escribir en ella. Se contesta 405 antes de
  // cualquier despacho mutable para no confundir «no existe la acción» con «esta ruta no acepta POST».
  if (route === 'activity') {
    return answer(405, { ok: false, code: 'method', message: 'usa GET para la actividad' });
  }

  // Una credencial de operador (canal `api`) puede leer, pero no cambiar el centro: el techo de permisos
  // lo pone el canal que el adaptador midió, no lo que el cliente afirme. Se deniega antes de tocar disco.
  if (channel === CHANNEL_API) {
    return answer(403, {
      ok: false,
      code: 'api-peer-restricted',
      message: 'una credencial de operador puede leer el centro, pero cambiarlo es del panel',
    });
  }

  if (route !== '' && route !== 'state') return notFound();

  // Un POST sin acción es un error del cliente, no una consulta: contestar con el estado escondería el
  // fallo justo cuando alguien está depurando el panel.
  const action = isPlainObject(body) ? String(body.action ?? '') : '';
  if (!isPlainObject(body) || action === '') {
    return answer(400, { ok: false, code: 'bad-request', message: 'un POST necesita un cuerpo JSON con «action»' });
  }

  const payload = isPlainObject(body.payload) ? body.payload : body;
  const cwd = String(body.cwd ?? payload.cwd ?? '');
  // El `cwd` del cliente no elige identidad cuando la sesión viva ya la fija (§1.2): si difiere, es 400 y
  // no se escribe nada. Sin sesión (herramientas, pruebas) se acepta la ruta del cuerpo, validada.
  if (action === 'register-project' && String(hostCwd).trim() !== '' && cwd.trim() !== ''
    && normalizeCwd(cwd).toLowerCase() !== normalizeCwd(hostCwd).toLowerCase()) {
    return answer(400, {
      ok: false,
      code: 'identity-from-client',
      apiVersion: API_VERSION,
      message: 'la ruta del proyecto la fija la sesión del Host: no se acepta otra ruta del cliente',
    });
  }
  const result = runAction({
    root,
    action,
    payload,
    // El actor NO se lee del cuerpo ni de una cabecera: este despacho es el canal humano (panel admitido).
    // La IA no pasa por aquí — usa las herramientas, cuyo punto de entrada fija `actor:'ai'`.
    actor: 'human',
    cwd: cwd !== '' ? cwd : hostCwd,
    hostCwd,
    now,
    registry,
    // Servicios y datos ya resueltos por el adaptador Cordis: el despacho no lee `process.env` ni `ctx`.
    skills,
    loader,
    sessions,
    dshHome,
    agentsHome,
    materializedRoot: materialized,
    hostSources,
    inventory: evidenceInventory,
    collisions: evidenceCollisions,
    // R17: el canal que admitió la petición es la evidencia de quién actúa (aquí sólo puede ser una
    // persona del panel; la IA entra por las herramientas, con su propio `actor`).
    actorEvidence: { kind: 'human', source: 'ui-channel', channel },
  });
  const status = result?.ok === true
    ? 200
    : ACTION_HTTP_STATUS[String(result?.code ?? '')] ?? 200;
  return answer(status, result, result?.ok === true && CHANGES_CATALOG.has(action));
}

/** La raíz del centro. Se puede redirigir por entorno para poder probarla sin tocar el almacén real. */
export function centerRoot(env = process.env) {
  const override = typeof env?.LIFECODE_SKILL_CENTER_ROOT === 'string' ? env.LIFECODE_SKILL_CENTER_ROOT.trim() : '';
  return override !== '' ? override : defaultRoot(env);
}

/** La respuesta honesta cuando el Host no puede dar el inventario: se puede reintentar. */
export function unavailableWorkspaces(reason = 'el Host no ofrece el registro de workspaces') {
  return {
    ok: false,
    code: WORKSPACE_UNAVAILABLE,
    apiVersion: API_VERSION,
    retryable: true,
    message: `${reason}: el inventario volverá cuando el Host lo ofrezca. No se ha leído ningún almacén privado.`,
  };
}

/**
 * El inventario de workspaces que el Host reconoce, más el cruce con los proyectos de LifeCode.
 *
 * Es async porque `Workspace.status()` lo es: preguntar si la carpeta sigue existiendo es lo único que
 * necesita esperar. **No escribe nada**: ni `center.json`, ni manifiestos, ni proyectos, ni asignaciones.
 * El `hostCwd` lo pone el adaptador desde la sesión viva; este módulo no acepta rutas del cliente.
 */
export async function workspacesPayload({
  root = centerRoot(),
  registry = null,
  hostCwd = '',
  now = new Date().toISOString(),
} = {}) {
  const shape = workspaceRegistryShape(registry);
  if (!shape.ok) return answer(503, unavailableWorkspaces(shape.reason));

  let items = [];
  try {
    items = registry.list();
  } catch (error) {
    return answer(503, unavailableWorkspaces(`workspaceRegistry.list() falló: ${String(error?.message ?? error)}`));
  }
  if (!Array.isArray(items)) {
    return answer(503, unavailableWorkspaces('workspaceRegistry.list() no devolvió una lista'));
  }

  // El estado del directorio se pregunta por workspace y se tolera el fallo: un `status()` que revienta
  // no puede hacer desaparecer el workspace del inventario, sólo dejarlo como «desconocido».
  const statuses = new Map();
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (id === '') continue;
    let status = AVAILABILITY_UNKNOWN;
    try {
      const reported = typeof item.status === 'function' ? await item.status() : AVAILABILITY_UNKNOWN;
      if (reported === AVAILABILITY_OK) status = AVAILABILITY_OK;
      else if (reported === AVAILABILITY_MISSING_DIR) status = AVAILABILITY_MISSING_DIR;
    } catch {
      status = AVAILABILITY_UNKNOWN;
    }
    statuses.set(id, status);
  }

  const loaded = loadState(root);
  const state = loaded.state ?? emptyState(now);
  const inventory = buildWorkspaceInventory({ items, statuses, state, hostCwd });
  const rows = Array.isArray(inventory.workspaces)
    ? inventory.workspaces.map((row) => ({ ...row, state: r16StateOf(row) }))
    : [];
  return answer(200, {
    ok: true,
    apiVersion: API_VERSION,
    generatedAt: now,
    readable: canWrite(loaded.integrity),
    ...inventory,
    workspaces: rows,
    // Vista de identidad calculada en la misma pasada: el panel la pinta en su pestaña, y su lectura no escribe.
    identity: identityPayload({ root, registry, workspaceItems: items }),
    // Aditivo: el panel nuevo distingue esta ruta de `/inventory`, y las filas dicen ya su estado R16.
    // Ninguna clave anterior cambia de forma ni de significado.
    deprecated: true,
  });
}

/* ──────────────────────────────────────── Actividad (R17) ─────────────────────────────────────── */

function activityLimitOf(value) {
  if (value === null || value === undefined || value === '') return { limit: ACTIVITY_DEFAULT_LIMIT };
  if (!/^\d+$/.test(String(value))) return { error: 'limit debe ser un entero entre 1 y 50' };
  const limit = Number(String(value));
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_MAX_LIMIT) {
    return { error: 'limit debe ser un entero entre 1 y 50' };
  }
  return { limit };
}

function activityCategoryOf(value) {
  if (value === null || value === undefined || value === '') return { category: 'all' };
  const category = String(value);
  if (!ACTIVITY_CATEGORY_FILTERS.includes(category)) {
    return { error: `category debe ser una de: ${ACTIVITY_CATEGORY_FILTERS.join(', ')}` };
  }
  return { category };
}

function activityBeforeOf(value) {
  if (value === null || value === undefined || value === '') return { before: null };
  const cursor = decodeActivityCursor(value);
  if (cursor === null) {
    return { error: 'before no es un cursor válido de la página anterior', reason: 'invalid-cursor' };
  }
  return { before: String(value) };
}

/**
 * `GET /api/activity`: lee el diario del centro y, si existe, el de conocimiento, y los proyecta.
 *
 * Sólo lectura: no usa `withState` ni el candado y no invalida el catálogo. Si el centro no se puede leer
 * se contesta 409 y no se publica nada; si falla la fuente secundaria se sirve la principal y se dice en
 * `sources` que `knowledge` no se pudo leer (nunca se finge que no hubo decisiones).
 */
export function activityPayload({ root = centerRoot(), search = '', hostCwd = '', now = new Date().toISOString() } = {}) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : String(search ?? ''));
  const limit = activityLimitOf(params.get('limit'));
  if (limit.error !== undefined) return answer(400, { ok: false, code: 'bad-request', message: limit.error, reason: 'invalid-limit' });
  const category = activityCategoryOf(params.get('category'));
  if (category.error !== undefined) return answer(400, { ok: false, code: 'bad-request', message: category.error, reason: 'invalid-category' });
  const before = activityBeforeOf(params.get('before'));
  if (before.error !== undefined) return answer(400, { ok: false, code: 'bad-request', message: before.error, reason: before.reason });

  const loaded = loadState(root);
  if (!canWrite(loaded.integrity)) {
    return answer(409, {
      ...unreadableResult(loaded, 'el almacén del centro no se puede leer: no se publica actividad sobre datos dudosos'),
      apiVersion: API_VERSION,
    });
  }
  const knowledgeLoaded = loadKnowledge(root);
  const knowledgeReadable = knowledgeLoaded.integrity === 'ok' || knowledgeLoaded.integrity === 'missing';
  const sources = [
    { id: 'center', status: 'ok', reason: null },
    knowledgeReadable
      ? { id: 'knowledge', status: 'ok', reason: null }
      : { id: 'knowledge', status: 'unreadable', reason: `${knowledgeLoaded.integrity}: ${knowledgeLoaded.reason ?? ''}`.trim() },
  ];
  const page = buildActivityFeed(loaded.state, knowledgeReadable ? knowledgeLoaded.document : null, {
    limit: limit.limit,
    before: before.before,
    category: category.category,
  });
  return answer(200, {
    ok: true,
    apiVersion: API_VERSION,
    generatedAt: now,
    sources,
    events: page.events,
    nextBefore: page.nextBefore,
    total: page.total,
    truncated: page.truncated,
  });
}

/**
 * Proyección de 9 claves de una entrada de actividad, la misma forma que publica la ruta y que el
 * cliente lee del `tool/result` (T42). `replayed` sólo es true cuando la operación se repitió sin
 * escribir: en ese caso nada se anuncia como persistido.
 */
export function activityProjectionOf(entry, replayed = false) {
  if (entry === null || typeof entry !== 'object') return null;
  return {
    eventId: entry.eventId ?? null,
    type: entry.type ?? null,
    category: entry.category ?? null,
    severity: entry.severity ?? null,
    titleKey: entry.titleKey ?? null,
    titleVars: entry.titleVars ?? {},
    persisted: entry.persisted !== false && replayed !== true,
    replayed: replayed === true,
    at: entry.at ?? null,
  };
}

/* ───────────────────────── Inventario y proyectos: fuentes del Host (R16) ───────────────────────── */
const SOURCE_COMPLETE = 'complete';
const SOURCE_INCOMPLETE = 'incomplete';
const SOURCE_UNAVAILABLE = 'unavailable';
const SOURCE_ERROR = 'error';

/** Estados R16 por fila de workspaces: `linkState` es un hecho del cruce; `state` es la proyección. */
const R16_STATE_BY_LINK = Object.freeze({
  linked: 'managed',
  conflict: 'identity-conflict',
  'legacy-match': 'discovered',
  missing: 'unavailable',
  unmatched: 'unavailable',
  'unknown-link': 'managed',
});

function r16StateOf(row) {
  return R16_STATE_BY_LINK[String(row?.linkState ?? '')] ?? 'managed';
}

/** Una fila de fuente: `id`, estado y motivo. Nunca una fuente ausente sin decirlo. */
function sourceRow(id, status, reason = '') {
  return { id, status, reason: String(reason ?? '') };
}

/** Ruta del manifiesto R16 en el centro. Se indexa por `projectId`; dentro vive el uuid del proyecto. */
export function projectManifestPath(root, projectId) {
  return join(root, 'projects', String(projectId ?? ''), 'manifest.json');
}

/**
 * Escribe (o reutiliza) el manifiesto R16 del proyecto **en el centro**, nunca dentro del proyecto.
 *
 * El uuid que exige `validateManifest` es la identidad del proyecto: se reutiliza la que ya tuviera el
 * registro (legacy/adopción) y, si no hay, se genera una. Un manifiesto existente roto no se pisa: eso
 * sería perder una identidad que alguien pudo anclar, así que se devuelve `identity-conflict`.
 */
function writeCenterManifest({ root, project, now }) {
  const directory = join(root, 'projects', String(project.id));
  const path = projectManifestPath(root, project.id);
  const existing = readManifest(path);
  if (existing.status === 'ok' && isUuidV4(existing.manifest?.projectId) === true) {
    return { ok: true, path, uuid: existing.manifest.projectId, sha256: existing.sha256, registeredAt: existing.manifest.registeredAt };
  }
  if (existing.status !== 'missing') {
    return {
      ok: false,
      code: 'identity-conflict',
      message: `hay un manifiesto en ${path} que no se puede adoptar (${existing.status}${existing.reason ? `: ${existing.reason}` : ''}); no se sobrescribe`,
    };
  }
  const uuid = isUuidV4(project.uuid) ? project.uuid : randomUUID();
  const registeredAt = isCanonicalUtc(String(now ?? '')) ? now : new Date().toISOString();
  const bytes = manifestBytes(newManifest({ projectId: uuid, registeredAt }));
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, bytes, { flag: 'wx' });
  } catch (error) {
    // Otra petición pudo escribir el mismo manifiesto entre la lectura y la escritura: se relee.
    if (error?.code === 'EEXIST') {
      const raced = readManifest(path);
      if (raced.status === 'ok' && isUuidV4(raced.manifest?.projectId) === true) {
        return { ok: true, path, uuid: raced.manifest.projectId, sha256: raced.sha256, registeredAt: raced.manifest.registeredAt };
      }
    }
    return { ok: false, code: 'manifest-write', message: `no se pudo escribir el manifiesto: ${error?.code ?? error?.message ?? error}` };
  }
  return { ok: true, path, uuid, sha256: sha256Hex(bytes), registeredAt };
}

/** `limit` del inventario: entero no negativo; cualquier otra cosa es un error del cliente. */
function normalizeInventoryLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : 'error';
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return 'error';
  return Number(text);
}

/**
 * Ruta de proyecto confiable: absoluta y ya normalizada. Un `cwd` del cuerpo es una propuesta, no una
 * identidad: `..` o una ruta relativa registrarían un proyecto fuera de cualquier workspace real.
 *
 * Acepta unidad de disco (`C:/...`), UNC (`//server/share/...`) y raíz POSIX (`/...`).
 */
function trustedCwd(value) {
  const text = normalizeCwd(String(value ?? '').trim());
  if (text === '' || text === '..' || text.startsWith('../') || text.includes('/../') || text.endsWith('/..')) return null;
  if (/^[A-Za-z]:\//.test(text)) return text;
  if (/^\/\/[^/]+\/[^/]+/.test(text)) return text;
  if (/^\/[^/]/.test(text)) return text;
  return null;
}

/** Adaptadores de E/S del inventario. Las funciones del Host se pasan tal cual: si no hay servicio, `null`. */
function inventoryAdapters({ skills, loader, dshHome, agentsHome, materialized }) {
  return {
    // El núcleo recibe datos, no `Dirent`: con el objeto crudo `isDirectory` sería una función (siempre
    // verdadera) y las raíces con `layout` se saltarían sus carpetas como si fueran symlinks.
    readdir: (path) => readdirSync(path, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    })),
    stat: (path) => statSync(path),
    lstat: (path) => lstatSync(path),
    readFile: (path) => readFileSync(path, 'utf8'),
    realpath: (path) => realpathSync(path),
    listSkills: typeof skills?.snapshot === 'function' ? ({ cwd } = {}) => skills.snapshot({ cwd }) : null,
    getLoaderEntries: typeof loader?.entries === 'function'
      ? () => {
        try {
          return loader.entries();
        } catch {
          return null;
        }
      }
      : null,
    // Datos de entorno ya resueltos por el adaptador Cordis: el núcleo no lee `process.env`.
    dshHome: String(dshHome ?? ''),
    agentsHome: String(agentsHome ?? ''),
    materializedRoot: String(materialized ?? ''),
  };
}

/**
 * Categoría de propiedad de una entrada del inventario (R16.3 §2).
 *
 * El inventario usa `owner.kind` con el vocabulario del Host (`lifecode`, `filesystem`, `bundled`,
 * `plugin`, `host`); el panel necesita cinco categorías cerradas y autoexplicativas. Este mapa es la
 * ÚNICA traducción y no inventa propietarios: un `kind` que no conocemos cae a `unknown`, que es una
 * categoría real (evidencia insuficiente), no un cajón de sastre para lo que no cuadra.
 *
 * - `own`: una skill de LifeCode (registro v3 o vista materializada nuestra).
 * - `external`: la publica OTRO plugin (`plugin`). Es el único caso: un paquete ajeno identificable.
 * - `filesystem`: está en disco sin manifiesto de propietario (raíces del Host o del proyecto).
 * - `host`: la sirve el Host sin propietario externo identificable: catálogo del Host y sus skills
 *   builtin (`bundled`, p.ej. las de office). R16.3bis §4: son del Host, no «externas».
 * - `unknown`: no hay evidencia suficiente para afirmar ninguna de las anteriores.
 *
 * Invariante: `suma(byOwner) === total`; `unknown` nunca se suma a `own` ni a `external`.
 */
const OWNER_CATEGORY_BY_KIND = Object.freeze({
  lifecode: 'own',
  plugin: 'external',
  bundled: 'host',
  filesystem: 'filesystem',
  host: 'host',
});

function ownerCategoryOf(entry) {
  const kind = String(entry?.owner?.kind ?? '').trim().toLowerCase();
  return Object.hasOwn(OWNER_CATEGORY_BY_KIND, kind) ? OWNER_CATEGORY_BY_KIND[kind] : 'unknown';
}

export function countOwners(entries) {
  const counts = { own: 0, external: 0, filesystem: 0, host: 0, unknown: 0 };
  for (const entry of entries) counts[ownerCategoryOf(entry)] += 1;
  return counts;
}

/**
 * Filas de fuente que `collectInventory` no puede observar por sí solo: el lector de manifiestos del
 * centro, el registro de workspaces y el servicio de sesiones (R16.3bis §3). Se miden aquí, con la
 * evidencia que el adaptador sí tiene, y se declaran con su estado real: nunca `complete` por omisión.
 */
function evidenceSourceRow(id, status, reason, label = '') {
  const row = { id, status, reason };
  if (label !== '') row.label = label;
  return row;
}

/** Sustituye por `id` las filas medidas; conserva el orden del barrido y añade las que no existían. */
function mergeSourceRows(sources, overrides) {
  const byId = new Map();
  for (const row of overrides) if (isPlainObject(row) && typeof row.id === 'string') byId.set(row.id, row);
  const merged = [];
  const seen = new Set();
  for (const row of Array.isArray(sources) ? sources : []) {
    if (!isPlainObject(row)) continue;
    seen.add(row.id);
    merged.push(byId.get(row.id) ?? row);
  }
  for (const row of byId.values()) if (!seen.has(row.id)) merged.push(row);
  return merged;
}

/**
 * Estado del lector de manifiestos propios: recorre `projects/<slug>/manifest.json` y declara
 * `incomplete` en cuanto uno no se puede leer. La ausencia de manifiestos es un hecho observable, no un
 * fallo: un centro vacío es `complete` con el motivo escrito.
 */
function manifestSourceRow(root) {
  const directory = join(root, 'projects');
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return evidenceSourceRow('manifest', 'complete', 'el centro no tiene proyectos: no hay manifiestos que leer');
    return evidenceSourceRow('manifest', 'error', `no se pudo leer el directorio de manifiestos (${error?.code ?? error?.message ?? error})`);
  }
  let checked = 0;
  for (const entry of entries) {
    if (typeof entry?.isDirectory !== 'function' || !entry.isDirectory()) continue;
    const read = readManifest(projectManifestPath(root, entry.name));
    checked += 1;
    if (read?.status === 'ok' || read?.status === 'missing') continue;
    const why = read?.reason ? `: ${read.reason}` : '';
    return evidenceSourceRow('manifest', 'incomplete', `el manifiesto ${read?.path ?? entry.name} está ${read?.status ?? 'ilegible'}${why}`);
  }
  return evidenceSourceRow('manifest', 'complete', checked === 0 ? 'el centro no tiene manifiestos de proyecto' : `${checked} manifiesto(s) de proyecto comprobados`);
}

/**
 * Estado del registro de workspaces medido aquí. Devuelve también las filas de workspace para que el
 * motor de colisiones cruce rutas reales en vez de una lista vacía.
 */
async function workspaceRegistrySource({ registry = null, hostCwd = '' } = {}) {
  const shape = workspaceRegistryShape(registry);
  if (!shape.ok) {
    return {
      row: evidenceSourceRow('workspace-registry', 'unavailable', shape.reason ?? 'el Host no ofrece el registro de workspaces'),
      workspaces: [],
    };
  }
  let items;
  try {
    items = await registry.list();
  } catch (error) {
    return { row: evidenceSourceRow('workspace-registry', 'error', `list() falló: ${error?.message ?? error}`), workspaces: [] };
  }
  if (!Array.isArray(items)) {
    return { row: evidenceSourceRow('workspace-registry', 'error', 'list() no devolvió una lista de workspaces'), workspaces: [] };
  }
  const statuses = new Map();
  for (const item of items) {
    let status = AVAILABILITY_UNKNOWN;
    try {
      const measured = await item?.status?.();
      status = measured === AVAILABILITY_OK ? AVAILABILITY_OK : measured === AVAILABILITY_MISSING_DIR ? AVAILABILITY_MISSING_DIR : AVAILABILITY_UNKNOWN;
    } catch {
      status = AVAILABILITY_UNKNOWN;
    }
    statuses.set(item?.id, status);
  }
  const workspaces = items.filter(isPlainObject).map((item) => {
    const status = statuses.get(item.id) ?? AVAILABILITY_UNKNOWN;
    return { ...workspaceOf(item, status), availability: status };
  });
  const observed = normalizeCwd(String(hostCwd ?? '')).toLowerCase();
  const inList = observed !== '' && workspaces.some((workspace) => normalizeCwd(workspace.path).toLowerCase() === observed);
  const detail = observed === '' ? 'sin cwd de sesión para cruzar' : inList ? 'el cwd observado está entre ellos' : 'el cwd observado no está entre ellos';
  return { row: evidenceSourceRow('workspace-registry', 'complete', `${items.length} workspace(s) listados; ${detail}`), workspaces };
}

/** Estado del servicio de sesiones: `unavailable` cuando el adaptador no lo recibió, con el motivo real. */
async function sessionsSourceRow(sessions) {
  if (typeof sessions?.list !== 'function') {
    return evidenceSourceRow('sessions', 'unavailable', 'el adaptador no recibió el servicio de sesiones');
  }
  let value;
  try {
    value = await sessions.list();
  } catch (error) {
    return evidenceSourceRow('sessions', 'error', `list() falló: ${error?.message ?? error}`);
  }
  if (!Array.isArray(value)) return evidenceSourceRow('sessions', 'error', 'list() no devolvió una lista de sesiones');
  return evidenceSourceRow('sessions', 'complete', `${value.length} sesión(es) listadas`);
}

/**
 * Proyecto que el Host está mirando, para limitar `assignment-shadowed` (R16.3bis §2): se resuelve por
 * el `hostCwd` contra los proyectos registrados. `undefined` (sin cwd) conserva el barrido histórico;
 * `null` significa «hay cwd observado pero ningún registro coincide», así que ninguna asignación es del
 * proyecto observado.
 */
function observedProjectIdOf(state, hostCwd) {
  const cwd = normalizeCwd(String(hostCwd ?? ''));
  if (cwd === '') return undefined;
  const key = cwd.toLowerCase();
  for (const record of Object.values(state?.projects ?? {})) {
    if (!isPlainObject(record)) continue;
    if (normalizeCwd(record?.cwd ?? '').toLowerCase() === key) return record.id;
  }
  return null;
}

/**
 * Foto de evidencia para las compuertas: inventario real (fuentes + entradas) y el resultado del motor de
 * colisiones sobre el mismo estado. Sólo lee. Se calcula **antes** de cualquier acción que escriba para que
 * el preflight juzgue sobre lo que hay, no sobre un lienzo vacío.
 *
 * Devuelve `{unavailable}` si el Host no ofrece el catálogo y `{storeUnreadable}` si el almacén no es
 * legible: en ambos casos el llamante debe decirlo, nunca fingir una evidencia completa.
 */
export async function inventoryEvidence({
  root = centerRoot(),
  registry = null,
  skills = null,
  loader = null,
  sessions = null,
  hostCwd = '',
  cwd = '',
  now = new Date().toISOString(),
  dshHome = '',
  agentsHome = '',
  materializedRoot: materialized = '',
  limit = null,
} = {}) {
  if (typeof skills?.snapshot !== 'function') {
    return { unavailable: { code: 'skills-registry-unavailable', message: 'el Host no ofrece el catálogo de skills' } };
  }
  const loaded = loadState(root);
  if (!canWrite(loaded.integrity)) return { storeUnreadable: loaded };
  const state = loaded.state ?? emptyState(now);
  const collected = await inventoryModule.collectInventory(
    inventoryAdapters({ skills, loader, dshHome, agentsHome, materialized }),
    {
      root,
      cwd: String(cwd ?? '').trim() !== '' ? String(cwd) : String(hostCwd ?? ''),
      state,
      now,
      dshHome: String(dshHome ?? ''),
      agentsHome: String(agentsHome ?? ''),
      materializedRoot: String(materialized ?? ''),
      ...(Number.isInteger(limit) && limit >= 0 ? { limits: { maxEntries: limit } } : {}),
    },
  );
  const entries = Array.isArray(collected?.entries) ? collected.entries : [];
  const observedCwd = String(cwd ?? '').trim() !== '' ? String(cwd) : String(hostCwd ?? '');
  const [registryMeasured, sessionsRow] = await Promise.all([
    workspaceRegistrySource({ registry, hostCwd: observedCwd }),
    sessionsSourceRow(sessions),
  ]);
  const sources = mergeSourceRows(collected?.sources, [
    manifestSourceRow(root),
    registryMeasured.row,
    sessionsRow,
  ]);
  const collisions = detectCollisions({
    entries,
    projects: Object.values(state.projects ?? {}),
    assignments: state.assignments ?? null,
    workspaces: registryMeasured.workspaces,
    manifests: [],
    observedProjectId: observedProjectIdOf(state, observedCwd),
  });
  return {
    state,
    sources,
    collisions,
    inventory: {
      entries,
      sources,
      complete: collected?.complete === true,
      generatedAt: collected?.generatedAt ?? now,
      truncated: collected?.truncated === true,
      warnings: Array.isArray(collected?.warnings) ? collected.warnings : [],
      project: collected?.project ?? null,
    },
  };
}

/**
 * `GET /api/inventory`: las skills que existen de verdad, vistas desde todas las fuentes (§5.1).
 *
 * Es async porque el catálogo del Host y el cruce de rutas lo son. Sólo lee: ni almacén, ni proyectos,
 * ni materializado. Si el catálogo no está, contesta 503; si el almacén no se puede leer, 409; un `limit`
 * que no es un entero es 400. Una fuente parcial viaja como tal en `sources` — nunca un 200 «sin
 * conflictos» sobre evidencia incompleta.
 */
export async function inventoryPayload({
  root = centerRoot(),
  registry = null,
  skills = null,
  loader = null,
  sessions = null,
  hostCwd = '',
  cwd = '',
  now = new Date().toISOString(),
  dshHome = '',
  agentsHome = '',
  materializedRoot: materialized = '',
  limit = undefined,
} = {}) {
  const effectiveLimit = normalizeInventoryLimit(limit);
  if (effectiveLimit === 'error') {
    return answer(400, {
      ok: false,
      code: 'bad-request',
      apiVersion: API_VERSION,
      message: '«limit» tiene que ser un entero no negativo (o no enviarse)',
    });
  }
  if (typeof skills?.snapshot !== 'function') {
    return answer(503, {
      ok: false,
      code: 'skills-registry-unavailable',
      apiVersion: API_VERSION,
      retryable: true,
      message: 'el Host no ofrece el catálogo de skills: el inventario volverá cuando lo ofrezca. No se ha inventado ninguna entrada.',
    });
  }

  const evidence = await inventoryEvidence({
    root,
    registry,
    skills,
    loader,
    sessions,
    hostCwd,
    cwd,
    now,
    dshHome,
    agentsHome,
    materializedRoot: materialized,
    limit: effectiveLimit,
  });
  if (evidence.unavailable !== undefined) {
    return answer(503, {
      ok: false,
      code: 'skills-registry-unavailable',
      apiVersion: API_VERSION,
      retryable: true,
      message: 'el Host no ofrece el catálogo de skills: el inventario volverá cuando lo ofrezca. No se ha inventado ninguna entrada.',
    });
  }
  if (evidence.storeUnreadable !== undefined) {
    return answer(409, {
      ...unreadableResult(evidence.storeUnreadable, 'el almacén del centro no se puede leer: no se publica un inventario sobre datos dudosos'),
      apiVersion: API_VERSION,
    });
  }
  const { inventory, collisions } = evidence;
  const entries = inventory.entries;
  const sources = inventory.sources;
  const summary = {
    total: entries.length,
    byOwner: countOwners(entries),
    shadowed: entries.filter((entry) => entry?.association?.shadowedBy !== undefined && entry?.association?.shadowedBy !== null).length,
    ambiguous: collisions.ambiguousNames.length,
    invalidNames: entries.filter((entry) => entry?.canonicalName === null || entry?.canonicalName === undefined).length,
  };
  return answer(200, {
    ok: true,
    apiVersion: API_VERSION,
    contractVersion: API_CONTRACT_VERSION,
    generatedAt: inventory.generatedAt,
    complete: inventory.complete,
    truncated: inventory.truncated,
    sources,
    entries,
    collisions: collisions.collisions,
    summary,
  });
}

/** Estado del directorio de un proyecto para el preflight; `unknown` si no se puede resolver. */
function projectAvailabilityOf(path) {
  const target = String(path ?? '').trim();
  if (target === '') return { status: 'unknown', path: '', exists: false };
  try {
    const info = statSync(target);
    if (!info.isDirectory()) return { status: 'unknown', path: target, exists: false };
    realpathSync(target);
    return { status: 'ok', path: target, exists: true };
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing-dir', path: target, exists: false };
    return { status: 'unknown', path: target, exists: false };
  }
}

/** Evidencia de `filesystem-project`/`filesystem-view`: un ENOENT observable es un hecho, no un error. */
function pathEvidence(id, path) {
  const availability = projectAvailabilityOf(path);
  if (availability.status === 'ok') return sourceRow(id, SOURCE_COMPLETE, '');
  if (availability.status === 'missing-dir') return sourceRow(id, SOURCE_COMPLETE, 'la ruta todavía no existe: el alta puede no crearla, pero la ausencia es observable');
  if (String(path ?? '').trim() === '') return sourceRow(id, SOURCE_INCOMPLETE, 'no hay ruta que inspeccionar');
  return sourceRow(id, SOURCE_INCOMPLETE, `la ruta no se pudo resolver: ${availability.path}`);
}

/** Evidencia de `manifest`: ausencia observada es `complete`; un manifiesto roto es `incomplete`. */function manifestEvidence(root, projectId) {
  if (String(projectId ?? '') === '') return sourceRow('manifest', SOURCE_COMPLETE, 'no hay proyecto del que leer manifiesto todavía');
  const read = readManifest(projectManifestPath(root, projectId));
  if (read.status === 'ok') return sourceRow('manifest', SOURCE_COMPLETE, '');
  if (read.status === 'missing') return sourceRow('manifest', SOURCE_COMPLETE, 'no hay manifiesto: la ausencia es un hecho observable');
  return sourceRow('manifest', SOURCE_INCOMPLETE, `manifiesto ${read.status}${read.reason ? `: ${read.reason}` : ''}`);
}

/**
 * Vista plana del manifiesto que consume `projects.mjs`: `projectId` es el **slug** con el que se indexa
 * el proyecto del centro y `uuid` es el `projectId` uuid que vive dentro del manifiesto. Sin esta
 * traducción, `classifyProject` compararía un uuid con un slug y todo saldría `identity-conflict`.
 */
function manifestObservation(read, projectId) {
  if (read?.status === 'ok') {
    return {
      status: 'ok',
      present: true,
      valid: true,
      projectId: String(projectId),
      uuid: String(read.projectId ?? ''),
      sha256: read.sha256 ?? null,
      registeredAt: read.registeredAt ?? null,
      path: read.path ?? '',
      manifest: read.manifest ?? null,
    };
  }
  if (read?.status === 'missing') {
    return { status: 'missing', present: false, valid: false, projectId: String(projectId), uuid: null, sha256: null, path: read.path ?? '' };
  }
  return {
    status: String(read?.status ?? 'unreadable'),
    present: true,
    valid: false,
    projectId: String(projectId),
    uuid: null,
    sha256: read?.sha256 ?? null,
    path: read?.path ?? '',
    reason: String(read?.reason ?? ''),
  };
}

function workspaceRegistryEvidence(registry, cwd) {
  if (registry === null || registry === undefined) return sourceRow('workspace-registry', SOURCE_UNAVAILABLE, 'el Host no ofrece el registro de workspaces');
  const shape = workspaceRegistryShape(registry);
  if (!shape.ok) return sourceRow('workspace-registry', SOURCE_UNAVAILABLE, shape.reason);
  try {
    const items = registry.list();
    if (!Array.isArray(items)) return sourceRow('workspace-registry', SOURCE_INCOMPLETE, 'list() no devolvió una lista');
    const found = items.some((item) => normalizeCwd(item?.path) === normalizeCwd(cwd));
    return sourceRow('workspace-registry', SOURCE_COMPLETE, found ? '' : 'la ruta actual no está listada como workspace');
  } catch (error) {
    return sourceRow('workspace-registry', SOURCE_INCOMPLETE, `list() falló: ${String(error?.message ?? error)}`);
  }
}

/**
 * Fuentes que cada acción R16 exige (mapa cerrado del contrato §4.3; el del prompt manda sobre el texto
 * viejo). Las claves son las acciones canónicas del preflight; `toggle` se traduce a `assign-skill` o
 * `enable-skill` según lo que pida el cuerpo. Sólo se adjuntan las fuentes de la acción: una fuente de
 * otra operación no puede bloquear ésta.
 */
const ACTION_SOURCES = Object.freeze({
  'register-project': ['state', 'filesystem-project', 'workspace-registry', 'manifest'],
  'adopt-project': ['state', 'manifest', 'filesystem-project'],
  'repair-manifest': ['state', 'manifest', 'filesystem-project'],
  'detach-project': ['state', 'manifest', 'filesystem-project'],
  'materialize-project': ['state', 'manifest', 'skills-registry', 'filesystem-view'],
  'assign-skill': ['state', 'manifest', 'skills-registry'],
  'enable-skill': ['state', 'manifest', 'skills-registry'],
  'create-skill': ['state', 'manifest', 'skills-registry'],
  'publish-version': ['state', 'manifest', 'skills-registry'],
});

/**
 * Traduce el nombre de la acción de la API a la acción canónica del preflight. `null` = sin compuerta:
 * preferimos no fingir una decisión antes que inventarla para una acción que no está en el mapa.
 */
function preflightActionOf(action, data) {
  if (action === 'toggle') return data?.enabled === false ? 'assign-skill' : 'enable-skill';
  if (action === 'create' || action === 'import' || action === 'import-bundle') return 'create-skill';
  if (action === 'publish') return 'publish-version';
  return Object.prototype.hasOwnProperty.call(ACTION_SOURCES, action) ? action : null;
}

function hostSourceRows(hostSources) {
  const rows = new Map();
  const list = Array.isArray(hostSources) ? hostSources : hostSources?.sources;
  if (!Array.isArray(list)) return rows;
  for (const row of list) {
    if (row !== null && typeof row === 'object' && typeof row.id === 'string') rows.set(row.id, sourceRow(row.id, row.status ?? SOURCE_UNAVAILABLE, row.reason ?? ''));
  }
  return rows;
}

/**
 * Evalúa el preflight de una acción que escribe, **antes** de tocar el almacén.
 *
 * Devuelve `null` si la acción no tiene compuerta (o si el dominio aún no está disponible: nunca se finge
 * una decisión), `{storeUnreadable}` si el documento está roto, o el resultado puro del preflight.
 */
function actionPreflight({
  root,
  action,
  data,
  cwd,
  now,
  hostSources = null,
  registry = null,
  materialized = '',
  sessions = null,
  inventory: measuredInventory = null,
  collisions: measuredCollisions = null,
}) {
  const canonical = preflightActionOf(action, data);
  const ids = canonical === null ? null : ACTION_SOURCES[canonical];
  const runPreflight = typeof preflightModule?.preflight === 'function' ? preflightModule.preflight : null;
  if (!Array.isArray(ids) || runPreflight === null) return null;
  // Crear y publicar son las únicas acciones cuya compuerta depende de evidencia que SÓLO el adaptador
  // puede medir (catálogo del Host). Si no hay foto alguna ni fila de fuente —llamada núcleo, pruebas
  // heredadas— no se finge una decisión: se ejecuta como antes, sin compuerta. Con adaptador (HTTP,
  // herramienta IA) siempre llega la foto, y ahí la política R16.1 §2 es fail-closed para publicar.
  const hostEvidenced = measuredInventory !== null || hostSources !== null;
  if ((canonical === 'create-skill' || canonical === 'publish-version') && !hostEvidenced) return null;

  const loaded = loadState(root);
  if (!canWrite(loaded.integrity)) return { storeUnreadable: loaded };
  const state = loaded.state ?? emptyState(now);

  const explicitProject = String(data.projectId ?? '');
  const fromCwd = findProject(state, cwd);
  const projectId = explicitProject !== '' ? explicitProject : String(fromCwd?.id ?? '');
  const project = state.projects?.[projectId];
  const targetCwd = canonical === 'register-project'
    ? String(data.cwd ?? cwd)
    : String(project?.cwd ?? cwd ?? '');
  // Sin ruta no hay alta posible: el error correcto es `invalid-cwd` de la acción, no un preflight falso.
  if (canonical === 'register-project' && String(targetCwd).trim() === '') return null;

  const rows = new Map();
  // La foto medida por el adaptador es la base: sus fuentes y sus entradas son evidencia real, no una
  // suposición. Sin foto (llamada directa de pruebas/herramientas) se cae al mínimo honesto de abajo.
  if (measuredInventory !== null && Array.isArray(measuredInventory.sources)) {
    for (const row of measuredInventory.sources) {
      if (row !== null && typeof row === 'object' && typeof row.id === 'string') {
        rows.set(row.id, sourceRow(row.id, row.status ?? SOURCE_UNAVAILABLE, row.reason ?? ''));
      }
    }
  }
  rows.set('state', sourceRow('state', SOURCE_COMPLETE, ''));
  if (ids.includes('manifest')) rows.set('manifest', manifestEvidence(root, projectId));
  if (ids.includes('filesystem-project')) rows.set('filesystem-project', pathEvidence('filesystem-project', targetCwd));
  if (ids.includes('filesystem-view')) {
    const viewPath = projectId === '' ? '' : join(materialized !== '' ? materialized : materializedRoot(root), projectId);
    rows.set('filesystem-view', pathEvidence('filesystem-view', viewPath));
  }
  if (ids.includes('workspace-registry') && registry !== null && registry !== undefined) {
    rows.set('workspace-registry', workspaceRegistryEvidence(registry, targetCwd));
  }
  if (ids.includes('skills-registry') && rows.has('skills-registry') !== true) {
    rows.set('skills-registry', sourceRow('skills-registry', SOURCE_UNAVAILABLE, 'el Host no ofreció el catálogo de skills en esta petición'));
  }
  if (sessions !== null && sessions !== undefined) {
    rows.set('sessions', sourceRow('sessions', SOURCE_COMPLETE, ''));
  }
  // La evidencia que el adaptador midió (async) pisa la suposición: es la única que puede afirmar `complete`.
  for (const [id, row] of hostSourceRows(hostSources)) rows.set(id, row);

  const sources = [...rows.values()];
  const availability = projectAvailabilityOf(targetCwd);
  // Sólo las acciones que de verdad miran el sistema de ficheros del proyecto declaran su disponibilidad:
  // asignar o habilitar una skill en un registro existente no escribe en el proyecto, así que una carpeta
  // ausente no puede bloquearlas (el contrato no les exige `filesystem-project`).
  const filesystemAware = ids.includes('filesystem-project') || ids.includes('filesystem-view');
  const reportedAvailability = filesystemAware ? availability.status : 'unknown';
  // El preflight puro no hace E/S: recibe la foto real de inventario y colisiones; sólo si no la hay usa la
  // mínima segura (entradas vacías) para no inventar conflictos ni silenciar los ya medidos.
  const inventory = {
    entries: Array.isArray(measuredInventory?.entries) ? measuredInventory.entries : [],
    sources,
    // Sin foto medida no se afirma que el inventario esté completo: la ausencia de entradas es una
    // incógnita, no un «no hay nada». Quien bloquee por esto usa las fuentes, no el lienzo vacío.
    complete: measuredInventory !== null ? measuredInventory.complete === true : false,
    generatedAt: measuredInventory?.generatedAt ?? now,
    truncated: measuredInventory?.truncated === true,
    warnings: Array.isArray(measuredInventory?.warnings) ? measuredInventory.warnings : [],
    project: measuredInventory?.project ?? { cwd: targetCwd, availability: reportedAvailability, exists: availability.exists },
  };
  const collisions = measuredCollisions !== null && typeof measuredCollisions === 'object'
    ? measuredCollisions
    : { collisions: [], ambiguousNames: [], byKey: new Map() };
  return runPreflight({
    action: canonical,
    root,
    state,
    inventory,
    collisions,
    sources,
    projectId,
    skillId: String(data.skillId ?? data.id ?? ''),
    target: { cwd: targetCwd, directory: materialized !== '' ? materialized : materializedRoot(root) },
    projectAvailability: reportedAvailability,
    integrity: loaded.integrity,
    now,
  });
}

/**
 * `GET /api/projects`: los siete estados de la proyección (§5.4), sin escribir nada.
 *
 * El registro de workspaces es obligatorio (`503` honesto si falta); el catálogo de skills es opcional y,
 * si falta, el inventario viaja con su fuente `unavailable` en vez de fingir que no hay entradas.
 */
export async function projectsPayload({
  root = centerRoot(),
  registry = null,
  hostCwd = '',
  cwd = '',
  skills = null,
  loader = null,
  sessions = null,
  now = new Date().toISOString(),
  dshHome = '',
  agentsHome = '',
  materializedRoot: materialized = '',
} = {}) {
  const shape = workspaceRegistryShape(registry);
  if (!shape.ok) return answer(503, unavailableWorkspaces(shape.reason));

  let items = [];
  try {
    items = registry.list();
  } catch (error) {
    return answer(503, unavailableWorkspaces(`workspaceRegistry.list() falló: ${String(error?.message ?? error)}`));
  }
  if (!Array.isArray(items)) return answer(503, unavailableWorkspaces('workspaceRegistry.list() no devolvió una lista'));

  const statuses = new Map();
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (id === '') continue;
    let status = AVAILABILITY_UNKNOWN;
    try {
      const reported = typeof item.status === 'function' ? await item.status() : AVAILABILITY_UNKNOWN;
      if (reported === AVAILABILITY_OK) status = AVAILABILITY_OK;
      else if (reported === AVAILABILITY_MISSING_DIR) status = AVAILABILITY_MISSING_DIR;
    } catch {
      status = AVAILABILITY_UNKNOWN;
    }
    statuses.set(id, status);
  }
  const workspaces = items.map((item) => workspaceOf(item, statuses.get(item?.id) ?? AVAILABILITY_UNKNOWN));

  const loaded = loadState(root);
  if (!canWrite(loaded.integrity)) {
    return answer(409, {
      ...unreadableResult(loaded, 'el almacén del centro no se puede leer: no se proyectan estados de proyectos sobre datos dudosos'),
      apiVersion: API_VERSION,
    });
  }
  const state = loaded.state ?? emptyState(now);
  const effectiveCwd = String(cwd ?? '').trim() !== '' ? String(cwd) : String(hostCwd ?? '');

  let inventory = null;
  if (typeof skills?.snapshot === 'function') {
    try {
      inventory = await inventoryModule.collectInventory(
        inventoryAdapters({ skills, loader, dshHome, agentsHome, materialized }),
        {
          root,
          cwd: effectiveCwd,
          state,
          now,
          dshHome: String(dshHome ?? ''),
          agentsHome: String(agentsHome ?? ''),
          materializedRoot: String(materialized ?? ''),
        },
      );
    } catch {
      // El inventario es evidencia opcional para la proyección: si falla, la fuente lo dirá y no se inventa.
      inventory = null;
    }
  }

  // Manifiestos e inspecciones del materializado, indexados por projectId y por cwd canónico: la proyección
  // es pura y no toca disco, así que el adaptador le entrega ambos mapas ya leídos.
  const manifests = {};
  const inspections = {};
  for (const project of Object.values(state.projects ?? {})) {
    if (project === null || typeof project !== 'object' || typeof project.id !== 'string') continue;
    const read = readManifest(projectManifestPath(root, project.id));
    const observation = manifestObservation(read, project.id);
    manifests[project.id] = observation;
    const canonical = normalizeCwd(project.cwd);
    if (canonical !== '') manifests[canonical] = observation;
    try {
      const inspected = inspectProject({ root, projectId: project.id });
      // La inspección sólo es "complete" si además se pudo leer el manifiesto: un `unreadable`/`future`
      // es una fuente con error y el contrato exige `partially-inspected` (fail-closed), no fingir salud.
      const manifestStatus = observation.status;
      const inspectionIncomplete = manifestStatus === 'unreadable' || manifestStatus === 'future';
      inspections[project.id] = {
        ...inspected,
        status: inspectionIncomplete ? 'incomplete' : 'complete',
        inspectedAt: now,
        reason: inspectionIncomplete ? `manifest-${manifestStatus}` : '',
      };
    } catch (error) {
      inspections[project.id] = { status: 'failed', inspectedAt: now, reason: String(error?.message ?? error) };
    }
  }

  // Manifiestos del centro de workspaces NO registrados: uno válido en disco sin registro es
  // `external-managed` (contrato §1.2). La proyección pura necesita además el `cwd` al que pertenece.
  for (const workspace of workspaces) {
    const workspacePath = String(workspace?.path ?? '');
    if (workspacePath.trim() === '') continue;
    const derived = projectIdFor(workspacePath);
    if (state.projects?.[derived] !== undefined || manifests[derived] !== undefined) continue;
    const observation = manifestObservation(readManifest(projectManifestPath(root, derived)), derived);
    if (!observation.present) continue;
    manifests[derived] = { ...observation, cwd: workspacePath };
    manifests[normalizeCwd(workspacePath)] = manifests[derived];
  }

  // La existencia de cada carpeta registrada es E/S: la mide el adaptador y se la pasa a la proyección
  // pura. Sin esta medición la ficha no puede distinguir «disponible» de «ya no está» (D4).
  const availability = [];
  for (const project of Object.values(state.projects ?? {})) {
    if (project === null || typeof project !== 'object' || typeof project.id !== 'string') continue;
    const projectPath = String(project.cwd ?? '').trim();
    availability.push({
      projectId: project.id,
      cwd: projectPath,
      availability: projectPath === '' ? AVAILABILITY_UNKNOWN : projectAvailabilityOf(projectPath).status,
    });
  }

  const projected = projectsModule.buildProjectsPayload({
    workspaces,
    registry,
    state,
    hostCwd: effectiveCwd,
    cwd: effectiveCwd,
    inventory,
    sources: Array.isArray(inventory?.sources) ? inventory.sources : [],
    sessions,
    manifests,
    inspections,
    availability,
    now,
  });

  return answer(200, {
    ok: true,
    apiVersion: API_VERSION,
    contractVersion: API_CONTRACT_VERSION,
    generatedAt: projected?.generatedAt ?? now,
    readable: true,
    complete: projected?.complete === true,
    sources: Array.isArray(projected?.sources) ? projected.sources : (Array.isArray(inventory?.sources) ? inventory.sources : []),
    discovered: Array.isArray(projected?.discovered) ? projected.discovered : [],
    projects: Array.isArray(projected?.projects) ? projected.projects : [],
    current: projected?.current ?? null,
    summary: projected?.summary ?? {},
    // Compatibilidad: el panel viejo sigue leyendo `identity` de esta misma respuesta.
    identity: identityPayload({ root, registry, workspaceItems: items }),
  });
}


/**
 * Ficha de una skill para el detalle del panel: versiones con su evaluación, asignaciones con su versión fijada,
 * mejoras y la línea de tiempo del diario. Todo se lee del documento; no se escribe nada, y «cargas» cuenta
 * eventos `skill.loaded` (ofertas del catálogo), nunca una aplicación demostrada.
 */
export function skillDiff({ root, skillId, from, to, now = new Date().toISOString() } = {}) {
  const loaded = loadState(root);
  if (!canWrite(loaded.integrity)) {
    return unreadableResult(loaded, 'no se puede comparar nada con el centro ilegible');
  }
  const state = loaded.state;
  const skill = state.skills[String(skillId ?? '')];
  if (skill === undefined) return { ok: false, code: 'skill-not-found', message: 'esa skill no existe en el centro' };
  const find = (version) => (Array.isArray(skill.versions) ? skill.versions : []).find((entry) => entry.version === String(version ?? ''));
  const left = find(from);
  const right = find(to);
  if (left === undefined) return { ok: false, code: 'version-not-found', message: `la versión ${from} no existe en esa skill` };
  if (right === undefined) return { ok: false, code: 'version-not-found', message: `la versión ${to} no existe en esa skill` };
  // El mismo LCS que decide si una mejora se puede publicar: comparar en el servidor evita que el panel
  // traiga dos cuerpos enteros sólo para pintar un diff.
  const diff = diffBodies(left.body, right.body);
  return {
    ok: true,
    apiVersion: API_VERSION,
    generatedAt: now,
    skillId: skill.id,
    title: skill.title,
    from: { version: left.version, createdAt: left.createdAt, checksum: left.checksum, score: left.evaluation?.score ?? null, status: left.evaluation?.status ?? 'unknown' },
    to: { version: right.version, createdAt: right.createdAt, checksum: right.checksum, score: right.evaluation?.score ?? null, status: right.evaluation?.status ?? 'unknown' },
    added: diff.added,
    removed: diff.removed,
    preview: diff.preview,
    truncated: diff.truncated === true,
  };
}

export function skillDetail({ root = centerRoot(), skillId = '', now = new Date().toISOString() } = {}) {
  const loaded = loadState(root);
  const state = loaded.state ?? emptyState(now);
  const skill = state.skills?.[skillId] ?? null;
  if (skill === null) return { ok: false, code: 'skill-not-found', message: `no existe la skill «${skillId}»` };

  const scoreOf = (version) => (typeof version?.evaluation?.score === 'number' ? version.evaluation.score : null);
  const versions = (Array.isArray(skill.versions) ? skill.versions : [])
    .map((version) => ({
      version: version.version,
      createdAt: version.createdAt,
      checksum: version.checksum,
      notes: version.notes ?? '',
      status: version.evaluation?.status ?? 'none',
      score: scoreOf(version),
      findings: Array.isArray(version.evaluation?.findings) ? version.evaluation.findings.length : 0,
      blocks: (Array.isArray(version.evaluation?.findings) ? version.evaluation.findings : [])
        .filter((finding) => finding?.severity === 'block').length,
      summary: evaluationSummary(version.evaluation ?? null),
    }))
    .sort((left, right) => compareVersions(right.version, left.version));

  const assignments = Object.values(state.projects ?? {})
    .map((project) => {
      const row = state.assignments?.[project.id]?.[skillId] ?? null;
      if (row === null) return null;
      return {
        projectId: project.id,
        projectName: project.name ?? project.id,
        cwd: project.cwd ?? '',
        enabled: row.enabled === true,
        version: row.version ?? '',
        pinnedAt: row.pinnedAt ?? '',
        by: row.by ?? 'human',
        updatedAt: row.updatedAt ?? '',
      };
    })
    .filter((row) => row !== null)
    .sort((left, right) => String(left.projectName).localeCompare(String(right.projectName)));

  const improvements = Object.values(state.improvements ?? {})
    .filter((entry) => entry.skillId === skillId)
    .map((entry) => ({
      id: entry.id,
      status: entry.status,
      baseVersion: entry.baseVersion,
      version: entry.version ?? null,
      createdAt: entry.createdAt,
      decidedAt: entry.decidedAt ?? null,
      decidedBy: entry.decidedBy ?? null,
    }))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));

  const timeline = (Array.isArray(state.events) ? state.events : [])
    .filter((event) => event?.skillId === skillId)
    .map((event) => ({
      at: event.at,
      type: event.type,
      actor: event.actor ?? 'human',
      projectId: event.projectId ?? '',
      version: event.version ?? '',
      note: event.note ?? '',
    }))
    .sort((left, right) => String(right.at).localeCompare(String(left.at)));

  const scores = versions.map((version) => version.score).filter((score) => score !== null);
  const first = scores.length === 0 ? null : scores[scores.length - 1];
  const currentScore = scoreOf(versions.find((version) => version.version === skill.currentVersion)) ?? (scores[0] ?? null);
  const loads = timeline.filter((event) => event.type === 'skill.loaded').length;

  return {
    ok: true,
    readable: canWrite(loaded.integrity),
    generatedAt: now,
    skill: {
      id: skill.id,
      title: skill.title ?? skill.id,
      description: skill.description ?? '',
      whenToUse: skill.whenToUse ?? '',
      tags: Array.isArray(skill.tags) ? skill.tags : [],
      status: skill.status,
      currentVersion: skill.currentVersion,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      origin: skill.origin ?? null,
      uuid: skill.uuid ?? null,
    },
    versions,
    assignments,
    improvements,
    timeline,
    metrics: {
      versions: versions.length,
      projectsAssigned: assignments.length,
      projectsActive: assignments.filter((row) => row.enabled === true).length,
      loads,
      improvements: { proposed: improvements.filter((row) => row.status === 'proposed').length, approved: improvements.filter((row) => row.status === 'approved').length },
      quality: { first, current: currentScore, delta: first === null || currentScore === null ? null : currentScore - first },
      lastChangeAt: timeline[0]?.at ?? skill.updatedAt ?? '',
    },
  };
}

function viewOfVersion(version) {
  return {
    version: version.version,
    createdAt: version.createdAt,
    checksum: version.checksum,
    notes: version.notes,
    status: version.evaluation?.status ?? 'unknown',
    score: version.evaluation?.score ?? null,
    summary: version.evaluation === undefined ? null : evaluationSummary(version.evaluation),
  };
}

/**
 * La foto que pinta el panel. **No barre el disco por defecto**: `scan: true` camina las skills externas
 * (la biblioteca del usuario y el proyecto) y eso cuesta decenas de milisegundos; la foto se refresca cada
 * pocos segundos, así que el barrido se pide explícitamente al abrir el panel o al pulsar «Buscar fuera».
 * Sólo lee; registra un proyecto únicamente cuando el llamante lo ha pedido
 * explícitamente (`runAction('open')`), porque un proyecto visto no es un proyecto autorizado.
 */
export function buildSnapshot({ root = centerRoot(), cwd = '', now = new Date().toISOString(), scan = false, externalLimit = EXTERNAL_LIMIT, hostCwd = '', dshHome = '', agentsHome = '', materializedRoot = '', analyticsDays = 14, analyticsProject = '', analyticsSkill = '', analyticsFrom = '', analyticsTo = '', analyticsType = '', analyticsVersion = '', analyticsStatus = '' } = {}) {
  const loaded = loadState(root);
  const state = loaded.state ?? emptyState(now);
  const registered = findProject(state, cwd);
  const normalizedCwd = normalizeCwd(cwd);
  const project = registered === null
    ? (normalizedCwd === ''
      ? null
      : { id: projectIdFor(normalizedCwd), name: projectNameFor(normalizedCwd), cwd: normalizedCwd, createdAt: '', updatedAt: '', note: '', registered: false })
    : { ...registered, registered: true };

  const assignments = state.assignments ?? {};
  const skills = Object.values(state.skills ?? {}).map((skill) => {
    const current = currentVersionOf(skill);
    const enabledIn = Object.entries(assignments)
      .filter(([, row]) => row?.[skill.id]?.enabled === true)
      .map(([projectId]) => projectId);
    // Matriz de adopción: una sola lectura para ver en qué proyectos está cada skill y con qué versión
    // fijada. Se publican también las filas apagadas y las que van por detrás de la versión vigente, porque
    // eso es justo lo que una persona necesita ver para decidir sin abrir proyecto por proyecto.
    const adoption = Object.entries(assignments)
      .map(([projectId, row]) => ({ projectId, assignment: row?.[skill.id] }))
      .filter((entry) => entry.assignment !== undefined)
      .map(({ projectId, assignment }) => ({
        projectId,
        enabled: assignment.enabled === true,
        version: typeof assignment.version === 'string' ? assignment.version : null,
        by: assignment.by ?? null,
        updatedAt: assignment.updatedAt ?? null,
      }))
      .sort((left, right) => left.projectId.localeCompare(right.projectId));
    const pending = Object.values(state.improvements ?? {}).filter((entry) => entry.skillId === skill.id && entry.status === 'proposed').length;
    return {
      id: skill.id,
      title: skill.title,
      description: skill.description,
      whenToUse: skill.whenToUse,
      tags: skill.tags ?? [],
      status: skill.status,
      currentVersion: skill.currentVersion,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      origin: skill.origin,
      versions: (skill.versions ?? []).map(viewOfVersion).reverse(),
      current: current === null ? null : {
        body: current.body,
        references: Object.keys(current.references ?? {}),
        evaluation: current.evaluation,
        summary: current.evaluation === undefined ? null : evaluationSummary(current.evaluation),
        notes: current.notes,
      },
      enabledIn,
      adoption,
      pendingImprovements: pending,
    };
  });
  skills.sort((left, right) => (left.updatedAt === right.updatedAt ? left.id.localeCompare(right.id) : right.updatedAt.localeCompare(left.updatedAt)));

  const projects = Object.values(state.projects ?? {}).map((entry) => {
    const row = assignments[entry.id] ?? {};
    const enabled = Object.entries(row).filter(([, value]) => value?.enabled === true).map(([skillId]) => skillId);
    // Una skill encendida puede haberse quedado en una versión anterior: el pin no se mueve solo (decisión de S4),
    // así que el panel necesita verlo para ofrecer la sincronización como una acción consciente.
    const updates = enabled
      .map((skillId) => {
        const skill = state.skills?.[skillId];
        const current = String(skill?.currentVersion ?? '');
        const pinned = String(row[skillId]?.version ?? '');
        if (skill === undefined || current === '' || pinned === '' || pinned === current) return null;
        return { skillId, title: skill.title ?? skillId, from: pinned, to: current };
      })
      .filter((value) => value !== null);
    return {
      ...entry,
      registered: true,
      isCurrent: project !== null && project.id === entry.id,
      enabled,
      activeSkills: enabled.length,
      updates,
      updatesCount: updates.length,
    };
  });
  projects.sort((left, right) => (left.name === right.name ? left.id.localeCompare(right.id) : left.name.localeCompare(right.name)));

  const improvements = Object.values(state.improvements ?? {})
    .map((entry) => {
      const skill = state.skills?.[entry.skillId];
      const base = (skill?.versions ?? []).find((version) => version.version === entry.baseVersion);
      const diff = base === undefined ? null : diffBodies(base.body, entry.body ?? '');
      return {
        ...entry,
        skillTitle: skill?.title ?? entry.skillId,
        summary: entry.evaluation === undefined ? null : evaluationSummary(entry.evaluation),
        diff: diff === null ? null : { added: diff.added, removed: diff.removed, preview: diff.preview.slice(0, 24), truncated: diff.truncated },
      };
    })
    .sort((left, right) => (left.status === right.status ? right.createdAt.localeCompare(left.createdAt) : left.status === 'proposed' ? -1 : 1));

  const events = (state.events ?? []).slice(-80).reverse();
  const analytics = summarize(state, { now, days: analyticsDays, projectId: analyticsProject, skillId: analyticsSkill });
  // Los mismos filtros alimentan la serie sencilla y los indicadores: dos cálculos con parámetros distintos
  // darían dos verdades sobre la misma pantalla.
  const insights = buildInsights(state, {
    now,
    filters: parseFilters({ from: analyticsFrom, to: analyticsTo, type: analyticsType, version: analyticsVersion, status: analyticsStatus, project: analyticsProject, skill: analyticsSkill, days: analyticsDays }, { now, days: analyticsDays }),
  });

  let external = { candidates: [], roots: [], errors: [], truncated: false, total: 0 };
  if (scan) {
    const walked = scanExternalSkills({ cwd: normalizedCwd, dshHome, agentsHome, materializedRoot });
    const libraryIds = new Set(Object.keys(state.skills ?? {}));
    const candidates = walked.candidates.map((candidate) => ({
      ...candidate,
      inLibrary: libraryIds.has(candidate.id),
      assignedHere: project !== null && state.assignments?.[project.id]?.[candidate.id]?.enabled === true,
    }));
    external = { ...walked, candidates: candidates.slice(0, externalLimit), total: candidates.length };
  }

  return {
    ok: true,
    apiVersion: API_VERSION,
    generatedAt: now,
    root,
    storePath: loaded.path,
    storeExists: loaded.exists,
    storeError: loaded.ok ? null : loaded.error,
    // La integridad es un dato de primera clase: el panel decide con esto si puede pintar la biblioteca
    // o si tiene que decir «centro ilegible». `readable` evita que cada vista tenga que recordar los casos.
    readable: canWrite(loaded.integrity),
    integrity: {
      status: loaded.integrity,
      path: loaded.path,
      size: loaded.size,
      sha256: loaded.sha256,
      error: loaded.error,
      archivedAs: null,
    },
    // Versión del documento y estado de la copia: el panel necesita ambos para decidir si ofrece migrar
    // o restaurar. Sin esto, un v1 sano parecía «todo bien» aunque no hubiera ninguna copia detrás.
    schemaVersion: loaded.state.schemaVersion,
    schemaMeta: loaded.state.schemaMeta ?? null,
    // Identidad portable: el panel necesita saber si este documento la admite. La política se decide aquí,
    // no en la interfaz, para que el servidor siga siendo la única autoridad.
    identity: {
      available: identityAvailable(loaded.state),
      requiredSchemaVersion: IDENTITY_SCHEMA_VERSION,
      operations: Object.values(OPERATIONS),
    },
    backup: backupSummary(root, loaded),
    migration: migrationStatus(loaded, root),
    // Recuentos para que el panel pueda decir qué se conserva sin recalcular la biblioteca a su manera.
    counts: {
      skills: skills.length,
      versions: skills.reduce((sum, skill) => sum + (Array.isArray(skill.versions) ? skill.versions.length : 0), 0),
      projects: projects.length,
      assignments: Object.values(assignments).reduce((sum, row) => sum + Object.keys(row ?? {}).length, 0),
      improvements: improvements.length,
      events: events.length,
    },
    cwd: normalizedCwd,
    hostCwd: normalizeCwd(hostCwd),
    project,
    skills,
    projects,
    assignments,
    improvements,
    events,
    analytics,
    insights,
    // El registro de conocimiento tiene su propio fichero: la foto del centro lo enseña, pero nunca lo mezcla.
    knowledge: knowledgeView({ root, now }),
    external,
    requests: requestView(state),
    totals: { skills: skills.length, projects: projects.length, improvements: improvements.length },
  };
}

/** ¿La vista materializada de este proyecto sigue a las asignaciones? Si no, se rehace. */
export function ensureProjectView({ root, state, project, now = new Date().toISOString() }) {
  const assignments = assignedSkills(state, project.id);
  const expected = assignments.map(({ skill, version }) => `${skill.id}@${version.version}`).sort().join(',');
  const manifestPath = `${materializedRoot(root)}/${project.id}/manifest.json`;
  let actual = '';
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    actual = (manifest.skills ?? []).map((entry) => `${entry.id}@${entry.version}`).sort().join(',');
  } catch {
    actual = '';
  }
  if (actual === expected) return { synced: false, directory: `${materializedRoot(root)}/${project.id}`, assignments };
  const result = syncProject({ root, project, assignments, now });
  return { synced: true, directory: result.directory, assignments, result };
}

/**
 * ¿Se puede ofrecer la migración? Una sola respuesta, calculada aquí y no en el panel.
 *
 * El panel no repite estas reglas: si las copiara, la interfaz y el servidor podrían discrepar y la
 * persona vería un botón que el servidor rechaza (o al revés). El servidor **vuelve a comprobarlas**
 * dentro de la acción, porque entre la instantánea y el clic el disco puede cambiar.
 */
export function migrationStatus(loaded, root, { now = Date.now() } = {}) {
  const from = loaded?.state?.schemaVersion ?? null;
  const lock = inspectLock(root, { now });
  const base = { from, to: SCHEMA_VERSION, canMigrate: false, blocker: null, lock };
  if (loaded?.integrity !== INTEGRITY_OK) return { ...base, blocker: 'store-unreadable' };
  if (from !== null && from > SCHEMA_VERSION) return { ...base, blocker: 'future-version' };
  if (from === SCHEMA_VERSION) return { ...base, blocker: 'already-migrated' };
  const copy = backupSummary(root);
  if (copy.status !== 'verified') return { ...base, blocker: 'backup-required' };
  if (copy.sha256 !== loaded.sha256 || copy.size !== loaded.size) return { ...base, blocker: 'backup-stale' };
  if (lock.present && !lock.stale) return { ...base, blocker: 'store-busy' };
  return { ...base, canMigrate: true, blocker: null };
}

/**
 * Estado de la copia para el panel: tres estados y nunca «sin crear» cuando hay algo que no verifica.
 *
 * - `verified`: hay un puntero válido y su generación coincide.
 * - `missing`: no hay puntero ni copia antigua utilizable.
 * - `unverified`: hay un fichero o un puntero, pero no se puede verificar (o es una copia antigua).
 */
function backupSummary(root, loaded = null) {
  const verified = verifyBackup(root);
  if (verified.ok) {
    return {
      status: 'verified',
      exists: true,
      verified: true,
      sha256: verified.sha256,
      size: verified.size,
      createdAt: verified.createdAt,
      generation: verified.generation,
      reason: verified.source,
      legacy: false,
      error: null,
      // Verificable y al día son dos cosas distintas: la copia puede ser íntegra y ser de una versión anterior
      // del documento. Publicar sólo «verificada» hacía creer que respaldaba el estado actual (defecto real).
      fresh: loaded !== null && typeof loaded === 'object' && loaded.sha256 === verified.sha256 && loaded.size === verified.size,
    };
  }
  if (verified.code === 'missing') {
    return { status: 'missing', exists: false, verified: false, sha256: null, size: 0, createdAt: '', generation: '', reason: '', legacy: false, error: null, fresh: false };
  }
  return {
    status: 'unverified',
    exists: true,
    verified: false,
    sha256: verified.sha256 ?? null,
    size: verified.size ?? 0,
    createdAt: verified.createdAt ?? '',
    generation: verified.generation ?? '',
    reason: verified.source ?? '',
    legacy: verified.code === 'legacy-copy',
    error: verified.message ?? verified.code,
    fresh: false,
  };
}

/**
 * Ejecuta una acción del panel o de una herramienta.
 *
 * `actor` es una frontera de seguridad, no una etiqueta: `'ai'` no puede publicar versiones de skills
 * vivas ni aprobar propuestas. La ruta HTTP del panel pasa `'human'`; las herramientas del agente
 * pasan `'ai'`.
 */
const DECISION_OUTCOME = {
  'create-skill': 'create-new-skill',
  'improve-skill': 'improve-existing-skill',
  approve: 'approve',
  publish: 'publish',
  activate: 'activate',
  deactivate: 'deactivate',
  'advance-pin': 'advance-pin',
  rollback: 'rollback',
};

/**
 * Compuerta de una acción de la IA sobre el ciclo de vida de una Skill.
 *
 * Devuelve `{ allowed:true, decisionId, level }` y deja la decisión en el registro de conocimiento, o
 * `{ allowed:false, refusal }` con el código histórico `approval-required` y el detalle de qué compuerta
 * falló. Si el registro no se puede escribir, la acción permitida sigue adelante y se declara
 * `logged:'unavailable'`: negar una acción ya autorizada por un fallo del registro sería peor.
 */
/** Una petición de una persona ligada a esta skill cuenta como petición explícita del usuario. */
function hasExplicitRequest(state, skillId) {
  const requests = state?.requests !== null && typeof state?.requests === 'object' ? state.requests : {};
  return Object.values(requests).some((request) => request !== null
    && typeof request === 'object'
    && String(request.skillId ?? '') === String(skillId)
    && String(request.status ?? '') === 'pending'
    && String(request.requestedBy ?? 'human') === 'human');
}

/**
 * Cierra el asiento con el resultado real. Un rechazo del producto (por ejemplo, que la skill no exista)
 * también se anota como fallido: autorizar y no ejecutar es un hecho distinto de ejecutar.
 */
/**
 * Cwd comparable: Windows entrega la misma carpeta con barras distintas y con o sin barra final.
 */
function sameCwd(left, right) {
  const normalize = (value) => String(value ?? '').replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
  const a = normalize(left);
  const b = normalize(right);
  return a !== '' && b !== '' && a === b;
}

/**
 * Liga la operación de la IA a su propia carpeta. Devuelve la identidad del proyecto cuando la deduce del
 * cwd, o un rechazo cuando el payload apunta a otro proyecto. Una persona no pasa por aquí.
 */
function bindAiProject(state, data, cwd, actor) {
  if (String(actor) !== 'ai') return { ok: true, projectId: String(data?.projectId ?? '') };
  const asked = String(data?.projectId ?? '');
  const projects = Object.values(state?.projects ?? {});
  if (asked !== '') {
    const target = state.projects[asked];
    if (target === undefined) return { ok: false, code: 'unknown-project', message: 'ese proyecto no está en el registro' };
    if (String(cwd ?? '') !== '' && !sameCwd(target.cwd, cwd)) {
      return {
        ok: false,
        code: 'project-mismatch',
        message: 'la IA sólo opera sobre el proyecto de su carpeta: el payload nombra otro',
      };
    }
    return { ok: true, projectId: asked };
  }
  if (String(cwd ?? '') === '') return { ok: true, projectId: '' };
  const own = projects.find((project) => sameCwd(project.cwd, cwd));
  return { ok: true, projectId: own === undefined ? '' : String(own.id) };
}

function settleGate(root, gate, result, now) {
  if (gate === null || typeof gate !== 'object' || String(gate.decisionId ?? '') === '') return;
  const ok = result !== null && typeof result === 'object' && result.ok === true;
  const detail = ok ? 'ok' : String(result?.code ?? 'failed');
  try {
    withKnowledge(root, (document) => settleDecision(document, { decisionId: gate.decisionId, ok, detail }, now), { now });
  } catch {
    // el asiento pendiente no debe convertir una operación correcta en un error
  }
}

function autonomousDecision({ root, state, operation, skillId = '', projectId = '', explicitRequest = false, insightIds = [], version = '', now }) {
  let knowledge = {};
  try {
    knowledge = loadKnowledge(root).document;
  } catch {
    knowledge = {};
  }
  const evaluation = evaluateDecision({
    state,
    knowledge,
    operation,
    skillId,
    projectId,
    insightIds,
    explicitRequest: explicitRequest === true || hasExplicitRequest(state, skillId),
    now,
  });
  if (!evaluation.ok) {
    return {
      allowed: false,
      refusal: {
        ok: false,
        code: 'approval-required',
        message: `la IA no puede hacer esto todavía: ${evaluation.justification}`,
        reason: evaluation.code,
        gates: evaluation.gates,
      },
    };
  }
  const decisionId = `dec-${randomUUID()}`;
  const outcome = DECISION_OUTCOME[operation] ?? operation;
  let logged = 'recorded';
  try {
    const saved = withKnowledge(root, (document) => recordDecision(document, {
      decisionId,
      outcome,
      skillId,
      projectId,
      version,
      scope: projectId === '' ? 'global' : 'project',
      evidenceLevel: evaluation.level,
      insightIds: evaluation.justification.insightIds ?? [],
      gates: evaluation.gates,
      justification: evaluation.justification,
      actor: 'ai',
      at: now,
      rollback: evaluation.rollback,
    }, now), { now });
    if (!saved.ok) logged = 'unavailable';
  } catch {
    logged = 'unavailable';
  }
  return { allowed: true, decisionId, level: evaluation.level, gates: evaluation.gates, logged };
}

/**
 * Duplicados probables de una skill recién creada: adapta la skill al módulo compartido de parecido.
 * Es un aviso para decidir, nunca una decisión por su cuenta.
 */
function duplicatesOf(state, createdId) {
  const created = state.skills?.[createdId];
  if (created === undefined) return [];
  const latest = Array.isArray(created.versions) ? created.versions[created.versions.length - 1] ?? {} : {};
  return similarSkills(state, {
    title: latest.title ?? created.title,
    description: latest.description ?? created.description,
    tags: created.tags,
    excludeId: createdId,
  });
}

/**
 * Lee el paquete que llega por la API: objeto JSON o texto (≤ 512 KiB, comprobado en `readBundle`).
 * No interpreta nada más: el contrato del paquete lo valida `readBundle`.
 */
function bundleTextOf(data) {
  const value = data?.bundle;
  if (typeof value === 'string') return { ok: true, text: value };
  if (value !== null && typeof value === 'object') return { ok: true, text: JSON.stringify(value) };
  return { ok: false, code: 'invalid-bundle', message: 'falta el paquete: usa {bundle:<objeto|texto JSON>}' };
}

/** Nombre comparable de una skill para detectar duplicados de nombre sin fingir una identidad. */
function bundleTitleKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Conflictos observables del paquete contra el almacén propio: mismo id, mismo nombre y paquetes ya
 * importados (por checksum del bundle + skill original). No decide: informa a la persona y al preflight.
 */
function bundleConflictsOf(state, bundle) {
  const skill = bundle?.skill ?? {};
  const baseId = String(skill.id ?? '');
  const checksum = String(bundle?.checksum ?? '');
  const existing = state.skills?.[baseId];
  const titleKey = bundleTitleKey(skill.title ?? skill.description);
  const sameName = [];
  for (const row of Object.values(state.skills ?? {})) {
    if (row === null || typeof row !== 'object' || String(row.id) === baseId) continue;
    if (titleKey !== '' && bundleTitleKey(row.title) === titleKey) sameName.push({ id: String(row.id), title: String(row.title ?? '') });
  }
  const alreadyImported = [];
  const seen = new Set();
  for (const row of Object.values(state.skills ?? {})) {
    if (row === null || typeof row !== 'object') continue;
    if (row.origin?.kind !== 'import') continue;
    if (String(row.origin?.bundleChecksum ?? '') !== checksum) continue;
    if (String(row.origin?.originalSkillId ?? '') !== baseId) continue;
    if (seen.has(String(row.id))) continue;
    seen.add(String(row.id));
    alreadyImported.push({ id: String(row.id), importedAt: String(row.origin?.importedAt ?? ''), checksum });
  }
  // El normalizador del almacén conserva sólo el núcleo de `origin`; el diario es la fuente durable que
  // sobrevive a la recarga, así que la repetición también se detecta por evento auditado.
  for (const event of Array.isArray(state.events) ? state.events : []) {
    if (event?.code !== 'skill-imported') continue;
    if (String(event.checksum ?? '') !== checksum) continue;
    if (String(event.originalSkillId ?? '') !== baseId) continue;
    const id = String(event.skillId ?? '');
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    alreadyImported.push({ id, importedAt: String(event.at ?? ''), checksum });
  }
  sameName.sort((a, b) => a.id.localeCompare(b.id));
  alreadyImported.sort((a, b) => a.id.localeCompare(b.id));
  return {
    sameId: { exists: existing !== undefined, currentVersion: existing === undefined ? null : String(existing.currentVersion ?? '') },
    sameName,
    alreadyImported,
    // Alias aditivos para la UI (§B): el mismo hecho con otro nombre, nunca dos fuentes de verdad.
    idInUse: existing !== undefined,
    nameInUse: sameName.length > 0,
  };
}

/** Candidato de id libre para una copia: `-copia`, `-copia-2`… (misma regla que `importBundle`). */
function bundleTargetIdOf(state, baseId) {
  if (state.skills?.[baseId] === undefined) return baseId;
  for (let attempt = 1; ; attempt += 1) {
    const candidate = attempt === 1 ? `${baseId}-copia` : `${baseId}-copia-${attempt}`;
    if (state.skills?.[candidate] === undefined) return candidate;
  }
}

/**
 * Vista previa del paquete: procedencia, integridad, portabilidad, conflictos, plan y preflight.
 *
 * El preflight es el motor R16 real con el inventario y las colisiones **medidos**: sin esa foto no se
 * puede afirmar «no hay conflictos», así que se declara `evidence-incomplete` en vez de fingir un allow.
 */
function bundlePreviewOf({ root, state, read, data, now, cwd, measuredInventory, measuredCollisions, materialized, hostSources }) {
  const skill = read?.bundle?.skill ?? {};
  const baseId = String(skill.id ?? '');
  const checksum = String(read?.checksum ?? '');
  const origin = read?.origin ?? null;
  const references = Array.isArray(skill.references) ? skill.references : [];
  const privateWarnings = privateReferences(references);
  const secretWarnings = possibleSecretWarnings(read?.bundle ?? {});
  const warnings = [...privateWarnings, ...secretWarnings];
  const portable = privateWarnings.length === 0;
  const conflicts = bundleConflictsOf(state, read?.bundle);

  const unknownRow = (id) => sourceRow(id, SOURCE_UNAVAILABLE, 'no se midió el inventario en esta llamada');
  const rows = new Map();
  const measuredSources = Array.isArray(measuredInventory?.sources) ? measuredInventory.sources : [];
  for (const row of measuredSources) {
    if (row !== null && typeof row === 'object' && typeof row.id === 'string') rows.set(row.id, sourceRow(row.id, row.status ?? SOURCE_UNAVAILABLE, row.reason ?? ''));
  }
  rows.set('state', sourceRow('state', SOURCE_COMPLETE, ''));
  rows.set('manifest', manifestEvidence(root, ''));
  if (!rows.has('skills-registry')) rows.set('skills-registry', unknownRow('skills-registry'));
  const sources = [...rows.values()];

  const inventory = measuredInventory !== null && measuredInventory !== undefined
    ? measuredInventory
    : {
      entries: [],
      sources,
      complete: false,
      generatedAt: now,
      warnings: ['sin-inventario-medido'],
      truncated: false,
      project: { cwd: String(cwd ?? ''), availability: AVAILABILITY_UNKNOWN, exists: false, isDirectory: false },
    };
  const collisions = measuredCollisions ?? { collisions: [], ambiguousNames: [], byKey: new Map() };

  let preflight;
  if (measuredInventory === null || measuredInventory === undefined) {
    const message = 'no hay catálogo ni inventario medidos: no se puede afirmar que el nombre no colisione';
    preflight = {
      decision: 'block',
      findings: [{ code: 'evidence-incomplete', severity: 'block', message, subject: baseId }],
      reasons: [message],
    };
  } else if (typeof preflightModule?.preflight === 'function') {
    preflight = preflightModule.preflight({
      action: 'create-skill',
      root,
      state,
      inventory,
      collisions,
      sources,
      projectId: '',
      skillId: baseId,
      target: { cwd: String(cwd ?? ''), directory: String(materialized ?? materializedRoot(root)) },
      projectAvailability: AVAILABILITY_UNKNOWN,
      integrity: undefined,
      now,
    });
  } else {
    const message = 'el motor de preflight no está disponible: no se puede verificar el nombre';
    preflight = {
      decision: 'block',
      findings: [{ code: 'evidence-incomplete', severity: 'block', message, subject: baseId }],
      reasons: [message],
    };
  }

  const already = conflicts.alreadyImported.length > 0;
  const action = already || preflight.decision === 'block' ? 'blocked' : conflicts.sameId.exists ? 'copy' : 'create';
  const from = data?.from === undefined || data?.from === null || data?.from === '' ? null : String(data.from);
  return {
    name: String(skill.name ?? skill.title ?? baseId),
    description: String(skill.description ?? ''),
    version: String(skill.version ?? ''),
    tags: Array.isArray(skill.tags) ? skill.tags.map(String) : [],
    origin: origin === null ? null : { ...origin, from },
    identity: {
      skillId: baseId,
      checksum,
      bytes: Buffer.byteLength(JSON.stringify(read?.bundle ?? {}), 'utf8'),
    },
    compatibility: {
      schema: BUNDLE_SCHEMA,
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      supported: true,
      minSupported: BUNDLE_SCHEMA_VERSION,
      maxSupported: BUNDLE_SCHEMA_VERSION,
      compatible: true,
    },
    integrity: { checksum: 'ok', checksumRecalculated: checksum, checksumMatches: true },
    portability: { portable, warnings },
    conflicts,
    plan: { action, targetIdCandidate: bundleTargetIdOf(state, baseId) },
    preflight: {
      decision: preflight.decision,
      findings: Array.isArray(preflight.findings) ? preflight.findings : [],
      reasons: Array.isArray(preflight.reasons) ? preflight.reasons : [],
    },
  };
}

export function runAction({
  root = centerRoot(),
  action,
  payload = {},
  actor = 'human',
  cwd = '',
  now = new Date().toISOString(),
  hostCwd = '',
  registry,
  skills = null,
  loader = null,
  sessions = null,
  dshHome = '',
  agentsHome = '',
  materializedRoot: materialized = '',
  hostSources = null,
  inventory = null,
  collisions = null,
  actorEvidence = null,
} = {}) {
  const name = String(action ?? '');
  const data = payload !== null && typeof payload === 'object' ? payload : {};
  // R17: de la actividad sólo se persisten `channel` y `operationId` (contrato §1/R2). Todo lo demás
  // se deriva al leer; el feed nunca inventa atribución que el evento no demuestre.
  const rawChannel = isPlainObject(actorEvidence) && typeof actorEvidence.channel === 'string' && actorEvidence.channel.trim() !== ''
    ? actorEvidence.channel.trim()
    : actor === 'ai'
      ? 'tool'
      : actor === 'system'
        ? 'system'
        : 'panel';
  // El canal del adaptador (`browser`, `api`) se publica como el canal de actividad del contrato.
  const eventChannel = rawChannel === 'browser' || rawChannel === 'ui' ? 'panel' : rawChannel;
  const eventOperationId = typeof data.operationId === 'string' ? data.operationId.trim() : '';
  const eventDefaults = {
    channel: eventChannel,
    ...(eventOperationId === '' ? {} : { operationId: eventOperationId }),
  };

  if (name === 'inspect-project') {
    // Sólo lee: la ficha completa de un proyecto, con la misma proyección pura que usa GET /projects.
    // Sin `withState`: inspeccionar no escribe el almacén ni el materializado.
    const loaded = loadState(root);
    if (!canWrite(loaded.integrity)) {
      return unreadableResult(loaded, 'el almacén del centro no se puede leer: no se inspecciona sobre datos dudosos');
    }
    const state = loaded.state ?? emptyState(now);
    const requested = String(data.projectId ?? '');
    const candidate = requested === ''
      ? findProject(state, cwd)
      : (state.projects?.[requested]
        ?? Object.values(state.projects ?? {}).find((project) => project?.uuid === requested)
        ?? null);
    if (candidate === null || candidate === undefined || typeof candidate.id !== 'string') {
      return {
        ok: false,
        code: 'project-not-found',
        apiVersion: API_VERSION,
        message: 'ese proyecto no está registrado en el centro',
        projectId: requested !== '' ? requested : null,
      };
    }

    // El Host no se consulta con `await` aquí (runAction es síncrono): el registro da identidad y
    // títulos, y la existencia real de la carpeta la mide el adaptador de FS.
    const workspaceItems = [];
    if (typeof registry?.list === 'function') {
      try {
        const listed = registry.list();
        if (Array.isArray(listed)) workspaceItems.push(...listed);
      } catch {
        /* sin registro se inspecciona igual: el workspace queda en null, no inventado */
      }
    }
    const workspaces = workspaceItems.map((item) => workspaceOf(item, AVAILABILITY_UNKNOWN));
    const manifests = {};
    const observation = manifestObservation(readManifest(projectManifestPath(root, candidate.id)), candidate.id);
    manifests[candidate.id] = observation;
    const canonical = normalizeCwd(candidate.cwd);
    if (canonical !== '') manifests[canonical] = observation;
    const inspections = {};
    try {
      const inspected = inspectProject({ root, projectId: candidate.id });
      const manifestStatus = observation.status;
      const incomplete = manifestStatus === 'unreadable' || manifestStatus === 'future';
      inspections[candidate.id] = {
        ...inspected,
        status: incomplete ? 'incomplete' : 'complete',
        inspectedAt: now,
        reason: incomplete ? `manifest-${manifestStatus}` : '',
      };
    } catch (error) {
      inspections[candidate.id] = { status: 'failed', inspectedAt: now, reason: String(error?.message ?? error) };
    }
    const projectPath = String(candidate.cwd ?? '').trim();
    const availability = [{
      projectId: candidate.id,
      cwd: projectPath,
      availability: projectPath === '' ? AVAILABILITY_UNKNOWN : projectAvailabilityOf(projectPath).status,
    }];
    const collisionList = Array.isArray(collisions)
      ? collisions
      : (Array.isArray(collisions?.collisions) ? collisions.collisions : []);
    const detail = projectsModule.buildProjectDetail({
      projectId: candidate.id,
      workspaces,
      state,
      inventory,
      sources: Array.isArray(inventory?.sources) ? inventory.sources : [],
      now,
      manifests,
      inspections,
      sessions,
      collisions: collisionList,
      availability,
    });
    return {
      ok: true,
      apiVersion: API_VERSION,
      generatedAt: now,
      action: 'inspect-project',
      projectId: candidate.id,
      project: detail,
    };
  }

  if (name === 'open-workspace') {
    // Abrir un workspace es una capacidad del panel (`uiWorkspace.openWorkspace`): ni el Host ni este
    // despacho pueden hacerlo. Se contesta el código cerrado en vez de simular que se abrió.
    const requested = String(data.workspaceId ?? '');
    let workspaceId = requested;
    if (workspaceId === '' && typeof registry?.list === 'function') {
      try {
        const items = registry.list();
        const target = normalizeCwd(cwd).toLowerCase();
        const found = target === '' ? undefined : items.find((item) => normalizeCwd(item?.path).toLowerCase() === target);
        if (found !== undefined) workspaceId = String(found.id ?? '');
      } catch {
        /* sin registro no se puede resolver el id: se devuelve null, no un id inventado */
      }
    }
    return {
      ok: false,
      code: 'host-action-unsupported',
      apiVersion: API_VERSION,
      message: 'abrir un workspace sólo lo hace el panel del Host; la API no puede activarlo',
      clientAction: 'uiWorkspace.openWorkspace',
      workspaceId: workspaceId !== '' ? workspaceId : null,
    };
  }

  // La foto que se refresca cada pocos segundos no barre el disco: el barrido externo se pide con
  // `scan: true` al abrir el panel o al pulsar «Buscar fuera». Con una biblioteca de 200 skills y 4 000
  // eventos, medido en esta máquina: 33 ms sin barrido frente a 101 ms con él (ver _audit/RENDIMIENTO.md).
  if (name === 'plan') {
    // Sólo lee: elige qué operación encaja y lo explica. No crea, no publica y no escribe el almacén.
    const loaded = loadState(root);
    if (!canWrite(loaded.integrity)) return unreadableResult(loaded);
    const choice = chooseOperation({
      state: loaded.state,
      title: String(data.title ?? data.summary ?? ''),
      description: String(data.description ?? ''),
      tags: Array.isArray(data.tags) ? data.tags : [],
      explicitRequest: false,
    });
    return { ok: choice.ok === true, apiVersion: API_VERSION, ...choice, generatedAt: now ?? new Date().toISOString() };
  }

  if (name === 'state') return buildSnapshot({ root, cwd, now, hostCwd, scan: data.scan === true, dshHome, agentsHome, materializedRoot: materialized });

  if (name === 'open') {
    // Abrir el panel no debe escribir si el proyecto ya está en el registro: un guardado por cada
    // apertura cambia `updatedAt`, despierta al vigilante y hace creer que hubo un cambio. Sólo la
    // primera vez que se ve un proyecto se anota.
    const current = loadState(root);
    if (!canWrite(current.integrity)) {
      const blocked = buildSnapshot({ root, cwd, now, hostCwd });
      return { ...blocked, opened: true };
    }
    const known = normalizeCwd(cwd) === '' ? null : findProject(current.state, cwd);
    if (normalizeCwd(cwd) !== '' && known === null) {
      const opened = withState(root, (state) => {
        const project = ensureProject(state, cwd, { now });
        return project === null ? { ok: false, code: 'bad-cwd', message: 'la ruta no da un proyecto' } : { ok: true, project };
      }, { now });
      if (!opened.ok) return { ok: false, code: 'store', message: 'no se pudo abrir el almacén', storeError: opened.storeError };
      if (opened.result?.ok === false) return opened.result;
    }
    const snapshot = buildSnapshot({ root, cwd, now, hostCwd });
    return { ...snapshot, opened: true };
  }

  if (name === 'restore') {
    if (actor !== 'human') {
      return { ok: false, code: 'approval-required', message: 'restaurar el almacén lo hace una persona desde el panel' };
    }
    // Dos orígenes posibles: un archivo elegido a mano (con su hash) o la copia verificada más reciente.
    const restored = data.source === 'backup'
      ? restoreFromBackup(root, { now })
      : restoreStore(root, { sourcePath: data.path, expectedSha256: data.sha256, now });
    if (!restored.ok) return restored;
    return { ...restored, snapshot: buildSnapshot({ root, cwd, now, hostCwd }) };
  }

  if (name === 'backup') {
    if (actor !== 'human') {
      return { ok: false, code: 'approval-required', message: 'la copia de seguridad la pide una persona desde el panel' };
    }
    const created = ensureBackup(root, { now, reason: 'manual' });
    if (!created.ok) return created;
    return { ...created, snapshot: buildSnapshot({ root, cwd, now, hostCwd }) };
  }

  if (name === 'insight') {
    // Un hallazgo de un subagente es un dato, no una decisión: entra en la bandeja y no toca el centro
    // ni activa nada. Un subagente no puede aprobar su propio hallazgo; sólo una persona o el motor
    // de decisiones con evidencia pueden usarlo.
    const received = withKnowledge(root, (document) => receiveInsight(document, {
      insightId: String(data.insightId ?? ''),
      sourceAgent: String(data.sourceAgent ?? actor),
      sessionId: String(data.sessionId ?? ''),
      parentRunId: String(data.parentRunId ?? ''),
      // El origen entra como **declarado**: verificarlo es trabajo del Host (ruta origin-verify de index.js),
      // no de quien lo declara. Guardarlo como verificado porque venga en el JSON sería aceptar una firma ajena.
      origin: {
        declared: {
          sourceAgent: String(data.sourceAgent ?? actor),
          parentRunId: String(data.parentRunId ?? ''),
          sessionId: String(data.sessionId ?? ''),
        },
        verified: false,
      },
      taskId: String(data.taskId ?? ''),
      projectId: String(data.projectId ?? ''),
      scope: String(data.scope ?? ''),
      category: String(data.category ?? ''),
      title: String(data.title ?? ''),
      summary: String(data.summary ?? ''),
      details: String(data.details ?? ''),
      evidence: Array.isArray(data.evidence) ? data.evidence : [],
      confidence: String(data.confidence ?? ''),
      risks: String(data.risks ?? ''),
      suggestedAction: String(data.suggestedAction ?? ''),
    }, now), { now });
    if (received.ok !== true) return { ok: false, code: received.code ?? 'knowledge', message: 'no se pudo registrar el hallazgo' };
    if (received.result?.ok !== true) return received.result;
    // T42: la tool de mutación devuelve su proyección de actividad. El hallazgo vive en knowledge.json,
    // no en center.json; el evento recién escrito es la única fuente de su identidad.
    const knowledgeEvents = Array.isArray(received.document?.events) ? received.document.events : [];
    const latestEvent = received.saved === true && received.result.duplicate !== true && knowledgeEvents.length > 0
      ? knowledgeEvents[knowledgeEvents.length - 1]
      : null;
    const activityEntry = latestEvent === null
      ? null
      : normalizeEvent({ ...latestEvent, persisted: true }, { source: 'knowledge.json', eventId: knowledgeEventId(latestEvent) });
    return {
      ok: true,
      insight: received.result.insight,
      duplicate: received.result.duplicate === true,
      summary: knowledgeSummary(received.document ?? received.result.document),
      activity: activityProjectionOf(activityEntry, false),
      replayed: false,
    };
  }

  if (name === 'triage-insight') {
    // El agente principal mueve el hallazgo por su ciclo de vida. `acted-on` no se acepta aquí por
    // conveniencia: `triageInsight` exige `decisionId` y una acción con `ok:true`, así que este camino no
    // puede declarar terminado lo que sólo se leyó o se enlazó.
    const written = withKnowledge(root, (document) => triageInsight(document, {
      insightId: String(data.insightId ?? ''),
      state: String(data.state ?? ''),
      note: String(data.note ?? ''),
      decisionId: String(data.decisionId ?? ''),
      appliedSkillId: String(data.appliedSkillId ?? ''),
      action: data.action ?? null,
    }, now), { now });
    if (written.ok !== true) return { ok: false, code: 'store-unreadable', message: written.message ?? 'no se pudo escribir el conocimiento' };
    const result = written.result ?? {};
    if (result.ok !== true) return { ...result, saved: false };
    return { ok: true, apiVersion: API_VERSION, insight: result.insight, saved: written.saved === true };
  }

  if (name === 'policy') {
    // La política de autonomía la fija una persona, por proyecto o global. El ADDENDUM permite que la IA
    // decida dentro de la política, no que se conceda autonomía: por eso el actor se comprueba aquí y en
    // setPolicy (doble puerta), y el modo desconocido se rechaza con su código en vez de caer al defecto.
    if (actor !== 'human') {
      return { ok: false, code: 'approval-required', message: 'la política de autonomía la fija una persona desde el panel' };
    }
    const wanted = String(data.mode ?? '');
    if (!POLICY_MODES.includes(wanted)) {
      return { ok: false, code: 'policy-mode-unknown', message: `modo desconocido: ${wanted || '(vacío)'}` };
    }
    const changed = withKnowledge(root, (document) => setPolicy(document, {
      projectId: String(data.projectId ?? ''),
      mode: wanted,
      actor: 'human',
      by: 'human',
    }, now), { now });
    if (changed.ok !== true) return { ok: false, code: changed.code ?? 'knowledge', message: 'no se pudo guardar la política' };
    if (changed.result?.ok !== true) return changed.result;
    return {
      ok: true,
      policy: changed.result,
      summary: knowledgeSummary(changed.document),
      saved: changed.saved === true,
    };
  }

  if (name === 'inspect-bundle') {
    // Inspección: sólo lectura. Ni el almacén ni exports/ cambian; la persona decide después con la vista
    // previa delante (procedencia, integridad, portabilidad, conflictos, plan y preflight medido).
    if (actor !== 'human') {
      return { ok: false, code: 'approval-required', message: 'inspeccionar un paquete lo pide una persona' };
    }
    const input = bundleTextOf(data);
    if (input.ok !== true) return { ...input, apiVersion: API_VERSION };
    const read = readBundle(input.text);
    if (read.ok !== true) return { ...read, apiVersion: API_VERSION };
    const invalidReferences = invalidBundleReferences(read.bundle?.skill?.references);
    if (invalidReferences.length > 0) {
      return {
        ok: false,
        code: 'invalid-references',
        apiVersion: API_VERSION,
        message: 'el paquete trae referencias que salen de la carpeta de la skill (o con forma insegura)',
        references: invalidReferences,
      };
    }
    const current = loadState(root);
    if (!canWrite(current.integrity)) {
      return unreadableResult(current, 'no inspecciono contra un almacén que no se puede leer: el documento se conserva intacto');
    }
    const state = current.state ?? emptyState(now);
    const preview = bundlePreviewOf({
      root,
      state,
      read,
      data,
      now,
      cwd,
      measuredInventory: inventory,
      measuredCollisions: collisions,
      materialized: materialized || materializedRoot(root),
      hostSources,
    });
    return {
      ok: true,
      apiVersion: API_VERSION,
      contractVersion: API_CONTRACT_VERSION,
      inspected: true,
      preview,
      checksum: read.checksum,
      checksumMatches: true,
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      schemaCompatible: true,
    };
  }

  if (name === 'export-skill') {
    // Distribución: se escribe un paquete portable en exports/, no se toca el almacén ni ninguna asignación.
    // Una persona decide qué sale del centro; la IA no distribuye sola.
    if (actor !== 'human') {
      return { ok: false, code: 'approval-required', message: 'exportar una skill lo pide una persona' };
    }
    const current = loadState(root);
    if (!canWrite(current.integrity)) {
      return unreadableResult(current, 'no exporto una skill de un almacén que no se puede leer: el documento se conserva intacto');
    }
    const written = writeBundle({
      root,
      state: current.state,
      skillId: String(data.skillId ?? data.id ?? ''),
      version: String(data.version ?? ''),
      now,
      note: String(data.note ?? ''),
    });
    if (written.ok !== true) return written;
    return { ...written, apiVersion: API_VERSION, exported: true };
  }

  if (name === 'import-bundle') {
    // Importación: la persona confirma, el paquete pasa por el motor de preflight con evidencia real y sólo
    // entonces se crea una copia aislada. Nunca se sobrescribe ni se renombra sin pedirlo explícitamente.
    if (actor !== 'human') {
      return { ok: false, code: 'approval-required', message: 'importar un paquete lo pide una persona' };
    }
    if (data.confirmed !== true) {
      return {
        ok: false,
        code: 'confirmation-required',
        apiVersion: API_VERSION,
        message: 'importar un paquete exige confirmación humana explícita: envía confirmed:true después de revisar la vista previa',
      };
    }
    const input = bundleTextOf(data);
    if (input.ok !== true) return { ...input, apiVersion: API_VERSION };
    const read = readBundle(input.text);
    if (read.ok !== true) return { ...read, apiVersion: API_VERSION };
    const invalidReferences = invalidBundleReferences(read.bundle?.skill?.references);
    if (invalidReferences.length > 0) {
      return {
        ok: false,
        code: 'invalid-references',
        apiVersion: API_VERSION,
        message: 'el paquete trae referencias que salen de la carpeta de la skill (o con forma insegura)',
        references: invalidReferences,
      };
    }
    const current = loadState(root);
    if (!canWrite(current.integrity)) {
      return unreadableResult(current, 'no importo sobre un almacén que no se puede leer: el documento se conserva intacto');
    }
    const state = current.state ?? emptyState(now);
    const baseId = String(read.bundle?.skill?.id ?? '');
    const preview = bundlePreviewOf({
      root,
      state,
      read,
      data,
      now,
      cwd,
      measuredInventory: inventory,
      measuredCollisions: collisions,
      materialized: materialized || materializedRoot(root),
      hostSources,
    });
    const onConflict = data.onConflict === 'copy' ? 'copy' : 'abort';
    if (preview.conflicts.alreadyImported.length > 0) {
      return {
        ok: true,
        imported: false,
        code: 'already-imported',
        apiVersion: API_VERSION,
        message: 'este mismo paquete ya está importado: no se escribe nada',
        preview,
        checksum: read.checksum,
        saved: false,
      };
    }
    if (preview.conflicts.sameId.exists && onConflict !== 'copy') {
      return {
        ok: true,
        imported: false,
        code: 'conflict',
        apiVersion: API_VERSION,
        message: `ya existe una skill con el id "${baseId}": no se sobrescribe; para conservar ambas, envía onConflict:"copy"`,
        preview,
        checksum: read.checksum,
        saved: false,
      };
    }

    let gateFindings = [];
    const gate = actionPreflight({
      root,
      action: 'import-bundle',
      data: { ...data, skillId: baseId },
      cwd,
      now,
      hostSources,
      registry,
      materialized: materialized || materializedRoot(root),
      sessions,
      inventory,
      collisions,
    });
    if (gate?.storeUnreadable) {
      return unreadableResult(gate.storeUnreadable, 'no importo sin poder leer el almacén: se conserva intacto');
    }
    if (gate?.decision === 'block') {
      return {
        ok: false,
        code: 'preflight-blocked',
        apiVersion: API_VERSION,
        message: `el preflight bloquea «import-bundle»: ${(gate.reasons ?? []).join('; ') || 'evidencia incompleta'}`,
        findings: gate.findings ?? [],
        reasons: gate.reasons ?? [],
        evidence: gate.evidence ?? null,
      };
    }
    if (gate?.decision === 'warn' && Array.isArray(gate.findings)) gateFindings = gate.findings;

    const imported = withState(root, (document) => importBundle(document, read.bundle, {
      now,
      note: String(data.note ?? ''),
      from: typeof data.from === 'string' ? data.from : null,
      createSkill,
      onConflict,
    }), { now });
    if (imported.ok !== true) {
      return { ok: false, code: imported.storeError ? 'store-unreadable' : 'store', message: 'no se pudo importar el paquete' };
    }
    if (imported.result?.ok !== true) {
      const code = String(imported.result?.code ?? '');
      if (code === 'conflict' || code === 'already-imported') {
        return { ok: true, imported: false, code, apiVersion: API_VERSION, preview, checksum: read.checksum, saved: false };
      }
      return imported.result;
    }
    const appended = Array.isArray(imported.appended) ? imported.appended : [];
    const activity = imported.saved === true && appended.length > 0
      ? activityForResult(imported.state, appended.at(-1).id)
      : null;
    return {
      ok: true,
      apiVersion: API_VERSION,
      imported: true,
      ...imported.result,
      preview,
      checksum: read.checksum,
      saved: imported.saved === true,
      activity,
      replayed: false,
      ...(gateFindings.length > 0 ? { findings: gateFindings } : {}),
    };
  }

  if (name === 'export') {
    // El informe es un derivado: se escribe en reports/, no en el almacén. La IA no lo dispara sola
    // porque una exportación deja un fichero en disco y eso lo decide una persona.
    if (actor !== 'human') {
      return { ok: false, code: 'approval-required', message: 'exportar el informe lo pide una persona desde el panel' };
    }
    const current = loadState(root);
    if (!canWrite(current.integrity)) {
      return unreadableResult(current, 'no exporto el informe de un almacén que no se puede leer: el documento se conserva intacto');
    }
    const written = writeCenterReport({
      root,
      state: current.state,
      now,
      diagnostics: { integrity: current.integrity, sha256: current.sha256, size: current.size },
    });
    if (written.ok !== true) return written;
    return {
      ...written,
      apiVersion: API_VERSION,
      exported: true,
      integrity: { status: current.integrity, sha256: current.sha256, size: current.size },
    };
  }

  if (name === 'migrate') {
    if (actor !== 'human') {
      return { ok: false, code: 'approval-required', message: 'migrar el esquema lo decide una persona: la IA no cambia el documento' };
    }
    // Precondiciones del servidor, en el orden en que importan. No se confía en la instantánea que vio el
    // panel: entre aquella lectura y este clic el documento, el candado o la copia pueden haber cambiado.
    const current = loadState(root);
    // `migrationStatus` no recibe el reloj lógico: el candado se juzga con el reloj real (inspectLock).
  const status = migrationStatus(current, root);
    if (!status.canMigrate) {
      const messages = {
        'store-unreadable': 'el almacén no se puede leer: no se migra un documento dañado, se conserva y se restaura desde la copia',
        'future-version': 'el documento es más nuevo que este código: no se degrada una versión futura',
        'already-migrated': 'el almacén ya está en la versión de esquema de este código',
        'backup-required': 'no hay una copia autoritativa verificable: sin punto de vuelta no se toca el documento',
        'backup-stale': 'la copia autoritativa no coincide con los bytes actuales: se niega a migrar sobre una copia vieja',
        'store-busy': 'hay otro escritor con el candado tomado: no se migra mientras alguien escribe',
      };
      return {
        ok: false,
        code: status.blocker,
        message: messages[status.blocker] ?? 'no se cumplen las precondiciones de la migración',
        migration: status,
        integrity: { status: current.integrity, sha256: current.sha256, size: current.size },
      };
    }
    const before = current.state;
    const migrated = migrateStore(root, { now });
    if (!migrated.ok) return migrated;
    // La migración ya ocurrió cuando se compara: si algo no cuadra se dice la verdad (`migrated: true`)
    // en vez de fingir que no pasó nada, y se deja la copia para volver.
    const after = loadState(root);
    const comparison = after.integrity === INTEGRITY_OK
      ? compareDocuments(before, after.state)
      : { ok: false, problems: [`el documento migrado no se relee: ${after.integrity}`] };
    if (!comparison.ok) {
      return {
        ok: false,
        code: 'migration-unverified',
        migrated: true,
        message: 'la migración se aplicó pero la comprobación de entidades encontró diferencias: revisa el almacén y, si algo falta, restaura la copia',
        problems: comparison.problems,
        backup: migrated.backup,
        integrity: { status: after.integrity, sha256: after.sha256, size: after.size },
        snapshot: buildSnapshot({ root, cwd, now, hostCwd }),
      };
    }
    return {
      ...migrated,
      comparison: { ok: true, problems: [] },
      integrity: { status: after.integrity, sha256: after.sha256, size: after.size },
      snapshot: buildSnapshot({ root, cwd, now, hostCwd }),
    };
  }

  if (name === 'detect') {
    const loaded = loadState(root);
    if (!canWrite(loaded.integrity)) {
      return unreadableResult(loaded, 'no puedo buscar en una biblioteca que no se puede leer: el almacén está dañado y se conserva intacto');
    }
    const queryText = String(data.text ?? '');
    const queryId = String(data.id ?? '');
    const query = { text: queryText, id: queryId, words: candidateWords({ description: queryText, id: queryId, tags: data.tags }) };
    const library = Object.values(loaded.state.skills ?? {}).map((skill) => ({
      id: skill.id,
      description: skill.description,
      whenToUse: skill.whenToUse,
      tags: skill.tags,
      version: skill.currentVersion,
      kind: 'library',
    }));
    const walked = scanExternalSkills({ cwd: normalizeCwd(cwd), dshHome, agentsHome, materializedRoot: materialized });
    const external = walked.candidates.map((candidate) => ({ ...candidate, kind: 'external' }));
    const libraryMatches = rank(query, library, { threshold: 0.16, limit: 8 }).map((match) => ({ ...match, inLibrary: true }));
    const externalMatches = rank(query, external, { threshold: 0.22, limit: 8 }).map((match) => ({ ...match, inLibrary: false }));
    const libraryIds = new Set(libraryMatches.map((match) => match.id));
    return {
      ok: true,
      matches: [...libraryMatches, ...externalMatches.filter((match) => !libraryIds.has(match.id))],
      libraryTotal: library.length,
      externalTotal: external.length,
      roots: walked.roots,
    };
  }

  if (name === 'sync') {
    const loaded = loadState(root);
    if (!canWrite(loaded.integrity)) {
      return unreadableResult(loaded, 'no se puede sincronizar el disco mientras el centro no se pueda leer');
    }
    const targets = typeof data.projectId === 'string' && data.projectId !== ''
      ? [loaded.state.projects[data.projectId]].filter(Boolean)
      : Object.values(loaded.state.projects ?? {});
    if (targets.length === 0) return { ok: false, code: 'unknown-project', message: 'no hay ningún proyecto que sincronizar' };
    const results = [];
    for (const project of targets) {
      const assignments = assignedSkills(loaded.state, project.id);
      results.push({ projectId: project.id, ...syncProject({ root, project, assignments, now }) });
    }
    return { ok: true, results };
  }

  // Operaciones de identidad (link/adopt/unlink/relink/move/fork/repair/reconcile): la puerta se evalúa
  // antes de tocar el documento y en este orden — política, autorización, implementación.
  if (IDENTITY_ACTION_OPERATIONS.has(name)) {
    const operation = IDENTITY_ACTION_OPERATIONS.get(name);
    const loaded = loadState(root);
    const scope = identityInventory({ state: loaded.state, registry });
    const gate = identityActionGate({
      operation,
      schemaVersion: loaded.state.schemaVersion,
      requiredSchemaVersion: IDENTITY_SCHEMA_VERSION,
      inventory: scope.inventory,
      uniqueness: scope.uniqueness,
      states: [],
      backupVerified: verifyBackup(root).ok === true,
    });
    if (gate.ok !== true) {
      return {
        ...gate,
        action: name,
        identity: { available: identityAvailable(loaded.state), requiredSchemaVersion: IDENTITY_SCHEMA_VERSION },
      };
    }
    if (actor !== 'human') {
      return { ok: false, code: 'approval-required', message: 'una operación de identidad la confirma una persona desde el panel' };
    }
    // S6-C: reparar el manifiesto de un proyecto es la primera operación de identidad implementada.
    // Escribe en el workspace del proyecto (con autorización humana ya comprobada) y deja comprobante y
    // evento en el centro dentro de la misma transacción.
    if (operation === OPERATIONS.repair) {
      const projectId = String(data.projectId ?? '').trim();
      const targetCwd = normalizeCwd(String(data.cwd ?? '') !== '' ? String(data.cwd) : String(cwd ?? ''));
      const branch = data.branch === 'missing' ? 'missing' : 'invalid';
      if (!isUuidV4(projectId)) {
        return { ok: false, code: 'invalid-project-id', message: 'hace falta un UUID v4 canónico del proyecto' };
      }
      if (targetCwd === '') {
        return { ok: false, code: 'missing-cwd', message: 'no se conoce la carpeta del proyecto que hay que reparar' };
      }
      const requested = String(data.registeredAt ?? '');
      const registeredAt = isCanonicalUtc(requested) ? requested : now;
      const dshRoot = join(targetCwd, '.dsh');
      mkdirSync(dshRoot, { recursive: true });
      const manifestPath = join(dshRoot, 'lifecode-skill-center.json');
      const repaired = repairManifest({ dshRoot, manifestPath, manifest: newManifest({ projectId, registeredAt }), branch, now });
      if (repaired.ok !== true) return { ...repaired, action: name };
      const mutation = withState(root, (state) => {
        recordOperation(state, repaired.operationId, {
          kind: 'repair-manifest',
          uuid: projectId,
          targetSha256: repaired.manifestSha256,
          registeredAt: now,
        });
        appendEvent(state, {
          type: 'project.manifest-anchored',
          projectId,
          actor,
          note: `${branch}${repaired.resumed === true ? ' (reanudada)' : ''}`,
        });
        return { ok: true };
      }, { now });
      if (mutation.ok !== true) return { ...mutation, action: name };
      return {
        ok: true,
        action: name,
        branch,
        resumed: repaired.resumed === true,
        operationId: repaired.operationId,
        manifestSha256: repaired.manifestSha256,
        quarantineFile: repaired.quarantineFile ?? null,
        manifestPath,
        snapshot: buildSnapshot({ root, cwd: targetCwd, now, scan: false }),
      };
    }
    // S6-C: adoptar deja el manifiesto de una identidad registrada en su carpeta. No crea ni elige
    // identidad: si el registro no tiene UUID todavía, se le asigna uno en el mismo acto y se dice.
    if (operation === OPERATIONS.adopt || operation === OPERATIONS.link) {
      const projectId = String(data.projectId ?? '').trim();
      const targetCwd = normalizeCwd(String(data.cwd ?? '') !== '' ? String(data.cwd) : String(cwd ?? ''));
      if (projectId === '') {
        return { ok: false, code: 'invalid-project-id', message: 'hace falta la identidad registrada del proyecto' };
      }
      if (targetCwd === '') {
        return { ok: false, code: 'missing-cwd', message: 'no se conoce la carpeta del proyecto' };
      }
      const currentState = loadState(root).state;
      const record = currentState.projects === undefined ? undefined : currentState.projects[projectId];
      if (record === undefined) {
        return { ok: false, code: 'unknown-project', message: 'ese proyecto no está registrado en el centro' };
      }
      if (normalizeCwd(String(record.cwd ?? '')) !== targetCwd) {
        return { ok: false, code: 'path-mismatch', message: 'la carpeta indicada no es la del proyecto registrado' };
      }
      const assignedUuid = isUuidV4(record.uuid) === true ? record.uuid : randomUUID();
      const dshRoot = join(targetCwd, '.dsh');
      mkdirSync(dshRoot, { recursive: true });
      const manifestPath = join(dshRoot, 'lifecode-skill-center.json');
      const existing = readManifest(manifestPath);
      if (existing.status === 'ok' && existing.manifest.projectId !== assignedUuid) {
        return { ok: false, code: 'path-conflict', message: 'esa carpeta ya tiene el manifiesto de otra identidad' };
      }
      if (existing.status === 'invalid') {
        // Un manifiesto dañado no se pisa en silencio: se repara por su rama explícita.
        return { ok: false, code: 'manifest-invalid', message: 'el manifiesto de la carpeta está dañado: repáralo antes de adoptar' };
      }
      const registeredAt = isCanonicalUtc(String(record.manifestRegisteredAt ?? '')) ? record.manifestRegisteredAt : now;
      const bytes = manifestBytes(newManifest({ projectId: assignedUuid, registeredAt }));
      const manifestSha256 = sha256Hex(bytes);
      let resumed = existing.status === 'ok' && existing.sha256 === manifestSha256;
      let operationId = existing.status === 'ok' ? sha256Hex(Buffer.from(`adopt:${manifestSha256}:${dshRoot}`, 'utf8')).slice(0, 16) : null;
      if (resumed !== true) {
        const published = publishExclusive({ path: manifestPath, bytes, dshRoot, operationId: operationId ?? undefined });
        if (published.ok !== true && published.code !== 'exists') return { ...published, action: name };
        resumed = published.ok !== true;
        operationId = published.operationId ?? operationId ?? sha256Hex(Buffer.from(`adopt:${manifestSha256}:${dshRoot}`, 'utf8')).slice(0, 16);
      }
      const finalOperationId = operationId ?? sha256Hex(Buffer.from(`adopt:${manifestSha256}:${dshRoot}`, 'utf8')).slice(0, 16);
      const mutation = withState(root, (state) => {
        state.projects[projectId] = {
          ...state.projects[projectId],
          uuid: assignedUuid,
          manifestSha256,
          manifestRegisteredAt: registeredAt,
          adoptedAt: record.adoptedAt ?? now,
        };
        if (resumed !== true) {
          recordOperation(state, finalOperationId, { kind: operation === OPERATIONS.link ? 'link-manifest' : 'adopt-manifest', uuid: assignedUuid, targetSha256: manifestSha256, registeredAt: now });
          appendEvent(state, { type: operation === OPERATIONS.link ? 'project.linked' : 'project.adopted', projectId, actor, note: assignedUuid });
        }
        return { ok: true };
      }, { now });
      if (mutation.ok !== true) return { ...mutation, action: name };
      return {
        ok: true,
        action: name,
        resumed,
        operationId: finalOperationId,
        projectId,
        uuid: assignedUuid,
        manifestSha256,
        manifestPath,
        snapshot: buildSnapshot({ root, cwd: targetCwd, now, scan: false }),
      };
    }
    // S6-D: mover el registro a otra carpeta exige que la anterior ya no exista y que la nueva tenga el
    // manifiesto de la misma identidad. Es lo único que impide «mover» a una carpeta cualquiera.
    if (operation === OPERATIONS.move) {
      const projectId = String(data.projectId ?? '').trim();
      const fromCwd = normalizeCwd(String(data.fromCwd ?? '') !== '' ? String(data.fromCwd) : String(cwd ?? ''));
      const toCwd = normalizeCwd(String(data.toCwd ?? ''));
      const currentState = loadState(root).state;
      const record = currentState.projects === undefined ? undefined : currentState.projects[projectId];
      if (record === undefined) {
        return { ok: false, code: 'unknown-project', message: 'ese proyecto no está registrado en el centro' };
      }
      if (fromCwd === '' || normalizeCwd(String(record.cwd ?? '')) !== fromCwd) {
        return { ok: false, code: 'path-mismatch', message: 'la carpeta de origen no es la del proyecto registrado' };
      }
      if (toCwd === '') {
        return { ok: false, code: 'missing-cwd', message: 'hace falta la carpeta de destino' };
      }
      let originPresent = false;
      try {
        originPresent = statSync(fromCwd).isDirectory() === true;
      } catch {
        originPresent = false;
      }
      if (originPresent === true) {
        return { ok: false, code: 'old-path-indeterminate', message: 'la carpeta anterior sigue existiendo: mover requiere que la ruta vieja haya desaparecido' };
      }
      const manifestPath = join(toCwd, '.dsh', 'lifecode-skill-center.json');
      const manifest = readManifest(manifestPath);
      if (manifest.status === 'missing') {
        return { ok: false, code: 'manifest-missing', message: 'la carpeta de destino no tiene manifiesto de identidad' };
      }
      if (manifest.status !== 'ok') {
        return { ok: false, code: 'manifest-invalid', message: 'el manifiesto del destino no es legible' };
      }
      if (isUuidV4(record.uuid) !== true || manifest.manifest.projectId !== record.uuid) {
        return { ok: false, code: 'manifest-mismatch', message: 'el manifiesto del destino es de otra identidad' };
      }
      const operationId = sha256Hex(Buffer.from(`move:${record.uuid}:${fromCwd}:${toCwd}`, 'utf8')).slice(0, 16);
      const mutation = withState(root, (state) => {
        state.projects[projectId] = {
          ...state.projects[projectId],
          cwd: toCwd,
          updatedAt: now,
          manifestSha256: manifest.sha256,
        };
        recordOperation(state, operationId, { kind: 'move-project', uuid: record.uuid, targetSha256: manifest.sha256, registeredAt: now });
        appendEvent(state, { type: 'project.moved', projectId, actor, note: `${fromCwd} → ${toCwd}` });
        return { ok: true };
      }, { now });
      if (mutation.ok !== true) return { ...mutation, action: name };
      return {
        ok: true,
        action: name,
        operationId,
        projectId,
        fromCwd,
        cwd: toCwd,
        manifestSha256: manifest.sha256,
        snapshot: buildSnapshot({ root, cwd: toCwd, now, scan: false }),
      };
    }

    // S6-D: reconciliar re-ancla el registro al manifiesto que hay en disco, pero sólo con doble confirmación
    // humana y con una copia verificada previa: el centro nunca «adivina» cuál de los dos estados es el bueno.
    if (operation === OPERATIONS.reconcile) {
      const projectId = String(data.projectId ?? '').trim();
      const targetCwd = normalizeCwd(String(data.cwd ?? '') !== '' ? String(data.cwd) : String(cwd ?? ''));
      if (data.confirm !== true) {
        return { ok: false, code: 'confirmation-required', message: 'reconciliar cambia el anclaje del centro: confírmalo explícitamente' };
      }
      const currentState = loadState(root).state;
      const record = currentState.projects === undefined ? undefined : currentState.projects[projectId];
      if (record === undefined) {
        return { ok: false, code: 'unknown-project', message: 'ese proyecto no está registrado en el centro' };
      }
      if (targetCwd === '' || normalizeCwd(String(record.cwd ?? '')) !== targetCwd) {
        return { ok: false, code: 'path-mismatch', message: 'la carpeta indicada no es la del proyecto registrado' };
      }
      const manifestPath = join(targetCwd, '.dsh', 'lifecode-skill-center.json');
      const manifest = readManifest(manifestPath);
      if (manifest.status !== 'ok') {
        return { ok: false, code: 'manifest-missing', message: 'no hay manifiesto legible que reconciliar' };
      }
      if (isUuidV4(record.uuid) !== true || manifest.manifest.projectId !== record.uuid) {
        return { ok: false, code: 'manifest-mismatch', message: 'el manifiesto del disco es de otra identidad: eso es un conflicto, no una reconciliación' };
      }
      const same = record.manifestSha256 === manifest.sha256;
      const operationId = sha256Hex(Buffer.from(`reconcile:${record.uuid}:${manifest.sha256}`, 'utf8')).slice(0, 16);
      if (same !== true) {
        const backup = ensureBackup(root, { now, reason: 'reconcile' });
        if (backup.ok !== true) return { ...backup, action: name };
      }
      const mutation = withState(root, (state) => {
        if (same !== true) {
          state.projects[projectId] = { ...state.projects[projectId], manifestSha256: manifest.sha256, manifestRegisteredAt: state.projects[projectId].manifestRegisteredAt ?? now };
          recordOperation(state, operationId, { kind: 'reconcile-project', uuid: record.uuid, targetSha256: manifest.sha256, registeredAt: now });
          appendEvent(state, { type: 'project.reconciled', projectId, actor, note: manifest.sha256.slice(0, 12) });
        }
        return { ok: true };
      }, { now });
      if (mutation.ok !== true) return { ...mutation, action: name };
      return {
        ok: true,
        action: name,
        reconciled: same !== true,
        operationId,
        projectId,
        manifestSha256: manifest.sha256,
        snapshot: buildSnapshot({ root, cwd: targetCwd, now, scan: false }),
      };
    }

    // S6-D: retirar el ancla de un proyecto sin borrar su identidad ni sus asignaciones.
    if (operation === OPERATIONS.unlink) {
      const projectId = String(data.projectId ?? '').trim();
      const targetCwd = normalizeCwd(String(data.cwd ?? '') !== '' ? String(data.cwd) : String(cwd ?? ''));
      const currentState = loadState(root).state;
      const record = currentState.projects === undefined ? undefined : currentState.projects[projectId];
      if (record === undefined) {
        return { ok: false, code: 'unknown-project', message: 'ese proyecto no está registrado en el centro' };
      }
      if (targetCwd === '' || normalizeCwd(String(record.cwd ?? '')) !== targetCwd) {
        return { ok: false, code: 'path-mismatch', message: 'la carpeta indicada no es la del proyecto registrado' };
      }
      const dshRoot = join(targetCwd, '.dsh');
      const manifestPath = join(dshRoot, 'lifecode-skill-center.json');
      const detached = detachManifest({ dshRoot, manifestPath, now });
      if (detached.ok !== true) return { ...detached, action: name };
      const mutation = withState(root, (state) => {
        if (detached.resumed !== true) {
          const entry = state.projects[projectId];
          state.projects[projectId] = {
            ...entry,
            detachedFrom: targetCwd,
            detachedAt: now,
            detachedSha256: detached.sha256 ?? null,
          };
          recordOperation(state, sha256Hex(Buffer.from(`unlink:${detached.sha256 ?? 'none'}:${targetCwd}`, 'utf8')).slice(0, 16), {
            kind: 'unlink-manifest',
            uuid: typeof entry.uuid === 'string' ? entry.uuid : null,
            targetSha256: detached.sha256 ?? null,
            registeredAt: now,
          });
          appendEvent(state, { type: 'project.detached', projectId, actor, note: detached.archivedFile ?? '' });
        }
        return { ok: true };
      }, { now });
      if (mutation.ok !== true) return { ...mutation, action: name };
      return {
        ok: true,
        action: name,
        resumed: detached.resumed === true,
        projectId,
        archivedFile: detached.archivedFile ?? null,
        manifestSha256: detached.sha256 ?? null,
        manifestPath,
        snapshot: buildSnapshot({ root, cwd: targetCwd, now, scan: false }),
      };
    }

    // S6-D: volver a anclar una identidad retirada, reutilizando su UUID (nunca emite un segundo linked).
    if (operation === OPERATIONS.relink) {
      const projectId = String(data.projectId ?? '').trim();
      const targetCwd = normalizeCwd(String(data.cwd ?? '') !== '' ? String(data.cwd) : String(cwd ?? ''));
      const currentState = loadState(root).state;
      const record = currentState.projects === undefined ? undefined : currentState.projects[projectId];
      if (record === undefined) {
        return { ok: false, code: 'unknown-project', message: 'ese proyecto no está registrado en el centro' };
      }
      if (targetCwd === '' || normalizeCwd(String(record.cwd ?? '')) !== targetCwd) {
        return { ok: false, code: 'path-mismatch', message: 'la carpeta indicada no es la del proyecto registrado' };
      }
      const uuid = isUuidV4(record.uuid) === true ? record.uuid : null;
      if (uuid === null) {
        return { ok: false, code: 'missing-uuid', message: 'esa identidad no tiene UUID: adóptala antes de volver a anclarla' };
      }
      const dshRoot = join(targetCwd, '.dsh');
      mkdirSync(dshRoot, { recursive: true });
      const manifestPath = join(dshRoot, 'lifecode-skill-center.json');
      const existing = readManifest(manifestPath);
      const registeredAt = isCanonicalUtc(String(record.manifestRegisteredAt ?? '')) ? record.manifestRegisteredAt : now;
      const bytes = manifestBytes(newManifest({ projectId: uuid, registeredAt }));
      const manifestSha256 = sha256Hex(bytes);
      const resumed = existing.status === 'ok' && existing.sha256 === manifestSha256;
      if (resumed !== true) {
        if (existing.status === 'ok') {
          return { ok: false, code: 'path-conflict', message: 'la carpeta ya tiene otro manifiesto' };
        }
        if (existing.status === 'invalid') {
          return { ok: false, code: 'manifest-invalid', message: 'el manifiesto de la carpeta está dañado: repáralo primero' };
        }
        const published = publishExclusive({ path: manifestPath, bytes, dshRoot, operationId: undefined });
        if (published.ok !== true) return { ...published, action: name };
      }
      const operationId = sha256Hex(Buffer.from(`relink:${manifestSha256}:${dshRoot}`, 'utf8')).slice(0, 16);
      const mutation = withState(root, (state) => {
        if (resumed !== true) {
          const entry = state.projects[projectId];
          const next = { ...entry, uuid, manifestSha256, manifestRegisteredAt: registeredAt };
          delete next.detachedFrom;
          delete next.detachedAt;
          delete next.detachedSha256;
          state.projects[projectId] = next;
          recordOperation(state, operationId, { kind: 'relink-manifest', uuid, targetSha256: manifestSha256, registeredAt: now });
          appendEvent(state, { type: 'project.relinked', projectId, actor, note: uuid });
        }
        return { ok: true };
      }, { now });
      if (mutation.ok !== true) return { ...mutation, action: name };
      return {
        ok: true,
        action: name,
        resumed,
        projectId,
        uuid,
        manifestSha256,
        manifestPath,
        snapshot: buildSnapshot({ root, cwd: targetCwd, now, scan: false }),
      };
    }

    // S6-E: crear una identidad nueva en la misma carpeta (fork de proyecto). El proyecto anterior
    // conserva su registro y sus asignaciones; el nuevo nace sin ninguna asignación heredada.
    if (operation === OPERATIONS.fork) {
      const previousId = String(data.projectId ?? '').trim();
      const targetCwd = normalizeCwd(String(data.cwd ?? '') !== '' ? String(data.cwd) : String(cwd ?? ''));
      const requestedNew = String(data.newProjectId ?? '').trim();
      if (previousId === '') {
        return { ok: false, code: 'invalid-project-id', message: 'hace falta la identidad del proyecto que se bifurca' };
      }
      if (targetCwd === '') {
        return { ok: false, code: 'missing-cwd', message: 'no se conoce la carpeta del proyecto que se bifurca' };
      }
      const currentState = loadState(root).state;
      const previous = currentState.projects === undefined ? undefined : currentState.projects[previousId];
      if (previous === undefined) {
        return { ok: false, code: 'unknown-project', message: 'ese proyecto no está registrado en el centro' };
      }
      if (normalizeCwd(String(previous.cwd ?? '')) !== targetCwd) {
        return { ok: false, code: 'path-mismatch', message: 'la carpeta indicada no es la del proyecto registrado' };
      }
      const newProjectId = requestedNew === '' ? randomUUID() : requestedNew;
      if (isUuidV4(newProjectId) !== true) {
        return { ok: false, code: 'invalid-project-id', message: 'el UUID nuevo debe ser v4 canónico' };
      }
      if (newProjectId === previousId || (currentState.projects !== undefined && currentState.projects[newProjectId] !== undefined)) {
        return { ok: false, code: 'exists', message: 'esa identidad ya existe en el centro' };
      }
      const dshRoot = join(targetCwd, '.dsh');
      mkdirSync(dshRoot, { recursive: true });
      const manifestPath = join(dshRoot, 'lifecode-skill-center.json');
      // Una bifurcación archiva una identidad que existe: si no hay manifiesto legible, no hay nada que
      // conservar y la operación debe parar en vez de inventarse un origen.
      const source = readManifest(manifestPath);
      if (source.status !== 'ok') {
        return { ok: false, code: 'fork-source-missing', message: 'la carpeta no tiene un manifiesto de identidad legible que bifurcar', status: 'invalid-source' };
      }
      if (typeof previous.uuid === 'string' && previous.uuid !== source.manifest.projectId) {
        return { ok: false, code: 'fork-source-mismatch', message: 'el manifiesto de la carpeta no es el de la identidad registrada' };
      }
      const forked = forkProjectManifest({
        dshRoot,
        manifestPath,
        manifest: newManifest({ projectId: newProjectId, registeredAt: now }),
        now,
      });
      if (forked.ok !== true) return { ...forked, action: name };
      const mutation = withState(root, (state) => {
        state.projects[newProjectId] = {
          id: newProjectId,
          name: String(previous.name ?? projectNameFor(targetCwd)),
          cwd: targetCwd,
          createdAt: now,
          updatedAt: now,
          note: `fork de ${previousId}`,
          uuid: newProjectId,
          manifestSha256: forked.manifestSha256,
          manifestRegisteredAt: now,
          forkedFrom: previousId,
          forkOperationId: forked.operationId,
          forkedAt: now,
          forkPreviousManifestSha256: forked.previousSha256 ?? null,
          forkArchivedFile: forked.archivedFile ?? null,
        };
        recordOperation(state, forked.operationId, {
          kind: 'fork-project',
          uuid: newProjectId,
          targetSha256: forked.manifestSha256,
          registeredAt: now,
        });
        appendEvent(state, { type: 'project.forked', projectId: newProjectId, actor, note: previousId });
        return { ok: true };
      }, { now });
      if (mutation.ok !== true) return { ...mutation, action: name };
      return {
        ok: true,
        action: name,
        resumed: forked.resumed === true,
        operationId: forked.operationId,
        previousProjectId: previousId,
        projectId: newProjectId,
        manifestSha256: forked.manifestSha256,
        archivedFile: forked.archivedFile ?? null,
        manifestPath,
        snapshot: buildSnapshot({ root, cwd: targetCwd, now, scan: false }),
      };
    }
    return {
      ok: false,
      code: 'identity-operation-pending',
      message: `la operación "${operation}" tiene política aprobada pero su implementación llega en una fase posterior`,
    };
  }

  // Compuertas de preflight (§4.3): se evalúan ANTES de abrir el almacén para escribir. Si bloquean, no se
  // ha escrito ni un byte. Un `warn` deja pasar y devuelve los hallazgos junto al resultado.
  let gateFindings = [];
  const gate = actionPreflight({ root, action: name, data, cwd, now, hostSources, registry, materialized, sessions, inventory, collisions });
  if (gate !== null) {
    if (gate.storeUnreadable !== undefined) {
      return unreadableResult(gate.storeUnreadable, 'el centro no se puede leer: no se evalúa ninguna compuerta sobre datos dudosos');
    }
    if (gate.decision === 'block') {
      return {
        ok: false,
        code: 'preflight-blocked',
        apiVersion: API_VERSION,
        message: `el preflight bloquea «${name}»: ${Array.isArray(gate.reasons) && gate.reasons.length > 0 ? gate.reasons[0] : 'la evidencia no alcanza'}`,
        findings: Array.isArray(gate.findings) ? gate.findings : [],
        reasons: Array.isArray(gate.reasons) ? gate.reasons : [],
        evidence: gate.evidence ?? null,
      };
    }
    if (Array.isArray(gate.findings) && gate.findings.length > 0) gateFindings = gate.findings;
  }

  const mutation = withState(root, (state) => {
    // Replay (contrato §R6): si la operación ya se registró, se devuelve sin escribir ni duplicar evento.
    if (eventOperationId !== '' && operationOf(state, eventOperationId) !== null) {
      return { ok: true, replayed: true, activity: null, operationId: eventOperationId };
    }
    switch (name) {
      case 'create': {
        // Idempotencia por petición (directiva §9): si el agente reintenta una creación con el mismo
        // `requestId`, la respuesta es la skill que ya se creó, no una segunda copia en la biblioteca.
        const retryRequest = String(data.requestId ?? '').trim();
        if (retryRequest !== '') {
          const previous = (state.requests ?? {})[retryRequest];
          const previousSkill = previous === undefined ? undefined : state.skills?.[String(previous.skillId ?? '')];
          if (previous !== undefined && previous.status === 'fulfilled' && previousSkill !== undefined) {
            return {
              ok: true,
              idempotent: true,
              requestId: retryRequest,
              id: String(previousSkill.id),
              skill: previousSkill,
              message: `la petición ${retryRequest} ya tiene su skill: no se crea otra`,
            };
          }
        }
        const finishCreate = (result) => {
          if (result?.ok !== true) return result;
          // Consultar la biblioteca antes de cantar victoria: una skill nueva con el mismo título o los
          // mismos temas que otra es un duplicado probable, y el agente tiene que verlo para decidir.
          const duplicates = duplicatesOf(state, String(result.id ?? ''));
          return duplicates.length === 0 ? result : { ...result, duplicates };
        };
        // Crear a partir de un hallazgo deja el rastro: la skill nace con su origen y el hallazgo pasa a
        // triaje con la skill aplicada. No se marca «acted-on» sin decisión: eso lo dice el ledger.
        const fromInsight = (result) => {
          if (result?.ok !== true) return result;
          const insightId = String(data.insightId ?? '').trim();
          if (insightId === '') return result;
          let linked = null;
          try {
            const knowledge = withKnowledge(root, (document) => {
              // El ciclo de vida avanzó: si el principal ya lo validó, enlazar la skill **no** puede
              // retroceder el hallazgo a `triaged`; se registra como decisión tomada.
              const found = (document.insights ?? []).find((item) => item.insightId === insightId) ?? null;
              const target = String(found?.state ?? '') === 'validated' ? 'decided' : 'triaged';
              const moved = triageInsight(document, {
                insightId,
                state: target,
                note: `skill creada: ${String(result.id ?? '')}`,
                appliedSkillId: String(result.id ?? ''),
              }, now);
              linked = moved.ok === true
                ? { insightId, linked: true, state: moved.insight?.state ?? 'triaged', appliedSkillId: String(result.id ?? '') }
                : null;
              return moved;
            }, { now });
            if (knowledge.ok !== true && linked === null) {
              return { ...result, insightLink: { insightId, linked: false, code: knowledge.code ?? 'insight-not-found' } };
            }
          } catch (error) {
            // El fallo no puede tumbar la creación de la skill: se informa y se sigue.
            return {
              ...result,
              insightLink: { insightId, linked: false, code: 'knowledge-unavailable', detail: String(error?.message ?? error) },
            };
          }
          return { ...result, insightLink: linked ?? { insightId, linked: false, code: 'insight-not-found' } };
        };
        if (actor !== 'ai') return fromInsight(finishCreate(createSkill(state, data, { now, actor })));
        const gate = autonomousDecision({ root, state, operation: 'create-skill', skillId: String(data.id ?? ''), explicitRequest: false, insightIds: Array.isArray(data.insightIds) ? data.insightIds : [], now });
        if (!gate.allowed) return gate.refusal;
        const created = fromInsight(finishCreate(createSkill(state, data, { now, actor })));
        settleGate(root, gate, created, now);
        return created.ok === true ? { ...created, decisionId: gate.decisionId, evidenceLevel: gate.level, logged: gate.logged } : created;
      }
      case 'publish': {
        const gate = actor === 'ai'
          ? autonomousDecision({ root, state, operation: 'publish', skillId: String(data.id ?? ''), explicitRequest: false, insightIds: Array.isArray(data.insightIds) ? data.insightIds : [], now })
          : { allowed: true };
        if (actor === 'ai' && !gate.allowed) return gate.refusal;
        const published = publishVersion(state, String(data.id ?? ''), data, { now, actor, authorized: gate.allowed === true });
        settleGate(root, gate, published, now);
        return gate.decisionId && published.ok === true ? { ...published, decisionId: gate.decisionId } : published;
      }
      case 'improve': {
        if (actor !== 'ai') return proposeImprovement(state, String(data.skillId ?? data.id ?? ''), data, { now, actor });
        const gate = autonomousDecision({ root, state, operation: 'improve-skill', skillId: String(data.skillId ?? data.id ?? ''), explicitRequest: false, insightIds: Array.isArray(data.insightIds) ? data.insightIds : [], now });
        if (!gate.allowed) return gate.refusal;
        const proposed = proposeImprovement(state, String(data.skillId ?? data.id ?? ''), data, { now, actor });
        settleGate(root, gate, proposed, now);
        return proposed.ok === true ? { ...proposed, decisionId: gate.decisionId } : proposed;
      }
      case 'decide': {
        const approve = String(data.decision ?? '') === 'approve';
        const improvementId = String(data.improvementId ?? '');
        const improvement = state.improvements?.[improvementId];
        if (improvement === undefined) {
          return { ok: false, code: 'missing', message: `no hay ninguna propuesta con el id "${improvementId}"` };
        }
        // La compuerta evalúa la skill de la propuesta y nada más: si el payload nombra otra, se rechaza
        // en vez de evaluar una y publicar la otra (RT-D1).
        if (data.skillId !== undefined && String(data.skillId) !== String(improvement.skillId)) {
          return { ok: false, code: 'skill-mismatch', message: 'la propuesta es de otra skill: la compuerta no puede evaluar una y publicar otra' };
        }
        const gate = actor === 'ai' && approve
          ? autonomousDecision({
            root,
            state,
            operation: 'approve',
            skillId: String(improvement.skillId), explicitRequest: false, insightIds: Array.isArray(data.insightIds) ? data.insightIds : [], now })
          : { allowed: true };
        if (actor === 'ai' && approve && !gate.allowed) return gate.refusal;
        const decided = decideImprovement(state, improvementId, String(data.decision ?? ''), { now, actor, note: data.note, authorized: gate.allowed === true });
        settleGate(root, gate, decided, now);
        return gate.decisionId && decided.ok === true ? { ...decided, decisionId: gate.decisionId } : decided;
      }
      case 'toggle': {
        if (actor !== 'ai') return toggleAssignment(state, data, { now, actor });
        const boundToggle = bindAiProject(state, data, cwd, actor);
        if (boundToggle.ok !== true) return boundToggle;
        const bound = boundToggle.projectId === String(data.projectId ?? '') ? data : { ...data, projectId: boundToggle.projectId };
        const operation = bound.enabled === true ? 'activate' : 'deactivate';
        const gate = autonomousDecision({
          root,
          state,
          operation,
          skillId: String(bound.skillId ?? ''),
          projectId: String(bound.projectId ?? ''),
          explicitRequest: false,
          insightIds: Array.isArray(bound.insightIds) ? bound.insightIds : [],
          now,
        });
        if (!gate.allowed) return gate.refusal;
        const toggled = toggleAssignment(state, bound, { now, actor, authorized: gate.allowed === true });
        settleGate(root, gate, toggled, now);
        return toggled.ok === true ? { ...toggled, decisionId: gate.decisionId, evidenceLevel: gate.level } : toggled;
      }
      case 'rollback': {
        if (actor !== 'ai') return rollbackAssignment(state, data, { now, actor });
        const boundRollback = bindAiProject(state, data, cwd, actor);
        if (boundRollback.ok !== true) return boundRollback;
        const dataRollback = boundRollback.projectId === String(data.projectId ?? '') ? data : { ...data, projectId: boundRollback.projectId };
        const gate = autonomousDecision({ root, state, operation: 'rollback', skillId: String(dataRollback.skillId ?? ''), projectId: String(dataRollback.projectId ?? ''), explicitRequest: false, insightIds: Array.isArray(dataRollback.insightIds) ? dataRollback.insightIds : [], now });
        if (!gate.allowed) return gate.refusal;
        const rolled = rollbackAssignment(state, dataRollback, { now, actor, authorized: gate.allowed === true });
        settleGate(root, gate, rolled, now);
        return rolled.ok === true ? { ...rolled, decisionId: gate.decisionId } : rolled;
      }
      case 'advance': {
        if (actor !== 'ai') return advanceAssignments(state, data, { now, actor });
        const boundAdvance = bindAiProject(state, data, cwd, actor);
        if (boundAdvance.ok !== true) return boundAdvance;
        const dataAdvance = boundAdvance.projectId === String(data.projectId ?? '') ? data : { ...data, projectId: boundAdvance.projectId };
        const gate = autonomousDecision({ root, state, operation: 'advance-pin', skillId: String(dataAdvance.skillId ?? ''), projectId: String(dataAdvance.projectId ?? ''), explicitRequest: false, insightIds: Array.isArray(dataAdvance.insightIds) ? dataAdvance.insightIds : [], now });
        if (!gate.allowed) return gate.refusal;
        // La compuerta se evaluó para una skill: avanzar el pin de todas las encendidas cambiaría estado
        // que nadie autorizó en esta llamada (RT-D6).
        const scope = String(dataAdvance.skillId ?? '') === '' ? dataAdvance : { ...dataAdvance, skillIds: [String(dataAdvance.skillId)] };
        const advanced = advanceAssignments(state, scope, { now, actor, authorized: gate.allowed === true });
        settleGate(root, gate, advanced, now);
        return advanced.ok === true ? { ...advanced, decisionId: gate.decisionId } : advanced;
      }

      case 'declare-application': {
        // Una entrega (`skill.loaded`) la produce el catálogo; una aplicación la declara alguien. La nota es
        // obligatoria porque sin ella no hay evidencia: sólo una afirmación.
        const appliedSkill = String(data.skillId ?? data.id ?? '');
        if (state.skills[appliedSkill] === undefined) return { ok: false, code: 'missing-skill', message: `no existe la skill ${appliedSkill || '(vacía)'}` };
        const appliedNote = String(data.note ?? '').trim();
        if (appliedNote.length < 10) return { ok: false, code: 'note-required', message: 'una aplicación sin nota no es evidencia: describe qué se aplicó' };
        const appliedProject = String(data.projectId ?? '');
        if (appliedProject !== '' && state.projects[appliedProject] === undefined) return { ok: false, code: 'unknown-project', message: 'ese proyecto no está en el registro' };
        appendEvent(state, { at: now, type: 'skill.applied', actor, skillId: appliedSkill, projectId: appliedProject, version: String(data.version ?? ''), note: appliedNote });
        return { ok: true, skillId: appliedSkill, projectId: appliedProject, note: appliedNote };
      }

      case 'fork':
        return forkSkill(state, data, { now, actor });
      case 'evaluate':
        return evaluateStored(state, String(data.id ?? data.skillId ?? ''), data.version, { now });
      case 'register-project': {
        // El alta escribe DOS cosas y en este orden: primero el registro, después el manifiesto del centro.
        // El proyecto en disco no se toca (§1.3): el hash de su árbol antes/después es idéntico.
        const targetCwd = String(data.cwd ?? cwd);
        // Un `cwd` relativo o con `..` registraría un proyecto fuera de cualquier workspace real: la
        // ruta es una identidad, y una identidad no la elige el cliente con una ruta ambigua (D2).
        const normalizedTarget = targetCwd.trim() === '' ? '' : trustedCwd(targetCwd);
        if (normalizedTarget === null) {
          return { ok: false, code: 'invalid-cwd', message: 'la ruta del proyecto debe ser absoluta y estar normalizada' };
        }
        const knownBefore = findProject(state, normalizedTarget);
        const project = ensureProject(state, normalizedTarget !== '' ? normalizedTarget : targetCwd, { now, name: data.name });
        if (project === null) return { ok: false, code: 'bad-cwd', message: 'la ruta no da un proyecto' };
        const manifest = writeCenterManifest({ root, project, now });
        if (manifest.ok !== true) {
          // Nada de dejar un registro huérfano si el manifiesto no se pudo escribir.
          if (knownBefore === null) delete state.projects[project.id];
          return manifest;
        }
        project.uuid = manifest.uuid;
        project.manifestSha256 = manifest.sha256;
        project.manifestRegisteredAt = manifest.registeredAt;
        project.registeredAt = project.registeredAt ?? manifest.registeredAt;
        project.updatedAt = now;
        return {
          ok: true,
          project,
          manifest: { path: manifest.path, sha256: manifest.sha256, uuid: manifest.uuid, registeredAt: manifest.registeredAt },
        };
      }
      case 'adopt-project': {
        // Adoptar un manifiesto existente NO lo crea: exige que ya esté en el centro, que sea válido y que
        // su uuid no contradiga la identidad ya anclada en el registro.
        const requested = String(data.projectId ?? '');
        const project = state.projects[requested] ?? Object.values(state.projects).find((entry) => entry?.uuid === requested);
        if (project === undefined) return { ok: false, code: 'not-adoptable', message: 'ese proyecto no está en el registro' };
        const read = readManifest(projectManifestPath(root, project.id));
        if (read.status !== 'ok') {
          return {
            ok: false,
            code: 'not-adoptable',
            message: `no hay un manifiesto adoptable en ${read.path ?? projectManifestPath(root, project.id)} (${read.status}${read.reason ? `: ${read.reason}` : ''})`,
          };
        }
        const manifestUuid = read.manifest.projectId;
        if (isUuidV4(manifestUuid) !== true) {
          return { ok: false, code: 'not-adoptable', message: 'el manifiesto no tiene un uuid de proyecto válido' };
        }
        if (isUuidV4(project.uuid) && project.uuid !== manifestUuid) {
          return {
            ok: false,
            code: 'identity-conflict',
            message: `el registro ya tiene el uuid ${project.uuid}, distinto del manifiesto ${manifestUuid}`,
          };
        }
        project.uuid = manifestUuid;
        project.manifestSha256 = read.sha256;
        project.manifestRegisteredAt = read.manifest.registeredAt;
        project.adoptedAt = now;
        project.updatedAt = now;
        return {
          ok: true,
          action: 'adopt-project',
          adopted: true,
          project,
          manifest: { path: read.path, sha256: read.sha256, uuid: manifestUuid, registeredAt: read.manifest.registeredAt },
        };
      }
      case 'materialize-project': {
        // Materializar escribe la vista del centro (`materialized/<projectId>`), nunca el proyecto del usuario.
        const requested = String(data.projectId ?? '') || String(findProject(state, cwd)?.id ?? '');
        const project = state.projects[requested];
        if (project === undefined) return { ok: false, code: 'unknown-project', message: 'ese proyecto no está en el registro' };
        let synced;
        try {
          synced = syncProject({ root, project, assignments: assignedSkills(state, project.id), now });
        } catch (error) {
          return { ok: false, code: 'materialize-failed', message: `no se pudo materializar: ${String(error?.message ?? error)}` };
        }
        return {
          ok: true,
          action: 'materialize-project',
          projectId: project.id,
          materialized: {
            directory: synced?.directory ?? null,
            written: Array.isArray(synced?.written) ? synced.written : [],
            removed: Array.isArray(synced?.removed) ? synced.removed : [],
            unchanged: synced?.unchanged === true,
          },
        };
      }
      case 'rename-project': {
        const project = state.projects[String(data.projectId ?? '')];
        if (project === undefined) return { ok: false, code: 'unknown-project', message: 'ese proyecto no está en el registro' };
        project.name = String(data.name ?? '').trim() || project.name;
        project.note = String(data.note ?? project.note ?? '');
        project.updatedAt = now;
        return { ok: true, project };
      }
      case 'import': {
        if (actor === 'ai') return { ok: false, code: 'approval-required', message: 'importar contenido a la biblioteca lo confirma una persona' };
        const wanted = String(data.path ?? '');
        const walked = scanExternalSkills({ cwd: normalizeCwd(cwd), dshHome, agentsHome, materializedRoot: materialized });
        if (!walked.candidates.some((candidate) => candidate.path === wanted)) {
          return { ok: false, code: 'not-scanned', message: 'esa ruta no es una skill que el barrido haya visto: actualiza el panel y vuelve a intentarlo' };
        }
        const text = (() => {
          try {
            return readFileSync(wanted, 'utf8');
          } catch {
            return '';
          }
        })();
        if (typeof text !== 'string' || text === '') return { ok: false, code: 'unreadable', message: 'no se pudo leer esa skill' };
        const parsed = candidateFromSkillFile(text, { path: wanted, source: 'import' });
        if (parsed === null) return { ok: false, code: 'unreadable', message: 'esa skill no tiene una cabecera utilizable' };
        const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^#\s+.*\r?\n+/, '');
        return createSkill(state, {
          id: data.id ?? parsed.id,
          title: data.title ?? parsed.name,
          description: parsed.description,
          whenToUse: parsed.whenToUse,
          tags: parsed.tags,
          body,
          notes: `importada de ${wanted}`,
          origin: { kind: 'import', from: wanted, note: '' },
        }, { now, actor });
      }
      case 'request-skill': {
        const opened = openRequest(state, { text: data.text }, { now, actor });
        if (opened.ok !== true) return opened;
        if (opened.duplicate !== true) {
          if (opened?.request !== null && typeof opened.request === 'object' && opened.request.requestedBy === undefined) {
            opened.request.requestedBy = actor === 'ai' ? 'ai' : 'human';
          }
          appendEvent(state, { at: now, type: 'skill.requested', actor, note: opened.id });
        }
        return opened;
      }
      case 'request-fulfill': {
        const fulfillRequestId = String(data.requestId ?? '');
        const fulfillSkillId = String(data.skillId ?? '');
        if (actor === 'ai') {
          // Cerrar la petición de una persona es ligar SU necesidad a una skill concreta: la IA sólo puede
          // hacerlo con una skill que ha creado después de la petición, no con una que ya estaba (RT-H10/H16).
          const requestRecord = state.requests?.[fulfillRequestId];
          const linkedSkill = state.skills?.[fulfillSkillId];
          if (requestRecord === undefined || linkedSkill === undefined) {
            return { ok: false, code: 'missing-skill', message: 'la petición y la skill tienen que existir para ligarlas' };
          }
          if (String(linkedSkill.createdAt ?? '') < String(requestRecord.createdAt ?? '')) {
            return { ok: false, code: 'approval-required', message: 'una petición se cierra con la skill creada para ella, no con una anterior: eso lo decide una persona' };
          }
        }
        const fulfilled = fulfillRequest(state, fulfillRequestId, { skillId: data.skillId, note: data.note }, { now, actor });
        if (fulfilled.ok !== true) return fulfilled;
        appendEvent(state, { at: now, type: 'skill.request-fulfilled', actor, skillId: fulfilled.request.skillId, note: fulfilled.id });
        return fulfilled;
      }
      case 'request-dismiss': {
        const dismissed = dismissRequest(state, String(data.requestId ?? ''), { now, actor });
        if (dismissed.ok !== true) return dismissed;
        appendEvent(state, { at: now, type: 'skill.request-dismissed', actor, note: dismissed.id });
        return dismissed;
      }
      default:
        return { ok: false, code: 'unknown-action', message: `la acción "${name}" no existe` };
    }
  }, { now, eventDefaults, operationId: eventOperationId, operationKind: name });

  if (!mutation.ok && mutation.code === 'store-unreadable') {
    return unreadableResultFromStore(mutation, 'el centro no se puede leer: los datos originales están preservados y no se ha escrito nada');
  }
  if (!mutation.ok) return { ok: false, code: 'store', message: 'no se pudo guardar el centro', storeError: mutation.storeError };
  const result = mutation.result ?? { ok: false, code: 'empty', message: 'la acción no devolvió nada' };

  // Un cambio de versión fijada tiene que verse en el disco en el mismo acto: si no, la asignación
  // dice 1.1.0 y el SKILL.md materializado sigue en 1.0.0 hasta que alguien pida el catálogo
  // (encontrado en la auditoría: «Usar aquí» dejaba el fichero viejo).
  if (result?.ok === true && (name === 'toggle' || name === 'rollback' || name === 'advance')) {
    const loaded = loadState(root);
    const project = typeof data.projectId === 'string' && data.projectId !== ''
      ? loaded.state.projects[data.projectId]
      : findProject(loaded.state, cwd);
    if (project !== undefined && project !== null) {
      try {
        ensureProjectView({ root, state: loaded.state, project, now });
      } catch {
        // Si el disco no se deja escribir, la próxima lectura del catálogo lo reintenta.
      }
    }
  }
  const final = gateFindings.length > 0 && result !== null && typeof result === 'object'
    ? { ...result, findings: gateFindings }
    : result;
  // R17: la respuesta lleva la entrada exacta que quedó en el diario. Sólo cuando la transacción
  // persistió y la acción salió bien: un bloqueo o un fallo no dejan evento y no devuelven `activity`.
  if (result?.ok === true && final !== null && typeof final === 'object') {
    if (result.replayed === true) return final;
    if (mutation.saved === true && Array.isArray(mutation.appended) && mutation.appended.length > 0) {
      const activity = activityForResult(mutation.state, mutation.appended.at(-1).id);
      if (activity !== null) return { ...final, activity, replayed: false };
    }
    // R8: sin evento no se anuncia nada como hecho (`activity:null`, nunca una entrada inventada).
    return { ...final, activity: null, replayed: false };
  }
  return final;
}

/** Lo que el proveedor de skills necesita: sólo lo encendido para esta ruta. */
/**
 * Comprobación del producto: junta en una lista lo que hasta ahora había que mirar en cinco sitios
 * (integridad del documento, copia autoritativa, candado, deriva del materializado, inventario del Host).
 * Sólo lee: dice si el centro está sano, no lo arregla. Arreglar es una acción humana.
 */
export function doctorPayload({ root, registry = null, now = new Date().toISOString() } = {}) {
  const loaded = loadState(root);
  const state = loaded.state;
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  add(
    'store-integrity',
    loaded.integrity === INTEGRITY_OK ? 'ok' : 'fail',
    loaded.integrity === INTEGRITY_OK
      ? `${loaded.size} B · ${String(loaded.sha256).slice(0, 12)}`
      : `${loaded.integrity}: ${loaded.error ?? ''}`,
  );

  if (canWrite(loaded.integrity) === true) {
    const schema = Number(state.schemaVersion);
    add('schema-version', schema >= 1 && schema <= SCHEMA_VERSION ? 'ok' : 'warn', `v${schema} (producto v${SCHEMA_VERSION})`);
  }

  const backup = backupSummary(root, loaded);
  // Una copia íntegra de un estado anterior no respalda el documento de hoy. Se dice con todas las letras en
  // lugar de pintar «verificada» y dejar que la persona crea que está cubierta (defecto real del panel).
  const backupStatus = backup.status !== 'verified' ? (backup.status === 'missing' ? 'warn' : 'fail') : backup.fresh === true ? 'ok' : 'warn';
  add(
    'backup',
    backupStatus,
    backup.status !== 'verified'
      ? `${backup.status}${backup.error ? `: ${backup.error}` : ''}`
      : `${String(backup.sha256).slice(0, 12)} · ${backup.size} B${backup.fresh === true ? '' : ' · anterior al documento actual'}`,
  );

  const lock = inspectLock(root, { now: Date.now() });
  add(
    'lock',
    lock.present === true && lock.stale !== true ? 'warn' : 'ok',
    lock.present === true ? `candado ${lock.stale === true ? 'abandonado' : 'vivo'}` : 'sin candado',
  );

  const projects = Object.values(state.projects ?? {});
  add('registry', projects.length > 0 ? 'ok' : 'warn', `${projects.length} proyecto(s) registrado(s)`);

  let drifted = 0;
  const drift = [];
  for (const project of projects) {
    const row = (state.assignments ?? {})[project.id] ?? {};
    const expected = [];
    for (const [skillId, assignment] of Object.entries(row)) {
      if (assignment?.enabled === true) expected.push(skillId);
    }
    let materialized = [];
    try {
      const view = inspectProject({ root, projectId: project.id });
      materialized = (Array.isArray(view.skills) ? view.skills : [])
        .map((entry) => String(entry.id ?? entry.skillId ?? ''))
        .filter((id) => id !== '')
        .sort();
    } catch (failure) {
      drift.push(`${project.id}: no se pudo leer el materializado`);
      drifted += 1;
      continue;
    }
    if (JSON.stringify(materialized) !== JSON.stringify(expected.sort())) {
      drifted += 1;
      drift.push(`${project.id}: disco ${materialized.length} vs asignadas ${expected.length}`);
    }
  }
  add(
    'materialized',
    drifted === 0 ? 'ok' : 'warn',
    drifted === 0 ? 'coincide con las asignaciones encendidas' : `${drifted} proyecto(s) con deriva: ${drift.slice(0, 3).join('; ')}`,
  );

  const workspaces = typeof registry?.list === 'function' ? registry.list() : null;
  add(
    'identity-inventory',
    Array.isArray(workspaces) === true ? 'ok' : 'warn',
    Array.isArray(workspaces) === true ? `${workspaces.length} workspace(s) del Host` : 'el Host no expone workspaceRegistry',
  );

  const pending = Object.values(state.improvements ?? {}).filter((entry) => entry?.status === 'proposed').length;
  add('improvements-pending', pending === 0 ? 'ok' : 'warn', `${pending} propuesta(s) esperando a una persona`);

  const counts = {
    skills: Object.keys(state.skills ?? {}).length,
    projects: projects.length,
    events: Array.isArray(state.events) ? state.events.length : 0,
  };
  add('events', counts.events > 0 ? 'ok' : 'warn', `${counts.events} evento(s) en el diario`);

  const summary = {
    ok: checks.filter((check) => check.status === 'ok').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  };

  return {
    ok: summary.fail === 0,
    apiVersion: API_VERSION,
    generatedAt: now,
    root,
    schemaVersion: state.schemaVersion,
    backup: { status: backup.status, verified: backup.verified === true, fresh: backup.fresh === true, sha256: backup.sha256, size: backup.size, generation: backup.generation },
    counts,
    checks,
    summary,
  };
}

export function listAssignedFor({ root = centerRoot(), cwd = '' } = {}) {
  const loaded = loadState(root);
  const project = findProject(loaded.state, cwd);
  if (project === null) return { project: null, skills: [] };
  return { project, skills: assignedSkills(loaded.state, project.id) };
}
