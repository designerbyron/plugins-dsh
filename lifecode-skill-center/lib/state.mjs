/**
 * El almacén: un documento JSON versionado, escrito de forma atómica.
 *
 * Por qué un documento y no una carpeta por entidad: un cambio de este centro casi siempre toca dos o
 * tres cosas a la vez —publicar una versión y dejar su evaluación, asignarla y anotar el evento—, y con
 * un documento esas cosas se escriben juntas o no se escriben. No hay transacción entre ficheros, y
 * fingirla sería peor que no tenerla.
 *
 * La escritura es `tmp` + `rename`: en el mismo volumen el rename es atómico, así que un corte a mitad
 * deja el documento anterior entero, nunca medio documento.
 */

import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

import { isSafeId, parseVersion, shortHash } from './format.mjs';

/**
 * Última versión del documento que este código **sabe leer**.
 *
 * v1 es el esquema original. v2 es estrictamente aditivo (ver `migrateStore`): añade
 * `schemaMeta` en la raíz y `pinnedAt` en cada asignación, y nada más. Escribir una versión
 * nueva no es cosa de un guardado: sólo la migración explícita sube el número, porque subirlo
 * por accidente dejaría un documento que una versión anterior del plugin no sabría leer.
 */
export const SCHEMA_VERSION = 2;

/**
 * Esquema que introduce la identidad portable (LSC‑017…025): `uuid`, `manifestSha256`,
 * `manifestRegisteredAt`, campos de fork/detach y el mapa `operations`. Es **aditivo** y este código lo
 * lee, lo conserva y lo escribe sin degradarlo; lo que no hace es migrar solo: las operaciones de
 * identidad exigen v3 y responden `migration-required` mientras el centro esté en v2.
 */
export const IDENTITY_SCHEMA_VERSION = 3;

/**
 * Tope de lectura. No es el esquema que se escribe por defecto (eso es `SCHEMA_VERSION`): es lo que
 * `normalizeState` acepta sin recortar, porque recortar la versión al leerla y guardarla después
 * convertiría un centro v3 en v2 sin avisar.
 */
export const MAX_SCHEMA_VERSION = 3;

/** ¿Este documento admite operaciones de identidad? */
export function identityAvailable(state) {
  return Number.isInteger(state?.schemaVersion) && state.schemaVersion >= IDENTITY_SCHEMA_VERSION;
}

/** Versión mínima que se acepta leer. v1 se lee; para escribir se migra antes. */
export const MIN_SCHEMA_VERSION = 1;
/** Tope del diario de eventos. Más allá de esto lo que sobra no se consulta y engorda cada escritura. */
export const MAX_EVENTS = 4000;

/** Raíz de datos por defecto: hermana de `skills/` y de `skill-compiler/`, sin pisar ninguna. */
export function defaultRoot(env = process.env) {
  const dshHome = env?.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'lifecode-skill-center');
}

export function centerFile(root) {
  return join(root, 'center.json');
}

/** Las skills asignadas se materializan aquí para que el harness las lea con su propio lector. */
export function materializedRoot(root) {
  return join(root, 'materialized');
}

export function emptyState(now = new Date().toISOString()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    skills: {},
    projects: {},
    assignments: {},
    improvements: {},
    requests: {},
    events: [],
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEvaluation(value) {
  if (!isObject(value)) return null;
  return {
    status: ['pass', 'warn', 'fail'].includes(value.status) ? value.status : 'warn',
    score: Number.isFinite(value.score) ? Number(value.score) : 0,
    // `checks` es la lista completa de comprobaciones de la compuerta, con su resultado individual.
    // Antes se descartaba al normalizar: el documento se leía bien, pero la primera escritura borraba
    // el detalle de por qué una versión pasó o no (medido en la auditoría de S4-B: 4 KB de la biblioteca
    // real). Es dato funcional del historial de calidad y se conserva.
    checks: list(value.checks)
      .filter((check) => isObject(check) && typeof check.code === 'string')
      .map((check) => ({
        code: check.code,
        ok: check.ok === true,
        severity: ['block', 'warn', 'info'].includes(check.severity) ? check.severity : 'warn',
        message: text(check.message),
      })),
    findings: list(value.findings)
      .filter((finding) => isObject(finding) && typeof finding.code === 'string')
      .map((finding) => ({
        code: finding.code,
        severity: ['block', 'warn', 'info'].includes(finding.severity) ? finding.severity : 'warn',
        message: text(finding.message),
      })),
    evaluatedAt: text(value.evaluatedAt),
  };
}

function normalizeVersion(raw) {
  if (!isObject(raw) || typeof raw.version !== 'string') return null;
  // Una versión sin número legible o sin cuerpo no se puede cargar ni comparar; conservarla sólo
  // serviría para que el panel ofreciera algo que falla al materializarse.
  if (parseVersion(raw.version) === null) return null;
  const body = text(raw.body);
  if (body.trim() === '') return null;
  const references = {};
  if (isObject(raw.references)) {
    for (const [path, content] of Object.entries(raw.references)) {
      if (typeof content === 'string' && path.startsWith('references/') && !path.includes('..')) references[path] = content;
    }
  }
  return {
    version: raw.version,
    description: text(raw.description),
    whenToUse: text(raw.whenToUse),
    tags: list(raw.tags).filter((tag) => typeof tag === 'string'),
    body,
    references,
    createdAt: text(raw.createdAt),
    checksum: text(raw.checksum),
    notes: text(raw.notes),
    evaluation: normalizeEvaluation(raw.evaluation),
  };
}

export function normalizeSkill(raw) {
  const versions = list(raw.versions).map(normalizeVersion).filter((version) => version !== null);
  const origin = isObject(raw.origin)
    ? {
      kind: ['ai', 'human', 'import', 'fork'].includes(raw.origin.kind) ? raw.origin.kind : 'human',
      from: typeof raw.origin.from === 'string' ? raw.origin.from : null,
      fromVersion: typeof raw.origin.fromVersion === 'string' ? raw.origin.fromVersion : null,
      note: text(raw.origin.note),
    }
    : { kind: 'human', from: null, fromVersion: null, note: '' };
  // R16.4 §C: procedencia de un paquete importado. Aditivo y condicional: una skill que no se importó no
  // gana claves (el round-trip de un centro viejo debe seguir siendo idéntico), y un valor con forma
  // inválida se descarta en vez de conservarse a medias.
  if (isObject(raw.origin)) {
    const bundleChecksum = typeof raw.origin.bundleChecksum === 'string' ? raw.origin.bundleChecksum.trim() : '';
    if (bundleChecksum !== '') origin.bundleChecksum = bundleChecksum;
    const originalSkillId = typeof raw.origin.originalSkillId === 'string' ? raw.origin.originalSkillId.trim() : '';
    if (originalSkillId !== '') origin.originalSkillId = originalSkillId;
    const originalVersion = typeof raw.origin.originalVersion === 'string' ? raw.origin.originalVersion.trim() : '';
    if (/^\d+\.\d+\.\d+$/.test(originalVersion)) origin.originalVersion = originalVersion;
    const importedAt = typeof raw.origin.importedAt === 'string' ? raw.origin.importedAt.trim() : '';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(importedAt)) origin.importedAt = importedAt;
  }
  return {
    id: text(raw.id),
    title: text(raw.title),
    description: text(raw.description),
    whenToUse: text(raw.whenToUse),
    tags: list(raw.tags).filter((tag) => typeof tag === 'string'),
    status: raw.status === 'deprecated' ? 'deprecated' : 'published',
    currentVersion: text(raw.currentVersion),
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
    origin,
    versions,
  };
}

/**
 * Campos de identidad de v3. Se copian **sólo si existen**: una entrada v2 no gana campos vacíos, porque
 * el hash de su propia representación cambiaría y una lectura se convertiría en una escritura.
 */
const PROJECT_IDENTITY_FIELDS = [
  'uuid',
  'manifestSha256',
  'manifestRegisteredAt',
  'adoptedAt',
  'detachedFrom',
  'detachedAt',
  'detachedSha256',
  'originalUuid',
  'forkedFrom',
  'forkOperationId',
  'forkedAt',
  'forkPreviousManifestSha256',
  'forkArchivedFile',
];

function normalizeProject(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  const project = {
    id: raw.id,
    name: text(raw.name, raw.id),
    cwd: text(raw.cwd),
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
    note: text(raw.note),
  };
  for (const field of PROJECT_IDENTITY_FIELDS) {
    if (typeof raw[field] === 'string' && raw[field] !== '') project[field] = raw[field];
  }
  return project;
}

function normalizeAssignment(raw) {
  if (!isObject(raw)) return null;
  const assignment = {
    enabled: raw.enabled === true,
    version: text(raw.version),
    updatedAt: text(raw.updatedAt),
    by: raw.by === 'ai' ? 'ai' : 'human',
  };
  // Campo de v2: el día en que se fijó la versión. Se conserva sólo cuando existe para que una
  // asignación v1 no gane un campo vacío que luego cambie el hash de su propia representación.
  if (typeof raw.pinnedAt === 'string') assignment.pinnedAt = raw.pinnedAt;
  return assignment;
}

/**
 * Normaliza lo leído del disco. **Nunca lanza**: un documento corrupto deja el centro vacío y un aviso,
 * porque una biblioteca ilegible no puede tumbar la carga de skills de todas las sesiones.
 */
export function normalizeState(raw) {
  const base = emptyState();
  if (!isObject(raw)) return base;
  const state = {
    // La versión del documento se conserva al leer: quien decide subirla es la migración.
    schemaVersion: Number.isInteger(raw.schemaVersion) && raw.schemaVersion >= MIN_SCHEMA_VERSION
      ? Math.min(raw.schemaVersion, MAX_SCHEMA_VERSION)
      : MIN_SCHEMA_VERSION,
    createdAt: text(raw.createdAt, base.createdAt),
    updatedAt: text(raw.updatedAt, base.createdAt),
    skills: {},
    projects: {},
    assignments: {},
    improvements: {},
    events: [],
  };
  if (isObject(raw.skills)) {
    for (const [id, skill] of Object.entries(raw.skills)) {
      if (!isObject(skill)) continue;
      if (typeof skill.id !== 'string' || skill.id === '') skill.id = id;
      const normalized = normalizeSkill(skill);
      if (!isSafeId(id) || normalized.versions.length === 0) continue;
      state.skills[id] = normalized;
    }
  }
  if (isObject(raw.projects)) {
    for (const [id, project] of Object.entries(raw.projects)) {
      const normalized = normalizeProject(isObject(project) ? { ...project, id: project.id ?? id } : null);
      if (normalized !== null) state.projects[normalized.id] = normalized;
    }
  }
  if (isObject(raw.assignments)) {
    for (const [projectId, entries] of Object.entries(raw.assignments)) {
      if (!isObject(entries)) continue;
      const row = {};
      for (const [skillId, assignment] of Object.entries(entries)) {
        const normalized = normalizeAssignment(assignment);
        if (normalized !== null) row[skillId] = normalized;
      }
      if (Object.keys(row).length > 0) state.assignments[projectId] = row;
    }
  }
  if (isObject(raw.improvements)) {
    for (const [id, improvement] of Object.entries(raw.improvements)) {
      if (!isObject(improvement) || typeof improvement.skillId !== 'string') continue;
      const status = ['proposed', 'approved', 'rejected'].includes(improvement.status) ? improvement.status : 'proposed';
      state.improvements[id] = {
        id,
        skillId: improvement.skillId,
        baseVersion: text(improvement.baseVersion),
        description: text(improvement.description),
        whenToUse: text(improvement.whenToUse),
        tags: list(improvement.tags).filter((tag) => typeof tag === 'string'),
        body: text(improvement.body),
        references: isObject(improvement.references) ? improvement.references : {},
        rationale: text(improvement.rationale),
        status,
        createdAt: text(improvement.createdAt),
        decidedAt: text(improvement.decidedAt),
        decidedBy: text(improvement.decidedBy),
        // La versión que publicó una propuesta aprobada: sin este campo el historial no puede decir
        // qué versión salió de qué propuesta (se perdía al recargar, no al aprobar).
        version: text(improvement.version),
        evaluation: normalizeEvaluation(improvement.evaluation),
      };
    }
  }
  state.events = list(raw.events)
    .filter((event) => isObject(event) && typeof event.type === 'string')
    .slice(-MAX_EVENTS)
    .map((event) => {
      const normalized = {
        id: text(event.id),
        at: text(event.at),
        type: event.type,
        skillId: text(event.skillId),
        projectId: text(event.projectId),
        version: text(event.version),
        // `system` no es una persona ni el modelo: es el harness pidiendo el catálogo. Colapsarlo a
        // `human` falseaba la telemetría (una carga aparecía como acto de una persona).
        actor: event.actor === 'ai' || event.actor === 'system' ? event.actor : 'human',
        note: text(event.note),
      };
      // R16.4 §C/G4: la traza de una importación vive también en el diario. Se conservan los campos de
      // auditoría sólo cuando existen (un evento viejo round-trip idéntico, sin claves nuevas).
      if (event.code === 'skill-imported') {
        const code = text(event.code);
        if (code !== '') normalized.code = code;
        const checksum = text(event.checksum);
        if (checksum !== '') normalized.checksum = checksum;
        if (typeof event.renamed === 'boolean') normalized.renamed = event.renamed;
        const renamedFrom = event.renamedFrom;
        if (typeof renamedFrom === 'string' && renamedFrom !== '') normalized.renamedFrom = renamedFrom;
        else if (renamedFrom === null) normalized.renamedFrom = null;
        const originalSkillId = text(event.originalSkillId);
        if (originalSkillId !== '') normalized.originalSkillId = originalSkillId;
        const from = event.from;
        if (typeof from === 'string' && from !== '') normalized.from = from;
        else if (from === null) normalized.from = null;
        const originalVersion = text(event.originalVersion);
        if (/^\d+\.\d+\.\d+$/.test(originalVersion)) normalized.originalVersion = originalVersion;
      }
      // R17: la atribución y los deltas del Activity Center también sobreviven a la recarga. Sólo se
      // copian las claves que existen: un evento viejo se relee exactamente igual.
      preserveActivityFields(event, normalized);
      return normalized;
    });
  // Metadatos de la migración (sólo existen en v2). Si no se conservan, la siguiente lectura del
  // documento los borraría al guardar y el historial de esquema se perdería sin avisar.
  // Peticiones humanas a la IA: la persona describe la necesidad y el agente la cumple. Se conservan
  // porque son trabajo pendiente: perderlas al recargar dejaría a alguien esperando para siempre.
  if (isObject(raw.requests)) {
    const requests = {};
    for (const [id, entry] of Object.entries(raw.requests)) {
      if (!isObject(entry) || typeof id !== 'string' || id === '') continue;
      const status = ['pending', 'fulfilled', 'dismissed'].includes(entry.status) ? entry.status : 'pending';
      requests[id] = {
        id,
        text: text(entry.text),
        createdAt: text(entry.createdAt),
        status,
        skillId: text(entry.skillId),
        fulfilledAt: text(entry.fulfilledAt),
        by: text(entry.by),
        note: text(entry.note),
      };
    }
    if (Object.keys(requests).length > 0) state.requests = requests;
  }
  // Comprobantes durables de operación (v3): sin ellos, la idempotencia dependería de encontrar un
  // evento en un diario que se compacta, y una reparación interrumpida podría registrarse dos veces.
  if (isObject(raw.operations)) {
    const operations = {};
    for (const [operationId, entry] of Object.entries(raw.operations)) {
      if (!isObject(entry) || typeof operationId !== 'string' || operationId === '') continue;
      const status = entry.status === 'registered' ? 'registered' : 'pending';
      const kind = typeof entry.kind === 'string' ? entry.kind : '';
      operations[operationId] = {
        kind,
        uuid: text(entry.uuid),
        targetSha256: text(entry.targetSha256),
        registeredAt: text(entry.registeredAt),
        status,
      };
    }
    if (Object.keys(operations).length > 0) state.operations = operations;
  }
  if (isObject(raw.schemaMeta) && Number.isInteger(raw.schemaMeta.migratedFrom)) {
    state.schemaMeta = {
      migratedFrom: raw.schemaMeta.migratedFrom,
      migratedAt: text(raw.schemaMeta.migratedAt),
    };
  }
  return state;
}

/**
 * Integridad del documento. Un centro puede estar en cinco estados, y sólo dos permiten escribir:
 *
 * - `ok`: JSON válido y con la estructura del esquema que este código sabe leer.
 * - `missing`: no hay fichero. Se puede crear el primero con una operación legítima.
 * - `unreadable`: hay fichero y no es JSON válido. **No se toca**: se conserva y se avisa.
 * - `invalid-shape`: es JSON válido pero no tiene la forma del almacén (`{}`, `[]`, `{"skills":"x"}`…).
 * - `future-version`: lo escribió una versión más nueva. No se degrada ni se migra aquí.
 *
 * La tolerancia de `normalizeState` sirve para leer sin tumbar la sesión, **no** para autorizar una
 * escritura: usar un estado normalizado vacío como si fuera la biblioteca real borraba los datos
 * (medido en la auditoría LSC-007: 913 B → 204 B).
 */
export const INTEGRITY_OK = 'ok';
export const INTEGRITY_MISSING = 'missing';
export const INTEGRITY_UNREADABLE = 'unreadable';
export const INTEGRITY_INVALID_SHAPE = 'invalid-shape';
export const INTEGRITY_FUTURE_VERSION = 'future-version';

/** Las cinco colecciones que cualquier `center.json` del esquema v1 tiene, con su tipo. */
const STORE_SHAPE = {
  skills: 'object',
  projects: 'object',
  assignments: 'object',
  improvements: 'object',
  events: 'array',
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256OfBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Clon profundo del JSON ya parseado: `normalizeState` escribe en los objetos que recibe. */
function cloneJson(value) {
  return structuredClone(value);
}

/**
 * ¿Qué se perdería al normalizar este documento?
 *
 * `normalizeState` tolera basura a propósito —una skill con una versión ilegible no puede tumbar la
 * sesión—, pero esa tolerancia **no** puede autorizar una escritura: guardar el resultado normalizado
 * borra lo descartado. La comprobación es de conservación: cada clave que entra tiene que salir.
 *
 * Devuelve una lista de motivos; vacía significa que normalizar no pierde nada.
 */
function normalizationLosses(parsed) {
  const before = cloneJson(parsed);
  const after = normalizeState(cloneJson(parsed));
  const losses = [];

  const skillsBefore = Object.entries(before.skills ?? {});
  for (const [id, skill] of skillsBefore) {
    if (!isPlainObject(skill)) {
      losses.push(`skills.${id} no es un objeto`);
      continue;
    }
    if (!isSafeId(id)) {
      losses.push(`skills.${id}: el id no es seguro`);
      continue;
    }
    const kept = after.skills[id];
    if (kept === undefined) {
      losses.push(`skills.${id} se descartaría al normalizar (sin versiones legibles)`);
      continue;
    }
    const versionsBefore = Array.isArray(skill.versions) ? skill.versions : [];
    if (versionsBefore.length !== kept.versions.length) {
      losses.push(`skills.${id}.versions: ${versionsBefore.length} entradas, sólo ${kept.versions.length} legibles`);
    }
    for (const [index, version] of versionsBefore.entries()) {
      if (!isPlainObject(version)) {
        losses.push(`skills.${id}.versions[${index}] no es un objeto`);
        continue;
      }
      if (kept.versions[index] === undefined) continue;
      const evaluationBefore = version.evaluation;
      const evaluationAfter = kept.versions[index].evaluation ?? null;
      if (isPlainObject(evaluationBefore)) {
        const checksBefore = Array.isArray(evaluationBefore.checks) ? evaluationBefore.checks : [];
        const checksAfter = Array.isArray(evaluationAfter?.checks) ? evaluationAfter.checks : [];
        if (checksBefore.length !== checksAfter.length) {
          losses.push(`skills.${id}.versions[${index}].evaluation.checks: ${checksBefore.length} entradas, ${checksAfter.length} conservadas`);
        }
        const findingsBefore = Array.isArray(evaluationBefore.findings) ? evaluationBefore.findings : [];
        const findingsAfter = Array.isArray(evaluationAfter?.findings) ? evaluationAfter.findings : [];
        if (findingsBefore.length !== findingsAfter.length) {
          losses.push(`skills.${id}.versions[${index}].evaluation.findings: ${findingsBefore.length} entradas, ${findingsAfter.length} conservadas`);
        }
      }
      if (isPlainObject(version.references)) {
        const keptReferences = kept.versions[index].references ?? {};
        for (const [path, content] of Object.entries(version.references)) {
          if (typeof content !== 'string' || !path.startsWith('references/') || path.includes('..')) {
            losses.push(`skills.${id}.versions[${index}].references["${path}"] se descartaría`);
            continue;
          }
          if (keptReferences[path] !== content) {
            losses.push(`skills.${id}.versions[${index}].references["${path}"] no sobrevive igual`);
          }
        }
      }
    }
  }

  const projectsBefore = Object.entries(before.projects ?? {});
  for (const [id, project] of projectsBefore) {
    const normalized = normalizeProject(isPlainObject(project) ? { ...cloneJson(project), id: project.id ?? id } : null);
    if (normalized === null) {
      losses.push(`projects.${id} se descartaría al normalizar`);
      continue;
    }
    if (after.projects[normalized.id] === undefined) losses.push(`projects.${id} no sobrevive`);
  }

  for (const [projectId, entries] of Object.entries(before.assignments ?? {})) {
    if (!isPlainObject(entries)) {
      losses.push(`assignments.${projectId} no es un mapa`);
      continue;
    }
    for (const [skillId, assignment] of Object.entries(entries)) {
      if (normalizeAssignment(assignment) === null) {
        losses.push(`assignments.${projectId}.${skillId} se descartaría`);
        continue;
      }
      if (after.assignments[projectId]?.[skillId] === undefined) {
        losses.push(`assignments.${projectId}.${skillId} no sobrevive`);
        continue;
      }
      // v2 añade `pinnedAt`: si la normalización lo tirara, el documento parecería sano y perdería el
      // campo en la siguiente escritura (mismo fallo de clase que `improvement.version`).
      if (typeof assignment?.pinnedAt === 'string' && after.assignments[projectId][skillId].pinnedAt !== assignment.pinnedAt) {
        losses.push(`assignments.${projectId}.${skillId}.pinnedAt no sobrevive`);
      }
    }
  }

  if (isPlainObject(before.schemaMeta) && !isPlainObject(after.schemaMeta)) {
    losses.push('schemaMeta no sobrevive a la normalización');
  }
  if (isPlainObject(before.operations)) {
    if (!isPlainObject(after.operations)) losses.push('operations no sobrevive a la normalización');
    else {
      for (const operationId of Object.keys(before.operations)) {
        if (after.operations[operationId] === undefined) losses.push(`operations.${operationId} no sobrevive`);
      }
    }
  }
  for (const [id, project] of Object.entries(before.projects ?? {})) {
    if (!isPlainObject(project)) continue;
    for (const field of PROJECT_IDENTITY_FIELDS) {
      if (typeof project[field] === 'string' && after.projects[id]?.[field] !== project[field]) {
        losses.push(`projects.${id}.${field} no sobrevive`);
      }
    }
  }

  for (const [id, improvement] of Object.entries(before.improvements ?? {})) {
    if (!isPlainObject(improvement) || typeof improvement.skillId !== 'string') {
      losses.push(`improvements.${id} se descartaría al normalizar`);
      continue;
    }
    if (after.improvements[id] === undefined) losses.push(`improvements.${id} no sobrevive`);
  }

  const eventsBefore = Array.isArray(before.events) ? before.events : [];
  const usableEvents = eventsBefore.filter((event) => isPlainObject(event) && typeof event.type === 'string');
  if (usableEvents.length !== eventsBefore.length) {
    losses.push(`events: ${eventsBefore.length - usableEvents.length} entradas se descartarían`);
  }
  if (usableEvents.length > MAX_EVENTS) {
    // Recortar el diario al guardar sería perder historia sin decirlo: se trata como documento inválido
    // para que una persona decida compactar explícitamente (la compactación es S5).
    losses.push(`events: ${usableEvents.length} supera el tope de ${MAX_EVENTS} y se recortaría`);
  }
  if (after.events.length !== Math.min(usableEvents.length, MAX_EVENTS)) {
    losses.push('events no sobreviven en el mismo número');
  }
  for (const [id, entry] of Object.entries(parsed.requests ?? {})) {
    if (!isPlainObject(entry)) {
      losses.push(`requests.${id} no es un objeto`);
      continue;
    }
    if (typeof entry.text !== 'string' || entry.text.trim() === '') losses.push(`requests.${id} sin texto`);
  }

  return losses;
}

/**
 * ¿Es este documento un almacén que sabemos leer, y que podemos volver a escribir sin perder nada?
 *
 * Se exige el objeto raíz, las cinco colecciones con su tipo y que la normalización sea **conservadora**:
 * `{}` o `{"skills":"x"}` no son «un centro vacío», son un documento que no es nuestro. Y un documento
 * con una skill a la que le falta la mitad tampoco: normalizarlo la borraría.
 */
export function checkStoreShape(parsed) {
  if (!isPlainObject(parsed)) return { ok: false, reason: 'el documento raíz no es un objeto JSON' };
  for (const [key, kind] of Object.entries(STORE_SHAPE)) {
    const value = parsed[key];
    if (value === undefined) return { ok: false, reason: `falta la colección "${key}"` };
    if (kind === 'array' && !Array.isArray(value)) return { ok: false, reason: `"${key}" debería ser una lista` };
    if (kind === 'object' && !isPlainObject(value)) return { ok: false, reason: `"${key}" debería ser un mapa` };
  }
  const version = parsed.schemaVersion;
  if (version === undefined) {
    return { ok: false, reason: 'falta "schemaVersion": es obligatorio para saber qué esquema se está leyendo' };
  }
  if (!Number.isInteger(version) || version < MIN_SCHEMA_VERSION) {
    return { ok: false, reason: `"schemaVersion" no es un entero entre ${MIN_SCHEMA_VERSION} y ${MAX_SCHEMA_VERSION}` };
  }
  if (version > MAX_SCHEMA_VERSION) {
    // Un centro más nuevo no se degrada ni se migra aquí: se lee en sólo lectura y avisa.
    return { ok: false, future: true, reason: `el documento es de la versión ${version} y este código lee hasta la ${MAX_SCHEMA_VERSION}` };
  }
  if (parsed.operations !== undefined && !isPlainObject(parsed.operations)) {
    return { ok: false, reason: '"operations" debería ser un mapa de comprobantes' };
  }
  const losses = normalizationLosses(parsed);
  if (losses.length > 0) {
    return { ok: false, reason: `normalizar el documento perdería información: ${losses.slice(0, 4).join('; ')}${losses.length > 4 ? ` (+${losses.length - 4})` : ''}`, losses };
  }
  return { ok: true };
}

/**
 * Lee el documento **sin modificarlo**.
 *
 * Devuelve siempre el estado normalizado para poder pintar algo, pero `integrity` manda: quien vaya a
 * escribir tiene que mirarlo. `sha256` y `size` se calculan sobre los **bytes originales**, no sobre una
 * reserialización, porque son la huella con la que se verifica una preservación o una restauración.
 */
export function loadState(root = defaultRoot()) {
  const file = centerFile(root);
  let bytes = null;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ok: true,
        integrity: INTEGRITY_MISSING,
        path: file,
        state: emptyState(),
        error: null,
        exists: false,
        sha256: null,
        size: 0,
      };
    }
    return {
      ok: false,
      integrity: INTEGRITY_UNREADABLE,
      path: file,
      state: emptyState(),
      error: String(error?.message ?? error),
      exists: true,
      sha256: null,
      size: 0,
    };
  }

  const sha256 = sha256OfBytes(bytes);
  const size = bytes.length;
  const base = { path: file, exists: true, sha256, size };
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return { ok: false, integrity: INTEGRITY_UNREADABLE, state: emptyState(), error: String(error?.message ?? error), ...base };
  }
  const shape = checkStoreShape(parsed);
  if (!shape.ok) {
    return {
      ok: false,
      integrity: shape.future === true ? INTEGRITY_FUTURE_VERSION : INTEGRITY_INVALID_SHAPE,
      state: emptyState(),
      error: shape.reason,
      ...base,
    };
  }
  return { ok: true, integrity: INTEGRITY_OK, state: normalizeState(parsed), error: null, ...base };
}

/** ¿Se puede escribir sobre este documento? Sólo si está sano o si todavía no existe. */
export function canWrite(integrity) {
  return integrity === INTEGRITY_OK || integrity === INTEGRITY_MISSING;
}

/**
 * Escritura atómica: se escribe al lado y se renombra encima.
 *
 * En Windows, renombrar sobre un fichero que otro proceso está leyendo puede fallar con `EPERM`
 * durante unos milisegundos (lo midió la auditoría con dos escritores). Se reintenta, porque el
 * candado de `withState` ya serializa lo nuestro y esto cubre a quien lea por fuera.
 */
export function saveState(root, state, { now = new Date().toISOString() } = {}) {
  const file = centerFile(root);
  mkdirSync(dirname(file), { recursive: true });
  // No se fuerza la versión: un guardado normal de un documento v1 lo deja v1. Subir a v2 es una
  // migración explícita y verificada, no un efecto secundario de escribir.
  if (!Number.isInteger(state.schemaVersion)) state.schemaVersion = MIN_SCHEMA_VERSION;
  state.updatedAt = now;
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameWithRetry(tmp, file);
  return file;
}

const LOCK_WAIT_MS = 4000;
const LOCK_RETRY_MS = 12;
const LOCK_STALE_MS = 20000;
const RENAME_RETRY_MS = 15;

function lockFile(root) {
  return `${centerFile(root)}.lock`;
}

/**
 * Estado del candado **sin tomarlo**: una precondición necesita saber si hay otro escritor vivo antes de
 * decidir, y tomarlo para averiguarlo sería justo lo que no se puede hacer en ese momento.
 *
 * Un candado más viejo que `LOCK_STALE_MS` se considera abandonado (es lo mismo que hace `acquireLock`
 * al retirarlo); informarlo como vivo bloquearía el panel para siempre tras un corte.
 */
export function inspectLock(root = defaultRoot()) {
  const file = lockFile(root);
  let stats;
  try {
    stats = statSync(file);
  } catch {
    return { present: false, stale: false, ageMs: null, path: file };
  }
  // La caducidad se mide contra el reloj real, nunca contra un `now` lógico inyectado: un reloj de pruebas
  // en el futuro haría parecer abandonado un candado vivo y dejaría migrar con otro escritor dentro.
  const ageMs = Date.now() - stats.mtimeMs;
  return {
    present: true,
    stale: ageMs > LOCK_STALE_MS,
    ageMs,
    path: file,
  };
}

/** Espera síncrona sin dependencias: el núcleo es síncrono a propósito y cada acción es corta. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(tmp, file, rename = renameSync) {
  let last = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rename(tmp, file);
      return;
    } catch (error) {
      last = error;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
      sleepSync(RENAME_RETRY_MS);
    }
  }
  throw last;
}

/**
 * Candado del documento, para que dos escritores no se pisen.
 *
 * Sin esto, dos procesos que leen-mutan-escriben a la vez producen **pérdida de escrituras**: el
 * último guarda su copia y borra lo que el otro acababa de añadir (medido: 50 proyectos en 50
 * aperturas concurrentes, sólo 31 sobrevivieron). El candado es un fichero `wx`; uno huérfano de un
 * proceso muerto se retira por antigüedad, no se espera indefinidamente.
 */
function acquireLock(root) {
  const file = lockFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = openSync(file, 'wx');
      try {
        writeFileSync(handle, `${process.pid}\n`, 'utf8');
      } finally {
        closeSync(handle);
      }
      return () => {
        try {
          rmSync(file, { force: true });
        } catch {
          // si no se puede borrar, el siguiente lo verá viejo y lo retirará
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) rmSync(file, { force: true });
      } catch {
        // el candado desapareció entre la comprobación y el borrado: se reintenta
      }
      if (Date.now() > deadline) throw new Error(`el centro está ocupado: no se pudo tomar el candado en ${LOCK_WAIT_MS} ms`);
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

/**
 * Campos que NO cuentan como cambio funcional.
 *
 * `updatedAt` es un sello de escritura, no un dato del producto: si se incluyera en la firma, cualquier
 * guardado parecería un cambio y la detección de no-ops no serviría de nada. La lista es deliberadamente
 * corta: todo lo demás (eventos, asignaciones, versiones, referencias, proyectos) es funcional y entra.
 */
/**
 * Sellos **no funcionales**, por ruta explícita.
 *
 * Antes se excluía cualquier campo llamado `updatedAt` a cualquier profundidad. Eso funciona hoy, pero
 * es una regla por nombre: una entidad futura con su propio `updatedAt` funcional habría quedado fuera de
 * la firma y sus cambios no se habrían guardado nunca. Ahora se excluye sólo la ruta raíz documentada
 * (`updatedAt`, el sello de escritura del documento). Cualquier otro sello, a cualquier nivel, es
 * funcional y entra en la firma: `createdAt`, `decidedAt`, `events[].at`, `versions[].createdAt`…
 */
const NON_FUNCTIONAL_PATHS = new Set(['updatedAt']);

/** Serializa un valor de forma canónica: claves ordenadas, orden de arrays intacto, rutas explícitas. */
function canonicalValue(value, path = '') {
  if (Array.isArray(value)) return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const childPath = path === '' ? key : `${path}.${key}`;
      if (NON_FUNCTIONAL_PATHS.has(childPath)) continue;
      out[key] = canonicalValue(value[key], childPath);
    }
    return out;
  }
  return value;
}

/**
 * Firma canónica del estado **funcional**.
 *
 * Sirve para una sola cosa: decidir si una mutación cambió algo de verdad. Ordena claves (para que dos
 * documentos equivalentes den la misma firma), conserva el orden de los arrays (que sí es semántico:
 * el diario es una secuencia) y deja fuera sólo los sellos de tiempo.
 */
export function functionalSignature(state) {
  return JSON.stringify(canonicalValue(state ?? {}));
}

/**
 * Lee, deja mutar y guarda **bajo candado**. Si la mutación lanza, no se guarda nada: media operación
 * escrita es peor que ninguna, y el error viaja a quien llamó.
 *
 * Si la mutación no cambia nada funcional, **no se escribe**: se devuelve `saved: false`. Sin esto, una
 * lectura del catálogo reescribía el documento cada vez que el harness pedía las skills (T13): el
 * `updatedAt` cambiaba, el vigilante se despertaba y el SHA-256 del almacén se movía sin motivo.
 * La comparación se hace **dentro del candado**, con el estado que se acaba de leer y después de mutar:
 * comprobar antes sería una carrera entre dos procesos que leen lo mismo.
 */
export function withState(root = defaultRoot(), mutate, { now } = {}) {
  const stamp = now ?? new Date().toISOString();
  const release = acquireLock(root);
  // R17: las opciones nuevas se leen del mismo objeto sin cambiar la firma que audita el catálogo de
  // mutantes (`j-lock-removed` declara textualmente la apertura con `{ now }`).
  const options = arguments.length > 2 && arguments[2] !== null && typeof arguments[2] === 'object' ? arguments[2] : {};
  const eventDefaults = options.eventDefaults ?? null;
  const operationId = text(options.operationId);
  const operationKind = text(options.operationKind);
  try {
    const loaded = loadState(root);
    // La puerta va **dentro** del candado: si se comprobara antes, dos procesos podrían ver un almacén
    // sano y uno de ellos encontrarlo roto al escribir (o al revés). Aquí no hay carrera posible.
    if (!canWrite(loaded.integrity)) {
      return {
        ok: false,
        code: 'store-unreadable',
        integrity: loaded.integrity,
        path: loaded.path,
        sha256: loaded.sha256,
        size: loaded.size,
        error: loaded.error,
        saved: false,
        state: loaded.state,
        storeError: loaded.error,
        appended: [],
      };
    }
    const events = Array.isArray(loaded.state.events) ? loaded.state.events : [];
    const lastIdBefore = events.length > 0 ? text(events[events.length - 1]?.id) : '';
    const before = functionalSignature(loaded.state);
    const result = mutate(loaded.state, { now: stamp, loaded });
    // R17/R6: el recibo de la operación hace idempotente el reintento. Se registra sólo si la mutación
    // salió bien y antes de firmar el documento, para que también cuente como cambio persistido.
    if (text(operationId) !== '' && result !== null && typeof result === 'object' && result.ok === true) {
      recordOperation(loaded.state, text(operationId), {
        kind: text(operationKind) !== '' ? text(operationKind) : 'activity',
        registeredAt: stamp,
      });
    }
    const after = functionalSignature(loaded.state);
    if (before === after) {
      return { ok: true, saved: false, result, state: loaded.state, storeError: null, integrity: loaded.integrity, appended: [] };
    }
    // Antes de reemplazar el documento se asegura una copia verificada del que hay en disco. Si no se
    // puede copiar, no se escribe: quedarse sin respaldo es peor que no guardar este cambio.
    const backup = ensureBackup(root, { now: stamp, reason: 'mutation' });
    if (!backup.ok) {
      return {
        ok: false,
        code: 'backup-failed',
        saved: false,
        message: `no se pudo asegurar una copia antes de escribir: ${backup.message ?? backup.code}`,
        integrity: loaded.integrity,
        state: loaded.state,
        storeError: loaded.error,
        appended: [],
      };
    }
    const appended = (() => {
      const current = Array.isArray(loaded.state.events) ? loaded.state.events : [];
      const index = lastIdBefore === '' ? -1 : current.findIndex((event) => text(event?.id) === lastIdBefore);
      return index === -1 ? current.slice() : current.slice(index + 1);
    })();
    // Los valores por defecto de actividad los aporta quien abre la transacción (canal, operación): se
    // aplican sólo a los eventos nuevos y nunca pisan lo que el dominio ya escribió.
    if (isObject(eventDefaults)) {
      for (const event of appended) {
        if (isObject(event) === false) continue;
        if (event.channel === undefined && text(eventDefaults.channel) !== '') event.channel = text(eventDefaults.channel);
        if (event.operationId === undefined && text(eventDefaults.operationId) !== '') event.operationId = text(eventDefaults.operationId);
      }
    }
    saveState(root, loaded.state, { now: stamp });
    return { ok: true, saved: true, result, state: loaded.state, storeError: null, integrity: loaded.integrity, backup: { created: backup.created === true, sha256: backup.sha256 ?? null }, appended };
  } finally {
    release();
  }
}

/** Copia binaria del documento actual, sin renombrarlo ni tocarlo: `center.json.corrupt-<marca>`. */
export function archiveCorruptStore(root = defaultRoot(), { now = new Date().toISOString(), prefix = 'corrupt' } = {}) {
  const loaded = loadState(root);
  if (loaded.exists !== true) return { ok: false, code: 'nothing-to-preserve', message: 'no hay documento que conservar' };
  const source = readFileSync(loaded.path);
  const stamp = String(now).replace(/[^0-9A-Za-z]/g, '').slice(0, 17);
  const label = prefix === 'corrupt' ? 'corrupt' : 'replaced';
  let archivedAs = join(dirname(loaded.path), `center.json.${label}-${stamp}`);
  let suffix = 0;
  // `wx` es exclusivo: nunca pisa una preservación anterior. Si el nombre ya existe, se numera.
  for (;;) {
    try {
      writeFileSync(archivedAs, source, { flag: 'wx' });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return { ok: false, code: 'archive-failed', message: String(error?.message ?? error) };
      }
      suffix += 1;
      archivedAs = join(dirname(loaded.path), `center.json.${label}-${stamp}-${suffix}`);
    }
  }
  const written = readFileSync(archivedAs);
  const sha256 = sha256OfBytes(written);
  if (sha256 !== loaded.sha256 || written.length !== source.length) {
    return { ok: false, code: 'archive-mismatch', message: 'la copia conservada no coincide con el original', archivedAs };
  }
  return { ok: true, archivedAs, sha256, size: written.length };
}

/**
 * Restauración **humana y explícita** de un documento.
 *
 * Orden obligatorio: comprobar el origen (hash y forma) → preservar el original ilegible → sólo entonces
 * instalarlo de forma atómica → releerlo y exigir `integrity: ok`. Si la preservación falla, se aborta
 * sin tocar `center.json`: quedarse sin copia sería cambiar un problema por otro.
 */
/**
 * `archive` se puede inyectar: la prueba del camino «la preservación falla» necesita forzar ese fallo
 * sin depender de permisos del sistema de ficheros (en Windows un directorio de solo lectura no lo es).
 */
export function restoreStore(root = defaultRoot(), { sourcePath = '', expectedSha256 = '', now = new Date().toISOString(), archive = archiveCorruptStore } = {}) {
  const wanted = String(sourcePath ?? '').trim();
  if (wanted === '') return { ok: false, code: 'missing-source', message: 'falta el archivo de origen' };
  let source;
  try {
    source = readFileSync(wanted);
  } catch (error) {
    return { ok: false, code: 'unreadable-source', message: `no se pudo leer el origen: ${String(error?.message ?? error)}` };
  }
  const sha256 = sha256OfBytes(source);
  const expected = String(expectedSha256 ?? '').trim().toLowerCase();
  if (expected !== '' && expected !== sha256) {
    return { ok: false, code: 'hash-mismatch', message: `el origen no coincide con el hash esperado (${sha256})`, sha256 };
  }
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch (error) {
    return { ok: false, code: 'invalid-source', message: `el origen no es JSON válido: ${String(error?.message ?? error)}` };
  }
  const shape = checkStoreShape(parsed);
  if (!shape.ok) return { ok: false, code: 'invalid-source', message: `el origen no es un almacén legible: ${shape.reason}` };

  const release = acquireLock(root);
  try {
    const current = loadState(root);
    let archived = null;
    // Se conserva lo que se va a reemplazar siempre que sus bytes no sean ya los del origen: si el
    // documento actual es válido pero distinto (por ejemplo, un v2 que quedó a medias), también merece
    // una copia, no sólo cuando está corrupto.
    if (current.exists === true && current.sha256 !== sha256) {
      const preserved = archive(root, { now, prefix: canWrite(current.integrity) ? 'replaced' : 'corrupt' });
      if (!preserved.ok) {
        return { ok: false, code: 'archive-failed', message: `no se pudo preservar el original: ${preserved.message}` };
      }
      archived = preserved;
    }
    const file = centerFile(root);
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, source);
    renameWithRetry(tmp, file);
    const after = loadState(root);
    if (after.integrity !== INTEGRITY_OK) {
      return { ok: false, code: 'restore-unverified', message: 'el documento restaurado no se relee como válido', integrity: after.integrity };
    }
    return {
      ok: true,
      restoredFrom: wanted,
      sha256: after.sha256,
      archivedAs: archived === null ? null : archived.archivedAs,
      preservedSha256: archived === null ? null : archived.sha256,
      previousIntegrity: current.integrity,
    };
  } finally {
    release();
  }
}

/* ------------------------------------------------------------------------------------------------
 * Copias de seguridad
 *
 * Contrato:
 * - Sólo se copia un documento con `integrity: ok`: una copia de algo ilegible no es recuperable.
 * - La copia son los **bytes originales**, no una reserialización.
 * - `center.json.bak` es la copia buena más reciente; `center.json.bak.sha256` su huella verificable.
 * - En `backups/` se guarda una copia por día, con retención limitada (`BACKUP_HISTORY = 7`).
 * - Antes de reemplazar una copia válida se verifica la nueva: si no coincide byte a byte con el
 *   original, no se publica.
 * ---------------------------------------------------------------------------------------------- */

/** Copia de compatibilidad (legado). No es la fuente de verdad: el puntero lo es. */
export function backupFile(root = defaultRoot()) {
  return `${centerFile(root)}.bak`;
}

/** Huella de la copia de compatibilidad. Se mantiene por legado; la autoridad es el puntero. */
export function backupMetaFile(root = defaultRoot()) {
  return `${backupFile(root)}.bak.sha256`;
}

/** Directorio del historial de compatibilidad (ya no se escribe: la historia son las generaciones). */
export function backupHistoryDir(root = defaultRoot()) {
  return join(dirname(centerFile(root)), 'backups');
}

/** Puntero autoritativo: un único fichero que se publica con un solo rename. */
export function backupPointerFile(root = defaultRoot()) {
  return `${centerFile(root)}.backup.json`;
}

/** Directorio de generaciones inmutables. */
export function backupGenerationsDir(root = defaultRoot()) {
  return join(dirname(centerFile(root)), 'backups', 'generations');
}

/** Versión del contrato del puntero. */
export const BACKUP_POINTER_SCHEMA = 1;

/** Cuántas generaciones recientes se conservan (además de la referenciada y la anterior). */
const BACKUP_HISTORY = 7;

/** Ventana mínima de antigüedad para limpiar temporales huérfanos: nunca se toca algo reciente. */
const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;

const GENERATION_PATTERN = /^g-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}(?:-[0-9]+)?$/;
const RELATIVE_GENERATION_PATTERN = /^backups\/generations\/[A-Za-z0-9._-]+\.json$/;

function dayOf(now) {
  return String(now).slice(0, 10);
}

function stampOf(now) {
  return String(now).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** Nombre de la generación: estable, ordenable y con la huella del contenido. */
function generationName(now, sha256, taken) {
  const base = `g-${stampOf(now)}-${sha256.slice(0, 8)}`;
  let candidate = base;
  let index = 1;
  while (taken.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function syncFile(path) {
  // fsync sobre el descriptor: es la primitiva que Node ofrece para empujar los bytes al disco.
  const fd = openSync(path, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Comprueba que el fichero de una generación está **dentro** del directorio autorizado y es un fichero
 * normal (no un enlace ni un punto de reparse). Devuelve la ruta absoluta o un motivo de rechazo.
 */
function resolveGeneration(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '') return { ok: false, reason: 'el puntero no nombra ningún fichero' };
  if (relativePath.includes('\0')) return { ok: false, reason: 'la ruta contiene un byte nulo' };
  const normalized = relativePath.replace(/\\/g, '/');
  if (isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) return { ok: false, reason: 'la ruta es absoluta' };
  if (!RELATIVE_GENERATION_PATTERN.test(normalized)) return { ok: false, reason: 'la ruta no es una generación del directorio autorizado' };
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.' || segment === '')) {
    return { ok: false, reason: 'la ruta intenta salir del directorio de generaciones' };
  }
  const base = backupGenerationsDir(root);
  const absolute = join(root, normalized);
  const within = relative(base, absolute);
  if (within === '' || within.startsWith('..') || isAbsolute(within)) {
    return { ok: false, reason: 'la ruta queda fuera del directorio de generaciones' };
  }
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch {
    return { ok: false, code: 'generation-missing', reason: 'la generación no existe' };
  }
  if (stats.isSymbolicLink()) return { ok: false, reason: 'la generación es un enlace simbólico' };
  if (!stats.isFile()) return { ok: false, code: 'generation-missing', reason: 'la generación no es un fichero' };
  return { ok: true, path: absolute, relative: normalized, size: stats.size };
}

/** Lee y valida el puntero. No sigue enlaces ni acepta rutas fuera del directorio autorizado. */
export function readBackupPointer(root = defaultRoot()) {
  const path = backupPointerFile(root);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, code: 'missing', path };
  }
  let pointer;
  try {
    pointer = JSON.parse(raw);
  } catch (error) {
    return { ok: false, code: 'pointer-invalid', path, message: `el puntero no es JSON: ${String(error?.message ?? error)}` };
  }
  if (!isObject(pointer)) return { ok: false, code: 'pointer-invalid', path, message: 'el puntero no es un objeto' };
  if (pointer.schema !== BACKUP_POINTER_SCHEMA) return { ok: false, code: 'pointer-invalid', path, message: 'el puntero es de otro esquema' };
  if (typeof pointer.generation !== 'string' || !GENERATION_PATTERN.test(pointer.generation)) {
    return { ok: false, code: 'pointer-invalid', path, message: 'el identificador de generación no es válido' };
  }
  if (typeof pointer.file !== 'string' || basename(pointer.file.replace(/\\/g, '/')) !== `${pointer.generation}.json`) {
    return { ok: false, code: 'pointer-invalid', path, message: 'el fichero del puntero no corresponde a su generación' };
  }
  if (typeof pointer.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pointer.sha256)) {
    return { ok: false, code: 'pointer-invalid', path, message: 'la huella del puntero no es válida' };
  }
  if (!Number.isInteger(pointer.size) || pointer.size <= 0) {
    return { ok: false, code: 'pointer-invalid', path, message: 'el tamaño del puntero no es válido' };
  }
  if (typeof pointer.createdAt !== 'string' || Number.isNaN(Date.parse(pointer.createdAt))) {
    return { ok: false, code: 'pointer-invalid', path, message: 'la fecha del puntero no es válida' };
  }
  if (typeof pointer.reason !== 'string') return { ok: false, code: 'pointer-invalid', path, message: 'el motivo del puntero no es válido' };
  const resolved = resolveGeneration(root, pointer.file);
  if (!resolved.ok) return { ok: false, code: resolved.code ?? 'pointer-invalid', path, message: resolved.reason };
  return { ok: true, path, pointer, generationPath: resolved.path, generationSize: resolved.size };
}

/** Lee la huella de la copia de compatibilidad. `null` si no hay o no se puede leer. */
export function readBackupMeta(root = defaultRoot()) {
  try {
    const raw = readFileSync(backupMetaFile(root), 'utf8').trim().split(/\s+/);
    const [sha256, size, createdAt, source] = raw;
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
    return { sha256, size: Number(size) || 0, createdAt: createdAt ?? '', source: source ?? '' };
  } catch {
    return null;
  }
}

/** ¿La pareja antigua (copia + huella) es un par válido? Se usa sólo para legado. */
function legacyPair(root) {
  let bytes;
  try {
    bytes = readFileSync(backupFile(root));
  } catch {
    return null;
  }
  const meta = readBackupMeta(root);
  if (meta === null) return null;
  const sha256 = sha256OfBytes(bytes);
  if (meta.sha256 !== sha256 || (meta.size !== 0 && meta.size !== bytes.length)) return null;
  return { path: backupFile(root), sha256, size: bytes.length, createdAt: meta.createdAt, source: meta.source };
}

/**
 * ¿Hay una copia utilizable?
 *
 * Autoridad: el puntero. Si existe y verifica, `ok:true` con `generation`. Si existe y no verifica,
 * `ok:false` con el motivo (nunca se cae al par legado: eso lo promocionaría en silencio). Sólo cuando
 * **no hay puntero** se mira la pareja antigua, que se devuelve como `legacy-copy`.
 */
export function verifyBackup(root = defaultRoot()) {
  const pointer = readBackupPointer(root);
  if (pointer.ok) {
    const bytes = readFileSync(pointer.generationPath);
    const sha256 = sha256OfBytes(bytes);
    if (sha256 !== pointer.pointer.sha256 || bytes.length !== pointer.pointer.size) {
      return { ok: false, code: 'hash-mismatch', path: pointer.generationPath, sha256, size: bytes.length, generation: pointer.pointer.generation, message: 'la generación no coincide con su puntero' };
    }
    return {
      ok: true,
      path: pointer.generationPath,
      sha256,
      size: bytes.length,
      generation: pointer.pointer.generation,
      createdAt: pointer.pointer.createdAt,
      source: pointer.pointer.reason,
      pointerPath: pointer.path,
    };
  }
  if (pointer.code === 'missing') {
    const legacy = legacyPair(root);
    if (legacy !== null) {
      return { ok: false, code: 'legacy-copy', path: legacy.path, sha256: legacy.sha256, size: legacy.size, createdAt: legacy.createdAt, source: legacy.source, message: 'hay una copia antigua válida, pero no es la fuente de verdad: restaurarla exige confirmar su SHA-256' };
    }
    return { ok: false, code: 'missing', path: backupPointerFile(root) };
  }
  return { ok: false, code: pointer.code ?? 'pointer-invalid', path: pointer.path, message: pointer.message ?? 'el puntero no es válido' };
}

/** Poda conservadora: nunca la referenciada, nunca la anterior, como mucho `keep` recientes. */
function pruneGenerations(root, { keep = BACKUP_HISTORY, protectedFiles = [] } = {}) {
  const dir = backupGenerationsDir(root);
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json') && GENERATION_PATTERN.test(name.slice(0, -5))).sort();
  } catch {
    return { ok: true, removed: [] };
  }
  const protectedNames = new Set(protectedFiles.filter((name) => typeof name === 'string' && name !== ''));
  const recent = names.slice(-keep);
  const keepSet = new Set([...protectedNames, ...recent]);
  const removed = [];
  for (const name of names) {
    if (keepSet.has(name)) continue;
    try {
      rmSync(join(dir, name), { force: true });
      removed.push(name);
    } catch {
      /* la poda nunca puede tumbar una publicación */
    }
  }
  return { ok: true, removed };
}

/** Temporales huérfanos antiguos: sólo los nuestros y sólo si son viejos. */
function cleanupOrphans(root, { now = new Date().toISOString() } = {}) {
  const removed = [];
  const pointerDir = dirname(alignPointer(root));
  const nowMs = Date.parse(now);
  const candidates = [];
  try {
    candidates.push(...readdirSync(pointerDir).map((name) => join(pointerDir, name)));
  } catch {
    /* sin directorio no hay nada que limpiar */
  }
  try {
    const dir = backupGenerationsDir(root);
    candidates.push(...readdirSync(dir).map((name) => join(dir, name)));
  } catch {
    /* idem */
  }
  for (const candidate of candidates) {
    const name = basename(candidate);
    const isOurTmp = name.endsWith('.tmp') && (name.startsWith('center.json.backup.json.') || name.startsWith('center.json.backup.'));
    if (!isOurTmp) continue;
    try {
      const stats = statSync(candidate);
      if (Number.isFinite(nowMs) && nowMs - stats.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
      rmSync(candidate, { force: true });
      removed.push(name);
    } catch {
      /* best-effort */
    }
  }
  return removed;
}

function alignPointer(root) {
  return backupPointerFile(root);
}

/** Copia de compatibilidad + su huella. Best-effort: jamás puede tumbar la publicación autoritativa. */
function publishCompatCopy(root, source, { sha256, now, reason }) {
  try {
    const target = backupFile(root);
    const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`;
    writeFileSync(tmp, source, { flag: 'wx' });
    const written = readFileSync(tmp);
    if (sha256OfBytes(written) !== sha256 || written.length !== source.length) {
      rmSync(tmp, { force: true });
      return { ok: false, reason: 'la copia temporal de compatibilidad no coincide' };
    }
    renameWithRetry(tmp, target);
    const metaTmp = `${backupMetaFile(root)}.${process.pid}.${Date.now().toString(36)}.tmp`;
    writeFileSync(metaTmp, `${sha256} ${source.length} ${now} ${reason}\n`, 'utf8');
    renameWithRetry(metaTmp, backupMetaFile(root));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

function writeAll(root, source, { now, reason, sha256, hooks = {}, keep = BACKUP_HISTORY, previousGeneration = null }) {
  const dir = backupGenerationsDir(root);
  mkdirSync(dir, { recursive: true });
  const taken = new Set(readdirSync(dir).map((name) => name.replace(/\.json$/, '')));
  const generation = generationName(now, sha256, taken);
  const relative = `backups/generations/${generation}.json`;
  const absolute = join(root, relative);

  // 1) La generación se escribe una vez y no se sobrescribe nunca.
  try {
    writeFileSync(absolute, source, { flag: 'wx' });
  } catch (error) {
    return { ok: false, code: 'backup-failed', message: `no se pudo escribir la generación: ${String(error?.message ?? error)}` };
  }
  hooks.afterGenerationWrite?.(absolute);

  // 2) fsync de los bytes.
  try {
    syncFile(absolute);
  } catch (error) {
    return { ok: false, code: 'backup-unsynced', message: `no se pudo sincronizar la generación: ${String(error?.message ?? error)}` };
  }
  hooks.afterGenerationSync?.(absolute);

  // 3) Releer y verificar la generación antes de referenciarla.
  try {
    const written = readFileSync(absolute);
    if (sha256OfBytes(written) !== sha256 || written.length !== source.length) {
      return { ok: false, code: 'backup-mismatch', message: 'la generación escrita no coincide con el original' };
    }
  } catch (error) {
    return { ok: false, code: 'backup-failed', message: String(error?.message ?? error) };
  }

  // 4) Puntero temporal en el mismo directorio que el definitivo.
  const pointerPath = backupPointerFile(root);
  const pointerTmp = `${pointerPath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const pointer = {
    schema: BACKUP_POINTER_SCHEMA,
    generation,
    file: relative,
    sha256,
    size: source.length,
    createdAt: now,
    reason,
  };
  try {
    writeFileSync(pointerTmp, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8');
  } catch (error) {
    rmSync(pointerTmp, { force: true });
    return { ok: false, code: 'backup-failed', message: `no se pudo escribir el puntero temporal: ${String(error?.message ?? error)}` };
  }
  hooks.afterPointerWrite?.(pointerTmp);

  try {
    syncFile(pointerTmp);
  } catch (error) {
    rmSync(pointerTmp, { force: true });
    return { ok: false, code: 'backup-unsynced', message: `no se pudo sincronizar el puntero: ${String(error?.message ?? error)}` };
  }
  hooks.afterPointerSync?.(pointerTmp);

  // 5) Releer y validar el temporal y la generación que referencia.
  try {
    const parsedTmp = JSON.parse(readFileSync(pointerTmp, 'utf8'));
    if (parsedTmp.generation !== generation || parsedTmp.sha256 !== sha256) {
      rmSync(pointerTmp, { force: true });
      return { ok: false, code: 'backup-mismatch', message: 'el puntero temporal no se lee igual' };
    }
    const resolved = resolveGeneration(root, parsedTmp.file);
    if (!resolved.ok) {
      rmSync(pointerTmp, { force: true });
      return { ok: false, code: 'backup-mismatch', message: `el puntero temporal no resuelve su generación: ${resolved.reason}` };
    }
  } catch (error) {
    rmSync(pointerTmp, { force: true });
    return { ok: false, code: 'backup-failed', message: String(error?.message ?? error) };
  }

  // 6) El único punto de commit: un rename.
  hooks.beforePointerRename?.(pointerTmp);
  try {
    renameWithRetry(pointerTmp, pointerPath, hooks.renamePointer);
  } catch (error) {
    rmSync(pointerTmp, { force: true });
    return { ok: false, code: 'backup-failed', message: `no se pudo publicar el puntero: ${String(error?.message ?? error)}` };
  }
  hooks.afterPointerPublish?.(pointerPath);

  // 7) Reabrir el puntero publicado y verificar su generación.
  const verified = verifyBackup(root);
  if (!verified.ok) {
    return { ok: false, code: 'backup-unverified', message: verified.message ?? 'el puntero publicado no verifica', sha256, generation };
  }

  hooks.beforeCompat?.(root);
  const compat = publishCompatCopy(root, source, { sha256, now, reason });
  hooks.afterCompat?.(compat);

  hooks.beforePrune?.(root);
  pruneGenerations(root, { keep, protectedFiles: [`${generation}.json`, previousGeneration === null ? '' : `${previousGeneration}.json`] });
  hooks.afterPrune?.(root);

  return { ok: true, created: true, reason, generation, file: relative, path: absolute, sha256, size: source.length, compat: compat.ok === true, pointerPath };
}

/**
 * Crea (si toca) una copia verificada del documento actual.
 *
 * Publicación: generación inmutable verificada y **un** rename del puntero. Nunca se borra el puntero
 * anterior antes de publicar el nuevo, y nunca se sobrescribe una generación.
 */
export function ensureBackup(root = defaultRoot(), { now = new Date().toISOString(), reason = 'mutation', keep = BACKUP_HISTORY, hooks = {} } = {}) {
  const loaded = loadState(root);
  if (loaded.integrity === INTEGRITY_MISSING) return { ok: true, created: false, reason, message: 'no hay documento todavía' };
  if (loaded.integrity !== INTEGRITY_OK) {
    return { ok: false, code: 'backup-unavailable', integrity: loaded.integrity, message: 'no se puede copiar un documento que no es válido' };
  }

  const existing = verifyBackup(root);
  if (reason !== 'migration' && existing.ok && dayOf(existing.createdAt) === dayOf(now)) {
    return { ok: true, created: false, reason, path: existing.path, sha256: existing.sha256, size: existing.size, generation: existing.generation };
  }

  const file = centerFile(root);
  const source = readFileSync(file);
  const sha256 = sha256OfBytes(source);
  if (sha256 !== loaded.sha256) {
    // Cambió entre loadState y la lectura: no se copia una versión que no es la que se verificó.
    return { ok: false, code: 'backup-race', message: 'el documento cambió mientras se copiaba' };
  }

  cleanupOrphans(root, { now });
  const previousGeneration = existing.ok ? existing.generation : null;
  return writeAll(root, source, { now, reason, sha256, hooks, keep, previousGeneration });
}

/**
 * Restaura la copia autoritativa. Humana y explícita.
 *
 * - Con puntero válido: restaura su generación.
 * - Sin puntero pero con pareja legada válida: sólo si se confirma su SHA-256 (legacySha256).
 * - Puntero inválido o generación corrupta: no se restaura nada.
 */
export function restoreFromBackup(root = defaultRoot(), { now = new Date().toISOString(), archive = archiveCorruptStore, legacySha256 = '' } = {}) {
  const verified = verifyBackup(root);
  if (verified.ok) {
    return restoreStore(root, { sourcePath: verified.path, expectedSha256: verified.sha256, now, archive });
  }
  if (verified.code === 'legacy-copy') {
    if (typeof legacySha256 !== 'string' || legacySha256 === '' || legacySha256 !== verified.sha256) {
      return { ok: false, code: 'legacy-confirmation-required', sha256: verified.sha256 ?? null, message: 'hay una copia antigua válida: para restaurarla hay que confirmar su SHA-256 (legacySha256)' };
    }
    return restoreStore(root, { sourcePath: verified.path, expectedSha256: legacySha256, now, archive });
  }
  return { ok: false, code: verified.code ?? 'backup-unusable', message: verified.message ?? 'la copia no es recuperable' };
}

function existsFile(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Migración v1 → v2
 *
 * v2 es estrictamente aditiva:
 *   - raíz `schemaMeta: { migratedFrom: number, migratedAt: string }`;
 *   - cada asignación gana `pinnedAt: string` ('' cuando no se conoce; la migración lo rellena con el
 *     `updatedAt` de la asignación, que es su mejor aproximación documentada).
 * Nada de identidades UUID, manifiestos, eventos nuevos ni telemetría: eso es S5/S6.
 * ---------------------------------------------------------------------------------------------- */

/** Proyecta un estado v1 al documento v2. No escribe nada. */
export function migrateDocumentV2(state, { now = new Date().toISOString(), from = 1 } = {}) {
  const document = JSON.parse(JSON.stringify(state));
  document.schemaVersion = 2;
  document.schemaMeta = { migratedFrom: from, migratedAt: now };
  for (const row of Object.values(document.assignments ?? {})) {
    for (const assignment of Object.values(row)) {
      if (typeof assignment.pinnedAt !== 'string' || assignment.pinnedAt === '') {
        assignment.pinnedAt = typeof assignment.updatedAt === 'string' ? assignment.updatedAt : '';
      }
    }
  }
  return document;
}

/** Compara dos documentos por entidades: nada puede desaparecer ni cambiar de contenido. */
export function compareDocuments(before, after) {
  const problems = [];
  const ids = (map) => Object.keys(map ?? {}).sort();
  for (const [collection, kind] of Object.entries(STORE_SHAPE)) {
    if (kind === 'array') continue;
    const left = ids(before[collection]);
    const right = ids(after[collection]);
    if (left.join('|') !== right.join('|')) problems.push(`${collection}: ${left.length} → ${right.length}`);
  }
  if ((before.events ?? []).length !== (after.events ?? []).length) problems.push('events: cambia el número de eventos');
  for (const [id, skill] of Object.entries(before.skills ?? {})) {
    const migrated = after.skills?.[id];
    if (migrated === undefined) {
      problems.push(`skills.${id}: desaparece`);
      continue;
    }
    if ((skill.versions ?? []).length !== (migrated.versions ?? []).length) problems.push(`skills.${id}: cambia el número de versiones`);
    for (const version of skill.versions ?? []) {
      const other = (migrated.versions ?? []).find((entry) => entry.version === version.version);
      if (other === undefined) {
        problems.push(`skills.${id}: falta la versión ${version.version}`);
        continue;
      }
      if (other.body !== version.body) problems.push(`skills.${id}@${version.version}: el cuerpo cambia`);
      const left = Object.keys(version.references ?? {}).sort().join('|');
      const right = Object.keys(other.references ?? {}).sort().join('|');
      if (left !== right) problems.push(`skills.${id}@${version.version}: cambian las referencias`);
    }
  }
  for (const [projectId, row] of Object.entries(before.assignments ?? {})) {
    for (const [skillId, assignment] of Object.entries(row)) {
      const migrated = after.assignments?.[projectId]?.[skillId];
      if (migrated === undefined) {
        problems.push(`assignments.${projectId}.${skillId}: desaparece`);
        continue;
      }
      if (migrated.version !== assignment.version) problems.push(`assignments.${projectId}.${skillId}: cambia la versión fijada`);
      if (Boolean(migrated.enabled) !== Boolean(assignment.enabled)) problems.push(`assignments.${projectId}.${skillId}: cambia el interruptor`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Migración explícita y verificable.
 *
 * Orden: comprobar integridad → copia verificada → construir v2 en memoria → validar forma y entidades →
 * escribir temporal → releer y validar → reemplazar con rename → releer y exigir `integrity: ok` y v2.
 * Si falla antes del reemplazo, el original no se toca. Si falla después, devuelve la ruta de recuperación
 * (`backup`) con su hash para que una persona restaure con conocimiento.
 */
/**
 * `writeFile`/`rename` se pueden inyectar: las pruebas de «falla la escritura temporal» y «falla el
 * reemplazo» necesitan provocar esos fallos sin depender de permisos del sistema de ficheros (en Windows
 * un directorio de solo lectura no impide escribir dentro). En producción se usan los de verdad.
 */
export function migrateStore(root = defaultRoot(), { now = new Date().toISOString(), writeFile = writeFileSync, rename = renameWithRetry } = {}) {
  const release = acquireLock(root);
  try {
    const loaded = loadState(root);
    if (loaded.integrity !== INTEGRITY_OK) {
      return { ok: false, code: 'store-unreadable', integrity: loaded.integrity, message: 'no se migra un documento que no es válido', sha256: loaded.sha256, size: loaded.size };
    }
    const from = loaded.state.schemaVersion;
    if (from === SCHEMA_VERSION) {
      return { ok: true, migrated: false, already: true, schemaVersion: from, sha256: loaded.sha256, size: loaded.size };
    }
    if (from > SCHEMA_VERSION) return { ok: false, code: 'future-version', message: 'el documento es más nuevo que este código' };

    const backup = ensureBackup(root, { now, reason: 'migration' });
    if (!backup.ok) return { ok: false, code: 'backup-failed', message: `no hay copia verificada: ${backup.message ?? backup.code}` };

    const document = migrateDocumentV2(loaded.state, { now, from });
    const shape = checkStoreShape(document);
    if (!shape.ok) return { ok: false, code: 'migration-invalid', message: `la migración produciría un documento inválido: ${shape.reason}` };
    const comparison = compareDocuments(loaded.state, document);
    if (!comparison.ok) return { ok: false, code: 'migration-lossy', message: `la migración perdería datos: ${comparison.problems.slice(0, 4).join('; ')}` };

    const file = centerFile(root);
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    const body = `${JSON.stringify(document, null, 2)}\n`;
    try {
      writeFile(tmp, body, 'utf8');
      const reread = JSON.parse(readFileSync(tmp, 'utf8'));
      const tmpShape = checkStoreShape(reread);
      if (!tmpShape.ok) {
        rmSync(tmp, { force: true });
        return { ok: false, code: 'migration-invalid', message: `el temporal no se valida: ${tmpShape.reason}` };
      }
      if (reread.schemaVersion !== 2) {
        rmSync(tmp, { force: true });
        return { ok: false, code: 'migration-invalid', message: 'el temporal no quedó en v2' };
      }
      rename(tmp, file);
    } catch (error) {
      rmSync(tmp, { force: true });
      return { ok: false, code: 'migration-failed', message: String(error?.message ?? error) };
    }

    const after = loadState(root);
    if (after.integrity !== INTEGRITY_OK || after.state.schemaVersion !== 2) {
      return {
        ok: false,
        code: 'migration-unverified',
        integrity: after.integrity,
        message: 'el documento migrado no se relee como v2 válido; recupera desde la copia verificada',
        backup: { path: backup.path, sha256: backup.sha256 },
      };
    }
    return {
      ok: true,
      migrated: true,
      from,
      to: 2,
      before: { sha256: loaded.sha256, size: loaded.size },
      after: { sha256: after.sha256, size: after.size },
      backup: { path: backup.path, sha256: backup.sha256, size: backup.size },
    };
  } finally {
    release();
  }
}

/**
 * Durabilidad mínima R17 (§3): sólo dos campos nuevos sobreviven a la recarga.
 *
 * El resto del DTO de actividad se deriva al leer; guardar más sería engordar el documento sin necesidad
 * y, peor, afirmar cosas que luego no se pueden sostener. `channel` es la evidencia de canal y
 * `operationId` permite el replay idempotente de una operación.
 */
function preserveActivityFields(source, target) {
  const channel = text(source?.channel) || text(source?.actorEvidence?.channel);
  if (channel !== '') target.channel = channel;
  const operationId = text(source?.operationId);
  if (operationId !== '') target.operationId = operationId;
}

/** Añade un evento al diario, recortando por delante lo que ya no cabe. */
export function appendEvent(state, event) {
  // `isObject` dice «objeto» y un array no lo es: usarlo aquí vaciaba el diario en cada evento y la
  // telemetría sólo recordaba el último. Se comprueba la forma real del campo, no la del tipo.
  if (!Array.isArray(state.events)) state.events = [];
  const at = text(event.at) || new Date().toISOString();
  const type = text(event.type, 'unknown');
  const appended = {
    // Id y sello se completan aquí cuando quien llama no los trae: un evento sin identificador no se
    // puede referenciar y uno sin fecha no se puede ordenar, así que no tiene sentido aceptarlos.
    id: text(event.id) || `ev-${shortHash(`${at}:${type}:${state.events.length}`, 12)}`,
    at,
    type,
    skillId: text(event.skillId),
    projectId: text(event.projectId),
    version: text(event.version),
    // `system` no es una persona ni el modelo: es el harness pidiendo el catálogo. Colapsarlo a
    // `human` falseaba la telemetría (una carga aparecía como acto de una persona).
    actor: event.actor === 'ai' || event.actor === 'system' ? event.actor : 'human',
    note: text(event.note),
  };
  // R17 §3: los dos únicos campos durables nuevos. Se escriben aquí para que la transacción los guarde
  // en el mismo acto que el evento; el resto del DTO se deriva al leer.
  preserveActivityFields(event, appended);
  state.events.push(appended);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  return state.events.at(-1);
}

/**
 * ¿Ya hay un evento de este tipo para este día y sujeto? Lo usa el proveedor para no pedir una escritura
 * cuando la entrega del catálogo no aporta nada nuevo.
 */
export function dailyEventExists(state, { type, skillId = '', projectId = '', day }) {
  const target = day ?? new Date().toISOString().slice(0, 10);
  if (!Array.isArray(state?.events)) return false;
  return state.events.some((event) => event.type === type
    && event.skillId === skillId
    && event.projectId === projectId
    && String(event.at).slice(0, 10) === target);
}

/**
 * Anota un evento **como mucho una vez por día y sujeto**.
 *
 * Una carga de skill no es una acción humana: el catálogo de una sesión se pide muchas veces por
 * minuto. Sin esta puerta, la telemetría de cargas se comería el documento y no mediría nada.
 */
export function recordDailyEvent(state, { type, skillId = '', projectId = '', version = '', actor = 'human', note = '', day }) {
  const target = day ?? new Date().toISOString().slice(0, 10);
  if (!Array.isArray(state.events)) state.events = [];
  if (dailyEventExists(state, { type, skillId, projectId, day: target })) return null;
  return appendEvent(state, {
    type,
    skillId,
    projectId,
    version,
    actor,
    note,
    at: `${target}T00:00:00.000Z`,
    id: `${target}-${type}-${skillId}-${projectId}`.slice(0, 120),
  });
}

/**
 * Deja un comprobante durable de una operación de filesystem.
 *
 * El comprobante vive en el documento porque el diario se compacta: un evento puede desaparecer por
 * recorte, pero un comprobante no. Se escribe en la **misma** transacción que el evento (misma
 * `withState`), para que nunca exista uno sin el otro.
 */
export function recordOperation(state, operationId, entry = {}) {
  const id = typeof operationId === 'string' && operationId.length > 0 ? operationId : '';
  if (id === '') return null;
  const stamp = typeof entry.registeredAt === 'string' ? entry.registeredAt : new Date().toISOString();
  const operation = {
    kind: typeof entry.kind === 'string' ? entry.kind : 'unknown',
    uuid: typeof entry.uuid === 'string' ? entry.uuid : '',
    targetSha256: typeof entry.targetSha256 === 'string' ? entry.targetSha256 : '',
    registeredAt: stamp,
    status: entry.status === 'pending' ? 'pending' : 'registered',
  };
  if (!isObject(state.operations)) state.operations = {};
  state.operations[id] = operation;
  return operation;
}

/** Comprobante ya registrado, para que un reintento no haga trabajo ni escriba de nuevo. */
export function operationOf(state, operationId) {
  if (!isObject(state.operations)) return null;
  const entry = state.operations[operationId];
  return isObject(entry) ? entry : null;
}
