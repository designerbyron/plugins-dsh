/**
 * La promoción: aplicar y activar una corrección, con pruebas delante y reversión detrás.
 *
 * ── La regla que gobierna este fichero ──────────────────────────────────────────────────────────
 *
 * **Nada se activa solo por defecto.** `NIVELES_POR_DEFECTO` está vacío: el motor prepara, prueba y espera.
 * Activar exige que el nivel de esa corrección esté en una lista explícita, y esa lista nunca puede incluir
 * el nivel 3 —ahí está la seguridad, los permisos, los secretos, el aislamiento y la facturación—: eso es de
 * una persona, con la propuesta delante.
 *
 * Las cuatro cosas que no se le piden a la confianza del modelo y sí a la medición:
 *
 * 1. **Pruebas de regresión antes de activar**, independientes de quien propuso el parche: la puerta, la
 *    vigencia de la base, el inventario de conocimiento (nada desaparece sin justificarlo), el alcance y el
 *    tamaño del diff, y los ciclos.
 * 2. **Cerrojo por skill**: dos procesos no promocionan el mismo id a la vez, y si el cerrojo está tomado se
 *    dice quién y desde cuándo en vez de esperar en silencio.
 * 3. **Verificación después de escribir**: la versión publicada se relee y se compara por huella con lo que
 *    se propuso. Aprobar no es un `rename` y confiar.
 * 4. **Reversión comprobable**: si esa verificación falla, se deshace el cambio y la versión anterior vuelve
 *    **con su misma huella**; y si la restauración no cuadrara, se dice tal cual en vez de darlo por bueno.
 *
 * El registro de todo esto vive en el diario del proyecto (`journal.jsonl`), que es lo que permite auditar
 * por qué se activó algo, con qué evidencia y qué se probó.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { ejecutarAprobacion } from './approve-tx.mjs';
import { huellaDeContenido } from './security.mjs';
import {
  approve, checkProposal, cuerpoSinTitulo, cuentaDiff, defaultRoot, folderHash, materialPreservado, parseFrontmatter,
  projectKey, treeOf, treeOfConErrores, vigenteDe,
} from './compiler.mjs';
import { inventario, inventarioPerdido, seccionesDe, topeDeMovimiento } from './repair.mjs';
import { textoDeCodigo } from './i18n/index.mjs';

/**
 * Qué niveles se activan solos **si nadie dice otra cosa**. Vacío, y a propósito: la promoción automática es
 * una decisión que se toma por escrito (configuración explícita), no un valor por omisión que nadie revisó.
 */
export const NIVELES_POR_DEFECTO = [];
/** El nivel 3 no se promociona nunca automáticamente, ni aunque alguien lo ponga en la lista. */
export const NIVEL_QUE_EXIGE_HUMANO = 3;

/** El detalle de una prueba, en el idioma de la sesion: su codigo (`detalleCode`) y su texto como reserva. */
export function detalleDePrueba(prueba, opciones = {}) {
  return textoDeCodigo(prueba?.detalleCode, prueba?.detalleParams ?? {}, prueba?.detalle, opciones);
}

/**
 * El motivo de un resultado de promocion, en el idioma de la sesion.
 *
 * El `reason` sigue siendo el DATO -es lo que se anota como `why` en el diario, y lo que afirma una prueba- y
 * `reasonCode` + `reasonParams` es su representacion: se compone al pintar, nunca dentro del motor.
 */
export function motivoDePromocion(resultado, opciones = {}) {
  return textoDeCodigo(resultado?.reasonCode, resultado?.reasonParams ?? {}, resultado?.reason, opciones);
}

/** Dónde vive el diario de un proyecto. */
export function diarioDe(key, { root = defaultRoot() } = {}) {
  return join(root, 'projects', key, 'journal.jsonl');
}

/**
 * Escribe una entrada del diario. Es la parte que hace auditable la decisión: sin esto, «se promocionó» es
 * una afirmación sin respaldo.
 */
export function anotarEnDiario(key, entrada, { root = defaultRoot(), now = new Date().toISOString() } = {}) {
  // Un solo escritor encadenado para los tres caminos que anotan (`lib/security.mjs`): la promoción, la
  // aprobación humana y la automática. Aquí se conserva la API que ya usaba el resto del motor.
  return anotarEntradaEnDiario(diarioDe(key, { root }), entrada, { now });
}

/** Lee el diario entero de un proyecto. */
export function leerDiario(key, { root = defaultRoot() } = {}) {
  const fichero = diarioDe(key, { root });
  if (!existsSync(fichero)) return [];
  return readFileSync(fichero, 'utf8').split('\n').filter(Boolean).map((linea) => {
    try { return JSON.parse(linea); } catch { return { at: null, corrupta: linea.slice(0, 120) }; }
  });
}

// El cerrojo vive en `lib/lock.mjs` porque lo comparten proponer, promocionar y publicar: dos mecanismos
// de exclusión serían dos verdades sobre lo mismo. Se importa y se re-exporta para no cambiar la API.
import { anotarEntradaEnDiario, escanear } from './security.mjs';
import { conCerrojo, rutaDelCerrojo } from './lock.mjs';

export { conCerrojo, rutaDelCerrojo };

/**
 * Las pruebas que tienen que pasar **antes** de activar nada. No las propone el modelo: las ejecuta el mismo
 * sistema que va a activar, y cada una dice qué comprobó y con qué valores.
 *
 * @returns `{ ok, pruebas }` — `pruebas` es `[{ nombre, ok, detalle }]`.
 */
export function pruebasDeRegresion(id, key, meta, { root = defaultRoot(), curated = null, maxLineas = 200, maxFicheros = 5, alcance = null, ciclosMaximos = 3 } = {}) {
  const pruebas = [];
  // Cada prueba lleva su frase (que es lo que se afirma) y, al lado, la **representacion** de esa frase
  // (`detalleCode` + `detalleParams`) para poder decirla en el idioma de quien lee sin tocar el dato. El texto
  // en espanol se conserva tal cual: es lo que afirman las pruebas y lo que viaja al diario.
  const anota = (nombre, ok, detalle, detalleCode = null, detalleParams = null) => pruebas.push({
    nombre, ok, detalle, ...detalleCode === null ? {} : { detalleCode, detalleParams: detalleParams ?? {} },
  });
  const opts = { root, ...(curated ? { curated } : {}) };

  // 1. La puerta: exactamente la misma que decide una aprobación.
  const puerta = checkProposal(id, key, opts);
  anota('puerta', puerta.ok,
    puerta.ok ? 'la propuesta pasa la puerta de calidad' : `no pasa: ${puerta.errors.slice(0, 3).join(' | ')}`,
    puerta.ok ? 'test.puerta.ok' : 'test.puerta.fail',
    puerta.ok ? {} : { errors: puerta.errors.slice(0, 3).join(' | ') });

  // 2. La base: ¿sigue siendo la versión sobre la que se preparó?
  const vigente = vigenteDe(id, key, opts);
  const base = meta?.base ?? null;
  const baseOk = base !== null && vigente !== null && vigente.hash === base.hash;
  anota('base-vigente', baseOk, base === null
    ? 'la propuesta no declara sobre qué versión se preparó'
    : vigente === null
      ? `la versión vigente (${base.state}, ${base.hash.slice(0, 12)}) ya no está`
      : `base ${base.hash.slice(0, 12)} vs vigente ${vigente.hash.slice(0, 12)}`,
  base === null ? 'test.base.none' : vigente === null ? 'test.base.gone' : 'test.base.compare',
  base === null ? {} : vigente === null
    ? { state: base.state, hash: base.hash.slice(0, 12) }
    : { base: base.hash.slice(0, 12), current: vigente.hash.slice(0, 12) });

  // 3. El conocimiento: nada desaparece del inventario sin que se declare.
  let conservacion = { ok: false, detalle: 'no se pudo leer la versión vigente', detalleCode: 'test.conservacion.unreadable', detalleParams: {} };
  let contenidoBase = '';
  if (vigente !== null) {
    const { body } = parseFrontmatter(readFileSync(join(vigente.dir, 'SKILL.md'), 'utf8'));
    contenidoBase = body;
    const { body: cuerpoPropuesto } = parseFrontmatter(readFileSync(puerta.file, 'utf8'));
    const referenciasPropuestas = (puerta.meta?.references ?? []).map((r) => {
      try { return readFileSync(join(dirname(puerta.file), r.path), 'utf8'); } catch { return ''; }
    }).join('\n');
    // Las dos partes se miden **sin el título de nivel 1**: `renderSkill` lo compone de la descripción, así
    // que no es contenido de la skill sino forma. Medirlo aquí lo contaba como conocimiento y hacía
    // impromovible cualquier corrección de una skill cuyo H1 se hubiera editado a mano — «desaparece rutas:
    // Nuxt/Vue» con el material entero en su sitio—. El resto del motor ya mide sin título; esta era la
    // única comparación que medía el documento entero.
    const perdido = inventarioPerdido(
      inventario(cuerpoSinTitulo(contenidoBase)),
      inventario(cuerpoSinTitulo(`${cuerpoPropuesto}\n${referenciasPropuestas}`)),
    );
    const justificado = (puerta.meta?.revision?.removed ?? '').trim();
    const claves = Object.keys(perdido);
    const graves = claves.filter((c) => c !== 'numeros' && c !== 'pasos');
    conservacion = {
      ok: claves.length === 0 || (graves.length === 0 && justificado.length > 0),
      detalle: claves.length === 0
        ? 'el inventario del conocimiento se conserva entero'
        : `desaparece ${claves.map((c) => `${c}: ${perdido[c].slice(0, 3).join(', ')}`).join(' · ')} — justificación: ${justificado ? 'presente' : 'AUSENTE'}`,
      detalleCode: claves.length === 0
        ? 'test.conservacion.ok'
        : justificado.length > 0 ? 'test.conservacion.lost' : 'test.conservacion.lost-absent',
      detalleParams: claves.length === 0
        ? {}
        : { list: claves.map((c) => `${c}: ${perdido[c].slice(0, 3).join(', ')}`).join(' - ') },
      perdido,
    };
  }
  anota('conservacion', conservacion.ok, conservacion.detalle, conservacion.detalleCode, conservacion.detalleParams);

  // 4. El alcance: lo que la propuesta escribe tiene que ser de la skill y nada más. Las rutas se comparan
  //    **relativas a la carpeta de la propuesta**: comparar absolutas contra una lista relativa marcaría
  //    como «fuera de alcance» el propio SKILL.md, y una prueba que siempre falla no prueba nada.
  const raizPropuesta = dirname(puerta.file);
  // Lo permitido no es una lista fija: es **lo que la skill ya tenía**, más `references/`. Una skill
  // vendorizada lleva su `upstream/` y su `provenance.json` dentro, y marcarlos como «fuera de alcance»
  // bloqueaba toda corrección de una vendorizada —que es justo lo que la auditoría reporta.
  const deLaViva = vigente !== null ? treeOfConErrores(vigente.dir).files.map((f) => f.split(sep).join('/')) : [];
  const permitido = alcance ?? [...deLaViva, 'SKILL.md', 'meta.json'];
  // Los ficheros que la propuesta **tiene de verdad**, no los que su meta declara: un fichero colado en la
  // carpeta no aparece en `meta.references`, y mirando sólo el meta se escaparía del control de alcance.
  const escritos = treeOfConErrores(raizPropuesta).files.map((f) => f.split(sep).join('/'));
  const fuera = escritos.filter((r) => !permitido.includes(r) && !r.startsWith('references/'));
  anota('alcance', fuera.length === 0, fuera.length === 0
    ? `todo lo escrito vive en la skill (${escritos.length} fichero(s): ${escritos.slice(0, 4).join(', ')}${escritos.length > 4 ? '…' : ''})`
    : `fuera del alcance autorizado: ${fuera.join(', ')}`,
  fuera.length === 0 ? 'test.alcance.ok' : 'test.alcance.out',
  fuera.length === 0
    ? { n: escritos.length, files: `${escritos.slice(0, 4).join(', ')}${escritos.length > 4 ? '...' : ''}` }
    : { list: fuera.join(', ') });

  // 5. El tamaño del diff: una promoción automática es acotada o no es automática. Se miden dos cosas
  //    distintas, porque no son el mismo riesgo: **sacar** material del propio cuerpo (el conocimiento
  //    cambia de sitio dentro de la skill, con su vínculo) y **añadir** material de fuera (que se acota en
  //    seco: cinco piezas nuevas por corrección). Lo que sale del cuerpo se mide **en bytes** —el trabajo
  //    delegado al automático es el exceso, no su troceado— y con la MISMA función que usó el motor al
  //    prepararlo: con dos varas distintas, el motor preparaba parches que esta puerta rechazaba.
  const lineas = cuentaDiff(meta?.diff?.lineas?.anadidas) + cuentaDiff(meta?.diff?.lineas?.eliminadas);
  const movidas = meta?.repair?.movidas ?? [];
  const bytesAntes = Number(meta?.repair?.bytesAntes ?? Buffer.byteLength(contenidoBase));
  const umbralMov = Number(meta?.repair?.umbral ?? 24000);
  const paso = Number(meta?.repair?.paso ?? Math.max(0, ...seccionesDe(contenidoBase).map((s) => s.bytes)));
  const topeBytes = topeDeMovimiento(bytesAntes, { umbral: umbralMov, paso });
  const bytesMovidos = Number(meta?.repair?.bytesMovidos ?? movidas.reduce((suma, m) => suma + (Number(m?.bytes) || 0), 0));
  const nuevas = Math.max(0, (meta?.diff?.references?.anadidas?.length ?? 0) - movidas.length) + (meta?.diff?.references?.modificadas?.length ?? 0);
  anota('tamano', lineas <= maxLineas && nuevas <= maxFicheros && bytesMovidos <= topeBytes,
    `diff de ${lineas} línea(s) (máximo ${maxLineas}) · ${nuevas} pieza(s) de material nuevo (máximo ${maxFicheros}) · ${bytesMovidos} byte(s) fuera del cuerpo (máximo ${topeBytes})`,
    'test.tamano.summary',
    { lineas, maxLineas, nuevas, maxFicheros, bytes: bytesMovidos, tope: topeBytes });

  // 6. La reversibilidad: la versión anterior tiene que poder volver con su huella.
  const reversibles = vigente !== null ? folderHash(vigente.dir) === vigente.hash : false;
  anota('reversible', reversibles, reversibles
    ? `la versión vigente (${vigente.hash.slice(0, 12)}) está entera y se puede reponer`
    : 'la versión vigente no se puede leer entera: sin ella no hay vuelta atrás',
  reversibles ? 'test.reversible.ok' : 'test.reversible.fail',
  reversibles ? { hash: vigente.hash.slice(0, 12) } : {});

  // 7. Los ciclos: la misma corrección repetida **sin progreso** no se promociona sola otra vez. El progreso
  //    se mide, no se supone: cada ronda del mismo arreglo tiene que partir de un cuerpo estrictamente menor.
  //    Sin esto, una corrección legítima que necesita varias rondas —de 50.000 bytes a 24.000 en pasos
  //    acotados— se confundía con un bucle; y un bucle de verdad, con el cuerpo bajando siempre, no existe.
  const reglas = [...(meta?.repair?.reglas ?? [])].sort().join('+');
  const previas = leerDiario(key, { root })
    .filter((e) => e.id === id && e.decision === 'promovida' && [...(e.reglas ?? [])].sort().join('+') === reglas);
  const ultimas = previas.slice(-ciclosMaximos);
  const cuerpos = [...ultimas.map((e) => (typeof e.cuerpoBytes === 'number' ? e.cuerpoBytes : null)), bytesAntes];
  const progresa = cuerpos.every((b, i) => i === 0 || (b !== null && cuerpos[i - 1] !== null && b < cuerpos[i - 1]));
  const enCiclo = ultimas.length >= ciclosMaximos && !progresa;
  anota('sin-ciclos', !enCiclo, enCiclo
    ? `la misma corrección (${reglas}) se ha promocionado ${ultimas.length} veces seguidas sin que el cuerpo baje: puede ser un ciclo sin progreso, y eso lo mira una persona`
    : `${ultimas.length} promocion(es) previas de ${reglas || '(sin reglas)'}${ultimas.length > 0 && progresa ? ', con el cuerpo bajando en cada ronda' : ''}`,
  enCiclo
    ? 'test.ciclos.cycle'
    : ultimas.length > 0 && progresa
      ? 'test.ciclos.ok-progress'
      : reglas === '' ? 'test.ciclos.ok-none' : 'test.ciclos.ok',
  enCiclo ? { rules: reglas, n: ultimas.length } : { n: ultimas.length, rules: reglas });

  // 8. El material: la propuesta no puede perder ni un fichero de la skill viva. Es la comprobación más
  //    importante de todas, porque una pérdida aquí es conocimiento que se va sin que nadie lo note.
  if (vigente !== null) {
    const deLaViva = treeOfConErrores(vigente.dir).files.filter((f) => f !== 'meta.json');
    const deLaPropuesta = [relative(raizPropuesta, puerta.file).split(sep).join('/'), ...(puerta.meta?.references ?? []).map((r) => String(r.path).split(sep).join('/'))]
      .filter((f) => f !== 'meta.json');
    const perdidos = deLaViva.filter((f) => !deLaPropuesta.includes(f));
    // Un fichero puede desaparecer de `meta.references` y seguir en la carpeta: eso cuenta como conservado.
    const enCarpeta = treeOfConErrores(raizPropuesta).files.filter((f) => f !== 'meta.json');
    const deVerdad = perdidos.filter((f) => !enCarpeta.includes(f));
    anota('sin-perdida-de-ficheros', deVerdad.length === 0, deVerdad.length === 0
      ? `la propuesta conserva los ${deLaViva.length} fichero(s) de la versión viva`
      : `la propuesta NO lleva: ${deVerdad.join(', ')} - una promocion no puede perder material de la skill`,
    deVerdad.length === 0 ? 'test.material.ok' : 'test.material.fail',
    deVerdad.length === 0 ? { n: deLaViva.length } : { list: deVerdad.join(', ') });
  }

  // 9. Material eliminado: si se quita algo, tiene que seguir conservado.
  const eliminadas = (meta?.diff?.references?.eliminadas ?? []).map((r) => (typeof r === 'string' ? r : r.path));
  if (eliminadas.length > 0 && vigente !== null) {
    const preservado = materialPreservado(vigente.dir, eliminadas, {
      body: parseFrontmatter(readFileSync(puerta.file, 'utf8')).body,
      references: (puerta.meta?.references ?? []).map((r) => r.path),
    });
    anota('material-preservado', preservado.ok, preservado.ok
      ? `el material retirado (${eliminadas.join(', ')}) sigue en la skill`
      : `se retira ${eliminadas.join(', ')} y no aparece en ninguna parte: eso pierde conocimiento`,
    preservado.ok ? 'test.preservado.ok' : 'test.preservado.fail',
    { list: eliminadas.join(', ') });
  }

  return { ok: pruebas.every((p) => p.ok), pruebas };
}

/**
 * Promociona una propuesta: la activa si su nivel está autorizado y todo pasa; si no, la deja esperando.
 *
 * @param niveles - qué niveles pueden activarse solos. Por defecto **ninguno**.
 * @returns `{ status, nivel, regresion, ... }` con `status` en `promoted` · `pending` · `regression` ·
 *   `missing` · `no-propuesta` · `reverted` · `critical` · `locked`.
 */
export function promover(id, key, {
  root = defaultRoot(), curated = null, cwd = null, niveles = NIVELES_POR_DEFECTO,
  maxLineas = 200, maxFicheros = 5, alcance = null, por = 'motor', now = new Date().toISOString(),
  verificador = null, veredicto = null, hooks = null,
} = {}) {
  const opts = { root, ...(curated ? { curated } : {}) };
  const dirPropuesta = join(root, 'projects', key, 'proposed', id);
  const fichero = join(dirPropuesta, 'SKILL.md');
  if (!existsSync(fichero)) {
    return {
      status: 'no-propuesta',
      id,
      reason: `no hay ninguna propuesta ${id} en ${key}: la promoción activa lo que ya está propuesto`,
      reasonCode: 'promote.reason.no-proposal',
      reasonParams: { id, key },
    };
  }
  let meta = null;
  try { meta = JSON.parse(readFileSync(join(dirPropuesta, 'meta.json'), 'utf8')); } catch { meta = null; }
  // Sin `repair` declarado no hay nivel: se trata como lo más delicado. Un parche sin nivel no puede colarse
  // por la puerta de atrás de la automatización.
  const nivelDeclarado = typeof meta?.repair?.nivel === 'number' ? meta.repair.nivel : NIVEL_QUE_EXIGE_HUMANO;
  // La capa de seguridad manda por encima del nivel declarado: si el contenido levanta un aviso de seguridad
  // —credencial, orden al agente, operación destructiva, ruta sensible— no lo activa una máquina. El nivel 3
  // exige humano, y aquí eso se cumple sin depender de que quien declaró el nivel se acordara de subirlo.
  const seguridadDeLaPropuesta = escanear({ id, body: readFileSync(fichero, 'utf8') });
  const avisosDeSeguridad = seguridadDeLaPropuesta.bloqueos.length + seguridadDeLaPropuesta.avisos.length;
  // El medidor (`lib/auto-update.mjs`) manda sobre el nivel declarado: si ya midió las dieciséis condiciones y
  // alguna falla, la propuesta espera —y el motivo es lo que midió—; si pasa, el nivel efectivo es el suyo,
  // nunca por encima de 2. Sin veredicto, se comporta como siempre.
  const nivelMedido = veredicto !== null && veredicto?.apto === true ? Math.min(nivelDeclarado, 2) : nivelDeclarado;
  const nivel = avisosDeSeguridad > 0 ? NIVEL_QUE_EXIGE_HUMANO : nivelMedido;
  if (veredicto !== null && veredicto?.apto !== true) {
    anotarEnDiario(key, { id, key, group: meta?.group?.id ?? null, nivel, reglas: meta?.repair?.reglas ?? [], base: meta?.base ?? null, diff: meta?.diff ?? null, pruebas: veredicto?.medidas ?? [], decision: 'espera-medidor', por, hashResultante: null, hashAnterior: null, why: String(veredicto?.resumen ?? 'el medidor no dio veredicto') }, { root, now });
    const resumenMedido = typeof veredicto?.resumen === 'string' ? veredicto.resumen : '';
    return {
      status: 'pending',
      id,
      nivel,
      regresion: { ok: false, pruebas: veredicto?.medidas ?? [] },
      razonMedida: veredicto?.resumen ?? '',
      // El resumen del medidor ya viene compuesto en el idioma de la sesion (`lib/auto-update.mjs`): se conserva
      // tal cual, y solo el caso sin veredicto tiene codigo propio.
      reason: String(resumenMedido || 'el medidor no dio veredicto: la propuesta espera'),
      ...(resumenMedido === '' ? { reasonCode: 'promote.reason.meter', reasonParams: {} } : {}),
    };
  }
  const reglas = meta?.repair?.reglas ?? [];

  const cerrado = conCerrojo(root, key, id, () => {
    // Las pruebas se corren SIEMPRE, aunque no se autorice: son la información de la decisión, y el humano
    // que apruebe a mano merece verlas igual.
    const regresion = pruebasDeRegresion(id, key, meta, { root, curated, maxLineas, maxFicheros, alcance });
    const autorizado = nivel <= 2 && niveles.includes(nivel);

    // ── El lote: la vía automática no activa una parte de un cambio que toca varias skills ─────────
    // La vía humana (promoción no autorizada) NO pasa por aquí: aprobar dos de tres es una decisión, no un
    // accidente. Lo que no puede pasar es que la automatización deje la biblioteca contando dos historias.
    const grupo = meta?.group ?? null;
    if (autorizado && grupo) {
      const bloqueoLote = comprobarLote(grupo, propuestasDelLote(grupo.id, key, { root }), { key, root, curated, maxLineas, maxFicheros, alcance });
      if (bloqueoLote) {
        // El texto del bloqueo es lo que se anota (`why`); su codigo es lo que la CLI compone.
        anotarEnDiario(key, { id, key, group: grupo.id, nivel, reglas, base: meta?.base ?? null, diff: meta?.diff ?? null, pruebas: regresion.pruebas, decision: 'espera-lote', por, hashResultante: null, hashAnterior: null, why: bloqueoLote.text }, { root, now });
        return {
          status: 'pending',
          id,
          nivel,
          grupo: grupo.id,
          regresion,
          reason: bloqueoLote.text,
          reasonCode: bloqueoLote.code,
          reasonParams: bloqueoLote.params,
        };
      }
    }

    if (!autorizado) {
      const decision = nivel > 2 ? 'espera-humano' : 'promocion-desactivada';
      const reason = nivel > 2
        ? `el nivel ${nivel} de esta corrección exige aprobación humana: la propuesta queda pendiente y con sus pruebas hechas`
        : `el nivel ${nivel} no está en la lista de niveles autorizados (${niveles.length ? niveles.join(', ') : 'ninguno'}): la promoción automática está apagada`;
      anotarEnDiario(key, { id, key, group: grupo?.id ?? null, nivel, reglas, base: meta?.base ?? null, diff: meta?.diff ?? null, pruebas: regresion.pruebas, decision, por, hashResultante: null, hashAnterior: null, why: reason }, { root, now });
      return nivel > 2
        ? { status: 'pending', id, nivel, regresion, reason, reasonCode: 'promote.reason.needs-human', reasonParams: { nivel } }
        : {
          status: 'pending', id, nivel, regresion, reason,
          reasonCode: niveles.length ? 'promote.reason.off' : 'promote.reason.off-none',
          reasonParams: niveles.length ? { nivel, niveles: niveles.join(', ') } : { nivel },
        };
    }
    if (!regresion.ok) {
      const fallan = regresion.pruebas.filter((p) => !p.ok).map((p) => p.nombre).join(', ');
      const reason = `no se activa: ${fallan}`;
      anotarEnDiario(key, { id, key, group: grupo?.id ?? null, nivel, reglas, base: meta?.base ?? null, diff: meta?.diff ?? null, pruebas: regresion.pruebas, decision: 'rechazada-por-regresion', por, hashResultante: null, hashAnterior: null, why: reason }, { root, now });
      return { status: 'regression', id, nivel, regresion, reason, reasonCode: 'promote.reason.regression', reasonParams: { fails: fallan } };
    }

    // ── A partir de aquí se escribe. Todo lo que siga está dentro de esta guarda. ──────────────────
    const vigente = vigenteDe(id, key, opts);
    const hashAnterior = vigente?.hash ?? null;
    const huellaPropuesta = folderHash(dirPropuesta);
    // `folderHash` (16 caracteres, la que usa promover en su contrato) y `huellaDeContenido` (64, la del
    // motor transaccional) no son la misma funcion: la transaccion compara con la suya, asi que se calcula
    // aparte para no rechazar todas las promociones por "el contenido cambio".
    const huellaEsperada = huellaDeContenido(dirPropuesta);
    // Se rellena dentro de `verificar` (que corre antes del asiento) con la huella de 16 de promover, para
    // que el diario conserve el mismo contrato de siempre sin dejar de tener la del motor al lado.
    let huellaPublicada = null;

    // La sustitución la hace la transacción central —la misma que usan aprobar, el panel y el modo
    // automático—: aparta la versión viva con su manifiesto, instala, verifica contra lo validado, escribe
    // el asiento y confirma; si algo no cuadra, revierte ella. Lo que es propio de promover (meta, base y el
    // verificador del integrador) se comprueba DENTRO, antes de confirmar: así hay una sola reversión y no
    // dos mecanismos que puedan contradecirse.
    const resultado = ejecutarAprobacion({
      root, key, id,
      esperada: huellaEsperada,
      scope: 'project',
      por, canal: 'promocion', now,
      nota: `promocion de ${id}`,
      decision: 'promovida',
      cerrojo: false, // `promover` ya corre dentro de `conCerrojo`
      // Solo para pruebas: puntos de fallo/interrupcion del motor transaccional.
      hooks,
      camposDelAsiento: {
        group: grupo?.id ?? null, nivel, reglas,
        hashAnterior,
        get hashResultante() { return huellaPublicada; },
        // `hashAnterior`/`hashResultante` siguen en la huella de 16 de promover (su contrato). El getter se
        // evalua al escribir el asiento, ya con `verificar` hecho.
        base: meta?.base ?? null, diff: meta?.diff ?? null,
        pruebas: regresion.pruebas, cuerpoBytes: meta?.repair?.bytesAntes ?? null,
      },
      verificar: ({ destino, huellaActivada: _instalada, meta: metaActivada }) => {
        const problemas = [];
        const publicado = folderHash(destino);
        huellaPublicada = publicado;
        if (publicado !== huellaPropuesta) problemas.push(`lo publicado (${publicado.slice(0, 12)}) no coincide con lo propuesto (${huellaPropuesta.slice(0, 12)})`);
        if (metaActivada !== null && metaActivada.state !== 'approved') problemas.push(`el meta dice «${metaActivada.state}» en vez de approved`);
        if (!existsSync(join(destino, 'SKILL.md'))) problemas.push('no hay SKILL.md en la versión activada');
        if (metaActivada?.base?.hash && metaActivada.base.hash !== meta?.base?.hash) problemas.push('la versión publicada dice haberse construido sobre otra base');
        // Un integrador puede añadir sus propias comprobaciones (las de su proyecto, por ejemplo). Y sólo
        // pueden **añadir** problemas: ninguna comprobación externa puede autorizar lo que el motor no autorizó.
        if (typeof verificador === 'function') {
          try {
            for (const problema of verificador({ root, key, id, dir: destino, huellaActivada: publicado, huellaPropuesta, meta: metaActivada }) ?? []) problemas.push(String(problema));
          } catch (error) {
            problemas.push(`la comprobación externa lanzó: ${error.message}`);
          }
        }
        return problemas;
      },
    });

    if (resultado.ok) {
      return {
        status: 'promoted', id, nivel, regresion,
        hashAnterior, hashResultante: folderHash(join(root, 'projects', key, 'approved', id)),
        hashContenido: resultado.nuevo,
        superseded: resultado.superseded ?? null, manifiesto: resultado.manifiesto ?? null,
      };
    }

    // No llegó a sustituirse (o la transacción ya devolvió todo a su sitio): se declara el motivo real.
    if (!resultado.verificacion) {
      return {
        status: 'critical', id, nivel, regresion,
        reason: `no se pudo activar: ${resultado.error}`,
        reasonCode: 'promote.reason.activation-failed',
        reasonParams: { reason: resultado.error },
        hashAnterior,
      };
    }

    // Se activó y no cuadró: la transacción revirtió. Se comprueba que la versión anterior está de vuelta y
    // con su huella; si no lo está, no se dice «deshecho» — se dice lo que pasa.
    const problemas = resultado.verificacion;
    const repuesta = vigenteDe(id, key, opts);
    const reversoOk = resultado.problemas.length === 0 && repuesta?.hash === hashAnterior;
    const reverso = { ok: reversoOk, hash: repuesta?.hash ?? null, apartada: resultado.superseded ?? null, problemas: resultado.problemas };
    anotarEnDiario(key, {
      id, key, group: grupo?.id ?? null, nivel, reglas, base: meta?.base ?? null, diff: meta?.diff ?? null,
      pruebas: regresion.pruebas,
      decision: reversoOk ? 'revertida' : 'reversion-fallida', por, hashResultante: reverso.hash, hashAnterior,
      why: problemas.join(' | '), reverso,
    }, { root, now });
    return reversoOk
      ? {
        status: 'reverted', id, nivel, regresion, problems: problemas,
        hashAnterior, hashRestaurado: reverso.hash, apartada: resultado.superseded ?? null,
        reason: `se activó y no cuadró (${problemas.join(' | ')}): se ha deshecho y la versión anterior está de vuelta, con su huella`,
        reasonCode: 'promote.reason.reverted',
        reasonParams: { problems: problemas.join(' | ') },
      }
      : {
        status: 'critical', id, nivel, regresion, problems: problemas, reverso, hashAnterior,
        reason: 'no se pudo publicar bien NI deshacer: hace falta una persona. Nada más se ha tocado',
        reasonCode: 'promote.reason.irreversible',
        reasonParams: {},
      };
  });

  if (cerrado?.ok === false && cerrado.reason?.startsWith('ya hay una operación')) return { status: 'locked', id, ...cerrado };
  return cerrado;
}

/**
 * Las propuestas que forman un lote en un proyecto, leídas de su `meta.json` (que es el estado que el motor
 * consume). Se ordenan por id para que el resultado no dependa del orden del sistema de ficheros.
 */
export function propuestasDelLote(groupId, key, { root = defaultRoot() } = {}) {
  const dir = join(root, 'projects', key, 'proposed');
  let entradas = [];
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    // Sólo «no existe la carpeta» significa «no hay propuestas». Cualquier otro error se **propaga**: un
    // fallo de programación no puede disfrazarse de lote vacío y dejar que la promoción siga adelante
    // creyendo que el lote está completo. Es la misma lección que `treeOf` → `treeOfConErrores`.
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const out = [];
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) continue;
    try {
      const meta = JSON.parse(readFileSync(join(dir, entrada.name, 'meta.json'), 'utf8'));
      if (meta?.group?.id === groupId) out.push({ id: entrada.name, meta });
    } catch { /* una propuesta ilegible no entra en el lote: su problema saldrá por su propia puerta */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * ¿Está el lote entero, y entero **verificable**, como para activar una de sus partes sola?
 *
 * Un cambio que toca varias skills y se activa a medias deja la biblioteca contando dos historias distintas
 * - y es justo lo que el lote existe para evitar. Devuelve el motivo del bloqueo -`{ code, params, text }`-, o
 * `null` si el lote está completo y cada una de sus propuestas pasa su propia regresión. El `text` es el dato que
 * se anota en el diario; el `code` es lo que permite decirlo en el idioma de la sesión al pintarlo.
 */
export function comprobarLote(grupo, propuestas, { key = null, root = defaultRoot(), curated = null, maxLineas = 200, maxFicheros = 5, alcance = null } = {}) {
  if (!grupo) return null;
  if (typeof grupo.esperadas !== 'number') {
    return {
      code: 'promote.reason.batch-no-count',
      params: { group: grupo.id },
      text: `el lote «${grupo.id}» no declara cuántas propuestas lo forman («esperadas»): sin eso no se puede saber si falta alguna, y un lote no se activa a medias`,
    };
  }
  if (propuestas.length !== grupo.esperadas) {
    return {
      code: 'promote.reason.batch-incomplete',
      params: { group: grupo.id, expected: grupo.esperadas, n: propuestas.length },
      text: `el lote «${grupo.id}» declara ${grupo.esperadas} propuestas y solo hay ${propuestas.length} propuesta(s): un lote no se activa a medias (la vía humana puede activar lo que quiera, esta no)`,
    };
  }
  for (const hermana of propuestas) {
    const regresion = pruebasDeRegresion(hermana.id, key ?? hermana.meta?.projectKey ?? null, hermana.meta, { root, curated, maxLineas, maxFicheros, alcance });
    if (!regresion.ok) {
      const fallan = regresion.pruebas.filter((p) => !p.ok).map((p) => p.nombre).join(', ');
      return {
        code: 'promote.reason.batch-sister',
        params: { sister: hermana.id, group: grupo.id, fails: fallan },
        text: `la hermana «${hermana.id}» del lote «${grupo.id}» no pasa su regresión (${fallan}): se arregla eso antes de activar ninguna`,
      };
    }
  }
  return null;
}

/** El estado de las correcciones de un proyecto, tal y como quedó en el diario. */
export function historial(key, { root = defaultRoot(), id = null, grupo = null } = {}) {
  return leerDiario(key, { root })
    .filter((e) => (id === null ? true : e.id === id))
    .filter((e) => (grupo === null ? true : e.group === grupo))
    .map((e) => ({
      at: e.at, id: e.id, group: e.group ?? null, nivel: e.nivel, reglas: e.reglas ?? [], decision: e.decision,
      pruebas: (e.pruebas ?? []).map((p) => `${p.nombre}:${p.ok ? 'ok' : 'FALLA'}`),
      base: e.base?.hash ?? null, resultado: e.hashResultante ?? null, anterior: e.hashAnterior ?? null, why: e.why ?? null,
    }));
}

/** ¿Hay un ciclo? La misma corrección promocionada una y otra vez sin que el hallazgo se vaya. */
export function ciclos({ key, root = defaultRoot(), id = null, veces = 3 } = {}) {
  const promociones = leerDiario(key, { root }).filter((e) => e.decision === 'promovida' && (id === null || e.id === id));
  const porId = new Map();
  for (const e of promociones) {
    const clave = `${e.id}|${[...(e.reglas ?? [])].sort().join('+')}`;
    porId.set(clave, [...(porId.get(clave) ?? []), e.at]);
  }
  return [...porId.entries()]
    .filter(([, fechas]) => fechas.length >= veces)
    .map(([clave, fechas]) => ({ id: clave.split('|')[0], reglas: clave.split('|')[1], promociones: fechas.length, ultima: fechas.at(-1) }));
}

export { projectKey, treeOf };
