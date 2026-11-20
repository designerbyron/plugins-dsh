/**
 * Mundo de pruebas PA4: perfil temporal con un proyecto y hasta siete bibliotecas concedidas.
 *
 * Nunca toca `~/.dsh`: la raíz sale de `LIFECODE_RAG_ROOT`. Todas las rutas declaradas como raíz son
 * disjuntas a propósito, porque PA4 rechaza estructuralmente el solapamiento al registrar.
 */

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addRoot, closeRegistry, createLibrary, createProject, openRegistry } from '../lib/registry.mjs';
import { grantLibrary, registerSelection, revokeGrant } from '../lib/sessions.mjs';
import { profileRoot } from '../lib/profile.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { createEmbedder } from '../lib/embedders.mjs';
import { loadConfig } from '../lib/paths.mjs';

export function write(dir, name, text) {
  const path = join(dir, name);
  writeFileSync(path, text, 'utf8');
  return path;
}

export function storeFileOf(root, scopeId) {
  return join(root, 'scopes', scopeId, 'rag.sqlite3');
}

export async function seedScope({ profileRootPath, profileKey, scope, dir, docs, config }) {
  const db = openScopeStore({ profileRoot: profileRootPath, profileKey, scope, create: true });
  try {
    const files = Object.keys(docs).map((name) => write(dir, name, docs[name]));
    return await ingestFiles({
      db, root: dir, files, collection: 'documentacion', now: Date.now(), config, embedder: createEmbedder(config),
    });
  } finally {
    db.close();
  }
}

/**
 * Proyecto A con `libraryCount` bibliotecas concedidas (7 por defecto = 8 ámbitos efectivos, el
 * máximo del contrato), más un proyecto B con su propia sesión para las pruebas de concurrencia.
 */
export async function makeEightWorld({ libraryCount = 7 } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'pa4-'));
  const dirA = join(base, 'proyecto-a');
  const dirB = join(base, 'proyecto-b');
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  writeFileSync(join(dirA, 'a.md'), '# Alfa\n\nkappaproyecto\n', 'utf8');
  writeFileSync(join(dirB, 'b.md'), '# Beta\n\nkappaproyectob\n', 'utf8');

  const env = { LIFECODE_RAG_ROOT: join(base, 'perfil'), DSH_PROFILE: 'pa4-test' };
  const root = profileRoot(env);
  const config = loadConfig(root).config;

  const libraryDirs = [];
  for (let index = 1; index <= libraryCount; index += 1) {
    const dir = join(base, `biblioteca-${index}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `l${index}.md`), `# Biblioteca ${index}\n\nkappalib${index}\n`, 'utf8');
    libraryDirs.push(dir);
  }

  const registry = openRegistry({ root, create: true });
  const projectA = createProject(registry.db, { name: 'Proyecto A' });
  const projectB = createProject(registry.db, { name: 'Proyecto B' });
  addRoot(registry.db, { scopeKind: 'prj', scopeId: projectA.id, path: dirA, addedBy: 'human' });
  addRoot(registry.db, { scopeKind: 'prj', scopeId: projectB.id, path: dirB, addedBy: 'human' });

  const libraries = [];
  for (let index = 0; index < libraryCount; index += 1) {
    const library = createLibrary(registry.db, { name: `Biblioteca ${index + 1}` });
    addRoot(registry.db, { scopeKind: 'lib', scopeId: library.id, path: libraryDirs[index], addedBy: 'human' });
    grantLibrary(registry.db, { projectId: projectA.id, libraryId: library.id, grantedBy: 'human' });
    libraries.push(library);
  }

  registerSelection(registry.db, {
    identity: { sessionId: 'sesion-a', profileKey: 'pa4-test' },
    expectedProfileKey: 'pa4-test',
    projectId: projectA.id,
  });
  registerSelection(registry.db, {
    identity: { sessionId: 'sesion-b', profileKey: 'pa4-test' },
    expectedProfileKey: 'pa4-test',
    projectId: projectB.id,
  });
  closeRegistry(registry.db);

  await seedScope({
    profileRootPath: root, profileKey: 'pa4-test', scope: { kind: 'prj', id: projectA.id }, dir: dirA,
    docs: { 'a.md': '# Alfa\n\nkappaproyecto\n' }, config,
  });
  await seedScope({
    profileRootPath: root, profileKey: 'pa4-test', scope: { kind: 'prj', id: projectB.id }, dir: dirB,
    docs: { 'b.md': '# Beta\n\nkappaproyectob\n' }, config,
  });
  for (let index = 0; index < libraryCount; index += 1) {
    await seedScope({
      profileRootPath: root, profileKey: 'pa4-test', scope: { kind: 'lib', id: libraries[index].id },
      dir: libraryDirs[index], docs: { [`l${index + 1}.md`]: `# Biblioteca ${index + 1}\n\nkappalib${index + 1}\n` }, config,
    });
  }

  return {
    base, env, root, config, projectA, projectB, libraries, dirA, dirB, libraryDirs,
    storeFile(scopeId) { return storeFileOf(root, scopeId); },
    /** Ejecuta algo con el registro abierto (revocar, caducar, insertar raíces heredadas...). */
    withRegistry(work) {
      const opened = openRegistry({ root, create: false });
      try { return work(opened.db); } finally { closeRegistry(opened.db); }
    },
    revokeLibrary(index = 0) {
      const library = libraries[index];
      const opened = openRegistry({ root, create: false });
      try {
        revokeGrant(opened.db, { projectId: projectA.id, libraryId: library.id, revokedBy: 'human' });
      } finally {
        closeRegistry(opened.db);
      }
      return library;
    },
    auditCount(action) {
      return this.withRegistry((db) => Number(
        db.prepare('SELECT COUNT(*) AS n FROM audit_registry WHERE action = ?').get(action)?.n ?? 0,
      ));
    },
    cleanup() { rmSync(base, { recursive: true, force: true }); },
  };
}

/** `exec` mínimo, con la identidad que el host entrega en una llamada real. */
export function fakeExec(sessionId = 'sesion-a', { signal } = {}) {
  return {
    agent: { id: sessionId },
    callId: 'llamada-pa4',
    signal: signal ?? new AbortController().signal,
  };
}

/** Servicios de host simulados. `embedder` permite disparar una revocación en mitad de una consulta. */
export function servicesFor(world, { approve = true, cwd = null, sessionId = 'sesion-a', embedder = undefined, now = undefined, signal } = {}) {
  return {
    env: world.env,
    now: now ?? (() => 1_700_000_000_000),
    embedder,
    signal,
    approval: { async request() { return approve ? 'allowed-once' : 'rejected'; } },
    workingDirectory: {
      async ensure() {
        if (cwd) return cwd;
        return sessionId === 'sesion-b' ? world.dirB : world.dirA;
      },
    },
  };
}

/**
 * Embedder que ejecuta `before` una sola vez, en la primera vectorización de la consulta. Sirve para
 * revocar un grant o abortar la señal **mientras** la operación ya está en marcha, de forma
 * determinista: sin carreras de temporizadores.
 */
export function embedderThatTriggers(world, before, { after = 1 } = {}) {
  const base = createEmbedder(world.config);
  let calls = 0;
  let fired = false;
  return {
    get model() {
      return base.model;
    },
    get dim() {
      return base.dim;
    },
    async embed(texts) {
      calls += 1;
      if (!fired && calls >= after) {
        fired = true;
        await before();
      }
      return base.embed(texts);
    },
  };
}

/** Firma de contenido de un fichero, para probar que el original no cambió. */
export function fileStat(path) {
  const stat = statSync(path);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

export function defsFor(world, options = {}, sessionId = 'sesion-a') {
  const services = servicesFor(world, { ...options, sessionId });
  return services;
}
