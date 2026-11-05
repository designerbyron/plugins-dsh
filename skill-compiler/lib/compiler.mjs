/**
 * skill-compiler — lógica pura del compilador de conocimiento.
 *
 * Sin dependencias y sin DSH: aquí vive todo lo que se puede probar con `node --test`. El adaptador
 * Cordis (`index.js`) solo traduce entre estas funciones y los servicios del harness, de modo que el
 * riesgo de romper todas las sesiones del perfil se concentra en ~80 líneas revisables.
 *
 * Objetivo del que sale el diseño: al cerrar una tarea compleja, el conocimiento reutilizable se
 * convierte en una skill **propuesta**, ligada al proyecto donde se aprendió, guardada fuera de todo
 * repositorio y sin solaparse con lo que ya existe.
 *
 * Tres decisiones que gobiernan el código:
 *   1. **El proyecto lo calcula el plugin, no el modelo.** Sale del cwd de la sesión. Si el modelo
 *      pudiera declararlo, una skill podría aterrizar en el ámbito equivocado y cargarse en el lugar
 *      equivocado — justo lo que hay que impedir.
 *   2. **Una propuesta no es una skill.** Se escribe en `proposed/` y nunca se sirve al modelo. Solo
 *      `approved/` se sirve, y aprobar es un acto humano por CLI, no una herramienta del modelo.
 *   3. **La idempotencia es del fichero, no de la memoria.** Reproponer el mismo id reescribe su
 *      carpeta de forma atómica; no hay índice paralelo que pueda desincronizarse.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { conCerrojo } from './lock.mjs';
import { t } from './i18n/index.mjs';
import { anotarEntradaEnDiario, esIdSeguro, ficherosQueDifieren, huellaDeArbol, huellaDeContenido, motivoDeIdInseguro, escanear, revisarArbol } from './security.mjs';
import {
  MAQUINA, SOLO_DSH, dondeMasViveEseId, leerPropiedad, politicaAplicable, proyectosConocidos, propiedadSinCambios,
} from './scope.mjs';

/** Raíz de datos por defecto: hermana de `skills/`, para no mezclarse con la biblioteca curada. */
export function defaultRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'skill-compiler');
}

/**
 * La **biblioteca de usuario**: la cuarta raíz que el harness resuelve para skills, con rango 400. Es la
 * capa que ve **todo** proyecto de esta máquina.
 *
 * Se **lee** siempre —compone lo que el agente ve y con lo que se compara una propuesta— y se **escribe**
 * sólo por una aprobación humana con ámbito global. Una **propuesta** sigue sin escribir aquí jamás: lo que
 * escribe es una decisión, y pasa por `publishToLibrary` con su puerta.
 *
 * Aviso que el código asume: la carpeta es **compartida** con otras herramientas (hoy tiene skills que
 * escribe Hermes), así que nada que no sea nuestro se pisa.
 */
export function curatedLibraryRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'skills');
}

/** El mismo directorio, con el nombre del papel que juega al aprobar: destino de publicación. */
export function libraryRoot(opts = {}) {
  return opts.library ?? curatedLibraryRoot();
}

export const SCOPES = Object.freeze(['project', 'global']);

/** El ámbito pedido. Sin decir nada, el gesto conservador: el proyecto. */
export function scopeOf(opts = {}) {
  return opts.scope === 'global' ? 'global' : 'project';
}

/**
 * ¿Esta carpeta de la biblioteca la escribió este plugin? La marca va en el frontmatter
 * (`metadata.dsh.origin`), así que se lee del fichero y no de un registro aparte que podría mentir.
 */
export function isOurs(dir) {
  const loaded = readSkill(join(dir, 'SKILL.md'));
  return loaded !== null && loaded.metadata?.dsh?.origin === 'skill-compiler';
}

const no = (now) => (now instanceof Date ? now.toISOString() : String(now));
const stamp = (now) => no(now).replace(/[:.]/g, '-');
/** El mismo sello, para el respaldo, que usa el formato de carpeta por día del repositorio. */
const dia = (now) => no(now).slice(0, 10);

// ── identidad de proyecto ────────────────────────────────────────────────────────────────────────

/**
 * Clave de proyecto a partir del cwd de la sesión. Es la regla que evita que una skill se cargue en
 * el lugar equivocado: la misma función decide dónde se guarda y qué se sirve.
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return null;
  const normalized = resolve(cwd).replace(/[\\/]+$/, '');
  const slug = normalized.replace(/[:\\/]+/g, '-').replace(/^-+|-+$/g, '').replace(/[^A-Za-z0-9._-]/g, '-');
  if (slug.length === 0) return null;
  // Legible y estable: el último tramo del path primero, y un hash corto del path completo detrás para
  // que dos proyectos con el mismo nombre en sitios distintos no colisionen.
  const tail = normalized.split(/[\\/]/).filter(Boolean).pop() ?? 'root';
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `${tail.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40)}-${digest}`;
}

// ── validación de la entrada ─────────────────────────────────────────────────────────────────────
//
// Tres familias de reglas, y conviene no mezclarlas porque se arreglan de distinta manera:
//   · **Formato**: lo que hace que el fichero sea válido para el harness (id, una línea, longitudes).
//     Un fallo aquí es un error de forma y se corrige reescribiendo el campo.
//   · **Calidad**: lo que hace que la skill sirva para lo que se paga por ella (estructura, vínculo de
//     sus referencias). Un fallo aquí significa que la skill no se podrá usar, o que promete material
//     que no está.
//   · **Tamaño**: lo que cuesta. El cuerpo se carga entero cada vez que se invoca, así que tiene
//     presupuesto: aviso al pasar de 8.000 caracteres y error al pasar de 24.000, con la vía dicha
//     (lo pesado va a `references/`, y la Fase 0 del 2026-10-15 demostró que el modelo las alcanza).

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** El cuerpo se carga entero: por debajo de esto no hay nada que avisar. */
const BODY_BUDGET = 8_000;
/** Y por encima de esto no es un procedimiento, es un libro: el exceso va a `references/`. */
const BODY_MAX = 24_000;
/** Un cuerpo pequeño puede ser una lista sin secciones; uno grande tiene que estar estructurado. */
const SMALL_BODY = 1_500;
const MIN_DESCRIPTION = 60;
const MAX_DESCRIPTION = 300;
const MIN_WHEN_TO_USE = 20;
const MIN_BODY = 200;
/** La carpeta canónica del material pesado de una skill: lo que el modelo resuelve contra la base. */
const REFERENCE_DIR = 'references/';

/** Formas de credencial y de ruta de usuario que una skill NUNCA debe llevar consigo. */
/** Rutas personales de la máquina del autor: acoplan la skill a un puesto, no a un proyecto. */
const PERSONAL_PATH_SHAPES = [
  // [forma, etiqueta, codigo]: la etiqueta es el DATO que viaja en el hallazgo (`observed`/`etiqueta`) y el
  // codigo es su representacion en el catalogo (`shape.*`), compartido con `lib/vendor.mjs`.
  [/[A-Za-z]:\\Users\\[^\\\s"']+/i, 'ruta de perfil de Windows', 'windows-profile'],
  [/\/(?:home|Users)\/[^/\s"']+\//, 'ruta de perfil POSIX', 'posix-profile'],
];
/** Rutas absolutas en general: se avisa, no se veta (documentar una herramienta del puesto es legítimo). */
/**
 * Dónde aparece una ruta absoluta, y en qué contexto.
 *
 * La regla medía `description + whenToUse + body` con un patrón de «letra, dos puntos, barra invertida», y
 * el único aviso del almacén real (medido el 2026-10-16) resultó ser un **falso positivo**: el literal de
 * una expresión regular escrito dentro de código en línea, donde la barra va escapada. Casa con aquel
 * patrón porque dos barras invertidas seguidas de una barra parecen una ruta, y no lo son. Lo que se mide
 * ahora:
 *
 *   · una ruta de unidad —la letra, los dos puntos y **un** separador, y después el camino—: tras los dos
 *     puntos hace falta un carácter que no sea otro separador, así que una barra escapada no casa;
 *   · una ruta POSIX de sistema (`/usr`, `/opt`, `/etc`, `/var`, `/srv`, `/mnt`) al principio de palabra;
 *   · una ruta con la barra invertida duplicada tras los dos puntos —que es como aparece una ruta dentro de
 *     un JSON o de una cadena—: es **ambigua** (puede ser una ruta real escrita para un fichero) y se
 *     avisa como tal, en vez de callarse.
 *
 * Y se distingue el contexto, que es lo que separa un aviso accionable de uno que se ignora: en **prosa**
 * (donde la ruta se usa) avisa; dentro de un bloque de código es un **ejemplo**; dentro de código en línea
 * es una **cita**. Ejemplo y cita quedan como `info` en el informe: se ven al auditar, no engordan la lista
 * de avisos que piden algo.
 *
 * @returns `[{ clase: 'prosa'|'ejemplo'|'cita'|'ambigua', muestra, linea }]`
 */
export function rutasAbsolutasEn(texto) {
  const hallazgos = [];
  const lineas = String(texto ?? '').split('\n');
  let dentroDeCerca = false;
  for (const [indice, linea] of lineas.entries()) {
    if (/^\s*(?:```|~~~)/.test(linea)) {
      dentroDeCerca = !dentroDeCerca;
      continue; // la línea de la cerca no es contenido
    }
    const patrones = [
      { re: /[A-Za-z]:[\\/](?![\\/])[^\s"'`]*/g, clase: 'ruta' },
      { re: /[A-Za-z]:\\\\[^\s"'`]*/g, clase: 'ambigua' },
      { re: /(?<![\w./-])\/(?:usr|opt|etc|var|srv|mnt)\/[^\s"')`]*/g, clase: 'ruta' },
    ];
    for (const { re, clase } of patrones) {
      for (const match of linea.matchAll(re)) {
        if (match[0].replace(/[A-Za-z]:[\\/]+/, '').length === 0) continue; // la letra y los dos puntos, sin camino, no dicen nada
        const antes = linea.slice(0, match.index);
        const enLinea = (antes.match(/`/g) ?? []).length % 2 === 1;
        hallazgos.push({
          clase: clase === 'ambigua' ? 'ambigua' : (dentroDeCerca ? 'ejemplo' : (enLinea ? 'cita' : 'prosa')),
          muestra: match[0].length > 60 ? `${match[0].slice(0, 57)}…` : match[0],
          linea: indice + 1,
        });
      }
    }
  }
  return hallazgos;
}

/**
 * Una ruta de referencia dentro de un texto: `references/algo`, sin espacios. El lookbehind impide que
 * `upstream/references/x` cuente como vínculo nuestro (ese espacio es del origen y lo reescribe el
 * adaptador del vendorizado).
 */
const REFERENCE_INLINE_RE = /(?<![\w./\\-])references[\\/][^\s)\]"'`,;:]*[^\s)\]"'`,;:.]/g;

/** Una ruta relativa, siempre con `/`, sin `./` inicial y sin barras dobles. */
export function normalizeRel(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

/**
 * Las rutas bajo `references/` que el **cuerpo** declara, sin duplicados y en el orden en que aparecen.
 *
 * Un vínculo con **espacios** en el nombre se declara entre backticks —es la forma de escribir una ruta
 * en markdown—, y así se captura entera: sin esa convención no habría manera de saber dónde acaba la
 * ruta y una referencia con espacios no se podría verificar, que es justo lo que hay que impedir.
 * Las que van desnudas se cortan en el primer espacio, y ese es su límite.
 */
export function declaredReferences(body) {
  const texto = String(body ?? '');
  const encontradas = [];
  // Primero las que van entre backticks (pueden llevar espacios); su hueco se tacha para que la
  // segunda pasada no las vuelva a encontrar a medias.
  const resto = texto.replace(/`([^`\n]*)`/g, (entero, dentro) => {
    const candidata = normalizeRel(dentro.trim());
    if (candidata.startsWith(REFERENCE_DIR) && candidata.length > REFERENCE_DIR.length) encontradas.push(candidata);
    return ' '.repeat(entero.length);
  });
  for (const m of resto.match(REFERENCE_INLINE_RE) ?? []) encontradas.push(m);
  return [...new Set(encontradas.map(normalizeRel))];
}

/**
 * El vínculo de las referencias de una skill: cada ruta que el cuerpo declara tiene que resolverse
 * **dentro** de la carpeta de la skill, sobre un fichero regular, y estar presente (aportada en esta
 * propuesta o ya en la carpeta). Y ninguna ruta —declarada o aportada— puede salir de la carpeta.
 *
 * Una sola regla para las dos puertas: `propose` la aplica con lo que va a escribir, y `checkProposal`
 * con lo que hay en el disco, así que aprobar también caza una referencia rota metida a mano.
 *
 * @param body - cuerpo de la skill.
 * @param proposed - `[{ path, content }]` que se van a escribir junto al `SKILL.md`.
 * @param present - rutas relativas de ficheros que ya viven en la carpeta de la skill.
 * @param dirs - rutas relativas que en la carpeta son directorios (no valen como referencia).
 * @returns `{ errors, warnings, findings, links, files }` — `links` es lo que el cuerpo declara, `files` lo aportado.
 */

/**
 * Acumula los hallazgos de una validación.
 *
 * El **mensaje** es la cara visible (lo que ya leen el modelo, la CLI y la interfaz, palabra por palabra),
 * y el **objeto** es lo que se puede auditar: qué regla, qué se observó, contra qué umbral, con qué
 * severidad y por dónde se arregla. Los dos salen de aquí, así que no hay dos versiones de la misma regla:
 * la prosa se compone del hallazgo, nunca al revés.
 */
function acumulador() {
  const errors = [];
  const warnings = [];
  const findings = [];
  const add = (severity, hallazgo) => {
    findings.push({ severity, observed: null, threshold: null, fix: '', ...hallazgo });
    // `info` sólo vive en el informe: un aviso que no pide nada no debe engordar la lista de avisos.
    if (severity === 'error') errors.push(hallazgo.message);
    else if (severity === 'warn') warnings.push(hallazgo.message);
  };
  return { errors, warnings, findings, add };
}

export function checkReferences({ body = '', proposed = [], present = [], dirs = [], noComprobables = [] } = {}) {
  const { errors, warnings, findings, add } = acumulador();
  const files = [];
  const vistos = new Set();

  for (const item of proposed) {
    const ruta = normalizeRel(item?.path);
    const contenido = typeof item?.content === 'string' ? item.content : '';
    if (!ruta.startsWith(REFERENCE_DIR) || ruta.length <= REFERENCE_DIR.length) {
      add('error', {
        rule: 'reference-path',
        observed: ruta,
        threshold: REFERENCE_DIR,
        message: `references: «${item?.path ?? ''}» tiene que ser una ruta relativa que empiece por «${REFERENCE_DIR}» (por ejemplo «${REFERENCE_DIR}contratos.md»)`,
        messageParams: { valor: item?.path ?? '', dir: REFERENCE_DIR, ejemplo: `${REFERENCE_DIR}contratos.md` },
        fix: `Mueve el material a «${REFERENCE_DIR}…» (una ruta relativa dentro de la carpeta de la skill)`,
        fixCode: 'finding.reference-path.fix',
        fixParams: { dir: REFERENCE_DIR },
      });
      continue;
    }
    if (ruta.split('/').includes('..')) {
      add('error', {
        rule: 'reference-escape',
        observed: ruta,
        message: `references: «${ruta}» sale de la carpeta de la skill («..»): una referencia sólo puede vivir dentro`,
        messageParams: { ruta },
        fix: 'Quita el «..»: una referencia no puede apuntar fuera de la carpeta de la skill',
      });
      continue;
    }
    if (ruta.endsWith('/')) {
      add('error', {
        rule: 'reference-not-a-file',
        observed: ruta,
        message: `references: «${ruta}» es una carpeta, no un fichero: aporta el fichero concreto`,
        messageParams: { ruta },
        fix: 'Aporta el fichero con su nombre completo, no la carpeta',
      });
      continue;
    }
    if (vistos.has(ruta)) {
      add('error', {
        rule: 'reference-duplicate',
        observed: ruta,
        message: `references: «${ruta}» está repetida: dos contenidos distintos en la misma ruta`,
        messageParams: { ruta },
        fix: 'Deja una sola entrada por ruta, con el contenido que deba quedarse',
      });
      continue;
    }
    if (contenido.trim().length === 0) {
      add('error', {
        rule: 'reference-empty',
        observed: ruta,
        threshold: 1,
        message: `references: «${ruta}» va vacía: una referencia sin contenido no conserva nada, quita el vínculo del cuerpo o aporta el material`,
        messageParams: { ruta },
        fix: 'Aporta el contenido del material, o quita del cuerpo el enlace a esa ruta',
      });
      continue;
    }
    vistos.add(ruta);
    files.push({ path: ruta, content: contenido, bytes: Buffer.byteLength(contenido), sha256: createHash('sha256').update(contenido).digest('hex').slice(0, 16) });
  }

  const presentes = new Set([...present.map(normalizeRel), ...files.map((f) => f.path)]);
  const directorios = new Set(dirs.map((d) => normalizeRel(d).replace(/\/+$/, '')));
  // Carpetas que la auditoría no pudo leer: un vínculo que caiga dentro no se puede juzgar, y decir que
  // «falta» sería afirmar algo que no se ha medido.
  const ciegas = noComprobables.map((d) => normalizeRel(d).replace(/\/+$/, '')).filter((d) => d.length > 0);
  const links = declaredReferences(body);
  for (const ruta of links) {
    if (!ruta.startsWith(REFERENCE_DIR)) continue; // el vínculo es de `references/`, no de todo el árbol
    if (ruta.split('/').includes('..')) {
      add('error', {
        rule: 'link-escape',
        observed: ruta,
        message: `el cuerpo declara «${ruta}», que sale de la carpeta de la skill: corrige la ruta`,
        messageParams: { ruta },
        fix: 'Corrige la ruta del cuerpo para que apunte dentro de la carpeta de la skill',
      });
      continue;
    }
    if (directorios.has(ruta.replace(/\/+$/, ''))) {
      add('error', {
        rule: 'link-is-directory',
        observed: ruta,
        message: `el cuerpo declara «${ruta}», que es un directorio y no un fichero: enlaza el fichero concreto`,
        messageParams: { ruta },
        fix: 'Enlaza el fichero concreto dentro de esa carpeta',
      });
      continue;
    }
    if (!presentes.has(ruta)) {
      const ciega = ciegas.find((d) => ruta === d || ruta.startsWith(`${d}/`));
      if (ciega) {
        add('info', {
          rule: 'link-unverifiable',
          observed: ruta,
          message: `no se pudo comprobar el vínculo «${ruta}»: la carpeta «${ciega}» no se pudo leer`,
          messageParams: { ruta, carpeta: ciega },
          fix: 'Revisa los permisos de esa carpeta y vuelve a auditar',
        });
        continue;
      }
      add('error', {
        rule: 'link-missing',
        observed: ruta,
        threshold: 'fichero existente',
        message: `el cuerpo declara «${ruta}» y ese fichero no está: aporta su contenido en «references» o corrige la ruta (un vínculo roto es conocimiento que se pierde)`,
        messageParams: { ruta },
        fix: `Aporta «${ruta}» con su contenido, o corrige la ruta del cuerpo`,
        fixCode: 'finding.link-missing.fix',
        fixParams: { ruta },
      });
    }
  }

  if (links.length > 0 && files.length > 0) {
    add('warn', {
      rule: 'reference-budget',
      observed: files.length,
      threshold: links.length,
      message: `la skill lleva ${files.length} referencia(s) de ${links.length} declarada(s): el cuerpo corto se paga entero, el material pesado sólo cuando se necesita`,
      messageParams: { ficheros: files.length, enlaces: links.length },
      fix: 'Nada: es informativo',
    });
  }
  return { errors, warnings, findings, links, files };
}

/**
 * Validate a proposal before it touches disk.
 * @returns `{ ok, errors, warnings, findings, references, links }` — errors reject, warnings travel with
 *   the proposal, y `findings` es lo mismo con la forma que necesita una auditoría.
 */
export function validateInput(input, { references = [], cwd = null, present = [], dirs = [], noComprobables = [] } = {}) {
  const { errors, warnings, findings, add } = acumulador();
  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const whenToUse = typeof input?.whenToUse === 'string' ? input.whenToUse.trim() : '';
  const body = typeof input?.body === 'string' ? input.body.trim() : '';

  if (!ID_RE.test(id)) add('error', { rule: 'id-format', observed: id, message: 'id debe ser kebab-case y empezar por letra: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$', messageParams: {}, fix: 'Renombra la skill a kebab-case, por ejemplo «medir-antes-de-decidir»' });
  if (id.length > 64) add('error', { rule: 'id-max', observed: id.length, threshold: 64, message: 'id demasiado largo (máximo 64)', messageParams: { maximo: 64 }, fix: 'Acorta el id a 64 caracteres o menos', fixCode: 'finding.id-max.fix', fixParams: { maximo: 64 } });
  if (description.length < MIN_DESCRIPTION) add('error', { rule: 'description-min', observed: description.length, threshold: MIN_DESCRIPTION, message: `description demasiado corta (mínimo ${MIN_DESCRIPTION} caracteres): es lo que el modelo lee para elegir, y por debajo de eso no distingue nada`, messageParams: { minimo: MIN_DESCRIPTION }, fix: `Reescribe la descripción con al menos ${MIN_DESCRIPTION} caracteres: qué automatiza y cuándo se usa`, fixCode: 'finding.description-min.fix', fixParams: { minimo: MIN_DESCRIPTION } });
  if (description.length > MAX_DESCRIPTION) add('error', { rule: 'description-max', observed: description.length, threshold: MAX_DESCRIPTION, message: `description demasiado larga (máximo ${MAX_DESCRIPTION}): es lo que el modelo lee al elegir`, messageParams: { maximo: MAX_DESCRIPTION }, fix: `Recorta la descripción a ${MAX_DESCRIPTION} caracteres o menos`, fixCode: 'finding.description-max.fix', fixParams: { maximo: MAX_DESCRIPTION } });
  if (/[\r\n]/.test(description)) add('error', { rule: 'description-multiline', observed: 'salto de línea', message: 'description debe ser una sola línea', messageParams: {}, fix: 'Quita el salto de línea de la descripción' });
  if (whenToUse.length < MIN_WHEN_TO_USE) add('error', { rule: 'whenToUse-min', observed: whenToUse.length, threshold: MIN_WHEN_TO_USE, message: `whenToUse es obligatorio (mínimo ${MIN_WHEN_TO_USE} caracteres): es el campo con el que el harness decide cuándo aparece esta skill`, messageParams: { minimo: MIN_WHEN_TO_USE }, fix: `Escribe el disparador de la skill (mínimo ${MIN_WHEN_TO_USE} caracteres)`, fixCode: 'finding.whenToUse-min.fix', fixParams: { minimo: MIN_WHEN_TO_USE } });
  if (/[\r\n]/.test(whenToUse)) add('error', { rule: 'whenToUse-multiline', observed: 'salto de línea', message: 'whenToUse debe ser una sola línea', messageParams: {}, fix: 'Quita el salto de línea de whenToUse' });
  if (body.length < MIN_BODY) add('error', { rule: 'body-min', observed: body.length, threshold: MIN_BODY, message: `body demasiado corto (mínimo ${MIN_BODY} caracteres): una skill es un procedimiento, no un titular`, messageParams: { minimo: MIN_BODY }, fix: 'Escribe el procedimiento completo: pasos, contratos y trampas' });
  if (body.length > BODY_MAX) add('error', { rule: 'body-max', observed: body.length, threshold: BODY_MAX, message: `body demasiado largo (${body.length} > ${BODY_MAX} caracteres): lo pesado va a «${REFERENCE_DIR}» y el cuerpo lo enlaza — así el detalle se conserva y no se paga en cada carga`, messageParams: { n: body.length, maximo: BODY_MAX, dir: REFERENCE_DIR }, fix: `Mueve el material de consulta a «${REFERENCE_DIR}…» y enlázalo desde el cuerpo`, fixCode: 'finding.body-max.fix', fixParams: { dir: REFERENCE_DIR } });
  else if (body.length > BODY_BUDGET) add('warn', { rule: 'body-budget', observed: body.length, threshold: BODY_BUDGET, message: `body de ${body.length} caracteres: se carga entero cada vez que la skill se invoca; lo que sea material de consulta gana en «${REFERENCE_DIR}»`, messageParams: { n: body.length, dir: REFERENCE_DIR }, fix: `Lo que sea de consulta, a «${REFERENCE_DIR}…»`, fixCode: 'finding.body-budget.fix', fixParams: { dir: REFERENCE_DIR } });

  const encabezados = (body.match(/^##[^#\n]/gm) ?? []).length;
  if (encabezados === 0) add('error', { rule: 'body-no-sections', observed: 0, threshold: 1, message: 'el body no tiene ninguna sección («## …»): un procedimiento se lee por partes, y sin secciones no hay dónde buscar el detalle', messageParams: {}, fix: 'Añade secciones «## …» al cuerpo' });
  else if (encabezados < 2 && body.length > SMALL_BODY) add('error', { rule: 'body-sections-min', observed: encabezados, threshold: 2, message: `el body tiene ${encabezados} sección(es) y ${body.length} caracteres: a partir de ${SMALL_BODY} hacen falta al menos 2 («## …»), para que el detalle sea localizable`, messageParams: { n: encabezados, caracteres: body.length, pequeno: SMALL_BODY }, fix: 'Divide el cuerpo en al menos dos secciones «## …»' });
  else if (encabezados < 2) add('warn', { rule: 'body-sections-soft', observed: encabezados, threshold: 2, message: `body corto (${body.length} caracteres) con una sola sección: se admite, pero una segunda sección lo hace localizable cuando crezca`, messageParams: { caracteres: body.length }, fix: 'Opcional: una segunda sección' });

  const haystack = `${description}\n${whenToUse}\n${body}`;
  // Las etiquetas de tema son **identificadores**, no prosa: van en kebab-case ASCII, sin acentos, como el
  // resto del ecosistema (que es inglés). Se tolera una etiqueta con acento —se normaliza y coincide— pero se
  // **avisa**, porque corregirlo en silencio enseña a escribir mal y la forma canónica es la que se busca.
  for (const etiqueta of Array.isArray(input?.tags) ? input.tags : []) {
    const canonica = normalizarEtiqueta(etiqueta);
    if (String(etiqueta) !== canonica) {
      add('warn', {
        rule: 'tag-no-canónico',
        observed: String(etiqueta),
        threshold: canonica,
        message: `la etiqueta «${etiqueta}» no está en su forma canónica: los identificadores van en kebab-case ASCII, sin acentos ni mayúsculas`,
        messageCode: 'finding.tag-no-canonico.message',
        messageParams: { etiqueta: String(etiqueta), canonica },
        fix: `Escríbela como «${canonica}»`,
        fixCode: 'finding.tag-no-canonico.fix',
        fixParams: { canonica },
      });
    }
  }
  // ── La capa de seguridad ────────────────────────────────────────────────────────────────────────
  //
  // Aquí, y no en cada comando: la propuesta, la puerta de aprobación y la auditoría leen el MISMO juicio
  // (una regla, una implementación). Un bloqueo no se escribe ni se aprueba con --force; un aviso lo decide
  // un humano y la aprobación automática no lo toca. El material pesado entra al escaneo con el resto: una
  // credencial en `references/` viaja igual de lejos que una en el cuerpo.
  const seguridad = escanear({
    id: String(input?.id ?? ''),
    description: String(input?.description ?? ''),
    whenToUse: String(input?.whenToUse ?? ''),
    tags: Array.isArray(input?.tags) ? input.tags : [],
    body: String(input?.body ?? ''),
    ficheros: Object.fromEntries((Array.isArray(references) ? references : []).map((r) => [String(r?.path ?? ''), String(r?.content ?? '')])),
  });
  // La prosa de la capa de seguridad viaja con su codigo: aqui solo se reetiqueta la severidad, no se reescribe
  // la frase (si se perdiera el codigo, `audit`/`check` volverian a pintar el espanol del motor).
  for (const h of seguridad.bloqueos) add('error', { rule: h.rule, observed: h.observed, threshold: null, message: h.message, messageCode: h.messageCode, messageParams: h.messageParams, fix: h.fix, fixCode: h.fixCode, fixParams: h.fixParams });
  for (const h of seguridad.avisos) add('warn', { rule: h.rule, observed: h.observed, threshold: null, message: h.message, messageCode: h.messageCode, messageParams: h.messageParams, fix: h.fix, fixCode: h.fixCode, fixParams: h.fixParams });
  for (const [re, label, labelCode] of PERSONAL_PATH_SHAPES) if (re.test(haystack)) add('error', { rule: 'personal-path', observed: label, message: `contiene una ruta personal de la máquina (${label}): usa $DSH_HOME o una ruta relativa`, messageParams: { etiqueta: label, etiquetaCode: labelCode }, fix: 'Sustituye la ruta personal por $DSH_HOME o una ruta relativa' });
  // Las rutas absolutas, por **contexto**: una ruta que se usa (prosa) avisa; un ejemplo o una cita se
  // ven en el informe como `info` sin pedir nada. Así el aviso sigue significando algo —y una ruta
  // escapada ( «letra:» + separador + camino`, típica de un JSON) se declara ambigua en vez de callarse—.
  let rutaAvisada = false;
  for (const hallazgo of rutasAbsolutasEn(haystack)) {
    if (hallazgo.clase === 'prosa' && !rutaAvisada) {
      rutaAvisada = true;
      add('warn', { rule: 'absolute-path', observed: hallazgo.muestra, message: `contiene una ruta absoluta en la línea ${hallazgo.linea} («${hallazgo.muestra}»): si la skill debe viajar, parametrízala`, messageParams: { linea: hallazgo.linea, muestra: hallazgo.muestra }, fix: 'Parametriza la ruta absoluta o documéntala como del puesto' });
      continue;
    }
    if (hallazgo.clase === 'ambigua' && !rutaAvisada) {
      rutaAvisada = true;
      add('warn', { rule: 'absolute-path-ambigua', observed: hallazgo.muestra, message: `«${hallazgo.muestra}» (línea ${hallazgo.linea}) parece una ruta absoluta con la barra escapada: si es una ruta real, parametrízala; si es un ejemplo dentro de una cadena, ignóralo`, messageParams: { muestra: hallazgo.muestra, linea: hallazgo.linea }, fix: 'Parametriza la ruta real, o escribe el ejemplo de forma que se lea como tal' });
      continue;
    }
    add('info', {
      rule: hallazgo.clase === 'ejemplo' ? 'absolute-path-ejemplo' : 'absolute-path-cita',
      observed: hallazgo.muestra,
      message: hallazgo.clase === 'ejemplo'
        ? `ruta absoluta dentro de un bloque de código (línea ${hallazgo.linea}): es un ejemplo, no un destino — no pide nada`
        : `ruta absoluta dentro de código en línea (línea ${hallazgo.linea}): es una cita, no un destino — no pide nada`,
      messageParams: { linea: hallazgo.linea },
      fix: 'Nada: si algún día se usa como destino, la regla volverá a avisar',
    });
  }

  // Las referencias: forma de las que se aportan, y que el vínculo del cuerpo se resuelva de verdad.
  // `present` y `dirs` llegan cuando la puerta mira el disco (`checkProposal`), no cuando se propone.
  const refs = checkReferences({ body, proposed: references, present, dirs, noComprobables });
  errors.push(...refs.errors);
  warnings.push(...refs.warnings);
  findings.push(...refs.findings);

  // La evidencia es lo que hace auditable el conocimiento. Sin evidencia **no** se avisa: un aviso que
  // sale siempre deja de significar algo, y esa es la regla de la casa. Lo que sí se dice es una
  // evidencia declarada que no está donde dice, porque eso es una promesa que no se puede comprobar.
  const evidence = Array.isArray(input?.evidence) ? input.evidence.filter((e) => typeof e === 'string' && e.trim().length > 0) : [];
  if (evidence.length > 0 && typeof cwd === 'string' && cwd.trim().length > 0) {
    const perdidas = evidence.filter((e) => !existsSync(resolve(cwd, e)));
    if (perdidas.length > 0) add('warn', {
      rule: 'evidence-missing',
      observed: perdidas.join(', '),
      message: `la evidencia no está en el proyecto: ${perdidas.join(', ')} — se conserva igual, pero una ruta que no existe no prueba nada`,
      messageParams: { rutas: perdidas.join(', ') },
      fix: 'Aporta la evidencia declarada o corrige su ruta',
    });
  }

  // No se exige encabezado de nivel 1 en el body: `renderSkill` compone el título a partir de la
  // descripción, así que el documento final siempre lo lleva.
  return { ok: errors.length === 0, errors, warnings, findings, references: refs.files, links: refs.links };
}

// ── anti-solapamiento ────────────────────────────────────────────────────────────────────────────

/** Palabras que no distinguen un tema de otro. Mismas constantes que el guardián de la biblioteca. */
const STOPWORDS = new Set([
  'use', 'when', 'the', 'and', 'for', 'with', 'its', 'own', 'that', 'this', 'from', 'into', 'over',
  'not', 'are', 'you', 'your', 'must', 'can', 'all', 'any', 'new', 'one', 'two', 'per', 'via', 'out',
  'get', 'set', 'run', 'how', 'why', 'what', 'who', 'been', 'were', 'was', 'has', 'have', 'had',
  'skill', 'skills', 'dsh', 'hermes', 'exact', 'exactly', 'only', 'also', 'then', 'than', 'them',
  'they', 'there', 'here', 'each', 'other', 'same', 'such', 'does', 'doing', 'done', 'before', 'after',
  // Las palabras funcionales del español: **medido**, la lista era inglesa y en español «los», «las»,
  // «del», «con», «para» o «que» contaban como si fueran tema, y bastaban para que dos asuntos sin nada
  // en común (respaldar / correos de aviso) superaran el umbral del veto.
  'los', 'las', 'del', 'con', 'para', 'por', 'que', 'una', 'uno', 'sus', 'sin', 'mas', 'pero', 'como',
  'este', 'esta', 'esto', 'estos', 'estas', 'esos', 'esas', 'todo', 'toda', 'todos', 'todas', 'cada',
  'donde', 'cuando', 'quien', 'cual', 'cuales', 'sea', 'ser', 'son', 'era', 'han', 'hay', 'muy',
  'entre', 'sobre', 'hacia', 'desde', 'hasta', 'segun', 'ante', 'tras', 'otro', 'otra', 'otros', 'otras',
  'the', 'its', 'own', 'under', 'about', 'while', 'never', 'always', 'still', 'just', 'more', 'most', 'some',
]);
/** Tokens que solo dicen «soy de la familia»: no distinguen por sí solos. */
const FAMILY_TOKENS = new Set(['hash', 'hashed', 'authorized', 'authorised', 'sha', 'sha256', 'signed']);
/**
 * El umbral del veto, **calibrado con pares etiquetados** y con el corpus neutral (ocho temas de fondo que
 * no son ninguno de los pares juzgados): los temas distintos puntúan 0,000 y el mismo tema 0,500–1,000, así
 * que la banda que separa limpio es 0,25–0,45 y se elige el centro bajo: 0,40. Con la huella anterior
 * (uniforme, umbral 0,50) los temas distintos puntuaban 0,70–0,74 y **se vetaban**.
 */
const THRESHOLD = 0.4;
/**
 * Los dos números del peso por frecuencia documental.
 *
 * Un token que aparece en **casi todas** las skills de la biblioteca no distingue un tema de otro: es
 * **estilo** (las muletillas con las que escribe el mismo autor). Se le da peso cero cuando hay biblioteca
 * suficiente para que esa frecuencia signifique algo. Medido: con ocho skills del mismo autor, cuatro
 * muletillas aparecían en 8/8 y dos temas **distintos** puntuaban 0,955 — el veto rechazaba aprender dos
 * cosas en la misma sesión.
 */
const MIN_GROUP_WHY = 20;
const ESTILO_DESDE = 0.8;
const ESTILO_MINIMO = 6;

const singular = (w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s) => (s || '').toLowerCase().split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 3 && !STOPWORDS.has(w)).map(singular);

/** Fingerprint de tema: tallos fuertes del nombre + bolsa amplia (nombre, etiquetas, descripción). */
export function fingerprint({ id, description = '', whenToUse = '', tags = [] }) {
  const nameTokens = words((id || '').replace(/[-_]/g, ' '));
  return {
    stems: new Set(nameTokens.filter((t) => !FAMILY_TOKENS.has(t))),
    wide: new Set([...nameTokens, ...tags.flatMap((t) => words(t)), ...words(description), ...words(whenToUse)]),
  };
}

/**
 * Los pesos de un corpus: cuántas skills contienen cada token.
 *
 * Es lo que convierte «se parecen» en «se parecen **en el tema**». La frecuencia la aporta la biblioteca del
 * proyecto, que es real: no hay ninguna lista de palabras prohibidas escrita a mano que envejezca mal.
 */
/**
 * Una etiqueta de tema, normalizada: `Respaldos de Producción` y `respaldos-de-produccion` son la misma.
 *
 * El acento se **quita** (NFD + marcas combinantes), no se sustituye: sin esto, «Producción» normalizaba a
 * `producci-n` y no coincidía con «produccion» — dos formas de escribir el mismo tema que no se reconocían.
 * En español eso es la mitad de las etiquetas.
 */
export const normalizarEtiqueta = (etiqueta) => singular(String(etiqueta ?? '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));

/** Las etiquetas de tema de una skill, normalizadas y sin repetir. */
export const etiquetasDe = ({ tags = [] } = {}) => new Set(
  (Array.isArray(tags) ? tags : []).map(normalizarEtiqueta).filter((t) => t.length >= 3),
);

export function pesosDeTema(corpus = []) {
  const df = new Map();
  for (const entrada of corpus) {
    for (const token of fingerprint(entrada).wide) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return { df, n: corpus.length };
}

/** El peso de un token: 0 si es estilo de la casa, y si no, tanto más alto cuanto menos común sea. */
const pesoDe = (token, pesos) => {
  if (!pesos || pesos.n === 0) return 1;
  const df = pesos.df.get(token) ?? 0;
  if (pesos.n >= ESTILO_MINIMO && df / pesos.n >= ESTILO_DESDE) return 0;
  return Math.log(1 + pesos.n / (1 + df));
};

function jaccardPonderado(a, b, pesos) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  let union = 0;
  for (const token of new Set([...a, ...b])) {
    const peso = pesoDe(token, pesos);
    if (a.has(token) && b.has(token)) inter += peso;
    union += peso;
  }
  return union === 0 ? 0 : inter / union;
}

/**
 * 0..1: cuánto se parece un candidato a otro **en el tema**. Mira tallos y bolsa amplia, y se queda con el
 * mayor.
 *
 * @param contexto - `{ corpus }` (calcula los pesos de ese corpus) o `{ pesos }` (ya calculados). Sin
 *   contexto los pesos son uniformes, que es el comportamiento de siempre: quien llame con dos argumentos no
 *   ve un cambio inesperado.
 */
export function similarity(a, b, contexto = null) {
  const pesos = contexto?.pesos ?? (contexto?.corpus ? pesosDeTema(contexto.corpus) : null);
  const fa = fingerprint(a);
  const fb = fingerprint(b);
  return Math.max(jaccardPonderado(fa.stems, fb.stems, pesos), jaccardPonderado(fa.wide, fb.wide, pesos));
}

/**
 * Veto de solapamiento, con **semántica por ámbito**: se veta donde de verdad colisionaría (la
 * biblioteca curada y el mismo proyecto) y solo se informa cuando el mismo tema vive en otro proyecto
 * — porque ahí es legítimo que exista, y saberlo es útil, pero no es motivo para impedir la propuesta.
 *
 * Reproponer el propio id no es una colisión con uno mismo: es actualizar la propuesta.
 *
 * Los pesos salen de la biblioteca (`corpus`, por defecto las propias skills existentes), así que el veto
 * mide **tema** y no estilo de redacción.
 */
export function checkOverlap(candidate, existing, { threshold = THRESHOLD, scope = null, corpus = null, group = null } = {}) {
  const pesos = pesosDeTema(corpus ?? existing);
  const conflicts = [];
  const relatedElsewhere = [];
  const siblings = [];
  for (const other of existing) {
    const sameScope = other.where === 'biblioteca-curada' || (scope !== null && typeof other.where === 'string' && other.where.endsWith(`:${scope}`));
    if (!sameScope) {
      const score = similarity(candidate, other, { pesos });
      if (score >= threshold) relatedElsewhere.push({ id: other.id, score: Number(score.toFixed(3)), where: other.where });
      continue;
    }
    // Hermanas de un lote: el autor ya declaró que van juntas y por qué, así que el parecido se **avisa**,
    // no veta. Va antes que la etiqueta porque dos hermanas comparten tema por definición — si no, la
    // regla de la etiqueta las vetaría justo por ser lo que el lote declara.
    if (group && other.group && other.group.id === group.id) {
      siblings.push({ id: other.id, score: Number(similarity(candidate, other, { pesos }).toFixed(3)), where: other.where });
      continue;
    }
    // La etiqueta de tema es la vía que **no** depende del vocabulario: dos skills que declaran el mismo
    // tema chocan aunque una diga «respaldar» y la otra «hacer copia de seguridad». Un jaccard de palabras
    // no ve sinónimos, y fingir que los ve sería mentir; declararlo, sí lo ve.
    const compartidas = [...etiquetasDe(candidate)].filter((etiqueta) => etiquetasDe(other).has(etiqueta));
    if (compartidas.length > 0) {
      conflicts.push({ id: other.id, score: 1, where: other.where, reason: 'mismo-tag', tags: compartidas });
      continue;
    }
    if (other.id === candidate.id) {
      // Lo que decide no es DÓNDE está la otra, sino DE QUIÉN ES. Una skill ajena de la biblioteca no se
      // suplanta nunca en silencio: eso es un conflicto y se dice. Y lo que sí es nuestro —la propuesta,
      // la aprobada, la aprobada del mismo proyecto y **lo que este plugin publicó en la biblioteca**— es
      // una ACTUALIZACIÓN del mismo id, y no se veta: se informa con `updatesProposal`/`updatesApproved`.
      // Sin esta distinción, una skill global quedaba congelada: publicada una vez, el modelo ya no podía
      // mejorarla en ningún proyecto.
      if (other.where === 'biblioteca-curada' && other.ours !== true) {
        conflicts.push({ id: other.id, score: 1, where: other.where, reason: 'id-ocupado', ours: false });
      }
      continue;
    }
    const score = similarity(candidate, other, { pesos });
    if (score >= threshold) conflicts.push({ id: other.id, score: Number(score.toFixed(3)), where: other.where, reason: 'mismo-tema' });
  }
  return {
    ok: conflicts.length === 0,
    conflicts: conflicts.sort((x, y) => y.score - x.score),
    siblings: siblings.sort((x, y) => y.score - x.score),
    relatedElsewhere: relatedElsewhere.sort((x, y) => y.score - x.score),
  };
}

// ── actualizar con evidencia: la revisión, el diff y la versión base ─────────────────────────────
//
// Un parche de algo **vivo** no es una propuesta nueva: cambia una herramienta que alguien ya usa. Por eso
// la puerta le exige tres cosas que a una propuesta nueva no se le piden:
//   1. **Evidencia**: qué afirmaba la versión anterior, qué la contradice, con qué se midió y qué cambia.
//      Un texto largo no es una medición: la medición tiene un número o un comando.
//   2. **Base identificada**: contra qué versión exacta se preparó, para no aplicarla encima de otra cosa.
//   3. **Diff**: qué se añade, qué se modifica y qué se elimina — y una eliminación tiene que estar
//      justificada y no puede evaporar material sin dejar rastro.

/** Mínimos de la revisión. Cortos a propósito: la forma se exige por campos, no por longitud. */
const MIN_REVISION_FIELD = 20;
/** Una medición se reconoce por un número o por un comando entre backticks. Sin eso, es una opinión. */
const MEASUREMENT_RE = /\d|`[^`]+`/;

/**
 * Diff de líneas por conjuntos: qué líneas aparecen y cuáles desaparecen. No pretende ser posicional
 * —eso sería un diff de verdad, con su algoritmo y su coste— sino exacto en lo que afirma: una línea que
 * estaba y ya no está **está eliminada**, y una que no estaba y está **está añadida**.
 *
 * Los dos lados se comparan **canónicos**: sin CR, sin espacios al final de línea y sin línea vacía
 * final. Si no, un salto de más al final del fichero se leería como una eliminación de contenido, y la
 * puerta pediría justificar algo que no desapareció.
 *
 * @returns `{ anadidas, eliminadas }` — listas de líneas.
 */
export function diffLines(antes = '', despues = '') {
  const canonico = (t) => String(t).replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
  const cuenta = (texto) => {
    const m = new Map();
    for (const l of canonico(texto).split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = cuenta(antes);
  const b = cuenta(despues);
  const anadidas = [];
  const eliminadas = [];
  for (const [linea, n] of b) {
    for (let i = 0; i < n - (a.get(linea) ?? 0); i++) anadidas.push(linea);
  }
  for (const [linea, n] of a) {
    for (let i = 0; i < n - (b.get(linea) ?? 0); i++) eliminadas.push(linea);
  }
  return { anadidas, eliminadas };
}

/**
 * Diff del material que acompaña a la skill: añadido, modificado y eliminado, con las huellas.
 * @param base - `[{ path, sha256 }]` de la versión vigente (del `meta.json` de la aprobada).
 * @param nuevas - `[{ path, content, sha256 }]` de la propuesta.
 */
export function referencesDiff(base = [], nuevas = []) {
  const porRuta = (lista) => new Map(lista.map((r) => [normalizeRel(r.path), r]));
  const antes = porRuta(base);
  const despues = porRuta(nuevas);
  const anadidas = [];
  const modificadas = [];
  const eliminadas = [];
  for (const [ruta, r] of despues) {
    const previa = antes.get(ruta);
    if (previa === undefined) anadidas.push({ path: ruta, sha256: r.sha256 });
    else if (previa.sha256 !== r.sha256) modificadas.push({ path: ruta, antes: previa.sha256, despues: r.sha256 });
  }
  for (const [ruta, r] of antes) if (!despues.has(ruta)) eliminadas.push({ path: ruta, sha256: r.sha256 });
  return { anadidas, modificadas, eliminadas };
}

/**
 * La puerta de la revisión: exige la forma entera y que la medición sea una medición.
 *
 * @param revision - lo que declaró el modelo.
 * @param diff - el diff real contra la versión vigente (`{ lineas, references }`).
 * @param cwd - proyecto de la sesión, para comprobar si la evidencia es **observable**.
 * @returns `{ ok, errors, warnings, observada, valor }`
 */
export function checkRevision(revision, { diff = null, cwd = null } = {}) {
  const errors = [];
  const warnings = [];
  const valor = revision && typeof revision === 'object' && !Array.isArray(revision) ? revision : null;
  if (valor === null) {
    return {
      ok: false,
      errors: ['un parche de una skill viva exige «revision»: qué afirmaba la versión anterior, qué evidencia la contradice, con qué se midió y qué cambia'],
      warnings,
      observada: false,
      valor: null,
    };
  }
  const campo = (nombre) => (typeof valor[nombre] === 'string' ? valor[nombre].trim() : '');
  const claim = campo('claim');
  const evidence = campo('evidence');
  const measurement = campo('measurement');
  const change = campo('change');

  // La evidencia se distingue por lo que se **puede comprobar**, no por lo larga que sea: una ruta corta
  // que existe (`package.json`) es la mejor evidencia posible, y una ruta larga que no está es una
  // afirmación. Así que primero se mira si es una ruta y si existe; sólo lo que no se puede comprobar
  // tiene que explicarse con palabras.
  const sinEspacios = evidence.length > 0 && !/\s/.test(evidence);
  const pareceRuta = sinEspacios && (/[\\/]/.test(evidence) || /\.[A-Za-z0-9]{1,8}$/.test(evidence));
  const existe = pareceRuta && typeof cwd === 'string' && cwd.trim().length > 0 && existsSync(resolve(cwd, evidence));

  if (claim.length < MIN_REVISION_FIELD) errors.push(`revision.claim es obligatorio (mínimo ${MIN_REVISION_FIELD} caracteres): qué afirmaba la skill que se corrige`);
  if (evidence.length === 0) {
    errors.push(`revision.evidence es obligatorio (mínimo ${MIN_REVISION_FIELD} caracteres): qué contradice esa afirmación — una ruta, un informe, una salida`);
  } else if (!existe) {
    if (evidence.length < MIN_REVISION_FIELD) errors.push(`revision.evidence es obligatorio (mínimo ${MIN_REVISION_FIELD} caracteres): qué contradice esa afirmación — una ruta, un informe, una salida`);
    else if (pareceRuta) warnings.push(`la evidencia «${evidence}» no está en el proyecto: queda como afirmación NO verificada, no como medición observada`);
    else warnings.push('la evidencia no es una ruta del proyecto: queda como afirmación NO verificada');
  }
  if (measurement.length < MIN_REVISION_FIELD) errors.push(`revision.measurement es obligatorio (mínimo ${MIN_REVISION_FIELD} caracteres): con qué se midió`);
  else if (!MEASUREMENT_RE.test(measurement)) errors.push('revision.measurement no contiene ninguna medición: hace falta un número o un comando entre backticks — una afirmación del modelo no es una medición');
  if (change.length < MIN_REVISION_FIELD) errors.push(`revision.change es obligatorio (mínimo ${MIN_REVISION_FIELD} caracteres): qué dice la skill a partir de ahora`);
  const observada = existe;

  // Lo que se elimina tiene que estar justificado, y el material no puede evaporarse en silencio.
  const lineasEliminadas = cuentaDiff(diff?.lineas?.eliminadas);
  const refsEliminadas = diff?.references?.eliminadas ?? [];
  if (lineasEliminadas > 0 || refsEliminadas.length > 0) {
    const removed = campo('removed');
    const que = [];
    if (lineasEliminadas > 0) que.push(`${lineasEliminadas} línea(s) del cuerpo`);
    if (refsEliminadas.length > 0) que.push(`${refsEliminadas.length} referencia(s) (${refsEliminadas.map((r) => r.path).join(', ')})`);
    if (removed.length < MIN_REVISION_FIELD) {
      errors.push(`esta propuesta elimina ${que.join(' y ')}: justifícalo en revision.removed (mínimo ${MIN_REVISION_FIELD} caracteres) — borrar conocimiento aprobado no puede pasar en silencio`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, observada, valor: { claim, evidence, measurement, change, removed: campo('removed') } };
}

/** Estados en los que una skill está **viva**: lo que el modelo puede leer o recuperar hoy. */
const ESTADOS_VIVOS = ['approved', 'disabled'];

/**
 * La versión vigente de una skill según su id: de quién es, dónde vive y **su huella de contenido**.
 *
 * Es lo que identifica la base de un parche. Se mira el proyecto y, después, lo publicado para todos
 * proyectos (la biblioteca curada), que es la otra forma de estar vivo que tiene una skill nuestra.
 *
 * @returns `{ state, dir, hash, references, body }` o `null` si no hay nada vivo con ese id.
 */
export function vigenteDe(id, key, { root = defaultRoot(), curated = curatedLibraryRoot() } = {}) {
  for (const estado of ESTADOS_VIVOS) {
    const dir = join(root, 'projects', key, estado, id);
    if (existsSync(join(dir, 'SKILL.md'))) return leerVigente(dir, estado);
  }
  const cartel = join(curated, id);
  if (existsSync(join(cartel, 'SKILL.md')) && isOurs(cartel)) return leerVigente(cartel, 'published');
  return null;
}

function leerVigente(dir, state) {
  const { body } = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
  const references = [];
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    for (const r of meta.references ?? []) references.push({ path: normalizeRel(r.path), sha256: r.sha256 });
  } catch { /* sin meta no hay lista de referencias, pero la huella del contenido sigue valiendo */ }
  // El cuerpo se lee **como se escribe**: `renderSkill` compone un título de nivel 1 a partir de la
  // descripción, así que el primer `# …` del documento no es parte del procedimiento. Compararlo contra
  // el cuerpo que entra en una propuesta marcaría como perdido algo que nunca estuvo ahí.
  const cuerpo = cuerpoSinTitulo(body);
  return { state, dir, hash: folderHash(dir), references, body: cuerpo };
}

/**
 * El cuerpo de una skill tal y como se **mide**: sin el título de nivel 1, que `renderSkill` compone a
 * partir de la descripción. Sin esto, la misma skill mediría distinto al proponerla (cuerpo sin título) y
 * al auditarla (documento entero): dos varas para la misma regla.
 */
export function cuerpoSinTitulo(body) {
  return String(body ?? '').replace(/^\s*#\s+.*\r?\n/, '').trimStart();
}

/**
 * Audita **una** carpeta de skill, en el estado donde esté: la puerta completa (formato, estructura,
 * presupuesto, vínculo de referencias) más la integridad del material contra lo que registró su
 * `meta.json`. Sólo lee, y **nunca lanza**: un fichero ilegible es un hallazgo, no una excepción que se
 * lleve por delante el resto.
 *
 * Vive aquí, y no en el auditor, porque es exactamente lo que comprueba la puerta de aprobar: si fueran
 * dos implementaciones, la auditoría podría decir una cosa y la puerta otra.
 *
 * @returns `{ findings, errors, warnings, meta, unreadable }`
 */
export function auditarCarpeta(dir, { cwd = null, id = null } = {}) {
  const findings = [];
  const errors = [];
  const warnings = [];
  const anota = (severity, hallazgo) => {
    findings.push({ severity, observed: null, threshold: null, fix: '', ...hallazgo });
    (severity === 'error' ? errors : warnings).push(hallazgo.message);
  };
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) {
    anota('error', {
      rule: 'skill-missing',
      observed: dir,
      message: `no hay SKILL.md en ${dir}`,
      messageParams: { dir },
      fix: 'La carpeta no es una skill: retírala o aporta su SKILL.md',
    });
    return { findings, errors, warnings, meta: null, unreadable: false, references: [], links: [] };
  }
  let texto = null;
  try {
    texto = readFileSync(file, 'utf8');
  } catch (error) {
    // Error de acceso o de lectura: se registra y se sigue. Perder el resto de la auditoría por un
    // fichero ilegible sería peor que el propio fichero roto.
    anota('error', {
      rule: 'unreadable',
      observed: error.code ?? error.message,
      message: `no se pudo leer el SKILL.md: ${error.message}`,
      messageCode: 'finding.unreadable.skill.message',
      messageParams: { detalle: error.message },
      fix: 'Revisa los permisos de ese fichero (y que no sea una carpeta)',
      fixCode: 'finding.unreadable.skill.fix',
      fixParams: {},
    });
    return { findings, errors, warnings, meta: null, unreadable: true, references: [], links: [] };
  }
  let meta = null;
  try {
    meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  } catch { /* sin meta legible no hay integridad que comprobar; el resto sigue */ }

  const { data, body } = parseFrontmatter(texto);
  const cuerpo = cuerpoSinTitulo(body);
  const arbol = treeOfConErrores(dir);
  // Lo que no se pudo leer se dice **primero**: sin esa carpeta, cualquier juicio posterior sobre su
  // contenido sería una afirmación sin medir.
  for (const problema of arbol.errores) {
    anota('error', {
      rule: 'unreadable',
      observed: `${problema.ruta || '.'} (${problema.code})`,
      message: `no se pudo leer «${problema.ruta || 'la carpeta de la skill'}»: ${problema.code}`,
      messageCode: 'finding.unreadable.folder.message',
      messageParams: { ruta: problema.ruta || 'la carpeta de la skill', codigo: problema.code },
      fix: 'Revisa los permisos de esa carpeta (y que no sea un fichero donde se espera una carpeta)',
      fixCode: 'finding.unreadable.folder.fix',
      fixParams: {},
    });
  }
  const description = typeof data.description === 'string' ? data.description : '';
  const whenToUse = typeof data.whenToUse === 'string' ? data.whenToUse : '';
  const medidas = {
    description: description.length,
    whenToUse: whenToUse.length,
    body: cuerpo.length,
    secciones: (cuerpo.match(/^##[^#\n]/gm) ?? []).length,
  };
  const result = validateInput({
    id: data.name ?? id ?? basename(dir),
    description,
    whenToUse,
    evidence: Array.isArray(meta?.evidence) ? meta.evidence : [],
    body: cuerpo,
  }, {
    present: arbol.files.filter((f) => f !== 'SKILL.md' && f !== 'meta.json'),
    dirs: arbol.dirs,
    noComprobables: arbol.errores.map((e) => e.ruta),
    cwd,
  });
  findings.push(...result.findings);
  errors.push(...result.errors);
  warnings.push(...result.warnings);

  // Integridad: lo que una propuesta declaró tener sigue siendo lo que hay. Sin esto, una edición a mano
  // del material pesado viajaría a `approved/` —o se serviría— sin que nadie lo hubiera leído.
  for (const ref of meta?.references ?? []) {
    const ruta = normalizeRel(ref.path);
    if (!arbol.files.includes(ruta)) {
      anota('error', {
        rule: 'reference-missing-file',
        observed: ruta,
        message: `la referencia «${ruta}» ya no está en la carpeta de la skill`,
        messageParams: { ruta },
        fix: `Repón «${ruta}» o quita el vínculo del cuerpo`,
        fixCode: 'finding.reference-missing-file.fix',
        fixParams: { ruta },
      });
      continue;
    }
    let sha = null;
    try {
      sha = createHash('sha256').update(readFileSync(join(dir, ruta))).digest('hex').slice(0, 16);
    } catch (error) {
      anota('error', {
        rule: 'unreadable',
        observed: error.code ?? error.message,
        message: `no se pudo leer la referencia «${ruta}»: ${error.message}`,
        messageCode: 'finding.unreadable.reference.message',
        messageParams: { ruta, detalle: error.message },
        fix: 'Revisa los permisos de ese fichero',
        fixCode: 'finding.unreadable.reference.fix',
        fixParams: {},
      });
      continue;
    }
    if (sha !== ref.sha256) {
      anota('error', {
        rule: 'reference-integrity',
        observed: `${ruta} ${sha}`,
        threshold: `${ruta} ${ref.sha256}`,
        message: `la referencia «${ruta}» cambió después de proponerse (huella distinta)`,
        messageParams: { ruta },
        fix: `Vuelve a proponer la skill con el material actual, o repón «${ruta}»`,
        fixCode: 'finding.reference-integrity.fix',
        fixParams: { ruta },
      });
    }
  }
  // Y el contenido que se va a servir pasa por la capa de seguridad mirando el DISCO: así caza una edición
  // a mano posterior a la propuesta, que es justo la que no pasó por la puerta.
  const ficherosGuardados = {};
  for (const ref of meta?.references ?? []) {
    const ruta = normalizeRel(ref.path);
    try { ficherosGuardados[ruta] = readFileSync(join(dir, ruta), 'utf8'); } catch { /* ya se reportó arriba */ }
  }
  const seguridadGuardada = escanear({ id: meta?.name ?? id ?? '', body: texto, ficheros: ficherosGuardados });
  for (const h of seguridadGuardada.bloqueos) anota('error', h);
  for (const h of seguridadGuardada.avisos) anota('warn', h);

  return { findings, errors, warnings, meta, unreadable: false, references: result.references, links: result.links, medidas };
}

/**
 * Cuántas líneas dice un campo del diff.
 *
 * Existe por un defecto medido: `propose` escribe `diff.lineas.anadidas` como **número** (para no guardar
 * el diff entero en el meta), mientras dos lectores pedían `.length` — así que la puerta de tamaño y la
 * exigencia de justificar lo que se elimina leían **cero** en toda propuesta guardada. El número se acepta
 * tal cual, y la lista también: quien escribe decide la forma, quien lee no la supone.
 */
export function cuentaDiff(valor) {
  if (Array.isArray(valor)) return valor.length;
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  return 0;
}

/** El diff completo de una propuesta contra la versión vigente: cuerpo y material. */
export function diffContra(base, { body, references = [] }) {
  return {
    lineas: diffLines(base?.body ?? '', body ?? ''),
    references: referencesDiff(base?.references ?? [], references),
  };
}

/**
 * ¿La propuesta elimina material del que había? Se comprueba de verdad: el contenido del fichero que
 * desaparece tiene que seguir **entero** en la propuesta (en el cuerpo o en otra referencia). Si se
 * evapora, la propuesta se rechaza: el material pesado existe para que el detalle no se pierda.
 */
export function materialPreservado(baseDir, eliminadas, { body = '', references = [] } = {}) {
  const faltan = [];
  const contenidos = [body, ...references.map((r) => (typeof r.content === 'string' ? r.content : ''))];
  for (const ref of eliminadas) {
    let texto = '';
    try {
      texto = readFileSync(join(baseDir, ref.path), 'utf8');
    } catch {
      faltan.push(`${ref.path} (no se pudo leer su contenido para comprobar que sigue vivo)`);
      continue;
    }
    const intacto = contenidos.some((c) => c.includes(texto));
    if (!intacto) faltan.push(`${ref.path}`);
  }
  return faltan;
}

/** Frontmatter YAML mínimo: `clave: valor`, listas `[a, b]` y un nivel anidado bajo `metadata:`. */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  let nested = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (/^metadata:\s*$/.test(line)) { nested = {}; data.metadata = nested; continue; }
    const deep = /^\s{2,}([A-Za-z][A-Za-z0-9_.-]*):\s*(.*)$/.exec(line);
    if (deep && nested !== null) {
      // `dsh:` abre un segundo nivel; el resto de claves cuelgan de él.
      if (deep[2].trim() === '') { nested[deep[1]] = {}; continue; }
      const bucket = Object.keys(nested).length === 1 ? Object.values(nested)[0] : nested;
      bucket[deep[1]] = deep[2].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    nested = null;
    const [, key, rawValue] = kv;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
    if (key === 'tags' && value.startsWith('[')) data[key] = value.slice(1, -1).split(',').map((t) => t.trim()).filter(Boolean);
    else data[key] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

/**
 * Inventario de skills de un árbol `<raíz>/<id>/SKILL.md`. **Nunca lanza por una entrada mala.**
 *
 * La promesa es del contrato, y costaba cumplirla: si la carpeta no se puede leer —un fichero donde
 * debería haber una carpeta, una ACL denegada, un disco que se fue—, `readdirSync` lanza y la excepción
 * se llevaba por delante la herramienta entera (`propose` inventaría antes de escribir). Un almacén
 * tocado a mano no puede impedir proponer: el inventario devuelve lo que puede y sigue.
 */
export function scanTree(root, where) {
  const out = [];
  const entradas = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const entry of entradas(root)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const file = join(root, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    try {
      const { data } = parseFrontmatter(readFileSync(file, 'utf8'));
      out.push({
        id: data.name || entry.name,
        description: data.description || '',
        whenToUse: data.whenToUse || '',
        tags: Array.isArray(data.tags) ? data.tags : [],
        // De quién es: la marca que `renderSkill` pone en el frontmatter. Es la distinción que decide si
        // el mismo id es una actualización (nuestra) o una suplantación (de otra herramienta).
        ours: data.metadata?.dsh?.origin === 'skill-compiler',
        // El lote viaja **con la skill** (en su frontmatter) y no en un registro aparte: así sigue siendo
        // cierto aunque la skill se copie de un sitio a otro, y no hay dos fuentes que puedan discrepar.
        group: data.metadata?.dsh?.groupId
          ? { id: data.metadata.dsh.groupId, motivo: data.metadata.dsh.groupWhy ?? '' }
          : null,
        where,
        path: file,
      });
    } catch { /* una skill ilegible no debe tumbar el inventario */ }
  }
  return out;
}

/** Todo con lo que una propuesta debe compararse: biblioteca curada + aprendido propuesto y aprobado. */
export function existingSkills({ root = defaultRoot(), curated = curatedLibraryRoot() } = {}) {
  return [
    ...scanTree(curated, 'biblioteca-curada'),
    ...listProjects(root).flatMap((project) => [
      ...scanTree(join(root, 'projects', project, 'proposed'), `propuesto:${project}`),
      ...scanTree(join(root, 'projects', project, 'approved'), `aprobado:${project}`),
      // Lo apagado sigue existiendo: si no entrara aquí, el modelo propondría como nueva una skill que el
      // humano sólo apagó, y acabaríamos con dos versiones del mismo id.
      ...scanTree(join(root, 'projects', project, 'disabled'), `apagada:${project}`),
    ]),
  ];
}

/** Resumen para la CLI y para el informe al usuario: qué hay pendiente y en qué proyecto. */
export function overview({ root = defaultRoot() } = {}) {
  return listProjects(root).map((key) => {
    const proposed = scanTree(join(root, 'projects', key, 'proposed'), 'propuesto');
    const approved = scanTree(join(root, 'projects', key, 'approved'), 'aprobado');
    const rejected = scanTree(join(root, 'projects', key, 'rejected'), 'rechazado');
    return {
      projectKey: key,
      proposed: proposed.map((s) => ({ id: s.id, description: s.description })),
      approved: approved.map((s) => ({ id: s.id, description: s.description })),
      rejected: rejected.map((s) => s.id),
    };
  });
}

/**
 * Las carpetas de proyecto del almacen, con el estado REAL de la lectura.
 *
 * La diferencia que importa: un almacen recien instalado NO TIENE `projects/` -no hay nada propuesto
 * todavia- y eso es el estado inicial, no una averia. Una ruta que existe y no se puede leer (permisos, o un
 * `projects` que es un fichero: ENOTDIR) es otra cosa: ahi no se sabe que hay, y responder "no hay" seria
 * mentir sobre lo que no se miro. Un lector que devuelve cero por un catch mudo confunde las dos.
 *
 * @returns `{ estado: 'legible'|'inexistente'|'ilegible', proyectos, ruta, codigo, motivo }` — `motivo` es el
 * detalle tecnico de Node y `codigo` el codigo del sistema: la frase la compone quien presenta, no este lector.
 */
export function leerProyectosDelAlmacen(root = defaultRoot()) {
  const dir = join(root, 'projects');
  try {
    const proyectos = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
    return { estado: 'legible', proyectos, ruta: dir, motivo: null };
  } catch (error) {
    const codigo = error.code ?? null;
    if (codigo === 'ENOENT') {
      return { estado: 'inexistente', proyectos: [], ruta: dir, codigo, motivo: error.message };
    }
    return { estado: 'ilegible', proyectos: [], ruta: dir, codigo, motivo: error.message };
  }
}

/**
 * Los proyectos del almacen para quien solo venia a inventariar. Tolerante por fuera: un `projects/` ilegible
 * no puede tumbar la herramienta. Quien necesite el motivo usa `leerProyectosDelAlmacen`, que no lo esconde.
 */
export function listProjects(root = defaultRoot()) {
  return leerProyectosDelAlmacen(root).proyectos;
}

// ── composición del SKILL.md ─────────────────────────────────────────────────────────────────────

const single = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const quote = (s) => `"${single(s).replace(/"/g, '\\"')}"`;

/**
 * Compose the SKILL.md a DSH will accept as-is: `name` y `description` en el frontmatter, más
 * `metadata.dsh` con la procedencia. Sin claves de invocación heredadas: el silenciado se decide
 * donde corresponde, no aquí.
 *
 * `upstream` marca una skill **vendorizada**: nuestra versión adaptada de un original externo. Los
 * campos van planos bajo `metadata.dsh` a propósito (el parser de esta biblioteca modela dos niveles).
 */
export function renderSkill({ id, description, whenToUse, body, project, projectKey: key, evidence = [], createdAt, toolVersion = 1, upstream = null, localNote = '', group = null }) {
  const front = ['---', `name: ${id}`, `description: ${quote(description)}`];
  if (single(whenToUse)) front.push(`whenToUse: ${quote(whenToUse)}`);
  front.push('metadata:');
  front.push('  dsh:');
  front.push('    origin: skill-compiler');
  front.push(`    project: ${quote(project)}`);
  front.push(`    projectKey: ${quote(key)}`);
  front.push(`    learnedAt: ${quote(createdAt)}`);
  front.push(`    toolVersion: ${toolVersion}`);
  if (upstream) {
    front.push(`    upstreamUrl: ${quote(upstream.url)}`);
    if (upstream.ref) front.push(`    upstreamRef: ${quote(upstream.ref)}`);
    front.push(`    upstreamSha256: ${quote(upstream.sha256)}`);
    front.push(`    upstreamFetchedAt: ${quote(upstream.fetchedAt)}`);
  }
  // El lote, en dos claves planas: el parser de esta biblioteca modela dos niveles bajo `metadata`, y
  // anidar un tercero obligaría a escribir un parser de YAML de verdad para ganar nada.
  if (group) {
    front.push(`    groupId: ${quote(group.id)}`);
    front.push(`    groupWhy: ${quote(group.motivo)}`);
  }
  if (evidence.length) front.push(`    evidence: [${evidence.map((e) => quote(e)).join(', ')}]`);
  front.push('---', '', `# ${single(description)}`, '');

  const banner = upstream ? [
    `> **Versión local de una skill externa.** Origen: ${upstream.url}${upstream.ref ? ` (${upstream.ref})` : ''}, consultado el ${upstream.fetchedAt.slice(0, 10)}.`,
    `> SHA-256 del original: \`${upstream.sha256.slice(0, 16)}…\` · esta copia está **adaptada para este proyecto** y no es la fuente autoritativa.`,
    `> El original se guarda verbatim en \`upstream/\` y la procedencia completa en \`provenance.json\`.`,
    ...(single(localNote) ? [`>`, `> **Adaptación local:** ${single(localNote)}`] : []),
    '',
  ].join('\n') : '';

  return `${front.join('\n')}${banner}${body.replace(/^\s*\n/, '')}\n`;
}

// ── escritura: proponer, aprobar, rechazar ───────────────────────────────────────────────────────

/**
 * Los ficheros y las carpetas de un árbol, con rutas relativas y `/` (una sola forma de escribir una
 * ruta, para que comparar sea comparar y no traducir).
 */
export function treeOf(dir) {
  const { files, dirs } = arbolDe(dir);
  return { files, dirs };
}

/**
 * El mismo árbol, pero **diciendo lo que no pudo leer**.
 *
 * `treeOf` salta en silencio lo que no puede listar, y para inventariar un árbol que se va a escribir eso
 * está bien. Para **auditar** no: una carpeta denegada no puede quedar fuera del informe, porque entonces
 * un vínculo a un fichero que sí está saldría como «ese fichero no está» — un diagnóstico falso sobre algo
 * que la propia auditoría no pudo mirar. Aquí se devuelven los errores para que se digan.
 *
 * @returns `{ files, dirs, errores }` — `errores` es `[{ ruta, code }]`.
 */
export function treeOfConErrores(dir) {
  return arbolDe(dir);
}

function arbolDe(dir, rel = '', acc = { files: [], dirs: [], errores: [] }) {
  let entradas = [];
  try {
    entradas = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch (error) {
    acc.errores.push({ ruta: rel, code: error.code ?? error.message });
    return { files: [...acc.files].sort(), dirs: [...acc.dirs].sort(), errores: acc.errores };
  }
  for (const entry of entradas) {
    const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      acc.dirs.push(next);
      arbolDe(dir, next, acc);
    } else acc.files.push(next);
  }
  return { files: [...acc.files].sort(), dirs: [...acc.dirs].sort(), errores: acc.errores };
}

/**
 * Escribe la carpeta de una skill **verificando lo escrito antes de publicarla**.
 *
 * El `rename` es atómico, pero eso sólo garantiza que no se vea a medias: no garantiza que lo escrito
 * sea lo declarado. Así que se escribe en una carpeta temporal, se lee de vuelta **fichero a fichero**,
 * se compara byte a byte y se comprueba que el conjunto de ficheros es exactamente el previsto; sólo
 * entonces se mueve a su sitio. Si la verificación falla no queda nada: ni la skill a medias ni el
 * material de una skill que no llegó a existir.
 *
 * @returns `{ ok, files, reason? }` — `files` son las rutas relativas escritas y verificadas.
 */
/** La carpeta hermana de `proposed/` y `approved/`: historial no operativo. */
export const CARPETA_SUPERSEDED = 'superseded';
/**
 * Dentro del archivo, las propuestas sustituidas tienen su propio apartado: el archivo de skills apartadas
 * usa `<id>-<fecha>` y mezclar las dos formas haria ilegible el conteo.
 */
export const CARPETA_PROPUESTAS_ARCHIVADAS = 'proposals';

/** sha256 y bytes de cada fichero de un paquete, en orden estable, mas la huella del conjunto. */
function manifiestoDePaquete(dir) {
  const files = treeOf(dir).files.map((ruta) => {
    const buf = readFileSync(join(dir, ruta));
    return { path: ruta, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  });
  const paquete = createHash('sha256').update(files.map((f) => `${f.path}:${f.sha256}`).join('\n')).digest('hex');
  return { files, paquete };
}

/**
 * Archiva la propuesta que ya vive en `dir` antes de instalar la nueva. La unidad es el **paquete
 * completo** (SKILL.md, meta.json, references/, cualquier fichero del paquete), no solo el documento: el
 * manifiesto se escribe **fuera** de la carpeta archivada para que la carpeta quede byte a byte igual a
 * como estaba.
 *
 * Un revision-id no se reutiliza nunca: lleva marca de tiempo y huella del paquete, y si aun asi colisiona
 * se numera. El `rename` es atomico porque origen y destino estan bajo la misma raiz; no se supone
 * atomicidad entre volumenes.
 *
 * @returns `{ ok: true, revision: null }` si no habia nada que archivar, o `{ ok, revision, dir, files }`.
 */
function archivarPropuestaAnterior(dir, { root, clave, id, motivo, reemplazo, now }) {
  if (!existsSync(dir)) return { ok: true, revision: null };
  let manifiesto;
  try {
    manifiesto = manifiestoDePaquete(dir);
  } catch (error) {
    return { ok: false, reason: `no se pudo leer la propuesta anterior de "${id}": ${error.message}` };
  }
  const base = join(root, 'projects', clave, CARPETA_SUPERSEDED, CARPETA_PROPUESTAS_ARCHIVADAS, id);
  const sello = String(now).replace(/[:.]/g, '-');
  let revision = `${sello}-${manifiesto.paquete.slice(0, 8)}`;
  let destino = join(base, revision);
  for (let n = 2; existsSync(destino); n += 1) {
    revision = `${sello}-${manifiesto.paquete.slice(0, 8)}-${n}`;
    destino = join(base, revision);
  }
  const asiento = {
    id,
    revision,
    projectKey: clave,
    archivedAt: now,
    reason: motivo,
    files: manifiesto.files,
    packageHash: manifiesto.paquete,
    replacedBy: reemplazo,
  };
  try {
    mkdirSync(base, { recursive: true });
    renameSync(dir, destino);
  } catch (error) {
    return { ok: false, reason: `no se pudo archivar la propuesta anterior de "${id}": ${error.message}` };
  }
  try {
    writeFileSync(join(base, `${revision}.json`), `${JSON.stringify(asiento, null, 2)}\n`);
  } catch (error) {
    // El paquete ya se movio: se devuelve a su sitio para no dejar la propuesta desaparecida.
    try { renameSync(destino, dir); } catch { /* si tampoco se puede, lo dice el motivo de abajo */ }
    return { ok: false, reason: `no se pudo dejar constancia del archivado de "${id}": ${error.message}` };
  }
  return { ok: true, revision, dir: destino, files: manifiesto.files, paquete: manifiesto.paquete };
}

/** Deshace un archivado: el paquete vuelve a `proposed/` como estaba. */
function desarchivarPropuesta(archivado, dir, { root, clave, id }) {
  if (!archivado?.revision) return true;
  try {
    if (!existsSync(archivado.dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    renameSync(archivado.dir, dir);
    rmSync(join(root, 'projects', clave, CARPETA_SUPERSEDED, CARPETA_PROPUESTAS_ARCHIVADAS, id, `${archivado.revision}.json`), { force: true });
    return true;
  } catch {
    return false;
  }
}

function writeAtomic(dir, files) {
  // Una sola forma de nombrar cada fichero: las claves se normalizan antes de escribir y de verificar,
  // así que comparar es comparar. Dos claves que normalicen a la misma ruta se rechazan en vez de
  // colapsarse en silencio: sería una pérdida de contenido silenciosa.
  const declarados = new Map(Object.entries(files).map(([n, c]) => [String(n).replace(/\\/g, '/'), c]));
  if (declarados.size !== Object.keys(files).length) {
    return { ok: false, reason: 'dos ficheros de la propuesta apuntan a la misma ruta: revisa los nombres' };
  }
  const tmp = `${dir}.tmp-${randomUUID().slice(0, 8)}`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    mkdirSync(tmp, { recursive: true });
    for (const [name, content] of declarados) {
      const target = join(tmp, name);
      mkdirSync(dirname(target), { recursive: true }); // el vendorizado guarda `upstream/` dentro
      writeFileSync(target, content);
    }
    const esperadas = [...declarados.keys()].sort();
    const escritas = treeOf(tmp).files;
    if (esperadas.length !== escritas.length || esperadas.some((n, i) => n !== escritas[i])) {
      return { ok: false, reason: `la escritura no coincide con lo declarado: esperado ${esperadas.join(', ')} · escrito ${escritas.join(', ')}` };
    }
    for (const ruta of esperadas) {
      const leido = readFileSync(join(tmp, ruta));
      if (!leido.equals(Buffer.from(declarados.get(ruta)))) {
        return { ok: false, reason: `la escritura de «${ruta}» no coincide con su contenido declarado` };
      }
    }
    // La publicación también dentro de la guarda: un error de acceso aquí (una carpeta que no se puede
    // crear, un destino ocupado por un fichero) tiene que salir como motivo, no como excepción suelta
    // que se lleve por delante la herramienta que la llamó.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    renameSync(tmp, dir);
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    return { ok: false, reason: `no se pudo escribir la skill: ${error.message}` };
  }
  return { ok: true, files: treeOf(dir).files };
}

/**
 * Write a proposal. Idempotent by construction: the same id rewrites its own directory and nothing
 * else, so proposing twice leaves one proposal and never duplicates the library.
 */
/**
 * Un lote es una **declaración**, no un atajo: dice que varias propuestas nacen del mismo asunto y solo
 * tienen sentido juntas. Por eso el motivo es obligatorio y se exige explícito — sin él, `group` sería la
 * forma de saltarse el veto escribiendo cualquier cosa.
 *
 * @returns `{ ok, errors, valor }` — `valor` es `{ id, motivo }` o `null` si no se declaró lote.
 */
export function validateGroup(group) {
  if (group === undefined || group === null) return { ok: true, errors: [], valor: null };
  const id = String(group.id ?? '').trim();
  const motivo = String(group.motivo ?? '').trim();
  const errors = [];
  if (id.length > 64 || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) {
    errors.push('«group.id» tiene que ser un identificador kebab-case de hasta 64 caracteres (sin acentos: es un identificador, no un título)');
  }
  if (motivo.length < MIN_GROUP_WHY) {
    errors.push(`«group.motivo» tiene que decir en al menos ${MIN_GROUP_WHY} caracteres por qué estas propuestas van juntas: es lo que distingue un lote de un atajo para saltarse el veto`);
  }
  // `esperadas` es opcional, y es lo que permite **saber que falta una hermana**. Sin él, la promoción
  // automática de un lote no puede comprobar que está completo — y por eso, sin él, espera.
  const esperadas = group.esperadas === undefined ? null : Number(group.esperadas);
  if (esperadas !== null && (!Number.isInteger(esperadas) || esperadas < 1 || esperadas > 50)) {
    errors.push('«group.esperadas» es el número de propuestas que forman el lote: un entero entre 1 y 50, o se omite');
  }
  return { ok: errors.length === 0, errors, valor: errors.length === 0 ? { id, motivo, ...(esperadas === null ? {} : { esperadas }) } : null };
}

export function propose(input, { root = defaultRoot(), cwd, key = null, now = new Date().toISOString(), curated = curatedLibraryRoot(), extraFiles = {}, metaExtra = {}, references = [], revision, group: grupoDeclarado, diario = null } = {}) {
  const validation = validateInput(input, { references, cwd });
  if (!validation.ok) return { status: 'invalid', errors: validation.errors, warnings: validation.warnings };
  // El lote se acepta en el input o aparte, y por el mismo motivo que la revisión: quien propone puede ser
  // una sesión (lo manda en el input) o el motor (lo pasa por parámetro), y leerlo de los dos sitios evita
  // que una llamada interna se quede sin él por dónde lo puso.
  const grupo = validateGroup(grupoDeclarado ?? input?.group ?? null);
  if (!grupo.ok) return { status: 'invalid', errors: grupo.errors, warnings: validation.warnings };
  // La revisión es parte de la propuesta, como la evidencia: se acepta en el input o aparte, y la
  // herramienta la pasa aparte porque es un parámetro suyo. Leerla de los dos sitios evita que una
  // llamada interna (o una prueba) se quede sin ella por dónde la puso.
  const revisionDeclarada = revision ?? input?.revision ?? null;

  // La clave del proyecto se puede pasar explícitamente. Hace falta cuando quien propone **no** es una sesión
  // (la CLI con `--project-key`, el motor de reparación): derivarla del `cwd` grababa la propuesta en un
  // proyecto y la puerta la buscaba en otro, que es un desajuste silencioso y caro de encontrar.
  const clave = key ?? projectKey(cwd);
  if (clave === null) return { status: 'no-project', errors: ['no se pudo determinar el proyecto: la sesión no tiene un cwd utilizable'], warnings: [] };

  const candidate = {
    id: input.id.trim(),
    description: input.description.trim(),
    whenToUse: (input.whenToUse ?? '').trim(),
    tags: Array.isArray(input.tags) ? input.tags : [],
  };
  const overlap = checkOverlap(candidate, existingSkills({ root, curated }), { scope: clave, group: grupo.valor });
  if (!overlap.ok) return { status: 'conflict', conflicts: overlap.conflicts, warnings: validation.warnings };
  // El parecido con una hermana del lote se dice, aunque no vete: es la información que el humano necesita
  // para juzgar si de verdad son dos skills o una mal partida en dos.
  for (const hermana of overlap.siblings) {
    validation.warnings.push(`va en el lote «${grupo.valor.id}» y se parece a su hermana «${hermana.id}» (${hermana.score}): es un aviso, no un veto — el lote declara que van juntas`);
  }

  // ── Actualizar algo vivo: evidencia, base y diff ───────────────────────────────────────────────
  //
  // Se mira la versión **vigente** —aprobada, apagada o publicada— y se identifica por su huella de
  // contenido. Con eso: se exige la revisión, se calcula el diff real y se comprueba que lo que
  // desaparece no se evapora. Sin base viva, esto es una propuesta nueva y nada de esto aplica.
  const base = vigenteDe(candidate.id, clave, { root, curated });
  // ── La propiedad del puesto y los choques entre sistemas ────────────────────────────────────────
  //
  // Un id que ya vive en otro sistema —otro agente, otro editor, la biblioteca de DSH— no es un detalle:
  // es donde nacen dos verdades sobre lo mismo. Se mira **sólo** cuando la propuesta es nueva (actualizar
  // lo nuestro no puede ser una colisión) y lo que se hace depende de la política que se aplica:
  //
  //   · `dsh-only` —declarada, o porque no hay respuesta utilizable— → se rechaza: fuera de DSH este
  //     plugin no compite.
  //   · `machine` → se avisa y se sigue: lo ajeno se lee y se cita, jamás se sobrescribe.
  //
  // Con la declaración ausente, inválida o ilegible se aplica la política segura y el motivo va en el
  // aviso: no se presume una elección que nadie ha hecho, ni se esconde por qué.
  const propiedad = leerPropiedad({ root });
  const politica = politicaAplicable(propiedad);
  let alcanceDeLaPropuesta = null;
  if (base === null) {
    const barrido = dondeMasViveEseId(candidate.id, { root, curada: curated, proyectos: proyectosConocidos({ root }) });
    const donde = barrido.sitios.map((sitio) => `${sitio.sistema} (${sitio.ruta})`).join(', ');
    const sinLeer = barrido.sinLeer.map((fuente) => `${fuente.sistema} (${fuente.estado})`).join(', ');
    alcanceDeLaPropuesta = {
      politica,
      politicaEstado: propiedad.estado,
      politicaHuella: propiedad.huella,
      sitios: barrido.sitios.map((sitio) => ({ sistema: sitio.sistema, ruta: sitio.ruta, huella: sitio.huella })),
      barridoCompleto: barrido.completo,
      fuentesSinLeer: barrido.sinLeer,
    };
    if (barrido.sitios.length > 0) {
      if (politica === SOLO_DSH) {
        const porQue = propiedad.estado === 'declarada'
          ? `la propiedad declarada «${SOLO_DSH}»`
          : `la propiedad del puesto está ${propiedad.estado} (${propiedad.motivo}), así que se aplica la política segura`;
        return {
          status: 'conflict',
          conflicts: [{
            id: candidate.id,
            score: 1,
            reason: `«${candidate.id}» ya vive en otro sistema: ${donde}. Con ${porQue} este plugin no compite fuera de DSH: elige otro id, o declara la propiedad con /skill-propiedad`,
          }],
          warnings: validation.warnings,
        };
      }
      validation.warnings.push(`aviso de propiedad («${MAQUINA}»): «${candidate.id}» ya vive en ${donde}. Se propone una copia NUESTRA con procedencia; lo de otro sistema no se sobrescribe`);
    }
    // Un barrido incompleto no prueba nada: ni que el id esté fuera, ni que no esté. Se dice tal cual.
    if (!barrido.completo) {
      validation.warnings.push(barrido.sitios.length > 0
        ? `el barrido del puesto NO está completo (${sinLeer}): puede haber más copias de «${candidate.id}» sin ver`
        : `no se encontró «${candidate.id}» fuera de este almacén, pero el barrido NO está completo (${sinLeer}): no se puede afirmar que no exista`);
    }
  }
  // Una declaración que existe y no se puede usar es un trabajo pendiente, no un estado normal: se dice
  // siempre, porque callarlo dejaría la política en un limbo silencioso.
  if (propiedad.estado === 'invalida' || propiedad.estado === 'ilegible') {
    validation.warnings.push(`la declaración de propiedad del puesto está ${propiedad.estado} (${propiedad.motivo}): se aplica la política segura mientras siga así — /skill-propiedad ${SOLO_DSH} o /skill-propiedad ${MAQUINA}`);
  }
  let diff = null;
  let revisionValidada = null;
  let evidenciaObservada = false;
  if (base !== null) {
    diff = diffContra(base, { body: input.body ?? '', references: validation.references });
    const check = checkRevision(revisionDeclarada, { diff, cwd });
    if (!check.ok) return { status: 'invalid', errors: check.errors, warnings: [...validation.warnings, ...check.warnings] };
    revisionValidada = check.valor;
    evidenciaObservada = check.observada;
    validation.warnings.push(...check.warnings);
    // Lo eliminado tiene que seguir existiendo en alguna parte de la propuesta. Una línea menos se
    // justifica; un fichero de material que desaparece sin dejar rastro, no.
    if (diff.references.eliminadas.length > 0) {
      const perdidos = materialPreservado(base.dir, diff.references.eliminadas, { body: input.body ?? '', references: validation.references });
      if (perdidos.length > 0) {
        return {
          status: 'invalid',
          errors: [`su contenido se pierde al eliminar: ${perdidos.join(', ')} — consérvalo (en el cuerpo o en otra referencia) o propón una skill nueva que no lo prometa`],
          warnings: validation.warnings,
        };
      }
    }
  } else if (revisionDeclarada !== null && revisionDeclarada !== undefined) {
    validation.warnings.push('se recibió «revision» pero no hay ninguna skill viva con ese id: no se aplica');
  }
  const updatesApproved = existsSync(join(root, 'projects', clave, 'approved', candidate.id));
  // Si ya existía una propuesta con ese id, esto es un parche de lo propuesto, no una creación.
  // La diferencia importa: es lo que el usuario ve en la interfaz y lo que le dice si su biblioteca
  // creció o si se afinó lo que ya había.
  const updatesProposal = existsSync(join(root, 'projects', clave, 'proposed', candidate.id));
  // Una versión **apagada** también se reemplaza al aprobar (`move` la aparta), así que el humano tiene
  // que saberlo: sin esto, proponer sobre algo apagado se anunciaba como «creada» y la aprobación
  // reemplazaba en silencio una skill que alguien había apagado a propósito.
  const updatesDisabled = existsSync(join(root, 'projects', clave, 'disabled', candidate.id));
  // Y lo **publicado** para todos los proyectos: aprobar esto reemplaza la versión que ya se sirve en
  // todas las sesiones (la anterior queda apartada en `global/superseded/`). Sin decirlo, el humano
  // creería que está creando algo nuevo cuando en realidad está cambiando lo que ve en todas partes.
  const updatesPublished = isOurs(join(curated, candidate.id));

  const project = input.project ?? cwd;
  const dir = join(root, 'projects', clave, 'proposed', candidate.id);
  const skill = renderSkill({
    ...candidate, body: input.body.trim(), project, projectKey: clave, evidence: input.evidence ?? [],
    createdAt: now, upstream: input.upstream ?? null, localNote: input.localNote ?? '',
    group: grupo.valor,
  });
  // El material pesado viaja **con** la skill: el cuerpo lo enlaza, la puerta ya comprobó que el vínculo
  // se resuelve, y la Fase 0 midió que el modelo lo alcanza desde la carpeta. Lo que se guarda en el
  // registro es su huella, que es lo que permite detectar después una edición a mano.
  const referencias = validation.references.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  const archivosReferencia = Object.fromEntries(validation.references.map((r) => [r.path, r.content]));
  // ── La escritura, bajo cerrojo y con la decisión re-verificada ─────────────────────────────────
  //
  // El barrido de arriba decide **qué se dice**; el de aquí decide **qué se escribe**. Entre los dos hay
  // una ventana —otra sesión, otra propuesta, un almacén que aparece— y cubrirla es la diferencia entre
  // comprobar y creer que se comprobó. Así que la escritura va bajo el **mismo** cerrojo por skill que usa
  // la promoción (uno solo en el puesto: dos mecanismos serían dos verdades), y dentro se repiten las dos
  // comprobaciones que sostienen la decisión: que la política no cambió, y que el id no vive fuera con la
  // política que se aplica ahora. Si algo cambió, no se escribe y se dice por qué.
  const dentroDelCerrojo = conCerrojo(root, clave, candidate.id, () => {
    const propiedadAhora = propiedadSinCambios(propiedad, { root });
    if (!propiedadAhora.ok) return { status: 'invalid', errors: [propiedadAhora.reason], warnings: validation.warnings };
    const politicaAhora = politicaAplicable(propiedadAhora.estado);
    const barridoAhora = dondeMasViveEseId(candidate.id, { root, curada: curated, proyectos: proyectosConocidos({ root }) });
    if (base === null && barridoAhora.sitios.length > 0) {
      const sitios = barridoAhora.sitios.map((sitio) => `${sitio.sistema} (${sitio.ruta})`).join(', ');
      if (politicaAhora === SOLO_DSH) {
        return {
          status: 'conflict',
          conflicts: [{ id: candidate.id, score: 1, reason: `«${candidate.id}» vive fuera de este almacén (${sitios}) y la política que se aplica es «${SOLO_DSH}»: no se compite fuera de DSH — elige otro id, o declara la propiedad` }],
          warnings: validation.warnings,
        };
      }
      // Apareció entre la comprobación y la escritura: se declara en la propuesta, no se esconde.
      const yaEstaba = alcanceDeLaPropuesta?.sitios?.some((sitio) => barridoAhora.sitios.some((nuevo) => nuevo.ruta === sitio.ruta));
      if (!yaEstaba) {
        validation.warnings.push(`durante la escritura apareció otra copia de «${candidate.id}» en ${sitios}: se declara en la propuesta — lo ajeno no se toca`);
        if (alcanceDeLaPropuesta !== null) {
          alcanceDeLaPropuesta.sitios = barridoAhora.sitios.map((sitio) => ({ sistema: sitio.sistema, ruta: sitio.ruta, huella: sitio.huella }));
          alcanceDeLaPropuesta.aparecioDuranteLaEscritura = true;
        }
      }
    }

    const meta = {
      id: candidate.id,
      project,
      projectKey: clave,
      state: 'proposed',
      createdAt: now,
      description: candidate.description,
      whenToUse: candidate.whenToUse,
      evidence: input.evidence ?? [],
      warnings: validation.warnings,
      ...(referencias.length ? { references: referencias, links: validation.links } : {}),
      // La identidad de la versión sobre la que se construyó y lo que cambia respecto de ella. Se guardan
      // aquí porque son la prueba que se volverá a comprobar al aprobar: si la vigente se movió, esta
      // propuesta ya no describe un cambio sobre nada real.
      ...(base !== null
        ? {
          base: { state: base.state, hash: base.hash },
          revision: revisionValidada,
          diff: {
            lineas: { anadidas: diff.lineas.anadidas.length, eliminadas: diff.lineas.eliminadas.length },
            references: diff.references,
          },
        }
        : {}),
      ...(grupo.valor ? { group: grupo.valor } : {}),
      // El alcance con el que se decidió esta propuesta: la política aplicada, su huella, los sitios donde
      // el id vive fuera y si el barrido del puesto quedó completo. Se guarda porque es lo que permitirá
      // volver a comprobarlo al aprobarla — una decisión sin su evidencia no se puede auditar después.
      ...(alcanceDeLaPropuesta !== null ? { scope: alcanceDeLaPropuesta } : {}),
      ...metaExtra,
    };
    const shaNueva = createHash('sha256').update(skill).digest('hex');
    const motivoSustitucion = revisionValidada?.change ?? 'nueva revision del mismo id';
    // Antes de instalar nada: si ya vive una propuesta con este id, se archiva ENTERA. Reescribir sin
    // archivar es lo que hizo desaparecer una revision anterior sin dejar rastro.
    const archivado = archivarPropuestaAnterior(dir, {
      root, clave, id: candidate.id, now, motivo: motivoSustitucion,
      reemplazo: { sha256: shaNueva, revision: revisionValidada?.claim ?? null },
    });
    if (!archivado.ok) return { status: 'invalid', errors: [archivado.reason], warnings: validation.warnings };
    const escrito = writeAtomic(dir, { 'SKILL.md': skill, 'meta.json': `${JSON.stringify(meta, null, 2)}\n`, ...archivosReferencia, ...extraFiles });
    // Nada a medias: si la verificación de la escritura falla, la propuesta no existe y no queda basura.
    if (!escrito.ok) {
      const devuelta = desarchivarPropuesta(archivado, dir, { root, clave, id: candidate.id });
      const aviso = archivado.revision
        ? [devuelta ? 'la propuesta anterior se restauro' : 'ATENCION: la propuesta anterior quedo en superseded/ y no se pudo devolver']
        : [];
      return { status: 'invalid', errors: [escrito.reason, ...aviso], warnings: validation.warnings };
    }
    // El rastro forma parte de la operacion: si no se puede anotar, la sustitucion se deshace.
    if (archivado.revision) {
      const anotado = anotarEntradaEnDiario(diario ?? join(root, 'projects', clave, 'journal.jsonl'), {
        tipo: 'propuesta-sustituida',
        id: candidate.id,
        projectKey: clave,
        revisionAnterior: archivado.revision,
        paqueteAnterior: archivado.paquete,
        sha256Nueva: shaNueva,
        motivo: motivoSustitucion,
        por: 'sistema',
      }, { now });
      if (!anotado) {
        const devuelta = desarchivarPropuesta(archivado, dir, { root, clave, id: candidate.id });
        return {
          status: 'invalid',
          errors: [`no se pudo anotar la sustitucion en el diario: la propuesta anterior sigue en su sitio${devuelta ? '' : ' (ATENCION: revisa superseded/)'}`],
          warnings: validation.warnings,
        };
      }
    }
    return {
      status: 'proposed',
      id: candidate.id,
      project,
      projectKey: clave,
      path: join(dir, 'SKILL.md'),
      warnings: validation.warnings,
      sha256: shaNueva,
      ...(archivado.revision
        ? { superseded: { revision: archivado.revision, packageHash: archivado.paquete, files: archivado.files.length, dir: archivado.dir } }
        : { superseded: null }),
      ...(grupo.valor ? { group: grupo.valor, siblings: overlap.siblings } : {}),
      references: referencias,
      links: validation.links,
      files: escrito.files,
      ...(base !== null
        ? {
          base: { state: base.state, hash: base.hash },
          revision: revisionValidada,
          evidenciaObservada,
          diff: {
            lineas: { anadidas: diff.lineas.anadidas, eliminadas: diff.lineas.eliminadas },
            references: diff.references,
          },
        }
        : {}),
      updatesApproved,
      updatesProposal,
      updatesDisabled,
      updatesPublished,
      relatedElsewhere: overlap.relatedElsewhere,
    };
  });
  // El cerrojo tomado no deja una propuesta a medias ni una decisión a ciegas: se declara y se para.
  if (dentroDelCerrojo === null || typeof dentroDelCerrojo !== 'object' || dentroDelCerrojo.status === undefined) {
    return { status: 'invalid', errors: [dentroDelCerrojo?.reason ?? 'no se pudo tomar el cerrojo de esta skill'], warnings: validation.warnings };
  }
  return dentroDelCerrojo;

}

export function move(root, key, id, from, to, { esperada = null } = {}) {
  // Un id llega de la línea de comandos y se convierte en ruta: si no es un id, no es una ruta que tocar.
  // Y el árbol que se mueve tiene que ser un árbol normal —un enlace dentro de una skill es una puerta a
  // otro sitio, y aprobarla sería publicar contenido de fuera como si fuera suyo—.
  const inseguro = motivoDeIdInseguro(id);
  if (inseguro) return { ok: false, reason: `id no utilizable: ${inseguro}` };
  const source = join(root, 'projects', key, from, id);
  const target = join(root, 'projects', key, to, id);
  if (!existsSync(source)) return { ok: false, reason: `no existe ${from}/${id} en ${key}` };
  const arbol = revisarArbol(source);
  if (!arbol.ok) {
    return { ok: false, reason: `la skill no es un árbol seguro y no se mueve: ${arbol.problemas.map((p) => `${p.observed} — ${p.message}`).join('; ')}` };
  }
  // ── La garantía de integridad, ANTES de tocar nada ────────────────────────────────────────────
  //
  // Quien aprueba vio un contenido concreto. Si entre la puerta y el movimiento el contenido cambia, aprobar
  // ese árbol sería aprobar otra cosa: se aborta aquí, sin haber movido nada (ni apartado la versión
  // anterior), y se dice qué fichero difiere. Antes esto se comprobaba **después** de mover y solo avisaba.
  if (esperada !== null) {
    const contenido = huellaDeContenido(source);
    if (contenido !== esperada) {
      return {
        ok: false,
        reason: `el contenido cambió después de validarse: se esperaba ${String(esperada).slice(0, 12)} y hay ${contenido.slice(0, 12)} — no se movió nada. Vuelve a validarlo con /skill-ver y decide otra vez`,
        huellaEsperada: esperada,
        huellaEncontrada: contenido,
      };
    }
  }
  let superseded = null;
  // Aprobar una actualización NO destruye la versión vigente: la aparta con su fecha y deja rastro,
  // porque en esta biblioteca una skill aprobada es una herramienta de trabajo, no un borrador.
  if (existsSync(target)) {
    // `approved` y `disabled` son los dos estados **vivos**: una corrección los reemplaza apartando el
    // anterior. Cualquier otro destino no admite reemplazo: su nombre ya existe y pisarlo sería perderlo.
    if (to !== 'approved' && to !== 'disabled') return { ok: false, reason: `ya existe ${to}/${id}` };
    superseded = join(root, 'projects', key, 'superseded', `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    mkdirSync(dirname(superseded), { recursive: true });
    renameSync(target, superseded);
  }
  // Aprobar reemplaza CUALQUIER versión anterior del mismo id: además de la aprobada que hubiera, una
  // apagada o una propuesta vieja. Dejar dos estados con el mismo id sería servir una y esconder la otra,
  // y la próxima decisión del humano caería sobre la que no está viendo.
  if (to === 'approved') {
    for (const otro of ['disabled', 'proposed']) {
      const candidato = join(root, 'projects', key, otro, id);
      if (candidato === source || !existsSync(candidato)) continue;
      const aparcado = join(root, 'projects', key, 'superseded', `${id}-${otro}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      mkdirSync(dirname(aparcado), { recursive: true });
      renameSync(candidato, aparcado);
      if (superseded === null) superseded = aparcado;
    }
  }
  const metaFile = join(source, 'meta.json');
  if (existsSync(metaFile)) {
    try {
      const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
      meta.state = to;
      meta[`${to}At`] = new Date().toISOString();
      if (superseded !== null) meta.supersededPrevious = superseded;
      writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    } catch { /* el meta es accesorio: no impide mover la skill */ }
  }
  // El movimiento puede fallar (un destino ocupado, un disco, permisos): eso es un motivo, no una excepción
  // que se lleve por delante el comando humano con la propuesta a medio mover.
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
  } catch (error) {
    return { ok: false, reason: `no se pudo mover ${from}/${id} a ${to}/${id}: ${error.code ?? error.message}` };
  }
  return { ok: true, path: join(target, 'SKILL.md'), superseded };
}

/**
 * Aprobar es un acto humano, y por eso vive en la CLI y no en una herramienta del modelo: si fuera
 * una herramienta, el propio modelo podría auto-aprobarse su propuesta y la revisión sería decorativa.
 */
export const approve = (id, key, opts = {}) =>
  (scopeOf(opts) === 'global'
    ? publishToLibrary(id, key, opts)
    // `estado` permite corregir una skill **sin encenderla**: la corrección se valida igual y se coloca en
    // el estado donde estaba. Sin esto, arreglar una apagada exigía activarla, que es cambiar su contrato.
    : move(opts.root ?? defaultRoot(), key, id, 'proposed', opts.estado === 'disabled' ? 'disabled' : 'approved', { esperada: opts.esperada ?? null }));

/**
 * Aprobar **para todos los proyectos**: la skill se publica en la biblioteca de usuario, que es la raíz que
 * el harness sirve con rango 400, y la propuesta se archiva en el proyecto con la constancia de a dónde fue
 * (`published/`). Una sola copia efectiva: el proyecto no la sirve también, o el mismo conocimiento viajaría
 * dos veces al prompt con dos rangos distintos.
 *
 * Puerta, antes de escribir nada: si la biblioteca ya tiene ese id y **no** es nuestro, no se toca. La
 * carpeta es compartida con otras herramientas y pisar una skill ajena sería destruir trabajo que no es de
 * este plugin.
 */
export function publishToLibrary(id, key, { root = defaultRoot(), library = null, now = new Date(), esperada = null } = {}) {
  const source = join(root, 'projects', key, 'proposed', id);
  if (!existsSync(join(source, 'SKILL.md'))) return { ok: false, reason: `no hay ninguna propuesta con el id ${id} en ${key}` };
  // La misma garantía que en la aprobación local: lo que el humano validó es lo que se publica. Se comprueba
  // aquí, antes de escribir en la biblioteca compartida, y no después.
  if (esperada !== null) {
    const contenido = huellaDeContenido(source);
    if (contenido !== esperada) {
      return {
        ok: false,
        reason: `el contenido cambió después de validarse: se esperaba ${String(esperada).slice(0, 12)} y hay ${contenido.slice(0, 12)} — no se publicó nada. Vuelve a validarlo con /skill-ver y decide otra vez`,
        huellaEsperada: esperada,
        huellaEncontrada: contenido,
      };
    }
  }
  const cartel = join(library ?? curatedLibraryRoot(), id);
  const exists = existsSync(cartel);
  if (exists && !isOurs(cartel)) {
    return { ok: false, reason: `la biblioteca de usuario ya tiene una skill «${id}» que no es de skill-compiler: no se pisa. Retírala tú, o aprueba esta en el proyecto` };
  }
  const hash = folderHash(source);
  let superseded = null;
  if (exists) {
    // Una actualización no destruye la versión vigente: la aparta con su fecha, dentro de nuestro almacén.
    superseded = join(root, 'global', 'superseded', `${id}-${stamp(now)}`);
    try {
      mkdirSync(dirname(superseded), { recursive: true });
      cpSync(cartel, superseded, { recursive: true });
    } catch (error) {
      return { ok: false, reason: `no se pudo apartar la versión anterior: ${error.message}` };
    }
  }
  try {
    mkdirSync(cartel, { recursive: true });
    cpSync(source, cartel, { recursive: true });
  } catch (error) {
    return { ok: false, reason: `no se pudo publicar: ${error.message}` };
  }
  // La huella del destino tiene que ser la del origen: publicar no puede cambiar lo que se publica.
  if (folderHash(cartel) !== hash) {
    return { ok: false, reason: `la copia publicada no coincide con la propuesta (huella distinta): revisa ${cartel}` };
  }
  const moved = moverConConstancia(root, key, id, 'proposed');
  if (!moved.ok) return { ok: false, reason: moved.reason };
  const metaFile = join(root, 'projects', key, 'published', id, 'meta.json');
  try {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    meta.published = { to: cartel, at: no(now), sha256: hash, projectKey: key, superseded };
    writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  } catch { /* el meta es accesorio: la publicación ya está hecha */ }
  return { ok: true, id, projectKey: key, scope: 'global', path: join(cartel, 'SKILL.md'), library: cartel, sha256: hash, superseded };
}

/**
 * Cambiar el ámbito de una skill ya aprobada, en las dos direcciones. Existe porque una decisión con vuelta
 * no es una decisión a medias: si te equivocaste de ámbito, se corrige sin proponerla otra vez.
 */
export function ambito(id, key, { to, root = defaultRoot(), library = null, now = new Date() } = {}) {
  if (to !== 'global' && to !== 'project') return { ok: false, reason: 'dime a dónde va: «--global» o «--local»' };
  const cartel = join(library ?? curatedLibraryRoot(), id);
  const enProyecto = join(root, 'projects', key, 'approved', id);
  if (to === 'global') {
    if (!existsSync(enProyecto)) return { ok: false, reason: `no hay ninguna skill aprobada con el id ${id} en ${key}` };
    if (existsSync(cartel) && !isOurs(cartel)) return { ok: false, reason: `la biblioteca de usuario ya tiene una skill «${id}» que no es de skill-compiler: no se pisa` };
    const hash = folderHash(enProyecto);
    try {
      mkdirSync(cartel, { recursive: true });
      cpSync(enProyecto, cartel, { recursive: true });
    } catch (error) {
      return { ok: false, reason: `no se pudo mover a la biblioteca: ${error.message}` };
    }
    if (folderHash(cartel) !== hash) return { ok: false, reason: 'la copia no coincide con el original (huella distinta): no se retira nada' };
    const moved = moverConConstancia(root, key, id, 'approved');
    if (!moved.ok) return { ok: false, reason: moved.reason };
    // Cambiar de ámbito es una decisión: sin asiento, el diario dice «publicada/global» mientras el almacén
    // dice «local», y la evidencia miente. Se anota con las dos huellas, como la aprobación.
    anotarEntradaEnDiario(join(root, 'projects', key, 'journal.jsonl'), {
      id, key, decision: 'globalizada', ambito: 'global', por: 'humano', canal: 'comando',
      hashAnterior: hash, hashResultante: folderHash(cartel),
    });
    return { ok: true, id, projectKey: key, scope: 'global', path: join(cartel, 'SKILL.md'), library: cartel, sha256: hash };
  }
  if (!existsSync(cartel)) return { ok: false, reason: `no hay ninguna skill publicada con el id ${id}` };
  if (existsSync(enProyecto)) return { ok: false, reason: `${id} ya está aprobada en ${key}: decide qué hacer con ella` };
  const hash = folderHash(cartel);
  try {
    mkdirSync(dirname(enProyecto), { recursive: true });
    cpSync(cartel, enProyecto, { recursive: true });
  } catch (error) {
    return { ok: false, reason: `no se pudo traer al proyecto: ${error.message}` };
  }
  if (folderHash(enProyecto) !== hash) return { ok: false, reason: 'la copia no coincide con el original (huella distinta): no se retira nada' };
  // Ya no está publicada: la constancia de que salió se aparta, para que volver a publicarla no choque con ella.
  const constancia = join(root, 'projects', key, 'published', id);
  if (existsSync(constancia)) {
    const apartada = join(root, 'projects', key, 'superseded', `${id}-constancia-${stamp(now)}`);
    try {
      mkdirSync(dirname(apartada), { recursive: true });
      renameSync(constancia, apartada);
    } catch { /* la constancia es accesorio: no impide el cambio de ámbito */ }
  }
  try {
    const apartada = join(root, 'global', 'superseded', `${id}-localizado-${stamp(now)}`);
    mkdirSync(dirname(apartada), { recursive: true });
    renameSync(cartel, apartada);
  } catch (error) {
    return { ok: false, reason: `quedó en el proyecto pero no se pudo retirar de la biblioteca: ${error.message}` };
  }
  anotarEntradaEnDiario(join(root, 'projects', key, 'journal.jsonl'), {
    id, key, decision: 'localizada', ambito: 'project', por: 'humano', canal: 'comando',
    hashAnterior: hash, hashResultante: folderHash(enProyecto),
  });
  return { ok: true, id, projectKey: key, scope: 'project', path: join(enProyecto, 'SKILL.md'), sha256: hash };
}

/** Archivar la propuesta o la aprobada en `published/`, apartando la constancia anterior si la hubiera. */
function moverConConstancia(root, key, id, from) {
  const yaHay = join(root, 'projects', key, 'published', id);
  if (existsSync(yaHay)) {
    const apartada = join(root, 'projects', key, 'superseded', `${id}-constancia-${stamp(new Date())}`);
    try {
      mkdirSync(dirname(apartada), { recursive: true });
      renameSync(yaHay, apartada);
    } catch (error) {
      return { ok: false, reason: `no se pudo apartar la constancia anterior: ${error.message}` };
    }
  }
  return move(root, key, id, from, 'published');
}

/** Sacar una skill global de la biblioteca a un estado nuestro (apagada, o al respaldo al retirarla). */
function desdeBiblioteca(opts, id, cartel, destino) {
  if (!existsSync(join(cartel, 'SKILL.md'))) return { ok: false, reason: `no hay ninguna skill publicada con el id ${id}` };
  if (!isOurs(cartel)) return { ok: false, reason: `«${id}» está en la biblioteca pero no la escribió skill-compiler: no se toca` };
  if (existsSync(destino)) return { ok: false, reason: `ya hay una copia de ${id} en ${destino}: no se sobrescribe` };
  const hash = folderHash(cartel);
  try {
    mkdirSync(dirname(destino), { recursive: true });
    renameSync(cartel, destino);
  } catch (error) {
    return { ok: false, reason: `no se pudo mover: ${error.message}` };
  }
  return { ok: true, id, scope: 'global', path: join(destino, 'SKILL.md'), hash, root: opts.root ?? defaultRoot() };
}
export const reject = (id, key, opts = {}) => move(opts.root ?? defaultRoot(), key, id, 'proposed', 'rejected');

// ── el ciclo de vida completo: apagar, retirar y volver ──────────────────────────────────────────
//
// Aprobar no era el final del camino: faltaba poder **apagar** algo que ya no quieres (reversible) y
// **retirarlo** del todo (irreversible, así que con respaldo y con vuelta). Sin esto, la única salida
// sobre una skill aprobada era pedir una actualización, que es otra cosa.

/** Raíz de los respaldos: fuera del almacén y con fecha. Lo retirado no se pierde, se archiva. */
export function backupsRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return process.env.SKILL_COMPILER_BACKUPS || join(dshHome, 'backups', 'skills-eliminadas');
}

/** Subcarpeta del día: un respaldo por fecha, para que dos retiradas no se pisen. */
export function retiredRoot(now = new Date()) {
  return join(backupsRoot(), now.toISOString().slice(0, 10));
}

/**
 * Huella del **contenido** de una skill, fichero a fichero. `meta.json` queda fuera a propósito: es el
 * registro de su ciclo de vida y cambia con cada decisión (aprobarla, apagarla), así que incluirlo haría
 * que «volvió lo mismo» nunca se pudiera comprobar. Lo que se compara aquí es la skill, no su papeleo.
 */
export function folderHash(dir) {
  const partes = [];
  const walk = (base, rel) => {
    for (const entry of readdirSync(join(base, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(base, next);
      else if (next !== 'meta.json') partes.push(`${next}:${createHash('sha256').update(readFileSync(join(base, next))).digest('hex')}`);
    }
  };
  walk(dir, '');
  return createHash('sha256').update(partes.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Apagar una skill aprobada: deja de servirse y sale de la lista de activas, pero **se conserva entera** y
 * vuelve con un gesto. No es lo mismo que retirarla, y por eso son dos estados y dos verbos.
 */
export const disable = (id, key, opts = {}) =>
  (scopeOf(opts) === 'global'
    ? desdeBiblioteca(opts, id, join(libraryRoot(opts), id), join(opts.root ?? defaultRoot(), 'global', 'disabled', id))
    : move(opts.root ?? defaultRoot(), key, id, 'approved', 'disabled'));

export const enableGlobal = (id, opts = {}) => {
  const root = opts.root ?? defaultRoot();
  const source = join(root, 'global', 'disabled', id);
  if (!existsSync(join(source, 'SKILL.md'))) return { ok: false, reason: `no hay ninguna skill global apagada con el id ${id}` };
  const cartel = join(libraryRoot(opts), id);
  if (existsSync(cartel)) return { ok: false, reason: `la biblioteca ya tiene «${id}»: decide primero qué hacer con ella` };
  const hash = folderHash(source);
  try {
    mkdirSync(dirname(cartel), { recursive: true });
    renameSync(source, cartel);
  } catch (error) {
    return { ok: false, reason: `no se pudo encender: ${error.message}` };
  }
  return { ok: true, id, scope: 'global', path: join(cartel, 'SKILL.md'), hash };
};

/**
 * Volver a encenderla. Si ya hay una aprobada con ese id, se dice: pisarla en silencio destruiría una
 * skill que alguien aprobó, y decidir eso no le toca al plugin.
 */
export function enable(id, key, opts = {}) {
  if (scopeOf(opts) === 'global') return enableGlobal(id, opts);
  const root = opts.root ?? defaultRoot();
  if (existsSync(join(root, 'projects', key, 'approved', id))) {
    return { ok: false, reason: `ya hay una skill aprobada con ese id en ${key}: decide primero qué hacer con ella` };
  }
  return move(root, key, id, 'disabled', 'approved');
}

/**
 * Retirar: la carpeta sale del almacén a un respaldo fechado, con su huella. Es el único gesto
 * irreversible del plugin, así que **nunca borra**: mueve, y deja la vuelta al lado.
 */
export function retire(id, key, { root = defaultRoot(), now = new Date(), backupRoot = null, scope = 'project', library = null } = {}) {
  if (scopeOf({ scope }) === 'global') {
    const destino = join(backupRoot ?? retiredRoot(now), 'global', id);
    const salida = desdeBiblioteca({ root, library }, id, join(library ?? curatedLibraryRoot(), id), destino);
    if (!salida.ok) return salida;
    return { ok: true, id, projectKey: key, scope: 'global', backup: destino, path: join(destino, 'SKILL.md'), hash: salida.hash, revierte: `restore ${id} --global` };
  }
  const candidatos = [join(root, 'projects', key, 'disabled', id), join(root, 'projects', key, 'approved', id)];
  const source = candidatos.find((dir) => existsSync(dir)) ?? null;
  if (source === null) return { ok: false, reason: `no hay ninguna skill activa ni apagada con el id ${id} en ${key}` };
  const target = join(backupRoot ?? retiredRoot(now), key, id);
  if (existsSync(target)) return { ok: false, reason: `ya hay un respaldo de ${id} con esa fecha: no se sobrescribe` };
  const hash = folderHash(source);
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
  } catch (error) {
    return { ok: false, reason: `no se pudo retirar: ${error.message}` };
  }
  return { ok: true, id, projectKey: key, backup: target, path: join(target, 'SKILL.md'), hash, revierte: `restore ${id}` };
}

/** El respaldo más reciente de un id para un proyecto, o `null`. */
function hallarRespaldo(key, id, { backup = null, backupRoot = null }) {
  if (backup !== null) {
    if (existsSync(join(backup, key, id))) return join(backup, key, id);
    if (existsSync(backup)) return backup;
    return null;
  }
  const base = backupRoot ?? backupsRoot();
  if (!existsSync(base)) return null;
  const dias = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  for (const dia of dias) {
    const candidato = join(base, dia, key, id);
    if (existsSync(candidato)) return candidato;
  }
  return null;
}

/**
 * La vuelta: del respaldo al almacén. Se niega si ese id ya existe —restaurar no puede destruir lo que
 * hay— y devuelve la huella, para poder comprobar que volvió lo mismo.
 */
export function restore(id, key, opts = {}) {
  const root = opts.root ?? defaultRoot();
  if (scopeOf(opts) === 'global') {
    const source = hallarRespaldo('global', id, opts);
    if (source === null) return { ok: false, reason: `no hay respaldo global de ${id}` };
    const cartel = join(libraryRoot(opts), id);
    if (existsSync(cartel)) return { ok: false, reason: `la biblioteca ya tiene «${id}»: decide qué hacer con ella antes de restaurar` };
    const hash = folderHash(source);
    try {
      mkdirSync(dirname(cartel), { recursive: true });
      renameSync(source, cartel);
    } catch (error) {
      return { ok: false, reason: `no se pudo restaurar: ${error.message}` };
    }
    return { ok: true, id, scope: 'global', path: join(cartel, 'SKILL.md'), hash };
  }
  const source = hallarRespaldo(key, id, opts);
  if (source === null) return { ok: false, reason: `no hay respaldo de ${id} para ${key}` };
  if (existsSync(join(root, 'projects', key, 'approved', id)) || existsSync(join(root, 'projects', key, 'disabled', id))) {
    return { ok: false, reason: `${id} ya existe en ${key}: decide qué hacer con ella antes de restaurar` };
  }
  const hash = folderHash(source);
  const target = join(root, 'projects', key, 'approved', id);
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
  } catch (error) {
    return { ok: false, reason: `no se pudo restaurar: ${error.message}` };
  }
  return { ok: true, id, projectKey: key, path: join(target, 'SKILL.md'), hash };
}

/**
 * Lo apagado y lo retirado de un proyecto: es la lista que el humano mira cuando quiere deshacerse de algo,
 * y la que alimenta la decisión en lote.
 */
export function retired(key, { root = defaultRoot(), backupRoot = null } = {}) {
  const apagadas = scanTree(join(root, 'projects', key, 'disabled'), 'apagada').map((skill) => ({ ...skill, state: 'disabled', scope: 'project' }));
  // Y lo global: lo apagado y lo retirado de la biblioteca vive en nuestro almacén, así que se lista aquí,
  // con su ámbito dicho, para que el humano pueda volver a encenderlo o traerlo al proyecto.
  const globales = [
    ...scanTree(join(root, 'global', 'disabled'), 'apagada-global').map((s) => ({ ...s, state: 'disabled', scope: 'global' })),
    ...scanTree(join(root, 'global', 'superseded'), 'apartada-global').map((s) => ({ ...s, state: 'superseded', scope: 'global' })),
  ];
  const base = backupRoot ?? backupsRoot();
  const archivadas = [];
  if (existsSync(base)) {
    const dias = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
    for (const dia of dias) {
      for (const skill of scanTree(join(base, dia, key), 'eliminada')) archivadas.push({ ...skill, state: 'retired', retiredAt: dia, scope: 'project' });
      for (const skill of scanTree(join(base, dia, 'global'), 'eliminada')) archivadas.push({ ...skill, state: 'retired', scope: 'global', retiredAt: dia });
    }
  }
  return [...apagadas, ...globales, ...archivadas];
}

/**
 * La puerta que hay que pasar ANTES de aprobar: válida la propuesta guardada, que es además lo que
 * detecta una edición a mano posterior a la propuesta.
 *
 * Vive aquí, y no en la CLI, porque es una regla y no una superficie: la CLI, la página de revisión y
 * los comandos del harness tienen que aplicar **la misma**. Cuando vivía sólo en `bin/`, cualquier otra
 * vía de aprobación era, por construcción, una vía sin puerta.
 *
 * @param id - id de la propuesta.
 * @param key - clave del proyecto.
 * @param root - raíz del almacén.
 * @returns `{ ok, errors, warnings, file }`; `ok` en falso significa que no se puede aprobar.
 */
export function checkProposal(id, key, { root = defaultRoot(), curated = curatedLibraryRoot() } = {}) {
  const dir = join(root, 'projects', key, 'proposed', id);
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) {
    // La frase se compone del catalogo: una sola copia, y el idioma de la sesion. `errors` la lleva en texto
    // (lo que ya leian los consumidores de `checkProposal`) y `errorLines` en clave+parametros para la CLI.
    const texto = t('gate.integrity.no-proposal.message', { id, key });
    return {
      ok: false,
      errors: [texto],
      warnings: [],
      findings: [],
      meta: null,
      errorLines: [{ code: 'gate.integrity.no-proposal.message', params: { id, key }, texto }],
    };
  }
  // La puerta mira el disco, no la petición: así caza además lo que se editó a mano después de proponer.
  // Y es **la misma** función que audita una skill guardada: una regla, una implementación.
  const { findings, errors, warnings, meta } = auditarCarpeta(dir, { id });

  // ── La base: ¿es todavía la versión sobre la que se preparó esto? ───────────────────────────────
  //
  // Una corrección se prepara **contra algo concreto**. Si ese algo se movió mientras la propuesta
  // esperaba —otra aprobación, una edición a mano, un cambio de ámbito—, aplicarla encima sería
  // aplicar un cambio que ya no describe la realidad: se rechaza y se pide reconciliar.
  const integridad = [];
  const errorLines = [];
  // La frase de la integridad se compone del catalogo (no hay una segunda copia en espanol aqui): viaja a la vez
  // como texto para `errors` —lo que ya leian los consumidores— y como clave+parametros para la CLI.
  const anotaIntegridad = (code, params) => {
    const texto = t(code, params);
    errorLines.push({ code, params, texto });
    integridad.push(texto);
  };
  if (meta?.base) {
    const vigente = vigenteDe(id, key, { root, curated });
    if (vigente === null) {
      anotaIntegridad('gate.integrity.base-gone.message', { estado: meta.base.state, hash: meta.base.hash });
    } else if (vigente.hash !== meta.base.hash) {
      anotaIntegridad('gate.integrity.base-changed.message', { base: meta.base.hash, vigente: vigente.hash });
    }
  }
  // Y si la propuesta elimina material, la justificación tiene que seguir ahí (se pueda leer).
  if ((meta?.diff?.references?.eliminadas?.length ?? 0) > 0 && (meta?.revision?.removed ?? '').trim().length === 0) {
    anotaIntegridad('gate.integrity.removed-material.message', {});
  }

  const todos = [...errors, ...integridad];
  return { ok: todos.length === 0, errors: todos, warnings, findings, file, dir, meta, errorLines };
}

/**
 * Dónde está una skill AHORA: `proposed`, `approved`, `rejected`, o `null` si no existe.
 *
 * Existe por un defecto medido: aprobar dos veces respondía «no existe una propuesta X» y el usuario leía
 * un fallo donde había un acto ya hecho. Saber en qué carpeta está convierte ese error en un mensaje que
 * dice la verdad, sin que el estado deje de ser el mismo.
 */
export function locate(id, key, { root = defaultRoot() } = {}) {
  if (!esIdSeguro(id)) return null;
  // `disabled` entra aquí: sin él, apagar algo ya apagado no se reconocía como «ya estaba», y la
  // respuesta era un error de movimiento en vez de decir la verdad (que es lo que el humano espera).
  for (const where of ['proposed', 'approved', 'disabled', 'rejected', 'published']) {
    if (existsSync(join(root, 'projects', key, where, id, 'SKILL.md'))) return where;
  }
  // Y el ámbito global: sin esto, una segunda aprobación «global» intentaría publicar lo ya publicado y
  // respondería un error de movimiento en vez de decir la verdad («ya está en la biblioteca»).
  if (existsSync(join(root, 'global', 'disabled', id, 'SKILL.md'))) return 'global:disabled';
  // Y aquí la distinción que impide el peor desenlace: una skill en la biblioteca **con ese id** pero que
  // no escribió este plugin NO es «ya está publicada». Si lo dijera, el comando no haría nada y el humano
  // leería una mentira; y si siguiera adelante, pisaría trabajo ajeno. Lo cazó la arena.
  const ajena = join(curatedLibraryRoot(), id, 'SKILL.md');
  if (existsSync(ajena)) return isOurs(join(curatedLibraryRoot(), id)) ? 'global' : 'global:ajena';
  return null;
}

/** Distancia de edición acotada: por encima del tope no se calcula, sólo se responde que está lejos. */
function distanciaAcotada(a, b, tope) {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      actual[j] = Math.min(
        anterior[j] + 1,
        actual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    anterior = actual;
  }
  return anterior[b.length];
}

/**
 * El id que el humano quería decir cuando tecleó otro, si lo hay.
 *
 * Existe por un caso medido: `/skill-aprobar dhs-nexus-protocol --local` —una letra cambiada de sitio—
 * respondía «No hay ninguna propuesta «dhs-nexus-protocol»», que es verdad y no ayuda: cuesta una vuelta
 * entera y se lee como un fallo del plugin. Aquí se **sugiere**; nunca se aprueba ni se mueve nada por
 * parecido. La vara es determinista (≤ dos ediciones sobre los ids que existen en ese ámbito) y los
 * candidatos van ordenados, así que un empate se resuelve siempre igual.
 */
export function sugerenciaDeId(wanted, key, { root = defaultRoot(), tope = 2 } = {}) {
  const buscado = String(wanted ?? '').trim().toLowerCase();
  if (buscado === '' || key === null) return null;
  const candidatos = new Set();
  for (const where of ['proposed', 'approved', 'disabled', 'rejected']) {
    const base = join(root, 'projects', key, where);
    let entradas = [];
    try { entradas = readdirSync(base); } catch { continue; }
    for (const id of entradas) if (existsSync(join(base, id, 'SKILL.md'))) candidatos.add(id);
  }
  // La biblioteca de usuario también entra: un id global tecleado con una letra de más se sugiere igual.
  const curada = curatedLibraryRoot();
  try {
    for (const id of readdirSync(curada)) if (existsSync(join(curada, id, 'SKILL.md'))) candidatos.add(id);
  } catch { /* sin biblioteca legible: no hay nada más que sugerir */ }

  let mejor = null;
  let mejorDistancia = tope + 1;
  for (const id of [...candidatos].sort()) {
    if (id.toLowerCase() === buscado) continue;
    const d = distanciaAcotada(buscado, id.toLowerCase(), tope);
    if (d < mejorDistancia) {
      mejorDistancia = d;
      mejor = id;
    }
  }
  return mejorDistancia <= tope ? mejor : null;
}

/** Propuestas pendientes de un proyecto. Solo lectura: no decide nada. */
export function pending({ root = defaultRoot(), key }) {
  const base = join(root, 'projects', key);
  return scanTree(join(base, 'proposed'), 'propuesto')
    .map((s) => ({
      id: s.id,
      description: s.description,
      path: s.path,
      group: s.group ?? null,
      // Una propuesta sobre algo que **ya está activo** es una ACTUALIZACIÓN, no una skill nueva. Sin decirlo,
      // el humano ve el mismo id en «pendientes» y en «activas» y lee que la aprobación no surtió efecto.
      // Medido: pasó con `fault-injection-by-category`, cuya propuesta de las 15:48 actualiza la de las 15:08.
      updatesActive: existsSync(join(base, 'approved', s.id))
        || existsSync(join(base, 'disabled', s.id))
        || existsSync(join(base, 'published', s.id)),
    }));
}

// ── lo que el proveedor sirve al modelo ──────────────────────────────────────────────────────────

/**
 * Approved skills of ONE project. This is the function that enforces «no se carga en el lugar
 * equivocado»: el proyecto entra por el cwd y lo que no es suyo no se lista.
 */
export function listForProject(cwd, { root = defaultRoot() } = {}) {
  const key = projectKey(cwd);
  if (key === null) return [];
  return scanTree(join(root, 'projects', key, 'approved'), `aprendido:${key}`);
}

export function readSkill(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const { data, body } = parseFrontmatter(text);
  if (!data.name || !data.description) return null;
  return {
    name: data.name,
    description: data.description,
    whenToUse: data.whenToUse,
    content: body.trim(),
    metadata: data.metadata ? { dsh: data.metadata.dsh ?? {} } : undefined,
    path,
    bytes: statSync(path).size,
  };
}
