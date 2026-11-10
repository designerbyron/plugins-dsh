/**
 * Preflight: la ÚNICA puerta que decide si una acción puede escribir.
 *
 * PURO y SÍNCRONO: no hace E/S, no recalcula fuentes y no inventa evidencia. Recibe el inventario, las
 * colisiones y el estado de las fuentes ya observados por el adaptador, y devuelve una decisión
 * fail-closed: si falta una fuente REQUERIDA, se bloquea (nunca se degrada a aviso). Las OPTIONAL que
 * falten no bloquean, pero dejan el catálogo sin verificar (`catalog-unverified`).
 *
 * R16.1 §2: publicar una versión puede cambiar qué proveedor sirve un nombre (o dejar nuestra copia
 * sombreada), así que exige el catálogo del Host. Crear una skill es local y reversible —no toca la
 * resolución del Host—: sin catálogo se avisa (`catalog-unverified`) y se registra; con un nombre que ya
 * sirve otro proveedor, publicar bloquea y crear avisa, nunca se calla la colisión.
 */

import { createHash } from 'node:crypto';

import { canonicalSkillName } from './collisions.mjs';

export const PREFLIGHT_VERSION = 1;

const REQUIRED = {
  'register-project': ['state', 'filesystem-project'],
  'adopt-project': ['state', 'manifest', 'filesystem-project'],
  'repair-manifest': ['state', 'manifest', 'filesystem-project'],
  'detach-project': ['state', 'manifest', 'filesystem-project'],
  'materialize-project': ['state', 'manifest', 'skills-registry', 'filesystem-view'],
  'assign-skill': ['state', 'manifest'],
  'enable-skill': ['state', 'manifest'],
  'create-skill': ['state', 'manifest'],
  // R16.1 §2: publicar puede cambiar la resolución del Host ⇒ sin catálogo no se publica a ciegas.
  'publish-version': ['state', 'manifest', 'skills-registry'],
};

const OPTIONAL = {
  'register-project': ['workspace-registry', 'manifest'],
  'adopt-project': [],
  'repair-manifest': [],
  'detach-project': [],
  'materialize-project': [],
  'assign-skill': ['skills-registry'],
  'enable-skill': ['skills-registry'],
  // Crear es local y reversible: sin catálogo se avisa (catalog-unverified) y se continúa.
  'create-skill': ['skills-registry'],
  'publish-version': [],
};

/**
 * Acciones que escriben sobre un proyecto concreto. La disponibilidad de la carpeta sólo bloquea
 * (`project-unavailable`) cuando la acción exige `filesystem-project` entre sus fuentes REQUERIDAS:
 * assign/enable/materialize no lo exigen (escriben en el centro o en el catálogo, no en el cwd), y
 * register-project admite registrar una ruta todavía inexistente — así se conserva el comportamiento
 * histórico que ya probaba la suite. El resto de acciones sí exigen poder tocar el proyecto.
 */
const PROJECT_ACTIONS = new Set(['adopt-project', 'repair-manifest', 'detach-project', 'materialize-project', 'assign-skill', 'enable-skill']);

/** Acciones que exigen identidad de manifiesto y por tanto comprueban que la huella observada case. */
const MANIFEST_ACTIONS = new Set(['adopt-project', 'repair-manifest', 'detach-project', 'materialize-project', 'assign-skill', 'enable-skill']);

const KNOWN_SOURCES = [
  'state',
  'workspace-registry',
  'skills-registry',
  'loader',
  'filesystem-project',
  'manifest',
  'filesystem-view',
  'sessions',
];

const UNREADABLE_INTEGRITIES = new Set(['unreadable', 'invalid-shape', 'future-version']);

export const PREFLIGHT_ACTIONS = Object.keys(REQUIRED);

export function requiredSources(action) {
  return Array.isArray(REQUIRED[action]) ? REQUIRED[action].slice() : [];
}

export function optionalSources(action) {
  return Array.isArray(OPTIONAL[action]) ? OPTIONAL[action].slice() : [];
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** JSON canónico: claves ordenadas, Map/Set convertidos, nunca lanza por ciclos. */
function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof Map) {
    const entries = [...value.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return `{${entries.map(([key, item]) => `${JSON.stringify(String(key))}:${canonicalJson(item, seen)}`).join(',')}}`;
  }
  if (value instanceof Set) return `[${[...value].map((item) => canonicalJson(item, seen)).join(',')}]`;
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`;
  if (isObject(value)) {
    if (seen.has(value)) return '"[circular]"';
    seen.add(value);
    const keys = Object.keys(value).sort();
    const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`).join(',');
    seen.delete(value);
    return `{${body}}`;
  }
  return 'null';
}

function hashOf(value) {
  return sha256Text(canonicalJson(value));
}

function normalizeSources(sources, inventory) {
  const list = Array.isArray(sources)
    ? sources
    : Array.isArray(inventory?.sources)
      ? inventory.sources
      : isObject(sources)
        ? Object.entries(sources).map(([id, value]) => (isObject(value) ? { id, ...value } : { id, status: String(value) }))
        : [];
  const map = new Map();
  for (const source of list) {
    if (!isObject(source)) continue;
    const id = safeText(source.id);
    if (id === '') continue;
    map.set(id, {
      id,
      status: safeText(source.status) || 'unavailable',
      reason: safeText(source.reason),
    });
  }
  const ordered = [];
  for (const id of KNOWN_SOURCES) if (map.has(id)) ordered.push(map.get(id));
  for (const [id, source] of map) if (!KNOWN_SOURCES.includes(id)) ordered.push(source);
  return ordered;
}

function sourceById(sources, id) {
  return sources.find((source) => source.id === id) ?? null;
}

function finding(code, severity, message, subject) {
  return subject === undefined ? { code, severity, message } : { code, severity, message, subject };
}

function collisionList(collisions) {
  if (Array.isArray(collisions)) return { collisions, ambiguousNames: [] };
  if (!isObject(collisions)) return { collisions: [], ambiguousNames: [] };
  return {
    collisions: Array.isArray(collisions.collisions) ? collisions.collisions : [],
    ambiguousNames: Array.isArray(collisions.ambiguousNames) ? collisions.ambiguousNames : [],
  };
}

function subjectNames(input) {
  const names = new Set();
  for (const raw of [input.skillId, input.skillName, input.target?.skillId, typeof input.target === 'string' ? input.target : input.target?.name]) {
    const name = canonicalSkillName(raw);
    if (name !== null) names.add(name);
  }
  return names;
}

function rowMatchesProject(collision, projectId, skillId) {
  if (!Array.isArray(collision?.rows)) return false;
  for (const row of collision.rows) {
    if (projectId !== null && safeText(row?.projectId) === projectId) return true;
    if (projectId !== null && safeText(row?.key) === projectId) return true;
    if (skillId !== null && safeText(row?.key) === skillId) return true;
  }
  return false;
}

/**
 * Hallazgos por **propietario del nombre** (R16.1 §2, pruebas del usuario 1, 2 y 4).
 *
 * El motor de colisiones sólo agrupa dos filas: un nombre que sirve otro proveedor y que todavía no
 * tiene copia nuestra no es una colisión, pero sí cambia lo que significa crear o publicar ese nombre.
 * - `publish-version`: escribir una versión nuestra mientras el Host sirve ese nombre desde otro
 *   proveedor (o tiene nuestra copia sombreada) cambia la resolución ⇒ `block`.
 * - `create-skill`: no cambia la resolución del Host ⇒ `warn`, pero nunca se calla.
 */
function ownerFindings({ action, inventory, names }) {
  const findings = [];
  if (action !== 'publish-version' && action !== 'create-skill') return findings;
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  const publish = action === 'publish-version';
  const seen = new Set();
  for (const entry of entries) {
    const name = canonicalSkillName(entry?.canonicalName) ?? canonicalSkillName(entry?.name);
    if (name === null || !names.has(name) || seen.has(name)) continue;
    const ownerKind = safeText(entry?.owner?.kind);
    const provider = safeText(entry?.association?.provider) || safeText(entry?.owner?.provider);
    const shadow = entry?.association?.shadowedBy ?? null;
    const ours = ownerKind === 'lifecode' || provider === 'lifecode-skill-center';
    const shadowProvider = safeText(shadow?.provider);
    // Nuestra copia existe pero el Host sirve otra: publicar sobre ella no cambia lo que se carga.
    if (ours && shadow === null) continue;
    seen.add(name);
    const detail = ours
      ? `nuestra copia está sombreada por «${shadowProvider || 'otro proveedor'}»`
      : shadow !== null && shadowProvider !== ''
        ? `el Host carga otra copia desde «${shadowProvider}»`
        : `ese nombre ya lo sirve ${provider !== '' ? `el proveedor «${provider}»` : 'otro proveedor'}`;
    findings.push(finding(
      'name-collision',
      publish ? 'block' : 'warn',
      publish
        ? `Publicar «${name}» cambiaría qué copia sirve el Host: ${detail}. Publicar a ciegas dejaría la versión nueva sin efecto o pisando a otro dueño.`
        : `El nombre «${name}» ya está tomado en este Host (${detail}); crear una copia local no cambia qué carga el Host, pero el nombre no queda libre.`,
      name,
    ));
  }
  return findings;
}

function collisionFindings(collisions, { action, projectId, skillId, names }) {
  const findings = [];
  for (const collision of collisions) {
    const code = safeText(collision?.code);
    if (code === 'name-collision' || code === 'content-collision') {
      const keyName = canonicalSkillName(collision.key);
      // `content-collision` lleva el sha256 en `key`, no un nombre: la relevancia se decide también por
      // las filas (que traen `name`), o el hallazgo nunca casaría y el preflight lo omitiría (§4).
      const rows = Array.isArray(collision.rows) ? collision.rows : [];
      const rowRelevant = rows.some((row) => {
        const rowName = canonicalSkillName(row?.name) ?? canonicalSkillName(row?.key);
        if (rowName !== null && names.has(rowName)) return true;
        return skillId !== null && safeText(row?.key) === skillId;
      });
      const relevant = (keyName !== null && names.has(keyName))
        || (skillId !== null && safeText(collision.key) === skillId)
        || rowRelevant;
      if (!relevant) continue;
      findings.push(finding(
        code,
        code === 'content-collision' ? 'warn' : collision.severity === 'block' ? 'block' : 'warn',
        safeText(collision.explanation) || `Colisión de ${code} en «${safeText(collision.key)}».`,
        safeText(collision.key),
      ));
    } else if (code === 'assignment-shadowed') {
      const [, shadowName] = safeText(collision.key).split(':');
      const nameRelevant = shadowName !== undefined ? names.has(shadowName) : false;
      const projectRelevant = projectId !== null && rowMatchesProject(collision, projectId, null);
      if (!nameRelevant && !projectRelevant) continue;
      findings.push(finding(
        code,
        action === 'materialize-project' ? 'block' : 'warn',
        safeText(collision.explanation) || `La asignación «${safeText(collision.key)}» está sombreada por otro proveedor.`,
        safeText(collision.key),
      ));
    } else if (code === 'path-collision' || code === 'identity-duplicate' || code === 'legacy-collision') {
      if (projectId === null || !rowMatchesProject(collision, projectId, skillId)) continue;
      findings.push(finding(
        code,
        code === 'legacy-collision' ? 'warn' : collision.severity === 'block' ? 'block' : 'warn',
        safeText(collision.explanation) || `Colisión de ${code}.`,
        safeText(collision.key),
      ));
    }
  }
  return findings;
}

/**
 * Decide si `action` puede ejecutarse. Nunca lanza: ante un input imposible devuelve `block`
 * (la duda no autoriza una escritura).
 */
export function preflight(input = {}) {
  const action = safeText(input?.action);
  const generatedAt = typeof input?.now === 'string' && input.now !== '' ? input.now : new Date().toISOString();
  const emptyEvidence = () => ({
    generatedAt,
    preflightVersion: PREFLIGHT_VERSION,
    sources: [],
    inventoryHash: hashOf(null),
    collisionsHash: hashOf(null),
    stateSha256: hashOf(null),
  });
  try {
    const required = requiredSources(action);
    const optional = optionalSources(action);
    const state = isObject(input?.state) ? input.state : null;
    const inventory = isObject(input?.inventory) ? input.inventory : null;
    const sources = normalizeSources(input?.sources, inventory);
    const evidence = {
      generatedAt,
      preflightVersion: PREFLIGHT_VERSION,
      sources,
      inventoryHash: hashOf(inventory),
      collisionsHash: hashOf(input?.collisions ?? null),
      stateSha256: hashOf(state),
    };
    if (action === '') {
      return {
        decision: 'block',
        findings: [finding('evidence-incomplete', 'block', 'No se indicó qué acción se quiere ejecutar.', 'action')],
        reasons: ['No se puede comprobar una acción vacía: no se autoriza ninguna escritura.'],
        evidence,
      };
    }
    const findings = [];
    for (const id of required) {
      const source = sourceById(sources, id);
      if (source === null || source.status !== 'complete') {
        findings.push(finding(
          'evidence-incomplete',
          'block',
          `La fuente requerida «${id}» no está disponible o no terminó (${source === null ? 'ausente' : source.status}); la acción no puede comprobarse.`,
          id,
        ));
      }
    }
    for (const id of optional) {
      if (required.includes(id)) continue;
      const source = sourceById(sources, id);
      if (source === null || source.status !== 'complete') {
        findings.push(finding(
          'catalog-unverified',
          'warn',
          `La fuente opcional «${id}» no está disponible (${source === null ? 'ausente' : source.status}); el catálogo queda sin verificar.`,
          id,
        ));
      }
    }

    const integrity = safeText(input?.integrity) || safeText(state?.integrity);
    if (UNREADABLE_INTEGRITIES.has(integrity)) {
      findings.push(finding('store-unreadable', 'block', `El almacén del centro no es escribible en estado «${integrity}».`, 'state'));
    }

    const projectId = safeText(input?.projectId) || safeText(input?.target?.projectId) || null;
    const skillId = canonicalSkillName(input?.skillId) ?? canonicalSkillName(input?.target?.skillId) ?? null;

    if (PROJECT_ACTIONS.has(action) && requiredSources(action).includes('filesystem-project')) {
      const availability = safeText(input?.projectAvailability) || safeText(inventory?.project?.availability) || safeText(input?.project?.availability);
      if (availability === 'missing-dir') {
        findings.push(finding('project-unavailable', 'block', 'La carpeta del proyecto no existe o no es accesible; escribir ahí dejaría evidencia falsa.', projectId ?? 'project'));
      }
      if (safeText(input?.projectState) === 'unavailable') {
        findings.push(finding('project-unavailable', 'block', 'El proyecto está clasificado como no disponible.', projectId ?? 'project'));
      }
    }

    const record = projectId !== null && isObject(state?.projects) ? state.projects[projectId] : null;
    if (record && !['register-project'].includes(action)) {
      const registeredWithoutManifest = !safeText(record.manifestSha256);
      if (registeredWithoutManifest && ['assign-skill', 'enable-skill', 'materialize-project', 'repair-manifest', 'detach-project'].includes(action)) {
        findings.push(finding(
          'manifest-missing',
          'warn',
          'El proyecto está registrado sin huella de manifiesto: se puede operar, pero la identidad no está verificada.',
          projectId,
        ));
      }
    }
    const identityState = safeText(input?.identity) || safeText(input?.identityState) || safeText(input?.manifest?.state);
    if (identityState === 'mismatch' && MANIFEST_ACTIONS.has(action)) {
      findings.push(finding(
        'manifest-mismatch',
        'block',
        'La huella observada del manifiesto no coincide con la registrada; escribir con identidad dudosa puede atribuir contenido a otro dueño.',
        projectId ?? 'manifest',
      ));
    }
    if (projectId !== null && ['assign-skill', 'enable-skill', 'materialize-project', 'repair-manifest', 'detach-project'].includes(action)) {
      if (!isObject(state?.projects?.[projectId])) {
        findings.push(finding('project-not-registered', 'info', `El proyecto «${projectId}» no está registrado en el centro.`, projectId));
      }
    }
    if (safeText(input?.skillId) !== '' && canonicalSkillName(input.skillId) === null) {
      findings.push(finding('invalid-name', 'warn', `El nombre «${safeText(input.skillId)}» no es un nombre de skill válido para el Host.`, safeText(input.skillId)));
    }

    const { collisions, ambiguousNames } = collisionList(input?.collisions);
    const names = subjectNames(input);
    const relevantAmbiguity = ambiguousNames.map((name) => canonicalSkillName(name)).filter((name) => name !== null && names.has(name));
    if (relevantAmbiguity.length > 0) {
      findings.push(finding(
        'ambiguous-identity',
        'block',
        `El nombre ${relevantAmbiguity.map((name) => `«${name}»`).join(', ')} identifica a más de una skill; la acción no sabe sobre cuál escribe.`,
        relevantAmbiguity[0],
      ));
    }
    findings.push(...collisionFindings(collisions, { action, projectId, skillId, names }));
    findings.push(...ownerFindings({ action, inventory, names }));

    const hasBlock = findings.some((item) => item.severity === 'block');
    const hasWarn = findings.some((item) => item.severity === 'warn');
    const decision = hasBlock ? 'block' : hasWarn ? 'warn' : 'allow';
    const codes = [...new Set(findings.map((item) => item.code))];
    const reasons = [];
    if (decision === 'block') {
      reasons.push(`No se escribió nada: la acción «${action}» no pasó el preflight (${codes.join(', ')}).`);
    } else if (decision === 'warn') {
      reasons.push(`La acción «${action}» puede ejecutarse, con avisos: ${codes.join(', ')}.`);
    } else {
      reasons.push(`La acción «${action}» tiene la evidencia requerida y no hay colisiones que la afecten.`);
    }
    return { decision, findings, reasons, evidence };
  } catch (error) {
    return {
      decision: 'block',
      findings: [finding('evidence-incomplete', 'block', `El preflight no pudo completarse (${safeText(error?.code) || 'error'}); no se autoriza escribir.`)],
      reasons: ['No se escribió nada: la comprobación falló antes de terminar.'],
      evidence: emptyEvidence(),
    };
  }
}
