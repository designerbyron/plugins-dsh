/**
 * PA5 — Sincronización y ciclo de vida de las fuentes.
 *
 * El motor (`lib/sync.mjs`) reconcilia el disco con lo indexado sin borrar nada: `missing` es un estado
 * reversible, no un olvido. Estas pruebas cubren los casos que el plan exige (§4.5) y comprueban la
 * integridad después de cada ciclo: recuentos, vectores, FTS5 y auditoría de los dos dominios.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createEmbedder } from '../lib/embedders.mjs';
import { expireSession } from '../lib/sessions.mjs';
import { createProject } from '../lib/registry.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';
import { listRoots } from '../lib/registry.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { activeSyncScopes, assertScopeSyncable, markSyncOutcome, readSyncRows, syncScope, syncStatus, verifyScopeStore, walkRoot, probeFile } from '../lib/sync.mjs';
import { makeEightWorld, write } from './pa4-helpers.mjs';

const NOW = 1_700_000_500_000;

async function withWorld(options, work) {
  const world = await makeEightWorld(options);
  try {
    return await work(world);
  } finally {
    world.cleanup();
  }
}

function scopeOf(world, kind = 'prj', index = 0) {
  if (kind === 'prj') return { kind: 'prj', id: world.projectA.id };
  return { kind: 'lib', id: world.libraries[index].id };
}

async function runSync(world, scope, options = {}) {
  const registry = openRegistry({ root: world.root, create: false });
  try {
    return await syncScope({
      registryDb: registry.db,
      profileRoot: world.root,
      profileKey: 'pa4-test',
      scope,
      config: world.config,
      now: () => NOW,
      ...options,
    });
  } finally {
    closeRegistry(registry.db);
  }
}

function withStore(world, scope, work) {
  const db = openScopeStore({ profileRoot: world.root, profileKey: 'pa4-test', scope });
  try {
    return work(db);
  } finally {
    db.close();
  }
}

function sourceRows(world, scope) {
  return withStore(world, scope, (db) => db.prepare('SELECT uri, sha256 FROM sources ORDER BY uri').all());
}

function syncRows(world, scope) {
  return world.withRegistry((db) => db
    .prepare('SELECT source_key, status, last_hash, missing_since FROM sync_state WHERE scope_kind=? AND scope_id=? ORDER BY source_key')
    .all(scope.kind, scope.id));
}

/** Última operación del ledger, con su detalle JSON ya parseado. */
function lastOperation(world) {
  return world.withRegistry((db) => {
    const row = db.prepare('SELECT id, kind, state, detail FROM operations ORDER BY started_at DESC LIMIT 1').get();
    if (!row) return null;
    let detail = null;
    try { detail = row.detail ? JSON.parse(row.detail) : null; } catch { detail = null; }
    return { ...row, detail };
  });
}

test('la primera pasada reconoce lo ya indexado y no reindexa nada', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const summary = await runSync(world, scopeOf(world));
    assert.equal(summary.ingested, 0);
    assert.equal(summary.new, 0);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.complete, true);
    const rows = syncRows(world, scopeOf(world));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_key, 'a.md');
    assert.equal(rows[0].status, 'present');
    assert.equal(rows[0].last_hash.length, 64);
  });
});

test('un fichero nuevo se ingiere y queda presente', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    write(world.dirA, 'nuevo.md', '# Nuevo\n\nkappa nuevo\n');
    const summary = await runSync(world, scopeOf(world));
    assert.equal(summary.new, 1);
    assert.equal(summary.ingested, 1);
    const rows = syncRows(world, scopeOf(world));
    const nuevo = rows.find((row) => row.source_key === 'nuevo.md');
    assert.equal(nuevo.status, 'present');
    assert.equal(sourceRows(world, scopeOf(world)).length, 2);
  });
});

test('la segunda pasada sin cambios no reindexa nada', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    write(world.dirA, 'nuevo.md', '# Nuevo\n\nkappa nuevo\n');
    await runSync(world, scopeOf(world));
    const before = sourceRows(world, scopeOf(world));
    const second = await runSync(world, scopeOf(world));
    assert.equal(second.ingested, 0);
    assert.equal(second.new, 0);
    assert.equal(second.changed, 0);
    assert.equal(second.unchanged, 2);
    assert.deepEqual(sourceRows(world, scopeOf(world)), before);
  });
});

test('un fichero modificado se reingiere, actualiza el hash y no duplica la fuente', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    await runSync(world, scopeOf(world));
    writeFileSync(join(world.dirA, 'a.md'), '# Alfa v2\n\nkappaproyecto cambiado\n', 'utf8');
    const summary = await runSync(world, scopeOf(world));
    assert.equal(summary.changed, 1);
    assert.equal(summary.ingested, 1);
    const rows = sourceRows(world, scopeOf(world));
    assert.equal(rows.length, 1);
    const expected = withStore(world, scopeOf(world), (db) => db
      .prepare("SELECT sha256 FROM sources WHERE uri LIKE '%a.md'").get().sha256);
    assert.equal(syncRows(world, scopeOf(world))[0].last_hash, expected);
  });
});

test('un renombrado se ve como desaparición del nombre viejo más alta del nuevo', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    await runSync(world, scopeOf(world));
    renameSync(join(world.dirA, 'a.md'), join(world.dirA, 'a-renombrado.md'));
    const summary = await runSync(world, scopeOf(world));
    assert.equal(summary.missing, 1);
    assert.equal(summary.new, 1);
    const rows = syncRows(world, scopeOf(world));
    const viejo = rows.find((row) => row.source_key === 'a.md');
    const nuevo = rows.find((row) => row.source_key === 'a-renombrado.md');
    assert.equal(viejo.status, 'missing');
    assert.ok(viejo.missing_since);
    assert.equal(nuevo.status, 'present');
    // La fuente antigua sigue en el almacén: `missing` no borra.
    assert.equal(sourceRows(world, scopeOf(world)).length, 2);
  });
});

test('desaparición y reaparición con el mismo hash restauran sin duplicar', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const text = '# Efémero\n\nkappa efímero\n';
    write(world.dirA, 'efimero.md', text);
    await runSync(world, scopeOf(world));
    rmSync(join(world.dirA, 'efimero.md'));
    const away = await runSync(world, scopeOf(world));
    assert.equal(away.missing, 1);
    assert.equal(sourceRows(world, scopeOf(world)).length, 2, 'missing no borra la fuente');
    assert.equal(syncRows(world, scopeOf(world)).find((row) => row.source_key === 'efimero.md').status, 'missing');

    write(world.dirA, 'efimero.md', text);
    const back = await runSync(world, scopeOf(world));
    assert.equal(back.ingested, 0, 'la reaparición idéntica no reindexa');
    const rows = syncRows(world, scopeOf(world));
    assert.equal(rows.find((row) => row.source_key === 'efimero.md').status, 'present');
    assert.equal(sourceRows(world, scopeOf(world)).length, 2);
  });
});

test('una reaparición con contenido distinto reindexa y conserva una sola fuente', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    write(world.dirA, 'efimero.md', '# Efémero\n\nkappa efímero\n');
    await runSync(world, scopeOf(world));
    rmSync(join(world.dirA, 'efimero.md'));
    await runSync(world, scopeOf(world));

    write(world.dirA, 'efimero.md', '# Efémero v2\n\nkappa distinto\n');
    const summary = await runSync(world, scopeOf(world));
    assert.equal(summary.ingested, 1);
    const sources = sourceRows(world, scopeOf(world)).filter((row) => row.uri.endsWith('efimero.md'));
    assert.equal(sources.length, 1);
    assert.equal(sources[0].sha256.length, 64);
  });
});

test('un recorrido incompleto no marca desapariciones', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    await runSync(world, scopeOf(world));
    assert.equal(syncRows(world, scopeOf(world))[0].status, 'present');

    const aside = join(world.base, 'proyecto-a-apartado');
    renameSync(world.dirA, aside);
    const summary = await runSync(world, scopeOf(world));
    assert.equal(summary.complete, false);
    assert.equal(summary.missing, 0, 'sin recorrido completo no se deduce ninguna desaparición');
    assert.equal(syncRows(world, scopeOf(world))[0].status, 'present');
    assert.ok(summary.errors.length >= 1);
    renameSync(aside, world.dirA);
  });
});

test('una raíz inexistente se informa como error de sincronización sin tocar los datos', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    world.withRegistry((db) => {
      db.prepare("UPDATE roots SET path = ? WHERE scope_kind='prj' AND scope_id=?").run(join(world.base, 'no-existe'), world.projectA.id);
    });
    const summary = await runSync(world, scopeOf(world));
    assert.equal(summary.complete, false);
    assert.equal(summary.missing, 0);
    assert.equal(summary.errors[0].code, 'ENOENT');
    assert.equal(sourceRows(world, scopeOf(world)).length, 1);
  });
});

test('un almacén de biblioteca ausente se reconstruye al sincronizar', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const library = scopeOf(world, 'lib');
    rmSync(join(world.root, 'scopes', library.id), { recursive: true, force: true });
    assert.equal(existsSync(world.storeFile(library.id)), false);
    const summary = await runSync(world, library);
    assert.equal(summary.ingested, 1);
    assert.equal(existsSync(world.storeFile(library.id)), true);
    assert.equal(syncRows(world, library)[0].status, 'present');
  });
});

test('un grant revocado a mitad de la pasada detiene el ciclo', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const library = scopeOf(world, 'lib');
    write(world.libraryDirs[0], 'extra-1.md', '# Extra 1\n\nkappa extra uno\n');
    write(world.libraryDirs[0], 'extra-2.md', '# Extra 2\n\nkappa extra dos\n');
    const base = createEmbedder(world.config);
    let calls = 0;
    const embedder = {
      get model() { return base.model; },
      get dim() { return base.dim; },
      async embed(texts) {
        calls += 1;
        if (calls === 1) {
          world.withRegistry((db) => {
            db.prepare('UPDATE grants SET revoked_at = ?, revoked_by = ? WHERE library_id = ?').run(String(NOW), 'human', library.id);
          });
        }
        return base.embed(texts);
      },
    };
    await assert.rejects(
      () => runSync(world, library, { embedder, sessionId: 'sesion-a' }),
      (error) => {
        assert.equal(error.code, 'grant-revoked');
        assert.equal(error.details.scope_id, library.id);
        return true;
      },
    );
    assert.equal(world.auditCount('sync.run') >= 1, true, 'el intento queda auditado');
  });
});

test('sin sesión, el perfil puede sincronizar aunque el grant esté revocado', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const library = world.revokeLibrary(0);
    write(world.libraryDirs[0], 'extra.md', '# Extra\n\nkappa extra\n');
    const summary = await runSync(world, { kind: 'lib', id: library.id });
    assert.equal(summary.ingested, 1, 'la sincronización la ejecuta el perfil, no una consulta del modelo');
  });
});

test('la cancelación entre ficheros deja lo confirmado y no empieza lo siguiente', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const library = scopeOf(world, 'lib');
    write(world.libraryDirs[0], 'uno.md', '# Uno\n\nkappa uno\n');
    write(world.libraryDirs[0], 'dos.md', '# Dos\n\nkappa dos\n');
    const controller = new AbortController();
    const base = createEmbedder(world.config);
    let calls = 0;
    const embedder = {
      get model() { return base.model; },
      get dim() { return base.dim; },
      async embed(texts) {
        calls += 1;
        if (calls === 1) controller.abort('fin');
        return base.embed(texts);
      },
    };
    await assert.rejects(
      () => runSync(world, library, { embedder, signal: controller.signal }),
      (error) => {
        assert.equal(error.code, 'cancelled');
        assert.equal(error.details.reason, 'signal-aborted');
        return true;
      },
    );
    const rows = syncRows(world, library);
    const nuevos = rows.filter((row) => row.source_key === 'uno.md' || row.source_key === 'dos.md');
    assert.equal(nuevos.length, 1, 'sólo el fichero que ya estaba en curso queda confirmado');
    assert.equal(rows.filter((row) => row.status === 'present').length, 2, 'la sembrada + la primera confirmada');
  });
});

test('una pasada interrumpida se reconcilia y no impide la siguiente', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const scope = scopeOf(world);
    const operationId = world.withRegistry((db) => {
      db.prepare(`INSERT INTO operations (id, kind, state, started_at, detail)
        VALUES (?, 'sync', 'started', ?, ?)`).run(
        'op_0123456789ABCDEFGHJKMNPQRS',
        String(NOW - 60_000),
        JSON.stringify({ scope_kind: 'prj', scope_id: world.projectA.id }),
      );
      return 'op_0123456789ABCDEFGHJKMNPQRS';
    });
    const summary = await runSync(world, scope);
    assert.equal(summary.complete, true);
    const states = world.withRegistry((db) => db
      .prepare('SELECT id, state FROM operations WHERE kind = ? ORDER BY started_at')
      .all('sync'));
    const reconciled = states.find((row) => row.id === operationId);
    assert.equal(reconciled.state, 'reconciled');
    assert.equal(states.filter((row) => row.state === 'committed').length, 1);
  });
});

test('el límite por pasada deja el resto para la siguiente y no inventa desapariciones', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    for (let index = 0; index < 6; index += 1) {
      write(world.dirA, `lote-${index}.md`, `# Lote ${index}\n\nkappa lote ${index}\n`);
    }
    const first = await runSync(world, scopeOf(world), { limit: 2 });
    assert.equal(first.ingested, 2);
    assert.equal(first.complete, false);
    assert.equal(first.errors.some((error) => error.code === 'too-many-files'), true);
    assert.equal(syncRows(world, scopeOf(world)).filter((row) => row.status === 'missing').length, 0);
    // M6.7 §6: alcanzar el límite no es un fallo del ledger. Los efectos aplicados quedaron
    // confirmados y lo pendiente va escrito en `detail.complete`.
    assert.equal(first.outcome, 'partial');
    assert.equal(first.stop_reason, 'file-limit');
    const ledger = lastOperation(world);
    assert.equal(ledger.state, 'committed');
    assert.equal(ledger.detail.complete, false);
    assert.equal(ledger.detail.stop_reason, 'file-limit');

    const second = await runSync(world, scopeOf(world), { limit: 4 });
    assert.equal(second.ingested, 4);
    assert.equal(syncRows(world, scopeOf(world)).filter((row) => row.status === 'present').length, 7);
  });
});

test('sincronizar es idempotente: repetir no añade fuentes ni chunks', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    write(world.dirA, 'idem.md', '# Idem\n\nkappa idem\n');
    await runSync(world, scopeOf(world));
    const counts = () => withStore(world, scopeOf(world), (db) => ({
      sources: db.prepare('SELECT COUNT(*) AS n FROM sources').get().n,
      chunks: db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n,
    }));
    const before = counts();
    const summary = await runSync(world, scopeOf(world));
    assert.equal(summary.ingested, 0);
    assert.deepEqual(counts(), before);
  });
});

test('tras sincronizar, el almacén queda íntegro y la auditoría registra la pasada', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    write(world.dirA, 'integro.md', '# Íntegro\n\nkappa íntegro\n');
    const summary = await runSync(world, scopeOf(world));
    assert.ok(summary.verification);
    assert.equal(summary.verification.orphans, 0);
    assert.equal(summary.verification.missingVectors, 0);
    assert.equal(summary.verification.fts, 'ok');

    const direct = withStore(world, scopeOf(world), (db) => verifyScopeStore(db, { model: world.config.embedding.provider }));
    assert.equal(direct.counts.vectors, direct.counts.chunks);
    assert.equal(direct.orphans, 0);

    const registryAudit = world.withRegistry((db) => db
      .prepare("SELECT COUNT(*) AS n FROM audit_registry WHERE action = 'sync.run'").get().n);
    assert.ok(Number(registryAudit) >= 1);
    const scopeAudit = withStore(world, scopeOf(world), (db) => db
      .prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'sync.run'").get().n);
    assert.ok(Number(scopeAudit) >= 1);
    assert.ok(Number(registryAudit) + Number(scopeAudit) >= 2);
  });
});

test('los estados se agregan por ámbito y las raíces enumeran lo sincronizable', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    await runSync(world, scopeOf(world));
    const status = world.withRegistry((db) => syncStatus(db, { scopeKind: 'prj', scopeId: world.projectA.id }));
    assert.equal(status.length, 1);
    assert.equal(status[0].status, 'present');
    assert.equal(status[0].count, 1);

    const listed = world.withRegistry((db) => activeSyncScopes(db));
    assert.equal(listed.length, 3, 'dos proyectos activos con raíz y una biblioteca activa con raíz');
    assert.deepEqual(listed.map((scope) => scope.kind).sort(), ['lib', 'prj', 'prj']);
  });
});

test('un ámbito sin raíces, archivado o con la sesión caída no se sincroniza', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const registry = openRegistry({ root: world.root, create: false });
    try {
      const empty = createProject(registry.db, { name: 'Sin raíces' });
      assert.throws(
        () => assertScopeSyncable({ registryDb: registry.db, scope: { kind: 'prj', id: empty.id } }),
        (error) => error.code === 'sync-root-unavailable' && error.details.reason === 'no-roots',
      );

      registry.db.prepare("UPDATE libraries SET status = 'archived', archived_at = ? WHERE id = ?").run(String(NOW), world.libraries[0].id);
      assert.throws(
        () => assertScopeSyncable({ registryDb: registry.db, scope: { kind: 'lib', id: world.libraries[0].id } }),
        (error) => error.code === 'scope-forbidden' && error.details.reason === 'library-archived',
      );

      expireSession(registry.db, { identity: { sessionId: 'sesion-b', profileKey: 'pa4-test' }, expectedProfileKey: 'pa4-test', now: NOW });
      assert.throws(
        () => assertScopeSyncable({ registryDb: registry.db, scope: { kind: 'prj', id: world.projectB.id }, sessionId: 'sesion-b' }),
        (error) => error.code === 'session-expired',
      );
      assert.throws(
        () => assertScopeSyncable({ registryDb: registry.db, scope: { kind: 'prj', id: world.projectA.id }, sessionId: 'sesion-inexistente' }),
        (error) => error.code === 'session-invalid',
      );
    } finally {
      closeRegistry(registry.db);
    }
  });
});

test('walkRoot y probeFile describen el mundo sin lanzar', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const walk = walkRoot(world.dirA);
    assert.equal(walk.complete, true);
    assert.equal(walk.files.length, 1);
    assert.equal(probeFile(join(world.dirA, 'a.md')).ok, true);
    assert.equal(probeFile(join(world.dirA, 'no-existe.md')).code, 'source-missing');
    assert.equal(probeFile(world.dirA).code, 'path-unsupported');
    const bounded = walkRoot(world.dirA, { limit: 0 });
    assert.equal(bounded.complete, false);
    assert.equal(bounded.error.code, 'too-many-files');
    mkdirSync(join(world.dirA, 'sub'), { recursive: true });
    writeFileSync(join(world.dirA, 'sub', 's.md'), '# Sub\n\nkappa sub\n', 'utf8');
    assert.equal(walkRoot(world.dirA).files.length, 2);
  });
});

test('el resultado de la ingesta se publica después: lo que no se confirmó no se marca presente', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    const registry = openRegistry({ root: world.root, create: false });
    try {
      const scope = { kind: 'prj', id: world.projectA.id };
      const [root] = listRoots(registry.db, { scopeKind: 'prj', scopeId: world.projectA.id });
      assert.ok(root, 'el mundo de pruebas necesita una raíz autorizada');

      // Fila previa de un fichero que la ingesta NO va a confirmar ni a fallar: es el caso del corte
      // del proceso entre la marca y la escritura. Debe quedar exactamente como estaba.
      registry.db.prepare(`INSERT INTO sync_state
        (scope_kind, scope_id, root_id, source_key, status, last_seen_at, last_hash, missing_since, error_code, updated_at)
        VALUES ('prj', ?, ?, 'sin-confirmar.md', 'missing', ?, 'hash-viejo', ?, NULL, ?)`)
        .run(world.projectA.id, root.id, String(NOW - 1000), String(NOW - 1000), String(NOW - 1000));

      const batch = [
        { abs: join(world.dirA, 'a.md'), key: 'a.md', rootId: root.id, sha256: 'hash-a', previous: null },
        { abs: join(world.dirA, 'sin-confirmar.md'), key: 'sin-confirmar.md', rootId: root.id, sha256: 'hash-nuevo', previous: { last_hash: 'hash-viejo' } },
        { abs: join(world.dirA, 'b.md'), key: 'b.md', rootId: root.id, sha256: 'hash-b', previous: { last_hash: 'hash-previo-b' } },
      ];
      const result = {
        ingested: [{ uri: join(world.dirA, 'a.md') }],
        skipped: [],
        errors: [{ path: join(world.dirA, 'b.md'), code: 'source-unreadable', message: 'sin permisos' }],
      };

      const counts = markSyncOutcome({ registryDb: registry.db, scopeKind: 'prj', scopeId: world.projectA.id, batch, result, started: NOW });
      assert.deepEqual(counts, { present: 1, unreadable: 1 });

      const rows = readSyncRows(registry.db, { scopeKind: 'prj', scopeId: world.projectA.id });
      const confirmed = rows.get(`${root.id}\u0000a.md`);
      assert.equal(confirmed.status, 'present');
      assert.equal(confirmed.last_hash, 'hash-a');

      const failed = rows.get(`${root.id}\u0000b.md`);
      assert.equal(failed.status, 'unreadable');
      assert.equal(failed.error_code, 'source-unreadable');
      assert.equal(failed.last_hash, 'hash-previo-b', 'un fallo conserva el hash anterior, no el nuevo');

      const untouched = rows.get(`${root.id}\u0000sin-confirmar.md`);
      assert.equal(untouched.status, 'missing', 'sin confirmación no se publica `present`');
      assert.equal(untouched.last_hash, 'hash-viejo', 'el hash no se actualiza sin escritura confirmada');

      // Un fichero confirmado por `skipped` (ya indexado) también cuenta como presente.
      markSyncOutcome({
        registryDb: registry.db,
        scopeKind: 'prj',
        scopeId: world.projectA.id,
        batch: [{ abs: join(world.dirA, 'sin-confirmar.md'), key: 'sin-confirmar.md', rootId: root.id, sha256: 'hash-nuevo', previous: { last_hash: 'hash-viejo' } }],
        result: { ingested: [], skipped: [{ uri: join(world.dirA, 'sin-confirmar.md') }], errors: [] },
        started: NOW,
      });
      const restored = readSyncRows(registry.db, { scopeKind: 'prj', scopeId: world.projectA.id }).get(`${root.id}\u0000sin-confirmar.md`);
      assert.equal(restored.status, 'present');
      assert.equal(restored.last_hash, 'hash-nuevo');
    } finally {
      closeRegistry(registry.db);
    }
  });
});

test('un formato que el motor no soporta se cuenta aparte, no se marca y no se reintenta', async () => {
  await withWorld({ libraryCount: 1 }, async (world) => {
    write(world.dirA, 'nuevo.md', '# Nuevo\n\nkappa nuevo\n');
    writeFileSync(join(world.dirA, 'imagen.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    writeFileSync(join(world.dirA, 'operativa.sqlite3'), Buffer.from('SQLite format 3\u0000', 'utf8'));
    const first = await runSync(world, scopeOf(world));
    assert.equal(first.unsupported, 2);
    assert.equal(first.ingested, 1);
    assert.equal(first.failed, 0);
    assert.equal(first.outcome, 'ok');
    const rows = syncRows(world, scopeOf(world));
    assert.equal(rows.some((row) => row.source_key.endsWith('.png')), false);
    assert.equal(rows.some((row) => row.source_key.endsWith('.sqlite3')), false);
    const second = await runSync(world, scopeOf(world));
    assert.equal(second.unsupported, 2);
    assert.equal(second.failed, 0);
    assert.equal(second.ingested, 0);
    assert.equal(second.unchanged, 2);
  });
});

// ---------------------------------------------------------------------------------------------
// M6.7 §5.1 y §6: presupuesto por tick, exclusión por nombre de secreto y semántica del ledger.
// ---------------------------------------------------------------------------------------------

test('un presupuesto agotado corta entre ficheros, conserva lo confirmado y no duplica en la siguiente', async () => {
  await withWorld({ libraryCount: 0 }, async (world) => {
    for (let index = 0; index < 5; index += 1) {
      write(world.dirA, `presupuesto-${index}.md`, `# Presupuesto ${index}\n\nkappa presupuesto ${index}\n`);
    }
    // Vectorización deliberadamente lenta para que el presupuesto venza a mitad del lote; el corte
    // ocurre en `authorize`, antes de preparar el fichero siguiente, nunca dentro de una transacción.
    // Reloj monotónico **inyectado**: el presupuesto se agota por ficheros (25 unidades cada uno), no por
    // la velocidad del disco. Con el reloj real, la observación podía consumir los 60 ms y la prueba
    // fallaba por la máquina —medido: 8/8 en aislado y un fallo bajo la suite completa—.
    let ticks = 0;
    const base = createEmbedder(world.config);
    const slow = {
      model: base.model,
      dim: base.dim,
      embed: async (texts) => {
        ticks += 25;
        return base.embed(texts);
      },
    };
    const loteRows = () => syncRows(world, scopeOf(world)).filter((row) => row.source_key.startsWith('presupuesto-'));
    const first = await runSync(world, scopeOf(world), {
      embedder: slow, budgetMs: 60, monotonic: () => ticks,
    });
    assert.equal(first.budget_exhausted, true);
    assert.equal(first.complete, false);
    assert.equal(first.outcome, 'partial');
    assert.equal(first.stop_reason, 'budget');
    assert.ok(first.ingested >= 1, `ingeridos=${first.ingested}`);
    assert.ok(first.ingested < 5, `ingeridos=${first.ingested}`);

    const ledger = lastOperation(world);
    assert.equal(ledger.state, 'committed', 'los efectos confirmados van a committed, no a failed');
    assert.equal(ledger.detail.budget_exhausted, true);
    assert.equal(ledger.detail.complete, false);

    assert.equal(
      loteRows().filter((row) => row.status === 'present').length,
      first.ingested,
      'sólo se publica lo confirmado; el fichero sembrado no cuenta',
    );
    assert.equal(loteRows().length, first.ingested, 'los no procesados no se marcan `present`');

    const second = await runSync(world, scopeOf(world), { budgetMs: 5_000 });
    assert.equal(second.budget_exhausted, false);
    assert.equal(second.ingested, 5 - first.ingested);
    assert.equal(loteRows().filter((row) => row.status === 'present').length, 5);
    assert.equal(
      sourceRows(world, scopeOf(world)).filter((row) => row.uri.includes('presupuesto-')).length,
      5,
      'sin duplicados',
    );
  });
});

test('los ficheros con forma de secreto se excluyen por nombre y no se reintentan', async () => {
  await withWorld({ libraryCount: 0 }, async (world) => {
    write(world.dirA, 'normal.md', '# Normal\n\nkappa normal\n');
    write(world.dirA, '.env', 'TOKEN=no-debe-indexarse\n');
    write(world.dirA, '.env.local', 'TOKEN=no-debe-indexarse\n');
    write(world.dirA, 'id_rsa', 'no-debe-indexarse\n');
    write(world.dirA, 'certificado.pem', 'no-debe-indexarse\n');
    // Nombre legítimo que NO debe caer en la exclusión.
    write(world.dirA, 'environment.md', '# Entorno\n\nkappa entorno\n');

    const first = await runSync(world, scopeOf(world));
    assert.equal(first.sensitive, 4);
    assert.equal(first.ingested, 2, 'normal.md y environment.md');
    assert.equal(first.failed, 0);
    assert.equal(first.outcome, 'ok');

    const uris = sourceRows(world, scopeOf(world)).map((row) => row.uri);
    assert.equal(uris.some((uri) => uri.endsWith('.env') || uri.endsWith('.env.local')), false);
    assert.equal(uris.some((uri) => uri.endsWith('id_rsa') || uri.endsWith('certificado.pem')), false);
    assert.equal(uris.some((uri) => uri.endsWith('environment.md')), true);
    assert.equal(syncRows(world, scopeOf(world)).some((row) => row.source_key === '.env'), false, 'no se marca');

    const second = await runSync(world, scopeOf(world));
    assert.equal(second.sensitive, 4);
    assert.equal(second.ingested, 0);
    assert.equal(second.failed, 0);
  });
});

test('sin nada pendiente el presupuesto no se toca y la pasada es completa', async () => {
  await withWorld({ libraryCount: 0 }, async (world) => {
    const first = await runSync(world, scopeOf(world), { budgetMs: 5_000 });
    assert.equal(first.budget_exhausted, false);
    assert.equal(first.complete, true);
    assert.equal(first.outcome, 'ok');
    assert.equal(first.stop_reason, 'complete');
  });
});

test('un lote mixto no duplica lo ya indexado en otra colección', async () => {
  await withWorld({ libraryCount: 0 }, async (world) => {
    // Un fichero clasificado a mano en otra colección y otro nuevo: el lote llega mezclado.
    const clasificado = write(world.dirA, 'clasificado.md', '# Clasificado\n\nkappaproyecto clasificado\n');
    write(world.dirA, 'nuevo.md', '# Nuevo\n\nkappaproyecto nuevo\n');
    const store = openScopeStore({ profileRoot: world.root, profileKey: 'pa4-test', scope: scopeOf(world), create: true });
    try {
      await ingestFiles({
        db: store, files: [clasificado], collection: 'otra', now: NOW,
        config: world.config, embedder: createEmbedder(world.config),
      });
    } finally {
      store.close();
    }

    const summary = await runSync(world, scopeOf(world));
    assert.equal(summary.failed, 0, 'la sincronización no falla por el lote mixto');

    const rows = withStore(world, scopeOf(world), (db) => db.prepare('SELECT uri, collection FROM sources ORDER BY uri').all());
    const clasificadas = rows.filter((row) => row.uri.endsWith('clasificado.md'));
    assert.equal(clasificadas.length, 1, 'lo ya indexado no se duplica en default');
    assert.equal(clasificadas[0].collection, 'otra', 'conserva su colección');
    const nuevos = rows.filter((row) => row.uri.endsWith('nuevo.md'));
    assert.equal(nuevos.length, 1);
    assert.equal(nuevos[0].collection, 'default');
  });
});
