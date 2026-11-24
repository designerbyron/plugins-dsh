/**
 * AGENT-09 · Criterios 5 y 16 de UX-2.2, con recuperación REAL.
 *
 * Criterio 5 — aislamiento de recuperación con DOS sesiones y DOS proyectos:
 *   - dos proyectos A y B, cada uno con su raíz autorizada y una fuente ingerida de verdad con un
 *     marcador ÚNICO;
 *   - dos filas de seguimiento (una por workspace) y dos sesiones asociadas por `sessionIds`;
 *   - cada sesión se resuelve con `resolveScope` (escalón 2, `source='tracking'`) y la recuperación se
 *     ejerce con `searchScopes`, el mismo núcleo que usa la herramienta `search`;
 *   - A no obtiene ningún fragmento con el marcador de B ni al revés, y resolver con el `cwd` del otro
 *     proyecto es `scope-conflict` sin abrir el almacén ajeno.
 *
 * Criterio 16 — reasociar un workspace no mueve conocimiento:
 *   - se ingiere una fuente en A y se guardan `sourceId`, `sha256`, `chunkKeys` y el sha256 del texto de
 *     sus chunks;
 *   - se reasocia la fila de seguimiento de A a B con `applyTracking`;
 *   - la fuente sigue en A con el MISMO sha256 y los MISMOS chunkKeys, se encuentra buscando desde A, no
 *     aparece desde B, y los recuentos de fuentes de A y B no cambian.
 *
 * Perfiles temporales (`mkdtemp`): nada toca `~/.dsh`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeRegistry, openRegistry, pathKeyFor } from '../lib/registry.mjs';
import { resolveScope } from '../lib/resolve.mjs';
import { applyTracking, readTracking } from '../lib/tracking-store.mjs';
import { withAuthorizedContext } from '../lib/exec-context.mjs';
import { getAcross, listProject, runIngest, searchScopes } from '../lib/scope-ops.mjs';
import { createEmbedder } from '../lib/embedders.mjs';
import { sha256Hex } from '../lib/hash.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { closeDatabase } from '../lib/db.mjs';
import { projectAuthorization } from '../lib/revocation.mjs';
import { fakeExec, makeWorld, servicesFor, write } from './pa3-helpers.mjs';

const PROFILE = 'pa3-test';
const NOW = 1_700_000_000_000;
const MARKER_A = 'MARCADOR-SOLO-A-7f3a';
const MARKER_B = 'MARCADOR-SOLO-B-9c1e';

const DOCS_A = {
  'a.md': `# Alfa\n\nEl proyecto alfa comparte una palabra comun y su marcador exclusivo.\n${MARKER_A}\n`,
};
const DOCS_B = {
  'b.md': `# Beta\n\nEl proyecto beta comparte una palabra comun y su marcador exclusivo.\n${MARKER_B}\n`,
};

function ws(id, path, sessionIds = [], status = () => Promise.resolve('ok')) {
  return { id, path, title: path, sessionIds, status };
}

/** Servicios de host con la lista de workspaces que el Host publicaría. */
function hostServices(world, { sessionId, cwd, openProjects }) {
  return {
    ...servicesFor(world, { cwd, sessionId }),
    workspaces: { list: () => openProjects },
  };
}

function resolveWith(world, { sessionId, cwd, openProjects, now = NOW }) {
  return world.withRegistry((db) => resolveScope(db, {
    identity: { sessionId, profileKey: PROFILE },
    expectedProfileKey: PROFILE,
    cwd,
    openProjects,
    now,
  }));
}

/** Ejercita la recuperación real con el mismo núcleo que la herramienta `search`. */
async function searchFrom(world, { sessionId, cwd, openProjects, query, limit = 10 }) {
  return withAuthorizedContext({
    services: hostServices(world, { sessionId, cwd, openProjects }),
    exec: fakeExec(sessionId),
  }, async (ctx) => {
    const found = await searchScopes(ctx, {
      query,
      limit,
      config: world.config,
      embedder: createEmbedder(world.config),
      now: NOW,
    });
    return {
      sessionId,
      source: ctx.resolved.source,
      projectId: ctx.resolved.projectId,
      projectName: ctx.resolved.projectName,
      scopeIds: ctx.scopes.map((scope) => scope.id),
      results: found.results,
      mode: found.mode,
    };
  });
}

function brief(found) {
  return {
    sessionId: found.sessionId,
    source: found.source,
    projectId: found.projectId,
    projectName: found.projectName,
    mode: found.mode,
    via: found.via,
    results: found.results.map((row) => ({
      title: row.title, uri: row.uri, sourceId: row.sourceId, chunkKey: row.chunkKey,
    })),
  };
}

/**
 * Recuperación sobre un ámbito YA resuelto por `resolveScope` (escalón 2, `source='tracking'`).
 *
 * Se intenta primero el camino completo de la herramienta (`withAuthorizedContext`). Hoy ese camino
 * rechaza una sesión resuelta por seguimiento: `revalidate` sólo tolera la ausencia de fila en
 * `session_scope` cuando `source === 'cwd'` (`lib/exec-context.mjs`), y el escalón 2 resuelve
 * legítimamente sin escribir una selección. Eso es un hueco de `lib/` (fuera de los ficheros de este
 * agente); se detecta por el código EXACTO y se continúa con el MISMO ámbito resuelto, abriendo los
 * almacenes con el abridor real (`openScopeStore`) y releyendo la autorización con
 * `projectAuthorization`. La recuperación sigue siendo `searchScopes` sobre los mismos `scope_id`.
 */
async function searchResolved(world, { resolved, cwd, openProjects, query, limit = 10 }) {
  try {
    return await searchFrom(world, { sessionId: resolved.sessionId, cwd, openProjects, query, limit })
      .then((found) => ({ ...found, via: 'withAuthorizedContext' }));
  } catch (error) {
    const gap = error?.code === 'scope-forbidden' && error.details?.reason === 'session-missing';
    if (!gap) throw error;
  }

  const registry = openRegistry({ root: world.root, create: false });
  const opened = new Map();
  const scopes = resolved.scopes.map((scope) => ({
    kind: scope.kind, id: scope.id, name: scope.name, roots: scope.roots,
    dir: join(world.root, 'scopes', scope.id),
  }));
  const ctx = {
    sessionId: resolved.sessionId,
    profileKey: PROFILE,
    profileRoot: world.root,
    registry: registry.db,
    scopes,
    project: () => scopes.find((scope) => scope.kind === 'prj') ?? null,
    libraries: () => scopes.filter((scope) => scope.kind === 'lib'),
    open(scope) {
      if (opened.has(scope.id)) return opened.get(scope.id);
      const db = openScopeStore({ profileRoot: world.root, profileKey: PROFILE, scope, create: false });
      if (db) opened.set(scope.id, db);
      return db;
    },
    // Misma garantía que el envoltorio real: releer autorización y no devolver datos de un ámbito
    // que dejó de estar autorizado.
    checkpoint(where = 'return') {
      const current = projectAuthorization(registry.db, resolved.projectId);
      if (!current.ok) throw new Error(`autorización perdida en ${where}: ${current.reason}`);
      const revoked = scopes.map((scope) => scope.id).filter((id) => !current.scopes.includes(id));
      if (revoked.length > 0) throw new Error(`ámbitos revocados en ${where}: ${revoked.join(', ')}`);
    },
  };
  try {
    const found = await searchScopes(ctx, {
      query, limit, config: world.config, embedder: createEmbedder(world.config), now: NOW,
    });
    return {
      sessionId: resolved.sessionId,
      source: resolved.source,
      projectId: resolved.projectId,
      projectName: resolved.projectName,
      scopeIds: scopes.map((scope) => scope.id),
      results: found.results,
      mode: found.mode,
      via: 'resolved-scope',
    };
  } finally {
    for (const db of opened.values()) closeDatabase(db);
    closeRegistry(registry.db);
  }
}

const textsOf = (found) => found.results.map((row) => String(row.text ?? ''));

function track(world, { path, projectId, workspaceId, now = NOW }) {
  return world.withRegistry((db) => applyTracking(db, {
    pathKey: pathKeyFor(path), path, workspaceId, state: 'on', projectId, expectedRevision: 0, now,
  }));
}

function sourcesOf(world, sessionId, cwd) {
  return withAuthorizedContext({
    services: hostServices(world, { sessionId, cwd, openProjects: [] }),
    exec: fakeExec(sessionId),
  }, (ctx) => {
    const listed = listProject(ctx, { limit: 200 });
    return { total: listed.total, rows: listed.rows.map((row) => ({ id: row.id, uri: row.uri, sha256: row.sha256 })) };
  });
}

test('criterio 5: dos sesiones y dos proyectos no comparten ni un fragmento, y el cwd ajeno es scope-conflict', async () => {
  const world = await makeWorld({ docsA: DOCS_A, docsB: DOCS_B });
  try {
    const fuera = join(world.base, 'sin-rama');
    mkdirSync(fuera, { recursive: true });
    const sessionA = 'sesion-traza-a';
    const sessionB = 'sesion-traza-b';
    // Dos filas de seguimiento: una por workspace, cada una con su proyecto.
    track(world, { path: world.dirA, projectId: world.projectA.id, workspaceId: 'ws-a' });
    track(world, { path: world.dirB, projectId: world.projectB.id, workspaceId: 'ws-b', now: NOW + 1 });
    // Dos sesiones ficticias, cada una asociada por `sessionIds` a su workspace.
    const openProjects = [
      ws('ws-a', world.dirA, [sessionA]),
      ws('ws-b', world.dirB, [sessionB]),
    ];

    // 1) Resolución por el escalón 2 (workspace seguido), sin selección explícita.
    const resolvedA = resolveWith(world, { sessionId: sessionA, cwd: fuera, openProjects });
    const resolvedB = resolveWith(world, { sessionId: sessionB, cwd: fuera, openProjects });
    assert.equal(resolvedA.source, 'tracking');
    assert.equal(resolvedB.source, 'tracking');
    assert.equal(resolvedA.projectId, world.projectA.id);
    assert.equal(resolvedB.projectId, world.projectB.id);
    assert.notEqual(resolvedA.projectId, resolvedB.projectId);
    assert.deepEqual(resolvedA.scopes.map((scope) => scope.id), [world.projectA.id]);
    assert.deepEqual(resolvedB.scopes.map((scope) => scope.id), [world.projectB.id]);

    // 2) Recuperación real: el marcador propio aparece y el ajeno no.
    const fromA = await searchResolved(world, { resolved: resolvedA, cwd: fuera, openProjects, query: MARKER_A });
    const fromB = await searchResolved(world, { resolved: resolvedB, cwd: fuera, openProjects, query: MARKER_B });
    assert.equal(fromA.projectId, world.projectA.id);
    assert.equal(fromB.projectId, world.projectB.id);
    assert.ok(fromA.results.length >= 1, 'A debe encontrar su propia fuente');
    assert.ok(fromB.results.length >= 1, 'B debe encontrar su propia fuente');
    assert.ok(textsOf(fromA).some((text) => text.includes(MARKER_A)), 'A ve su marcador');
    assert.ok(textsOf(fromB).some((text) => text.includes(MARKER_B)), 'B ve su marcador');
    assert.ok(textsOf(fromA).every((text) => !text.includes(MARKER_B)), 'A no ve ningún fragmento con el marcador de B');
    assert.ok(textsOf(fromB).every((text) => !text.includes(MARKER_A)), 'B no ve ningún fragmento con el marcador de A');
    assert.ok(fromA.results.every((row) => row.uri.startsWith(world.dirA)), 'todo lo de A vive bajo su raíz');
    assert.ok(fromB.results.every((row) => row.uri.startsWith(world.dirB)), 'todo lo de B vive bajo su raíz');

    // Término compartido: el aislamiento no depende de que la consulta sea exclusiva.
    const sharedA = await searchResolved(world, { resolved: resolvedA, cwd: fuera, openProjects, query: 'comun' });
    const sharedB = await searchResolved(world, { resolved: resolvedB, cwd: fuera, openProjects, query: 'comun' });
    assert.ok(sharedA.results.length >= 1 && sharedB.results.length >= 1, 'los dos encuentran su documento');
    assert.ok(sharedA.results.every((row) => row.uri.startsWith(world.dirA) && !String(row.text).includes(MARKER_B)));
    assert.ok(sharedB.results.every((row) => row.uri.startsWith(world.dirB) && !String(row.text).includes(MARKER_A)));

    // Búsquedas cruzadas explícitas: el marcador del otro no se materializa desde el ámbito propio.
    const crossFromA = await searchResolved(world, { resolved: resolvedA, cwd: fuera, openProjects, query: MARKER_B });
    const crossFromB = await searchResolved(world, { resolved: resolvedB, cwd: fuera, openProjects, query: MARKER_A });
    assert.ok(textsOf(crossFromA).every((text) => !text.includes(MARKER_B)), 'A no obtiene el fragmento de B ni buscándolo');
    assert.ok(textsOf(crossFromB).every((text) => !text.includes(MARKER_A)), 'B no obtiene el fragmento de A ni buscándolo');

    // El agujero de exec-context que obligaba a un camino degradado está cerrado: la sesión resuelta
    // por seguimiento pasa por la autorización REAL de la herramienta. Si alguien lo revierte, esto
    // falla en vez de degradarse en silencio.
    assert.equal(fromA.via, 'withAuthorizedContext', 'la sesión de seguimiento debe pasar por la compuerta real');
    assert.equal(fromB.via, 'withAuthorizedContext');
    console.log('[criterio5] sesión A →', JSON.stringify(brief(fromA)));
    console.log('[criterio5] sesión B →', JSON.stringify(brief(fromB)));
    console.log('[criterio5] términos compartidos →', JSON.stringify({
      A: brief(sharedA).results, B: brief(sharedB).results,
      cruzadas: { A_buscando_B: textsOf(crossFromA).filter((t) => t.includes(MARKER_B)).length,
        B_buscando_A: textsOf(crossFromB).filter((t) => t.includes(MARKER_A)).length },
    }));

    // 3) cwd en el proyecto del OTRO: scope-conflict, sin elegir en silencio.
    for (const [sessionId, cwdAjeno, propio, ajeno] of [
      [sessionA, world.dirB, world.projectA.id, world.projectB.id],
      [sessionB, world.dirA, world.projectB.id, world.projectA.id],
    ]) {
      await assert.rejects(() => searchFrom(world, { sessionId, cwd: cwdAjeno, openProjects, query: 'comun' }), (error) => {
        assert.equal(error.code, 'scope-conflict');
        assert.equal(error.details.workspace_project_id, propio);
        assert.equal(error.details.cwd_project_id, ajeno);
        return true;
      });
    }
    const denyAudit = world.withRegistry((db) => db.prepare(`SELECT detail FROM audit_registry
      WHERE action = 'scope.resolve' AND outcome = 'denied' ORDER BY seq DESC LIMIT 4`).all());
    assert.ok(denyAudit.some((row) => JSON.parse(row.detail).code === 'scope-conflict'), 'el conflicto queda auditado');

    // 4) «No se abre ningún almacén ajeno», medido: si algo abriera B, un fichero ilegible lo delataría.
    const storeB = join(world.root, 'scopes', world.projectB.id, 'rag.sqlite3');
    writeFileSync(storeB, 'no es un almacén sqlite', 'utf8');
    // El canario está armado: una búsqueda legítima de B ahora falla al abrir su almacén…
    await assert.rejects(() => searchFrom(world, { sessionId: 'sesion-b', cwd: world.dirB, openProjects, query: MARKER_B }), (error) => {
      assert.equal(error.code, 'scope-store-corrupt', JSON.stringify(error.details));
      return true;
    });
    // …pero la resolución en conflicto ni siquiera lo intenta: sigue siendo scope-conflict.
    await assert.rejects(() => searchFrom(world, { sessionId: sessionA, cwd: world.dirB, openProjects, query: 'comun' }), (error) => {
      assert.equal(error.code, 'scope-conflict', `abrió el almacén ajeno: ${error.code}`);
      return true;
    });
    console.log('[criterio5] canario de apertura ajena →', JSON.stringify({
      almacenB: storeB, busquedaLegitimaB: 'scope-store-corrupt', resolucionEnConflicto: 'scope-conflict',
    }));
  } finally {
    world.cleanup();
  }
});

test('criterio 16: reasociar la fila de A a B no mueve ni un chunk de la fuente', async () => {
  const world = await makeWorld({ docsA: DOCS_A, docsB: DOCS_B });
  try {
    const keyA = pathKeyFor(world.dirA);
    const created = track(world, { path: world.dirA, projectId: world.projectA.id, workspaceId: 'ws-a' });
    assert.equal(created.item.projectId, world.projectA.id);
    const markerC = 'MARCADOR-CONOCIMIENTO-A-5d21';

    // Ingesta REAL en A, con la herramienta de núcleo sobre un contexto autorizado.
    const newFile = write(world.dirA, 'conocimiento-a.md',
      `# Conocimiento propio de A\n\nEste documento vive en el proyecto A.\n${markerC}\n`);
    const ingested = await withAuthorizedContext({
      services: hostServices(world, { sessionId: 'sesion-a', cwd: world.dirA, openProjects: [] }),
      exec: fakeExec('sesion-a'),
    }, (ctx) => runIngest(ctx, {
      scope: ctx.project(),
      files: [newFile],
      collection: 'documentacion',
      now: NOW,
      config: world.config,
      embedder: createEmbedder(world.config),
    }));
    assert.deepEqual(ingested.errors, []);
    assert.equal(ingested.ingested.length, 1);
    const sourceId = ingested.ingested[0].id;

    // Estado de la fuente en A antes de reasociar: sha256 del registro, chunkKeys y sha256 de su texto.
    const before = await withAuthorizedContext({
      services: hostServices(world, { sessionId: 'sesion-a', cwd: world.dirA, openProjects: [] }),
      exec: fakeExec('sesion-a'),
    }, (ctx) => {
      const got = getAcross(ctx, { ref: sourceId, limit: 200 });
      const listed = listProject(ctx, { limit: 200 });
      return {
        source: got.source,
        chunkKeys: got.chunks.map((chunk) => chunk.chunkKey),
        chunksTextSha: sha256Hex(got.chunks.map((chunk) => chunk.text).join('\n\u0000\n')),
        total: listed.total,
      };
    });
    assert.equal(before.source.id, sourceId);
    assert.match(before.source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(before.chunkKeys.length >= 1);
    const countABefore = before.total;
    const countBBefore = await sourcesOf(world, 'sesion-b', world.dirB);

    // Reasociación humana: la MISMA fila (misma ruta) pasa a apuntar al proyecto B.
    const reassociated = world.withRegistry((db) => applyTracking(db, {
      pathKey: keyA, path: world.dirA, workspaceId: 'ws-a', state: 'on',
      projectId: world.projectB.id, expectedRevision: created.revision, now: NOW + 10,
    }));
    assert.equal(reassociated.changed, true);
    assert.equal(reassociated.item.projectId, world.projectB.id);
    assert.equal(reassociated.item.path, world.dirA, 'la ruta de la fila no se mueve');
    const reassocAudit = world.withRegistry((db) => db.prepare(`SELECT action, actor, detail FROM audit_registry
      WHERE action = 'reassociate' ORDER BY seq DESC LIMIT 1`).get());
    assert.equal(reassocAudit.actor, 'human');

    // (1) La fuente sigue en A, con el MISMO sha256 y los MISMOS chunkKeys.
    const after = await withAuthorizedContext({
      services: hostServices(world, { sessionId: 'sesion-a', cwd: world.dirA, openProjects: [] }),
      exec: fakeExec('sesion-a'),
    }, (ctx) => {
      const got = getAcross(ctx, { ref: sourceId, limit: 200 });
      const listed = listProject(ctx, { limit: 200 });
      return {
        source: got.source,
        chunkKeys: got.chunks.map((chunk) => chunk.chunkKey),
        chunksTextSha: sha256Hex(got.chunks.map((chunk) => chunk.text).join('\n\u0000\n')),
        total: listed.total,
        uris: listed.rows.map((row) => row.uri),
      };
    });
    assert.equal(after.source.id, sourceId);
    assert.equal(after.source.sha256, before.source.sha256, 'el contenido no cambió');
    assert.deepEqual(after.chunkKeys, before.chunkKeys, 'ni un chunkKey se movió');
    assert.equal(after.chunksTextSha, before.chunksTextSha, 'ni el texto de los chunks cambió');
    assert.equal(after.source.uri, newFile);

    // (2) Buscando su marcador desde el ámbito de A, se encuentra.
    const foundA = await searchFrom(world, { sessionId: 'sesion-a', cwd: world.dirA, openProjects: [], query: markerC });
    assert.ok(foundA.results.some((row) => row.sourceId === sourceId), 'A sigue recuperando su fuente');
    assert.ok(textsOf(foundA).some((text) => text.includes(markerC)));

    // (3) Desde el ámbito de B no aparece, ni por marcador ni por id de fuente.
    const foundB = await searchFrom(world, { sessionId: 'sesion-b', cwd: world.dirB, openProjects: [], query: markerC });
    assert.ok(foundB.results.every((row) => row.sourceId !== sourceId));
    assert.ok(textsOf(foundB).every((text) => !text.includes(markerC)));
    await assert.rejects(() => withAuthorizedContext({
      services: hostServices(world, { sessionId: 'sesion-b', cwd: world.dirB, openProjects: [] }),
      exec: fakeExec('sesion-b'),
    }, (ctx) => getAcross(ctx, { ref: sourceId })), (error) => {
      assert.equal(error.code, 'source-not-found');
      return true;
    });

    // (4) Los recuentos de fuentes de A y de B no cambiaron por la reasociación.
    const countAAfter = after.total;
    const countBAfter = await sourcesOf(world, 'sesion-b', world.dirB);
    assert.equal(countAAfter, countABefore);
    assert.deepEqual(countBAfter, countBBefore);
    const rowAfter = world.withRegistry((db) => readTracking(db, { pathKey: keyA }));
    assert.equal(rowAfter.projectId, world.projectB.id);
    assert.equal(rowAfter.revision, 2);

    console.log('[criterio16] fuente:', JSON.stringify({
      sourceId,
      sha256: before.source.sha256,
      chunkKeys: before.chunkKeys,
      chunksTextSha: before.chunksTextSha,
      uri: before.source.uri,
    }));
    console.log('[criterio16] tras reasociar:', JSON.stringify({
      sourceId: after.source.id,
      sha256: after.source.sha256,
      chunkKeys: after.chunkKeys,
      chunksTextSha: after.chunksTextSha,
      fila: { projectId: rowAfter.projectId, path: rowAfter.path, revision: rowAfter.revision },
    }));
    console.log('[criterio16] recuentos:', JSON.stringify({
      A: { antes: countABefore, despues: countAAfter, uris: after.uris },
      B: { antes: countBBefore.total, despues: countBAfter.total, uris: countBAfter.rows.map((row) => row.uri) },
    }));
    console.log('[criterio16] búsquedas:', JSON.stringify({
      desdeA: brief(foundA).results, desdeB: brief(foundB).results,
    }));
  } finally {
    world.cleanup();
  }
});
