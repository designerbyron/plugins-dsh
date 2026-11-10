import { similarSkills } from './similarity.mjs';
/**
 * Compuerta de decisiones autónomas sobre el ciclo de vida de una Skill.
 *
 * El addendum autoriza a la IA a crear, aprobar, publicar, asignar, activar y mover pines **cuando
 * disponga de evidencia suficiente**, y le prohíbe hacerlo por confianza subjetiva. Este módulo traduce
 * esa frase a reglas deterministas que se pueden probar:
 *
 * - El nivel de evidencia se calcula, no se declara: una petición explícita de una persona o dos
 *   hallazgos independientes y verificados son `strong`; uno solo es `moderate`; sin verificación, `weak`.
 * - Cada operación tiene su lista de compuertas con un mínimo distinto: publicar o activar exige `strong`
 *   y evaluación satisfactoria; crear o mejorar admite `moderate` y deja la Skill en borrador.
 * - Una decisión humana explícita manda: si la persona apagó una asignación, la IA no la vuelve a
 *   encender por su cuenta, aunque tenga evidencia fuerte. Puede recomendar reconsiderarla.
 * - Toda decisión devuelve su justificación y su rollback, para que el registro sea auditable.
 *
 * El módulo es puro: recibe el estado del centro y el del registro de conocimiento, y no escribe nada.
 */
import { policyFor } from './knowledge.mjs';

export const OPERATION_RULES = {
  // Preparar una Skill (crear el borrador, proponer una mejora) no cambia lo que ningún proyecto ejecuta:
  // se permite con cualquier nivel de evidencia y queda registrado con el nivel real, que es lo auditable.
  'create-skill': { minLevel: 'weak', requiresEvaluation: false, needsProject: false, reversible: true },
  'improve-skill': { minLevel: 'weak', requiresEvaluation: false, needsProject: false, reversible: true },
  approve: { minLevel: 'strong', requiresEvaluation: true, needsProject: false, reversible: true },
  publish: { minLevel: 'strong', requiresEvaluation: true, needsProject: false, reversible: false },
  assign: { minLevel: 'strong', requiresEvaluation: true, needsProject: true, reversible: true },
  activate: { minLevel: 'strong', requiresEvaluation: true, needsProject: true, reversible: true },
  deactivate: { minLevel: 'moderate', requiresEvaluation: false, needsProject: true, reversible: true },
  'advance-pin': { minLevel: 'strong', requiresEvaluation: true, needsProject: true, reversible: true },
  rollback: { minLevel: 'strong', requiresEvaluation: false, needsProject: true, reversible: true },
};

const LEVEL_RANK = { weak: 0, moderate: 1, strong: 2 };

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function atLeast(level, minimum) {
  return LEVEL_RANK[level] >= LEVEL_RANK[minimum];
}

/** Un hallazgo vale como evidencia si trae al menos una verificación descrita. */
function verifiedInsight(insight) {
  return list(insight.evidence).some((item) => isPlainObject(item) && text(item.verification) !== '');
}

/**
 * Huella del contenido. Dos copias del mismo hallazgo no son dos observaciones: la compuerta cuenta
 * huellas distintas, no identificadores distintos (RT-D4).
 */
function insightFingerprint(insight) {
  const evidence = list(insight.evidence).map((item) => [text(item.location), text(item.verification), text(item.result)]);
  return JSON.stringify([text(insight.title), text(insight.summary), evidence]);
}

/** Una contradicción abierta no es evidencia: dos resultados distintos sobre el mismo lugar se frenan. */
function contradictionIn(insights) {
  const byPlace = new Map();
  for (const insight of insights) {
    for (const item of list(insight.evidence)) {
      if (!isPlainObject(item)) continue;
      const place = text(item.location);
      const result = text(item.result);
      if (place === '' || result === '') continue;
      const seen = byPlace.get(place);
      if (seen === undefined) byPlace.set(place, result);
      else if (seen !== result) return { place, left: seen, right: result };
    }
  }
  return null;
}

function insightSources(insights) {
  const sources = new Set();
  for (const insight of insights) {
    const key = text(insight.sourceAgent) || text(insight.parentRunId) || text(insight.taskId) || insight.insightId;
    if (key !== '') sources.add(key);
  }
  return sources;
}

/**
 * Calcula el nivel de evidencia de una propuesta.
 * `explicitRequest` sólo llega aquí derivado por el servidor de una petición humana pendiente: nunca se
 * lee del payload (RT-D2). Dos copias del mismo texto no suman fuentes (RT-D4) y una contradicción frena.
 */
export function evidenceLevel({ insights = [], explicitRequest = false } = {}) {
  const usable = list(insights).filter((insight) => ['received', 'triaged', 'validated'].includes(text(insight.state)));
  const verified = usable.filter(verifiedInsight);
  const conflict = contradictionIn(verified);
  if (conflict !== null) {
    return {
      level: 'weak',
      reason: 'dos hallazgos se contradicen en ' + conflict.place + ': "' + conflict.left + '" y "' + conflict.right + '"',
      verified: 0,
      sources: 0,
      contradiction: conflict,
    };
  }
  if (explicitRequest === true) {
    return { level: 'strong', reason: 'la persona pidió esta Skill de forma explícita', verified: verified.length, sources: 1 };
  }
  if (verified.length === 0) {
    return { level: 'weak', reason: 'ningún hallazgo aporta una verificación descrita', verified: 0, sources: insightSources(usable).size };
  }
  const distinct = new Map();
  for (const insight of verified) {
    const fingerprint = insightFingerprint(insight);
    if (!distinct.has(fingerprint)) distinct.set(fingerprint, new Set());
    distinct.get(fingerprint).add(text(insight.sourceAgent) || text(insight.parentRunId) || insight.insightId);
  }
  const observations = distinct.size;
  const sources = insightSources(verified).size;
  if (observations >= 2) {
    return { level: 'strong', reason: observations + ' observaciones distintas desde ' + sources + ' fuentes', verified: verified.length, sources };
  }
  return {
    level: 'moderate',
    reason: verified.length + ' hallazgo(s) verificado(s) pero sin dos observaciones independientes',
    verified: verified.length,
    sources,
  };
}

function latestVersion(skill) {
  const versions = list(skill?.versions);
  return versions.length === 0 ? null : versions[versions.length - 1];
}

function evaluationOf(version) {
  const evaluation = isPlainObject(version?.evaluation) ? version.evaluation : {};
  const status = text(evaluation.status);
  const score = Number(evaluation.score);
  return { status, score: Number.isFinite(score) ? score : null };
}

/**
 * Evalúa si la IA puede ejecutar `operation` sobre `skillId`/`projectId` con la evidencia disponible.
 * Devuelve `{ ok, level, gates, justification, rollback }` o un rechazo con código y explicación.
 */
/**
 * Elector «skill nueva o mejora» (criterio 2 del ADDENDUM).
 *
 * Es una recomendación explicada, no un acto: dice qué operación encaja y por qué, y deja que el
 * agente o la persona la acepten. Se apoya en el mismo parecido que el aviso de duplicados para que
 * no existan dos criterios distintos en el producto.
 */
export function chooseOperation({ state, title = '', description = '', tags = [], explicitRequest = false } = {}) {
  const normalizedTags = Array.isArray(tags) ? tags.map((tag) => String(tag)) : [];
  if (String(title).trim() === '' || String(description).trim() === '') {
    return { ok: false, code: 'candidate-required', message: 'necesito al menos un título y una descripción para elegir' };
  }

  const similar = similarSkills(state, { title, description, tags: normalizedTags });
  const best = similar[0] ?? null;
  if (best === null) {
    return {
      ok: true,
      operation: 'create-skill',
      reasons: ['no hay ninguna skill parecida en la biblioteca'],
      similar: [],
      explicitRequest,
    };
  }

  const reasons = [];
  if (best.reasons.includes('mismo título')) reasons.push('ya existe una skill con ese título');
  if (best.reasons.some((reason) => reason.startsWith('etiquetas en común'))) reasons.push('comparte etiquetas con una skill existente');
  if (best.reasons.includes('descripción muy parecida')) reasons.push('la descripción se solapa con una existente');

  return {
    ok: true,
    operation: 'improve-skill',
    skillId: best.id,
    reasons,
    similar: similar.slice(0, 5),
    explicitRequest,
  };
}

export function evaluateDecision({
  state = {},
  knowledge = {},
  operation,
  skillId = '',
  projectId = '',
  insightIds = [],
  explicitRequest = false,
  insights: extraInsights = [],
  now = new Date().toISOString(),
} = {}) {
  const rule = OPERATION_RULES[text(operation)];
  if (!rule) return { ok: false, code: 'operation-unknown', detail: text(operation) };

  const skills = isPlainObject(state.skills) ? state.skills : {};
  const skill = text(skillId) === '' ? null : skills[text(skillId)];
  // Dos reglas distintas, y la diferencia importa: preparar (crear, mejorar, apagar) puede apoyarse en
  // cualquier hallazgo evaluable del registro, pero una operación que exige evidencia STRONG sólo cuenta
  // los hallazgos que el llamador cita. Si no cita ninguno, no hay evidencia atribuible a esta decisión.
  const knownInsights = list(knowledge.insights);
  const evaluable = (insight) => ['received', 'triaged', 'validated'].includes(text(insight.state));
  const selected = rule.minLevel === 'strong'
    ? (insightIds.length === 0 ? [] : knownInsights.filter((insight) => insightIds.includes(insight.insightId)))
    : (insightIds.length === 0
      ? knownInsights.filter(evaluable)
      : knownInsights.filter((insight) => insightIds.includes(insight.insightId)));
  const evidence = evidenceLevel({ insights: [...selected, ...list(extraInsights)], explicitRequest });

  const policy = policyFor(knowledge, projectId);
  const gates = [];
  const gate = (id, ok, detail) => gates.push({ id, ok: ok === true, detail: text(detail) });

  // §6 de la directiva: sin una concesión explícita de una persona no hay autonomía.
  // El defecto del producto es `human-approved`; sólo un modo concedido (proyecto o global) autoriza.
  // Preparar (borrador o propuesta) no cambia lo que ningún proyecto ejecuta: en modo
  // human-approved la IA puede preparar sin concesión. Lo que toca proyectos exige concesión explícita.
  const preparesOnly = rule.minLevel === 'weak';
  const autonomyGranted = policy.mode === 'guarded-autonomous' && policy.source !== 'default';
  gate('policy', preparesOnly || autonomyGranted, preparesOnly
    ? 'preparar no cambia lo que ejecuta ningún proyecto'
    : autonomyGranted
      ? `autonomía concedida explícitamente (${policy.source})`
      : 'el proyecto está en modo human-approved: la IA sólo prepara');
  gate('evidence', atLeast(evidence.level, rule.minLevel), `evidencia ${evidence.level} (${evidence.reason}); se exige ${rule.minLevel}`);

  if (rule.needsProject) {
    const projects = isPlainObject(state.projects) ? state.projects : {};
    gate('project', text(projectId) !== '' && isPlainObject(projects[text(projectId)]), text(projectId) === '' ? 'falta el proyecto' : `proyecto ${text(projectId)}`);
  }

  // Preparar (crear o proponer) no exige que la Skill exista: si no existe, lo dice la propia operación
  // con su código `missing-skill`, que es más preciso que un rechazo de compuerta.
  if (text(operation) !== 'create-skill' && text(operation) !== 'improve-skill') {
    gate('skill', skill !== null && skill !== undefined, skill ? `skill ${text(skillId)}` : `no existe la skill ${text(skillId)}`);
  }

  if (rule.requiresEvaluation && skill) {
    const version = latestVersion(skill);
    const evaluation = evaluationOf(version);
    const passing = evaluation.status === 'pass' && evaluation.score !== null && evaluation.score >= 90;
    gate('evaluation', passing, `evaluación ${evaluation.status || 'sin estado'} · ${evaluation.score === null ? 'sin nota' : `${evaluation.score}/100`}; se exige pass y ≥ 90`);
  }

  if (rule.needsProject && text(projectId) !== '') {
    const assignments = isPlainObject(state.assignments) ? state.assignments : {};
    const row = isPlainObject(assignments[text(projectId)]) ? assignments[text(projectId)][text(skillId)] : undefined;
    // Una decisión humana explícita manda: si apagó la asignación, la IA no la enciende por su cuenta.
    const humanVeto = isPlainObject(row) && row.enabled === false && text(row.by) === 'human';
    gate('human-veto', !humanVeto, humanVeto
      ? 'la persona apagó esta asignación: la IA puede recomendar, no encender'
      : 'sin decisión humana en contra');
  }

  const failed = gates.filter((item) => !item.ok);
  const justification = {
    operation: text(operation),
    evidenceLevel: evidence.level,
    evidenceReason: evidence.reason,
    policy: `${policy.mode} (${policy.source})`,
    gates,
    insightIds: selected.map((insight) => insight.insightId),
    decidedAt: now,
  };

  if (failed.length > 0) {
    const code = failed.some((item) => item.id === 'human-veto') ? 'human-decision'
      : failed.some((item) => item.id === 'policy') ? 'policy-human-approved'
        : failed.some((item) => item.id === 'evidence') ? 'insufficient-evidence'
          : 'gate-failed';
    return {
      ok: false,
      code,
      detail: failed.map((item) => `${item.id}: ${item.detail}`).join(' · '),
      level: evidence.level,
      gates,
      justification: `rechazada (${code}): ${failed.map((item) => `${item.id} (${item.detail})`).join('; ')}`,
    };
  }

  return {
    ok: true,
    level: evidence.level,
    gates,
    outcome: text(operation),
    justification: `permitida: evidencia ${evidence.level} (${evidence.reason}), ${policy.mode}`,
    rollback: rule.reversible
      ? { available: true, operation: text(operation) === 'activate' ? 'deactivate' : 'restore-previous', detail: 'el estado anterior queda en el registro de decisiones' }
      : { available: true, operation: 'restore-backup', detail: 'una versión publicada no se borra: se publica otra o se restaura una copia' },
  };
}
