/*
 * R16.4 — verificación INDEPENDIENTE del contrato de portabilidad (T30).
 *
 * No usa los fixtures de `tests/r16-bundle.test.mjs`: monta el adaptador Cordis real (`apply`) sobre un
 * `ctx` mínimo, captura la ruta `prefix` que el plugin registra y despacha JSON POST contra ese handler,
 * como el navegador. Todo ocurre en cajas `mkdtempSync`: el almacén real (`~/.dsh`) no se lee ni se escribe.
 *
 * Convención de esta ronda: cada prueba que escribe mide el digesto del almacén (center.json) y del árbol
 * temporal antes/después, de modo que «no escribió» es una afirmación medida, no una suposición. Los puntos
 * 20 (panel/render) y los gates finales se completan después de congelar el árbol, según el encargo.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import test from 'node:test';

import {
  API_CONTRACT_VERSION,
  API_PREFIX,
  API_VERSION,
  handleApiRequest,
} from '../lib/api.mjs';
import {
  BUNDLE_SCHEMA,
  BUNDLE_SCHEMA_VERSION,
  MAX_BUNDLE_BYTES,
  bundleChecksum,
  writeBundle,
} from '../lib/distribute.mjs';
import {
  SCHEMA_VERSION,
  centerFile,
  emptyState,
  loadState,
  saveState,
} from '../lib/state.mjs';
import { apply as applyPlugin } from '../index.js';
import { candidate, tempRoot } from './helpers.mjs';

const NOW = '2026-11-09T22:30:00.000Z';
const SKILL_ID = candidate().id;

// ---------------------------------------------------------------------------
// Cajas temporales y huellas
// ---------------------------------------------------------------------------

/** Caja que contiene al centro: permite demostrar que nada se escribe FUERA de la raíz. */
function sandbox(label = 'r164') {
  const box = mkdtempSync(join(tmpdir(), `${label}-`));
  const root = join(box, 'center');
  mkdirSync(root);
  return { box, root, dshHome: join(box, 'dsh-home') };
}

function storeDigest(root) {
  const file = centerFile(root);
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'missing';
}

function treeDigest(dir) {
  const hash = createHash('sha256');
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      const rel = `${prefix}${entry.name}`;
      hash.update(rel);
      if (entry.isDirectory()) walk(full, `${rel}/`);
      else hash.update(readFileSync(full));
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return hash.digest('hex');
}

function readCenter(root) {
  return JSON.parse(readFileSync(centerFile(root), 'utf8'));
}

// ---------------------------------------------------------------------------
// Adaptador real: apply + handler capturado
// ---------------------------------------------------------------------------

function mount({ root, dshHome, snapshot = [] }) {
  const routes = [];
  const providerRegistrations = [];
  const services = {
    workspaceRegistry: { list: () => [], get: () => null },
    skills: {
      snapshot: async () => ({ skills: snapshot, complete: true }),
      registerProvider: (callback) => {
        providerRegistrations.push(callback);
        return callback({ invalidate: () => {} });
      },
    },
    loader: { entries: () => [] },
    workingDirectory: { get: () => '' },
    agents: { list: () => [] },
    connection: {
      browserPeer: { id: 'peer-panel', principal: { kind: 'owner' } },
      admit: ({ headers }) => (String(headers?.cookie ?? '') === '' ? { rejection: 401 } : { peer: { id: 'peer-panel' } }),
    },
  };
  const ctx = {
    get: (key) => services[key],
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    skills: services.skills,
    effect: (callback) => callback(),
    inject: (names, callback) => callback({
      webServer: {
        register: (route) => {
          routes.push(route);
          return () => {};
        },
        getOrigin: () => 'http://127.0.0.1:1',
      },
    }),
    logger: { info: () => {}, warn: () => {} },
  };
  applyPlugin(ctx, { root, dshHome });

  const dispatch = async ({ method = 'POST', pathname = API_PREFIX, body = null, headers = null } = {}) => {
    assert.equal(routes.length, 1, 'el adaptador registra una sola ruta para toda la API');
    const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const listeners = new Map();
    const req = {
      method,
      url: pathname,
      headers: headers ?? { cookie: 'dsh-auth-r164=1' },
      on(event, callback) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(callback);
        return req;
      },
    };
    const res = {
      statusCode: 0,
      payload: '',
      setHeader() {},
      end(value = '') {
        this.payload = String(value);
      },
    };
    const done = new Promise((resolve) => {
      const original = res.end.bind(res);
      res.end = (value = '') => {
        original(value);
        resolve();
      };
    });
    routes[0].handler(req, res);
    if (payload !== null) {
      for (const callback of listeners.get('data') ?? []) callback(payload);
      for (const callback of listeners.get('end') ?? []) callback();
    }
    await done;
    return { status: res.statusCode, body: res.payload === '' ? undefined : JSON.parse(res.payload) };
  };

  return { dispatch, routes, providerRegistrations };
}

async function createSkill(center, overrides = {}) {
  const created = await center.dispatch({ body: { action: 'create', ...candidate(overrides) } });
  assert.equal(created.status, 200, `la creación base debe ser 200: ${JSON.stringify(created.body).slice(0, 300)}`);
  assert.equal(created.body.ok, true);
  return created.body;
}

async function exportSkill(center, skillId = SKILL_ID) {
  const exported = await center.dispatch({ body: { action: 'export-skill', skillId } });
  assert.equal(exported.status, 200, `export-skill debe ser 200: ${JSON.stringify(exported.body).slice(0, 300)}`);
  assert.equal(exported.body.ok, true);
  return exported.body;
}

function bundleOfState(root, skillId = SKILL_ID) {
  const exported = readCenter(root);
  assert.ok(exported.skills?.[skillId], 'el centro de origen debe tener la skill exportada');
  return { state: loadState(root).state, exported };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// §7.1-3 — exportar, transferir entre DOS centros y no tocar el origen
// ---------------------------------------------------------------------------

test('§7.1-3: exportar e importar una skill propia en un segundo centro deja el origen idéntico (hash antes/después)', async () => {
  const origin = sandbox('r164-origin');
  const destination = sandbox('r164-dest');
  const a = mount(origin);
  await createSkill(a);
  const exported = await exportSkill(a);

  // El paquete es un fichero real dentro de exports/ y trae `json` + `origin` (punto 1/3).
  const expectedFile = join(origin.root, 'exports', `${SKILL_ID}-1.0.0.json`);
  assert.equal(exported.file, expectedFile);
  assert.ok(existsSync(expectedFile), 'el paquete debe existir en exports/');
  assert.equal(typeof exported.json, 'string');
  assert.equal(JSON.parse(exported.json).schema, BUNDLE_SCHEMA);
  assert.equal(exported.origin.skillId, SKILL_ID);
  assert.equal(exported.origin.app, 'lifecode-skill-center');
  assert.equal(exported.version, '1.0.0');

  const originBefore = { store: storeDigest(origin.root), tree: treeDigest(origin.root) };
  const destBefore = treeDigest(destination.root);

  const inspected = await a.dispatch({ body: { action: 'inspect-bundle', bundle: exported.json } });
  assert.equal(inspected.status, 200);
  assert.equal(inspected.body.inspected, true);

  const b = mount(destination);
  const imported = await b.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json, from: 'centro-a' } });
  assert.equal(imported.status, 200, JSON.stringify(imported.body).slice(0, 300));
  assert.equal(imported.body.ok, true);
  assert.equal(imported.body.imported, true);
  assert.equal(imported.body.saved, true);
  assert.equal(imported.body.skill, SKILL_ID);
  assert.equal(imported.body.renamed, false);

  // El destino tiene una copia con el mismo cuerpo; el origen no cambió ni un byte.
  const destinationState = loadState(destination.root).state;
  assert.ok(destinationState.skills?.[SKILL_ID], 'el destino debe tener la skill importada');
  assert.equal(destinationState.skills[SKILL_ID].versions[0].body, candidate().body);
  assert.equal(storeDigest(origin.root), originBefore.store, 'el almacén del origen no se toca');
  assert.equal(treeDigest(origin.root), originBefore.tree, 'el árbol del origen no se toca');
  assert.notEqual(treeDigest(destination.root), destBefore, 'el destino sí cambia (importó)');
});

// ---------------------------------------------------------------------------
// §7.3/§7.16 — vista previa completa y read-only (incluido el preview bloqueado)
// ---------------------------------------------------------------------------

test('§7.3: la vista previa declara identidad, compatibilidad, integridad, conflictos, plan y preflight', async () => {
  const box = sandbox('r164-preview');
  const center = mount(box);
  await createSkill(center);
  const exported = await exportSkill(center);

  // Se inspecciona en un centro SIN la skill: el preview describe el paquete, no el centro de origen.
  const destination = sandbox('r164-preview-dest');
  const target = mount(destination);
  const inspected = await target.dispatch({ body: { action: 'inspect-bundle', bundle: exported.json } });
  assert.equal(inspected.status, 200);
  const body = inspected.body;
  assert.equal(body.ok, true);
  assert.equal(body.apiVersion, API_VERSION);
  assert.equal(body.contractVersion, API_CONTRACT_VERSION);
  assert.equal(body.inspected, true);
  assert.equal(body.checksumMatches, true);
  assert.equal(body.schemaVersion, BUNDLE_SCHEMA_VERSION);
  assert.equal(body.schemaCompatible, true);

  const preview = body.preview;
  for (const key of ['name', 'description', 'version', 'tags', 'origin', 'identity', 'compatibility', 'integrity', 'portability', 'conflicts', 'plan', 'preflight']) {
    assert.ok(Object.hasOwn(preview, key), `preview debe declarar ${key}`);
  }
  assert.equal(preview.version, '1.0.0');
  assert.equal(preview.identity.skillId, SKILL_ID);
  assert.equal(preview.identity.checksum, body.checksum);
  assert.equal(preview.compatibility.schema, BUNDLE_SCHEMA);
  assert.equal(preview.compatibility.schemaVersion, BUNDLE_SCHEMA_VERSION);
  assert.equal(preview.compatibility.minSupported, BUNDLE_SCHEMA_VERSION);
  assert.equal(preview.compatibility.maxSupported, BUNDLE_SCHEMA_VERSION);
  assert.equal(preview.compatibility.compatible, true);
  assert.equal(preview.integrity.checksumMatches, true);
  assert.equal(preview.portability.portable, true);
  for (const key of ['sameId', 'sameName', 'alreadyImported', 'idInUse', 'nameInUse']) {
    assert.ok(Object.hasOwn(preview.conflicts, key), `conflicts debe declarar ${key}`);
  }
  assert.equal(preview.conflicts.sameId.exists, false);
  assert.equal(preview.plan.action, 'create');
  assert.deepEqual(preview.plan.targetIdCandidate, SKILL_ID);
  assert.ok(['allow', 'warn'].includes(preview.preflight.decision), `sin colisiones la decisión no puede bloquear: ${preview.preflight.decision}`);
});

test('§7.16: inspect-bundle es read-only también cuando el preview sale bloqueado', async () => {
  const box = sandbox('r164-ro');
  const center = mount(box);
  await createSkill(center);
  const exported = await exportSkill(center);
  const before = { store: storeDigest(box.root), tree: treeDigest(box.root) };

  const withEvidence = await center.dispatch({ body: { action: 'inspect-bundle', bundle: exported.json } });
  assert.equal(withEvidence.status, 200);
  assert.equal(withEvidence.body.preview.preflight.decision === 'block', false);

  // Sin inventario medido el motor declara `evidence-incomplete` (block) en vez de fingir un allow.
  const direct = await handleApiRequest({
    root: box.root,
    dshHome: box.dshHome,
    now: NOW,
    hostCwd: '',
    cwd: '',
    method: 'POST',
    pathname: API_PREFIX,
    body: { action: 'inspect-bundle', bundle: exported.json },
  });
  assert.equal(direct.status, 200);
  assert.equal(direct.body.preview.preflight.decision, 'block');
  assert.ok(direct.body.preview.preflight.findings.some((finding) => finding.code === 'evidence-incomplete'));

  assert.equal(storeDigest(box.root), before.store, 'inspect no puede escribir el almacén');
  assert.equal(treeDigest(box.root), before.tree, 'inspect no puede dejar ficheros');
});

// ---------------------------------------------------------------------------
// §7.4-6 — paquete corrupto, esquema incompatible y checksum manipulado
// ---------------------------------------------------------------------------

test('§7.4-6: JSON malformado, esquema desconocido, versión futura y checksum manipulado son errores 400 honestos', async () => {
  const box = sandbox('r164-corrupt');
  const center = mount(box);
  await createSkill(center);
  const exported = await exportSkill(center);
  const valid = JSON.parse(exported.json);
  const before = { store: storeDigest(box.root), tree: treeDigest(box.root) };

  const cases = [
    { name: 'json roto', bundle: '{ esto no es json', code: 'invalid-bundle' },
    { name: 'no-objeto', bundle: '[1,2,3]', code: 'invalid-bundle' },
    { name: 'sin schema', bundle: JSON.stringify({ schemaVersion: 1, skill: valid.skill, checksum: valid.checksum }), code: 'invalid-bundle' },
    { name: 'schemaVersion futura', bundle: JSON.stringify({ ...valid, schemaVersion: 2 }), code: 'unsupported-schema' },
    { name: 'schemaVersion futura en texto', bundle: JSON.stringify({ ...valid, schemaVersion: '2' }), code: 'unsupported-schema' },
    // Nota de la ronda: `schemaVersion: '1'` se acepta porque `readBundle` compara con Number(); se anota
    // como salvedad (tolerancia numérica) en el informe, no como contrato verificado.
    { name: 'checksum manipulado', bundle: JSON.stringify({ ...valid, checksum: '0'.repeat(64) }), code: 'checksum-mismatch' },
  ];
  for (const entry of cases) {
    const inspected = await center.dispatch({ body: { action: 'inspect-bundle', bundle: entry.bundle } });
    assert.equal(inspected.status, 400, `${entry.name}: esperaba 400`);
    assert.equal(inspected.body.ok, false, `${entry.name}: ok debe ser false`);
    assert.equal(inspected.body.code, entry.code, `${entry.name}: código`);
  }

  // El cuerpo no puede colarse tocando su propio checksum declarado si el contenido no cambia.
  const tampered = cloneJson(valid);
  tampered.skill.body += '\n\ninyectado';
  const tamperedResult = await center.dispatch({ body: { action: 'inspect-bundle', bundle: JSON.stringify(tampered) } });
  assert.equal(tamperedResult.status, 400);
  assert.equal(tamperedResult.body.code, 'checksum-mismatch');

  assert.equal(storeDigest(box.root), before.store);
  assert.equal(treeDigest(box.root), before.tree);
});

// ---------------------------------------------------------------------------
// §7.7-8/§7.9/§7.10 — identidad duplicada, nombre duplicado, repetida, copia
// ---------------------------------------------------------------------------

test('§7.7-8: id en uso se informa y NO se sobrescribe; el nombre duplicado se declara en conflicts', async () => {
  const box = sandbox('r164-conflicts');
  const center = mount(box);
  await createSkill(center);
  const exported = await exportSkill(center);

  // Segundo centro donde el id ya existe con OTRO contenido.
  const other = sandbox('r164-conflicts-b');
  const b = mount(other);
  await createSkill(b, { body: `${candidate().body}\n\n## Extra\n\ncontenido local distinto` });
  const existingBefore = JSON.stringify(loadState(other.root).state.skills[SKILL_ID]);
  const before = { store: storeDigest(other.root), tree: treeDigest(other.root) };

  const inspected = await b.dispatch({ body: { action: 'inspect-bundle', bundle: exported.json } });
  assert.equal(inspected.status, 200);
  assert.equal(inspected.body.preview.conflicts.sameId.exists, true);
  assert.equal(inspected.body.preview.conflicts.idInUse, true);
  assert.equal(inspected.body.preview.plan.action, 'copy');
  assert.equal(inspected.body.preview.plan.targetIdCandidate, `${SKILL_ID}-copia`);

  const conflicted = await b.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json } });
  assert.equal(conflicted.status, 200);
  assert.equal(conflicted.body.ok, true);
  assert.equal(conflicted.body.imported, false);
  assert.equal(conflicted.body.code, 'conflict');
  assert.equal(conflicted.body.saved, false);
  assert.equal(JSON.stringify(loadState(other.root).state.skills[SKILL_ID]), existingBefore, 'la skill existente queda intacta');
  assert.equal(storeDigest(other.root), before.store, 'el conflicto no escribe el almacén');
  assert.equal(treeDigest(other.root), before.tree);

  // Nombre duplicado con id libre: se declara (sameName/nameInUse) y no se toca la skill homónima.
  const bundleTitle = JSON.parse(exported.json).skill.title;
  const named = sandbox('r164-conflicts-c');
  const c = mount(named);
  await createSkill(c, { id: 'otra-skill', title: bundleTitle });
  const cBefore = JSON.stringify(loadState(named.root).state.skills['otra-skill']);
  const namedInspect = await c.dispatch({ body: { action: 'inspect-bundle', bundle: exported.json } });
  assert.equal(namedInspect.status, 200);
  assert.deepEqual(namedInspect.body.preview.conflicts.sameName.map((row) => row.id), ['otra-skill']);
  assert.equal(namedInspect.body.preview.conflicts.nameInUse, true);
  assert.equal(namedInspect.body.preview.conflicts.idInUse, false);
  // El título no es identidad: el paquete entra con su id (no pisa a la homónima).
  const namedImport = await c.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json } });
  assert.equal(namedImport.status, 200);
  assert.equal(namedImport.body.imported, true);
  assert.equal(JSON.stringify(loadState(named.root).state.skills['otra-skill']), cBefore, 'la homónima no se sobrescribe');
});

test('§7.9: el mismo paquete dos veces ⇒ already-imported sin segunda escritura, incluso tras recargar el centro', async () => {
  const source = sandbox('r164-dup-src');
  const a = mount(source);
  await createSkill(a);
  const exported = await exportSkill(a);

  const box = sandbox('r164-dup');
  const b = mount(box);
  const first = await b.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json } });
  assert.equal(first.status, 200);
  assert.equal(first.body.imported, true);
  const afterFirst = { store: storeDigest(box.root), tree: treeDigest(box.root) };

  const second = await b.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json } });
  assert.equal(second.status, 200);
  assert.equal(second.body.ok, true);
  assert.equal(second.body.imported, false);
  assert.equal(second.body.code, 'already-imported');
  assert.equal(second.body.saved, false);
  assert.equal(storeDigest(box.root), afterFirst.store, 'la repetición no escribe');
  assert.equal(treeDigest(box.root), afterFirst.tree);

  // Un adaptador nuevo sobre el mismo almacén (recarga real) sigue detectando la repetición.
  const reloaded = mount(box);
  const third = await reloaded.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json } });
  assert.equal(third.status, 200);
  assert.equal(third.body.code, 'already-imported');
});

test('§7.10: con onConflict:"copy" se conserva la existente y la copia se renombra con procedencia', async () => {
  const source = sandbox('r164-copy-src');
  const a = mount(source);
  await createSkill(a);
  const exported = await exportSkill(a);

  const box = sandbox('r164-copy');
  const b = mount(box);
  await createSkill(b, { body: `${candidate().body}\n\n## Extra\n\nlocal` });
  const localBefore = cloneJson(loadState(box.root).state.skills[SKILL_ID]);

  const copied = await b.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json, onConflict: 'copy', from: 'origen' } });
  assert.equal(copied.status, 200, JSON.stringify(copied.body).slice(0, 300));
  assert.equal(copied.body.imported, true);
  assert.equal(copied.body.renamed, true);
  assert.equal(copied.body.renamedFrom, SKILL_ID);
  assert.equal(copied.body.skill, `${SKILL_ID}-copia`);
  assert.equal(copied.body.saved, true);

  const state = loadState(box.root).state;
  assert.deepEqual(cloneJson(state.skills[SKILL_ID]), localBefore, 'la original no cambia');
  assert.ok(state.skills[`${SKILL_ID}-copia`], 'la copia existe con id propio');
  assert.equal(state.skills[`${SKILL_ID}-copia`].origin.bundleChecksum, exported.checksum);
  assert.equal(state.skills[`${SKILL_ID}-copia`].origin.originalSkillId, SKILL_ID);
});

// ---------------------------------------------------------------------------
// §7.4 — confirmación explícita
// ---------------------------------------------------------------------------

test('§7.4: import-bundle sin confirmed:true ⇒ 400 confirmation-required y cero escrituras', async () => {
  const source = sandbox('r164-confirm-src');
  const a = mount(source);
  await createSkill(a);
  const exported = await exportSkill(a);

  const box = sandbox('r164-confirm');
  const before = treeDigest(box.root);
  const b = mount(box);
  for (const confirmed of [undefined, false, 'true', 1]) {
    const body = { action: 'import-bundle', bundle: exported.json };
    if (confirmed !== undefined) body.confirmed = confirmed;
    const refused = await b.dispatch({ body });
    assert.equal(refused.status, 400, `confirmed=${JSON.stringify(confirmed)} debe ser 400`);
    assert.equal(refused.body.ok, false);
    assert.equal(refused.body.code, 'confirmation-required');
  }
  assert.equal(treeDigest(box.root), before, 'ninguna tentativa crea almacén');
});

// ---------------------------------------------------------------------------
// §7.13 — referencias fuera de la carpeta: rechazo sin escritura fuera de la raíz
// ---------------------------------------------------------------------------

test('§7.13: referencias con ".." o ruta absoluta ⇒ 400 invalid-references y árbol externo intacto', async () => {
  const source = sandbox('r164-refs-src');
  const a = mount(source);
  await createSkill(a);
  const exported = await exportSkill(a);
  const valid = JSON.parse(exported.json);
  const box = sandbox('r164-refs');
  const b = mount(box);
  const outsideBefore = treeDigest(box.box);
  const storeBefore = storeDigest(box.root);

  const fixtures = [
    { references: { '../fuera.md': 'contenido' }, label: '..' },
    { references: { 'references/../../fuera.md': 'contenido' }, label: '.. anidado' },
    { references: { 'C:\\secreto.txt': 'contenido' }, label: 'absoluta windows' },
    { references: { '/etc/passwd': 'contenido' }, label: 'absoluta posix' },
    { references: { 'otra-carpeta/x.md': 'contenido' }, label: 'fuera de references/' },
    { references: [{ path: 'references/bien.md', content: 42 }], label: 'contenido no textual' },
  ];
  for (const fixture of fixtures) {
    const bundle = cloneJson(valid);
    bundle.skill.references = fixture.references;
    bundle.checksum = bundleChecksum({
      body: bundle.skill.body,
      description: bundle.skill.description,
      whenToUse: bundle.skill.whenToUse,
      tags: bundle.skill.tags,
    });
    for (const action of ['inspect-bundle', 'import-bundle']) {
      const request = { action, bundle: JSON.stringify(bundle) };
      if (action === 'import-bundle') request.confirmed = true;
      const refused = await b.dispatch({ body: request });
      assert.equal(refused.status, 400, `${action} ${fixture.label}: esperaba 400`);
      assert.equal(refused.body.code, 'invalid-references', `${action} ${fixture.label}: código`);
      assert.ok(Array.isArray(refused.body.references) && refused.body.references.length > 0);
    }
  }

  assert.equal(storeDigest(box.root), storeBefore, 'ningún rechazo escribe el almacén');
  assert.equal(treeDigest(box.box), outsideBefore, 'ningún rechazo escribe fuera de la raíz');
  assert.equal(existsSync(join(box.box, 'fuera.md')), false);
});

// ---------------------------------------------------------------------------
// §7.17 — preflight block ⇒ cero escritura
// ---------------------------------------------------------------------------

test('§7.17: preflight block por colisión real ⇒ 409 preflight-blocked, findings/reasons/evidence y cero escritura', async () => {
  const source = sandbox('r164-block-src');
  const a = mount(source);
  await createSkill(a);
  const exported = await exportSkill(a);

  // Dos vistas materializadas de proyectos distintos con el mismo nombre y cuerpos distintos: colisión real
  // de las que el motor marca `block` (no una colisión fabricada a mano para el gate).
  const box = sandbox('r164-block');
  for (const project of ['p1', 'p2']) {
    const directory = join(box.root, 'materialized', project, SKILL_ID);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${SKILL_ID}\ndescription: copia ${project}\n---\n\n## Procedimiento\n\nCuerpo ${project} distinto.\n\n## Evidencia\n\nEvidencia ${project}.\n`);
  }
  const b = mount(box);
  const before = { store: storeDigest(box.root), tree: treeDigest(box.root) };

  const inspected = await b.dispatch({ body: { action: 'inspect-bundle', bundle: exported.json } });
  assert.equal(inspected.status, 200);
  assert.equal(inspected.body.preview.preflight.decision, 'block');
  assert.ok(inspected.body.preview.preflight.findings.some((finding) => finding.code === 'name-collision' && finding.severity === 'block'));

  const blocked = await b.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json } });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body).slice(0, 300));
  assert.equal(blocked.body.ok, false);
  assert.equal(blocked.body.code, 'preflight-blocked');
  assert.ok(Array.isArray(blocked.body.findings) && blocked.body.findings.length > 0);
  assert.ok(Array.isArray(blocked.body.reasons) && blocked.body.reasons.length > 0);
  assert.ok(blocked.body.evidence && blocked.body.evidence.preflightVersion >= 1);
  assert.equal(storeDigest(box.root), before.store, 'un block no escribe el almacén');
  assert.equal(treeDigest(box.root), before.tree, 'un block no crea ficheros');
});

// ---------------------------------------------------------------------------
// §7.14 — recuperación ante fallo de escritura
// ---------------------------------------------------------------------------

test('§7.14: si el artefacto no se puede escribir, no queda estado parcial y el almacén sigue legible', async () => {
  const box = sandbox('r164-recover');
  const center = mount(box);
  await createSkill(center);
  // El nombre del paquete es un DIRECTORIO: la escritura con `wx` falla de verdad (EISDIR).
  const destination = join(box.root, 'exports', `${SKILL_ID}-1.0.0.json`);
  mkdirSync(destination, { recursive: true });
  const before = { store: storeDigest(box.root), tree: treeDigest(box.root) };

  const failed = await center.dispatch({ body: { action: 'export-skill', skillId: SKILL_ID } });
  assert.equal(failed.body.ok, false, 'la exportación no puede fingir éxito');
  // En Windows escribir con `wx` sobre un directorio existente sale como EEXIST y el escritor lo rotula
  // «bundle-exists»; lo relevante para §7.14 es que falla honestamente sin estado parcial. La ruta de
  // error real (EACCES) se comprueba justo después con el escritor inyectable de `writeBundle`.
  assert.ok(['bundle-write-failed', 'bundle-exists'].includes(failed.body.code), `código honesto: ${failed.body.code}`);
  assert.equal(storeDigest(box.root), before.store, 'el almacén no cambia');
  assert.ok(existsSync(destination));
  assert.equal(readdirSync(destination).length, 0, 'no puede quedar un fichero a medias');

  // `writeBundle` recibe el escritor por parámetro: un EACCES real debe ser `bundle-write-failed`.
  const denied = writeBundle({
    root: box.root,
    state: loadState(box.root).state,
    skillId: SKILL_ID,
    now: NOW,
    writeFile: () => {
      const error = new Error('acceso denegado');
      error.code = 'EACCES';
      throw error;
    },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'bundle-write-failed');
  assert.equal(storeDigest(box.root), before.store, 'el fallo de escritura no toca el almacén');

  // El almacén sigue siendo legible y la operación es reintentable tras retirar el obstáculo.
  const state = loadState(box.root);
  assert.equal(state.integrity, 'ok');
  assert.ok(state.state.skills[SKILL_ID]);
  rmSync(destination, { recursive: true, force: true });
  const retried = await center.dispatch({ body: { action: 'export-skill', skillId: SKILL_ID } });
  assert.equal(retried.body.ok, true);
  assert.ok(existsSync(destination));
});

// ---------------------------------------------------------------------------
// §7.18 — tope de 512 KiB en lectura y escritura
// ---------------------------------------------------------------------------

test('§7.18: el tope de 512 KiB se aplica al leer y también al escribir', async () => {
  const box = sandbox('r164-limit');
  const center = mount(box);
  await createSkill(center);
  const exported = await exportSkill(center);
  const valid = JSON.parse(exported.json);
  const before = storeDigest(box.root);

  const oversized = JSON.stringify({
    ...valid,
    skill: { ...valid.skill, body: `${valid.skill.body}\n${'x'.repeat(MAX_BUNDLE_BYTES + 1024)}` },
  });
  assert.ok(Buffer.byteLength(oversized, 'utf8') > MAX_BUNDLE_BYTES);
  const refused = await center.dispatch({ body: { action: 'inspect-bundle', bundle: oversized } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'bundle-too-large');
  assert.equal(storeDigest(box.root), before);

  // El escritor aplica el mismo tope: un estado artificial con cuerpo enorme no produce fichero.
  const limitBox = sandbox('r164-limit-write');
  const fakeState = {
    ...emptyState(NOW),
    skills: {
      enorme: {
        id: 'enorme',
        title: 'enorme',
        status: 'published',
        currentVersion: '1.0.0',
        versions: [{
          version: '1.0.0',
          body: 'x'.repeat(MAX_BUNDLE_BYTES + 1024),
          description: '',
          whenToUse: '',
          tags: [],
          createdAt: NOW,
        }],
      },
    },
  };
  const written = writeBundle({ root: limitBox.root, state: fakeState, skillId: 'enorme', now: NOW });
  assert.equal(written.ok, false);
  assert.equal(written.code, 'bundle-too-large');
  assert.equal(existsSync(join(limitBox.root, 'exports')), false, 'no se crea ni la carpeta de exportaciones');
});

// ---------------------------------------------------------------------------
// §7.5/§7.19 — JSON estricto y aviso de posible secreto sin bloqueo
// ---------------------------------------------------------------------------

test('§7.19: possible-secret es un warning de portabilidad que no bloquea ni se ejecuta', async () => {
  const source = sandbox('r164-secret-src');
  const a = mount(source);
  await createSkill(a);
  const exported = await exportSkill(a);
  const bundle = JSON.parse(exported.json);
  bundle.skill.body += '\n\nConfigura la api_key = "sk-prueba-123" en el panel.';
  bundle.checksum = bundleChecksum({
    body: bundle.skill.body,
    description: bundle.skill.description,
    whenToUse: bundle.skill.whenToUse,
    tags: bundle.skill.tags,
  });

  const box = sandbox('r164-secret');
  const b = mount(box);
  const inspected = await b.dispatch({ body: { action: 'inspect-bundle', bundle: JSON.stringify(bundle) } });
  assert.equal(inspected.status, 200);
  assert.equal(inspected.body.ok, true);
  const reasons = inspected.body.preview.portability.warnings.map((warning) => warning.reason);
  assert.ok(reasons.includes('possible-secret'), `debe avisar del secreto: ${reasons.join(',')}`);
  assert.equal(inspected.body.preview.portability.portable, true, 'un texto que menciona una clave no vuelve la skill no portable');
  assert.notEqual(inspected.body.preview.preflight.decision, 'block', 'un aviso de secreto no bloquea');

  const imported = await b.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: JSON.stringify(bundle) } });
  assert.equal(imported.status, 200);
  // El aviso de portabilidad NO bloquea el preview, pero la compuerta de calidad del centro (independiente
  // de la portabilidad) se niega a guardar una credencial asignada: fallo honesto, sin escribir.
  assert.equal(imported.body.ok, false);
  assert.equal(imported.body.code, 'evaluation-failed');
  assert.ok((imported.body.evaluation?.checks ?? []).some((check) => check.code === 'secret.assignment' && check.severity === 'block'));
  assert.equal(existsSync(centerFile(box.root)), false, 'la compuerta de calidad no crea almacén');
  assert.equal(existsSync(join(box.root, 'skills')), false);
});

// ---------------------------------------------------------------------------
// §7.11-12/§7.15 — sin activación/asignación automática; auditoría durable
// ---------------------------------------------------------------------------

test('§7.11-12: importar no activa ni asigna la skill, y no concede política', async () => {
  const source = sandbox('r164-act-src');
  const a = mount(source);
  await createSkill(a);
  const exported = await exportSkill(a);

  const box = sandbox('r164-act');
  const b = mount(box);
  const knowledgeBefore = existsSync(join(box.root, 'knowledge.json')) ? readFileSync(join(box.root, 'knowledge.json')) : Buffer.from('');
  const imported = await b.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json } });
  assert.equal(imported.body.imported, true);

  const state = loadState(box.root).state;
  assert.deepEqual(state.assignments ?? {}, {}, 'importar no asigna la skill a ningún proyecto');
  assert.deepEqual(state.projects ?? {}, {}, 'importar no registra proyectos');
  assert.equal(
    (state.events ?? []).some((event) => event.type === 'skill.assigned' || event.type === 'skill.unassigned'),
    false,
    'no puede haber eventos de asignación',
  );
  const knowledgeAfter = existsSync(join(box.root, 'knowledge.json')) ? readFileSync(join(box.root, 'knowledge.json')) : Buffer.from('');
  assert.ok(knowledgeBefore.equals(knowledgeAfter), 'importar no toca políticas');

  // El adaptador sólo registró el proveedor una vez, al montar: importar no re-registra ni activa nada.
  assert.equal(b.providerRegistrations.length, 1);
});

test('§7.15: origin y evento skill-imported sobreviven a la recarga y un centro viejo no gana claves', async () => {
  const source = sandbox('r164-audit-src');
  const a = mount(source);
  await createSkill(a);
  const exported = await exportSkill(a);

  const box = sandbox('r164-audit');
  const b = mount(box);
  const imported = await b.dispatch({ body: { action: 'import-bundle', confirmed: true, bundle: exported.json, from: 'centro-a' } });
  assert.equal(imported.body.imported, true);

  // En los bytes del documento: procedencia completa y evento con la huella.
  const raw = readCenter(box.root);
  const origin = raw.skills[SKILL_ID].origin;
  assert.equal(origin.kind, 'import');
  assert.equal(origin.bundleChecksum, exported.checksum);
  assert.equal(origin.originalSkillId, SKILL_ID);
  assert.equal(origin.originalVersion, '1.0.0');
  assert.equal(origin.from, 'centro-a');
  assert.equal(origin.importedAt, imported.body.origin.importedAt);
  const event = (raw.events ?? []).find((entry) => entry.code === 'skill-imported');
  assert.ok(event, 'debe quedar un evento skill-imported');
  assert.equal(event.checksum, exported.checksum);
  assert.equal(event.originalSkillId, SKILL_ID);
  assert.equal(event.originalVersion, '1.0.0');
  assert.equal(event.renamed, false);
  assert.equal(event.renamedFrom, null);
  assert.equal(event.from, 'centro-a');

  // La recarga real (loadState) conserva la procedencia y el evento.
  const reloaded = loadState(box.root).state;
  assert.equal(reloaded.skills[SKILL_ID].origin.bundleChecksum, exported.checksum);
  assert.equal(reloaded.skills[SKILL_ID].origin.originalSkillId, SKILL_ID);
  const reloadedEvent = (reloaded.events ?? []).find((entry) => entry.code === 'skill-imported');
  assert.equal(reloadedEvent.checksum, exported.checksum);
  assert.equal(reloadedEvent.originalVersion, '1.0.0');
  assert.equal(SCHEMA_VERSION, 2, 'R16.4 no cambia la versión de esquema del centro');

  // Un centro anterior a R16.4 no gana claves al normalizarse ni al volver a guardarse.
  const oldBox = sandbox('r164-audit-old');
  const oldEvent = {
    id: 'ev-viejo', at: NOW, type: 'skill.created', skillId: 'vieja', projectId: '', version: '1.0.0', actor: 'human', note: '',
  };
  const oldState = { ...emptyState(NOW), events: [oldEvent] };
  saveState(oldBox.root, oldState, { now: NOW });
  const loaded = loadState(oldBox.root);
  assert.deepEqual(loaded.state.events[0], oldEvent, 'un evento viejo round-trip idéntico');
  saveState(oldBox.root, loaded.state, { now: NOW });
  assert.deepEqual(loadState(oldBox.root).state.events[0], oldEvent);
  assert.equal(loadState(oldBox.root).state.schemaVersion, SCHEMA_VERSION);
  const oldRaw = readCenter(oldBox.root);
  assert.equal(Object.hasOwn(oldRaw.events[0], 'code'), false, 'un evento viejo no gana "code"');
  assert.equal(Object.hasOwn(oldRaw.events[0], 'checksum'), false);
});
