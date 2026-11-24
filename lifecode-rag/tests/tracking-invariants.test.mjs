/**
 * UX-2.2 — invariantes negativos del seguimiento (`D-UX22-06`, criterios 2, 3 y 10 de §10).
 *
 * La regla que estas pruebas fijan, en una frase: **seguir un workspace no autoriza nada**.
 * Un ciclo completo de seguimiento (activar, pausar, reanudar, reasociar, dejar de seguir, quitar y
 * reconciliar) no puede crear ni modificar `roots`, `meta.trusted_roots`, `grants`, `pa_selection`,
 * `session_scope` ni `projects`. Sólo pueden cambiar `workspace_tracking` y `audit_registry`.
 *
 * Perfiles temporales (`mkdtemp`); ninguna prueba toca `~/.dsh`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeRegistry, openRegistry, pathKeyFor } from '../lib/registry.mjs';
import { registerDiscoveredProject } from '../lib/discovery.mjs';
import { applySelection } from '../lib/selection.mjs';
import { registerSelection } from '../lib/sessions.mjs';
import {
  applyTracking, readTracking, reconcileTracking, removeTracking,
} from '../lib/tracking-store.mjs';

function tempProfile() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-tracking-inv-'));
  const opened = openRegistry({ root: join(base, 'perfil'), create: true });
  closeRegistry(opened.db);
  return base;
}

function withRegistry(base, work) {
  const opened = openRegistry({ root: join(base, 'perfil'), create: false });
  try {
    return work(opened.db);
  } finally {
    closeRegistry(opened.db);
  }
}

function project(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.git'), '', 'utf8');
  return dir;
}

/** Huella lógica de todo lo que el seguimiento NO puede tocar. */
function protectedState(db) {
  const dump = (sql) => JSON.stringify(db.prepare(sql).all());
  return {
    roots: dump('SELECT * FROM roots ORDER BY id'),
    grants: dump('SELECT * FROM grants ORDER BY id'),
    projects: dump('SELECT * FROM projects ORDER BY id'),
    paSelection: dump('SELECT * FROM pa_selection ORDER BY selection_key'),
    sessionScope: dump('SELECT * FROM session_scope ORDER BY session_id'),
    trustedRoots: JSON.stringify(db.prepare("SELECT value FROM meta WHERE key = 'trusted_roots'").get() ?? null),
  };
}

test('un ciclo completo de seguimiento no crea ni modifica permisos, proyectos ni selección', () => {
  const base = tempProfile();
  try {
    const raiz = join(base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    const b = project(join(raiz, 'proyecto-b'));
    withRegistry(base, (db) => {
      const idA = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      const idB = registerDiscoveredProject(db, {
        path: b, name: 'proyecto-b', type: 'git', source: 'test', now: 1,
      }).projectId;
      // Una selección de panel preexistente, para probar que el seguimiento no la toca.
      applySelection(db, { projectId: idA, expectedRevision: 0, by: 'human', now: 2 });
      // Y una selección de SESIÓN explícita: sin ella, el criterio 3 comparaba una tabla vacía
      // consigo misma y pasaba sin probar nada (auditoría B3).
      registerSelection(db, {
        identity: { sessionId: 'ses-inv-1', profileKey: 'default' },
        expectedProfileKey: 'default', projectId: idA, selectedBy: 'human', source: 'explicit', now: 2,
      });

      const antes = protectedState(db);
      assert.notDeepEqual(JSON.parse(antes.sessionScope), [], 'la prueba debe partir de una fila de sesión real');
      const key = pathKeyFor(a);

      applyTracking(db, {
        pathKey: key, path: a, workspaceId: 'ws-a', state: 'on', projectId: idA,
        expectedRevision: 0, now: 10, actor: 'human',
      });
      applyTracking(db, {
        pathKey: key, path: a, state: 'paused', projectId: idA, expectedRevision: 1, now: 11, actor: 'human',
      });
      applyTracking(db, {
        pathKey: key, path: a, state: 'on', projectId: idA, expectedRevision: 2, now: 12, actor: 'human',
      });
      // Reasociación: cambia el vínculo, no el conocimiento ni los permisos.
      applyTracking(db, {
        pathKey: key, path: a, state: 'on', projectId: idB, expectedRevision: 3, now: 13, actor: 'human',
      });
      reconcileTracking(db, { present: [{ pathKey: key, path: a }], absent: [], unknown: [], measuredAt: 14 });
      reconcileTracking(db, { present: [], absent: [key], unknown: [], measuredAt: 15 });
      applyTracking(db, {
        pathKey: key, path: a, state: 'off', projectId: idB, expectedRevision: 4, now: 16, actor: 'human',
      });
      removeTracking(db, { pathKey: key, expectedRevision: 5, now: 17 });

      const despues = protectedState(db);
      assert.deepEqual(despues, antes, 'el seguimiento no puede tocar roots, grants, proyectos, selección ni sesiones');

      // Lo único que sí cambió: la tabla de seguimiento (vacía tras el remove) y la auditoría.
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 0);
      const acciones = db.prepare("SELECT action, actor FROM audit_registry WHERE action LIKE 'tracking.%' OR action IN ('enable','disable','pause','resume','reassociate') ORDER BY seq").all();
      assert.equal(acciones.length > 0, true);
      assert.equal(acciones.every((row) => row.actor === 'human' || row.actor === 'host'), true);
      assert.equal(acciones.filter((row) => row.actor === 'host').every((row) => row.action === 'tracking.reconcile'), true,
        'sólo la reconciliación es del host');
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('la reasociación no migra ni borra conocimiento: no toca ningún almacén de ámbito', () => {
  const base = tempProfile();
  try {
    const raiz = join(base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    const b = project(join(raiz, 'proyecto-b'));
    withRegistry(base, (db) => {
      const idA = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      const idB = registerDiscoveredProject(db, {
        path: b, name: 'proyecto-b', type: 'git', source: 'test', now: 1,
      }).projectId;
      const key = pathKeyFor(a);
      applyTracking(db, {
        pathKey: key, path: a, state: 'on', projectId: idA, expectedRevision: 0, now: 10, actor: 'human',
      });
      const scopesAntes = db.prepare("SELECT id, scope_id, path FROM roots ORDER BY id").all();
      applyTracking(db, {
        pathKey: key, path: a, state: 'on', projectId: idB, expectedRevision: 1, now: 11, actor: 'human',
      });
      const row = readTracking(db, { pathKey: key });
      assert.equal(row.projectId, idB, 'el vínculo nuevo rige para el futuro');
      assert.deepEqual(db.prepare('SELECT id, scope_id, path FROM roots ORDER BY id').all(), scopesAntes,
        'ninguna raíz cambia de proyecto: el conocimiento indexado conserva su origen');
      // La fuente y los fragmentos viven en el almacén del proyecto; aquí basta demostrar que no se
      // tocó ninguna fila de `roots`, que es lo que decide qué almacén se abre.
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
