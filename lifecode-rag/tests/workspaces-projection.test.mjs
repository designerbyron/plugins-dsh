/**
 * UX-2.1 · proyección pura de workspaces (T-W2-01, 05–11, 17).
 *
 * Todo se comprueba con objetos planos: el módulo no toca el disco, ni el reloj, ni el harness.
 * Lo que estas pruebas fijan:
 *   - la identidad es la ruta canónica (`pathKey`), nunca el título;
 *   - una entrada inválida se descarta y se cuenta, no se pinta;
 *   - un proyecto sólo se asigna por ruta igual o contenida, y gana la raíz más específica;
 *   - «no se pudo mirar» (`live: null`) no es cero;
 *   - los recuentos describen la lista completa aunque las filas se trunquen.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAX_WORKSPACE_LIMIT,
  WORKSPACE_RELATIONS,
  WORKSPACE_STATES,
  countWorkspaces,
  pathKeyOf,
  projectForPathKey,
  projectWorkspaceRow,
  projectWorkspaces,
} from '../lib/workspaces-projection.mjs';
import { normalizeKey } from '../lib/roots-structure.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const WIN = process.platform === 'win32';
const clave = (path) => pathKeyOf(path);

/** Workspace «ya medido», como lo entrega el adaptador. */
function ws(path, { id = `ws-${path}`, title = null, state = 'ok', sessionIds = [], stateReason = null } = {}) {
  return { id, path, title: title ?? path, state, stateReason, sessionIds };
}

function raiz(projectId, name, path) {
  return { projectId, name, path };
}

test('T-W2-01: tres workspaces medidos producen tres filas normalizadas', () => {
  const payload = projectWorkspaces({
    workspaces: [
      ws('C:/xampp/htdocs/plugins-dhs', { id: 'ws_1', sessionIds: ['s1', 's2'] }),
      ws('C:/xampp/htdocs/businesssuite', { id: 'ws_2' }),
      ws('C:/xampp/htdocs/lifecode-rag-lab', { id: 'ws_3', state: 'missing' }),
    ],
    liveIds: new Set(['s1']),
  });
  assert.equal(payload.source, 'host');
  assert.equal(payload.reason, null);
  assert.equal(payload.items.length, 3);
  assert.equal(payload.truncated, false);
  const first = payload.items[0];
  assert.equal(first.id, 'ws_1');
  assert.equal(first.pathKey, clave('C:/xampp/htdocs/plugins-dhs'));
  assert.equal(first.state, 'ok');
  assert.deepEqual(first.sessions, { known: 2, live: 1, historical: 1 });
  assert.equal(first.project, null);
  assert.equal(first.relation, 'none');
  assert.deepEqual(payload.counts, {
    total: 3, returned: 3, skipped: 0, withProject: 0, withoutProject: 3,
    ok: 2, missing: 1, unknown: 0, liveSessions: 1, knownSessions: 2, exact: 0, inside: 0,
  });
});

test('T-W2-05: un workspace histórico (0 vivas) no se confunde con uno abierto', () => {
  const payload = projectWorkspaces({
    workspaces: [ws('C:/a/historico', { sessionIds: ['s1', 's2', 's3'] })],
    liveIds: new Set(),
  });
  assert.deepEqual(payload.items[0].sessions, { known: 3, live: 0, historical: 3 });
});

test('T-W2-06: las sesiones vivas se cuentan por identificador, sin listarlas', () => {
  const payload = projectWorkspaces({
    workspaces: [ws('C:/a/vivo', { sessionIds: ['s1', 's2'] })],
    liveIds: new Set(['s1', 's2', 'ajena']),
  });
  const row = payload.items[0];
  assert.deepEqual(row.sessions, { known: 2, live: 2, historical: 0 });
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'sessionIds'), false);
  assert.equal(JSON.stringify(row).includes('s1'), false);
});

test('sin servicio de sesiones el desglose es null, nunca cero', () => {
  const payload = projectWorkspaces({
    workspaces: [ws('C:/a/sin-sesiones', { sessionIds: ['s1'] })],
    liveIds: null,
  });
  assert.deepEqual(payload.items[0].sessions, { known: 1, live: null, historical: null });
  assert.equal(payload.counts.liveSessions, 0);
});

test('T-W2-07: anidados — gana la raíz más específica y el padre no hereda el proyecto', () => {
  const padre = 'C:/xampp/htdocs/plugins-dhs';
  const hijo = 'C:/xampp/htdocs/plugins-dhs/lifecode-rag';
  const payload = projectWorkspaces({
    workspaces: [ws(padre, { id: 'ws_padre' }), ws(hijo, { id: 'ws_hijo' })],
    roots: [raiz('prj_1', 'lifecode-rag', hijo)],
  });
  const [filaPadre, filaHijo] = payload.items;
  // Cada uno es una fila: no se fusionan.
  assert.equal(payload.items.length, 2);
  assert.equal(filaHijo.project.id, 'prj_1');
  assert.equal(filaHijo.relation, 'exact');
  assert.equal(filaPadre.project, null);
  assert.equal(filaPadre.relation, 'none');
  assert.deepEqual(payload.counts.withProject, 1);
});

test('un workspace dentro de una raíz se relaciona como inside', () => {
  const payload = projectWorkspaces({
    workspaces: [ws('C:/xampp/htdocs/plugins-dhs/lifecode-rag/lib')],
    roots: [raiz('prj_1', 'plugins-dhs', 'C:/xampp/htdocs/plugins-dhs')],
  });
  assert.equal(payload.items[0].relation, 'inside');
  assert.equal(payload.items[0].project.name, 'plugins-dhs');
});

test('una raíz DENTRO del workspace no convierte el contenedor en ese proyecto', () => {
  const match = projectForPathKey(clave('C:/xampp/htdocs'), [raiz('prj_1', 'hijo', 'C:/xampp/htdocs/hijo')]);
  assert.equal(match, null);
});

test('T-W2-08: dos títulos iguales con rutas distintas son dos filas distintas', () => {
  const payload = projectWorkspaces({
    workspaces: [
      ws('C:/trabajo/uno', { id: 'ws_a', title: 'Proyecto' }),
      ws('C:/trabajo/dos', { id: 'ws_b', title: 'Proyecto' }),
    ],
    roots: [raiz('prj_b', 'Proyecto B', 'C:/trabajo/dos')],
  });
  assert.equal(payload.items.length, 2);
  const [a, b] = payload.items;
  assert.notEqual(a.pathKey, b.pathKey);
  assert.equal(a.project, null);
  assert.equal(b.project.id, 'prj_b');
  // La identidad es la ruta: el título compartido no mezcla proyectos.
  assert.equal(new Set(payload.items.map((row) => row.pathKey)).size, 2);
});

test('T-W2-09: un proyecto sin workspace no aparece en la lista ni en los recuentos', () => {
  const payload = projectWorkspaces({
    workspaces: [ws('C:/a/uno')],
    roots: [raiz('prj_suelto', 'Sin workspace', 'C:/b/suelto')],
  });
  assert.equal(payload.counts.total, 1);
  assert.equal(payload.counts.withProject, 0);
  // La raíz del proyecto suelto se usa para cruzar, pero no se publica: la lista habla de workspaces.
  assert.equal(JSON.stringify(payload).includes('prj_suelto'), false);
  assert.equal(payload.items.some((row) => row.project), false);
});

test('T-W2-10: un workspace sin proyecto RAG queda con project null y relation none', () => {
  const payload = projectWorkspaces({ workspaces: [ws('C:/suelto')] });
  assert.deepEqual(payload.items[0].project, null);
  assert.equal(payload.items[0].relation, 'none');
});

test('T-W2-11: la ruta se publica tal cual la guardó el Host, sin reescribirla', () => {
  const original = 'C:\\xampp\\htdocs\\plugins-dhs\\';
  const payload = projectWorkspaces({ workspaces: [ws(original)] });
  assert.equal(payload.items[0].path, original);
  assert.equal(payload.items[0].pathKey, pathKeyOf(original));
});

test('pathKey: misma clave para barra final, barra invertida y mayúsculas en Windows', () => {
  const base = clave('C:/xampp/htdocs/plugins-dhs');
  assert.equal(clave('C:/xampp/htdocs/plugins-dhs/'), base);
  assert.equal(clave('C:\\xampp\\htdocs\\plugins-dhs'), base);
  if (WIN) assert.equal(clave('c:/XAMPP/htdocs/PLUGINS-DHS'), base);
  // Paridad con la regla del registro: si una cambia y la otra no, esta prueba lo dice.
  assert.equal(clave('C:/xampp/htdocs/plugins-dhs//'), normalizeKey('C:/xampp/htdocs/plugins-dhs//'));
});

test('entradas inválidas se descartan y se cuentan; no producen filas fantasma', () => {
  const payload = projectWorkspaces({
    workspaces: [null, undefined, {}, { path: '' }, { path: 42 }, ws('C:/valido')],
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.counts.skipped, 5);
  assert.equal(payload.counts.total, 1);
});

test('un estado desconocido del Host se publica como unknown con su motivo', () => {
  const payload = projectWorkspaces({
    workspaces: [
      { ...ws('C:/a', {}), state: 'weird', stateReason: 'unexpected-status' },
      { ...ws('C:/b', {}), state: undefined },
    ],
  });
  assert.deepEqual(payload.items.map((row) => row.state), ['unknown', 'unknown']);
  assert.equal(payload.items[0].stateReason, 'unexpected-status');
  assert.equal(payload.items[1].stateReason, null);
  assert.deepEqual(WORKSPACE_STATES, ['ok', 'missing', 'unknown']);
});

test('los tres estados y las tres relaciones son las que publica el contrato', () => {
  const payload = projectWorkspaces({
    workspaces: [ws('C:/a', { state: 'ok' }), ws('C:/b', { state: 'missing' }), ws('C:/c', { state: 'unknown' })],
  });
  assert.deepEqual(payload.items.map((row) => row.state), WORKSPACE_STATES);
  for (const row of payload.items) assert.ok(WORKSPACE_RELATIONS.includes(row.relation));
});

test('truncamiento: las filas se cortan, los recuentos no', () => {
  const workspaces = Array.from({ length: 5 }, (_, index) => ws(`C:/w/${index}`, { id: `ws_${index}` }));
  const payload = projectWorkspaces({ workspaces, limit: 2 });
  assert.equal(payload.items.length, 2);
  assert.equal(payload.truncated, true);
  assert.equal(payload.counts.total, 5);
  assert.equal(payload.counts.returned, 2);
  assert.equal(payload.counts.ok, 5);
});

test('el tope de filas no se puede saltar con un limit enorme', () => {
  const workspaces = Array.from({ length: MAX_WORKSPACE_LIMIT + 5 }, (_, index) => ws(`C:/w/${index}`));
  const payload = projectWorkspaces({ workspaces, limit: 10_000 });
  assert.equal(payload.items.length, MAX_WORKSPACE_LIMIT);
  assert.equal(payload.truncated, true);
});

test('un limit absurdo cae al tope por defecto, no a cero filas', () => {
  const payload = projectWorkspaces({ workspaces: [ws('C:/a')], limit: 0 });
  assert.equal(payload.items.length, 1);
  const negativo = projectWorkspaces({ workspaces: [ws('C:/a')], limit: -3 });
  assert.equal(negativo.items.length, 1);
});

test('source none se conserva con su motivo y sin filas', () => {
  const payload = projectWorkspaces({ source: 'none', reason: 'no-registry' });
  assert.equal(payload.source, 'none');
  assert.equal(payload.reason, 'no-registry');
  assert.deepEqual(payload.items, []);
  assert.equal(payload.truncated, false);
});

test('entre raíces anidadas gana la clave más larga, en cualquier orden de entrada', () => {
  const roots = [
    raiz('prj_padre', 'padre', 'C:/x'),
    raiz('prj_hijo', 'hijo', 'C:/x/y'),
  ];
  const invertidas = [...roots].reverse();
  assert.equal(projectForPathKey(clave('C:/x/y/z'), roots).projectId, 'prj_hijo');
  assert.equal(projectForPathKey(clave('C:/x/y/z'), invertidas).projectId, 'prj_hijo');
  assert.equal(projectForPathKey(clave('C:/x/z'), roots).projectId, 'prj_padre');
});

test('una raíz sin proyecto identificable no se usa para asignar nada', () => {
  assert.equal(projectForPathKey(clave('C:/x/y'), [{ path: 'C:/x' }]), null);
  assert.equal(projectForPathKey(clave('C:/x/y'), [raiz('prj_1', 'sin ruta', '')]), null);
  assert.equal(projectForPathKey('', [raiz('prj_1', 'x', 'C:/x')]), null);
});

test('T-W2-17: el proyector es puro — sin harness, sin fs y sin red', () => {
  const source = readFileSync(join(RAIZ, 'lib/workspaces-projection.mjs'), 'utf8');
  assert.equal(/from\s+['"]@deepseek-ai\//.test(source), false, 'no importa paquetes del harness');
  assert.equal(/from\s+['"]node:(fs|http|https|net|dns)/.test(source), false, 'no importa fs ni red');
  assert.equal(/\bfetch\s*\(/.test(source), false, 'no hace red');
  assert.equal(/from\s+['"]\.\/registry\.mjs['"]/.test(source), false, 'no depende del registro (que abre SQLite)');
});

test('countWorkspaces cuenta exactas, internas y desconocidas sin inventar', () => {
  const rows = [
    { state: 'ok', project: { id: 'p' }, relation: 'exact', sessions: { known: 2, live: 1 } },
    { state: 'missing', project: { id: 'p' }, relation: 'inside', sessions: { known: 1, live: null } },
    { state: 'unknown', project: null, relation: 'none', sessions: { known: 0, live: null } },
  ];
  const counts = countWorkspaces(rows);
  assert.equal(counts.exact, 1);
  assert.equal(counts.inside, 1);
  assert.equal(counts.unknown, 1);
  assert.equal(counts.liveSessions, 1, 'sólo suma lo medido; los null no aportan');
  assert.equal(counts.knownSessions, 3);
});

test('projectWorkspaceRow sobre una fila suelta coincide con la de la lista', () => {
  const row = projectWorkspaceRow(ws('C:/x/y'), {
    roots: [raiz('prj_1', 'x', 'C:/x')], liveIds: new Set(),
  });
  assert.equal(row.relation, 'inside');
  assert.equal(row.title, 'C:/x/y');
});
