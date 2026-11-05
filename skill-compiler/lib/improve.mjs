/**
 * improve.mjs - mejorar una skill que ya existe, sin reescribirla a ciegas.
 *
 *  El problema que esto resuelve 
 *
 * `skill_propose` acepta un cuerpo **entero**: quien corrige una skill tiene que devolver todo el texto
 * otra vez, y con el la posibilidad de perder una regla que no estaba mirando. La puerta comprueba el
 * formato, el presupuesto y que las referencias declaradas existan; `promote` compara inventarios al
 * ascender. Pero entre proponer y ascender no habia nada que dijera "esta seccion cambia, esta otra se
 * conserva" - y por eso una actualizacion podia ser mas pobre que la version viva sin que nadie lo viera.
 *
 * Aqui la unidad de cambio es la **seccion**, no el fichero: se lee la version vigente, se aplican
 * parches nombrados, se crean o actualizan referencias, y antes de escribir se comparan los inventarios
 * del conocimiento (encabezados, pasos, rutas, cifras y literales entre backticks) para que lo que
 * desaparece este justificado. La escritura la sigue haciendo `propose`: puerta, cerrojo, base viva,
 * revision y diff. No hay una segunda forma de escribir una propuesta.
 *
 *  Lo que produce 
 *
 * Un informe por ARCHIVO con lo que de verdad paso -`patched`, `written`, `unchanged`- calculado
 * comparando los bytes antes y despues, no de lo que el llamador dijo que iba a hacer.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cuerpoSinTitulo, normalizeRel, propose, vigenteDe } from './compiler.mjs';
import { clasificarPerdidas, inventario, inventarioPerdido } from './repair.mjs';

/** Las operaciones que el llamador puede declarar. El motor las valida contra lo que de verdad cambio. */
export const OPERACIONES = Object.freeze(['new', 'patch', 'enhance', 'write', 'reorganize', 'no_change']);

const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');
const esObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parte el cuerpo en preambulo (lo anterior al primer `##`) y secciones. `seccionesDe` de `repair`
 * descarta el preambulo porque su uso es mover material; aqui no se puede perder.
 */
export function partirCuerpo(cuerpo) {
  const lineas = String(cuerpo ?? '').split('\n');
  const marcas = [];
  lineas.forEach((linea, i) => { if (/^##[^#]/.test(linea)) marcas.push(i); });
  const secciones = marcas.map((desde, k) => {
    const fin = k + 1 < marcas.length ? marcas[k + 1] : lineas.length;
    // La seccion **no** se queda con las lineas en blanco del separador: si las absorbe, un parche que no
    // cambia nada reescribe el espaciado y el diff cuenta lineas que nadie toco.
    let hasta = fin;
    while (hasta > desde + 1 && lineas[hasta - 1].trim() === '') hasta -= 1;
    return { titulo: lineas[desde].replace(/^##\s*/, '').trim(), desde, hasta, texto: lineas.slice(desde, hasta).join('\n') };
  });
  let finPreambulo = marcas.length > 0 ? marcas[0] : lineas.length;
  while (finPreambulo > 0 && lineas[finPreambulo - 1].trim() === '') finPreambulo -= 1;
  return { lineas, preambulo: lineas.slice(0, finPreambulo).join('\n'), secciones };
}

/** El titulo de una seccion, sin el `##` y sin numeracion, para casar "3. Comillas" con "Comillas". */
const claveDeTitulo = (titulo) => String(titulo ?? '')
  .replace(/^#+\s*/, '')
  .replace(/^\d+[.)]\s*/, '')
  .trim()
  .toLowerCase();

/**
 * Aplica los parches por seccion sobre un cuerpo, reemplazando **solo** las lineas de la seccion tocada:
 * lo que no se nombra queda byte a byte como estaba.
 *
 * @returns `{ cuerpo, aplicados: [{titulo, accion}], noEncontrados: [titulo] }`
 */
export function aplicarParches(cuerpo, parches = []) {
  const { lineas, secciones } = partirCuerpo(cuerpo);
  // El espacio en blanco del final se devuelve tal cual estaba: quitarlo cambia el fichero y convierte un
  // parche que no tocaba nada en un diff de una linea.
  const cola = (String(cuerpo ?? '').match(/\s*$/) ?? [''])[0];
  const cambios = new Map();
  const nuevas = [];
  const aplicados = [];
  const noEncontrados = [];
  for (const parche of parches) {
    if (!esObjeto(parche) || typeof parche.contenido !== 'string') continue;
    const clave = claveDeTitulo(parche.seccion ?? '');
    const original = secciones.find((s) => claveDeTitulo(s.titulo) === clave);
    if (original !== undefined) {
      const encabezado = `## ${parche.titulo ?? original.titulo}`;
      const relleno = parche.contenido.replace(/\s+$/, '');
      // Se conserva la linea en blanco que el autor puso **entre** el encabezado y el texto: si el parche no
      // la repone, el diff cuenta como eliminada una linea que nadie quiso tocar.
      const blancoTrasEncabezado = lineas[original.desde + 1] !== undefined && lineas[original.desde + 1].trim() === '';
      const reemplazo = [
        encabezado,
        ...(blancoTrasEncabezado && relleno.length > 0 ? [''] : []),
        ...(relleno.length > 0 ? relleno.split('\n') : []),
      ];
      const igual = reemplazo.join('\n') === original.texto;
      aplicados.push({ titulo: original.titulo, accion: igual ? 'unchanged' : 'patched' });
      if (!igual) cambios.set(original.desde, { hasta: original.hasta, reemplazo });
      continue;
    }
    if (parche.nuevaAqui === true && typeof parche.titulo === 'string' && parche.titulo.trim().length > 0) {
      const relleno = parche.contenido.replace(/\s+$/, '');
      nuevas.push({
        titulo: parche.titulo.trim(),
        bloque: [`## ${parche.titulo.trim()}`, ...(relleno.length > 0 ? relleno.split('\n') : [])],
        despuesDe: parche.despuesDe ?? null,
      });
      aplicados.push({ titulo: parche.titulo.trim(), accion: 'written' });
      continue;
    }
    noEncontrados.push(parche.seccion ?? '(sin seccion)');
  }

  const salida = [];
  for (let i = 0; i < lineas.length;) {
    const cambio = cambios.get(i);
    if (cambio !== undefined) {
      salida.push(...cambio.reemplazo);
      i = cambio.hasta;
      continue;
    }
    salida.push(lineas[i]);
    i += 1;
  }
  let cuerpoFinal = `${salida.join('\n').replace(/\s+$/, '')}${cola}`;
  for (const nueva of nuevas) {
    const partes = partirCuerpo(cuerpoFinal);
    const ancla = nueva.despuesDe === null ? undefined : partes.secciones.find((s) => claveDeTitulo(s.titulo) === claveDeTitulo(nueva.despuesDe));
    if (ancla === undefined) {
      cuerpoFinal = `${cuerpoFinal}\n\n${nueva.bloque.join('\n')}`;
      continue;
    }
    const ls = cuerpoFinal.split('\n');
    const fin = ancla.hasta;
    cuerpoFinal = [...ls.slice(0, fin), '', ...nueva.bloque, ...ls.slice(fin)].join('\n').replace(/\n{3,}/g, '\n\n');
  }
  return { cuerpo: cuerpoFinal, aplicados, noEncontrados };
}

/**
 * Los campos del frontmatter que una mejora de contenido puede tocar. El resto (id, identidad,
 * procedencia, ambito y estado) lo administra el sistema.
 */
export const CAMPOS_DE_FRONTMATTER = Object.freeze(['description', 'whenToUse']);

/**
 * Informe por archivo: que se toco de verdad.
 *
 * @param antes - `{ 'SKILL.md': texto, 'references/x.md': texto }`
 * @param despues - el mismo mapa con el resultado
 */
export function informeDeArchivos(antes, despues) {
  const lineas = [];
  const cuenta = { patched: 0, written: 0, unchanged: 0 };
  for (const ruta of Object.keys(despues).sort()) {
    const habia = Object.hasOwn(antes, ruta);
    const igual = habia && antes[ruta] === despues[ruta];
    const accion = !habia ? 'written' : igual ? 'unchanged' : 'patched';
    cuenta[accion] += 1;
    lineas.push({ ruta, accion, shaAntes: habia ? sha256(antes[ruta]) : null, shaDespues: sha256(despues[ruta]) });
  }
  for (const ruta of Object.keys(antes).sort()) {
    if (Object.hasOwn(despues, ruta)) continue;
    cuenta.unchanged += 1;
    lineas.push({ ruta, accion: 'unchanged', shaAntes: sha256(antes[ruta]), shaDespues: sha256(antes[ruta]) });
  }
  return { lineas, cuenta };
}

/**
 * Prepara una mejora de una skill viva como propuesta candidata. La version activa **no se toca**:
 * el resultado vive en `proposed/` hasta que un humano decida.
 *
 * @param input - `{ id, operacion, motivo, evidencia, parches, referencias, retirarSecciones,
 *   perdidasJustificadas, revision, description, whenToUse, tags }`
 */
export function mejorar(input, { root, key, cwd = null, curated = null, now = new Date().toISOString() } = {}) {
  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  if (id.length === 0) return { status: 'invalid', errors: ['falta el id de la skill que se quiere mejorar'] };
  const operacion = String(input?.operacion ?? '').trim();
  if (!OPERACIONES.includes(operacion)) {
    return { status: 'invalid', errors: [`"${operacion || '(vacia)'}" no es una operacion: ${OPERACIONES.join(', ')}`] };
  }
  const base = vigenteDe(id, key, { root, ...(curated ? { curated } : {}) });
  if (base === null) {
    return { status: 'no-base', id, errors: [`no hay ninguna version viva de "${id}" en ${key}: una mejora necesita algo que mejorar`] };
  }

  // Una referencia mal declarada NO se ignora: si el llamador se equivoca de clave, sin esto la operacion
  // acabaria en un `no_change` silencioso y el conocimiento que traia se perderia sin rastro.
  const declaradas = Array.isArray(input?.referencias) ? input.referencias : [];
  const malDeclaradas = declaradas.filter((r) => !esObjeto(r) || typeof r.path !== 'string' || typeof r.content !== 'string');
  if (malDeclaradas.length > 0) {
    return {
      status: 'invalid', id,
      errors: [`${malDeclaradas.length} referencia(s) mal declaradas: cada una necesita "path" y "content" como cadenas (ruta relativa bajo references/)`],
    };
  }

  //  Lo que hay hoy, medido 
  // La descripcion y el disparador no se reescriben por gusto: si la mejora no los cambia, se conservan
  // los de la version viva, que son parte del contrato con el modelo (y `propose` los exige).
  let metaBase = {};
  try {
    metaBase = JSON.parse(readFileSync(join(base.dir, 'meta.json'), 'utf8'));
  } catch { /* sin meta legible la propuesta sigue con lo que traiga el llamador */ }
  const antes = { 'SKILL.md': base.body };
  for (const ref of base.references ?? []) {
    const ruta = join(base.dir, ref.path);
    if (existsSync(ruta)) antes[normalizeRel(ref.path)] = readFileSync(ruta, 'utf8');
  }

  //  Los parches 
  const { cuerpo, aplicados, noEncontrados } = aplicarParches(base.body, input?.parches ?? []);
  if (noEncontrados.length > 0) {
    return {
      status: 'invalid', id,
      errors: [`no se encontro la seccion ${noEncontrados.map((t) => `"${t}"`).join(', ')} en "${id}": escribe "nuevaAqui: true" si de verdad es nueva, o el titulo exacto de la que quieres cambiar`],
    };
  }

  // Una seccion retirada a proposito tambien es un cambio: se quita del cuerpo y se justifica abajo.
  const retiradas = Array.isArray(input?.retirarSecciones) ? input.retirarSecciones.map(String) : [];
  let cuerpoFinal = cuerpo;
  if (retiradas.length > 0) {
    const corte = partirCuerpo(cuerpo);
    const quitar = corte.secciones.filter((s) => retiradas.some((t) => claveDeTitulo(t) === claveDeTitulo(s.titulo)));
    if (quitar.length === 0) {
      return { status: 'invalid', id, errors: [`ninguna de las secciones a retirar existe en "${id}": ${retiradas.join(', ')}`] };
    }
    const fuera = new Set();
    for (const seccion of quitar) for (let i = seccion.desde; i < seccion.hasta; i += 1) fuera.add(i);
    cuerpoFinal = cuerpo.split('\n')
      .filter((_, i) => !fuera.has(i))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/, '');
  }

  //  El frontmatter: solo lo que el contrato deja tocar
  // `description` y `whenToUse` son contenido de la skill. Todo lo demas -id, identidad, procedencia,
  // ambito y estado- lo administra el sistema: una mejora de contenido no puede cambiarlo ni por descuido.
  const frontmatter = input?.frontmatter ?? null;
  if (frontmatter !== null) {
    if (!esObjeto(frontmatter)) {
      return { status: 'invalid', id, errors: ['"frontmatter" tiene que ser un objeto con los campos a cambiar'] };
    }
    const noPermitidos = Object.keys(frontmatter).filter((campo) => !CAMPOS_DE_FRONTMATTER.includes(campo));
    if (noPermitidos.length > 0) {
      return {
        status: 'invalid', id,
        errors: [`el frontmatter solo admite ${CAMPOS_DE_FRONTMATTER.join(' y ')}: ${noPermitidos.join(', ')} ${noPermitidos.length === 1 ? 'es un campo administrado por el sistema' : 'son campos administrados por el sistema'} (identidad, procedencia, ambito y estado no los cambia una mejora de contenido)`],
      };
    }
    for (const campo of Object.keys(frontmatter)) {
      const valor = frontmatter[campo];
      if (typeof valor !== 'string' || valor.trim().length === 0) {
        return { status: 'invalid', id, errors: [`"${campo}" tiene que ser texto con contenido`] };
      }
      if (/[\r\n]/.test(valor)) {
        return { status: 'invalid', id, errors: [`"${campo}" tiene que ser una sola linea: el frontmatter no admite saltos`] };
      }
    }
  }
  const descripcionFinal = frontmatter?.description ?? input?.description ?? metaBase.description;
  const whenToUseFinal = frontmatter?.whenToUse ?? input?.whenToUse ?? metaBase.whenToUse;

  //  Las referencias: crear o actualizar 
  const referencias = (Array.isArray(input?.referencias) ? input.referencias : [])
    .filter((r) => esObjeto(r) && typeof r.path === 'string' && typeof r.content === 'string')
    .map((r) => ({ path: normalizeRel(r.path), content: r.content }));
  const despues = { 'SKILL.md': cuerpoFinal };
  for (const [ruta, texto] of Object.entries(antes)) if (ruta !== 'SKILL.md') despues[ruta] = texto;
  for (const ref of referencias) despues[ref.path] = ref.content;

  // Al informe solo entra el `meta.json` si el frontmatter CAMBIA: se reescribe en cada propuesta (por el
  // `createdAt`), asi que declararlo `unchanged` siempre seria ruido, y declararlo `patched` siempre seria
  // mentira. Lo que importa es si `description` o `whenToUse` se tocaron.
  const metaAntes = JSON.stringify({ description: metaBase.description ?? '', whenToUse: metaBase.whenToUse ?? '' });
  const metaDespues = JSON.stringify({ description: descripcionFinal ?? '', whenToUse: whenToUseFinal ?? '' });
  const informe = informeDeArchivos(antes, despues);
  if (metaAntes !== metaDespues) {
    informe.lineas.push({
      ruta: 'meta.json',
      accion: 'patched',
      shaAntes: createHash('sha256').update(metaAntes).digest('hex'),
      shaDespues: createHash('sha256').update(metaDespues).digest('hex'),
    });
    informe.cuenta.patched += 1;
  }

  //  Cambio algo? 
  if (informe.cuenta.patched === 0 && informe.cuenta.written === 0) {
    return {
      status: 'no_change', id, operacion: 'no_change',
      reason: 'no se encontro ninguna mejora que justificara escribir: el cuerpo y las referencias quedan igual',
      informe, aplicados,
    };
  }
  if (operacion === 'no_change') {
    return { status: 'invalid', id, errors: ['declaraste "no_change" pero hay archivos que cambiarian: elige la operacion que corresponde o no envies parches'] };
  }

  //  Conservacion del conocimiento 
  // Se mide sobre el cuerpo **y** las referencias, porque mover una regla a `references/` no es perderla.
  const textoAntes = [antes['SKILL.md'], ...Object.entries(antes).filter(([r]) => r !== 'SKILL.md').map(([, t]) => t)].join('\n');
  const textoDespues = [cuerpoFinal, ...Object.entries(despues).filter(([r]) => r !== 'SKILL.md').map(([, t]) => t)].join('\n');
  const invAntes = inventario(cuerpoSinTitulo(textoAntes));
  const invDespues = inventario(cuerpoSinTitulo(textoDespues));
  const perdido = inventarioPerdido(invAntes, invDespues);
  const clasificacion = clasificarPerdidas(cuerpoSinTitulo(textoAntes), cuerpoSinTitulo(textoDespues));
  const justificadas = Array.isArray(input?.perdidasJustificadas) ? input.perdidasJustificadas.map(String) : [];
  const sinJustificar = {};
  for (const [categoria, faltan] of Object.entries(perdido)) {
    const quedan = faltan.filter((x) => !justificadas.some((j) => j.trim().length > 0 && (x.includes(j) || j.includes(x))));
    if (quedan.length > 0) sinJustificar[categoria] = quedan;
  }
  const totalPerdidas = Object.values(perdido).reduce((n, l) => n + l.length, 0);
  const totalSinJustificar = Object.values(sinJustificar).reduce((n, l) => n + l.length, 0);
  if (totalSinJustificar > 0) {
    const detalle = Object.entries(sinJustificar).map(([c, l]) => `${c}: ${l.slice(0, 6).join(' - ')}`).join(' | ');
    return {
      status: 'invalid', id, operacion,
      errors: [`la mejora perderia ${totalSinJustificar} elemento(s) de la version viva sin justificar - ${detalle}. Conservalos en el cuerpo o en una referencia, o declara la perdida en "perdidasJustificadas" con su motivo`],
      perdido: sinJustificar,
    };
  }

  //  La escritura: la misma puerta de siempre 
  // Se le pasan **todas** las referencias resultantes, no solo las que cambiaron: el cuerpo las declara y la
  // puerta comprueba que cada vinculo tenga su fichero. Pasar solo el delta marcaba como roto un vinculo que
  // ya existia y no se habia tocado.
  const referenciasParaLaPuerta = Object.entries(despues)
    .filter(([ruta]) => ruta !== 'SKILL.md')
    .map(([path, content]) => ({ path, content }));
  const propuesta = propose(
    {
      id,
      description: descripcionFinal,
      whenToUse: whenToUseFinal,
      tags: input.tags ?? metaBase.tags,
      body: cuerpoFinal,
      evidence: Array.isArray(input.evidencia) ? input.evidencia : [],
      revision: input.revision,
    },
    { root, key, ...(cwd ? { cwd } : {}), ...(curated ? { curated } : {}), references: referenciasParaLaPuerta, now },
  );
  if (propuesta.status !== 'proposed') return { status: propuesta.status, id, operacion, errors: propuesta.errors ?? [], errores: propuesta.errors ?? [], propuesta };

  const resumen = {
    revisadas: 1,
    mejoradas: 1,
    parcheados: informe.cuenta.patched,
    escritos: informe.cuenta.written,
    sinCambios: informe.cuenta.unchanged,
    reglasAntes: invAntes.reglas.length,
    reglasDespues: invDespues.reglas.length,
    conservadas: clasificacion.resumen.conservadas,
    reubicadas: clasificacion.resumen.reubicadas,
    reformuladas: clasificacion.resumen.reformuladas,
    inciertas: clasificacion.resumen.inciertas,
    perdidas: totalPerdidas,
    perdidasJustificadas: totalPerdidas - totalSinJustificar,
  };
  return {
    status: 'proposed',
    id,
    operacion,
    projectKey: propuesta.projectKey,
    estadoAnterior: base.state,
    estadoPropuesto: 'proposed',
    hashAnterior: base.hash,
    sha256: propuesta.sha256,
    superseded: propuesta.superseded ?? null,
    base: propuesta.base,
    diff: propuesta.diff,
    informe,
    aplicados,
    conservacion: { perdido, sinJustificar, inventarioAntes: invAntes, inventarioDespues: invDespues },
    resumen,
    propuesta,
  };
}

/**
 * Texto del informe, tal y como se ensena: el titulo, una linea por archivo con lo que **de verdad**
 * paso, y el cierre con las cuentas de las operaciones.
 */
export function textoDelInforme(resultado) {
  const lineas = ['Self-improvement review'];
  for (const f of resultado?.informe?.lineas ?? []) {
    lineas.push(`  Skill '${resultado.id}' ${f.accion} (${f.ruta})`);
  }
  lineas.push('');

  // Un `no_change` y un `invalid` tambien se informan: sin esto el camino normal de "no hay nada que
  // justifique escribir" reventaba al pedir el resumen, y el llamador se quedaba sin informe ni motivo.
  if (resultado?.status !== 'proposed') {
    if (resultado?.status === 'no_change') {
      lineas.push('- 1 skill reviewed.');
      lineas.push('- 0 skill enhanced.');
      lineas.push('- 0 file(s) patched.');
      lineas.push('- 0 reference(s) written.');
      lineas.push(`- ${resultado?.informe?.cuenta?.unchanged ?? 0} file(s) unchanged.`);
      lineas.push(`- No change: ${resultado.reason ?? 'nothing to justify a write'}.`);
      lineas.push('- Revision: nothing to approve.');
      return lineas.join('\n');
    }
    lineas.push(`- Validation: FAIL (${resultado?.status ?? 'unknown'}).`);
    for (const error of resultado?.errors ?? ['no detail available']) lineas.push(`- ${error}`);
    return lineas.join('\n');
  }

  const r = resultado.resumen;
  lineas.push(`- ${r.revisadas} skill reviewed.`);
  lineas.push(`- ${r.mejoradas} skill ${resultado.operacion === 'enhance' || resultado.operacion === 'reorganize' ? 'enhanced' : 'patched'}.`);
  lineas.push(`- ${r.parcheados} file(s) patched.`);
  lineas.push(`- ${r.escritos} reference(s) written.`);
  lineas.push(`- ${r.sinCambios} file(s) unchanged.`);
  if (resultado.superseded) lineas.push(`- Previous proposal archived (superseded/proposals/${resultado.id}/${resultado.superseded.revision}).`);
  lineas.push(`- ${r.reglasDespues} rules reviewed, ${r.conservadas} preserved${r.reubicadas ? `, ${r.reubicadas} moved` : ''}${r.reformuladas ? `, ${r.reformuladas} reworded` : ''}.`);
  lineas.push(`- ${r.perdidas} confirmed loss(es)${r.perdidasJustificadas ? ` (${r.perdidasJustificadas} justified)` : ''}.`);
  if (r.inciertas > 0) lineas.push(`- ${r.inciertas} uncertain item(s): no se pueden juzgar con esta lectura, ni perdidos ni conservados.`);
  lineas.push('- Validation: PASS.');
  lineas.push('- Revision: awaiting approval.');
  return lineas.join('\n');
}
