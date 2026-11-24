/**
 * Cobertura documental del panel (UX-22) — defecto medido en el Host del laboratorio con 1.5.5:
 *
 *   PROYECTOS LISTOS 1 · «1 de 1 proyectos con contexto» · DOCUMENTOS 0 · COBERTURA 100 %
 *
 *   …mientras la propia vista decía ««plugins-dhs» no tiene documentos todavía».
 *
 * La métrica que pintaba ese 100 % no medía documentación: era
 * `proyectos activos con raíz autorizada / proyectos activos` — configuración, no documentos, y con
 * cero documentos el cociente daba 100 % igual. Aquí se fija la definición que sustituye a esa:
 *
 *   cobertura documental = proyectos con raíz autorizada (activos) que tienen al menos un documento
 *   indexado / proyectos con raíz autorizada, contando SÓLO recuentos certificados por el snapshot, y
 *   «Sin datos» cuando no hay proyectos, falta algún recuento o no hay documentos.
 *
 * Sin red, sin fixtures y sin tocar `~/.dsh`: el `fetch` del panel es un doble en memoria y el estado
 * se hidrata con el retrato que el contrato PA describe (docs/PA-UI-0-API-CONTRACT.md §6.2).
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

import { createPaHandler, PA_PREFIX } from '../lib/pa-api.mjs';
import { addRoot, closeRegistry, createProject, openRegistry } from '../lib/registry.mjs';

const clientSource = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8');

/* --------------------------------------------------------------- runtime mínimo */

let runtime = null;

const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) };
  },
  useState(initial) { return runtime.useState(initial); },
  useRef(initial) { return runtime.useRef(initial); },
  useMemo(fn) { runtime.hook(); return fn(); },
  useCallback(fn) { runtime.hook(); return fn; },
  useEffect(fn) { runtime.hook(); runtime.effects.push(fn); return undefined; },
};

const fakeDocument = () => ({
  head: { appendChild() {} },
  createElement: () => ({ id: '', textContent: '', remove() {} }),
});

function loadModule({ fetch: fetchImpl } = {}) {
  let definition = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => { definition = def; } } },
    console,
    document: fakeDocument(),
    fetch: fetchImpl ?? (async () => { throw new Error('fetch inesperado: el panel pidió la red'); }),
    AbortController,
    Buffer,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' });
  assert.ok(definition, 'el módulo debe registrarse en window.__ModuleLoader__');
  const mod = definition.factory((name) => {
    if (name === 'react') return ReactStub;
    throw new Error('require inesperado: ' + name);
  });
  return { mod };
}

function walk(node, visit) {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
  if (typeof node === 'string' || typeof node === 'number') { visit({ text: String(node) }); return; }
  if (typeof node === 'object' && node.type) {
    visit(node);
    (node.children || []).forEach((child) => walk(child, visit));
  }
}

function textOf(node) {
  let text = '';
  walk(node, (item) => { if (item.text !== undefined) text += ' ' + item.text; });
  return text.replace(/\s+/g, ' ').trim();
}

function mount(component, props) {
  const state = { cells: [], index: 0, effects: [], tree: null };
  runtime = {
    effects: state.effects,
    hook() { state.index += 1; },
    useState(initial) {
      const slot = state.index;
      state.index += 1;
      if (!(slot in state.cells)) state.cells[slot] = typeof initial === 'function' ? initial() : initial;
      return [state.cells[slot], (next) => {
        state.cells[slot] = typeof next === 'function' ? next(state.cells[slot]) : next;
        render();
      }];
    },
    useRef(initial) {
      const slot = state.index;
      state.index += 1;
      if (!(slot in state.cells)) state.cells[slot] = { current: initial };
      return state.cells[slot];
    },
  };
  function render() {
    state.index = 0;
    state.effects.length = 0;
    state.tree = component(props);
  }
  render();
  return {
    get tree() { return state.tree; },
    runEffects() { for (const effect of state.effects.slice()) effect(); },
    text() { return textOf(state.tree); },
    /** Texto de la tarjeta de métrica identificada por `data-kpi`. */
    kpi(key) {
      let found = null;
      walk(state.tree, (node) => { if (node.props && node.props['data-kpi'] === key) found = node; });
      return found ? textOf(found) : null;
    },
  };
}

/** Doble de `fetch` con un snapshot fijo. Cero red: la respuesta se construye en memoria. */
function respondWith(snapshot) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: snapshot }),
    text: async () => JSON.stringify({ ok: true, data: snapshot }),
  });
}

async function settle() {
  for (let round = 0; round < 8; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Monta el PANEL completo y espera a que negocie y hidrate con `snapshot`. */
async function mountPanel(snapshot, lang = 'es') {
  const { mod } = loadModule({ fetch: respondWith(snapshot) });
  const { PaPanel, paTranslate } = mod.__test;
  const panel = mount(PaPanel, { t: (key, vars) => paTranslate(lang, key, vars) });
  panel.runEffects();
  await settle();
  return { panel, mod };
}

/* ------------------------------------------------------------------- retratos */

function documento(index) {
  return {
    id: 'src_' + index,
    uri: 'C:/lab/corpus/doc-' + index + '.md',
    title: 'doc-' + index + '.md',
    mime: 'text/markdown',
    bytes: 512,
    chunks: 2,
    indexedAt: '2026-11-23T10:00:00.000Z',
  };
}

/**
 * Retrato PA mínimo. `docs` es el recuento de documentos indexados por proyecto tal como lo
 * certifica el snapshot: el del proyecto activo sale de `sources.total`; los demás sólo si el
 * perfil los publica (campo aditivo `docs`). `sources: null` = snapshot que NO declara la colección.
 */
function retrato({ counts = [0], service = 'ok', declareSources = true, projectCount = counts.length } = {}) {
  const ids = ['prj_a', 'prj_b', 'prj_c', 'prj_d'];
  const projects = [];
  for (let index = 0; index < projectCount; index += 1) {
    const docs = index < counts.length ? counts[index] : null;
    projects.push({
      id: ids[index],
      name: ['Alfa', 'Beta', 'Gamma', 'Delta'][index],
      status: 'active',
      roots: 1,
      total: 1,
      current: index === 0,
      selectable: true,
      ...(docs === null ? {} : { docs }),
    });
  }
  const activo = projects[0];
  const total = counts.length > 0 ? counts[0] : 0;
  return {
    mode: 'api',
    service,
    asOf: 1763856000000,
    version: 'pa/1.5.0',
    project: activo ? { id: activo.id, name: activo.name } : null,
    selection: activo
      ? { projectId: activo.id, projectName: activo.name, revision: 1, source: 'explicit', selectedBy: 'human' }
      : null,
    projects,
    archived: [],
    roots: [],
    scopes: activo
      ? [{ kind: 'prj', id: activo.id, name: activo.name, roots: 1, authorized: 1 }]
      : [],
    libraries: [],
    ...(declareSources
      ? { sources: { rows: Array.from({ length: total }, (_, i) => documento(i)), total, nextCursor: null } }
      : {}),
    audit: { head: 0 },
  };
}

/* -------------------------------------------------------------------- pruebas */

test('paDocumentalCoverage: la definición es proyectos con documentos sobre proyectos con raíz autorizada', () => {
  const { mod } = loadModule();
  const { paDocumentalCoverage } = mod.__test;
  // El módulo vive en otro contexto de `vm`: se compara la forma, no el prototipo del objeto.
  const plain = (value) => JSON.parse(JSON.stringify(value));

  // Sin proyectos con raíz autorizada no hay denominador: no hay porcentaje que dar.
  assert.equal(paDocumentalCoverage([]), null);
  assert.equal(paDocumentalCoverage(undefined), null);
  // Un proyecto sin raíz autorizada no está «configurado»: fuera del denominador y del numerador.
  assert.equal(paDocumentalCoverage([{ id: 'p', rootCount: 0, docs: 5 }]), null);
  // Recuento desconocido en un proyecto: no se completa con una suposición.
  assert.equal(paDocumentalCoverage([{ id: 'a', rootCount: 1, docs: 2 }, { id: 'b', rootCount: 1, docs: null }]), null);
  // Cero documentos: ni 0 % ni 100 %, «sin datos».
  assert.equal(paDocumentalCoverage([{ id: 'a', rootCount: 1, docs: 0 }]), null);

  const uno = paDocumentalCoverage([{ id: 'a', rootCount: 1, docs: 4 }]);
  assert.deepEqual(plain(uno), { percent: 100, withDocs: 1, total: 1, indexed: 4 });

  const tercios = paDocumentalCoverage([
    { id: 'a', rootCount: 1, docs: 3 }, { id: 'b', rootCount: 1, docs: 0 }, { id: 'c', rootCount: 1, docs: 0 },
  ]);
  assert.deepEqual(plain(tercios), { percent: 33, withDocs: 1, total: 3, indexed: 3 });

  const dosTercios = paDocumentalCoverage([
    { id: 'a', rootCount: 1, docs: 2 }, { id: 'b', rootCount: 1, docs: 1 }, { id: 'c', rootCount: 1, docs: 0 },
  ]);
  assert.deepEqual(plain(dosTercios), { percent: 67, withDocs: 2, total: 3, indexed: 3 });

  const todos = paDocumentalCoverage([
    { id: 'a', rootCount: 2, docs: 1 }, { id: 'b', rootCount: 1, docs: 9 },
  ]);
  assert.deepEqual(plain(todos), { percent: 100, withDocs: 2, total: 2, indexed: 10 });
});

test('cobertura documental: un proyecto sin documentos dice «Sin datos», no 100 % (defecto del Host)', async () => {
  // El retrato exacto del laboratorio: 1 proyecto con raíz, `sources` vacío, servicio ok.
  const { panel } = await mountPanel(retrato({ counts: [0] }));

  const proyectos = panel.kpi('projects');
  const documentos = panel.kpi('documents');
  const cobertura = panel.kpi('coverage');

  assert.equal(proyectos, 'Proyectos configurados 1 1 de 1 proyectos con raíz autorizada');
  assert.equal(documentos, 'Documentos indexados 0 en el proyecto activo');
  assert.equal(cobertura.includes('Cobertura documental'), true, 'la tarjeta se nombra por lo que mide: ' + cobertura);
  assert.equal(cobertura.includes('Sin datos'), true, 'sin documentos la cobertura es «Sin datos»: ' + cobertura);
  assert.equal(/\d+%/.test(cobertura), false, 'no puede haber porcentaje sin documentos: ' + cobertura);
  assert.equal(panel.text().includes('no tiene documentos todavía'), true, 'la vista declara el proyecto vacío');
});

test('cobertura documental: un proyecto con documentos da el porcentaje exacto de la definición', async () => {
  const { panel } = await mountPanel(retrato({ counts: [3] }));
  assert.equal(panel.kpi('documents'), 'Documentos indexados 3 en el proyecto activo');
  assert.equal(panel.kpi('coverage'), 'Cobertura documental 100% 1 de 1 proyectos con documentos');

  // Dos documentos en el mismo proyecto siguen siendo 1 de 1: la unidad es el proyecto, no el documento.
  const { panel: otro } = await mountPanel(retrato({ counts: [2] }));
  assert.equal(otro.kpi('coverage'), 'Cobertura documental 100% 1 de 1 proyectos con documentos');
  assert.equal(otro.kpi('documents'), 'Documentos indexados 2 en el proyecto activo');
});

test('cobertura documental: varios proyectos con recuentos distintos dan su fracción', async () => {
  const { panel: tercios } = await mountPanel(retrato({ counts: [3, 0, 0] }));
  assert.equal(tercios.kpi('coverage'), 'Cobertura documental 33% 1 de 3 proyectos con documentos');
  assert.equal(tercios.kpi('projects'), 'Proyectos configurados 3 3 de 3 proyectos con raíz autorizada');

  const { panel: dosTercios } = await mountPanel(retrato({ counts: [2, 1, 0] }));
  assert.equal(dosTercios.kpi('coverage'), 'Cobertura documental 67% 2 de 3 proyectos con documentos');

  const { panel: completo } = await mountPanel(retrato({ counts: [1, 2, 4] }));
  assert.equal(completo.kpi('coverage'), 'Cobertura documental 100% 3 de 3 proyectos con documentos');

  // Ningún proyecto con documentos: «Sin datos», aunque haya tres configurados.
  const { panel: vacio } = await mountPanel(retrato({ counts: [0, 0, 0] }));
  assert.equal(vacio.kpi('coverage').includes('Sin datos'), true);
  assert.equal(/\d+%/.test(vacio.kpi('coverage')), false);
});

test('cobertura documental: un proyecto sin almacén (snapshot degradado) no rompe ni inventa porcentaje', async () => {
  // Contrato §6.2: el proyecto registrado sin `scopes/<id>/rag.sqlite3` responde 200 con `sources`
  // vacío y `service: 'degraded'`. Es «proyecto vacío», no «sin conexión», y tampoco es cobertura.
  const { panel } = await mountPanel(retrato({ counts: [0], service: 'degraded' }));
  const cobertura = panel.kpi('coverage');
  assert.equal(cobertura.includes('Sin datos'), true, 'sin almacén no hay documentos que medir: ' + cobertura);
  assert.equal(/\d+%/.test(cobertura), false);
  assert.equal(panel.kpi('documents'), 'Documentos indexados 0 en el proyecto activo');
});

test('cobertura documental: un snapshot sin «sources» dice «Sin datos» y no lanza', async () => {
  const { panel } = await mountPanel(retrato({ counts: [0], declareSources: false }));
  assert.equal(panel.text().length > 0, true, 'la vista se pinta igual');
  assert.equal(panel.kpi('documents'), 'Documentos indexados — sin recuento del proyecto activo');
  assert.equal(panel.kpi('coverage').includes('Sin datos'), true);
  assert.equal(/\d+%/.test(panel.kpi('coverage')), false);

  // Y en el nivel de la métrica: el recuento ausente es «desconocido», no cero.
  const { mod } = loadModule();
  const { paInitialState, paReduce, paOverviewMetrics } = mod.__test;
  const state = paReduce(paInitialState(), { type: 'hydrate', snapshot: retrato({ counts: [0], declareSources: false }) });
  const metrics = paOverviewMetrics(state);
  assert.equal(metrics.docsKnown, false);
  assert.equal(metrics.coverage, null);
});

test('el panel separa proyectos configurados, documentos indexados y cobertura documental', async () => {
  const { panel } = await mountPanel(retrato({ counts: [1, 0] }));
  const etiquetas = [];
  walk(panel.tree, (node) => {
    if (node.props && node.props.className === 'lcr-pa-kpi__label') etiquetas.push(textOf(node));
  });
  assert.deepEqual(etiquetas, [
    'Proyectos configurados',
    'Documentos indexados',
    'Cobertura documental',
  ], 'las tres métricas se nombran por lo que miden');
  // La configuración ya no se presenta como cobertura: «Cobertura» a secas no existe como tarjeta.
  assert.equal(etiquetas.includes('Cobertura'), false);
  assert.equal(etiquetas.includes('Proyectos listos'), false, 'el rótulo antiguo medía configuración, no «estar listo»');
});

test('cobertura documental: el retrato REAL de un proyecto sin almacén no produce porcentaje', async () => {
  // No se escribe el retrato a mano: lo emite el handler PA sobre un perfil temporal con un proyecto
  // registrado y su raíz, pero SIN almacén (no hubo ingesta). Es el escenario medido en el Host.
  const base = mkdtempSync(join(tmpdir(), 'panel-degraded-'));
  try {
    const root = join(base, 'perfil');
    const docsDir = join(base, 'proyecto');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, 'guia.md'), '# Guía\n\ncontenido\n', 'utf8');
    const opened = openRegistry({ root, create: true });
    const proyecto = createProject(opened.db, { name: 'plugins-dhs' });
    addRoot(opened.db, { scopeKind: 'prj', scopeId: proyecto.id, path: docsDir, addedBy: 'human' });
    closeRegistry(opened.db);

    const handler = createPaHandler({
      profileRoot: root,
      profileKey: 'panel-degraded',
      authorize: async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'host' } } }),
    });
    const res = {
      statusCode: 0, headers: {}, body: '',
      setHeader(key, value) { this.headers[key] = value; },
      end(body) { this.body = body; },
    };
    await handler(
      { url: PA_PREFIX + '/snapshot', method: 'GET', headers: {}, async *[Symbol.asyncIterator]() {} },
      res,
    );
    const snapshot = JSON.parse(res.body).data;
    // El retrato es el del contrato §6.2: proyecto, cero fuentes y servicio degradado.
    assert.equal(res.statusCode, 200);
    assert.equal(snapshot.service, 'degraded');
    assert.deepEqual(snapshot.sources, { rows: [], total: 0, nextCursor: null });
    assert.equal(snapshot.projects.length, 1);
    assert.equal(snapshot.projects[0].roots, 1);

    const { panel, mod } = await mountPanel(snapshot);
    const cobertura = panel.kpi('coverage');
    assert.equal(cobertura.includes('Sin datos'), true, 'sin documentos no hay cobertura: ' + cobertura);
    assert.equal(/\d+%/.test(cobertura), false, 'ni 0 % ni 100 % sobre un almacén que no existe');
    assert.equal(panel.kpi('projects'), 'Proyectos configurados 1 1 de 1 proyectos con raíz autorizada');
    assert.equal(panel.kpi('documents'), 'Documentos indexados 0 en el proyecto activo');

    const { paInitialState, paReduce, paOverviewMetrics } = mod.__test;
    const metrics = paOverviewMetrics(paReduce(paInitialState(), { type: 'hydrate', snapshot }));
    assert.equal(metrics.configured, 1, 'la configuración sí se mide: hay un proyecto con raíz');
    assert.equal(metrics.coverage, null, 'la cobertura documental no: no hay documentos');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

/*
 * TEXTO de las tres tarjetas. El defecto que abrió esto fue de vocabulario: con 0 documentos la
 * tarjeta decía «1 de 1 proyectos con contexto» y la cobertura «Sin datos». Aquí se fija que la
 * tarjeta de proyectos nombra lo ÚNICO que mide —raíz autorizada— y que no queda ni un «con
 * contexto» en la vista, ni en español ni en inglés, con 0, 1 y varios proyectos.
 */
test('KPI de proyectos: dice «raíz autorizada», nunca «con contexto», en ES y EN con 0, 1 y varios', async () => {
  const casos = [
    { counts: [], proyectos: 0 },
    { counts: [0], proyectos: 1 },
    { counts: [0, 0, 0], proyectos: 3 },
  ];
  const TEXTOS = {
    es: {
      tarjeta: 'Proyectos configurados',
      root: 'proyectos con raíz autorizada',
      prohibido: /con contexto/i,
      sinDatos: 'Sin datos',
      vacio: 'Todavía no hay proyectos configurados',
    },
    en: {
      tarjeta: 'Configured projects',
      root: 'projects with an authorized root',
      prohibido: /with context/i,
      sinDatos: 'No data',
      vacio: 'No configured projects yet',
    },
  };

  for (const { counts, proyectos } of casos) {
    for (const lang of ['es', 'en']) {
      const textos = TEXTOS[lang];
      const { panel } = await mountPanel(retrato({ counts }), lang);
      const tarjeta = panel.kpi('projects');

      assert.equal(
        tarjeta,
        `${textos.tarjeta} ${proyectos} ${proyectos} ${lang === 'es' ? 'de' : 'of'} ${proyectos} ${textos.root}`,
        `la tarjeta de proyectos (${lang}/${proyectos}) dice exactamente lo que mide: ` + tarjeta,
      );
      assert.equal(tarjeta.includes(textos.root), true, 'nombra la raíz autorizada: ' + tarjeta);
      assert.equal(textos.prohibido.test(tarjeta), false, 'una raíz no es contexto documental: ' + tarjeta);
      assert.equal(textos.prohibido.test(panel.text()), false, 'ningún texto de la vista deduce contexto de la raíz');

      // La cobertura documental sigue siendo `paDocumentalCoverage`: sin documentos, «Sin datos» y
      // ni un porcentaje sobre cero documentos.
      const cobertura = panel.kpi('coverage');
      assert.equal(/\d+%/.test(cobertura), false, `sin documentos no hay porcentaje (${lang}/${proyectos}): ` + cobertura);
      assert.equal(cobertura.includes(textos.sinDatos), true, 'la cobertura declara «Sin datos»: ' + cobertura);
      if (proyectos === 0) {
        assert.equal(panel.text().includes(textos.vacio), true, 'el estado vacío habla de configuración, no de contexto');
      }
    }
  }
});

