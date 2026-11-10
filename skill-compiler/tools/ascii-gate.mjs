#!/usr/bin/env node
/**
 * Puerta ASCII: el texto que controla el plugin no lleva acentos ni signos tipograficos.
 *
 * Se aplica por **linea base** y no como un interruptor: el repositorio tiene ~8.400 caracteres no ASCII
 * heredados (mensajes, comentarios y aserciones), y apagarlos todos de golpe dejaria la suite roja. La linea
 * base fija el maximo por fichero y **solo puede menguar**: cualquier caracter nuevo fuera de ASCII falla.
 *
 * Tres reglas que antes no estaban y que son el motivo de que este fichero exista asi:
 *
 *   1. **El inventario es cerrado en los dos sentidos.** Todo fichero de primera parte (`lib/` y `bin/`
 *      recursivos, `index.js`, `client.js`) tiene que estar en `FICHEROS` o en `EXCLUIDOS` con su motivo.
 *      Un modulo nuevo sin clasificar es un FALLO: antes, `lib/vendor.mjs`, `lib/catalog-signal.mjs` y
 *      `lib/review.mjs` se entregaron fuera de la puerta y nadie lo dijo, porque la lista era cerrada y
 *      nada la comparaba con el arbol. Y un fichero que la linea base vigilaba y ya no existe tambien es
 *      un fallo: un renombrado dejaba de estar vigilado en silencio.
 *   2. **Sin holgura.** `--update` no sube el tope de un fichero que ya estaba vigilado: un tope por encima
 *      de lo medido es sitio para deuda nueva que la puerta no ve. Subirlo exige `--allow-raise`, que lo
 *      hace a proposito y dice el delta. Un fichero NUEVO en `FICHEROS` si entra con su medida: eso es
 *      cobertura, no deuda.
 *   3. **La cobertura se dice en voz alta.** La salida nombra cuantos ficheros de primera parte hay,
 *      cuantos estan vigilados y cuantos excluidos con motivo.
 *
 * Uso: `node tools/ascii-gate.mjs [--root <dir>] [--json]` · `--update [--allow-raise]` reescribe la linea
 * base (acto manual, revisando el diff).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Ficheros cuyo texto es del plugin. El contenido de usuario (`SKILL.md`, `references/`) no entra aqui nunca.
 * Esta lista decide el tope por fichero; el inventario de al lado comprueba que no falte ninguno.
 */
export const FICHEROS = [
  'lib/audit.mjs', 'lib/auto-approve.mjs', 'lib/auto-update.mjs', 'lib/catalog-signal.mjs', 'lib/commands.mjs',
  'lib/approve-tx.mjs', 'lib/compiler.mjs', 'lib/definitions.mjs', 'lib/improve.mjs', 'lib/lock.mjs', 'lib/localized-commands.mjs', 'lib/operations.mjs',
  'lib/pending-rows.mjs', 'lib/presentation.mjs',
  'lib/projection.mjs', 'lib/promote.mjs', 'lib/repair.mjs', 'lib/review.mjs', 'lib/scope.mjs', 'lib/security.mjs',
  'lib/vendor.mjs',
  'lib/i18n/codes.mjs', 'lib/i18n/en.mjs', 'lib/i18n/es.mjs', 'lib/i18n/index.mjs',
  'bin/skill-compiler.mjs', 'client.js', 'index.js',
];

/**
 * Ficheros de primera parte que NO se vigilan, cada uno con su motivo escrito. Hoy esta vacio a proposito:
 * los 24 ficheros de primera parte son nuestros y los 24 se vigilan. El mecanismo existe para que excluir
 * uno sea una decision declarada y revisable, no el olvido que dejo tres modulos fuera de la puerta.
 */
export const EXCLUIDOS = [];

/** Raices de primera parte que se recorren enteras, buscando codigo. */
const SONDEADAS = ['lib', 'bin'];
/** Ficheros de primera parte que viven en la raiz del paquete. */
const SUELTOS = ['index.js', 'client.js'];
const CODIGO = /\.(mjs|js)$/;
/** Un motivo de exclusion por debajo de esto no explica nada. */
export const MOTIVO_MIN = 10;

/** Cuenta los caracteres fuera de ASCII de un texto. */
export const cuenta = (texto) => (texto.match(/[^\x00-\x7F]/g) ?? []).length;

/**
 * Todos los ficheros de primera parte del paquete, como rutas relativas con `/`.
 * Un `readdir` que falla se propaga: un arbol que no se puede leer no es un arbol sin ficheros.
 */
export function primeraParte(raiz) {
  const encontrados = [];
  for (const rel of SUELTOS) if (existsSync(join(raiz, rel))) encontrados.push(rel);
  const recorre = (rel) => {
    const abs = join(raiz, rel);
    if (!existsSync(abs)) return;
    for (const entrada of readdirSync(abs, { withFileTypes: true })) {
      const hijo = `${rel}/${entrada.name}`;
      if (entrada.isDirectory()) recorre(hijo);
      else if (CODIGO.test(entrada.name)) encontrados.push(hijo);
    }
  };
  for (const rel of SONDEADAS) recorre(rel);
  return encontrados.sort();
}

/** Lee la linea base; sin fichero, todo cuenta como nuevo. `ok:false` distingue «no hay» de «no se pudo leer». */
export function leerBase(ruta) {
  if (!existsSync(ruta)) return { ok: true, datos: { ficheros: {} } };
  try {
    const datos = JSON.parse(readFileSync(ruta, 'utf8'));
    if (datos === null || typeof datos !== 'object' || typeof datos.ficheros !== 'object' || datos.ficheros === null) {
      return { ok: false, datos: { ficheros: {} }, reason: 'la linea base no tiene la forma esperada' };
    }
    return { ok: true, datos };
  } catch (error) {
    return { ok: false, datos: { ficheros: {} }, reason: error.message };
  }
}

/**
 * Mide y juzga. Devuelve el informe entero para que la prueba y el CLI lean lo mismo.
 * `vigilados` y `excluidos` son parametros para poder medir el mecanismo con listas sembradas.
 */
export function auditar(raiz, { base, vigilados = FICHEROS, excluidos = EXCLUIDOS } = {}) {
  const fallos = [];
  const linea = base ?? leerBase(join(raiz, 'tools', 'ascii-baseline.json'));
  if (!linea.ok) fallos.push({ regla: 'ascii-linea-base', donde: 'tools/ascii-baseline.json', detalle: linea.reason });
  const topes = linea.datos.ficheros ?? {};

  const medido = {};
  for (const rel of vigilados) {
    const p = join(raiz, rel);
    if (existsSync(p)) medido[rel] = cuenta(readFileSync(p, 'utf8'));
  }

  // 1 · deuda nueva por fichero vigilado
  for (const [rel, n] of Object.entries(medido)) {
    const tope = topes[rel] ?? 0;
    if (n > tope) fallos.push({ regla: 'ascii-nuevo', donde: rel, detalle: `${n} caracteres no ASCII, tope ${tope}` });
  }

  // 2 · un fichero vigilado que ya no esta: el renombrado dejo de estar protegido
  for (const rel of Object.keys(topes)) {
    if (!existsSync(join(raiz, rel))) {
      fallos.push({ regla: 'ascii-ausente', donde: rel, detalle: 'la linea base lo vigila y ya no existe' });
    }
  }

  // 3 · inventario: todo lo de primera parte tiene que estar clasificado
  const dePrimera = primeraParte(raiz);
  const clasificados = new Set([...vigilados, ...excluidos.map((e) => e.ruta)]);
  const sinClasificar = dePrimera.filter((rel) => !clasificados.has(rel));
  for (const rel of sinClasificar) {
    const p = join(raiz, rel);
    const n = existsSync(p) ? cuenta(readFileSync(p, 'utf8')) : 0;
    fallos.push({
      regla: 'ascii-sin-clasificar',
      donde: rel,
      detalle: `fichero de primera parte sin clasificar (${n} caracteres no ASCII): anadelo a FICHEROS o a EXCLUIDOS con su motivo`,
    });
  }

  // 4 · una exclusion sin motivo (o con el mismo) es un agujero disfrazado de decision
  for (const { ruta, motivo } of excluidos) {
    if (typeof motivo !== 'string' || motivo.trim().length < MOTIVO_MIN) {
      fallos.push({ regla: 'ascii-excluido-sin-motivo', donde: ruta, detalle: `el motivo tiene que explicar la exclusion (minimo ${MOTIVO_MIN} caracteres)` });
    }
    if (vigilados.includes(ruta)) {
      fallos.push({ regla: 'ascii-excluido-duplicado', donde: ruta, detalle: 'esta vigilado y excluido a la vez' });
    }
  }

  const total = Object.values(medido).reduce((a, b) => a + b, 0);
  const totalBase = Object.keys(medido).reduce((a, rel) => a + (topes[rel] ?? 0), 0);
  return {
    ok: fallos.length === 0,
    fallos,
    medido,
    total,
    totalBase,
    cobertura: {
      primeraParte: dePrimera.length,
      vigilados: Object.keys(medido).length,
      excluidos: excluidos.length,
      sinClasificar,
    },
  };
}

/** Corre como programa (no cuando la prueba lo importa). */
function esEjecutado() {
  const entrada = process.argv[1];
  if (entrada === undefined) return false;
  try {
    return pathToFileURL(resolve(entrada)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (esEjecutado()) {
  const args = process.argv.slice(2);
  const conArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const raiz = resolve(conArg('--root') ?? process.cwd());
  const comoJson = args.includes('--json');
  const actualizar = args.includes('--update');
  const permitirSubida = args.includes('--allow-raise');
  const RUTA_BASE = join(raiz, 'tools', 'ascii-baseline.json');

  if (actualizar) {
    const previa = leerBase(RUTA_BASE);
    const informe = auditar(raiz, { base: previa });
    // Reescribir la linea base con ficheros sin clasificar seria presupuestar un arbol que la puerta no ve.
    if (informe.cobertura.sinClasificar.length > 0) {
      for (const f of informe.fallos.filter((x) => x.regla === 'ascii-sin-clasificar')) {
        process.stdout.write(`FALLO ${f.regla} · ${f.donde} — ${f.detalle}\n`);
      }
      process.stdout.write('\nASCII: no se reescribe la linea base con ficheros de primera parte sin clasificar.\n');
      process.exit(1);
    }
    const subidas = Object.entries(informe.medido)
      .filter(([rel, n]) => previa.datos.ficheros?.[rel] !== undefined && n > previa.datos.ficheros[rel])
      .map(([rel, n]) => ({ rel, antes: previa.datos.ficheros[rel], ahora: n }));
    if (subidas.length > 0 && !permitirSubida) {
      for (const s of subidas) process.stdout.write(`FALLO ascii-tope-sube · ${s.rel} — ${s.antes} -> ${s.ahora}: un tope que sube tapa texto nuevo\n`);
      process.stdout.write('\nASCII: la linea base no sube un tope ya fijado. Corrige el texto, o repite con --allow-raise y dilo.\n');
      process.exit(1);
    }
    for (const s of subidas) process.stdout.write(`AVISO ascii-tope-sube · ${s.rel} — ${s.antes} -> ${s.ahora} (a proposito: --allow-raise)\n`);
    const ficheros = {};
    for (const rel of Object.keys(informe.medido).sort()) ficheros[rel] = informe.medido[rel];
    writeFileSync(RUTA_BASE, `${JSON.stringify({ generado: new Date().toISOString(), ficheros }, null, 2)}\n`, 'utf8');
    process.stdout.write(`ASCII: linea base escrita (${informe.total} caracteres no ASCII en ${Object.keys(ficheros).length} ficheros)\n`);
    process.exit(0);
  }

  const informe = auditar(raiz);
  if (comoJson) {
    process.stdout.write(`${JSON.stringify({ ...informe }, null, 2)}\n`);
  } else if (informe.ok) {
    process.stdout.write(
      `ASCII: en orden (${informe.total} caracteres heredados, tope ${informe.totalBase}; ninguno nuevo)\n`
      + `ASCII: cobertura ${informe.cobertura.vigilados}/${informe.cobertura.primeraParte} ficheros de primera parte`
      + ` · ${informe.cobertura.excluidos} excluidos con motivo\n`,
    );
  } else {
    for (const f of informe.fallos) process.stdout.write(`FALLO ${f.regla} · ${f.donde} — ${f.detalle}\n`);
    process.stdout.write(`\nASCII: ${informe.fallos.length} problema(s) de texto o de inventario\n`);
  }
  process.exit(informe.ok ? 0 : 1);
}
