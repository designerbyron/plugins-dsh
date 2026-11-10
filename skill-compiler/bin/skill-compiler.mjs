#!/usr/bin/env node
/**
 * skill-compiler - CLI humana del compilador de conocimiento.
 *
 * Aqui vive **aprobar**, y a proposito: aprobar no es una herramienta del modelo. Si lo fuera, el propio
 * modelo podria auto-aprobarse su propuesta y la revision humana seria decorativa. El modelo propone; esta
 * CLI decide.
 *
 * Comparte implementacion con el plugin (`lib/compiler.mjs`), asi que las reglas no pueden divergir entre lo
 * que el modelo puede proponer y lo que tu puedes aprobar.
 *
 * La ayuda NO se escribe aqui: vive en `lib/i18n` (claves `cli.usage.*` y `cli.help.*`) y la pinta `usage()`.
 * Un texto copiado en un comentario se queda obsoleto sin que nadie lo note; la tabla `AYUDA` de mas abajo es
 * la que se imprime, y la prueba de coherencia la compara con los `case` de este fichero: ni un comando de
 * mas en la ayuda, ni uno de menos.
 */
import { clavesFaltantes, resolveLang, setLang, t as tr, textoDeCodigo } from '../lib/i18n/index.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ambito, approve, checkProposal, curatedLibraryRoot, defaultRoot, disable, enable, listForProject, locate,
  overview, pending, projectKey, reject, restore, retire, retired, retiredRoot,
} from '../lib/compiler.mjs';
import { readProvenance, etiquetaDeHallazgo, upstreamStatus, vendor } from '../lib/vendor.mjs';
import {
  MAQUINA, SOLO_DSH, declararPropiedad, inventario, leerPropiedad, proyectosConocidos, propiedadEnTexto,
  textoDeSistemas, textoDelEstado,
} from '../lib/scope.mjs';
import { leerDiario, verificarCadena } from '../lib/security.mjs';
import { arregloDeHallazgo, estadoEnTexto, fraseDeHallazgo, lineasDePuerta } from '../lib/audit.mjs';

/**
 * La ruta de este propio CLI. Se deriva en tiempo de ejecucion en vez de escribirse: el mensaje que la
 * ensena al usuario se quedaba obsoleto cada vez que el repositorio cambiaba de sitio, y una instruccion
 * de aprobacion que no funciona es peor que no darla.
 */
const SELF = fileURLToPath(import.meta.url);
/** La raiz del paquete, derivada de la ruta de este fichero: `bin/` esta un nivel por debajo. */
const packageRoot = join(dirname(SELF), '..');

const argv = process.argv.slice(2);
const command = argv[0];
const flags = {};
const positional = [];
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--project-key') { flags.projectKey = argv[++i]; continue; }
  if (arg === '--preserve-state') { flags.preserveState = true; continue; }
  if (arg === '--force') { flags.force = true; continue; }
  if (arg === '--yes') { flags.yes = true; continue; }
  // El ambito: publicar para todos los proyectos es un gesto explicito, y volver a local, otro.
  if (arg === '--global') { flags.global = true; continue; }
  if (arg === '--local') { flags.local = true; continue; }
  if (arg === '--id') { flags.id = argv[++i]; continue; }
  if (arg === '--note') { flags.note = argv[++i]; continue; }
  if (arg === '--url') { flags.url = argv[++i]; continue; }
  if (arg === '--port') { flags.port = argv[++i]; continue; }
  // Las de `audit`: el informe entero en JSON, acotar por estado, o incluir tambien las que pasan.
  if (arg === '--json') { flags.json = true; continue; }
  if (arg === '--todo') { flags.todo = true; continue; }
  if (arg === '--estado') { flags.estado = argv[++i]; continue; }
  // Las de la promocion: que niveles se autorizan, y ver las pruebas sin escribir nada.
  if (arg === '--nivel') { flags.nivel = argv[++i]; continue; }
  // Un lote: la misma decision sobre todas las propuestas que van juntas. No es un atajo -cada una pasa su
  // puerta- es poder mirarlas y decidirlas como lo que son.
  if (arg === '--grupo') { flags.grupo = argv[++i]; continue; }
  // El idioma, tambien por bandera: `lang --es` es la forma del comando del harness, y dos puertas con la
  // misma verdad no deben discrepar en la ortografia. Fuera de `lang` se rechaza mas abajo.
  if (arg === '--en') { flags.lang = 'en'; continue; }
  if (arg === '--es') { flags.lang = 'es'; continue; }
  if (arg === '--dry') { flags.dry = true; continue; }
  if (arg.startsWith('--')) { process.stderr.write(`${tr('cli.unknown-option', { option: arg })}\n`); process.exit(2); }
  positional.push(arg);
}
const root = defaultRoot();

// Una bandera de idioma fuera de `lang` no se ignora: se rechaza, igual que una opcion desconocida. Un
// `--es` tragado en silencio haria creer que el idioma se fijo cuando no se toco nada.
if (flags.lang !== undefined && command !== 'lang') {
  process.stderr.write(`${tr('cli.unknown-option', { option: `--${flags.lang}` })}\n`);
  process.exit(2);
}

/**
 * La etiqueta de un estado y el motivo de `repair`, que el motor devuelve como DATO.
 *
 * El dato (`estado`, `reason`) no se traduce ni se toca: es lo que afirman las pruebas y lo que viaja a otras
 * funciones. La FRASE se compone aqui, con el catalogo, en el idioma de la sesion. Y si la clave no estuviera, se
 * dice el dato tal cual antes que ensenar una clave cruda a una persona.
 */
const etiquetaDeEstado = (skill) => estadoEnTexto(skill.estado);
const motivoDeReparacion = (r) => {
  if (r.reasonCode === undefined) return r.reason;
  const clave = `cli.repair.reason.${r.reasonCode}`;
  const texto = tr(clave, r.reasonParams ?? {});
  return texto === clave ? r.reason : texto;
};
/**
 * La frase de una reparacion o de un bloqueo, en el idioma de la sesion.
 *
 * El DATO (`describe`, `como`, `motivo`) se conserva tal cual; lo que se compone aqui es su representacion. Si
 * la clave no estuviera, se dice el dato antes que ensenar una clave cruda. `whyCode` es el unico caso anidado:
 * el marco (`repair.why.not-on-its-own`) lleva dentro la frase de la regla.
 */
const fraseDeReparacion = (crudo, codigo, params = {}) => {
  if (typeof codigo !== 'string') return crudo;
  let resuelto = params;
  if (typeof params.whyCode === 'string') {
    const anidado = tr(params.whyCode);
    resuelto = { ...params, why: anidado === params.whyCode ? params.why : anidado };
  }
  const texto = tr(codigo, resuelto);
  return texto === codigo ? crudo : texto;
};

/**
 * La ayuda, en una tabla: la **sintaxis** es un dato (nombres de comando y opciones, nunca se traduce) y la
 * **descripcion** es prosa, en el catalogo. Asi la ayuda se puede leer en los dos idiomas sin duplicar la
 * lista, y `tests/coherencia.test.mjs` compara esta tabla con los `case` implementados.
 */
const AYUDA = [
  ['lang [en|es] [--en|--es]', 'cli.help.lang'],
  ['where', 'cli.help.where'],
  ['list', 'cli.help.list'],
  ['show <id>', 'cli.help.show'],
  ['check [<id>]', 'cli.help.check'],
  ['check --grupo <lote>', 'cli.help.check-batch'],
  ['approve <id>', 'cli.help.approve'],
  ['approve <id> --global', 'cli.help.approve-global'],
  ['approve <id> --preserve-state', 'cli.help.approve-preserve'],
  ['approve --grupo <lote>', 'cli.help.approve-batch'],
  ['scope <id> --local|--global', 'cli.help.scope'],
  ['active', 'cli.help.active'],
  ['reject <id>', 'cli.help.reject'],
  ['disable <id>', 'cli.help.disable'],
  ['enable <id>', 'cli.help.enable'],
  ['delete <id> [--yes]', 'cli.help.delete'],
  ['retired', 'cli.help.retired'],
  ['restore <id>', 'cli.help.restore'],
  ['vendor <url> [--id X] [--note "..."]', 'cli.help.vendor'],
  ['upstream <id>', 'cli.help.upstream'],
  ['provenance <id>', 'cli.help.provenance'],
  ['ownership', 'cli.help.ownership'],
  ['ownership dsh-only|machine', 'cli.help.ownership-set'],
  ['systems', 'cli.help.systems'],
  ['security', 'cli.help.security'],
  ['auto [<id>]', 'cli.help.auto'],
  ['doctor', 'cli.help.doctor'],
  ['audit [--json] [--estado X] [--todo]', 'cli.help.audit'],
  ['repair <id>', 'cli.help.repair'],
  ['promote <id> [--nivel 1,2] [--dry]', 'cli.help.promote'],
  ['history [<id>] [--grupo X]', 'cli.help.history'],
  ['review [--port N]', 'cli.help.review'],
];

function usage(code) {
  const bin = 'node bin/skill-compiler.mjs';
  const lineas = [tr('cli.usage.title'), '', tr('cli.usage.intro'), '', tr('cli.usage.commands')];
  for (const [sintaxis, clave] of AYUDA) lineas.push(`  ${bin} ${sintaxis.padEnd(40)}${tr(clave)}`);
  lineas.push('', tr('cli.usage.options'), '', tr('cli.usage.exit'), '', tr('cli.usage.harness'));
  process.stderr.write(`${lineas.join('\n')}\n`);
  process.exit(code);
}

/**
 * Las propuestas de un lote, leidas del mismo sitio que las lee el motor (`meta.json`). Si el lote no
 * existe, se dice con el numero de lotes que si hay: un error que nombra lo que hay se arregla solo.
 */
async function idsDelLote(groupId, key) {
  const { propuestasDelLote } = await import('../lib/promote.mjs');
  return propuestasDelLote(groupId, key, { root }).map((p) => p.id);
}

/** El ambito sale del cwd actual, o de `--project-key` cuando se trabaja sobre otro proyecto. */
function scope() {
  if (typeof flags.projectKey === 'string') return flags.projectKey;
  const key = projectKey(process.cwd());
  if (key === null) { process.stderr.write(`${tr('cli.no-project')}\n`); process.exit(2); }
  return key;
}

/**
 * Valida una propuesta guardada. Se importa de `lib/` -donde esta probada- porque la misma puerta la
 * aplican la CLI, la pagina de revision y los comandos del harness: una regla, una implementacion.
 */
function checkSkill(id, key) {
  return checkProposal(id, key, { root });
}

/**
 * Pinta la puerta de `check`. Las lineas las compone `lineasDePuerta` (`lib/audit.mjs`), que es tambien la que
 * usa la pagina de revision: una regla, una implementacion, y las dos superficies dicen lo mismo.
 */
function printCheck(id, key, result) {
  for (const e of lineasDePuerta(result.findings, 'error', result.errorLines, result.errors)) process.stderr.write(`${tr('cli.check.fail', { error: e })}\n`);
  for (const w of lineasDePuerta(result.findings, 'warn', null, result.warnings)) process.stderr.write(`${tr('cli.check.warning', { aviso: w })}\n`);
  if (result.ok) {
    process.stdout.write(`${result.warnings.length ? tr('cli.check.green-warnings', { id }) : tr('cli.check.green', { id })}\n`);
  }
}

/**
 * Una lista de mensajes de un resultado (errores, avisos), en el idioma de la sesion.
 *
 * `codigos` viaja en paralelo a `textos` -el mismo `i` es el mismo mensaje- y el texto crudo es la reserva: si un
 * codigo no tiene frase en el catalogo se pinta el dato, nunca la clave. Es la forma en que `lib/vendor.mjs`
 * entrega sus motivos: el dato intacto y, al lado, su representacion.
 */
function mensajes(lista, codigos) {
  return (lista ?? []).map((texto, i) => {
    const codigo = Array.isArray(codigos) ? codigos[i] : null;
    return codigo === null || codigo === undefined ? String(texto) : textoDeCodigo(codigo.code, codigo.params ?? {}, texto);
  });
}

switch (command) {
  case 'where': {
    const key = projectKey(process.cwd());
    process.stdout.write(`${process.cwd()}\n${tr('cli.where.project', { key: key ?? tr('cli.no-scope-label') })}\n${tr('cli.where.data', { root })}\n`);
    break;
  }

  case 'list': {
    const rows = overview({ root });
    if (rows.length === 0) { process.stdout.write(`${tr('cli.list.empty', { root })}\n`); break; }
    for (const row of rows) {
      process.stdout.write(`\n${row.projectKey}\n`);
      const ninguno = tr('cli.list.none');
      process.stdout.write(`${tr('cli.list.proposed', { ids: row.proposed.length ? row.proposed.map((p) => p.id).join(', ') : ninguno })}\n`);
      process.stdout.write(`${tr('cli.list.approved', { ids: row.approved.length ? row.approved.map((p) => p.id).join(', ') : ninguno })}\n`);
      process.stdout.write(`${tr('cli.list.rejected', { ids: row.rejected.length ? row.rejected.join(', ') : ninguno })}\n`);
    }
    break;
  }

  case 'show': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const file = join(root, 'projects', key, 'proposed', id, 'SKILL.md');
    if (!existsSync(file)) { process.stderr.write(`${tr('cli.show.missing', { id, key })}\n`); process.exit(1); }
    process.stdout.write(readFileSync(file, 'utf8'));
    break;
  }

  case 'check': {
    const key = scope();
    const only = positional[0];
    // `check --grupo <id>`: las propuestas de un lote, revisadas juntas. Cada una pasa **su** puerta.
    const ids = flags.grupo !== undefined
      ? await idsDelLote(flags.grupo, key)
      : only ? [only] : pending({ root, key }).map((p) => p.id);
    if (ids.length === 0) {
      // Un lote vacio y un proyecto sin pendientes no son lo mismo, y decir "nada pendiente" cuando se
      // pidio un lote concreto haria pensar que esta todo hecho.
      process.stdout.write(`${flags.grupo !== undefined
        ? tr('cli.batch.empty', { grupo: flags.grupo, key })
        : tr('cli.nothing-pending', { key })}\n`);
      break;
    }
    let failures = 0;
    for (const id of ids) {
      const result = checkSkill(id, key);
      printCheck(id, key, result);
      if (!result.ok) failures++;
    }
    process.exit(failures === 0 ? 0 : 1);
    break;
  }

  case 'approve': {
    const id = positional[0];
    const key = scope();
    // Un lote se aprueba entero o no se aprueba: primero se comprueban TODAS las puertas y despues se
    // aprueban. Comprobar y aprobar de una en una dejaria media parte activada si la tercera no pasa - y
    // eso es exactamente lo que el lote existe para evitar (la decision humana puede ir una a una, pero
    // entonces es `approve <id>` a proposito, no un lote que se rompio por el camino).
    if (flags.grupo !== undefined) {
      const ids = await idsDelLote(flags.grupo, key);
      if (ids.length === 0) { process.stdout.write(`${tr('cli.batch.empty', { grupo: flags.grupo, key })}\n`); break; }
      const fallos = [];
      for (const cada of ids) {
        const comprobacion = checkSkill(cada, key);
        if (!comprobacion.ok) { fallos.push(cada); printCheck(cada, key, comprobacion); }
        else if (comprobacion.warnings.length && flags.force !== true) { fallos.push(cada); printCheck(cada, key, comprobacion); }
      }
      if (fallos.length > 0) {
        process.stderr.write(`${tr('cli.approve.batch-rejected', { ids: fallos.join(', ') })}\n`);
        process.exit(1);
      }
      const { approveProposal } = await import('../lib/commands.mjs');
      const hechas = [];
      for (const cada of ids) {
        // La misma funcion que el comando y el panel: puerta, seguridad, huella del contenido y entrada del
        // diario. La CLI no reimplementa nada - si lo hiciera, seria el camino que olvida el rastro.
        const movida = approveProposal({ root, key: key, id: cada, force: flags.force === true, scope: flags.global === true ? 'global' : 'project' });
        if (movida.kind !== 'success') { process.stderr.write(`${tr('cli.approve.batch-failed', { id: cada, reason: movida.text.split('\n')[0], done: hechas.join(', ') || tr('cli.approve.batch-none') })}\n`); process.exit(1); }
        hechas.push(cada);
      }
      const donde = flags.global === true ? tr('cli.scope.global-where') : tr('cli.scope.project-where', { key });
      process.stdout.write(`${tr('cli.approve.batch-done', { n: hechas.length, grupo: flags.grupo, donde })}\n${hechas.map((c) => tr('cli.approve.batch-row', { id: c })).join('\n')}\n`);
      break;
    }
    if (!id) usage(2);
    // Aprobar algo ya aprobado no es un fallo: es un acto que ya ocurrio. Medido con el usuario delante:
    // volvio a aprobar al ver la skill todavia en la lista, y aqui leeria "no existe una propuesta".
    const ambitoPedido = flags.global === true ? 'global' : 'project';
    if (ambitoPedido === 'global' && ['global', 'published'].includes(locate(id, key, { root }))) {
      process.stdout.write(`${tr('cli.approve.already-published', { id })}\n${tr('cli.approve.no-change')}\n`);
      break;
    }
    if (ambitoPedido === 'project' && locate(id, key, { root }) === 'approved') {
      process.stdout.write(`${tr('cli.approve.already-active', { id, key })}\n${tr('cli.approve.no-change')}\n`);
      break;
    }
    // Igual que el comando y el panel: el mismo juicio, la misma huella, el mismo rastro. La CLI ya no
    // reimplementa la aprobacion (tenia su propia copia de las comprobaciones, y olvidaba el diario y la
    // comprobacion de contenido).
    const { approveProposal } = await import('../lib/commands.mjs');
    const r = approveProposal({ root, key, id, force: flags.force === true, scope: ambitoPedido, preservarEstado: flags.preserveState === true });
    process.stdout.write(`${r.text}\n`);
    if (ambitoPedido === 'project') process.stdout.write(`${tr('cli.approve.next-global', { id })}\n`);
    process.exit(r.kind === 'success' ? 0 : 1);
  }

  // -- el ambito, en las dos direcciones ------------------------------------------------------------
  // Una aprobacion con el ambito equivocado se corrige sin volver a proponer nada: la decision tiene vuelta.
  case 'scope': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const to = flags.local === true ? 'project' : flags.global === true ? 'global' : null;
    const moved = ambito(id, key, { to, root });
    if (!moved.ok) { process.stderr.write(`${tr('cli.scope.failed', { reason: moved.reason })}\n`); process.exit(1); }
    const dondeScope = moved.scope === 'global' ? tr('cli.scope.global-where') : tr('cli.scope.project-where', { key });
    process.stdout.write(`${tr('cli.scope.done', { id, donde: dondeScope })}\n  ${moved.path}\n${tr('cli.scope.hash', { sha: moved.sha256 })}\n`);
    break;
  }

  // -- apagar, retirar y volver --------------------------------------------------------------------
  // El unico gesto irreversible es `delete`, y por eso **no borra**: mueve a un respaldo fechado y dice
  // cual es la vuelta. Sin `--yes` no toca nada.
  case 'disable': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    if (locate(id, key, { root }) === 'disabled') {
      process.stdout.write(`${tr('cli.disable.already-off', { id, key })}\n${tr('cli.approve.no-change')}\n`);
      break;
    }
    const moved = disable(id, key, { root, scope: flags.global === true ? 'global' : 'project' });
    if (!moved.ok) { process.stderr.write(`${tr('cli.disable.failed', { reason: moved.reason })}\n`); process.exit(1); }
    const donde = flags.global === true ? tr('cli.scope.global-where') : tr('cli.scope.project-where', { key });
    process.stdout.write(`${tr('cli.disable.done', { id, donde })}\n${tr('cli.disable.hint', { id, global: flags.global === true ? ' --global' : '' })}\n`);
    break;
  }

  case 'enable': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const moved = enable(id, key, { root, scope: flags.global === true ? 'global' : 'project' });
    if (!moved.ok) { process.stderr.write(`${tr('cli.enable.failed', { reason: moved.reason })}\n`); process.exit(1); }
    process.stdout.write(`${tr('cli.enable.done', { id, donde: flags.global === true ? tr('cli.scope.global-where') : tr('cli.scope.project-where', { key }) })}\n`);
    break;
  }

  case 'delete': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const esGlobal = flags.global === true;
    const destino = join(retiredRoot(), esGlobal ? 'global' : key, id);
    const dondeRetira = esGlobal ? tr('cli.scope.global-where') : tr('cli.scope.project-where', { key });
    if (flags.yes !== true) {
      process.stdout.write(`${tr('cli.retire.confirm', { id, donde: dondeRetira, path: destino })}\n`);
      process.stdout.write(`${tr('cli.retire.no-delete')}\n`);
      process.stdout.write(`${tr('cli.retire.repeat')}\n`);
      process.exit(1);
    }
    const moved = retire(id, key, { root, scope: esGlobal ? 'global' : 'project' });
    if (!moved.ok) { process.stderr.write(`${tr('cli.retire.failed', { reason: moved.reason })}\n`); process.exit(1); }
    process.stdout.write(`${tr('cli.retire.done', { id, donde: dondeRetira, path: moved.backup, hash: moved.hash, revierte: moved.revierte })}\n`);
    break;
  }

  case 'retired': {
    const key = scope();
    const lista = retired(key, { root });
    if (lista.length === 0) { process.stdout.write(`${tr('cli.retired.empty', { key })}\n`); break; }
    for (const skill of lista) {
      const estado = skill.state === 'disabled'
        ? tr('cli.retired.state-disabled')
        : skill.state === 'superseded' ? tr('cli.retired.state-apart') : tr('cli.retired.state-retired');
      const donde = skill.scope === 'global' ? tr('cli.retired.scope-global') : tr('cli.retired.scope-project');
      process.stdout.write(`${tr('cli.retired.row', {
        estado: estado.padEnd(8),
        id: skill.id,
        donde,
        fecha: skill.retiredAt ? `  (${skill.retiredAt})` : '',
      })}\n`);
    }
    break;
  }

  case 'restore': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const moved = restore(id, key, { root, scope: flags.global === true ? 'global' : 'project' });
    if (!moved.ok) { process.stderr.write(`${tr('cli.restore.failed', { reason: moved.reason })}\n`); process.exit(1); }
    process.stdout.write(`${tr('cli.restore.done', { id, donde: flags.global === true ? tr('cli.scope.global-where') : tr('cli.scope.project-where', { key }), path: moved.path, hash: moved.hash })}\n`);
    break;
  }

  case 'reject': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const where = locate(id, key, { root });
    if (where === 'rejected') {
      process.stdout.write(`${tr('cli.reject.already-aside', { id, key })}\n${tr('cli.approve.no-change')}\n`);
      break;
    }
    if (where === 'approved') {
      process.stderr.write(`${tr('cli.reject.active', { id, key })}\n`);
      process.exit(1);
    }
    const moved = reject(id, key, { root });
    if (!moved.ok) { process.stderr.write(`${tr('cli.reject.failed', { reason: moved.reason })}\n`); process.exit(1); }
    process.stdout.write(`${tr('cli.reject.done', { id, path: moved.path.replace(/[\\/]SKILL\.md$/, '') })}\n`);
    break;
  }

  case 'active': {
    const key = scope();
    const found = listForProject(process.cwd(), { root });
    process.stdout.write(`${key}: ${found.length ? found.map((s) => s.id).join(', ') : tr('cli.active.none')}\n`);
    break;
  }

  case 'vendor': {
    const url = positional[0] ?? flags.url;
    if (!url) usage(2);
    const result = await vendor({ url, id: flags.id, localNote: flags.note }, { root, cwd: process.cwd() });
    if (result.status === 'proposed') {
      process.stdout.write([
        tr('cli.vendor.created', { id: result.id }),
        tr('cli.vendor.source', { url: `${result.provenance.source.url}${result.upstream.ref ? ` (${result.upstream.ref})` : ''}` }),
        tr('cli.vendor.sha', { sha: result.upstream.sha256 }),
        tr('cli.vendor.stored', { path: join(root, 'projects', result.projectKey, 'proposed', result.id, 'upstream') }),
        tr('cli.vendor.provenance', { path: join(root, 'projects', result.projectKey, 'proposed', result.id, 'provenance.json') }),
        '',
        tr('cli.vendor.not-active'),
        tr('cli.vendor.approve', { bin: SELF, id: result.id }),
        ...(result.warnings.length
          ? ['', tr('cli.vendor.warnings'), ...mensajes(result.warnings, result.warningCodes).map((w) => tr('cli.vendor.warning-row', { aviso: w }))]
          : []),
      ].join('\n') + '\n');
      break;
    }
    if (result.status === 'needs-choice') {
      process.stderr.write(`${tr('cli.vendor.needs-choice', { dirs: result.dirs.join('\n  ') })}\n`);
      process.exit(1);
    }
    if (result.status === 'blocked') {
      process.stderr.write(`${tr('cli.vendor.blocked')}\n`);
      process.stderr.write(`${tr('cli.vendor.reason', { reason: mensajes(result.errors, result.errorCodes)[0] ?? '' })}\n`);
      for (const f of result.findings ?? []) process.stderr.write(`${tr('cli.vendor.finding', { file: f.file, line: f.line, label: etiquetaDeHallazgo(f) })}\n`);
      process.stderr.write(`${tr('cli.vendor.no-bypass')}\n`);
      process.exit(1);
    }
    process.stderr.write(`${tr('cli.vendor.failed', { status: result.status, errors: mensajes(result.errors, result.errorCodes).join(' ') })}\n`);
    if (result.conflicts?.length) for (const c of result.conflicts) process.stderr.write(`${tr('cli.vendor.conflict', { id: c.id, reason: c.reason })}\n`);
    process.exit(1);
  }

  case 'upstream': {
    const id = positional[0];
    if (!id) usage(2);
    const status = await upstreamStatus(id, scope(), { root });
    if (status.status !== 'checked') { process.stderr.write(`${tr('cli.upstream.failed', { id, errors: mensajes(status.errors, status.errorCodes).join(' ') })}\n`); process.exit(1); }
    process.stdout.write([
      status.changed ? tr('cli.upstream.changed', { fecha: status.fetchedAt?.slice(0, 10) }) : tr('cli.upstream.same'),
      `  ${status.url}${status.ref ? ` (${status.ref})` : ''}`,
      tr('cli.upstream.saved', { stored: status.storedSha256?.slice(0, 16), upstream: status.upstreamSha256?.slice(0, 16) }),
      status.changed ? tr('cli.upstream.untouched') : '',
    ].filter(Boolean).join('\n') + '\n');
    break;
  }

  case 'provenance': {
    const id = positional[0];
    if (!id) usage(2);
    const record = readProvenance(id, scope(), { root });
    if (!record) { process.stderr.write(`${tr('cli.provenance.missing', { id })}\n`); process.exit(1); }
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    break;
  }

  case 'ownership': {
    const respuesta = String(positional[0] ?? '').trim();
    const antes = leerPropiedad({ root });
    if (respuesta === '') {
      console.log(textoDelEstado(antes));
      process.exit(0);
    }
    // Compare-and-swap: si la declaracion cambio desde que se leyo, esta escritura se niega en vez de
    // pisar una respuesta que este proceso no vio.
    const r = declararPropiedad(respuesta, { root, por: 'humano', esperadaHuella: antes.huella ?? undefined });
    if (!r.ok) {
      console.error(r.reason);
      process.exit(2);
    }
    console.log(tr('cli.ownership.declared', { ownership: respuesta, huella: String(r.huella).slice(0, 12) }));
    console.log(`  ${propiedadEnTexto(respuesta)}`);
    process.exit(0);
  }

  case 'systems': {
    console.log(textoDeSistemas({
      datos: inventario({ root, curada: curatedLibraryRoot(), proyectos: proyectosConocidos({ root }) }),
      estado: leerPropiedad({ root }),
    }));
    process.exit(0);
  }

  case 'security': {
    // Solo lectura, y por el mismo camino que la puerta: `auditarCarpeta` es la regla, una implementacion.
    // Recorre el almacen entero (todos los estados) y verifica ademas la cadena de cada diario.
    const fs = await import('node:fs');
    const { auditarCarpeta } = await import('../lib/compiler.mjs');
    let skills = 0;
    let bloqueos = 0;
    let avisos = 0;
    const rotos = [];
    let proyectos = [];
    // ENOENT es "todavia no hay" (un almacen recien instalado: valido). ENOTDIR o EACCES es "no pude
    // leer", y eso no puede salir en verde: un catch mudo contaba un projects que es un fichero como
    // "0 proyectos" y el comando cerraba diciendo "sin bloqueos y con el diario integro".
    let ilegible = null;
    try { proyectos = fs.readdirSync(join(root, 'projects'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (error) {
      if (error?.code !== 'ENOENT') ilegible = { ruta: join(root, 'projects'), codigo: error?.code ?? error?.message ?? 'desconocido' };
      proyectos = [];
    }
    for (const proyecto of proyectos.sort()) {
      for (const estado of ['proposed', 'approved', 'disabled', 'published', 'rejected']) {
        let ids = [];
        try { ids = fs.readdirSync(join(root, 'projects', proyecto, estado), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (error) {
          // Un estado que no existe no dice nada; uno que existe y no se puede leer, si.
          if (error?.code !== 'ENOENT') rotos.push(`${proyecto}/${estado}: ${error?.code ?? error?.message}`);
          continue;
        }
        for (const id of ids.sort()) {
          const dir = join(root, 'projects', proyecto, estado, id);
          if (!fs.existsSync(join(dir, 'SKILL.md'))) continue;
          skills += 1;
          const { findings } = auditarCarpeta(dir, { id });
          for (const h of findings) {
            if (!/^(security|secret)/.test(String(h.rule ?? ''))) continue;
            if (h.severity === 'error') { bloqueos += 1; process.stdout.write(`${tr('cli.security.block', { estado, id, rule: h.rule, message: fraseDeHallazgo(h) })}\n`); }
            else { avisos += 1; process.stdout.write(`${tr('cli.security.warning', { estado, id, rule: h.rule, message: fraseDeHallazgo(h) })}\n`); }
          }
        }
      }
      const diario = leerDiario(join(root, 'projects', proyecto, 'journal.jsonl'));
      if (!diario.existe) continue;
      const cadena = verificarCadena(diario.entradas);
      for (const r of cadena.roturas) rotos.push(`${proyecto}: ${fraseDeHallazgo(r)}`);
      if (cadena.sinHuella > 0) process.stdout.write(`${tr('cli.security.old-entries', { proyecto, n: cadena.sinHuella })}\n`);
      if (diario.ilegibles > 0) rotos.push(tr('cli.security.broken-line', { proyecto, n: diario.ilegibles }));
    }
    if (ilegible !== null) process.stdout.write(`${tr('cli.doctor.security-unreadable', ilegible)}\n`);
    process.stdout.write(`${tr('cli.security.header', { skills, proyectos: proyectos.length })}\n`);
    process.stdout.write(`${tr('cli.security.counts', { blocked: bloqueos, warnings: avisos })}\n`);
    process.stdout.write(rotos.length === 0
      ? `${tr('cli.security.journals-ok')}\n`
      : `${tr('cli.security.journals-broken', { n: rotos.length })}\n${rotos.map((r) => tr('cli.security.broken-row', { message: r })).join('\n')}\n`);
    if (bloqueos > 0 || rotos.length > 0 || ilegible !== null) { process.stdout.write(`${tr('cli.security.stop')}\n`); process.exit(1); }
    process.stdout.write(`${tr('cli.security.ok')}\n`);
    process.exit(0);
  }

  case 'auto': {
    // El medidor, con su tabla: que se midio, que se exige y que falla. Sin id, mide las actualizaciones
    // pendientes del proyecto del directorio actual. Solo lectura: no activa nada.
    const { medirAutoActualizacion, textoDeMedidas } = await import('../lib/auto-update.mjs');
    const { pending } = await import('../lib/compiler.mjs');
    const clave = scope();
    const id = String(positional[0] ?? '').trim();
    const objetivos = id === '' ? pending({ root, key: clave }).filter((p) => p.updatesActive).map((p) => p.id) : [id];
    if (objetivos.length === 0) {
      process.stdout.write(`${tr('cli.auto.none', { key: clave })}\n`);
      process.exit(0);
    }
    let noAptas = 0;
    for (const cada of objetivos) {
      const v = medirAutoActualizacion(cada, clave, { root, curated: curatedLibraryRoot(), cwd: process.cwd() });
      if (!v.apto) noAptas += 1;
      process.stdout.write(`\n${cada} [${clave}]\n${textoDeMedidas(v)}\n`);
    }
    process.exit(noAptas === 0 ? 0 : 1);
  }

  // -- idioma ---------------------------------------------------------------------------------------
  // Una sola resolucion para las dos superficies. Sin argumento informa el idioma efectivo **y su fuente**:
  // sin la fuente, "idioma: es" no dice si fue una decision de la persona o una variable de la sesion.
  case 'lang': {
    const pedido = positional[0] ?? flags.lang;
    if (pedido === undefined) {
      const info = resolveLang({ fresh: true });
      const lineas = [tr('lang.status', { lang: info.lang, source: info.source }, { lang: info.lang })];
      if (info.invalidEnv !== undefined) lineas.push(tr('lang.env-invalid', { value: info.invalidEnv }, { lang: info.lang }));
      if (info.invalidConfig !== undefined) lineas.push(tr('lang.config-invalid', { value: info.invalidConfig }, { lang: info.lang }));
      process.stdout.write(`${lineas.join('\n')}\n`);
      break;
    }
    const puesto = setLang(pedido);
    if (!puesto.ok) {
      if (puesto.reason === 'unsupported') {
        process.stderr.write(`${tr('lang.unsupported', { value: puesto.value, supported: puesto.supported.join(', ') }, { lang: resolveLang().lang })}\n`);
        process.exit(2);
      }
      process.stderr.write(`${puesto.detail ?? puesto.reason}\n`);
      process.exit(1);
    }
    process.stdout.write(`${tr('lang.set', { lang: puesto.lang, path: puesto.path }, { lang: puesto.lang })}\n`);
    break;
  }

  case 'doctor': {
    // Existe por un fallo real: el plugin importaba un paquete del harness sin declararlo, funcionaba
    // en la maquina donde estaba suelto y fallaba al instalarse en un perfil con "failed to import".
    // Este comando dice exactamente que falta y que hacer, en vez de dejar que se descubra instalando.
    const fs = await import('node:fs');
    const { pathToFileURL } = await import('node:url');
    const pkgPath = join(packageRoot, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const declared = manifest.dependencies ?? {};
    const declaredNames = Object.keys(declared);
    let bad = 0;
    const line = (ok, text, remedy) => {
      if (!ok) bad++;
      process.stdout.write(`${(ok ? tr('cli.mark.ok') : tr('cli.mark.fail')).padEnd(6)} ${text}\n`);
      if (!ok && remedy) process.stdout.write(`${tr('cli.doctor.remedy', { remedy })}\n`);
    };

    // La capa de seguridad, en una linea: cuantas skills del almacen levantan algo. Informativo a proposito:
    // `doctor` dice si el plugin puede activarse; `security` dice si el contenido esta limpio, con su codigo.
    // Un almacen que todavia NO existe no es una averia: es el estado de una instalacion nueva, sin nada
    // propuesto. Se dice y no se cuenta como problema. Lo que si es un problema es una ruta que existe y no se
    // puede leer (permisos, o un "projects" que es un fichero): ahi no se sabe que hay, y responder "0
    // revisadas" seria afirmar algo que no se miro. La distincion vive en `leerProyectosDelAlmacen`.
    try {
      const { auditarCarpeta, leerProyectosDelAlmacen } = await import('../lib/compiler.mjs');
      const almacen = leerProyectosDelAlmacen(root);
      if (almacen.estado === 'inexistente') {
        line(true, tr('cli.doctor.security-empty', { ruta: almacen.ruta }));
      } else if (almacen.estado === 'ilegible') {
        // Existe y no se puede leer: no se sabe que hay dentro, asi que se declara en vez de decir "0 revisadas".
        line(false, tr('cli.doctor.security-unreadable', { ruta: almacen.ruta, codigo: almacen.codigo ?? '?' }),
          tr('cli.doctor.security-failed-remedy'));
      } else {
        let bloqueos = 0;
        let avisos = 0;
        let revisadas = 0;
        for (const proyecto of almacen.proyectos) {
          for (const estado of ['proposed', 'approved', 'disabled', 'published', 'rejected']) {
            let ids = [];
            try {
              ids = fs.readdirSync(join(root, 'projects', proyecto, estado), { withFileTypes: true }).filter((d) => d.isDirectory());
            } catch (error) {
              // Una carpeta de estado que no existe es lo normal (no todo proyecto tiene "rejected/"); una que
              // existe y no se puede leer no lo es, y se declara en vez de revisar menos en silencio.
              if (error.code === 'ENOENT') continue;
              throw new Error(`${estado}/${proyecto}: ${error.code ?? error.message}`);
            }
            for (const id of ids) {
              const dir = join(root, 'projects', proyecto, estado, id.name);
              if (!fs.existsSync(join(dir, 'SKILL.md'))) continue;
              revisadas += 1;
              const { findings } = auditarCarpeta(dir, { id: id.name });
              for (const h of findings) {
                if (!/^(security|secret)/.test(String(h.rule ?? ''))) continue;
                if (h.severity === 'error') bloqueos += 1; else avisos += 1;
              }
            }
          }
        }
        line(bloqueos === 0, tr('cli.doctor.security-line', { revisadas, bloqueos, avisos }), tr('cli.doctor.security-remedy'));
      }
    } catch (error) {
      line(false, tr('cli.doctor.security-failed', { message: error.message }), tr('cli.doctor.security-failed-remedy'));
    }

    // Aprobaciones que quedaron a medias. `doctor` solo mira: quien repara es la siguiente aprobacion de ese
    // proyecto (que recupera dentro del cerrojo antes de tocar nada) o una recuperacion explicita. Se dice
    // aqui porque, si no, una intencion puede quedarse en `.tx/` sin que nadie la vea nunca.
    try {
      const { diagnosticarTransacciones } = await import('../lib/approve-tx.mjs');
      const { leerProyectosDelAlmacen } = await import('../lib/compiler.mjs');
      const almacen = leerProyectosDelAlmacen(root);
      if (almacen.estado === 'legible') {
        for (const proyecto of almacen.proyectos) {
          for (const t of diagnosticarTransacciones({ root, key: proyecto }).pendientes) {
            const datos = {
              id: t.id ?? t.tx, proyecto, estado: t.estado, tx: t.tx,
              problemas: t.problemas.join('; ') || tr('cli.doctor.tx-no-detail'),
            };
            // Una transaccion a medias impide decir "everything in place" (o se revierte, o se completa),
            // pero no es lo mismo que una inconsistencia: `revert`/`complete`/`mismatch` se cierran solos en
            // la siguiente aprobacion, y se marcan como pendientes. `inconsistent`/`unreadable` son rojo.
            const grave = t.estado === 'inconsistent' || t.estado === 'unreadable';
            const clave = grave ? 'cli.doctor.tx-inconsistent'
              : t.problemas.length > 0 ? 'cli.doctor.tx-pending-detail' : 'cli.doctor.tx-pending';
            bad += 1;
            process.stdout.write(`${(grave ? tr('cli.mark.fail') : tr('cli.mark.pending')).padEnd(6)} ${tr(clave, datos)}\n`);
            process.stdout.write(`${tr('cli.doctor.remedy', { remedy: tr('cli.doctor.tx-remedy') })}\n`);
          }
        }
      }
    } catch (error) {
      line(false, tr('cli.doctor.tx-failed', { message: error.message }), tr('cli.doctor.tx-remedy'));
    }

    // El idioma, con su fuente. Informativo: un `DSH_LANG` invalido no impide activar el plugin, pero se dice
    // una vez y con el valor recibido -callarlo seria peor que el propio error-.
    {
      const info = resolveLang({ fresh: true });
      process.stdout.write(`\n${tr('doctor.language', { lang: info.lang, source: info.source }, { lang: info.lang })}\n`);
      if (info.invalidEnv !== undefined) process.stdout.write(`  ${tr('lang.env-invalid', { value: info.invalidEnv }, { lang: info.lang })}\n`);
      if (info.invalidConfig !== undefined) process.stdout.write(`  ${tr('lang.config-invalid', { value: info.invalidConfig }, { lang: info.lang })}\n`);
      const faltan = clavesFaltantes(info.lang);
      if (faltan.length > 0) process.stdout.write(`${tr('cli.doctor.catalogue-incomplete', { n: faltan.length })}\n`);
    }

    process.stdout.write(`${tr('cli.doctor.deps-header', { n: declaredNames.length })}\n`);
    line(declaredNames.length > 0, tr('cli.doctor.deps-declared'), tr('cli.doctor.deps-declared-remedy'));

    const missing = declaredNames.filter((name) => !fs.existsSync(join(packageRoot, 'node_modules', name)));
    line(missing.length === 0, tr('cli.doctor.installed', { ok: declaredNames.length - missing.length, total: declaredNames.length }),
      tr('cli.doctor.missing-remedy', { list: `${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '...' : ''}` }));

    // No basta con que la carpeta exista: lo que importa es que el modulo se pueda CARGAR.
    for (const name of ['@deepseek-ai/dsh-tools', 'zod']) {
      try {
        const loaded = await import(name);
        const version = JSON.parse(fs.readFileSync(join(packageRoot, 'node_modules', name, 'package.json'), 'utf8')).version;
        line(true, tr('cli.doctor.loads', { name, version, declarada: declared[name] && declared[name] !== version ? tr('cli.doctor.loads-declared', { version: declared[name] }) : '' }));
        if (name === '@deepseek-ai/dsh-tools' && typeof loaded.defineTool !== 'function') {
          line(false, tr('cli.doctor.no-define-tool'), tr('cli.doctor.no-define-tool-remedy'));
        }
        // Zod tiene que ser Zod: el registro de proyecciones valida con `schema.parse(...)`, y una
        // biblioteca de esquemas que se resuelve llamandola como funcion (schemastery) no sirve.
        if (name === 'zod' && typeof loaded.z?.object !== 'function') {
          line(false, tr('cli.doctor.zod'), tr('cli.doctor.zod-remedy'));
        }
      } catch (error) {
        line(false, tr('cli.doctor.load-failed', { name, error: error.code ?? error.message }), tr('cli.doctor.load-failed-remedy'));
      }
    }

    // El paso que de verdad decide: compilar las definiciones como hace el arranque del plugin.
    try {
      const { defineTool } = await import('@deepseek-ai/dsh-tools');
      const defs = await import(pathToFileURL(join(packageRoot, 'lib', 'definitions.mjs')).href);
      for (const factory of ['skillPropose', 'skillVendor', 'skillReview', 'skillUpstreamCheck']) {
        try {
          const tool = defineTool(defs[factory]({ root }));
          line(true, tr('cli.doctor.tool-compiles', { name: tool.name, params: Object.keys(tool.parameters.properties ?? {}).join(', ') || tr('cli.doctor.no-params') }));
        } catch (error) {
          line(false, tr('cli.doctor.tool-failed', { factory, message: error.message }), tr('cli.doctor.tool-failed-remedy'));
        }
      }
    } catch (error) {
      line(false, tr('cli.doctor.tools-failed', { message: error.message }), tr('cli.doctor.tools-failed-remedy'));
    }

    // -- La proyeccion, contra el registro REAL ----------------------------------------------------
    //
    // Esto faltaba, y su ausencia costo caro: el registro de proyecciones **no** valida los esquemas
    // que recibe, asi que una unidad con esquemas que no validan se registra sin queja y revienta al
    // LEER sesiones (`Failed to load history: ... def.wire.viewSchema.parse is not a function`). Un
    // adorno visual dejando el historial sin cargar. Aqui se comprueba el contrato y se proyecta de
    // verdad -snapshot y lectura en frio-, para que eso se vea antes de instalar y no despues.
    try {
      const { learningProjection, projectionContractProblems } = await import(pathToFileURL(join(packageRoot, 'lib', 'projection.mjs')).href);
      const definition = learningProjection();
      const problems = projectionContractProblems(definition);
      line(problems.length === 0, tr('cli.doctor.projection-ok', { key: definition.key }),
        problems.join(' - ') || tr('cli.doctor.projection-remedy'));

      const { Context } = await import('@deepseek-ai/cordis');
      const { default: SessionProjectionRegistry } = await import('@deepseek-ai/dsh-session-projection');
      const ctx = new Context();
      ctx.plugin(SessionProjectionRegistry);
      await new Promise((resolve) => setTimeout(resolve, 50));
      ctx.sessionProjections.register(definition);
      const session = { seq: 0, header: {}, inheritedEventCount: 0, snapshotEvents: () => [], eventAt: () => undefined };
      const live = ctx.sessionProjections.snapshot(session, [definition.key]);
      const cold = ctx.sessionProjections.restore({}, [], 0, {}, 0);
      const served = live.values[definition.key] ?? cold.snapshot.values[definition.key];
      line(served !== undefined, tr('cli.doctor.projected'), tr('cli.doctor.projected-remedy'));
    } catch (error) {
      line(false, tr('cli.doctor.projection-failed', { message: error.message }), tr('cli.doctor.projection-failed-remedy'));
    }

    // -- Los comandos humanos, y las puertas del harness ------------------------------------------
    try {
      const { skillCommands } = await import(pathToFileURL(join(packageRoot, 'lib', 'commands.mjs')).href);
      const declared = skillCommands({ root });
      const names = declared.map((c) => c.name);
      const malformed = declared.filter((c) => !/^[a-z][a-z0-9_-]*$/.test(c.name) || !c.description?.trim() || typeof c.handler !== 'function');
      line(malformed.length === 0 && names.includes('skill-approve') && names.includes('skill-auto'),
        tr('cli.doctor.commands-ok', { names: names.join(', ') }),
        tr('cli.doctor.commands-remedy'));
    } catch (error) {
      line(false, tr('cli.doctor.commands-failed', { message: error.message }), tr('cli.doctor.commands-failed-remedy'));
    }

    // -- Los nombres del menu: uno por operacion, en el idioma resuelto -------------------------------
    //
    // Antes habia 15 alias y el menu anunciaba 31 filas (16 canonicos + 15 alias), porque el harness no
    // filtra por metadatos. Ya no hay alias: el conjunto activo tiene **una fila por operacion**, con el
    // nombre del idioma resuelto, y el nombre del otro idioma no se registra (no es invocable). Lo que se
    // cuenta aqui es lo que el registro va a servir, construido desde el mapa, no un numero escrito a mano.
    try {
      const { skillCommands } = await import(pathToFileURL(join(packageRoot, 'lib', 'commands.mjs')).href);
      const { createLocalizedSet, LOCALIZED_OPERATIONS } = await import(pathToFileURL(join(packageRoot, 'lib', 'localized-commands.mjs')).href);
      const idioma = resolveLang({ root, fresh: true }).lang;
      const conjunto = createLocalizedSet({ definitions: skillCommands({ root }) });
      const filas = conjunto.namesFor(idioma);
      const unNombrePorIdioma = conjunto.operations.every((op) => typeof op.byLang.en.name === 'string' && typeof op.byLang.es.name === 'string');
      line(unNombrePorIdioma && filas.length === LOCALIZED_OPERATIONS.length,
        tr('cli.doctor.names-ok', { n: LOCALIZED_OPERATIONS.length, filas: filas.length, lang: idioma, names: filas.join(', ') }, { lang: idioma }),
        tr('cli.doctor.names-remedy', {}, { lang: idioma }));
    } catch (error) {
      line(false, tr('cli.doctor.names-failed', { message: error.message }), tr('cli.doctor.names-failed-remedy'));
    }

    // -- Las filas de pendientes: la superficie que convierte aprobar en elegir --------------------
    //
    // Medido con el usuario delante: veia la lista de pendientes y no encontraba como elegir una, porque
    // el compositor no ofrece una lista pulsable para los argumentos de un comando. Las filas son
    // comandos sin argumentos que el menu `/` ofrece; si su composicion se rompe, autorizar vuelve a ser
    // una sintaxis que hay que recordar.
    try {
      const { pendingRowsFor, ROW_VERBS } = await import(pathToFileURL(join(packageRoot, 'lib', 'pending-rows.mjs')).href);
      const { pending: pendingOf, projectKey: keyOf } = await import(pathToFileURL(join(packageRoot, 'lib', 'compiler.mjs')).href);
      const cwd = process.cwd();
      const key = typeof flags.projectKey === 'string' ? flags.projectKey : keyOf(cwd);
      const waiting = key === null ? [] : pendingOf({ root, key });
      const rows = key === null || typeof flags.projectKey === 'string' ? null : pendingRowsFor({ root, cwd });
      const malformed = (rows ?? []).filter((row) => !/^[a-z][a-z0-9_-]*$/.test(row.name) || row.description.trim().length === 0);
      line(malformed.length === 0, rows === null
        ? tr('cli.doctor.rows-pending', { n: waiting.length, key: key ?? tr('cli.no-scope-label') })
        : tr('cli.doctor.rows-ok', { n: waiting.length, rows: rows.length }),
        tr('cli.doctor.rows-remedy'));
      if (rows !== null) {
        // El numero de verbos sale del propio artefacto. Estaba escrito a mano como `* 3` desde que los
        // verbos eran tres, y con `publish` (cuatro) el diagnostico se contradecia con la linea de arriba
        // ("1 pendientes -> 4 filas del menu" y acto seguido "ofrece sus tres verbos") y cerraba en rojo
        // un almacen sano. Un recuento clavado no mide el menu: mide la memoria de quien lo escribio.
        const verbos = ROW_VERBS.length;
        line(rows.length === waiting.length * verbos, tr('cli.doctor.rows-verbs', { n: verbos }), tr('cli.doctor.rows-verbs-remedy'));
      }
    } catch (error) {
      line(false, tr('cli.doctor.rows-failed', { message: error.message }), tr('cli.doctor.rows-failed-remedy'));
    }

    // Compilar las herramientas y proyectar la unidad cubre dos caminos; el resto de los contratos con el
    // harness viven en pruebas que ya se ejecutan solas. Aqui se EJECUTAN, en vez de reimplementarlas: un
    // diagnostico que duplica la puerta acaba diciendo algo distinto que la puerta.
    try {
      const { spawnSync } = await import('node:child_process');
      const gates = [
        'tests/output-contract.test.mjs',      // el valor de cada herramienta contra el esquema que el harness valida
        'tests/projection-contract.test.mjs',  // el registro de proyecciones real
        'tests/catalog-freshness.test.mjs',    // la frescura del catalogo, sin reiniciar
        'tests/auto-approve.test.mjs',         // el modo de aprobacion automatica por sesion
        'tests/commands.test.mjs',             // los comandos humanos, camino por camino
        'tests/pending-rows.test.mjs',         // las filas que el menu ofrece por cada pendiente
      ];
      const run = spawnSync(process.execPath, ['--test', ...gates], { cwd: packageRoot, encoding: 'utf8' });
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
      const failed = run.status !== 0 || /failing tests/.test(output);
      line(!failed, tr('cli.doctor.gates-ok'), tr('cli.doctor.gates-remedy'));
    } catch (error) {
      line(false, tr('cli.doctor.gates-failed', { message: error.message }), tr('cli.doctor.tools-failed-remedy'));
    }

    // -- La propiedad del puesto: se informa, no se suspende por ella -------------------------------
    //
    // Sin declarar, el plugin trabaja igual -no compite fuera de DSH-, asi que esto **no** es un fallo:
    // es el recordatorio donde el humano lo va a ver. Un diagnostico que se pone rojo por una decision
    // que nadie ha tomado ensena a ignorar el rojo. Lo que si importa decir: el estado real (no solo
    // "sin declarar": tambien una declaracion rota) y si el barrido del puesto pudo ser completo.
    try {
      const {
        inventario: inventariar, leerPropiedad: leer, proyectosConocidos: proyectos, SOLO_DSH: soloDsh, MAQUINA: maquina,
        estadoEnTexto, motivoEnTexto,
      } = await import(pathToFileURL(join(packageRoot, 'lib', 'scope.mjs')).href);
      const declaracion = leer({ root });
      const datos = inventariar({ root, curada: curatedLibraryRoot(), proyectos: proyectos({ root }) });
      const cobertura = datos.completo
        ? tr('cli.doctor.coverage-full', { ids: datos.totales.ids, colisiones: datos.totales.colisiones })
        : tr('cli.doctor.coverage-partial', { fuentes: datos.sinLeer.map((fuente) => `${fuente.nombre} (${estadoEnTexto(fuente.estado)})`).join(', ') });
      line(declaracion.estado !== 'invalida' && declaracion.estado !== 'ilegible', declaracion.estado === 'declarada'
        ? tr('cli.doctor.ownership-declared', { ownership: declaracion.ownership, cobertura })
        : tr('cli.doctor.ownership-other', {
          estado: estadoEnTexto(declaracion.estado).toUpperCase(),
          motivo: motivoEnTexto(declaracion.motivo),
          dshOnly: soloDsh,
          machine: maquina,
          cobertura,
        }),
        tr('cli.doctor.ownership-remedy'));
    } catch (error) {
      line(false, tr('cli.doctor.ownership-failed', { message: error.message }), tr('cli.doctor.ownership-failed-remedy'));
    }

    process.stdout.write(bad === 0
      ? `\n${tr('cli.doctor.all-ok')}\n`
      : `\n${tr('cli.doctor.bad', { n: bad })}\n`);
    process.exit(bad === 0 ? 0 : 1);
  }

  case 'audit': {
    // Auditoria integral, en SOLO LECTURA: mira el almacen entero con la misma puerta que decide una
    // aprobacion y dice que incumple cada skill, con que valor, contra que umbral y por donde se arregla.
    // No repara nada: senalar es lo que se le pide. Es el primer paso para decidir que se corrige.
    const { auditarAlmacen, resumenDeAuditoria } = await import('../lib/audit.mjs');
    const estados = flags.estado !== undefined ? String(flags.estado).split(',').map((e) => e.trim()) : null;
    const informe = auditarAlmacen({ root, curated: curatedLibraryRoot(), estados });

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(informe, null, 2)}\n`);
      process.exit(informe.totals.error + informe.totals.unreadable > 0 ? 1 : 0);
    }

    const salida = [tr('cli.audit.title'), '', resumenDeAuditoria(informe), ''];

    if (informe.byRule.length > 0) {
      salida.push(tr('cli.audit.by-rule'));
      for (const regla of informe.byRule) {
        salida.push(tr('cli.audit.rule-row', {
          severity: regla.severity, rule: regla.rule, count: regla.count, skills: regla.skills.length,
        }));
        salida.push(tr('cli.audit.rule-fix', { fix: arregloDeHallazgo(regla) }));
      }
      salida.push('');
    }

    if (informe.contenedores.length > 0) {
      salida.push(tr('cli.audit.container'));
      for (const c of informe.contenedores) salida.push(tr('cli.audit.container-row', { severity: c.severity, message: fraseDeHallazgo(c) }));
      salida.push('');
    }

    // El detalle: por defecto lo que NO pasa, que es lo que hay que mirar. `--todo` incluye las que pasan.
    const conHallazgo = informe.skills.filter((s) => flags.todo || s.status !== 'PASS');
    if (conHallazgo.length > 0) {
      salida.push(tr('cli.audit.detail-header', { shown: conHallazgo.length, total: informe.totals.total }));
      for (const skill of conHallazgo) {
        const m = skill.medidas;
        salida.push(`\n${tr('cli.audit.skill-row', { status: skill.status.padEnd(10), key: skill.key, estado: etiquetaDeEstado(skill) })}`);
        salida.push(tr('cli.audit.measures', {
          description: m ? m.description : '?',
          whenToUse: m ? m.whenToUse : '?',
          body: m ? m.body : '?',
          secciones: m ? m.secciones : '?',
        }));
        for (const f of skill.findings) {
          if (!flags.todo && f.severity === 'info') continue;
          salida.push(f.threshold !== null
            ? tr('cli.audit.finding-observed', {
              severity: f.severity, rule: f.rule, observed: JSON.stringify(f.observed), threshold: JSON.stringify(f.threshold),
            })
            : tr('cli.audit.finding-plain', { severity: f.severity, rule: f.rule, observed: JSON.stringify(f.observed) }));
          salida.push(tr('cli.audit.finding-message', { message: fraseDeHallazgo(f) }));
          salida.push(tr('cli.audit.finding-fix', { fix: arregloDeHallazgo(f) }));
        }
      }
      salida.push('');
    }

    salida.push(informe.totals.error + informe.totals.unreadable > 0
      ? tr('cli.audit.errors', { n: informe.totals.error + informe.totals.unreadable })
      : tr('cli.audit.no-errors'));
    process.stdout.write(`${salida.join('\n')}\n`);
    process.exit(informe.totals.error + informe.totals.unreadable > 0 ? 1 : 0);
  }

  case 'repair': {
    // Prepara la correccion de una skill viva a partir de lo que la auditoria encontro. **No activa nada**:
    // deja la propuesta lista (o dice por que no se puede) para que la revise una persona o la promocione
    // el motor si su nivel esta autorizado.
    const { reparar } = await import('../lib/repair.mjs');
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const r = reparar(id, key, { root, curated: curatedLibraryRoot(), cwd: process.cwd() });
    if (r.status === 'missing') { process.stderr.write(`${motivoDeReparacion(r)}\n`); process.exit(1); }
    const lineas = [];
    lineas.push(tr('cli.repair.title', { id, key }));
    if (r.status === 'nothing-to-do') {
      lineas.push(tr('cli.repair.nothing', { reason: motivoDeReparacion(r) }), '');
      process.stdout.write(`${lineas.join('\n')}\n`);
      break;
    }
    lineas.push(tr('cli.repair.base', { state: r.base.state, hash: String(r.base.hash).slice(0, 12) }));
    lineas.push(`${tr('cli.repair.level', { nivel: r.nivel })}${r.nivel === 1 ? tr('cli.repair.level-1') : r.nivel === 2 ? tr('cli.repair.level-2') : ''}`);
    if (r.reparaciones?.length) {
      lineas.push(tr('cli.repair.repairs'));
      for (const rep of r.reparaciones) {
        lineas.push(tr('cli.repair.repair-row', {
          level: rep.nivel,
          rule: rep.regla,
          describe: fraseDeReparacion(rep.describe, rep.describeCode),
        }));
      }
    }
    if (r.movidas?.length) lineas.push(tr('cli.repair.moved', { list: r.movidas.map((m) => `${m.titulo} -> ${m.ruta}`).join(', ') }));
    if (r.status === 'blocked') {
      lineas.push(tr('cli.repair.blocked'));
      for (const b of r.bloqueos) {
        lineas.push(tr('cli.repair.block-row', {
          rule: b.rule,
          motivo: fraseDeReparacion(b.motivo, b.motivoCode, b.motivoParams ?? {}),
        }));
      }
      lineas.push(`    ${motivoDeReparacion(r)}`);
    } else if (r.status !== 'proposed') {
      lineas.push(tr('cli.repair.no-proposal', { status: r.status }));
      for (const e of r.errors ?? []) lineas.push(tr('cli.repair.error-row', { error: e }));
      for (const x of r.conflicts ?? []) lineas.push(tr('cli.repair.conflict-row', { id: x.id, reason: x.reason }));
      if (r.reason) lineas.push(`    ${motivoDeReparacion(r)}`);
      lineas.push(tr('cli.repair.nothing-changed'));
    } else {
      lineas.push(tr('cli.repair.diff', {
        added: r.diff?.lineas?.anadidas?.length ?? 0,
        removed: r.diff?.lineas?.eliminadas?.length ?? 0,
        before: r.forma.bytesAntes,
        after: r.forma.bytesDespues,
        transformations: r.forma.transformaciones.join(', ') || tr('cli.repair.no-transform'),
      }));
      const check = checkProposal(id, key, { root, curated: curatedLibraryRoot() });
      lineas.push(tr('cli.repair.gate', {
        gate: check.ok ? tr('cli.repair.gate-ok') : tr('cli.repair.gate-fail', { error: check.errors[0] }),
      }));
      lineas.push('', tr('cli.repair.next-promote', { id, nivel: r.nivel }));
      lineas.push(tr('cli.repair.next-show', { id }));
    }
    if (r.notas?.length) {
      lineas.push('', tr('cli.repair.engine-notes'));
      for (const nota of r.notas) {
        lineas.push(nota === 'seccion-ajena' ? tr('cli.repair.foreign-section') : `    - ${nota}`);
      }
    }
    if (r.sinReparacion?.length) {
      lineas.push('', tr('cli.repair.not-fixable'));
      for (const s of r.sinReparacion) {
        lineas.push(tr('cli.repair.block-row', {
          rule: s.rule,
          motivo: s.motivo === undefined ? tr('cli.repair.no-catalogue') : fraseDeReparacion(s.motivo, s.motivoCode, s.motivoParams ?? {}),
        }));
      }
    }
    process.stdout.write(`${lineas.join('\n')}\n`);
    break;
  }

  case 'promote': {
    // Aplica y activa una correccion YA preparada. Por defecto **no activa nada solo**: hay que decir que
    // niveles estan autorizados, y el 3 no se autoriza nunca por aqui.
    const { promover, detalleDePrueba, motivoDePromocion } = await import('../lib/promote.mjs');
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const niveles = flags.nivel !== undefined
      ? String(flags.nivel).split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n))
      : [];
    if (niveles.includes(3)) {
      process.stderr.write(`${tr('cli.promote.level-3')}\n`);
      process.exit(2);
    }
    if (flags.dry) {
      // Solo las pruebas: la informacion de la decision, sin escribir nada.
      const { pruebasDeRegresion, detalleDePrueba } = await import('../lib/promote.mjs');
      const { readFileSync: leer, existsSync: hay } = await import('node:fs');
      const { join: unir } = await import('node:path');
      const metaFile = unir(root, 'projects', key, 'proposed', id, 'meta.json');
      if (!hay(metaFile)) { process.stderr.write(`${tr('cli.promote.no-proposal', { id, key })}\n`); process.exit(1); }
      const meta = JSON.parse(leer(metaFile, 'utf8'));
      const r = pruebasDeRegresion(id, key, meta, { root, curated: curatedLibraryRoot() });
      process.stdout.write([
        tr('cli.promote.dry-title', { id }),
        ...r.pruebas.map((p) => tr('cli.promote.test-row', { mark: p.ok ? tr('cli.mark.ok') : tr('cli.mark.fail'), name: p.nombre.padEnd(22), detail: detalleDePrueba(p) })),
        tr('cli.promote.dry-result', { result: r.ok ? tr('cli.promote.pass') : tr('cli.promote.fail') }),
        '',
      ].join('\n'));
      process.exit(r.ok ? 0 : 1);
    }
    const r = promover(id, key, { root, curated: curatedLibraryRoot(), cwd: process.cwd(), niveles });
    const texto = [tr('cli.promote.title', { id, key }), tr('cli.promote.level', { nivel: r.nivel ?? '?' })];
    // El lote se anota tambien en el resultado del CLI: cuando espera por el lote, se ve por que espera.
    if (r.grupo) texto.push(tr('cli.promote.batch', { group: r.grupo }));
    if (r.regresion) {
      for (const p of r.regresion.pruebas) {
        texto.push(tr('cli.promote.test-row', { mark: p.ok ? tr('cli.mark.ok') : tr('cli.mark.fail'), name: p.nombre.padEnd(22), detail: detalleDePrueba(p) }));
      }
    }
    texto.push('');
    if (r.status === 'promoted') {
      texto.push(tr('cli.promote.promoted', { before: String(r.hashAnterior).slice(0, 12), after: String(r.hashResultante).slice(0, 12) }));
      texto.push(tr('cli.promote.previous', { path: r.superseded ?? tr('cli.promote.no-previous') }));
    } else if (r.status === 'reverted') {
      texto.push(tr('cli.promote.reverted', { reason: motivoDePromocion(r) }));
      texto.push(tr('cli.promote.reverted-hash', { hash: String(r.hashRestaurado).slice(0, 12) }));
    } else if (r.status === 'pending') {
      texto.push(tr('cli.promote.pending', { reason: motivoDePromocion(r) }));
      if (r.nivel <= 2) texto.push(tr('cli.promote.activate', { id, nivel: r.nivel }));
      else texto.push(tr('cli.promote.needs-human', { id }));
    } else {
      texto.push(tr('cli.promote.status', { status: r.status.toUpperCase(), reason: motivoDePromocion(r) }));
    }
    if (r.status !== 'promoted' && r.status !== 'reverted') texto.push(tr('cli.promote.unchanged'));
    texto.push('');
    process.stdout.write(texto.join('\n'));
    process.exit(r.status === 'promoted' || r.status === 'pending' || r.status === 'reverted' ? 0 : 1);
  }

  case 'history': {
    const { historial, ciclos } = await import('../lib/promote.mjs');
    const key = scope();
    const filas = historial(key, { root, id: positional[0] ?? null, grupo: flags.grupo ?? null });
    if (filas.length === 0) { process.stdout.write(`${tr('cli.history.empty', { key })}\n`); break; }
    const texto = [tr('cli.history.title', { key })];
    for (const f of filas) {
      texto.push(tr('cli.history.row', {
        at: f.at,
        decision: (f.decision ?? '?').padEnd(24),
        id: f.id,
        nivel: f.nivel,
        group: f.group ? tr('cli.history.group', { group: f.group }) : '',
      }));
      texto.push(tr('cli.history.rules', { rules: f.reglas.join(', ') || tr('cli.history.no-rules'), tests: f.pruebas.join(' ') }));
      if (f.anterior || f.resultado) {
        texto.push(tr('cli.history.hashes', {
          before: String(f.anterior).slice(0, 12),
          after: String(f.resultado ?? tr('cli.history.no-result')).slice(0, 12),
        }));
      }
      if (f.why) texto.push(tr('cli.history.why', { why: f.why }));
    }
    const repetidas = ciclos({ key, root });
    if (repetidas.length > 0) {
      texto.push('', tr('cli.history.cycles'));
      for (const c of repetidas) {
        texto.push(tr('cli.history.cycle-row', { id: c.id, rules: c.reglas, promotions: c.promociones, last: c.ultima }));
      }
    }
    texto.push('');
    process.stdout.write(texto.join('\n'));
    break;
  }

  case 'review': {
    // La superficie de decision para quien no quiere recordar la sintaxis de un comando. Se arranca a
    // mano, escucha solo en 127.0.0.1 y exige el token que se imprime aqui: ver lib/review.mjs.
    const key = scope();
    const port = flags.port !== undefined ? Number(flags.port) : 0;
    const { createReviewServer } = await import('../lib/review.mjs');
    const review = createReviewServer({
      root,
      key,
      check: checkSkill,
      // Se ata la raiz del almacen aqui: la pagina nunca debe poder actuar sobre otro almacen.
      approve: (id, projectKey) => approve(id, projectKey, { root }),
      reject: (id, projectKey) => reject(id, projectKey, { root }),
      port,
    });
    const actual = await review.listen();
    process.stdout.write([
      tr('cli.review.title', { key }),
      '',
      `  ${review.urlFor(actual)}`,
      '',
      tr('cli.review.open'),
      tr('cli.review.no-token'),
      tr('cli.review.ctrl-c'),
      '',
    ].join('\n'));
    break;
  }

  default:
    usage(2);
}
