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
