/**
 * La auditoría integral del almacén: **solo lectura, reproducible y sin efectos**.
 *
 * ── Las tres reglas que la definen ──────────────────────────────────────────────────────────────
 *
 * 1. **No escribe nada.** Ni un temporal, ni un fichero de caché, ni un `meta.json` «normalizado». Sólo
 *    `readdirSync`, `statSync` y `readFileSync`. La prueba de `audit.test.mjs` compara la huella del árbol
 *    entero antes y después, así que una escritura —donde sea— se ve.
 * 2. **No se cae.** Un fichero ilegible, una carpeta denegada o un `meta.json` mal formado son hallazgos;
 *    nunca una excepción que deje sin auditar el resto. Perder catorce skills buenas por una mala no es un
 *    informe, es un accidente.
 * 3. **Es reproducible.** El orden sale de la clave de cada skill, no del recorrido del sistema de
 *    archivos, y no viaja ninguna fecha: dos ejecuciones sobre el mismo estado dan el **mismo** informe,
 *    comparables con una igualdad.
 *
 * La puerta de calidad no se reimplementa aquí: cada skill se mide con `auditarCarpeta`, que es lo mismo
 * que aplica la puerta de aprobar. Si la auditoría dijera algo distinto que la puerta, la culpa sería de
 * tener dos implementaciones, no de las skills.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { CARPETA_PROPUESTAS_ARCHIVADAS, auditarCarpeta, curatedLibraryRoot, defaultRoot, isOurs, listProjects } from './compiler.mjs';
import { t } from './i18n/index.mjs';

/**
 * Los estados que **se auditan**: todo lo que puede llegar a servirse o a decidirse.
 *
 * `superseded` no está aquí a propósito. El archivo guarda la versión anterior con el nombre
 * `<id>-<fecha>` —convención del propio archivo— y con el cuerpo que se aprobó entonces. Auditarlo con las
 * reglas de hoy marca el nombre como id inválido y el cuerpo como demasiado largo: errores que no se pueden
 * arreglar sin reescribir la evidencia. Se cuenta aparte y se declara, pero no se mide.
 */
export const ESTADOS_DE_PROYECTO = ['proposed', 'approved', 'disabled', 'rejected', 'published'];

/** Los estados de archivo: evidencia congelada. Se cuentan, no se auditan. */
export const ESTADOS_ARCHIVADOS = ['superseded'];
/** Los estados de la biblioteca curada global: la raíz misma, y sus dos carpetas de retiro. */
export const ESTADOS_GLOBALES = ['global', 'global-disabled'];

/** El archivo de la biblioteca global, por la misma razón que `ESTADOS_ARCHIVADOS`. */
export const ESTADOS_GLOBALES_ARCHIVADOS = ['global-superseded'];

/**
 * Cómo se ordenan y se nombran los estados en el informe. «published» es una constancia archivada de lo
 * que se publicó, así que se dice tal cual y no se llama «aprobada».
 */
export const NOMBRE_DE_ESTADO = {
  proposed: 'propuesta',
  approved: 'aprobada',
  disabled: 'apagada',
  rejected: 'rechazada',
  superseded: 'apartada',
  published: 'publicada',
  global: 'global',
  'global-disabled': 'global apagada',
  'global-superseded': 'global apartada',
};

const aRelativa = (base, ruta) => relative(base, ruta).split(sep).join('/');

/**
 * Subcarpetas de un directorio, sin lanzar: si el directorio no está o no se puede leer, lo dice.
 * @returns `{ nombres, error }`
 */
function subcarpetas(dir) {
  try {
    if (!existsSync(dir)) return { nombres: [], error: null };
    return {
      nombres: readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(),
      error: null,
    };
  } catch (error) {
    return { nombres: [], error: `${error.code ?? error.message}` };
  }
}

/** El estado observable de una skill a partir de sus hallazgos. */
function estadoDe(findings, unreadable) {
  if (unreadable) return 'UNREADABLE';
  if (findings.some((f) => f.severity === 'error')) return 'ERROR';
  if (findings.some((f) => f.severity === 'warn')) return 'WARN';
  return 'PASS';
}

/**
 * Audita **una** skill y devuelve su ficha, con clave estable para poder señalarla después.
 *
 * La clave es `estado/proyecto/id` (por ejemplo `approved/saas-corporative-a1b2c3d4/contratos`). No lleva
 * fecha ni índice de recorrido: la misma skill tiene la misma clave en cualquier máquina y en cualquier
 * orden, que es lo que permite decir «esta» sin ambigüedad.
 */
function ficha(dir, { root, estado, projectKey, id, cwd }) {
  const unica = `${estado}/${projectKey}/${id}`;
  let resultado = null;
  try {
    resultado = auditarCarpeta(dir, { cwd, id });
  } catch (error) {
    // `auditarCarpeta` no debería lanzar; si el entorno se las arregla para que sí, la auditoría entera no
    // se pierde por esta skill.
    resultado = {
      findings: [{
        severity: 'error',
        rule: 'unreadable',
        observed: error.code ?? error.message,
        threshold: null,
        message: `no se pudo auditar: ${error.message}`,
        messageCode: 'finding.unreadable.audit.message',
        messageParams: { detalle: error.message },
        fix: 'Revisa los permisos de esa carpeta',
        fixCode: 'finding.unreadable.folder.fix',
        fixParams: {},
      }],
      unreadable: true,
      medidas: null,
    };
  }
  const findings = resultado.findings ?? [];
  return {
    key: unica,
    estado,
    estadoLegible: NOMBRE_DE_ESTADO[estado] ?? estado,
    projectKey,
    id,
    dir: aRelativa(root, dir),
    status: estadoDe(findings, resultado.unreadable),
    medidas: resultado.medidas ?? null,
    errores: findings.filter((f) => f.severity === 'error').length,
    avisos: findings.filter((f) => f.severity === 'warn').length,
    findings,
  };
}

/**
 * Audita el almacén **entero**: todos los proyectos, todos sus estados, la biblioteca global y la curada.
 *
 * @param root - raíz del almacén (por defecto `$DSH_HOME/skill-compiler`).
 * @param curated - biblioteca curada (por defecto la del harness).
 * @param cwd - proyecto desde el que se audita, para poder comprobar la evidencia declarada.
 * @param estados - si se pasa, sólo se auditan esos estados (filtro de lectura, no cambia el diagnóstico).
 * @returns El informe: totales, desglose por estado, por regla, y una ficha por skill.
 */
export function auditarAlmacen({ root = defaultRoot(), curated = curatedLibraryRoot(), cwd = null, estados = null } = {}) {
  const contenedores = [];
  const fichas = [];
  const quiere = (estado) => estados === null || estados.includes(estado);

  // Cada hallazgo del contenedor lleva su frase cruda (`message`/`fix`, el dato que ya viajaba) y la clave
  // con sus parametros: la representacion se compone al pintar (`fraseDeHallazgo`), en el idioma de la sesion.
  const anotaContenedor = (severity, rule, observado, prosa) => {
    contenedores.push({ severity, rule, observado, ...prosa });
  };

  // ── 1. Los proyectos y todos sus estados ────────────────────────────────────────────────────────
  let claves = [];
  try {
    claves = listProjects(root);
  } catch (error) {
    anotaContenedor('error', 'store-unreadable', root, {
      message: `no se pudo listar el almacén: ${error.message}`,
      messageCode: 'finding.store-unreadable.message',
      messageParams: { detalle: error.message },
      fix: 'Revisa los permisos de la carpeta del almacén',
      fixCode: 'finding.store-unreadable.fix',
      fixParams: {},
    });
  }

  const archivadas = [];
  for (const projectKey of claves) {
    const base = join(root, 'projects', projectKey);
    for (const estado of ESTADOS_ARCHIVADOS) {
      const { nombres } = subcarpetas(join(base, estado));
      // `superseded/proposals/<id>/<revision>/` son candidatas archivadas, no skills apartadas: se
      // conservan para comparar versiones, pero no se cuentan como versiones anteriores de una skill.
      archivadas.push(...nombres
        .filter((nombre) => nombre !== CARPETA_PROPUESTAS_ARCHIVADAS)
        .map((id) => `${estado}/${projectKey}/${id}`));
    }
    for (const estado of ESTADOS_DE_PROYECTO) {
      if (!quiere(estado)) continue;
      const dir = join(base, estado);
      const { nombres, error } = subcarpetas(dir);
      if (error) {
        anotaContenedor('error', 'state-unreadable', aRelativa(root, dir), {
          message: `no se pudo leer el estado «${estado}» de ${projectKey}: ${error}`,
          messageCode: 'finding.state-unreadable.project.message',
          messageParams: { estado, proyecto: projectKey, detalle: error },
          fix: 'Revisa los permisos de esa carpeta',
          fixCode: 'finding.unreadable.folder.fix',
          fixParams: {},
        });
        continue;
      }
      for (const id of nombres) fichas.push(ficha(join(dir, id), { root, estado, projectKey, id, cwd }));
    }
    // Un estado que el auditor no conoce no puede caerse del informe en silencio.
    const { nombres: enProyecto } = subcarpetas(base);
    const conocidos = new Set([...ESTADOS_DE_PROYECTO, ...ESTADOS_ARCHIVADOS, '.git']);
    for (const nombre of enProyecto) {
      if (!conocidos.has(nombre)) {
        anotaContenedor('warn', 'unknown-state', aRelativa(root, join(base, nombre)), {
          message: `«${nombre}» no es un estado conocido: se ha quedado fuera de la auditoría`,
          messageCode: 'finding.unknown-state.message',
          messageParams: { nombre },
          fix: 'Comprueba si el almacén estrena un estado que el auditor debe conocer',
          fixCode: 'finding.unknown-state.fix',
          fixParams: {},
        });
      }
    }
  }

  // ── 2. La biblioteca global (lo que se sirve fuera de todo proyecto) ────────────────────────────
  for (const estado of ESTADOS_GLOBALES_ARCHIVADOS) {
    const { nombres } = subcarpetas(join(curated, estado.replace(/^global-/, '')));
    archivadas.push(...nombres.map((id) => `${estado}/${id}`));
  }
  for (const estado of ESTADOS_GLOBALES) {
    if (!quiere(estado)) continue;
    const dir = estado === 'global' ? curated : join(curated, estado.replace(/^global-/, ''));
    const { nombres, error } = subcarpetas(dir);
    if (error) {
      anotaContenedor('error', 'state-unreadable', `global/${estado.replace(/^global-/, '')}`, {
        message: `no se pudo leer la biblioteca global («${estado}»): ${error}`,
        messageCode: 'finding.state-unreadable.global.message',
        messageParams: { estado, detalle: error },
        fix: 'Revisa los permisos de esa carpeta',
        fixCode: 'finding.unreadable.folder.fix',
        fixParams: {},
      });
      continue;
    }
    for (const id of nombres) {
      const destino = join(dir, id);
      // La biblioteca es compartida: las skills que no son nuestras se dicen y no se auditan, porque su
      // puerta no es la nuestra.
      let nuestra = true;
      try {
        nuestra = isOurs(destino);
      } catch { nuestra = false; }
      if (!nuestra) {
        contenedores.push({
          severity: 'info',
          rule: 'not-ours',
          observado: aRelativa(curated, destino),
          message: `«${estado}/${id}» no es de este plugin: queda fuera de la auditoría (su puerta no es la nuestra)`,
          messageCode: 'finding.not-ours.message',
          messageParams: { estado, id },
          fix: 'Nada: es de otro sistema',
          fixCode: 'finding.not-ours.fix',
          fixParams: {},
        });
        continue;
      }
      fichas.push(ficha(destino, { root: curated, estado, projectKey: 'global', id, cwd }));
    }
  }

  // ── 3. El informe ───────────────────────────────────────────────────────────────────────────────
  fichas.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // el orden lo pone la clave, no el disco

  const cuenta = (lista) => ({
    total: lista.length,
    pass: lista.filter((s) => s.status === 'PASS').length,
    warn: lista.filter((s) => s.status === 'WARN').length,
    error: lista.filter((s) => s.status === 'ERROR').length,
    unreadable: lista.filter((s) => s.status === 'UNREADABLE').length,
  });

  const byState = {};
  for (const estado of [...new Set(fichas.map((s) => s.estado))].sort()) {
    byState[estado] = cuenta(fichas.filter((s) => s.estado === estado));
  }

  // Por regla: qué está fallando y en qué skills, que es lo que convierte el informe en una lista de
  // trabajo. Se ordena por severidad y luego por cuántas toca: primero lo que más arregla.
  const porRegla = new Map();
  for (const skill of fichas) {
    for (const finding of skill.findings) {
      const clave = `${finding.severity}|${finding.rule}`;
      if (!porRegla.has(clave)) {
        porRegla.set(clave, {
          rule: finding.rule,
          severity: finding.severity,
          count: 0,
          // La frase cruda y su codigo viajan juntos: la representacion se compone al pintar, y la tabla por
          // regla (o el codigo de la variante) resuelve el idioma sin volver a mirar el texto.
          fix: finding.fix,
          fixCode: finding.fixCode,
          fixParams: finding.fixParams,
          skills: [],
        });
      }
      const entrada = porRegla.get(clave);
      entrada.count += 1;
      entrada.skills.push(skill.key);
    }
  }
  const byRule = [...porRegla.values()]
    .map((e) => ({ ...e, skills: e.skills.sort() }))
    .sort((a, b) => {
      const orden = { error: 0, warn: 1, info: 2 };
      return (orden[a.severity] - orden[b.severity]) || (b.count - a.count) || (a.rule < b.rule ? -1 : 1);
    });

  const totals = cuenta(fichas);
  return {
    almacen: { root, curated, proyectos: claves.length },
    totals,
    byState,
    byRule,
    contenedores,
    skills: fichas,
    // Evidencia congelada: se cuenta y se declara, para que su ausencia del total no parezca un olvido.
    archivadas,
  };
}

/** El informe en líneas, para leerlo de un vistazo sin abrir el JSON.
 *
 * Las cifras y los nombres de estado son el dato; la frase se compone con el catalogo en el idioma de la sesion.
 * Los separadores son ASCII a proposito: el texto del plugin no lleva tipografia.
 */
export function resumenDeAuditoria(informe) {
  const lineas = [
    t('audit.summary.counts', {
      total: informe.totals.total,
      pass: informe.totals.pass,
      warn: informe.totals.warn,
      error: informe.totals.error,
      unreadable: informe.totals.unreadable,
    }),
    ...(informe.archivadas.length > 0 ? [t('audit.summary.archived', { n: informe.archivadas.length })] : []),
  ];
  for (const [estado, c] of Object.entries(informe.byState)) {
    lineas.push(t('audit.summary.state-row', {
      estado: estadoEnTexto(estado).padEnd(15),
      total: String(c.total).padStart(3),
      pass: c.pass,
      warn: c.warn,
      error: c.error,
      ilegibles: c.unreadable ? t('audit.summary.unreadable-suffix', { n: c.unreadable }) : '',
    }));
  }
  if (informe.contenedores.length > 0) lineas.push(t('audit.summary.containers', { n: informe.contenedores.length }));
  return lineas.join('\n');
}

// -- La prosa de los hallazgos: una tabla, dos idiomas ---------------------------------------------
//
// El **dato** de un hallazgo es `rule`, `observed`, `threshold` y `severity`: eso no se traduce ni se toca, y es
// lo que afirman las pruebas y lo que viaja al informe JSON. La **frase** (`message`, `fix`) es su representacion
// y se compone al pintar, con el catalogo, en el idioma de la sesion.
//
// Dos caminos, y solo dos:
//
//   1. una regla con UNA redaccion: la tabla de abajo da la clave, y los valores viajan en `messageParams`;
//   2. una regla con VARIAS redacciones (`security-tree`, `unreadable`, `state-unreadable`): el sitio que crea el
//      hallazgo anade `messageCode` + `messageParams`, y esa clave manda sobre la tabla.
//
// Si la clave no existiera se pinta el texto crudo que ya traia el hallazgo: nunca una clave a la vista. Y no se
// deduce nada comparando la frase: la decision es por regla y por codigo.
export const PROSA_DE_REGLA = Object.freeze({
  'reference-path': Object.freeze({ message: 'finding.reference-path.message', fix: 'finding.reference-path.fix' }),
  'reference-escape': Object.freeze({ message: 'finding.reference-escape.message', fix: 'finding.reference-escape.fix' }),
  'reference-not-a-file': Object.freeze({ message: 'finding.reference-not-a-file.message', fix: 'finding.reference-not-a-file.fix' }),
  'reference-duplicate': Object.freeze({ message: 'finding.reference-duplicate.message', fix: 'finding.reference-duplicate.fix' }),
  'reference-empty': Object.freeze({ message: 'finding.reference-empty.message', fix: 'finding.reference-empty.fix' }),
  'link-escape': Object.freeze({ message: 'finding.link-escape.message', fix: 'finding.link-escape.fix' }),
  'link-is-directory': Object.freeze({ message: 'finding.link-is-directory.message', fix: 'finding.link-is-directory.fix' }),
  'link-unverifiable': Object.freeze({ message: 'finding.link-unverifiable.message', fix: 'finding.link-unverifiable.fix' }),
  'link-missing': Object.freeze({ message: 'finding.link-missing.message', fix: 'finding.link-missing.fix' }),
  'reference-budget': Object.freeze({ message: 'finding.reference-budget.message', fix: 'finding.reference-budget.fix' }),
  'id-format': Object.freeze({ message: 'finding.id-format.message', fix: 'finding.id-format.fix' }),
  'id-max': Object.freeze({ message: 'finding.id-max.message', fix: 'finding.id-max.fix' }),
  'description-min': Object.freeze({ message: 'finding.description-min.message', fix: 'finding.description-min.fix' }),
  'description-max': Object.freeze({ message: 'finding.description-max.message', fix: 'finding.description-max.fix' }),
  'description-multiline': Object.freeze({ message: 'finding.description-multiline.message', fix: 'finding.description-multiline.fix' }),
  'whenToUse-min': Object.freeze({ message: 'finding.whenToUse-min.message', fix: 'finding.whenToUse-min.fix' }),
  'whenToUse-multiline': Object.freeze({ message: 'finding.whenToUse-multiline.message', fix: 'finding.whenToUse-multiline.fix' }),
  'body-min': Object.freeze({ message: 'finding.body-min.message', fix: 'finding.body-min.fix' }),
  'body-max': Object.freeze({ message: 'finding.body-max.message', fix: 'finding.body-max.fix' }),
  'body-budget': Object.freeze({ message: 'finding.body-budget.message', fix: 'finding.body-budget.fix' }),
  'body-no-sections': Object.freeze({ message: 'finding.body-no-sections.message', fix: 'finding.body-no-sections.fix' }),
  'body-sections-min': Object.freeze({ message: 'finding.body-sections-min.message', fix: 'finding.body-sections-min.fix' }),
  'body-sections-soft': Object.freeze({ message: 'finding.body-sections-soft.message', fix: 'finding.body-sections-soft.fix' }),
  // La regla de la etiqueta no canonica lleva acento en su id y no se toca: su sitio pone `messageCode`/`fixCode`
  // en vez de resolver por tabla, para que esta tabla (y el catalogo) sean ASCII.
  'personal-path': Object.freeze({ message: 'finding.personal-path.message', fix: 'finding.personal-path.fix' }),
  'absolute-path': Object.freeze({ message: 'finding.absolute-path.message', fix: 'finding.absolute-path.fix' }),
  'absolute-path-ambigua': Object.freeze({ message: 'finding.absolute-path-ambigua.message', fix: 'finding.absolute-path-ambigua.fix' }),
  'absolute-path-ejemplo': Object.freeze({ message: 'finding.absolute-path-ejemplo.message', fix: 'finding.absolute-path-none.fix' }),
  'absolute-path-cita': Object.freeze({ message: 'finding.absolute-path-cita.message', fix: 'finding.absolute-path-none.fix' }),
  'evidence-missing': Object.freeze({ message: 'finding.evidence-missing.message', fix: 'finding.evidence-missing.fix' }),
  'skill-missing': Object.freeze({ message: 'finding.skill-missing.message', fix: 'finding.skill-missing.fix' }),
  'reference-missing-file': Object.freeze({ message: 'finding.reference-missing-file.message', fix: 'finding.reference-missing-file.fix' }),
  'reference-integrity': Object.freeze({ message: 'finding.reference-integrity.message', fix: 'finding.reference-integrity.fix' }),
  'security-id': Object.freeze({ message: 'finding.security-id.message', fix: 'finding.security-id.fix' }),
  secret: Object.freeze({ message: 'finding.secret.message', fix: 'finding.secret.fix' }),
  'security-block': Object.freeze({ message: 'finding.security-block.message', fix: 'finding.security-block.fix' }),
  'security-warn': Object.freeze({ message: 'finding.security-warn.message', fix: 'finding.security-warn.fix' }),
  // Reglas con VARIAS redacciones: el sitio que crea el hallazgo pone `messageCode`; aqui queda la que se usa si
  // un hallazgo llegara sin codigo (una reserva, no la regla).
  'security-tree': Object.freeze({ message: 'finding.security-tree.uninspectable.message', fix: 'finding.security-tree.fix' }),
  unreadable: Object.freeze({ message: 'finding.unreadable.skill.message', fix: 'finding.unreadable.folder.fix' }),
  'state-unreadable': Object.freeze({ message: 'finding.state-unreadable.project.message', fix: 'finding.unreadable.folder.fix' }),
  'journal-chain': Object.freeze({ message: 'finding.journal-chain.message', fix: null }),
  'journal-tamper': Object.freeze({ message: 'finding.journal-tamper.message', fix: null }),
  'store-unreadable': Object.freeze({ message: 'finding.store-unreadable.message', fix: 'finding.store-unreadable.fix' }),
  'unknown-state': Object.freeze({ message: 'finding.unknown-state.message', fix: 'finding.unknown-state.fix' }),
  'not-ours': Object.freeze({ message: 'finding.not-ours.message', fix: 'finding.not-ours.fix' }),
});

/** Los parametros de la frase de un hallazgo: los de la variante, y los del arreglo si van aparte. */
const parametrosDe = (hallazgo, { lang } = {}) => {
  const params = { ...(hallazgo?.messageParams ?? {}), ...(hallazgo?.params ?? {}), ...(hallazgo?.fixParams ?? {}) };
  // `motivoCode` es el unico valor anidado: el motivo del patron de seguridad se dice en el idioma de la sesion,
  // y si el catalogo no lo tuviera se queda el motivo crudo que ya traia el hallazgo (nunca una clave).
  if (typeof params.motivoCode === 'string') {
    const clave = `security.motivo.${params.motivoCode}`;
    const motivo = t(clave, {}, { lang });
    params.motivo = motivo === clave ? params.motivo : motivo;
  }
  // `etiquetaCode` es el mismo caso para la FORMA del contenido (`shape.*`): `lib/vendor.mjs` y `lib/compiler.mjs`
  // etiquetan con el mismo catalogo, y el texto crudo de la tabla sigue viajando como dato.
  if (typeof params.etiquetaCode === 'string') {
    const clave = `shape.${params.etiquetaCode}`;
    const etiqueta = t(clave, {}, { lang });
    params.etiqueta = etiqueta === clave ? params.etiqueta : etiqueta;
  }
  return params;
};

/** Compone una clave con el catalogo; si no existe, el texto crudo. Nunca devuelve una clave cruda. */
const resolver = (codigo, params, crudo, { lang } = {}) => {
  if (typeof codigo !== 'string') return crudo;
  const texto = t(codigo, params, { lang });
  return texto === codigo ? crudo : texto;
};

/**
 * La frase de un hallazgo, en el idioma de la sesion.
 *
 * Acepta el hallazgo entero (`rule`/`messageCode`/`messageParams`/`message`) o una linea ya codificada
 * (`{code, params, texto}`), que es como `checkProposal` entrega la integridad de la puerta.
 */
export function fraseDeHallazgo(hallazgo, opciones = {}) {
  const crudo = String(hallazgo?.message ?? hallazgo?.texto ?? '');
  const codigo = hallazgo?.messageCode ?? hallazgo?.code ?? PROSA_DE_REGLA[hallazgo?.rule]?.message;
  return resolver(codigo, parametrosDe(hallazgo, opciones), crudo, opciones);
}

/** El arreglo de un hallazgo, en el idioma de la sesion: misma regla, misma reserva. */
export function arregloDeHallazgo(hallazgo, opciones = {}) {
  const crudo = String(hallazgo?.fix ?? hallazgo?.arreglo ?? '');
  const codigo = hallazgo?.fixCode ?? PROSA_DE_REGLA[hallazgo?.rule]?.fix;
  return resolver(codigo, parametrosDe(hallazgo, opciones), crudo, opciones);
}

/**
 * Las lineas de la puerta, en el idioma de la sesion.
 *
 * Los hallazgos traen su codigo (`messageCode` o la tabla por regla) y la integridad de la base viaja ya
 * codificada (`errorLines`). Si el numero de frases compuestas no cuadra con `errors`/`warnings`, se pintan los
 * textos crudos: perder una linea de una puerta es peor que ensenar una frase en el otro idioma.
 *
 * Vive aqui -y no en la CLI- porque la CLI y la pagina de revision (`lib/review.mjs`) tienen que decir
 * exactamente lo mismo: una regla, una implementacion.
 */
export function lineasDePuerta(findings, severidad, codificadas, crudas, opciones = {}) {
  const deHallazgos = (findings ?? []).filter((f) => f.severity === severidad).map((f) => fraseDeHallazgo(f, opciones));
  const propias = severidad === 'error' ? (codificadas ?? []).map((l) => fraseDeHallazgo(l, opciones)) : [];
  const compuestas = [...deHallazgos, ...propias];
  return compuestas.length === (crudas ?? []).length ? compuestas : [...(crudas ?? [])];
}

/**
 * El nombre legible de un estado de la auditoria, en el idioma de la sesion.
 *
 * El estado persistido (`approved`, `global-disabled`...) no se toca: esto es su etiqueta. Si el estado es nuevo
 * y el catalogo no lo conoce, se dice el estado tal cual antes que una clave.
 */
export function estadoEnTexto(estado) {
  const clave = `cli.audit.state.${estado}`;
  const texto = t(clave);
  if (texto !== clave) return texto;
  return NOMBRE_DE_ESTADO[estado] ?? String(estado);
}
