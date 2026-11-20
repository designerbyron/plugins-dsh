/**
 * Mundo de pruebas PA3: perfil temporal con registro, proyecto, biblioteca y almacenes sembrados.
 *
 * Nunca toca `~/.dsh`: la raíz sale de `LIFECODE_RAG_ROOT`, que es la anulación explícita de perfil.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

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

export async function seedScope({ profileRootPath, profileKey, scope, dir, docs, config }) {
  const db = openScopeStore({
    profileRoot: profileRootPath, profileKey, scope, create: true,
  });
  try {
    const files = Object.keys(docs).map((name) => write(dir, name, docs[name]));
    const embedder = createEmbedder(config);
    return await ingestFiles({
      db, root: dir, files, collection: 'documentacion', now: Date.now(), config, embedder,
    });
  } finally {
    db.close();
  }
}

/**
 * Crea un perfil con:
 *  - proyecto A (`docsA`), opcionalmente biblioteca A1 (`docsLib`) concedida a A,
 *  - proyecto B (`docsB`), opcionalmente biblioteca B1 (`docsLibB`) concedida a B,
 *    para demostrar que cada proyecto sólo ve sus propios grants.
 */
export async function makeWorld({ docsA = { 'a.md': '# Alfa\n\nalfa exclusiva del proyecto A\n' }, docsB = { 'b.md': '# Beta\n\nbeta exclusiva del proyecto B\n' }, docsLib = null, docsLibB = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'pa3-'));
  const dirA = join(base, 'proyecto-a');
  const dirB = join(base, 'proyecto-b');
  const dirLib = join(base, 'biblioteca-a1');
  const dirLibB = join(base, 'biblioteca-b1');
  for (const dir of [dirA, dirB, dirLib, dirLibB]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dirA, 'a.md'), docsA['a.md'], 'utf8');
  writeFileSync(join(dirB, 'b.md'), docsB['b.md'], 'utf8');

  const env = { LIFECODE_RAG_ROOT: join(base, 'perfil'), DSH_PROFILE: 'pa3-test' };
  const root = profileRoot(env);
  const config = loadConfig(root).config;

  const registry = openRegistry({ root, create: true });
  const projectA = createProject(registry.db, { name: 'Proyecto A' });
  const projectB = createProject(registry.db, { name: 'Proyecto B' });
  addRoot(registry.db, { scopeKind: 'prj', scopeId: projectA.id, path: dirA, addedBy: 'human' });
  addRoot(registry.db, { scopeKind: 'prj', scopeId: projectB.id, path: dirB, addedBy: 'human' });

  let library = null;
  if (docsLib) {
    library = createLibrary(registry.db, { name: 'Biblioteca A1' });
    addRoot(registry.db, { scopeKind: 'lib', scopeId: library.id, path: dirLib, addedBy: 'human' });
    grantLibrary(registry.db, { projectId: projectA.id, libraryId: library.id, grantedBy: 'human' });
  }

  let libraryB = null;
  if (docsLibB) {
    libraryB = createLibrary(registry.db, { name: 'Biblioteca B1' });
    addRoot(registry.db, { scopeKind: 'lib', scopeId: libraryB.id, path: dirLibB, addedBy: 'human' });
    grantLibrary(registry.db, { projectId: projectB.id, libraryId: libraryB.id, grantedBy: 'human' });
  }

  registerSelection(registry.db, {
    identity: { sessionId: 'sesion-a', profileKey: 'pa3-test' },
    expectedProfileKey: 'pa3-test',
    projectId: projectA.id,
  });
  registerSelection(registry.db, {
    identity: { sessionId: 'sesion-b', profileKey: 'pa3-test' },
    expectedProfileKey: 'pa3-test',
    projectId: projectB.id,
  });
  closeRegistry(registry.db);

  await seedScope({ profileRootPath: root, profileKey: 'pa3-test', scope: { kind: 'prj', id: projectA.id }, dir: dirA, docs: docsA, config });
  await seedScope({ profileRootPath: root, profileKey: 'pa3-test', scope: { kind: 'prj', id: projectB.id }, dir: dirB, docs: docsB, config });
  if (docsLib) {
    await seedScope({ profileRootPath: root, profileKey: 'pa3-test', scope: { kind: 'lib', id: library.id }, dir: dirLib, docs: docsLib, config });
  }
  if (docsLibB) {
    await seedScope({ profileRootPath: root, profileKey: 'pa3-test', scope: { kind: 'lib', id: libraryB.id }, dir: dirLibB, docs: docsLibB, config });
  }

  return {
    base, env, root, config, projectA, projectB, library, libraryB, dirA, dirB, dirLib, dirLibB,
    /** Ejecuta una operación con el registro abierto (para revocar grants, caducar, etc.). */
    withRegistry(work) {
      const opened = openRegistry({ root, create: false });
      try { return work(opened.db); } finally { closeRegistry(opened.db); }
    },
    revokeLibrary() {
      const opened = openRegistry({ root, create: false });
      try {
        revokeGrant(opened.db, { projectId: projectA.id, libraryId: library.id, revokedBy: 'human' });
      } finally { closeRegistry(opened.db); }
    },
    revokeLibraryB() {
      const opened = openRegistry({ root, create: false });
      try {
        revokeGrant(opened.db, { projectId: projectB.id, libraryId: libraryB.id, revokedBy: 'human' });
      } finally { closeRegistry(opened.db); }
    },
    cleanup() {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

/** `exec` mínimo, con la identidad que el host entrega en una llamada real. */
export function fakeExec(sessionId = 'sesion-a') {
  return {
    agent: { id: sessionId },
    callId: 'llamada-1',
    signal: new AbortController().signal,
  };
}

/** Servicios de host simulados: aprobación concedida, cwd del proyecto. */
export function servicesFor(world, { approve = true, cwd = null, sessionId = 'sesion-a' } = {}) {
  return {
    env: world.env,
    now: () => 1_700_000_000_000,
    approval: {
      async request() { return approve ? 'allowed-once' : 'rejected'; },
    },
    workingDirectory: {
      async ensure() {
        if (cwd) return cwd;
        if (sessionId === 'sesion-b') return world.dirB;
        return world.dirA;
      },
    },
  };
}
