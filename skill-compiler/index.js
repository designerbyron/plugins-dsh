/**
 * skill-compiler — adaptador Cordis del compilador de conocimiento.
 *
 * Este fichero es deliberadamente **fino**, porque es el único que no se puede probar antes de
 * instalar (importa `@deepseek-ai/dsh-tools`, que solo existe dentro del harness). Todo lo que decide
 * algo vive en `lib/`, donde sí hay pruebas. Aquí solo se elige el punto de extensión y se registra.
 *
 * Los cuatro puntos de extensión, y por qué cada uno:
 *   1. `ctx.systemPrompt.section(...)` — el protocolo, ESTÁTICO y ordenado. No se usa
 *      `system-prompt/assemble`: la guía de DSH lo prohíbe expresamente para añadir texto, y una
 *      sección estática es además lo que protege el prompt caching.
 *   2. `ctx.tools.register(...)` — la herramienta con la que el modelo **propone**, y otra de solo
 *      lectura para revisar. Aprobar NO es una herramienta: si lo fuera, el modelo podría
 *      auto-aprobarse y la revisión humana sería decorativa. Aprobar vive en `bin/`.
 *   3. `ctx.skills.registerProvider(...)` — sirve **solo** las skills aprobadas del proyecto actual.
 *   4. `ctx.sessionProjections.register(...)` — el estado que alimenta el feedback visual, plegado de
 *      eventos que YA existen y definido en `lib/projection.mjs`. Es **opcional y a prueba de fallos**:
 *      si el registro de proyecciones o la biblioteca de esquemas no están en este perfil, el plugin
 *      pierde el adorno y conserva el trabajo.
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

import { createCatalogSignal } from './lib/catalog-signal.mjs';
import { skillCommands, targetCommands } from './lib/commands.mjs';
import { curatedLibraryRoot, defaultRoot } from './lib/compiler.mjs';
import { resolveLang } from './lib/i18n/index.mjs';
import { createLanguageCommand, createLanguageState, createLocalizedSet, swapSet } from './lib/localized-commands.mjs';
import { pendingRowsFor, retiredRowsFor } from './lib/pending-rows.mjs';
import { PROTOCOL, scopeOf, skillImprove, skillPropose, skillProvider, skillReview, skillUpstreamCheck, skillVendor } from './lib/definitions.mjs';

/** Identidad del Loader. */
export const name = 'skill-compiler';

/** Servicios necesarios; sin ellos el plugin queda inactivo en lugar de lanzar. */
export const inject = ['tools', 'skills', 'systemPrompt'];

/** Orden de la sección estática: después de la guía del harness y antes del sufijo de personalidad. */
const SECTION_ORDER = 9000;

/**
 * Cuántas veces se intenta montar las filas del menú de una sesión antes de darse por vencido.
 *
 * El montaje puede quedar a medias —el `inject` del hijo de un agente no siempre corre en el momento—, y
 * reintentarlo cuando aún no hay nada registrado es barato: un nombre repetido lo rechaza el registro. Lo que
 * no es barato es rendirse en silencio, así que el último intento deja el motivo por escrito.
 */
const MAX_INTENTOS_DE_MONTAJE = 3;

/** La clave de la proyección vive con la unidad, donde está probada; se re-exporta aquí porque es parte
 *  de la identidad pública del plugin (el cliente la pide con `useProjection('skillCompiler')`). */
export { LEARNING_KEY } from './lib/projection.mjs';

/**
 * La unidad de proyección se carga de forma **tolerante**: si este perfil no resolviera `zod` —la
 * biblioteca de esquemas que exige el contrato del registro—, el plugin pierde el feedback visual y
 * conserva las herramientas.
 *
 * Lo que NO se hace, y es la lección de un incidente real, es registrar una unidad sin comprobar antes
 * que cumple el contrato. El registro de proyecciones **no** valida los esquemas que recibe: acepta
 * cualquier cosa con la forma esperada y la llama `parse` más tarde, al leer sesiones. Una unidad con un
 * esquema que no valida no estropea un adorno: deja el historial de sesiones sin cargar. Por eso aquí
 * hay dos guardas —la carga tolerante y la comprobación del contrato— y no una.
 */
let projection = null;
try {
  projection = await import('./lib/projection.mjs');
} catch {
  projection = null;
}

export function apply(ctx, config = {}) {
  const root = config.root ?? defaultRoot();
  // La señal de catálogo se crea aquí y la comparten las piezas que mutan el almacén (herramientas y
  // comandos) y la que conserva la invalidación del registro. `config.catalog` existe para que las
  // pruebas puedan observar ese contrato sin montar el harness entero.
  // La señal observa las DOS capas que componen el catálogo del agente: nuestro almacén (que se crea si
  // falta) y la biblioteca curada ajena (que sólo se observa si ya existe). Sin la segunda, mover o
  // editar algo en la capa global dejaría a las sesiones abiertas con el catálogo anterior: la misma
  // clase de defecto que ya se cerró para el almacén propio.
  const catalog = config.catalog ?? createCatalogSignal({ root, also: [curatedLibraryRoot()] });

  // ── Las filas de pendientes: una oferta que corresponde a UNA sesión ────────────────────────────
  //
  // El humano vio la lista de pendientes y no encontró cómo elegir una: el compositor no ofrece una
  // lista pulsable para los argumentos de un comando. La superficie de selección del harness es el menú
  // `/`, y desde un plugin se usa así: **una entrada por pendiente, sin argumentos**, porque un comando
  // del host sin argumentos se ejecuta en el acto al elegirlo.
  //
  // Y cada fila es de **un proyecto**. Registrarlas en el global parecía cómodo y era un defecto: el
  // humano abrió una sesión de un proyecto y vio, en el menú, las pendientes de otro —ofrecidas y
  // condenadas a fallar, porque la puerta las rechaza con razón—. Se registran en el ámbito del agente
  // de su sesión, que es lo que el contrato del harness pide para esto: registrar en `agent.ctx`,
  // obtenido en un listener de `agent/created`, y conservar el disposer por agente en un efecto propio.
  /** Lo sustituye el bloque de comandos: sin servicio de comandos no hay filas, y no pasa nada. */
  let mountSession = () => false;
  let refreshPendingRows = () => false;

  ctx.systemPrompt.section({
    name: 'skill-compiler:protocol',
    order: SECTION_ORDER,
    interpolate: false,
    text: PROTOCOL,
  });

  ctx.tools.register(defineTool(skillPropose({ root, catalog })));
  ctx.tools.register(defineTool(skillVendor({ root, catalog })));
  ctx.tools.register(defineTool(skillReview({ root })));
  ctx.tools.register(defineTool(skillUpstreamCheck({ root })));
  // La quinta: mejorar una skill que ya vive, por secciones. Va con las demas y no como comando porque el
  // disparador natural es el modelo (cuando detecta una regla que fallo o un conocimiento nuevo), y porque
  // su resultado es un informe que se lee en el flujo, no una decision que haya que teclear.
  ctx.tools.register(defineTool(skillImprove({ root })));

  // ── El catálogo: servir, y saber cuándo cambió ─────────────────────────────────────────────────
  //
  // El registro de skills CACHEA los catálogos y no tiene TTL: sólo se limpia cuando un provider llama
  // a la invalidación que el propio registro le entrega al registrarse. El plugin no la retenía, así que
  // una skill recién aprobada no llegaba al agente hasta reiniciar el harness — el último paso del flujo,
  // roto. Aquí se conserva esa capacidad (vía la señal) y se avisa desde los dos sitios donde el catálogo
  // puede cambiar: lo que muta este proceso (los comandos) y lo que muta fuera (CLI, página, edición a
  // mano), que la señal vigila. La promesa —«usable sin reiniciar»— depende de esto y sólo de esto.
  ctx.skills.registerProvider((control) => {
    catalog.bind(control?.invalidate);
    // El provider recibe cada sesión que pide su catálogo, con su agente: ahí se montan las filas de ESA
    // sesión. Se mide contra el registro real en `que-recibe-el-provider` y en la prueba de activación.
    return skillProvider({ root, observe: ({ agent }) => mountSession(agent) });
  });
  ctx.effect(() => {
    catalog.start();
    // Cualquier cambio del almacén —incluido el que provoca aprobar desde aquí— recompone las filas:
    // una pendiente aprobada no puede seguir ofreciéndose en el menú.
    const off = catalog.onChange(() => refreshPendingRows());
    return () => {
      off?.();
      catalog.stop();
    };
  });

  // ── La superficie humana: aprobar y rechazar sin salir del harness ──────────────────────────────
  //
  // Opcional a propósito: en un perfil sin comandos (headless, sdk) el servicio no está y el plugin no
  // puede caerse por una superficie. Y el registro se retira con el efecto, para que recargar el plugin
  // no choque con «ese comando ya existe».
  ctx.inject(['commands'], (scoped) => {
    const registry = scoped?.commands ?? ctx.commands;
    if (registry === undefined || typeof registry.register !== 'function') return;
    ctx.effect(() => {
      const base = [];
      /** El conjunto de nombres que sigue al idioma: que esta puesto y con que disposer se retira. */
      const languageState = createLanguageState();
      /** agente → cómo recomponer sus filas, y cómo retirarlas si el plugin se descarga. */
      const perAgent = new Map();
      /**
       * El comando de idioma, cuando se pudo montar. Su baja **vigente** no es el disposer del alta inicial:
       * cambiar de idioma lo retira y lo vuelve a registrar, asi que el de `base` apunta a una definicion que
       * ya no esta.
       */
      let comandoIdioma = null;

      /**
       * El idioma con el que se componen los NOMBRES de fila. Sale del conjunto vivo (que es el que se ve), y
       * si aun no esta puesto, de la resolucion normal del plugin. Una fila es un comando registrado de
       * verdad: en espanol no puede ofrecerse `skill-approve-<id>` si el registro tiene `skill-aprobar`.
       */
      const idiomaDeFilas = () => languageState.lang ?? resolveLang({ root }).lang;

      const composeFor = (cwd) => {
        try {
          // Las dos colecciones con las que se decide en el menú: lo que espera aprobación y lo apagado
          // (que es donde se elige volver a encenderlo o retirarlo del todo). Comparten gramática y camino,
          // y los nombres no pueden chocar entre ellas: la segunda recibe los ya tomados.
          const lang = idiomaDeFilas();
          const pendientes = pendingRowsFor({ root, cwd, lang });
          const apagadas = retiredRowsFor({ root, cwd, taken: new Set(pendientes.map((row) => row.name)), lang });
          return targetCommands({ root, catalog, rows: [...pendientes, ...apagadas] });
        } catch {
          return null; // el almacén ilegible no puede tumbar los comandos que ya están
        }
      };

      /**
       * Monta las filas de un agente y **devuelve el resultado** en vez de callarse.
       *
       * Las filas se montan bajo **su** contexto, que es lo que las hace suyas y sólo suyas: registrarlas en
       * el global las ofrecía a todas las sesiones, y el humano acabó viendo, en el menú de un proyecto, las
       * pendientes de otro. Dentro de un mismo agente el conjunto no se toca si no cambió: re-registrar lo
       * mismo emitiría `commands/change` en vano y haría parpadear el menú.
       *
       * Dos defectos reales lo obligan. El primero: si el `inject` del hijo no llegaba a correr, la sesión
       * quedaba sin filas y nadie lo decía —`/skill-proposals` anunciaba «no hay filas que decidir en el
       * catálogo de esta sesión»—, mientras la documentación prometía que el plugin «lo deja dicho en vez de
       * fingir». El segundo: el agente quedaba cacheado aunque el montaje hubiera quedado a medias, así que
       * ningún intento posterior podía arreglarlo.
       *
       * Ahora se reintenta mientras no haya filas registradas (un nombre repetido se rechaza solo, así que
       * montar de más no estorba), los intentos se acotan, y el motivo viaja a quien pregunte.
       */
      const mountFor = (agent) => {
        if (agent === undefined || agent === null) return { ok: false, motivo: 'la sesión no se anunció con su agente' };
        const cwd = scopeOf({ agent });
        if (typeof cwd !== 'string' || cwd.trim() === '') {
          return { ok: false, motivo: 'la sesión no tiene un directorio de trabajo utilizable' };
        }
        const previo = perAgent.get(agent);
        if (previo !== undefined && typeof previo.refresh === 'function') return { ok: true };
        const entry = previo ?? { applied: '', refresh: null, clear: null, disposers: [], intentos: 0, motivo: null, desmontarHijo: null };
        if (entry.intentos >= MAX_INTENTOS_DE_MONTAJE) {
          return { ok: false, motivo: entry.motivo ?? 'el montaje no llegó a registrar nada en los intentos hechos' };
        }
        entry.intentos += 1;
        const disposer = agent.ctx.effect(() => {
          let inner = null;
          /**
           * Registra las filas en **un** registro concreto y deja `entry.refresh` listo. Devuelve el
           * limpiador, o `null` si ese registro no sirve.
           */
          const montarEn = (rowsRegistry) => {
            if (rowsRegistry === undefined || rowsRegistry === null || typeof rowsRegistry.register !== 'function') return null;
            const rows = [];
            const apply = () => {
              const definitions = composeFor(cwd);
              if (definitions === null) return;
              const signature = definitions.map((definition) => definition.name).join('\n');
              if (signature === entry.applied) return;
              for (const dispose of rows.splice(0)) {
                try {
                  dispose();
                } catch {
                  /* ya retirada */
                }
              }
              for (const definition of definitions) {
                try {
                  rows.push(rowsRegistry.register(definition));
                } catch {
                  /* una fila que no se puede registrar no se lleva las demás */
                }
              }
              entry.applied = signature;
            };
            const clear = () => {
              for (const dispose of rows.splice(0)) {
                try {
                  dispose();
                } catch {
                  /* ya retirada */
                }
              }
              entry.applied = '';
            };
            entry.refresh = apply;
            entry.clear = clear;
            apply();
            return clear;
          };
          try {
            inner = agent.ctx.inject(['commands'], (scopedRows) => montarEn(scopedRows?.commands ?? agent.ctx.commands));
          } catch (error) {
            entry.motivo = `el montaje de las filas lanzó: ${error.message}`;
          }
          // Si `inject` no llegó a llamar —el servicio no está en el ámbito de este contexto—, el contexto
          // puede tenerlo igual: se usa directo antes de declarar que no hay filas. Es el caso medido en la
          // sesión del 19-10: el registro global existía (los comandos humanos funcionaban) y el del agente
          // no se anunciaba. Rendirse ahí dejaba al humano sin filas y con un motivo impreciso.
          // La forma que documenta `dsh-commands` para el ámbito del agente: un plugin **montado bajo**
          // `agent.ctx` que declara su propio `inject: ['commands']`. El `inject` suelto no basta —el
          // servicio no está en el ámbito del contexto tal cual, y leerlo directo lanza «cannot get property
          // commands without inject»—; el hijo montado sí lo recibe, y si aún no está, queda esperándolo.
          if (entry.refresh === null && typeof agent.ctx?.plugin === 'function') {
            try {
              const filas = {
                name: 'skill-compiler-rows',
                inject: ['commands'],
                apply(hijoCtx) {
                  const limpiador = montarEn(hijoCtx.commands);
                  if (limpiador !== null) {
                    entry.motivo = null;
                    entry.hijo = limpiador;
                  }
                },
              };
              const montaje = agent.ctx.plugin(filas);
              entry.desmontarHijo = typeof montaje === 'function' ? montaje : null;
            } catch (error) {
              entry.motivo = `el montaje del hijo de filas lanzó: ${error.message}`;
            }
          }
          if (entry.refresh === null) {
            // Última vía, sólo si el contexto expone el servicio sin lanzar: se prueba sin arriesgar el
            // montaje entero.
            try {
              const limpiador = montarEn(agent.ctx.commands);
              if (limpiador !== null) {
                inner = limpiador;
                entry.motivo = null;
              } else {
                entry.motivo = entry.motivo ?? (agent.ctx.commands === undefined
                  ? 'el contexto del agente no expone «commands» ni por inject, ni montando un hijo, ni directo'
                  : '«commands» del agente existe pero no ofrece register()');
              }
            } catch (error) {
              entry.motivo = entry.motivo ?? `el registro directo de las filas lanzó: ${error.message}`;
            }
          }
          return () => {
            try {
              if (typeof inner === 'function') inner();
            } catch {
              /* ya retirado */
            }
            try {
              if (typeof entry.desmontarHijo === 'function') entry.desmontarHijo();
            } catch {
              /* ya desmontado */
            }
            entry.desmontarHijo = null;
          };
        });
        entry.disposers.push(disposer);
        if (entry.refresh === null) {
          entry.motivo = entry.motivo ?? 'el anfitrión no expone el registro de comandos en el contexto del agente';
          perAgent.set(agent, entry);
          return { ok: false, motivo: entry.motivo };
        }
        perAgent.set(agent, entry);
        return { ok: true };
      };

      refreshPendingRows = () => {
        let touched = false;
        for (const entry of perAgent.values()) {
          if (typeof entry.refresh === 'function') {
            entry.refresh();
            touched = true;
          }
        }
        return touched;
      };

      try {
        // `onMount` entra aquí porque el humano es el otro camino que conoce al agente: si el provider no
        // llegó a montar sus filas, ejecutar `/skill-proposals` las monta antes de listar.
        //
        // El idioma decide QUE nombres se registran, y el conjunto queda intercambiable en vivo: se construye
        // una sola vez (con las dos lenguas dentro y un solo handler por operacion) y se omite del registro
        // base lo que ese conjunto va a poseer. Sin omision, el alta localizada chocaria con la base: los 31
        // nombres (16 en un idioma y 16 en el otro, con `skill-auto` compartido) son todos del conjunto.
        const todas = skillCommands({ root, catalog, onListed: refreshPendingRows, onMount: (agent) => mountSession(agent) });
        let conjunto = null;
        try {
          conjunto = createLocalizedSet({ definitions: todas });
        } catch {
          conjunto = null; // un mapa roto no puede quitar los 16 comandos que ya funcionan
        }
        const omitidos = new Set(conjunto === null ? [] : conjunto.omitNames);
        const tomados = new Set();
        for (const command of todas) {
          if (omitidos.has(command.name)) continue;
          tomados.add(command.name);
          base.push(registry.register(command));
        }
        if (conjunto !== null) {
          const inicial = resolveLang({ root }).lang;
          const puesto = swapSet({ registry, state: languageState, set: conjunto, lang: inicial, taken: tomados });
          if (!puesto.ok) {
            // El conjunto localizado no se pudo poner: los nombres omitidos vuelven al registro, para que el
            // idioma no sea la causa de que desaparezca un comando.
            for (const command of todas) {
              if (omitidos.has(command.name)) base.push(registry.register(command));
            }
            languageState.lang = null;
          }
          // El comando de ajustes NO entra en el conjunto: si estuviera dentro se retiraria justo cuando se
          // usa. Es el unico que tiene que existir siempre, en los dos idiomas, con el mismo nombre.
          //
          // Su descripcion sigue al idioma: el anfitrion no permite actualizar una definicion registrada, asi
          // que se retira y se vuelve a registrar con el MISMO handler y con vuelta atras (`relabel`). Y el
          // cambio de idioma recompone las filas de cada sesion: sus nombres tambien son idioma.
          comandoIdioma = createLanguageCommand({
            registry,
            state: languageState,
            set: conjunto,
            taken: tomados,
            root,
            onChanged: () => {
              refreshPendingRows();
              return null;
            },
          });
          // Lo instala el propio comando: la reescritura de su descripcion necesita SU disposer, y el de un
          // alta hecha desde fuera no lo tiene.
          const instalado = comandoIdioma.install();
          if (!instalado.ok) comandoIdioma = null;
        }
      } catch {
        // Sin comandos no hay atajo humano, pero las herramientas y los skills siguen intactos.
      }

      // El montaje lo dispara el provider, que recibe cada sesión con su agente (vía medida contra el
      // registro real). No se usa un evento del ciclo de vida del agente: su entrega desde el contexto
      // raíz no está garantizada, y una fila que no aparece no se distingue de una que no existe.
      // Y si el provider no llegó a montarlas, el comando humano vuelve a intentarlo.
      mountSession = (agent) => {
        if (agent === undefined || agent === null) return { ok: false, motivo: 'la sesión no se anunció con su agente' };
        return mountFor(agent);
      };

      return () => {
        mountSession = () => ({ ok: false, motivo: 'el plugin se está descargando' });
        refreshPendingRows = () => false;
        for (const entry of perAgent.values()) {
          // Las filas primero, con las retiradas que guarda el propio plugin: el ámbito del agente no se
          // desmonta solo al descargarse el plugin, y una fila viva apunta a una sesión que ya no está.
          try {
            entry.clear?.();
          } catch {
            /* ya retiradas */
          }
          // Todos los efectos del agente, no sólo el primero: un montaje reintentado deja más de uno, y
          // dejar vivos los demás sería dejar filas apuntando a una sesión que ya no está.
          for (const dispose of entry.disposers ?? []) {
            try {
              dispose?.();
            } catch {
              /* ya retirado */
            }
          }
        }
        perAgent.clear();
        // El conjunto localizado se retira por sus propios disposers: no esta en `base` (ese arreglo solo
        // guarda lo que se registra una vez), y dejarlo vivo al descargar el plugin dejaria el nombre de un
        // idioma apuntando a un registro que ya no esta.
        // El comando de idioma se retira con SU disposer vivo: cambiar de idioma lo vuelve a registrar, asi
        // que el disposer del alta inicial ya no apunta a la definicion que esta puesta.
        comandoIdioma?.dispose();
        for (const dispose of languageState.live.values()) {
          try {
            dispose?.();
          } catch {
            /* ya retirado */
          }
        }
        languageState.live.clear();
        languageState.lang = null;
        for (const dispose of base) {
          try {
            if (typeof dispose === 'function') dispose();
          } catch {
            /* ya retirado */
          }
        }
      };
    });
  });

  // Inyección opcional: el callback recibe un contexto hijo con el servicio disponible (firma
  // verificada en el código que se envía); el respaldo por cierre cubre la otra firma posible.
  //
  // Las guardas que siguen no son ceremonia: sin ellas, un perfil donde el servicio no esté disponible
  // —o donde la unidad no cumpla el contrato— llevaba el fallo al camino de LECTURA de sesiones, no
  // solo al arranque. El adorno visual nunca puede costar el trabajo.
  if (projection !== null) {
    ctx.inject(['sessionProjections'], (scoped) => {
      const registry = scoped?.sessionProjections ?? ctx.sessionProjections;
      if (registry === undefined || typeof registry.register !== 'function') return;
      const definition = projection.learningProjection();
      // Si la unidad no cumple el contrato del registro, no se registra: sin adorno, con el historial
      // intacto. Es la comprobación que faltaba cuando se registró una unidad con esquemas que no
      // validaban, y el coste de no tenerla no fue un adorno ausente: fueron sesiones que no abrían.
      if (projection.projectionContractProblems(definition).length > 0) return;
      try {
        registry.register(definition);
      } catch {
        // El registro no aceptó la unidad (versión incompatible, clave ocupada): el feedback visual no
        // estará, las herramientas sí.
      }
    });
  }
}
