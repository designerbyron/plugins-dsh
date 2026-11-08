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
export function summarize(state, { now = new Date().toISOString(), days = SERIES_DAYS } = {}) {
  const skills = Object.values(state?.skills ?? {});
  const projects = Object.values(state?.projects ?? {});
  const improvements = Object.values(state?.improvements ?? {});
  const assignments = state?.assignments ?? {};

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
  const loads = (state?.events ?? []).filter((event) => event?.type === 'skill.loaded').length;

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
    series: activitySeries(state, { now, days }),
  };
}
