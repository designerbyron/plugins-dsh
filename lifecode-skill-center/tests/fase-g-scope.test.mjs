/**
 * Fase G de LSC-UX-IA-VENDOR-001: ámbito Global/Proyecto en «Pedir a la IA».
 *
 * Contrato medido aquí, sin tocar el almacén real ni el plugin instalado:
 *  - Global persista `projectId: null`; Proyecto persista el id canónico del registro del centro.
 *  - Un id manual, una carpeta descubierta sin alta, un registro sin cwd y una ruta relativa se rechazan.
 *  - El `cwd`, la lista y los permisos que envía el cliente jamás determinan la identidad.
 *  - La foto del panel publique la lista elegible SIN consultar el registro de workspaces del Host.
 *  - Los registros anteriores se lean como legacy y NO se reescriben ni se adjudican a un proyecto.
 *  - Crear una solicitud no activa, asigna ni concede permisos sobre la carpeta original.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  API_PREFIX, buildSnapshot, handleApiRequest, requestProjectCandidates, runAction,
} from '../lib/api.mjs';
import { emptyState, loadState, normalizeState, saveState } from '../lib/state.mjs';
import { openRequest, projectRequest } from '../lib/requests.mjs';
import { tempRoot } from './helpers.mjs';

const NOW = '2026-11-26T10:00:00.000Z';
const ELIGIBLE_ID = 'proyecto-gestionado-a1b2c3d4';
const NO_CWD_ID = 'sin-workspace-11111111';
const RELATIVE_ID = 'ruta-relativa-22222222';
const LEGACY_ID = 'req-562393e0835f';

function seededRoot() {
  const root = tempRoot('lsc-fase-g');
  const state = {
    ...emptyState(NOW),
    schemaVersion: 2,
    projects: {
      [ELIGIBLE_ID]: { id: ELIGIBLE_ID, name: 'Proyecto gestionado', cwd: 'C:/x/proyecto-gestionado', createdAt: NOW, updatedAt: NOW, note: '' },
      [NO_CWD_ID]: { id: NO_CWD_ID, name: 'Sin workspace', cwd: '', createdAt: NOW, updatedAt: NOW, note: '' },
      [RELATIVE_ID]: { id: RELATIVE_ID, name: 'Ruta relativa', cwd: 'carpeta-relativa', createdAt: NOW, updatedAt: NOW, note: '' },
    },
    requests: {
      [LEGACY_ID]: { id: LEGACY_ID, text: 'petición histórica', status: 'pending', createdAt: NOW, updatedAt: NOW },
    },
  };
  saveState(root, state, { now: NOW });
  return root;
}

function ask(payload, root, extra = {}) {
  return runAction({ root, action: 'request-skill', actor: 'human', now: NOW, payload, ...extra });
}

test('G1: Global guarda projectId null y Proyecto guarda el id canónico', () => {
  const root = seededRoot();
  const before = loadState(root).state;

  const global = ask({ text: 'revisión global', kind: 'general', scope: 'global', projectId: null }, root);
  assert.equal(global.ok, true, global.code ?? '');
  const project = ask({ text: 'revisión de proyecto', kind: 'general', scope: 'project', projectId: ELIGIBLE_ID }, root);
  assert.equal(project.ok, true, project.code ?? '');

  const after = loadState(root).state;
  assert.equal(after.requests[global.id].scope, 'global');
  assert.equal(after.requests[global.id].projectId, null, 'null sobrevive al round-trip');
  assert.equal(after.requests[project.id].scope, 'project');
  assert.equal(after.requests[project.id].projectId, ELIGIBLE_ID);
  assert.equal(Object.hasOwn(after.requests[global.id], 'workspaceId'), false, 'no hay campos equivalentes nuevos');
  assert.deepEqual(Object.keys(after.requests[global.id]).sort(), Object.keys(after.requests[project.id]).sort(), 'las dos peticiones nuevas comparten el mismo contrato');
  assert.deepEqual(Object.keys(before.projects[ELIGIBLE_ID]).sort(), Object.keys(after.projects[ELIGIBLE_ID]).sort(), 'el registro no se enriquece');
  assert.equal(projectRequest(after.requests[global.id]).projectId, '', 'la proyección preserva la lectura clásica');
  assert.equal(projectRequest(after.requests[global.id]).scope, 'global');
});

test('G2: el historical queda intacto: sin scope, sin projectId y sin reescritura', () => {
  const root = seededRoot();
  const path = `${root}/center.json`;
  const before = readFileSync(path, 'utf8');

  const opened = ask({ text: 'otra revisión', scope: 'global' }, root);
  assert.equal(opened.ok, true);
  const state = loadState(root).state;
  assert.equal(state.requests[LEGACY_ID].scope, undefined);
  assert.equal(state.requests[LEGACY_ID].projectId, undefined);
  assert.equal(state.requests[LEGACY_ID].status, 'pending');
  assert.equal(state.requests[LEGACY_ID].text, 'petición histórica');
  assert.notEqual(readFileSync(path, 'utf8'), before, 'la escritura legítima cambia el fichero');

  // Leer y normalizar tampoco adjudica nada al registro antiguo.
  const normalized = normalizeState(state).requests[LEGACY_ID];
  assert.equal(Object.hasOwn(normalized, 'projectId'), false, 'normalizeState no inventa projectId');
  assert.equal(Object.hasOwn(normalized, 'scope'), false);
});

test('G3: el backend rechaza ámbito inválido, ids manuales y proyectos no elegibles', () => {
  const root = seededRoot();
  const cases = [
    [{ text: 'x', scope: 'workspace' }, 'invalid-scope'],
    [{ text: 'x', scope: 'project', projectId: '' }, 'missing-project'],
    [{ text: 'x', scope: 'project', projectId: 'id-escrito-a-mano' }, 'project-not-eligible'],
    [{ text: 'x', scope: 'project', projectId: 'carpeta-descubierta-sin-alta' }, 'project-not-eligible'],
    [{ text: 'x', scope: 'project', projectId: NO_CWD_ID }, 'project-not-eligible'],
    [{ text: 'x', scope: 'project', projectId: RELATIVE_ID }, 'project-not-eligible'],
    [{ text: 'x', scope: 'global', projectId: ELIGIBLE_ID }, 'invalid-project-scope'],
  ];
  for (const [payload, expected] of cases) {
    const result = ask(payload, root);
    assert.equal(result.ok, false, `${payload.scope}/${payload.projectId ?? ''} debía fallar`);
    assert.equal(result.code, expected);
  }
  const state = loadState(root).state;
  assert.equal(Object.keys(state.requests).length, 1, 'ningún caso inválido escribió una petición');
  assert.equal(state.events.length, 0, 'ningún caso inválido generó actividad');
});

test('G4: cwd, lista y permisos del cliente no otorgan identidad ni permisos', () => {
  const root = seededRoot();
  const result = ask({
    text: 'que parezca de otro proyecto',
    scope: 'project',
    projectId: 'carpeta-descubierta-sin-alta',
    cwd: 'C:/x/proyecto-gestionado',
    allowedProjects: [ELIGIBLE_ID],
    permissions: ['write'],
  }, root);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'project-not-eligible');

  const state = loadState(root).state;
  assert.equal(state.assignments[ELIGIBLE_ID], undefined, 'no se crea ninguna asignación');
  assert.equal(Object.hasOwn(state, 'knowledge'), false, 'no se concede autonomía ni autorización');
  assert.equal(state.events.filter((event) => /assign|activate|enable|authoriz/i.test(event.type)).length, 0);
});

test('G5: la foto publica sólo proyectos gestionados y válidos, sin consultar workspaces', () => {
  const root = seededRoot();
  let listings = 0;
  const registry = { list: () => { listings += 1; return [{ id: 'ws-1', path: 'C:/x/descubierto' }]; } };
  const response = handleApiRequest({
    root, registry, method: 'GET', pathname: `${API_PREFIX}/state`, search: '?scan=0', now: NOW,
  });
  assert.equal(response.status, 200);
  assert.equal(listings, 0, 'directiva §7: la foto no sondea el registro del Host');
  assert.deepEqual(response.body.requestProjects, [
    { id: ELIGIBLE_ID, name: 'Proyecto gestionado', cwd: 'C:/x/proyecto-gestionado' },
  ]);
  assert.equal(response.body.requestProjects.some((entry) => entry.id === NO_CWD_ID), false);
  assert.equal(response.body.requestProjects.some((entry) => entry.id === RELATIVE_ID), false);
});

test('G6: el snapshot y la validación comparten exactamente el mismo criterio', () => {
  const root = seededRoot();
  const state = loadState(root).state;
  const candidates = requestProjectCandidates({ state });
  const snapshot = buildSnapshot({ root, now: NOW });
  assert.deepEqual(snapshot.requestProjects, candidates.eligible);
  for (const entry of candidates.eligible) {
    const result = ask({ text: `para ${entry.id}`, scope: 'project', projectId: entry.id }, root);
    assert.equal(result.ok, true, `${entry.id} aparece en la lista pero el backend lo rechaza`);
  }
  assert.deepEqual(candidates.rejected.map((entry) => entry.projectId).sort(), [NO_CWD_ID, RELATIVE_ID].sort());
});

test('G7: el agente no puede abrir solicitudes ni con un id elegible', () => {
  const root = seededRoot();
  const result = ask({ text: 'autoasignada', scope: 'project', projectId: ELIGIBLE_ID }, root, { actor: 'ai' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'approval-required');
  const state = loadState(root).state;
  assert.equal(state.events.length, 0);
});

test('G8: openRequest rechaza projectId como número y global con cadena vacía no lo conserva', () => {
  const state = emptyState(NOW);
  const numeric = openRequest(state, { text: 'x', scope: 'project', projectId: 42 }, { now: NOW });
  assert.equal(numeric.ok, false);
  assert.equal(numeric.code, 'missing-project');
  const global = openRequest(state, { text: 'y', scope: 'global', projectId: '' }, { now: NOW });
  assert.equal(global.ok, true);
  assert.equal(state.requests[global.id].projectId, null, 'la cadena vacía del cliente no se persiste');
});
