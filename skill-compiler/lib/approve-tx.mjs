/**
 * approve-tx.mjs - la aprobacion como transaccion con intencion en disco.
 *
 *  Por que existe 
 *
 * Aprobar una actualizacion mueve dos paquetes (la version viva a `superseded/` y la propuesta a su
 * sitio) y escribe en el diario. Con dos `rename` sueltos, un fallo en el segundo deja la skill **sin
 * version servida** y la anterior aparcada, y un cierre del proceso entre ambos deja el almacen en un
 * estado que nadie sabe reconstruir. Esto no es un `try/catch` alrededor de dos renombrados: es una
 * intencion escrita ANTES de tocar nada, con el plan completo, que permite reconstruir el estado
 * mirando el disco en cualquier momento.
 *
 *  La regla 
 *
 *   1. Se escribe la intencion (`projects/<key>/.tx/<tx>.json`) con TODO lo que se va a mover.
 *   2. Se archiva la version viva (paquete entero) con su manifiesto de hashes.
 *   3. Se instala la candidata.
 *   4. Se verifica que lo instalado es EXACTAMENTE lo validado.
 *   5. Se anota en el diario y se comprueba que el asiento esta.
 *   6. Se borra la intencion.
 *
 * Si algo falla entre 2 y 5, se deshace en orden inverso y se devuelve el motivo con lo que no se pudo
 * deshacer. La recuperacion (`recuperarTransacciones`) no se fia de la fase anotada: mira **donde esta
 * cada paquete** y decide. Asi un corte de corriente en cualquier punto tiene una salida determinista.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { treeOf } from './compiler.mjs';
import { anotarEntradaEnDiario, huellaDeContenido, leerDiario } from './security.mjs';

/** Donde vive la intencion de una transaccion, fuera de los estados de las skills. */
export const carpetaDeTransacciones = (root, key) => join(root, 'projects', key, '.tx');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Los ficheros de un paquete con su hash y sus bytes, en orden estable. */
export function manifiestoDePaquete(dir) {
  if (!existsSync(dir)) return { files: [], packageHash: null };
  const files = treeOf(dir).files.map((ruta) => {
    const buf = readFileSync(join(dir, ruta));
    return { path: ruta, bytes: buf.length, sha256: sha(buf) };
  });
  const packageHash = sha(Buffer.from(files.map((f) => `${f.path}:${f.sha256}`).join('\n')));
  return { files, packageHash };
}

const escribirJson = (ruta, datos) => {
  mkdirSync(dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp-${randomUUID().slice(0, 8)}`;
  writeFileSync(tmp, `${JSON.stringify(datos, null, 2)}\n`);
  rmSync(ruta, { force: true });
  renameSync(tmp, ruta);
};

/** Las transacciones que quedaron en disco (una por operacion no confirmada). */
export function transaccionesPendientes({ root, key }) {
  const carpeta = carpetaDeTransacciones(root, key);
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => {
      try { return JSON.parse(readFileSync(join(carpeta, n), 'utf8')); } catch { return { tx: n.replace(/\.json$/, ''), ilegible: true }; }
    });
}

const borrarTransaccion = (root, key, tx) => rmSync(join(carpetaDeTransacciones(root, key), `${tx}.json`), { force: true });

/**
 * Deshace lo que la intencion diga que se movio, mirando el disco.
 *
 * @returns `{ deshecho, problemas }` - los problemas NO se ocultan: si un paquete no se pudo devolver,
 *   el llamador tiene que saberlo y el asiento queda para revision manual.
 */
function revertir(tx) {
  const problemas = [];
  let deshecho = 0;
  // 1) La candidata instalada vuelve a `proposed/` (si llego a instalarse).
  if (existsSync(tx.destino) && !existsSync(tx.origen)) {
    try {
      mkdirSync(dirname(tx.origen), { recursive: true });
      renameSync(tx.destino, tx.origen);
      deshecho += 1;
    } catch (error) {
      problemas.push(`no se pudo devolver la candidata a proposed/: ${error.code ?? error.message}`);
    }
  }
  // 2) Lo archivado vuelve a su estado original, en orden inverso.
  for (const apartado of [...(tx.apartados ?? [])].reverse()) {
    if (!existsSync(apartado.hasta)) continue;
    try {
      mkdirSync(dirname(apartado.desde), { recursive: true });
      renameSync(apartado.hasta, apartado.desde);
      rmSync(apartado.manifiesto, { force: true });
      deshecho += 1;
    } catch (error) {
      problemas.push(`no se pudo devolver ${apartado.hasta} a ${apartado.desde}: ${error.code ?? error.message}`);
    }
  }
  return { deshecho, problemas };
}

/**
 * Aprueba una propuesta como una transaccion. No publica nada y no toca otros ids.
 *
 * @param opciones.esperada - huella de contenido que se valido; si no coincide, no se mueve nada.
 * @param opciones.estado - `approved` (normal) o `disabled` (corregir sin encender).
 * @param opciones.diario - ruta del `journal.jsonl` (por defecto la del proyecto).
 * @param opciones.nota - motivo que viaja al manifiesto y al diario.
 * @returns `{ ok, path?, superseded?, manifiesto?, tx, error?, problemas? }`
 */
export function ejecutarAprobacion({
  root, key, id, esperada = null, estado = 'approved', scope = 'project', diario = null, nota = 'aprobacion humana', por = 'humano', canal = 'comando', avisos = null, now = new Date().toISOString(), hooks = null,
} = {}) {
  // Puntos de inyeccion para las pruebas: `hooks.fallar = '<punto>'` lanza un fallo controlado (se
  // revierte) y `hooks.interrumpir = '<punto>'` simula un cierre del proceso (se deja la intencion en
  // disco, SIN revertir, para que la recuperacion tenga algo que reconstruir). Sin hooks no existen.
  const punto = (nombre) => {
    if (hooks?.fallar === nombre) throw Object.assign(new Error(`fallo simulado en ${nombre}`), { simulado: true });
    if (hooks?.interrumpir === nombre) throw Object.assign(new Error(`interrupcion simulada en ${nombre}`), { interrumpida: true });
  };
  const base = join(root, 'projects', key);
  const origen = join(base, 'proposed', id);
  const destino = join(base, estado === 'disabled' ? 'disabled' : 'approved', id);
  const rutaDiario = diario ?? join(base, 'journal.jsonl');
  const tx = `${id}-${now.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;

  if (!existsSync(origen)) return { ok: false, tx, error: `no existe proposed/${id} en ${key}` };
  const huellaOrigen = huellaDeContenido(origen);
  if (esperada !== null && huellaOrigen !== esperada) {
    return { ok: false, tx, error: `el contenido cambio despues de validarse: se esperaba ${String(esperada).slice(0, 12)} y hay ${huellaOrigen.slice(0, 12)} - no se movio nada` };
  }

  // Todos los estados del mismo id que hay que apartar: el destino (si existe) y los otros vivos.
  const aApartar = [];
  const candidatos = [destino, join(base, 'approved', id), join(base, 'disabled', id), join(base, 'proposed', id)];
  const vistos = new Set();
  for (const dir of candidatos) {
    if (dir === origen || vistos.has(dir) || !existsSync(dir)) continue;
    vistos.add(dir);
    const etiqueta = dir === destino ? '' : `-${dir.split(/[\\/]/).slice(-2)[0]}`;
    const revision = `${id}${etiqueta}-${now.replace(/[:.]/g, '-')}`;
    aApartar.push({ desde: dir, hasta: join(base, 'superseded', revision), manifiesto: join(base, 'superseded', `${revision}.json`), revision });
  }

  const intencion = {
    tx, id, key, scope, estado, origen, destino, esperada: huellaOrigen, at: now, nota,
    apartados: aApartar, fase: 'intent', nuevo: null, por, canal,
  };

  // 1) La intencion, ANTES de tocar nada.
  try {
    escribirJson(join(carpetaDeTransacciones(root, key), `${tx}.json`), intencion);
    punto('intent');
  } catch (error) {
    if (error.interrumpida) return { ok: false, tx, interrumpida: true, error: error.message, problemas: [] };
    return { ok: false, tx, error: `no se pudo registrar la intencion de la aprobacion: ${error.code ?? error.message}` };
  }

  // 2) Archivar la version viva, con su manifiesto.
  const archivados = [];
  for (const apartado of aApartar) {
    try {
      mkdirSync(dirname(apartado.hasta), { recursive: true });
      const paquete = manifiestoDePaquete(apartado.desde);
      renameSync(apartado.desde, apartado.hasta);
      punto('manifest');
      escribirJson(apartado.manifiesto, {
        id,
        projectKey: key,
        scope,
        revision: apartado.revision,
        archivedAt: now,
        reason: nota,
        from: apartado.desde.split(/[\\/]/).slice(-2)[0],
        previousHash: paquete.packageHash,
        replacedBy: { hash: huellaOrigen, revision: null },
        files: paquete.files,
        packageHash: paquete.packageHash,
      });
      archivados.push({ ...apartado, paquete });
      punto('archived');
    } catch (error) {
      if (error.interrumpida) {
        escribirJson(join(carpetaDeTransacciones(root, key), `${tx}.json`), { ...intencion, fase: 'archived', apartados: archivados });
        return { ok: false, tx, interrumpida: true, error: error.message, problemas: [] };
      }
      // Se deshace lo que ya se archivo, **incluido el paquete en curso**: si lo que fallo fue el
      // manifiesto, el rename ya se hizo y sin esto el paquete se queda en superseded/ sin devolver.
      // `revertir` ignora los que no llegaron a moverse, asi que anadirlo siempre es seguro.
      const vuelta = revertir({ ...intencion, apartados: [...archivados, apartado] });
      borrarTransaccion(root, key, tx);
      return {
        ok: false, tx,
        error: `no se pudo archivar la version anterior: ${error.code ?? error.message}`,
        problemas: vuelta.problemas,
      };
    }
  }

  // 3) Instalar la candidata.
  try {
    intencion.fase = 'archived';
    escribirJson(join(carpetaDeTransacciones(root, key), `${tx}.json`), intencion);
    mkdirSync(dirname(destino), { recursive: true });
    renameSync(origen, destino);
    punto('installed');
  } catch (error) {
    if (error.interrumpida) {
      escribirJson(join(carpetaDeTransacciones(root, key), `${tx}.json`), { ...intencion, fase: 'installed' });
      return { ok: false, tx, interrumpida: true, error: error.message, problemas: [] };
    }
    const vuelta = revertir(intencion);
    borrarTransaccion(root, key, tx);
    return { ok: false, tx, error: `no se pudo instalar la nueva version: ${error.code ?? error.message}`, problemas: vuelta.problemas };
  }

  // Punto de inyeccion para la prueba de "lo instalado no coincide": se toca el destino despues de
  // instalarlo y antes de verificar. Sin hook no existe.
  if (hooks?.trasInstalar) hooks.trasInstalar({ tx, destino });

  // 4) Verificar que lo instalado es lo validado.
  const huellaInstalada = huellaDeContenido(destino);
  if (huellaInstalada !== huellaOrigen) {
    const vuelta = revertir(intencion);
    borrarTransaccion(root, key, tx);
    return {
      ok: false, tx,
      error: `lo instalado no coincide con lo validado: se esperaba ${huellaOrigen.slice(0, 12)} y hay ${huellaInstalada.slice(0, 12)}`,
      problemas: vuelta.problemas,
    };
  }

  // 5) El diario forma parte de la operacion: sin asiento no hay aprobacion.
  intencion.fase = 'installed';
  intencion.nuevo = huellaInstalada;
  try {
    escribirJson(join(carpetaDeTransacciones(root, key), `${tx}.json`), intencion);
  } catch { /* la intencion ya existe; no impide seguir */ }
  try { punto('journal'); } catch (error) {
    if (error.interrumpida) {
      escribirJson(join(carpetaDeTransacciones(root, key), `${tx}.json`), { ...intencion, fase: 'installed' });
      return { ok: false, tx, interrumpida: true, error: error.message, problemas: [] };
    }
    const vuelta = revertir(intencion);
    borrarTransaccion(root, key, tx);
    return { ok: false, tx, error: `fallo antes de anotar el diario: ${error.message}`, problemas: vuelta.problemas };
  }
  const anotado = anotarEntradaEnDiario(rutaDiario, {
    id,
    key,
    tx,
    decision: scope === 'global' ? 'publicada' : (estado === 'disabled' ? 'actualizada-apagada' : 'aprobada'),
    ambito: scope,
    por,
    canal,
    avisos: avisos ?? [],
    hashAnterior: huellaOrigen,
    hashResultante: huellaInstalada,
    superseded: archivados.length > 0 ? archivados[0].hasta : null,
    nota,
  }, { now });
  const asiento = anotado
    ? leerDiario(rutaDiario).entradas.filter((e) => e?.tx === tx)
    : [];
  if (!anotado || asiento.length !== 1 || typeof asiento[0].huella !== 'string') {
    const vuelta = revertir(intencion);
    borrarTransaccion(root, key, tx);
    return {
      ok: false, tx,
      error: 'no se pudo dejar constancia de la aprobacion en el diario: la operacion se deshizo',
      problemas: vuelta.problemas,
    };
  }

  // 6) Confirmar: la intencion se borra cuando todo esta verificado.
  borrarTransaccion(root, key, tx);
  return {
    ok: true,
    tx,
    path: join(destino, 'SKILL.md'),
    superseded: archivados.length > 0 ? archivados[0].hasta : null,
    manifiesto: archivados.length > 0 ? archivados[0].manifiesto : null,
    archivados: archivados.map((a) => ({ revision: a.revision, hasta: a.hasta, manifiesto: a.manifiesto, packageHash: a.paquete.packageHash })),
    nuevo: huellaInstalada,
  };
}

/**
 * Reconstruye las operaciones que quedaron a medias. No se fia de la fase: mira donde esta cada paquete.
 *
 *   - la candidata sigue en `proposed/`  -> la instalacion no ocurrio: se devuelven los archivados;
 *   - la candidata esta instalada        -> si su huella coincide con la validada, se completa el asiento
 *                                           que falte; si no, se revierte.
 *
 * @returns `{ revisadas, completadas, revertidas, incompletas, detalles }`.
 */
export function recuperarTransacciones({ root, key, diario = null } = {}) {
  const rutaDiario = diario ?? join(root, 'projects', key, 'journal.jsonl');
  const detalles = [];
  let completadas = 0;
  let revertidas = 0;
  let incompletas = 0;

  for (const tx of transaccionesPendientes({ root, key })) {
    if (tx.ilegible) {
      incompletas += 1;
      detalles.push({ tx: tx.tx, estado: 'ilegible', accion: 'revisar a mano' });
      continue;
    }
    const enOrigen = existsSync(tx.origen);
    const enDestino = existsSync(tx.destino);
    // Si el paquete apartado no esta ni donde estaba ni donde se archivo, se ha perdido algo: la transaccion
    // no se puede cerrar ni dando la aprobacion por buena ni revirtiendo. Se deja y se declara.
    const perdidos = (tx.apartados ?? []).filter((a) => !existsSync(a.desde) && !existsSync(a.hasta));
    if (perdidos.length > 0) {
      incompletas += 1;
      detalles.push({
        tx: tx.tx, estado: 'paquete anterior perdido', accion: 'revisar a mano',
        problemas: perdidos.map((a) => `no esta ni en ${a.desde} ni en ${a.hasta}`),
      });
      continue;
    }
    if (enOrigen) {
      const vuelta = revertir(tx);
      if (vuelta.problemas.length > 0) {
        incompletas += 1;
        detalles.push({ tx: tx.tx, estado: 'no instalada', accion: 'reversion incompleta', problemas: vuelta.problemas });
        continue;
      }
      borrarTransaccion(root, key, tx.tx);
      revertidas += 1;
      detalles.push({ tx: tx.tx, estado: 'no instalada', accion: 'revertida' });
      continue;
    }
    if (!enDestino) {
      incompletas += 1;
      detalles.push({ tx: tx.tx, estado: 'sin candidata ni version activa', accion: 'revisar a mano' });
      continue;
    }
    const actual = huellaDeContenido(tx.destino);
    if (tx.esperada && actual !== tx.esperada) {
      const vuelta = revertir(tx);
      if (vuelta.problemas.length > 0) {
        incompletas += 1;
        detalles.push({ tx: tx.tx, estado: 'instalada distinta', accion: 'reversion incompleta', problemas: vuelta.problemas });
        continue;
      }
      borrarTransaccion(root, key, tx.tx);
      revertidas += 1;
      detalles.push({ tx: tx.tx, estado: 'instalada distinta', accion: 'revertida' });
      continue;
    }
    // Instalada y coincide: falta el asiento.
    const yaEsta = leerDiario(rutaDiario).entradas.some((e) => e?.tx === tx.tx);
    if (!yaEsta) {
      const anotado = anotarEntradaEnDiario(rutaDiario, {
        id: tx.id, key: tx.key, tx: tx.tx, decision: tx.estado === 'disabled' ? 'actualizada-apagada' : 'aprobada',
        ambito: tx.scope, por: tx.por ?? 'humano', canal: 'recuperacion', hashAnterior: tx.esperada, hashResultante: actual,
        superseded: (tx.apartados ?? [])[0]?.hasta ?? null, avisos: [], nota: `${tx.nota} (recuperada)`,
      }, { now: new Date().toISOString() });
      if (!anotado) {
        incompletas += 1;
        detalles.push({ tx: tx.tx, estado: 'instalada', accion: 'no se pudo anotar el asiento' });
        continue;
      }
    }
    borrarTransaccion(root, key, tx.tx);
    completadas += 1;
    detalles.push({ tx: tx.tx, estado: 'instalada', accion: yaEsta ? 'confirmada' : 'asiento completado' });
  }

  return { revisadas: detalles.length, completadas, revertidas, incompletas, detalles };
}

/**
 * Diagnostico de solo lectura: que transacciones quedaron a medias y en que estado fisico esta cada una.
 *
 * No escribe nada y no repara nada: `recuperarTransacciones` es el unico que mueve paquetes. Esto existe
 * para que `doctor` pueda decirlo antes de que alguien apruebe: una intencion puede quedarse en `.tx/`
 * durante dias si no se vuelve a aprobar nada de ese proyecto.
 *
 * El estado se INFIERE mirando donde estan los paquetes, no de la fase anotada: una fase puede quedar
 * desactualizada si el proceso muere justo despues del movimiento.
 *
 * @returns `{ revisadas, pendientes: [{ tx, id, estado, recuperable, problemas }], inconsistentes: [] }`
 *   estados: `revert` (la candidata sigue en proposed/), `complete` (instalada y coincidente, falta el
 *   asiento), `mismatch` (instalada pero no coincide con lo validado), `inconsistent` (no esta en ninguno
 *   de los dos sitios) e `unreadable` (la intencion no se puede leer).
 */
export function diagnosticarTransacciones({ root, key } = {}) {
  const pendientes = [];
  const inconsistentes = [];
  const fichas = transaccionesPendientes({ root, key });
  for (const tx of fichas) {
    if (tx.ilegible) {
      const ficha = { tx: tx.tx, id: null, estado: 'unreadable', recuperable: false, problemas: ['la intencion no se puede leer como JSON'] };
      inconsistentes.push(ficha);
      pendientes.push(ficha);
      continue;
    }
    const problemas = [];
    for (const apartado of tx.apartados ?? []) {
      if (!existsSync(apartado.manifiesto)) problemas.push(`manifiesto ausente: ${apartado.manifiesto}`);
    }
    // Un paquete que no esta ni donde estaba ni donde se aparto no se puede devolver: es una perdida, no un
    // pendiente mas. Se declara inconsistente para que nadie lo trate como "recuperable".
    const perdido = (tx.apartados ?? []).some((a) => !existsSync(a.desde) && !existsSync(a.hasta));
    if (perdido) problemas.push('el paquete anterior no esta ni en su sitio ni en superseded/');
    const enOrigen = existsSync(tx.origen);
    const enDestino = existsSync(tx.destino);
    let estado;
    if (perdido) estado = 'inconsistent';
    else if (enOrigen && !enDestino) estado = 'revert';
    else if (!enOrigen && enDestino) estado = tx.esperada && huellaDeContenido(tx.destino) === tx.esperada ? 'complete' : 'mismatch';
    else if (enOrigen && enDestino) estado = 'inconsistent';
    else estado = 'inconsistent';
    const ficha = { tx: tx.tx, id: tx.id, estado, recuperable: estado !== 'inconsistent' && estado !== 'unreadable', problemas };
    pendientes.push(ficha);
    if (ficha.estado === 'inconsistent') inconsistentes.push(ficha);
  }
  return { revisadas: fichas.length, pendientes, inconsistentes };
}
