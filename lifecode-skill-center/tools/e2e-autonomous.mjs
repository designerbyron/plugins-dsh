#!/usr/bin/env node
/**
 * E2E del ciclo autónomo (`guarded-autonomous`) del LifeCode Skill Center.
 *
 * Recorre, sobre un almacén temporal y dos proyectos temporales, el recorrido que la directiva de la
 * ronda 11 exige: necesidad, hallazgo de un subagente, validación por el agente principal, decisión
 * registrada, publicación inmutable, asignación, activación en A, aislamiento de B, veto humano,
 * mejora publicada, avance de pin, rollback autónomo y cierre `acted-on` sólo tras una acción correcta.
 *
 *   node tools/e2e-autonomous.mjs
 *
 * Reglas del arnés:
 * - Sólo almacén y workspaces temporales; el almacén real se lee únicamente para medir su huella.
 * - Usa `runAction`/`handleApiRequest` (las rutas públicas del producto), no funciones internas de operación.
 * - Imprime PASS/FAIL por paso y sale con 1 si algo falla; escribe `_audit/E2E-AUTONOMO.md`.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleApiRequest, runAction } from '../lib/api.mjs';
import { defaultRoot } from '../lib/state.mjs';
import { candidate, tempProject, tempRoot } from '../tests/helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CENTER = resolve(HERE, '..');
const REPO = resolve(CENTER, '..');
const REPORT = join(REPO, '_audit', 'E2E-AUTONOMO.md');

const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T12:20:00.000Z';
const LATER2 = '2026-11-09T12:40:00.000Z';

const steps = [];
function step(name, fn) {
  try {
    const detail = fn();
    steps.push({ name, ok: true, detail: String(detail ?? '') });
  } catch (error) {
    steps.push({ name, ok: false, detail: String(error?.message ?? error) });
  }
}
function assert(condition, message) {
  if (condition !== true) throw new Error(message);
}

const realRoot = defaultRoot();
const realFile = join(realRoot, 'center.json');
const before = existsSync(realFile)
  ? { size: statSync(realFile).size, sha: createHash('sha256').update(readFileSync(realFile)).digest('hex') }
  : { size: 0, sha: '' };

const store = tempRoot('lsc-autonomous');
const workspace = tempRoot('lsc-autonomous-ws');
const cwdA = tempProject('proyecto-a', workspace);
const cwdB = tempProject('proyecto-b', workspace);

const projectIdOf = (name) => {
  const found = Object.values(snapshot().projects ?? {}).find((project) => project.name === name) ?? null;
  if (found === null) throw new Error(`el proyecto ${name} no está registrado`);
  return found.id;
};

const act = (action, payload = {}, options = {}) => runAction({
  root: store,
  action,
  payload,
  actor: options.actor ?? 'ai',
  cwd: options.cwd ?? cwdA,
  now: options.now ?? NOW,
});
const snapshot = (options = {}) => runAction({ root: store, action: 'state', cwd: '', now: options.now ?? LATER2 });
const skillOf = (snap, id) => (snap.skills ?? []).find((skill) => skill.id === id) ?? null;
const assignmentOf = (snap, projectId, skillId) => (snap.assignments?.[projectId] ?? {})[skillId] ?? null;

let projectA = null;
let projectB = null;
let requestId = '';
let insightId = 'lsc-autonomous-insight-1';
let skillId = 'autonomous-skill';

const BODY_1 = '## Procedimiento\n\nLee el manifiesto de un plugin, ejecuta su suite de pruebas y compara la huella del perfil antes y después. Anota lo que falta con el comando que lo arregla.\n\n## Evidencia\n\nDeja el resultado de las pruebas y el estado de git en la misma salida; si algo no se verificó, dilo.';
const BODY_2 = '## Procedimiento\n\nLee el manifiesto de un plugin, ejecuta su suite de pruebas, compara la huella del perfil antes y después y revisa que ninguna escritura caiga fuera de la raíz del proyecto.\n\n## Evidencia\n\nDeja el resultado de las pruebas, el estado de git y la huella del perfil en la misma salida; si algo no se verificó, dilo.\n\n## Trampas\n\nUn plugin puede escribir en `%TEMP%` y seguir pasando la suite: la huella es del perfil, no del disco.';


// 1 · Preparación: dos proyectos, política efectiva declarada por el servidor.
step('1 · dos proyectos temporales y política efectiva', () => {
  assert(act('open', {}, { actor: 'human' }).ok === true, 'no se pudo abrir el proyecto A');
  assert(act('open', {}, { actor: 'human', cwd: cwdB }).ok === true, 'no se pudo abrir el proyecto B');

  // Regla §6 de la directiva: sin concesión explícita de una persona no hay decisiones autónomas.
  // Aquí la persona concede autonomía global en la caja de arena; en el almacén real manda la persona.
  const granted = act('policy', { projectId: '', mode: 'guarded-autonomous' }, { actor: 'human' });
  assert(granted.ok === true, `no se pudo conceder autonomía en la caja de arena: ${granted.code ?? ''}`);
  const a = projectIdOf('proyecto-a');
  const b = projectIdOf('proyecto-b');
  projectA = a;
  projectB = b;
  assert(a !== b, 'los dos proyectos comparten identidad');
  const snap = snapshot();
  assert(snap.knowledge?.policy?.mode === 'guarded-autonomous', `modo inesperado: ${snap.knowledge?.policy?.mode}`);
  const know = handleApiRequest({ root: store, method: 'GET', pathname: '/lifecode-skill-center/api/knowledge', search: '' });
  assert(know.status === 200 && know.body.policy.mode === 'guarded-autonomous', 'la ruta del conocimiento no publica la política');
  return `A=${a} · B=${b} · modo=${snap.knowledge.policy.mode}`;
});

// 2 · Caso A: una persona pide una skill reutilizable.
step('2 · necesidad explícita registrada', () => {
  const asked = act('request-skill', { text: 'necesito una skill que revise un plugin de DSH antes de instalarlo' }, { actor: 'human' });
  assert(asked.ok === true, `request-skill falló: ${asked.code ?? ''}`);
  const fromResponse = String(asked.request?.id ?? asked.id ?? '');
  const fromSnapshot = Object.values(snapshot().requests ?? {}).find((request) => request.status === 'pending')?.id ?? '';
  requestId = fromResponse || String(fromSnapshot);
  assert(requestId !== '', 'la petición no tiene id');
  return `requestId=${requestId}`;
});

step('3 · consulta de biblioteca y elector', () => {
  const plan = act('plan', {
    title: 'Revisar un plugin de DSH antes de instalarlo',
    description: 'Revisa estructura, pruebas y manifiesto de un plugin de DSH antes de instalarlo en un perfil de desarrollo',
    tags: ['dsh', 'plugins'],
    
  }, { now: LATER });
  assert(plan.ok === true, `plan falló: ${plan.code ?? ''}`);
  assert(plan.operation === 'create-skill', `el elector propuso ${plan.operation}`);
  assert(snapshot().skills.length === 0, 'el plan escribió en el almacén');
  return `operación=${plan.operation} · razones=${Array.isArray(plan.reasons) ? plan.reasons.length : 0}`;
});

// 4 · Hallazgo del subagente: origen declarado, nunca verificado por el emisor.
step('4 · hallazgo de subagente con origen declarado', () => {
  const reported = act('insight', {
    insightId,
    title: 'Revisar un plugin sin tocar el perfil de producción',
    category: 'trap',
    confidence: 'strong',
    summary: 'La revisión debe medir la huella del perfil antes y después para detectar escrituras fuera de raíz.',
    projectId: projectIdOf('proyecto-a'),
    suggestedAction: 'crear una skill de revisión',
    evidence: [{ source: 'auditoría', location: 'tools/e2e.mjs', verification: 'prueba ejecutada y huella comparada', result: '0 bytes de diferencia' }],
    sourceAgent: 'subagente-red-team',
    sessionId: 'sesion-hija-1',
  }, { now: LATER });
  assert(reported.ok === true, `insight falló: ${reported.code ?? ''}`);
  const view = act('state', {}, { now: LATER });
  const insight = (view.knowledge?.insights ?? []).find((item) => item.insightId === insightId);
  assert(insight?.state === 'received', `estado inesperado: ${insight?.state}`);
  assert(insight.origin?.verified === false, 'el origen se guardó como verificado sin comprobarlo');
  assert(/declarado/.test(String(insight.origin?.note ?? '')), 'no se marca el origen como declarado');
  return `estado=${insight.state} · verificado=${insight.origin.verified}`;
});

// 5 · El principal valida el hallazgo (ciclo de vida).
step('5 · validación del hallazgo por el principal', () => {
  const triaged = act('triage-insight', { insightId, state: 'triaged', note: 'procedencia y evidencia revisadas' }, { now: LATER });
  assert(triaged.ok === true, `triaged falló: ${triaged.code ?? ''}`);
  const validated = act('triage-insight', { insightId, state: 'validated', note: 'evidencia verificable en un almacén temporal' }, { now: LATER });
  assert(validated.ok === true, `validated falló: ${validated.code ?? ''}`);
  return `estado=${validated.insight.state}`;
});

// 6 · Crear como IA con la petición y el hallazgo enlazados.
step('6 · creación autónoma con petición y hallazgo', () => {
  const created = act('create', {
    ...candidate({ id: skillId }),
    body: BODY_1,
    insightId,
    requestId,
  }, { now: LATER });
  assert(created.ok === true, `create falló: ${created.code ?? ''} ${created.message ?? ''}`);
  assert(created.insightLink?.linked === true, `el hallazgo no quedó enlazado: ${created.insightLink?.code ?? ''}`);
  const snap = snapshot();
  const skill = skillOf(snap, skillId);
  assert(skill !== null, 'la skill no está en la biblioteca');
  assert(skill.currentVersion === '1.0.0', `versión inesperada: ${skill.currentVersion}`);
  return `skill=${skillId} · ${skill.currentVersion} · hallazgo=${created.insightLink.state}`;
});

// 7 · Evaluación suficiente para el gate de publicación.
step('7 · evaluación suficiente', () => {
  const snap = snapshot();
  const skill = skillOf(snap, skillId);
  const score = Number(skill?.current?.evaluation?.score ?? 0);
  assert(score >= 90, `score insuficiente: ${score}`);
  return `score=${score}/100`;
});

// El hallazgo que se usó para crear la skill queda en 'decided': para la evidencia fuerte hacen falta dos
// observaciones independientes todavía utilizables.
const extraInsights = ['lsc-autonomous-insight-2', 'lsc-autonomous-insight-3'];
step('8 · dos observaciones independientes verificadas', () => {
  for (const [index, extraId] of extraInsights.entries()) {
    const reported = act('insight', {
      insightId: extraId,
      title: index === 0 ? 'La compuerta de evidencia exige observaciones distintas' : 'El ledger registra la puerta antes de ejecutar',
      category: index === 0 ? 'contract' : 'trap',
      confidence: 'strong',
      summary: index === 0 ? 'medido en el arnés autónomo con un almacén temporal' : 'medido con dos decisiones concurrentes sobre el mismo almacén temporal',
      sourceAgent: index === 0 ? 'subagente-qa' : 'subagente-red',
      sessionId: index === 0 ? 'hija-qa-1' : 'hija-red-1',
      parentRunId: 'sesion-padre',
      evidence: [{ source: 'prueba ejecutada', location: index === 0 ? 'tools/e2e-autonomous.mjs' : 'tests/autonomy.test.mjs', verification: 'node --test', result: 'verde' }],
    }, { now: LATER });
    assert(reported.ok === true, `insight falló: ${reported.code ?? ''}`);
    act('triage-insight', { insightId: extraId, state: 'triaged' }, { now: LATER });
    act('triage-insight', { insightId: extraId, state: 'validated' }, { now: LATER });
  }
  return `observaciones=${extraInsights.length}`;
});

step('9 · activación autónoma en A', () => {
  const enabled = act('toggle', { projectId: projectIdOf('proyecto-a'), skillId, enabled: true, insightIds: extraInsights }, { now: LATER });
  assert(enabled.ok === true, `toggle falló: ${enabled.code ?? ''} · ${enabled.reason ?? ''} · ${enabled.message ?? ''}`);
  const snap = snapshot();
  const row = assignmentOf(snap, projectIdOf('proyecto-a'), skillId);
  assert(row?.enabled === true, 'la asignación no quedó encendida en A');
  assert(row?.by === 'ai', `la activación no consta como de la IA: ${row?.by}`);
  return `A encendida · by=${row.by} · versión=${row.version}`;
});

// 9 · Aislamiento: B no recibe nada.
step('10 · aislamiento del proyecto B', () => {
  const snap = snapshot();
  assert(assignmentOf(snap, projectIdOf('proyecto-b'), skillId) === null, 'B recibió la asignación sin decidirse');
  assert(snap.knowledge?.summary?.decisions >= 2, `el ledger no registró las decisiones: ${snap.knowledge?.summary?.decisions}`);
  return `B sin asignación · decisiones=${snap.knowledge.summary.decisions}`;
});

// 10 · Veto humano: apagar es de una persona y bloquea la reactivación automática.
step('11 · veto humano respetado', () => {
  const off = act('toggle', { projectId: projectIdOf('proyecto-a'), skillId, enabled: false }, { actor: 'human', now: LATER });
  assert(off.ok === true, `apagar falló: ${off.code ?? ''}`);
  const retry = act('toggle', { projectId: projectIdOf('proyecto-a'), skillId, enabled: true, insightIds: extraInsights }, { now: LATER });
  assert(retry.ok !== true && retry.code === 'approval-required', `la IA reactivó sin permiso: ${retry.code ?? retry.ok}`);
  assert(/human-decision|veto/.test(String(retry.reason ?? retry.message ?? '')), `motivo inesperado: ${retry.reason}`);
  return `bloqueado con ${retry.code}`;
});

// 11 · Evidencia insuficiente: sin hallazgos, la IA no activa otra skill.
step('12 · evidencia insuficiente bloquea la activación', () => {
  const other = act('create', { ...candidate({ id: 'sin-evidencia' }), body: BODY_1 }, { now: LATER2 });
  assert(other.ok === true, `create falló: ${other.code ?? ''}`);
  const refused = act('toggle', { projectId: projectIdOf('proyecto-b'), skillId: 'sin-evidencia', enabled: true }, { now: LATER2, cwd: cwdB });
  assert(refused.ok !== true && refused.code === 'approval-required', `activó sin evidencia: ${refused.code ?? refused.ok}`);
  assert(/insufficient-evidence/.test(String(refused.reason ?? '')) || /insufficient-evidence/.test(JSON.stringify(refused.gates ?? [])), `la compuerta que falló no es la de evidencia: ${refused.reason}`);
  return `bloqueado: ${(refused.gates ?? []).map((gate) => `${gate.id}:${gate.ok}`).join(',')}`;
});

// 12 · Duplicado: avisar, no publicar copia automáticamente.
step('13 · duplicado avisado', () => {
  const dup = act('create', {
    ...candidate({ id: 'autonomous-skill-copia' }),
    title: 'Revisar un plugin de DSH antes de instalarlo',
    body: BODY_1,
  }, { now: LATER2 });
  assert(dup.ok === true, `create falló: ${dup.code ?? ''}`);
  assert(Array.isArray(dup.duplicates) && dup.duplicates.length > 0, 'no avisó del duplicado');
  assert(dup.duplicates[0].reasons.length > 0, 'el aviso no explica por qué se parece');
  return `duplicados=${dup.duplicates.length} · razón="${dup.duplicates[0].reasons[0]}"`;
});

// 13 · Mejora autónoma: hallazgo nuevo, propuesta y publicación inmutable.
let improvementId = '';
step('14 · mejora propuesta desde un segundo hallazgo', () => {
  const second = 'lsc-autonomous-insight-2';
  const reported = act('insight', {
    insightId: second,
    title: 'La revisión debe comparar también la raíz del proyecto',
    category: 'contract',
    confidence: 'strong',
    summary: 'La huella del perfil no detecta escrituras dentro del proyecto: hace falta comparar la raíz.',
    projectId: projectIdOf('proyecto-a'),
    evidence: [{ source: 'auditoría', location: 'tools/e2e.mjs', verification: 'prueba con escritura en la raíz del proyecto', result: 'la huella del perfil no cambió' }],
    sourceAgent: 'subagente-qa',
    sessionId: 'sesion-hija-2',
  }, { now: LATER2 });
  assert(reported.ok === true, `insight 2 falló: ${reported.code ?? ''}`);
  act('triage-insight', { insightId: second, state: 'triaged', note: 'revisado' }, { now: LATER2 });
  act('triage-insight', { insightId: second, state: 'validated', note: 'reproducido en almacén temporal' }, { now: LATER2 });
  const improved = act('improve', { skillId, rationale: 'añadir la comparación de la raíz del proyecto a la evidencia', body: BODY_2, insightIds: [second] }, { now: LATER2 });
  assert(improved.ok === true, `improve falló: ${improved.code ?? ''}`);
  improvementId = improved.improvement?.id ?? '';
  assert(improvementId !== '', 'la mejora no tiene id');
  return `improvementId=${improvementId}`;
});

// 14 · Aprobación autónoma (compuerta fuerte) y publicación de la nueva versión.
step('15 · aprobación y publicación autónomas', () => {
  const approved = act('decide', { improvementId, decision: 'approve', insightIds: extraInsights }, { actor: 'ai', now: LATER2 });
  assert(approved.ok === true, `approve falló: ${approved.code ?? ''} · ${approved.reason ?? ''} · ${JSON.stringify((approved.gates ?? []).map((gate) => `${gate.id}:${gate.ok}`))}`);
  const snap = snapshot();
  const skill = skillOf(snap, skillId);
  assert(skill.currentVersion === '1.1.0', `versión inesperada: ${skill.currentVersion}`);
  assert(skill.versions.length === 2, `versiones inesperadas: ${skill.versions.length}`);
  assert(skill.versions.some((version) => version.version === '1.0.0'), 'la versión anterior no se conserva');
  return `vigente=${skill.currentVersion} · versiones=${skill.versions.length}`;
});

// 15 · El pin no se mueve solo al publicar; se avanza explícitamente.
step('16 · publicar no mueve el pin', () => {
  // Una persona vuelve a encender la asignación que apagó en el paso 10: el veto se levanta sólo así.
  const on = act('toggle', { projectId: projectIdOf('proyecto-a'), skillId, enabled: true, insightIds: extraInsights }, { actor: 'human', now: LATER2 });
  assert(on.ok === true, `la persona no pudo reactivar: ${on.code ?? ''}`);
  const snap = snapshot();
  const row = assignmentOf(snap, projectIdOf('proyecto-a'), skillId);
  assert(row?.enabled === true, 'la asignación se perdió al publicar');
  assert(row.version === '1.0.0', `el pin se movió solo a ${row.version}`);
  return `pin=${row.version} · vigente=${skillOf(snap, skillId).currentVersion}`;
});

// 16 · Avance de pin autorizado por evidencia y política.
step('17 · avance de pin autorizado', () => {
  const advanced = act('advance', { projectId: projectIdOf('proyecto-a'), skillId, insightIds: extraInsights }, { now: LATER2 });
  assert(advanced.ok === true, `advance falló: ${advanced.code ?? ''} · ${advanced.reason ?? ''} · ${JSON.stringify((advanced.gates ?? []).map((gate) => `${gate.id}:${gate.ok}`))}`);
  const snap = snapshot();
  assert(assignmentOf(snap, projectIdOf('proyecto-a'), skillId)?.version === '1.1.0', 'el pin no avanzó');
  assert(assignmentOf(snap, projectIdOf('proyecto-b'), skillId) === null, 'B se movió con A');
  return `A pin=1.1.0 · B sin asignación`;
});

// 17 · Regresión demostrada y rollback autónomo del pin.
step('18 · rollback autónomo ante regresión', () => {
  const rollbackInsight = 'lsc-autonomous-insight-3';
  act('insight', {
    insightId: rollbackInsight,
    title: 'La versión 1.1.0 rompe el proyecto A',
    category: 'defect',
    confidence: 'strong',
    summary: 'La nueva comprobación requiere una ruta que el proyecto A no tiene y la revisión falla.',
    projectId: projectIdOf('proyecto-a'),
    evidence: [{ source: 'red team', location: 'proyecto A', verification: 'ejecución de la skill contra el proyecto', result: 'falla por ruta inexistente' }],
    sourceAgent: 'subagente-arquitectura',
    sessionId: 'sesion-hija-3',
  }, { now: LATER2 });
  act('triage-insight', { insightId: rollbackInsight, state: 'triaged', note: 'revisado' }, { now: LATER2 });
  act('triage-insight', { insightId: rollbackInsight, state: 'validated', note: 'regresión reproducida' }, { now: LATER2 });
  const rolled = act('rollback', { projectId: projectIdOf('proyecto-a'), skillId, insightIds: [...extraInsights, rollbackInsight] }, { now: LATER2 });
  assert(rolled.ok === true, `rollback falló: ${rolled.code ?? ''} · ${rolled.reason ?? ''} · ${JSON.stringify((rolled.gates ?? []).map((gate) => `${gate.id}:${gate.ok}`))}`);
  const snap = snapshot();
  assert(assignmentOf(snap, projectIdOf('proyecto-a'), skillId)?.version === '1.0.0', 'el pin no volvió a la versión anterior');
  assert(skillOf(snap, skillId).versions.length === 2, 'la versión problemática se perdió');
  assert((snap.knowledge?.insights ?? []).length >= 3, 'sin lectura de hallazgos en la foto');
  return `pin=1.0.0 · 1.1.0 conservada`;
});

// 18 · `acted-on` no se gana sin acción: primero se rechaza.
step('19 · acted-on exige una acción terminada', () => {
  const current = (snapshot().knowledge?.insights ?? []).find((item) => item.insightId === insightId);
  if (current?.state !== 'decided') {
    const decided = act('triage-insight', { insightId, state: 'decided', note: 'decisión de publicar' }, { now: LATER2 });
    assert(decided.ok === true, `decided falló: ${decided.code ?? ''}`);
  }
  const refused = act('triage-insight', { insightId, state: 'acted-on', decisionId: 'dec-prueba' }, { now: LATER2 });
  assert(refused.ok !== true && refused.code === 'insight-action-not-done', `cerró sin acción: ${refused.code ?? refused.ok}`);
  return `rechazado con ${refused.code}`;
});

// 19 · Con la acción correcta, el hallazgo se cierra con su rastro verificable.
step('20 · acted-on tras acción correcta', () => {
  const closed = act('triage-insight', {
    insightId,
    state: 'acted-on',
    note: 'skill creada, activada y publicada',
    decisionId: 'dec-prueba',
    action: { ok: true, skillId, version: '1.0.0', projectId: projectIdOf('proyecto-a'), operation: 'create+publish', detail: 'publicada y activa en A' },
  }, { now: LATER2 });
  assert(closed.ok === true, `acted-on falló: ${closed.code ?? ''}`);
  const snap = snapshot();
  const insight = (snap.knowledge?.insights ?? []).find((item) => item.insightId === insightId);
  assert(insight?.state === 'acted-on', `estado final: ${insight?.state}`);
  assert(insight.actedOn?.ok === true && insight.actedOn.version === '1.0.0', 'el cierre no guarda la versión');
  return `estado=${insight.state} · versión=${insight.actedOn.version} · operación=${insight.actedOn.operation}`;
});

// 20 · La IA no cambia la política; una persona sí (se comprueba el rechazo).
step('21 · la IA no puede cambiar la política', () => {
  const refused = act('policy', { projectId: projectIdOf('proyecto-b'), mode: 'human-approved' }, { now: LATER2 });
  assert(refused.ok !== true && refused.code === 'approval-required', `la IA cambió la política: ${refused.code ?? refused.ok}`);
  const snap = snapshot();
  assert(snap.knowledge.policy.mode === 'guarded-autonomous', 'la política global cambió');
  return `rechazado con ${refused.code}`;
});

// Escenario negativo: una acción que falló no cierra el hallazgo.
step('22 · acted-on no se cierra con una acción fallida', () => {
  const open = act('insight', {
    insightId: 'lsc-autonomous-failed-action',
    title: 'Una acción fallida deja el hallazgo sin cerrar',
    category: 'contract',
    confidence: 'moderate',
    summary: 'El cierre exige acción terminada correctamente, no sólo una decisión.',
    sourceAgent: 'subagente-qa',
    sessionId: 'sesion-hija-5',
    evidence: [{ source: 'arnés', location: 'tools/e2e-autonomous.mjs', verification: 'este paso', result: 'medido' }],
  }, { now: LATER2 });
  assert(open.ok === true, `insight falló: ${open.code ?? ''}`);
  act('triage-insight', { insightId: 'lsc-autonomous-failed-action', state: 'triaged' }, { now: LATER2 });
  act('triage-insight', { insightId: 'lsc-autonomous-failed-action', state: 'validated' }, { now: LATER2 });
  act('triage-insight', { insightId: 'lsc-autonomous-failed-action', state: 'decided', decisionId: 'dec-fallida' }, { now: LATER2 });
  const refused = act('triage-insight', {
    insightId: 'lsc-autonomous-failed-action',
    state: 'acted-on',
    note: 'publicación que falló',
    decisionId: 'dec-fallida',
    action: { ok: false, code: 'publish-failed' },
  }, { now: LATER2 });
  assert(refused.ok !== true && refused.code === 'insight-action-not-done', `cerró con fallo: ${refused.code ?? refused.ok}`);
  const snap = snapshot();
  const insight = (snap.knowledge?.insights ?? []).find((item) => item.insightId === 'lsc-autonomous-failed-action');
  assert(insight?.state !== 'acted-on', `quedó cerrado: ${insight?.state}`);
  return `rechazado con ${refused.code} · estado=${insight.state}`;
});

// La autonomía es de la persona: ella sí puede cambiar el techo de un proyecto.
step('23 · una persona fija la política del proyecto', () => {
  const projectB = projectIdOf('proyecto-b');
  const changed = act('policy', { projectId: projectB, mode: 'human-approved' }, { now: LATER2, actor: 'human' });
  assert(changed.ok === true, `la persona no pudo fijar la política: ${changed.code ?? ''}`);
  const snap = snapshot();
  assert(snap.knowledge?.policy?.projects?.[projectB]?.mode === 'human-approved', 'la política no quedó guardada');
  const back = act('policy', { projectId: projectB, mode: 'guarded-autonomous' }, { now: LATER2, actor: 'human' });
  assert(back.ok === true, `no se pudo restaurar: ${back.code ?? ''}`);
  return `proyecto-b=human-approved → restaurado`;
});

// §4 · Lo que no es portable se declara, y la copia importada no arrastra asignaciones.
step('24 · el paquete declara rutas no portables y la copia nace sin asignaciones', () => {
  const exported = act('export-skill', { skillId }, { now: LATER2, actor: 'human' });
  assert(exported.ok === true, `exportar falló: ${exported.code ?? ''}`);
  assert(exported.portable === true || typeof exported.portable === 'boolean', 'el paquete no declara portabilidad');
  assert(Array.isArray(exported.warnings), 'el paquete no publica avisos');
  const bundle = JSON.parse(readFileSync(exported.file, 'utf8'));
  // R16.4: importar exige confirmación humana explícita y, si el id está ocupado, una decisión
  // explícita de copia (`onConflict:'copy'`). Sin ellas el contrato responde 400/200-sin-escribir
  // (fail-closed) y el paso fallaría por el gate, no por el producto.
  const imported = act('import-bundle', { bundle, from: 'e2e-autonomo', confirmed: true, onConflict: 'copy' }, { now: LATER2, actor: 'human' });
  assert(imported.ok === true, `importar falló: ${imported.code ?? ''}`);
  assert(imported.imported !== false, `la importación no se ejecutó: ${imported.code ?? ''}`);
  assert(imported.renamed === true, 'la copia debía renombrarse');
  const snap = snapshot();
  const copy = snap.skills.find((item) => item.id === imported.id);
  assert(copy?.origin?.kind === 'import', 'la copia no declara origen import');
  const assigned = Object.keys(snap.assignments ?? {}).some((projectId) => snap.assignments[projectId][imported.id]);
  assert(assigned === false, 'la copia importada nació asignada');
  return `portable=${exported.portable} · avisos=${exported.warnings.length} · copia=${imported.id}`;
});
// 21 · Escenario negativo: contradicción preservada, no fusionada.
step('25 · contradicción preservada', () => {
  act('insight', {
    insightId: 'lsc-autonomous-contradiccion',
    title: 'La huella del perfil sí detecta escrituras en la raíz',
    category: 'trap',
    confidence: 'moderate',
    summary: 'Una medición distinta sostiene lo contrario que el hallazgo sobre la raíz del proyecto.',
    projectId: projectIdOf('proyecto-a'),
    evidence: [{ source: 'auditoría', location: 'tools/e2e.mjs', verification: 'segunda medición sobre el mismo fichero', result: 'la huella sí cambió' }],
    sourceAgent: 'subagente-qa',
    sessionId: 'sesion-hija-4',
  }, { now: LATER2 });
  const snap = snapshot();
  const conflicts = snap.knowledge?.contradictions ?? [];
  assert(conflicts.length >= 1, 'no se detectó la contradicción');
  assert(conflicts[0].results.length >= 2, 'la contradicción no conserva las dos versiones');
  return `contradicciones=${conflicts.length} · resultados=${conflicts[0].results.length}`;
});

// 22 · Huellas: el almacén real no se tocó y el temporal queda aislado.
step('26 · almacén real intacto', () => {
  const after = existsSync(realFile)
    ? { size: statSync(realFile).size, sha: createHash('sha256').update(readFileSync(realFile)).digest('hex') }
    : { size: 0, sha: '' };
  assert(after.sha === before.sha && after.size === before.size, `cambió el almacén real: ${before.sha} -> ${after.sha}`);
  assert(existsSync(join(store, 'center.json')), 'el almacén temporal no existe');
  return `center.json sha256=${after.sha.slice(0, 16)} · ${after.size} B`;
});

const passed = steps.filter((item) => item.ok).length;
const failed = steps.length - passed;
const lines = [
  '# E2E autónomo — LifeCode Skill Center (ronda 11)',
  '',
  `Ejecutado: ${steps.length} pasos · **${passed} PASS · ${failed} FAIL**`,
  '',
  '| Paso | Resultado | Detalle |',
  '| --- | --- | --- |',
  ...steps.map((item) => `| ${item.name} | ${item.ok ? 'PASS' : 'FAIL'} | ${item.detail.replaceAll('|', '\\|')} |`),
  '',
  '## Cómo se ejecutó',
  '',
  '- Almacén temporal propio (`LIFECODE_SKILL_CENTER_ROOT` redirigido por el arnés) y dos workspaces temporales.',
  '- Todas las acciones por `runAction` (las mismas rutas y compuertas que usa el panel), no por funciones internas de operación.',
  '- El agente principal actúa con `actor:"ai"`; las acciones humanas (registro de proyectos, petición y apagado) con `actor:"human"`.',
  '- El origen del subagente entra **declarado**; la verificación contra `subagents.listChildren` es una ruta del Host y no se simula aquí.',
  '',
  '## Lo que este arnés no demuestra',
  '',
  '- Que el Host haya verificado la identidad del subagente (`origin.verified` sigue en `false` en este recorrido).',
  '- Que la política real de un proyecto se haya cambiado: la autonomía se configura por una persona y aquí sólo se comprueba el rechazo de la IA.',
  '- Que la skill se aplicara: `skill.applied` es una declaración, no una medición.',
];
writeFileSync(REPORT, `${lines.join('\n')}\n`, 'utf8');

for (const item of steps) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : ` :: ${item.detail}`}`);
console.log(`\n${passed}/${steps.length} PASS · informe en ${REPORT}`);

if (failed === 0) {
  rmSync(store, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
} else {
  console.log(`caja de arena conservada: ${store}`);
}
process.exitCode = failed === 0 ? 0 : 1;
