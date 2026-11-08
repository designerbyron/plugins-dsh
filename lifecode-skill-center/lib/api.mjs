/**
 * El pegamento: documento del centro + disco + telemetría, en una sola capa que consumen la ruta HTTP
 * del panel y las herramientas del agente.
 *
 * Aquí no hay criterio de producto; el criterio vive en `operations.mjs` y `evaluate.mjs`. Este módulo
 * responde dos preguntas: «¿qué hay ahora?» (`buildSnapshot`) y «haz esto» (`runAction`). Ambos son
 * síncronos sobre el documento y escriben con `withState`, que guarda con rename atómico y no deja
 * nada a medias si la mutación falla.
 */

import { readFileSync } from 'node:fs';
import { summarize } from './analytics.mjs';
import { candidateWords, rank } from './detect.mjs';
import { evaluationSummary } from './evaluate.mjs';
import { normalizeCwd, projectIdFor, projectNameFor } from './format.mjs';
import { syncProject } from './materialize.mjs';
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
} from './operations.mjs';
import { candidateFromSkillFile } from './skillfile.mjs';
import { scanExternalSkills } from './sources.mjs';
import { defaultRoot, emptyState, loadState, materializedRoot, withState } from './state.mjs';

export const API_VERSION = 1;
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
export const CHANGES_CATALOG = new Set(['create', 'publish', 'improve', 'decide', 'toggle', 'rollback', 'fork', 'import', 'evaluate']);

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

function notFound() {
  return answer(404, { ok: false, code: 'not-found', message: `esa ruta no es de la API (${API_PREFIX})` });
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
  method = 'GET',
  pathname = '/',
  search = '',
  body = null,
  hostCwd = '',
  now = new Date().toISOString(),
} = {}) {
  const verb = String(method ?? 'GET').toUpperCase();
  const route = apiRouteOf(pathname);
  if (route === null) return notFound();

  if (verb === 'GET' || verb === 'HEAD') {
    const params = new URLSearchParams(typeof search === 'string' ? search.replace(/^\?/, '') : '');
    const cwd = params.get('cwd') ?? '';
    const scan = params.get('scan') !== '0';
    return answer(200, buildSnapshot({ root, cwd: cwd !== '' ? cwd : hostCwd, hostCwd, scan, now }));
  }

  if (verb !== 'POST') {
    return answer(405, { ok: false, code: 'method', message: 'usa GET para el estado y POST para las acciones' });
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
  const result = runAction({
    root,
    action,
    payload,
    actor: body.actor === 'ai' ? 'ai' : 'human',
    cwd: cwd !== '' ? cwd : hostCwd,
    hostCwd,
    now,
  });
  return answer(200, result, result?.ok === true && CHANGES_CATALOG.has(action));
}

/** La raíz del centro. Se puede redirigir por entorno para poder probarla sin tocar el almacén real. */
export function centerRoot(env = process.env) {
  const override = typeof env?.LIFECODE_SKILL_CENTER_ROOT === 'string' ? env.LIFECODE_SKILL_CENTER_ROOT.trim() : '';
  return override !== '' ? override : defaultRoot(env);
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
 * La foto que pinta el panel. Sólo lee; registra un proyecto únicamente cuando el llamante lo ha pedido
 * explícitamente (`runAction('open')`), porque un proyecto visto no es un proyecto autorizado.
 */
export function buildSnapshot({ root = centerRoot(), cwd = '', now = new Date().toISOString(), scan = true, externalLimit = EXTERNAL_LIMIT, hostCwd = '' } = {}) {
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
      pendingImprovements: pending,
    };
  });
  skills.sort((left, right) => (left.updatedAt === right.updatedAt ? left.id.localeCompare(right.id) : right.updatedAt.localeCompare(left.updatedAt)));

  const projects = Object.values(state.projects ?? {}).map((entry) => {
    const row = assignments[entry.id] ?? {};
    const enabled = Object.entries(row).filter(([, value]) => value?.enabled === true).map(([skillId]) => skillId);
    return {
      ...entry,
      registered: true,
      isCurrent: project !== null && project.id === entry.id,
      enabled,
      activeSkills: enabled.length,
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
  const analytics = summarize(state, { now });

  let external = { candidates: [], roots: [], errors: [], truncated: false, total: 0 };
  if (scan) {
    const walked = scanExternalSkills({ cwd: normalizedCwd, dshHome: process.env.DSH_HOME ?? '' });
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
    cwd: normalizedCwd,
    hostCwd: normalizeCwd(hostCwd),
    project,
    skills,
    projects,
    assignments,
    improvements,
    events,
    analytics,
    external,
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
 * Ejecuta una acción del panel o de una herramienta.
 *
 * `actor` es una frontera de seguridad, no una etiqueta: `'ai'` no puede publicar versiones de skills
 * vivas ni aprobar propuestas. La ruta HTTP del panel pasa `'human'`; las herramientas del agente
 * pasan `'ai'`.
 */
export function runAction({ root = centerRoot(), action, payload = {}, actor = 'human', cwd = '', now = new Date().toISOString(), hostCwd = '' } = {}) {
  const name = String(action ?? '');
  const data = payload !== null && typeof payload === 'object' ? payload : {};

  if (name === 'state') return buildSnapshot({ root, cwd, now, hostCwd, scan: data.scan !== false });

  if (name === 'open') {
    // Abrir el panel no debe escribir si el proyecto ya está en el registro: un guardado por cada
    // apertura cambia `updatedAt`, despierta al vigilante y hace creer que hubo un cambio. Sólo la
    // primera vez que se ve un proyecto se anota.
    const known = normalizeCwd(cwd) === '' ? null : findProject(loadState(root).state, cwd);
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

  if (name === 'detect') {
    const loaded = loadState(root);
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
    const walked = scanExternalSkills({ cwd: normalizeCwd(cwd), dshHome: process.env.DSH_HOME ?? '' });
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

  const mutation = withState(root, (state) => {
    switch (name) {
      case 'create':
        return createSkill(state, data, { now, actor });
      case 'publish':
        return publishVersion(state, String(data.id ?? ''), data, { now, actor });
      case 'improve':
        return proposeImprovement(state, String(data.skillId ?? data.id ?? ''), data, { now, actor });
      case 'decide':
        return decideImprovement(state, String(data.improvementId ?? ''), String(data.decision ?? ''), { now, actor, note: data.note });
      case 'toggle': {
        // Encender o apagar es del humano: la IA prepara, la persona autoriza.
        if (actor === 'ai' && data.enabled === true) {
          return { ok: false, code: 'approval-required', message: 'activar una skill en un proyecto es una decisión humana: pídeselo a la persona desde el panel' };
        }
        return toggleAssignment(state, data, { now, actor });
      }
      case 'rollback':
        if (actor === 'ai') return { ok: false, code: 'approval-required', message: 'volver a una versión anterior es una decisión humana' };
        return rollbackAssignment(state, data, { now, actor });
      case 'fork':
        return forkSkill(state, data, { now, actor });
      case 'evaluate':
        return evaluateStored(state, String(data.id ?? data.skillId ?? ''), data.version, { now });
      case 'register-project': {
        const project = ensureProject(state, String(data.cwd ?? cwd), { now, name: data.name });
        return project === null ? { ok: false, code: 'bad-cwd', message: 'la ruta no da un proyecto' } : { ok: true, project };
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
        const walked = scanExternalSkills({ cwd: normalizeCwd(cwd), dshHome: process.env.DSH_HOME ?? '' });
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
      default:
        return { ok: false, code: 'unknown-action', message: `la acción "${name}" no existe` };
    }
  }, { now });

  if (!mutation.ok) return { ok: false, code: 'store', message: 'no se pudo guardar el centro', storeError: mutation.storeError };
  const result = mutation.result ?? { ok: false, code: 'empty', message: 'la acción no devolvió nada' };

  // Un cambio de versión fijada tiene que verse en el disco en el mismo acto: si no, la asignación
  // dice 1.1.0 y el SKILL.md materializado sigue en 1.0.0 hasta que alguien pida el catálogo
  // (encontrado en la auditoría: «Usar aquí» dejaba el fichero viejo).
  if (result?.ok === true && (name === 'toggle' || name === 'rollback')) {
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
  return result;
}

/** Lo que el proveedor de skills necesita: sólo lo encendido para esta ruta. */
export function listAssignedFor({ root = centerRoot(), cwd = '' } = {}) {
  const loaded = loadState(root);
  const project = findProject(loaded.state, cwd);
  if (project === null) return { project: null, skills: [] };
  return { project, skills: assignedSkills(loaded.state, project.id) };
}
