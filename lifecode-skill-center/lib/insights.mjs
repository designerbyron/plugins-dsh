/**
 * Indicadores analíticos del centro, con filtros explícitos.
 *
 * Este módulo responde a la pregunta que la analítica tiene que contestar de verdad: *qué skills aportan
 * valor, dónde se usan, cómo evolucionan y qué conviene mejorar*. Se calcula todo derivado del registro de
 * eventos y del documento del centro; no se guarda ningún número precalculado, porque un número guardado
 * miente en cuanto alguien toca un fichero.
 *
 * Tres reglas que este módulo no rompe:
 *
 * 1. **Una carga no es una aplicación.** `skill.loaded` dice que el catálogo ofreció la skill al modelo; no
 *    dice que la aplicara. Los dos conceptos se publican por separado y con su nombre.
 * 2. **Cada indicador declara su fuente.** `definition` dice qué se cuenta; `source` de dónde sale. Sin eso,
 *    dos pantallas acaban llamando «uso» a dos cosas distintas.
 * 3. **Los filtros no cambian el significado.** Acotan la misma materia prima; nunca recalculan la métrica de
 *    otra forma para que el número salga bonito.
 */

const MAX_EVENT_ROWS = 200;

/** Tipos de evento que el centro escribe hoy. La lista es el contrato de los filtros «tipo». */
export const EVENT_TYPES = [
  'skill.created',
  'skill.assigned',
  'skill.unassigned',
  'skill.version',
  'skill.advanced',
  'skill.rollback',
  'skill.loaded',
  'skill.applied',
  'skill.requested',
  'skill.request-fulfilled',
  'skill.request-dismissed',
  'improvement.proposed',
  'improvement.approved',
  'improvement.rejected',
  'store.migrated',
  'store.restored',
  'store.backup',
];

/** Cómo se llama cada indicador cuando hay que explicarlo. Se publica con el resultado. */
const DEFINITIONS = {
  applications: {
    definition: 'Declaraciones explícitas de que alguien aplicó la skill (`skill.applied`), con su nota.',
    source: 'events:skill.applied',
    limits: 'Es una declaración: no se puede verificar desde aquí. Sirve para separar «se entregó» de «se usó», y una entrega sin declaración no se cuenta como aplicación.',
  },
  deliveries: {
    definition: 'Veces que el catálogo del proyecto ofreció la skill al modelo (`skill.loaded`).',
    source: 'events:skill.loaded',
    limits: 'No prueba que el modelo la aplicara: sólo que el catálogo la entregó.',
  },
  qualityPerVersion: {
    definition: 'Nota de la evaluación de cada versión publicada, en orden de creación.',
    source: 'skills[].versions[].evaluation.score',
    limits: 'La nota la produce la evaluación del producto; no es una medida de resultados en tarea.',
  },
  rollbacks: {
    definition: 'Reversiones de pin registradas en el diario (`skill.rollback`): una persona o el motor devolvieron una asignación a la versión anterior.',
    source: 'events:skill.rollback',
    limits: 'Cuenta reversiones, no éxitos: una reversión puede ser una prueba. No dice si la skill se aplicó ni por qué se revirtió (eso vive en la decisión del ledger).',
  },
  pinsBehind: {
    definition: 'Asignaciones cuya versión fijada no es la vigente de la skill.',
    source: 'assignments × skills[].currentVersion',
    limits: 'Ir por detrás es legítimo: publicar no mueve un pin a propósito.',
  },
  references: {
    definition: 'Referencias añadidas, quitadas o cambiadas entre versiones consecutivas.',
    source: 'skills[].versions[].references',
    limits: 'Compara el contenido de la referencia, no si el texto citado sigue siendo correcto.',
  },
  top: {
    definition: 'Skills ordenadas por número de proyectos que las tienen encendidas.',
    source: 'assignments[].enabled',
    limits: 'Encendida no es usada; para eso están las entregas y, cuando exista, la aplicación.',
  },
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Corta un instante a su día UTC, con el mismo criterio que la serie de actividad. */
function dayOf(value) {
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const list = [];
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return list;
  // Tope defensivo: una consulta no puede pedir cinco años de barras y colapsar el DOM.
  const maxDays = 120;
  for (let time = start; time <= end && list.length < maxDays; time += 86_400_000) {
    list.push(new Date(time).toISOString().slice(0, 10));
  }
  return list;
}

/**
 * Dos dimensiones derivadas del evento, porque el diario no guarda «estado» ni «resultado».
 *
 * - **estado**: qué pasó con la propuesta que cuenta el evento (`pending`, `approved`, `rejected`,
 *   `applied`), o `other` si el evento no habla de una decisión.
 * - **resultado**: si el evento cuenta algo que salió bien (`ok`), algo que falló (`failed`) o un
 *   movimiento neutro (`info`).
 *
 * Se derivan aquí y no en la interfaz: la regla vale para la ruta, el panel y las pruebas, y se puede
 * explicar en una frase. Derivar en cada sitio sería la forma de que dos vistas dijeran cosas distintas.
 */
export const EVENT_STATUSES = ['pending', 'approved', 'rejected', 'applied', 'other'];
export const EVENT_RESULTS = ['ok', 'failed', 'info'];

export function eventStatus(event) {
  const type = String(event?.type ?? '');
  if (type === 'improvement.proposed') return 'pending';
  if (type === 'improvement.approved') return 'approved';
  if (type === 'improvement.rejected') return 'rejected';
  if (type === 'skill.applied') return 'applied';
  return 'other';
}

export function eventResult(event) {
  const type = String(event?.type ?? '');
  if (/(\.failed$|\.error$|-failed$)/.test(type)) return 'failed';
  if (/(\.proposed$|\.created$|\.loaded$|\.assigned$|\.unassigned$|\.advanced$|\.rolled-back$|\.rollback$|\.requested$|\.request-fulfilled$|\.exported$|\.insight$|\.policy$|\.restored$|\.migrated$|\.imported$|\.evaluated$|\.published$|\.version$|\.applied$|\.approved$)/.test(type)) return 'ok';
  return 'info';
}

/** Texto de filtro: recortado y sin espacios. Un parámetro vacío significa «sin filtro». */
function textOf(value, limit = 120) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/**
 * Normaliza los filtros que llegan de la ruta o del panel.
 *
 * Se aceptan tanto `from`/`to` (fechas ISO) como `days` (ventana hacia atrás). Si vienen los dos, manda el
 * rango explícito: lo que la persona escribió gana a un valor por defecto.
 */
export function parseFilters(params = {}, { now = new Date().toISOString(), days = 14 } = {}) {
  const read = (key) => (typeof params?.get === 'function' ? params.get(key) : params?.[key]);
  const fromRaw = textOf(read('from') ?? '', 32);
  const toRaw = textOf(read('to') ?? '', 32);
  const daysRaw = Number.parseInt(String(read('days') ?? ''), 10);
  const window = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, daysRaw)) : days;
  const today = dayOf(now);
  const fallbackFrom = new Date(new Date(`${today}T00:00:00.000Z`).getTime() - (window - 1) * 86_400_000).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : fallbackFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : today;
  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    projectId: textOf(read('project') ?? ''),
    skillId: textOf(read('skill') ?? ''),
    version: textOf(read('version') ?? ''),
    type: textOf(read('type') ?? '', 60),
    status: textOf(read('status') ?? '', 40),
    result: textOf(read('result') ?? '', 40),
  };
}

function referencesOf(version) {
  const out = new Map();
  for (const [key, value] of Object.entries(isObject(version?.references) ? version.references : {})) {
    out.set(String(key), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return out;
}

function scoreOf(version) {
  const evaluation = isObject(version?.evaluation) ? version.evaluation : {};
  for (const candidate of [version?.score, evaluation.score, evaluation.total]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

/**
 * Compara dos versiones consecutivas y dice qué pasó con las referencias.
 *
 * Se compara el contenido, no la clave: cambiar el cuerpo de una referencia es un cambio aunque la lista de
 * nombres sea idéntica. Es la diferencia entre «tiene la misma lista» y «dice lo mismo».
 */
export function compareReferences(beforeVersion, afterVersion) {
  const before = referencesOf(beforeVersion);
  const after = referencesOf(afterVersion);
  const added = [...after.keys()].filter((key) => !before.has(key));
  const removed = [...before.keys()].filter((key) => !after.has(key));
  const modified = [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key));
  return { added, removed, modified };
}

/**
 * El cuerpo de los indicadores. Todo se calcula en una pasada sobre los eventos y otra sobre las skills.
 *
 * @param {object} state documento del centro
 * @param {{ now?: string, filters?: ReturnType<typeof parseFilters> }} [options]
 */
export function buildInsights(state, { now = new Date().toISOString(), filters = parseFilters({}, { now }) } = {}) {
  const applied = { ...parseFilters({}, { now }), ...(isObject(filters) ? filters : {}) };
  const skills = Object.values(state?.skills ?? {});
  const improvements = Object.values(state?.improvements ?? {});
  const assignments = isObject(state?.assignments) ? state.assignments : {};

  const fromStamp = `${applied.from}T00:00:00.000Z`;
  const toStamp = `${applied.to}T23:59:59.999Z`;

  const byType = new Map();
  const matched = [];
  for (const event of Array.isArray(state?.events) ? state.events : []) {
    const at = String(event?.at ?? '');
    if (at < fromStamp || at > toStamp) continue;
    if (applied.projectId !== '' && String(event?.projectId ?? '') !== applied.projectId) continue;
    if (applied.skillId !== '' && String(event?.skillId ?? '') !== applied.skillId) continue;
    if (applied.version !== '' && String(event?.version ?? '') !== applied.version) continue;
    if (applied.type !== '' && String(event?.type ?? '') !== applied.type) continue;
    // «Estado» y «Resultado» se derivan del tipo de evento con una regla única (ver eventStatus/eventResult):
    // así el filtro dice algo verdadero y contrastable, en vez de descartar familias enteras de eventos.
    if (applied.status !== '' && eventStatus(event) !== applied.status) continue;
    if (applied.result !== '' && eventResult(event) !== applied.result) continue;
    byType.set(event.type, (byType.get(event.type) ?? 0) + 1);
    matched.push(event);
  }

  const days = daysBetween(applied.from, applied.to);
  const series = new Map(days.map((day) => [day, { day, created: 0, assigned: 0, versions: 0, loads: 0, improvements: 0 }]));
  for (const event of matched) {
    const row = series.get(dayOf(event.at));
    if (row === undefined) continue;
    if (event.type === 'skill.created') row.created += 1;
    else if (event.type === 'skill.assigned') row.assigned += 1;
    else if (event.type === 'skill.unassigned') row.assigned = Math.max(0, row.assigned - 1);
    else if (event.type === 'skill.version') row.versions += 1;
    else if (event.type === 'skill.loaded') row.loads += 1;
    else if (event.type === 'improvement.proposed') row.improvements += 1;
  }

  const projectNames = new Map(Object.values(state?.projects ?? {}).map((project) => [project.id, project.name ?? project.id]));
  const enabledIn = new Map();
  const pinsBehind = [];
  const projectsCompare = new Map();
  for (const [projectId, row] of Object.entries(assignments)) {
    const rowStats = projectsCompare.get(projectId) ?? { projectId, name: projectNames.get(projectId) ?? projectId, active: 0, paused: 0, skills: 0, loads: 0, improvements: 0 };
    for (const [skillId, assignment] of Object.entries(isObject(row) ? row : {})) {
      rowStats.skills += 1;
      if (assignment?.enabled === true) {
        rowStats.active += 1;
        const list = enabledIn.get(skillId) ?? [];
        list.push(projectId);
        enabledIn.set(skillId, list);
      } else {
        rowStats.paused += 1;
      }
      const skill = state?.skills?.[skillId];
      const current = String(skill?.currentVersion ?? '');
      const pinned = String(assignment?.version ?? '');
      if (current !== '' && pinned !== '' && pinned !== current) {
        pinsBehind.push({ projectId, skillId, title: skill?.title ?? skillId, version: pinned, currentVersion: current, enabled: assignment?.enabled === true });
      }
    }
    projectsCompare.set(projectId, rowStats);
  }

  for (const event of matched) {
    if (event.type !== 'skill.loaded') continue;
    const stats = projectsCompare.get(String(event.projectId ?? ''));
    if (stats !== undefined) stats.loads += 1;
  }
  for (const improvement of improvements) {
    for (const list of projectsCompare.values()) {
      if (applied.projectId !== '' && list.projectId !== applied.projectId) continue;
      if (applied.skillId !== '' && improvement.skillId !== applied.skillId) continue;
      if (list.projectId === applied.projectId) list.improvements += 1;
    }
  }

  const skillsCompare = [];
  const qualityPerVersion = [];
  const referenceChanges = [];
  const totals = { added: 0, removed: 0, modified: 0 };
  for (const skill of skills) {
    if (applied.skillId !== '' && skill.id !== applied.skillId) continue;
    const versions = Array.isArray(skill.versions) ? skill.versions : [];
    const loads = matched.filter((event) => event.type === 'skill.loaded' && String(event.skillId ?? '') === skill.id).length;
    const enabledProjects = enabledIn.get(skill.id) ?? [];
    const behind = pinsBehind.filter((pin) => pin.skillId === skill.id).length;
    let previous = null;
    let previousScore = null;
    let change = { added: 0, removed: 0, modified: 0 };
    for (const version of versions) {
      const score = scoreOf(version);
      if (score !== null) {
        qualityPerVersion.push({
          skillId: skill.id,
          title: skill.title ?? skill.id,
          version: version.version,
          score,
          status: version.evaluation?.status ?? version.status ?? null,
          createdAt: version.createdAt ?? '',
          delta: previousScore === null ? null : score - previousScore,
        });
        previousScore = score;
      }
      if (previous !== null) {
        const diff = compareReferences(previous, version);
        if (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) {
          referenceChanges.push({ skillId: skill.id, title: skill.title ?? skill.id, from: previous.version, to: version.version, ...diff });
          change = { added: change.added + diff.added.length, removed: change.removed + diff.removed.length, modified: change.modified + diff.modified.length };
          totals.added += diff.added.length;
          totals.removed += diff.removed.length;
          totals.modified += diff.modified.length;
        }
      }
      previous = version;
    }
    const currentScore = scoreOf(versions.find((version) => version.version === skill.currentVersion) ?? versions.at(-1));
    skillsCompare.push({
      skillId: skill.id,
      title: skill.title ?? skill.id,
      versions: versions.length,
      currentVersion: skill.currentVersion ?? null,
      quality: currentScore,
      enabledProjects: enabledProjects.length,
      pausedProjects: Object.entries(assignments).filter(([, row]) => isObject(row?.[skill.id]) && row[skill.id].enabled !== true).length,
      loads,
      pinsBehind: behind,
      references: change,
      pendingImprovements: improvements.filter((entry) => entry.skillId === skill.id && entry.status === 'proposed').length,
    });
  }

  const improvementsSummary = {
    proposed: improvements.filter((entry) => entry.status === 'proposed').length,
    approved: improvements.filter((entry) => entry.status === 'approved').length,
    rejected: improvements.filter((entry) => entry.status === 'rejected').length,
  };
  improvementsSummary.total = improvementsSummary.proposed + improvementsSummary.approved + improvementsSummary.rejected;
  // La tasa se calcula sólo sobre lo decidido: contar las pendientes como «no aprobadas» daría una tasa que
  // baja cada vez que alguien propone algo, que es justo lo contrario de lo que mide.
  improvementsSummary.approvalRate = improvementsSummary.approved + improvementsSummary.rejected === 0
    ? null
    : Math.round((improvementsSummary.approved / (improvementsSummary.approved + improvementsSummary.rejected)) * 100);

  // Directiva §6: se separa «se entregó» de «se usó». Una declaración no se deduce de una entrega, así que
  // la brecha cuenta entregas de skills que nadie declaró: no se inventa el resto de la diferencia.
  const applicationEvents = matched.filter((event) => event.type === 'skill.applied');
  const declarationsBySkill = new Map();
  for (const event of applicationEvents) {
    const key = String(event.skillId ?? '');
    if (key === '') continue;
    declarationsBySkill.set(key, (declarationsBySkill.get(key) ?? 0) + 1);
  }
  const applications = {
    total: applicationEvents.length,
    bySkill: [...declarationsBySkill.entries()]
      .map(([skillId, declarations]) => ({ skillId, title: state?.skills?.[skillId]?.title ?? skillId, declarations }))
      .sort((left, right) => right.declarations - left.declarations || left.skillId.localeCompare(right.skillId)),
  };
  const deliveriesWithoutDeclaration = skillsCompare
    .reduce((total, entry) => total + ((declarationsBySkill.get(entry.skillId) ?? 0) === 0 ? entry.loads : 0), 0);

  const rollbackEvents = matched.filter((event) => event.type === 'skill.rollback');
  const rollbacksBySkill = new Map();
  for (const event of rollbackEvents) {
    const key = String(event.skillId ?? '');
    if (key === '') continue;
    rollbacksBySkill.set(key, (rollbacksBySkill.get(key) ?? 0) + 1);
  }
  const rollbacks = {
    total: rollbackEvents.length,
    latestAt: rollbackEvents.length > 0 ? String(rollbackEvents[rollbackEvents.length - 1].at ?? '') : '',
    bySkill: [...rollbacksBySkill.entries()]
      .map(([skillId, count]) => ({ skillId, title: state?.skills?.[skillId]?.title ?? skillId, count }))
      .sort((left, right) => right.count - left.count || left.skillId.localeCompare(right.skillId)),
  };

  const orderedByProjects = [...skillsCompare].sort((left, right) => right.enabledProjects - left.enabledProjects
    || right.loads - left.loads
    || left.skillId.localeCompare(right.skillId));

  return {
    ok: true,
    generatedAt: now,
    filters: applied,
    options: { statuses: EVENT_STATUSES, results: EVENT_RESULTS },
    window: { from: applied.from, to: applied.to, days: days.length },
    events: {
      total: Array.isArray(state?.events) ? state.events.length : 0,
      matched: matched.length,
      byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
      recent: matched.slice(-MAX_EVENT_ROWS).reverse().map((event) => ({
        id: event.id, at: event.at, type: event.type, actor: event.actor ?? '',
        projectId: event.projectId ?? '', skillId: event.skillId ?? '', version: event.version ?? '', note: event.note ?? '',
        status: eventStatus(event), result: eventResult(event),
      })),
      truncated: matched.length > MAX_EVENT_ROWS,
    },
    series: [...series.values()],
    applications,
    rollbacks,
    deliveries: {
      total: matched.filter((event) => event.type === 'skill.loaded').length,
      withoutDeclaration: deliveriesWithoutDeclaration,
      byProject: [...projectsCompare.values()].filter((entry) => entry.loads > 0).map((entry) => ({ projectId: entry.projectId, name: entry.name, loads: entry.loads })),
    },
    projects: [...projectsCompare.values()].sort((left, right) => left.projectId.localeCompare(right.projectId)),
    skills: orderedByProjects,
    topSkills: orderedByProjects.slice(0, 5),
    leastUsed: [...orderedByProjects].reverse().slice(0, 5),
    pinsBehind: pinsBehind.sort((left, right) => left.projectId.localeCompare(right.projectId) || left.skillId.localeCompare(right.skillId)),
    qualityPerVersion,
    references: { totals, changes: referenceChanges },
    improvements: improvementsSummary,
    definitions: DEFINITIONS,
  };
}
