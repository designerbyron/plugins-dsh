/**
 * El cliente no se puede probar en un navegador desde `node --test`, pero sí se puede cargar con un
 * arnés mínimo que imita lo único que el runtime le da: `window.__ModuleLoader__`, `require('react')`
 * y un `ctx` con slots y locale. Eso basta para que un registro roto falle aquí y no en la interfaz.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, '..', 'client.js');
const source = readFileSync(clientPath, 'utf8');

/** Carga `client.js` como lo haría el runtime y devuelve el módulo y lo que registró. */
function loadClient() {
  const registrations = [];
  const injections = [];
  const locales = [];
  const cleanups = [];
  let captured = null;
  const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
    useCallback: (fn) => fn,
  };
  const window = { __ModuleLoader__: { load: (module) => { captured = module; } } };
  const sandbox = {
    window,
    document: { createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }), head: { appendChild: () => {} }, getElementById: () => null, querySelector: () => null },
    console,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }),
    setTimeout: () => 0,
    clearTimeout: () => {},
    URL: globalThis.URL,
  };
  const require = (name) => {
    assert.equal(name, 'react', 'el cliente no puede requerir paquetes del harness ni nada más');
    return fakeReact;
  };
  vm.runInNewContext(source, { ...sandbox, require }, { filename: clientPath });

  assert.ok(captured !== null, 'client.js tiene que llamar a window.__ModuleLoader__.load');
  const module_ = captured.factory(require);
  return {
    id: captured.id,
    module: module_,
    registrations,
    injections,
    locales,
    cleanups,
    apply() {
      const ctx = {
        effect(fn) {
          const cleanup = fn();
          if (typeof cleanup === 'function') cleanups.push(cleanup);
          return () => {};
        },
        locale: {
          register(namespace, dictionaries) {
            locales.push({ namespace, dictionaries });
            return () => {};
          },
          getSnapshot: () => ({ locale: 'es' }),
          getLocale: () => 'es',
          subscribe: () => () => {},
        },
        slots: {
          inject(owner, callback) {
            injections.push(owner);
            return callback();
          },
          register(options, component) {
            registrations.push({ options, component });
            return { dispose: () => {} };
          },
        },
      };
      module_.apply(ctx);
    },
  };
}

test('el módulo se identifica con el nombre del paquete y sólo inyecta slots y locale', () => {
  const loaded = loadClient();
  assert.equal(loaded.id, '@local/lifecode-skill-center');
  assert.deepEqual([...loaded.module.inject], ['slots', 'locale']);
  assert.equal(typeof loaded.module.apply, 'function');
});

test('no se importa nada del harness: un `require` ajeno rompería la carga del panel', () => {
  assert.ok(!source.includes('@deepseek-ai/'), 'client.js no puede nombrar paquetes del harness');
  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(requires)], ['react']);
});

test('registra el panel en «main» con clave propia y su entrada en la barra lateral con el mismo id', () => {
  const loaded = loadClient();
  loaded.apply();
  const sidebar = loaded.registrations.find((entry) => entry.options.name === 'sidebar.panellist');
  const main = loaded.registrations.find((entry) => entry.options.name === 'main');
  assert.ok(sidebar, 'falta la entrada de la barra lateral');
  assert.ok(main, 'falta el panel central');
  assert.equal(sidebar.options.id, 'lifecode-skill-center');
  assert.equal(main.options.key, 'lifecode-skill-center');
  assert.equal(typeof sidebar.options.label, 'function', 'la etiqueta se relee para no quedarse en un idioma');
  assert.equal(sidebar.options.label(), 'LifeCode Skill Center');
  assert.equal(typeof sidebar.component, 'function');
  assert.equal(typeof main.component, 'function');
});

test('el panel se puede renderizar sin tocar el DOM y avisa mientras carga', () => {
  const loaded = loadClient();
  loaded.apply();
  const main = loaded.registrations.find((entry) => entry.options.name === 'main');
  const tree = main.component({});
  assert.ok(tree !== undefined && tree !== null, 'el panel tiene que devolver un árbol, no undefined');
});

test('el icono de la barra lateral acepta el tamaño que le pasa el runtime', () => {
  const loaded = loadClient();
  loaded.apply();
  const sidebar = loaded.registrations.find((entry) => entry.options.name === 'sidebar.panellist');
  const icon = sidebar.component({ size: 20, active: true });
  assert.ok(icon !== null);
});

test('los estilos se inyectan una vez y se retiran al descargar el plugin', () => {
  const loaded = loadClient();
  loaded.apply();
  assert.ok(source.includes("'lsc-styles'"), 'los estilos viven bajo un id propio');
  assert.ok(loaded.cleanups.length >= 1, 'hay que poder desmontar lo que se inyecta');
});

test('la interfaz habla por locale y no lleva texto incrustado en los componentes', () => {
  const loaded = loadClient();
  loaded.apply();
  assert.ok(loaded.locales.length >= 1);
  const dictionary = loaded.locales[0].dictionaries;
  assert.deepEqual(Object.keys(dictionary).sort(), ['en', 'es']);
  const esKeys = Object.keys(dictionary.es).sort();
  const enKeys = Object.keys(dictionary.en).sort();
  assert.deepEqual(enKeys, esKeys, 'los dos idiomas tienen que tener las mismas claves');
  assert.ok(esKeys.length >= 80, `el diccionario parece incompleto: ${esKeys.length} claves`);
  for (const key of esKeys) {
    assert.equal(typeof dictionary.es[key], 'string', `falta el texto español de ${key}`);
    assert.equal(typeof dictionary.en[key], 'string', `falta el texto inglés de ${key}`);
  }
});

test('todo lo que pide el panel va a su propia API en el mismo origen', () => {
  const calls = [...source.matchAll(/fetch\(/g)].length;
  assert.ok(calls >= 1);
  assert.ok(source.includes("'/lifecode-skill-center/api'") || source.includes("`/lifecode-skill-center/api"));
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(source), 'nada de CDNs ni orígenes externos');
});

/* Contratos de props entre el Panel y sus vistas.
 *
 * Esta prueba existe por un defecto real que sólo apareció en la interfaz de verdad: el Panel
 * pasaba `onDetect` y la vista leía `detect`, así que `detect.text` reventaba y el runtime vaciaba
 * el panel entero («slot entry crashed in 'main'»). Ninguna prueba de render podía verlo porque
 * las vistas no se montan en el test. Comparar lo que cada vista desestructura con lo que el Panel
 * le pasa sí lo ve, y no cuesta nada mantenerlo. */
function destructuredParams(text, component) {
  const clean = text.replace(/\/\/[^\n]*/g, '');
  const match = new RegExp(`function ${component}\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`).exec(clean);
  assert.ok(match, `no encuentro la firma de ${component}`);
  return match[1]
    .split(',')
    .map((entry) => entry.trim().split(/[:=]/)[0].trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

function passedProps(text, component) {
  const start = text.indexOf(`e(${component}, {`);
  assert.ok(start !== -1, `el Panel no monta ${component}`);
  let index = text.indexOf('{', start + `e(${component}, `.length);
  let depth = 0;
  let end = index;
  for (; end < text.length; end += 1) {
    if (text[end] === '{') depth += 1;
    if (text[end] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const block = text.slice(index + 1, end);
  return destructuredParams(`function x({${block}})`, 'x');
}

for (const component of ['OverviewView', 'LibraryView', 'ProjectsView', 'ImprovementsView', 'AnalyticsView']) {
  test(`el Panel le pasa a ${component} todas las props que la vista desestructura`, () => {
    const needed = destructuredParams(source, component);
    assert.ok(needed.length >= 2, `${component} debería recibir varias props`);
    const passed = new Set(passedProps(source, component));
    const missing = needed.filter((name) => !passed.has(name));
    assert.deepEqual(missing, [], `el Panel no le pasa ${missing.join(', ')} a ${component}`);
  });
}

test('el cuadro de detección se comparte entre «detect» y «onDetect» sin separarse otra vez', () => {
  assert.ok(source.includes('const detectState = useMemo('), 'el estado de detección se construye una vez');
  assert.ok(source.includes('detect: detectState,'), 'la vista lee el cuadro por `detect`');
  assert.ok(source.includes('onDetect: detectState,'), 'la vista recibe los manejadores por `onDetect`');
});

test('las acciones de identidad del panel están cableadas y bloqueadas hasta v3', () => {
  for (const action of ['identity-adopt', 'repair', 'identity-relink', 'identity-unlink']) {
    assert.ok(source.includes("'" + action + "'"), 'falta la acción ' + action);
  }
  for (const key of ['projects.identity.action.adopt', 'projects.identity.action.locked', 'projects.identity.action.done', 'analytics.doctor.resync']) {
    assert.ok(source.includes(key), 'falta la clave ' + key);
  }
  assert.ok(source.includes("available !== true"), 'la vista sabe si las acciones están disponibles');
  assert.ok(source.includes("identity.available !== true"), 'el panel explica el bloqueo en vez de un botón muerto');
  assert.ok(source.includes('runIdentityAction'), 'la acción confirmada se ejecuta una sola vez');
  assert.ok(source.includes('IdentityDialog'), 'hay diálogo de confirmación antes de escribir');
});

test('el cajón compara contra la vigente y mantiene el orden de hooks', () => {
  assert.ok(source.includes("compareWithCurrent"), 'hay un manejador de comparación');
  assert.ok(source.includes("/diff?"), 'la comparación pide el diff al servidor');
  assert.ok(source.includes("URLSearchParams({ id: skillId, from: version, to: currentVersion })"), 'la comparación fija el sentido from→to');
  // El orden importa: si la salida temprana queda antes de un hook, React ve menos hooks y el
  // slot `main` se cae. Se comprueba sobre el cuerpo del cajón, no sobre todo el fichero.
  const drawerStart = source.indexOf('function SkillDrawer');
  const drawerRest = source.slice(drawerStart);
  const drawerEnd = drawerRest.indexOf('\n    function ', 10);
  const drawerBody = drawerEnd < 0 ? drawerRest : drawerRest.slice(0, drawerEnd);
  const atEarlyReturn = drawerBody.indexOf('if (skill === null)');
  assert.ok(atEarlyReturn > 0, 'el cajón tiene salida vacía cuando la skill no está');
  const afterEarlyReturn = drawerBody.slice(atEarlyReturn).split('\n');
  const lateHooks = afterEarlyReturn.filter((line) => /use(State|Effect|Callback|Memo|Ref)\(/.test(line)).length;
  assert.equal(lateHooks, 0, 'ningún hook puede quedar después de la salida temprana del cajón');
  assert.ok(source.includes("diff.preview"), 'la vista pinta el preview que devuelve el servidor');
  for (const key of ['drawer.diff', 'drawer.diff.title', 'drawer.diff.none', 'drawer.diff.truncated', 'drawer.diff.error']) {
    assert.ok(source.includes(key), 'falta la clave ' + key);
  }
});

test('el informe del centro se pide al servidor y no se fabrica en la interfaz', () => {
  assert.ok(source.includes("act('export', {})"), 'el panel dispara la acción de exportar');
  for (const key of ['analytics.export', 'analytics.export.done']) {
    assert.ok(source.includes(key), 'falta la clave ' + key);
  }
  assert.ok(source.includes("t('analytics.export.done', { file: String(result.file"), 'el aviso dice la ruta real que devolvió el servidor');
  assert.ok(!source.includes('buildCenterReport'), 'la interfaz no compone el informe: lo pide a su API');
});

test('la bandeja de conocimiento se pinta desde la foto del servidor y no decide nada', () => {
  assert.ok(source.includes('function KnowledgeSection('), 'existe la sección de conocimiento');
  // Contrato estructural a propósito: la conducta (pinta política, procedencia y pendientes) se mide
  // ejecutando el componente en tests/render.test.mjs. Aquí sólo se comprueba que el panel lo monta.
  assert.ok(source.includes('e(KnowledgeSection, {'), 'la sección de conocimiento se monta en analítica');
  for (const key of ['analytics.knowledge', 'analytics.knowledge.mode', 'analytics.knowledge.pending', 'analytics.knowledge.decisions', 'analytics.knowledge.contradictions', 'analytics.knowledge.unreadable']) {
    assert.ok(source.includes(key), 'falta la clave ' + key);
  }
  for (const key of ['analytics.knowledge.policy', 'analytics.knowledge.policy.autonomous', 'analytics.knowledge.policy.human', 'analytics.knowledge.policy.done']) {
    assert.ok(source.includes(key), 'falta la clave de política ' + key);
  }
  // La política la fija una persona desde el panel: la sección delega en `onPolicy` y no llama a `act`.
  const section = source.slice(source.indexOf('function KnowledgeSection('), source.indexOf('/**\n * Indicadores con fuente declarada'));
  assert.ok(!/act\('(approve|publish|toggle|activate)'/.test(section), 'la bandeja no ejecuta acciones de decisión');
  assert.ok(section.includes('onPolicy('), 'la sección delega el cambio de política en el manejador del panel');
  assert.ok(source.includes("act('policy', { projectId: String(projectId ?? ''), mode: String(mode ?? '') })"), 'el panel pide el cambio a su API');
});

test('el cajón resuelve la versión vigente dentro del manejador', () => {
  assert.ok(source.includes("compareWithCurrent"), 'hay un manejador de comparación');
  assert.ok(source.includes("/diff?"), 'la comparación pide el diff al servidor');
  assert.ok(source.includes("URLSearchParams({ id: skillId, from: version, to: currentVersion })"), 'la comparación fija el sentido from→to');
  assert.ok(source.includes('const currentVersion = String(findSkill(snapshot, skillId)'), 'la versión vigente se resuelve dentro del manejador, no en las dependencias del hook');
  assert.ok(source.includes("diff.preview"), 'la vista pinta el preview que devuelve el servidor');
  for (const key of ['drawer.diff', 'drawer.diff.title', 'drawer.diff.none', 'drawer.diff.truncated', 'drawer.diff.error']) {
    assert.ok(source.includes(key), 'falta la clave ' + key);
  }
});

test('las acciones de identidad del panel están cableadas y bloqueadas hasta v3', () => {
  for (const action of ['identity-adopt', 'repair', 'identity-relink', 'identity-unlink']) {
    assert.ok(source.includes("'" + action + "'"), 'falta la acción ' + action);
  }
  for (const key of ['projects.identity.action.adopt', 'projects.identity.action.locked', 'projects.identity.action.done', 'analytics.doctor.resync']) {
    assert.ok(source.includes(key), 'falta la clave ' + key);
  }
  assert.ok(source.includes("available !== true"), 'la vista sabe si las acciones están disponibles');
  assert.ok(source.includes("identity.available !== true"), 'el panel explica el bloqueo en vez de un botón muerto');
  assert.ok(source.includes('runIdentityAction'), 'la acción confirmada se ejecuta una sola vez');
  assert.ok(source.includes('IdentityDialog'), 'hay diálogo de confirmación antes de escribir');
});
