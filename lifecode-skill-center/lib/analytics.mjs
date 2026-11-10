/**
 * Telemetría del centro, derivada del registro de eventos.
 *
 * Lo que se mide es lo que el plan pide medir, y nada más: cuánto se creó, cuánto se asignó, cuántas
 * versiones salieron, qué se carga y qué se propone. Nada de esto se guarda ya calculado: se deriva de
 * los eventos cada vez, porque un número guardado es un número que miente en cuanto alguien toca un
 * fichero a mano.
 *
 * Aviso que este módulo respeta: **una carga no es un uso**. `skill.loaded` dice que el catálogo se
 * materializó; no dice que el modelo aplicara la skill. Los dos números se muestran separados.
 */

const SERIES_DAYS = 14;

/** El día de un instante, en UTC: el registro de eventos guarda ISO y se corta, no se interpreta. */
export function dayOf(value) {
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
}

function daysBack(count, now) {
  const base = new Date(now);
  const out = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(base.getTime() - index * 86_400_000);
    out.push(date.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Serie diaria para las gráficas.
 *
 * @param {{ events: object[] }} state
 * @param {{ now?: string, days?: number }} [options]
 */
export function activitySeries(state, { now = new Date().toISOString(), days = SERIES_DAYS } = {}) {
  const labels = daysBack(days, now);
  const index = new Map(labels.map((label) => [label, { day: label, created: 0, assigned: 0, versions: 0, loads: 0, improvements: 0 }]));
  for (const event of Array.isArray(state?.events) ? state.events : []) {
    const row = index.get(dayOf(event?.at));
    if (row === undefined) continue;
    if (event.type === 'skill.created') row.created += 1;
    else if (event.type === 'skill.assigned') row.assigned += 1;
    else if (event.type === 'skill.unassigned') row.assigned = Math.max(0, row.assigned - 1);
    else if (event.type === 'skill.version') row.versions += 1;
    else if (event.type === 'skill.loaded') row.loads += 1;
    else if (event.type === 'improvement.proposed') row.improvements += 1;
  }
  return [...index.values()];
}

/** Los totales de un vistazo. */
/**
 * Resumen del centro, opcionalmente acotado a un proyecto y a una skill. El filtro no inventa una segunda
 * contabilidad: reduce la misma materia prima (asignaciones, mejoras y eventos) y deja que el resto del cálculo
 * siga siendo el único. Con filtro, «skills» significa «skills que ese proyecto tiene asignadas»; sin filtro,
 * «skills de la biblioteca».
 */
export function summarize(state, { now = new Date().toISOString(), days = SERIES_DAYS, projectId = '', skillId = '' } = {}) {
  const allSkills = Object.values(state?.skills ?? {});
  const projects = Object.values(state?.projects ?? {});
  const selectedProject = typeof projectId === 'string' ? projectId : '';
  const selectedSkill = typeof skillId === 'string' ? skillId : '';

  const assignedHere = selectedProject !== '' ? Object.keys(state?.assignments?.[selectedProject] ?? {}) : null;
  // Con una skill pedida, la descripción es la de esa skill aunque el proyecto no la tenga asignada: el filtro de
  // proyecto acota asignaciones y eventos, no borra la ficha de la skill que el usuario está mirando.
  const scopedIds = selectedSkill !== ''
    ? new Set([selectedSkill])
    : assignedHere !== null
      ? new Set(assignedHere)
      : null;
  const inScope = (id) => scopedIds === null || scopedIds.has(String(id ?? ''));

  const skills = allSkills.filter((skill) => inScope(skill.id));
  const improvements = Object.values(state?.improvements ?? {}).filter((entry) => inScope(entry.skillId));
  // Con un filtro de skill, las asignaciones de otros proyectos para esa skill siguen contando: es la misma
  // skill en varios proyectos, y esconderlo daría una lectura falsa de «cuántos proyectos la tienen».
  // Se recorta también **dentro** de cada fila: contar la fila entera daría asignaciones de otras skills al
  // filtrar por una (defecto real: 3 en vez de 2 con alfa en dos proyectos).
  const trimRow = (row) => (selectedSkill === ''
    ? row
    : Object.fromEntries(Object.entries(row ?? {}).filter(([skillIdKey]) => skillIdKey === selectedSkill)));
  const assignments = Object.fromEntries(Object.entries(state?.assignments ?? {})
    .filter(([projectIdKey, row]) => (selectedProject === '' || projectIdKey === selectedProject)
      && (selectedSkill === '' || Object.keys(trimRow(row)).length > 0))
    .map(([projectIdKey, row]) => [projectIdKey, trimRow(row)]));

  const scopedEvents = (state?.events ?? []).filter((event) =>
    (selectedProject === '' || String(event?.projectId ?? '') === selectedProject)
    && (selectedSkill === '' || String(event?.skillId ?? '') === selectedSkill));

  let activeAssignments = 0;
  let totalAssignments = 0;
  let pausedAssignments = 0;
  const projectsWithSkills = new Set();
  const skillUsage = new Map();

  for (const [projectId, row] of Object.entries(assignments)) {
    for (const [skillId, assignment] of Object.entries(row ?? {})) {
      totalAssignments += 1;
      if (assignment?.enabled === true) {
        activeAssignments += 1;
        projectsWithSkills.add(projectId);
        skillUsage.set(skillId, (skillUsage.get(skillId) ?? 0) + 1);
      } else {
        pausedAssignments += 1;
      }
    }
  }

  const versions = skills.reduce((total, skill) => total + (Array.isArray(skill.versions) ? skill.versions.length : 0), 0);
  const scores = skills
    .map((skill) => {
      const current = (skill.versions ?? []).find((version) => version.version === skill.currentVersion) ?? (skill.versions ?? []).at(-1);
      return typeof current?.evaluation?.score === 'number' ? current.evaluation.score : null;
    })
    .filter((score) => score !== null);
  const averageQuality = scores.length === 0 ? null : Math.round(scores.reduce((total, score) => total + score, 0) / scores.length);

  const proposed = improvements.filter((entry) => entry.status === 'proposed').length;
  const approved = improvements.filter((entry) => entry.status === 'approved').length;
  const rejected = improvements.filter((entry) => entry.status === 'rejected').length;
  const loads = scopedEvents.filter((event) => event?.type === 'skill.loaded').length;

  const topSkills = [...skillUsage.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, 6)
    .map(([skillId, count]) => ({ id: skillId, title: state?.skills?.[skillId]?.title ?? skillId, projects: count }));

  return {
    skills: {
      total: skills.length,
      published: skills.filter((skill) => skill.status === 'published').length,
      deprecated: skills.filter((skill) => skill.status === 'deprecated').length,
      withVersions: skills.filter((skill) => (skill.versions ?? []).length > 1).length,
      versions,
    },
    projects: {
      registered: projects.length,
      withActiveSkills: projectsWithSkills.size,
    },
    assignments: { active: activeAssignments, paused: pausedAssignments, total: totalAssignments },
    improvements: { proposed, approved, rejected, total: improvements.length },
    quality: { average: averageQuality, measured: scores.length },
    loads,
    topSkills,
    series: activitySeries({ ...state, events: scopedEvents }, { now, days }),
  };
}
