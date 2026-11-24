/**
 * UX-2.1 · prueba de integración HTTP real de `GET /pa/workspaces`.
 *
 * Levanta el handler PA en un servidor HTTP de verdad (127.0.0.1, puerto efímero) contra un perfil
 * temporal, con un registro del Host simulado, y comprueba el contrato sobre la RESPUESTA HTTP
 * (status, cabeceras y cuerpo), no sobre la función. Cierra el servidor y borra el perfil temporal.
 *
 * Uso: node api-smoke.mjs   ·   Salida: JSON con los casos medidos
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPaHandler, PA_PREFIX, PA_VERSION } from '../../../../lifecode-rag/lib/pa-api.mjs';
import { addRoot, closeRegistry, createProject, openRegistry } from '../../../../lifecode-rag/lib/registry.mjs';
import { profileRoot } from '../../../../lifecode-rag/lib/profile.mjs';

const base = mkdtempSync(join(tmpdir(), 'ux21-http-'));
const env = { LIFECODE_RAG_ROOT: join(base, 'almacen'), DSH_PROFILE: 'ux21-http' };
const root = profileRoot(env);
const projectDir = join(base, 'proyecto');
mkdirSync(projectDir, { recursive: true });
writeFileSync(join(projectDir, '.git'), '', 'utf8');

const registry = openRegistry({ root, create: true });
const project = createProject(registry.db, { name: 'Proyecto HTTP' });
addRoot(registry.db, { scopeKind: 'prj', scopeId: project.id, path: projectDir, addedBy: 'human' });
closeRegistry(registry.db);

/** Doble del registro de workspaces del Host: lectura, y mutaciones que lanzan. */
const inventory = [
  {
    id: 'ws_http_1', path: projectDir, title: 'Proyecto HTTP', sessionIds: ['s1', 's2'],
    status: async () => 'ok',
  },
  {
    id: 'ws_http_2', path: join(base, 'desaparecido'), title: 'Desaparecido', sessionIds: [],
    status: async () => 'missing-dir',
  },
  {
    id: 'ws_http_3', path: join(base, 'colgado'), title: 'Colgado', sessionIds: [],
    status: () => new Promise(() => {}),
  },
];
const forbid = async (name) => { throw new Error('escritura prohibida: ' + name); };
const hostRegistry = {
  list: () => inventory,
  create: forbid, delete: forbid, setTitle: forbid, attachSession: forbid, detachSession: forbid,
  insertSessionBefore: forbid, insertBefore: forbid, archiveSession: forbid,
  unarchiveSession: forbid, pinSession: forbid,
};

const handler = createPaHandler({
  profileRoot: root,
  profileKey: 'ux21-http',
  authorize: async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'owner' } } }),
  services: {
    get workspaces() { return hostRegistry; },
    get sessions() { return { list: () => [{ id: 's1' }] }; },
  },
});

const server = createServer((req, res) => { handler(req, res).catch(() => { res.statusCode = 500; res.end('{}'); }); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}${PA_PREFIX}`;

async function ask(path, init) {
  const response = await fetch(url + path, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, headers: Object.fromEntries(response.headers), body };
}

const salida = { version: PA_VERSION, url, casos: [] };
const anotar = (nombre, esperado, observado) => salida.casos.push({ nombre, esperado, observado, ok: JSON.stringify(esperado) === JSON.stringify(observado) });

const lista = await ask('/workspaces');
const data = lista.body && lista.body.data ? lista.body.data : {};
const porId = new Map((data.items || []).map((row) => [row.id, row]));

anotar('GET /workspaces · status', 200, lista.status);
anotar('content-type JSON', 'application/json; charset=utf-8', lista.headers['content-type']);
anotar('cache-control', 'no-store', lista.headers['cache-control']);
anotar('source', 'host', data.source);
anotar('version', PA_VERSION, data.version);
anotar('items', 3, (data.items || []).length);
anotar('estado ok', 'ok', porId.get('ws_http_1') && porId.get('ws_http_1').state);
anotar('estado missing', 'missing', porId.get('ws_http_2') && porId.get('ws_http_2').state);
anotar('estado unknown + motivo', 'timeout', porId.get('ws_http_3') && porId.get('ws_http_3').stateReason);
anotar('relación', 'exact', porId.get('ws_http_1') && porId.get('ws_http_1').relation);
anotar('sesiones vivas', { known: 2, live: 1, historical: 1 }, porId.get('ws_http_1') && porId.get('ws_http_1').sessions);
anotar('sin sessionIds en el cuerpo', false, JSON.stringify(data).includes('"sessionIds"'));

const post = await ask('/workspaces', { method: 'POST' });
anotar('POST rechazado', 405, post.status);
const parametro = await ask('/workspaces?path=C:/x');
anotar('parámetro no declarado', 400, parametro.status);
anotar('motivo del 400', 'unknown-parameter', parametro.body && parametro.body.error && parametro.body.error.details.reason);
const config = await ask('/config');
anotar('/config sigue respondiendo', 200, config.status);
anotar('/config · claves', ['config', 'mode', 'profile', 'service', 'version'], Object.keys(config.body.data).sort());

server.close();
rmSync(base, { recursive: true, force: true });

salida.resumen = {
  casos: salida.casos.length,
  ok: salida.casos.filter((caso) => caso.ok).length,
  fallos: salida.casos.filter((caso) => !caso.ok).map((caso) => caso.nombre),
};
console.log(JSON.stringify(salida, null, 2));
process.exit(salida.resumen.fallos.length === 0 ? 0 : 1);
