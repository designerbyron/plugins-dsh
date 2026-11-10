#!/usr/bin/env node
/**
 * Activación, ejecutada de verdad.
 *
 * El plugin falló al encenderse y ese fallo solo se veía en la interfaz. Esta prueba hace lo mismo que
 * el harness cuando activa el bundle —importar `index.js` y llamar a `apply(ctx)` con un contexto— y
 * comprueba que **no lanza** y que registra las cuatro cosas: la sección del prompt, las cuatro
 * herramientas (compiladas por el `defineTool` real), el proveedor de skills y la proyección.
 *
 * Lo que NO cubre, y se dice: el contexto es un doble, así que valida el camino del plugin, no el
 * comportamiento del harness con sus servicios de verdad.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { apply, inject, name } from '../index.js';
import { createCatalogSignal } from '../lib/catalog-signal.mjs';
import { propose } from '../lib/compiler.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

// La prosa de este fichero se afirma en español: el idioma se fija explícitamente (el base es `en`).
process.env.DSH_LANG = 'es';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';

/** Un contexto con la forma mínima que el plugin usa. Si el plugin toca algo que no está, se ve aquí. */
function fakeContext(services = {}) {
  const seen = { sections: [], tools: [], providers: [], injected: [], effects: 0 };
  const disposers = [];
  const ctx = {
    systemPrompt: { section: (section) => seen.sections.push(section) },
    tools: { register: (tool) => seen.tools.push(tool) },
    skills: { registerProvider: (factory) => seen.providers.push(factory) },
    // Contrato real de Cordis: el callback del hijo devuelve su disposer y `inject` lo devuelve a quien
    // lo llamó. El doble anterior lo descartaba, y con eso una prueba no podía ver una fuga.
    inject: (deps, callback) => { seen.injected.push(deps); return callback(services); },
    // El plugin no escucha eventos: el montaje por sesión llega por el provider (vía medida contra el
    // registro real). El doble no declara `on` a propósito, para que usarlo aquí sea un fallo visible.
    // El efecto devuelve el disposer real: el harness los llama al descargar el plugin, y la prueba tiene
    // que hacer lo mismo — dejar la vigilancia de catálogo abierta sería dejar un recurso vivo.
    effect: (callback) => { seen.effects += 1; const dispose = callback(); disposers.push(dispose); return dispose; },
  };
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) if (typeof dispose === 'function') dispose();
  };
  return { ctx, seen, disposeAll };
}

describe('activación', () => {
  it('se declara con identidad y servicios, y no exige nada opcional para arrancar', () => {
    assert.equal(name, 'skill-compiler');
    assert.deepEqual(inject, ['tools', 'skills', 'systemPrompt']);
    assert.equal(inject.includes('sessionProjections'), false, 'la proyección es opcional: no puede impedir el arranque');
  });

  it('apply() no lanza y registra la sección, las cinco herramientas y el proveedor', () => {
    const s = sandbox();
    const { ctx, seen, disposeAll } = fakeContext();

    // Es la llamada que hacía fallar al plugin: dentro compila las cinco definiciones.
    // Señal propia sin vigilancia: esta prueba mide la activación, no el sistema de ficheros.
    apply(ctx, { root: s.root, catalog: createCatalogSignal({ root: s.root, watch: false }) });

    assert.equal(seen.sections.length, 1);
    assert.equal(seen.sections[0].name, 'skill-compiler:protocol');
    assert.equal(seen.sections[0].interpolate, false);
    assert.equal(seen.sections[0].text.includes('skill_propose'), true);

    assert.deepEqual(seen.tools.map((t) => t.name).sort(),
      ['skill_improve', 'skill_propose', 'skill_review', 'skill_upstream_check', 'skill_vendor']);
    // Cada herramienta trae el esquema de parámetros que verá el modelo: si `defineTool` no se hubiera
    // podido cargar, esto estaría vacío.
    const propose = seen.tools.find((t) => t.name === 'skill_propose');
    assert.deepEqual(Object.keys(propose.parameters.properties).sort(),
      ['body', 'description', 'evidence', 'group', 'id', 'references', 'revision', 'tags', 'whenToUse']);
    assert.deepEqual([...propose.parameters.required].sort(), ['body', 'description', 'id', 'whenToUse']);

    assert.equal(seen.providers.length, 1, 'el proveedor de skills tiene que quedar registrado');
    disposeAll();
  });

  it('la proyección y los comandos se piden como opcionales, sin bloquear el arranque si no están', () => {
    const s = sandbox();
    const { ctx, seen, disposeAll } = fakeContext();
    apply(ctx, { root: s.root });
    disposeAll();
    // Si el perfil no resuelve la biblioteca de esquemas —o no monta el registro de comandos—, el plugin
    // pierde ese adorno o esa superficie y conserva el trabajo: por eso ninguna de las dos aparece en
    // `inject`, que es la lista de dependencias que el harness exige para activar el plugin.
    assert.deepEqual(seen.injected.map((deps) => deps.join()) .sort(), ['commands', 'sessionProjections']);
    assert.equal(inject.includes('commands'), false);
    assert.equal(inject.includes('sessionProjections'), false);
  });

  it('el proveedor que registra sirve skills del almacén y solo del proyecto que le piden', async () => {
    const s = sandbox();
    const { ctx, seen, disposeAll } = fakeContext();
    apply(ctx, { root: s.root });
    const provider = seen.providers[0]();
    const candidates = await provider.list({ cwd: 'C:\\un\\proyecto' });
    assert.deepEqual(candidates, [], 'sin nada propuesto ni aprobado, no sirve nada');
    assert.equal(provider.name, 'skill-compiler');
    disposeAll();
  });

  it('registra los comandos humanos, con la forma que el harness exige', () => {
    const s = sandbox();
    const registered = [];
    const { ctx, disposeAll } = fakeContext({ commands: { register: (command) => { registered.push(command); return () => {}; } } });
    apply(ctx, { root: s.root });
    disposeAll();

    // Las 16 operaciones con el nombre del idioma resuelto (este fichero fija `DSH_LANG=es`), mas el
    // comando estable `/skill-compiler-language`, que vive FUERA del conjunto que cambia y por eso aparece
    // siempre. Una fila por operacion: 17 en total, ni una mas.
    assert.deepEqual(registered.map((c) => c.name).sort(),
      [
        'skill-ambito', 'skill-aprobar', 'skill-auto', 'skill-compiler-language', 'skill-deshabilitar',
        'skill-eliminar', 'skill-globalizar', 'skill-habilitar', 'skill-pendientes', 'skill-propiedad',
        'skill-propiedad-dsh-only', 'skill-propiedad-machine', 'skill-propuestas', 'skill-rechazar',
        'skill-retiradas', 'skill-sistemas', 'skill-ver',
      ]);
    // El nombre del otro idioma NO convive: era la mitad del defecto (31 filas para 16 operaciones).
    for (const ingles of ['skill-approve', 'skill-proposals', 'skill-show', 'skill-reject', 'skill-retire']) {
      assert.equal(registered.some((c) => c.name === ingles), false, `${ingles} no convive con el nombre espanol`);
    }
    // Y ningun descriptor declara metadatos de alias: el modelo se retiro.
    for (const command of registered) {
      assert.equal(command.aliasOf, undefined, `${command.name}: declara aliasOf`);
      assert.equal(command.deprecatedIn, undefined, `${command.name}: declara deprecatedIn`);
    }
    const localizado = registered.find((c) => c.definitionId === 'skill-compiler.approve');
    assert.notEqual(localizado, undefined, 'la operacion localizada declara su id interno estable');
    for (const command of registered) {
      assert.match(command.name, /^[a-z][a-z0-9_-]*$/);
      assert.equal(command.description.trim().length > 0, true);
      assert.equal(typeof command.handler, 'function');
    }
  });

  it('conserva la invalidación del registro y la usa al aprobar: la frescura sin reiniciar', () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    const registered = [];
    let invalidations = 0;

    const { ctx, seen, disposeAll } = fakeContext({ commands: { register: (command) => { registered.push(command); return () => {}; } } });
    apply(ctx, { root: s.root, catalog: signal });

    // El registro entrega su capacidad de invalidación al registrar el provider. El plugin tiene que
    // CONSERVARLA: sin ella, el catálogo cacheado no cambia nunca y una skill aprobada no llega al agente.
    const provider = seen.providers[0]({ invalidate: () => { invalidations += 1; } });
    assert.equal(provider.name, 'skill-compiler');
    signal.notify();
    assert.equal(invalidations, 1, 'la señal tiene que estar atada a la invalidación del registro');

    // Y aprobar desde el harness avisa a esa misma capacidad: es lo que hace usable la skill al instante.
    // El comando se busca por su **id interno estable**, no por su nombre: el nombre cambia con el idioma y
    // el id no, que es justo la razon de declararlo.
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const aprobar = registered.find((c) => c.definitionId === 'skill-compiler.approve');
    assert.notEqual(aprobar, undefined, 'el comando de aprobar tiene que estar registrado en su idioma');
    const result = aprobar.handler({ agent: { session: { header: { cwd: CWD } } }, rawInput: 'measured-decision-check --local' });
    assert.equal(result.kind, 'success', JSON.stringify(result));
    assert.equal(invalidations, 2, 'aprobar tiene que avisar al catálogo');
    disposeAll();
  });
  it('cada agente ve las filas de SU proyecto, y jamás las de otro', async () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    const OTRO = 'C:\\xampp\\htdocs\\duranspainting';

    // Un registro de verdad en miniatura por ámbito: el global y uno por agente. Aceptan definiciones y
    // honran el disposer, que es el contrato del registro de comandos del harness.
    const mini = () => {
      const map = new Map();
      return { map, commands: { register: (command) => { map.set(command.name, command); return () => map.delete(command.name); } } };
    };
    const global = mini();
    const perAgent = new Map();
    const agentFor = (cwd) => {
      const scope = mini();
      perAgent.set(cwd, scope);
      return { session: { header: { cwd } }, ctx: fakeContext({ commands: scope.commands }).ctx };
    };
    const { ctx, seen, disposeAll } = fakeContext({ commands: global.commands });
    apply(ctx, { root: s.root, catalog: signal });

    // Una pendiente en cada proyecto: el defecto reportado fue verlas todas mezcladas en el menú.
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    propose({ ...goodInput(), id: 'pendiente-del-otro-proyecto', description: 'Otra cosa distinta de la anterior, pensada para el otro proyecto.' },
      { root: s.root, curated: s.curated, cwd: OTRO });

    // Nadie ha montado todavía: sin sesión no hay filas, ni en el global ni por agente.
    assert.equal(global.map.size, 17, 'el global tiene los 16 comandos del idioma y el comando estable, y ninguna fila');

    // El montaje entra por el provider, que el registro llama con `{ cwd, agent }`: es la vía medida
    // contra el registro real, y no depende de que un evento alcance el contexto raíz.
    const provider = seen.providers[0]();
    await provider.list({ cwd: CWD, agent: agentFor(CWD) });
    await provider.list({ cwd: OTRO, agent: agentFor(OTRO) });

    const filasDe = (cwd) => [...perAgent.get(cwd).map.keys()].filter((n) => n.startsWith('skill-aprobar-'));
    assert.deepEqual(filasDe(CWD), ['skill-aprobar-measured-decision-check'], 'la sesión ve lo suyo');
    assert.deepEqual(filasDe(OTRO), ['skill-aprobar-pendiente-del-otro-proyecto'], 'y la otra, lo suyo');
    assert.equal(global.map.size, 17, 'las filas no se registran en el global: ahí se ofrecerían a todos');

    // Decidir en una sesión no toca las filas de la otra.
    const fila = perAgent.get(CWD).map.get('skill-aprobar-measured-decision-check');
    assert.equal(fila.input, undefined, 'la fila se ejecuta al elegirla: no reclama argumentos');
    assert.equal(fila.handler({ agent: { session: { header: { cwd: CWD } } } }).kind, 'success');
    assert.deepEqual(filasDe(CWD), [], 'las suyas se retiran al decidir');
    assert.deepEqual(filasDe(OTRO), ['skill-aprobar-pendiente-del-otro-proyecto'], 'las del otro proyecto siguen intactas');

    disposeAll();
    assert.equal(global.map.size, 0, 'descargar el plugin no deja comandos colgando');
    for (const scope of perAgent.values()) assert.equal(scope.map.size, 0, 'ni filas de sesión');
  });

  it('recomputar no re-registra lo mismo: sin cambio real, el menú no parpadea', async () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    let registrations = 0;
    const registry = new Map();
    const commands = {
      register: (command) => {
        registrations += 1;
        registry.set(command.name, command);
        return () => registry.delete(command.name);
      },
    };
    const agentCtx = fakeContext({ commands }).ctx;
    const { ctx, seen, disposeAll } = fakeContext({ commands });
    apply(ctx, { root: s.root, catalog: signal });
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });

    // El ámbito entra por el provider, que recibe la sesión con su agente: quien decide qué filas hay
    // es la sesión que pide el catálogo, no el proceso entero.
    await seen.providers[0]().list({ cwd: CWD, agent: { session: { header: { cwd: CWD } }, ctx: agentCtx } });
    assert.equal(registry.has('skill-aprobar-measured-decision-check'), true, 'el agente ve su pendiente');

    const afterArming = registrations;
    // Un cambio del almacén sin efecto sobre las pendientes (aquí: la misma lista) no vuelve a registrar.
    signal.notify();
    assert.equal(registrations, afterArming, 'no se re-registra una fila idéntica');
    assert.equal(registry.has('skill-aprobar-measured-decision-check'), true);
    disposeAll();
    assert.equal(registry.size, 0, 'ni al descargar el plugin quedan filas colgando');
  });

  // ── El montaje no puede rendirse en silencio ────────────────────────────────────────────────────
  //
  // El caso real: la sesión era válida, las pendientes estaban en el almacén y `/skill-proposals` las
  // listaba… pero el catálogo de esa sesión no tenía ninguna fila, así que el menú no ofrecía nada y la
  // tarjeta sólo decía «no hay filas que decidir en el catálogo de esta sesión». El montaje se caía sin
  // decirlo y el agente quedaba cacheado, de modo que ningún intento posterior podía arreglarlo.
  /**
   * El comando por su **id interno estable**, no por su nombre: el nombre cambia con el idioma y este fichero
   * fija `DSH_LANG=es`, asi que buscarlo por `skill-proposals` mediria el idioma, no el montaje.
   */
  const porId = (registro, id) => [...registro.map.values()].find((c) => c.definitionId === `skill-compiler.${id}`);

  /** Un registro de comandos en miniatura, con nombres y disposers de verdad. */
  function registroFalso() {
    const map = new Map();
    return {
      map,
      commands: {
        register: (definition) => {
          const dispose = () => map.delete(definition.name);
          map.set(definition.name, definition);
          return dispose;
        },
      },
    };
  }

  it('el comando humano monta las filas que el provider no llegó a montar', async () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    assert.equal(propose(goodInput({ id: 'pendiente-del-comando' }), { root: s.root, curated: s.curated, cwd: CWD }).status, 'proposed');
    const global = registroFalso();
    const deLaSesion = registroFalso();
    const agent = { session: { header: { cwd: CWD } }, ctx: fakeContext({ commands: deLaSesion.commands }).ctx };
    const { ctx, disposeAll } = fakeContext({ commands: global.commands });
    apply(ctx, { root: s.root, catalog: signal });

    const propuestas = porId(global, 'proposals');
    assert.ok(propuestas, 'el comando tiene que estar registrado');
    assert.equal(deLaSesion.map.size, 0, 'nadie ha montado todavía las filas de esta sesión');

    const r = propuestas.handler({ agent, rawInput: '' });
    assert.equal(r.kind, 'success');
    assert.deepEqual([...deLaSesion.map.keys()].filter((n) => n.startsWith('skill-aprobar-')), ['skill-aprobar-pendiente-del-comando']);
    assert.equal(r.text.includes('Aviso: este anfitrion no anuncia filas'), false, 'montadas: no hay nada que avisar');
    disposeAll();
    assert.equal(deLaSesion.map.size, 0, 'al descargar el plugin no quedan filas colgando');
  });

  it('si el montaje no registra nada, el comando lo dice, y un intento posterior puede montarlo', () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    assert.equal(propose(goodInput({ id: 'pendiente-con-montaje-roto' }), { root: s.root, curated: s.curated, cwd: CWD }).status, 'proposed');
    const global = registroFalso();
    const deLaSesion = registroFalso();
    let elInjectFunciona = false;
    // El primer intento: el `inject` del hijo no llama a su callback (el montaje queda a medias).
    const agent = {
      session: { header: { cwd: CWD } },
      ctx: {
        effect: (callback) => callback(),
        inject: (deps, callback) => (elInjectFunciona ? callback({ commands: deLaSesion.commands }) : undefined),
      },
    };
    const { ctx, disposeAll } = fakeContext({ commands: global.commands });
    apply(ctx, { root: s.root, catalog: signal });
    const propuestas = porId(global, 'proposals');

    const roto = propuestas.handler({ agent, rawInput: '' });
    assert.equal(roto.kind, 'success', 'el comando funciona aunque el montaje falle: hay vía manual');
    assert.match(roto.text, /Aviso: este anfitrion no anuncia filas por propuesta/);
    // Y la orden exacta, aunque no haya filas: lo que decide no depende del menú.
    assert.match(roto.text, /Una orden para todas: \/skill-aprobar pendiente-con-montaje-roto --local/);
    assert.equal(deLaSesion.map.size, 0, 'sin inject no hay filas');

    // El inject empieza a funcionar: el siguiente comando vuelve a intentar el montaje y esta vez sí monta.
    elInjectFunciona = true;
    const sano = propuestas.handler({ agent, rawInput: '' });
    assert.equal(sano.kind, 'success');
    assert.equal(sano.text.includes('Aviso: este anfitrion no anuncia filas'), false, 'ya no hay nada que avisar');
    assert.deepEqual([...deLaSesion.map.keys()].filter((n) => n.startsWith('skill-aprobar-')), ['skill-aprobar-pendiente-con-montaje-roto']);

    // Con la lista vacía el aviso sobra: no hay nada que anunciar. Se aparta la pendiente y se vuelve a mirar.
    assert.equal(porId(global, 'reject').handler({ agent, rawInput: 'pendiente-con-montaje-roto' }).kind, 'success');
    const vacia = propuestas.handler({ agent, rawInput: '' });
    assert.equal(vacia.text.includes('Aviso: este anfitrion no anuncia filas'), false, 'sin pendientes no se avisa');
    disposeAll();
  });

  // El caso medido el 19-10: el registro global funcionaba (los comandos humanos contestaban) y el `inject`
  // del agente no llamaba a su callback. El contexto del agente SÍ tenía `commands`: rendirse sin probarlo
  // dejaba al humano sin filas y con un motivo que culpaba al anfitrión sin haberlo mirado.
  it('si `inject` no llama pero el contexto del agente tiene commands, monta por la vía directa', () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    assert.equal(propose(goodInput({ id: 'pendiente-sin-inject' }), { root: s.root, curated: s.curated, cwd: CWD }).status, 'proposed');
    const global = registroFalso();
    const deLaSesion = registroFalso();
    const agent = {
      session: { header: { cwd: CWD } },
      ctx: {
        effect: (callback) => callback(),
        inject: () => undefined,
        commands: deLaSesion.commands,
      },
    };
    const { ctx, disposeAll } = fakeContext({ commands: global.commands });
    apply(ctx, { root: s.root, catalog: signal });

    const r = porId(global, 'proposals').handler({ agent, rawInput: '' });
    assert.equal(r.kind, 'success');
    assert.equal(r.text.includes('Aviso: este anfitrion no anuncia filas'), false, 'montadas por la vía directa: no hay aviso');
    assert.deepEqual([...deLaSesion.map.keys()].filter((n) => n.startsWith('skill-aprobar-')), ['skill-aprobar-pendiente-sin-inject']);
    disposeAll();
    assert.equal(deLaSesion.map.size, 0, 'al descargar el plugin no quedan filas colgando');
  });

  // La forma que documenta `dsh-commands`: el plugin se **monta bajo** `agent.ctx` y declara su propio
  // `inject: ['commands']`. Así el servicio llega al hijo, y el hijo lo ve sin lanzar.
  it('monta las filas con un hijo que declara inject, cuando el contexto del agente ofrece plugin()', () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    assert.equal(propose(goodInput({ id: 'pendiente-del-hijo' }), { root: s.root, curated: s.curated, cwd: CWD }).status, 'proposed');
    const global = registroFalso();
    const deLaSesion = registroFalso();
    let montado = null;
    const agent = {
      session: { header: { cwd: CWD } },
      ctx: {
        effect: (callback) => callback(),
        inject: () => undefined,
        plugin: (hijo) => {
          assert.deepEqual(hijo.inject, ['commands'], 'el hijo declara su dependencia');
          montado = hijo;
          hijo.apply({ commands: deLaSesion.commands });
          return () => { montado = null; };
        },
      },
    };
    const { ctx, disposeAll } = fakeContext({ commands: global.commands });
    apply(ctx, { root: s.root, catalog: signal });

    const r = porId(global, 'proposals').handler({ agent, rawInput: '' });
    assert.equal(r.kind, 'success');
    assert.equal(r.text.includes('Aviso: este anfitrion no anuncia filas'), false, 'montadas por el hijo: no hay aviso');
    assert.deepEqual([...deLaSesion.map.keys()].filter((n) => n.startsWith('skill-aprobar-')), ['skill-aprobar-pendiente-del-hijo']);
    disposeAll();
    assert.equal(deLaSesion.map.size, 0, 'al descargar el plugin no quedan filas colgando');
    assert.equal(montado, null, 'el hijo también se desmonta');
  });
});
