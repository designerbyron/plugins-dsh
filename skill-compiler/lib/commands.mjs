/**
 * commands.mjs — la superficie humana de autorización, dentro del harness.
 *
 * ── Por qué comandos, y no una herramienta ni un botón ───────────────────────────────────────────
 *
 * La regla del plugin no cambia: **aprobar no es una herramienta del modelo**. Si lo fuera, el modelo
 * podría auto-aprobarse su propuesta y la revisión humana sería decorativa. Los comandos del harness son
 * la superficie que faltaba: los escribe una persona en el compositor, corren **contra el agente sin
 * crear mensaje del modelo**, el resultado se pinta en la interfaz y el run queda registrado en el log
 * de la sesión. Decidir sigue siendo humano; lo que cambia es que ya no hay que salir del harness.
 *
 * ── Dos formas de llegar a la misma decisión ─────────────────────────────────────────────────────
 *
 *   1. Los comandos con argumentos (`/skill-approve <id>`), para quien ya sabe el id.
 *   2. Las **filas de pendientes** (`lib/pending-rows.mjs`), que se anuncian en el menú `/` y se eligen
 *      con el ratón o las flechas. Un comando del host sin argumentos declarados se ejecuta en el acto
 *      al elegirlo, así que seleccionar en el menú **es** la decisión: sin recordar ninguna sintaxis.
 *
 * Las dos vías llaman a las mismas tres acciones de aquí abajo. Una regla, una implementación: en
 * particular la puerta previa a aprobar es la MISMA (`checkProposal`), así que ninguna forma de aprobar
 * puede quedar sin validación.
 *
 * ── Después de aprobar, el catálogo se avisa ─────────────────────────────────────────────────────
 *
 * El registro de skills del harness cachea catálogos y no tiene TTL: si nadie invalida, la skill
 * recién aprobada no llega al agente hasta reiniciar. Por eso cada mutación avisa a la señal de
 * catálogo (`catalog.notify()`), que es la que llama a la invalidación del registro. Ese aviso es lo
 * que hace cierta la promesa de «usable sin reiniciar».
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AUTO_COMMAND, autoApproveFromEvents, parseAutoCommand } from './auto-approve.mjs';
import { ejecutarAprobacion, recuperarTransacciones } from './approve-tx.mjs';
import { conCerrojo } from './lock.mjs';
import {
  ambito,
  approve, checkProposal, curatedLibraryRoot, defaultRoot, disable, enable, listForProject, locate, move, pending, sugerenciaDeId,
  projectKey, reject, retire, retired,
} from './compiler.mjs';
import { anotarEntradaEnDiario, cambioEnTexto, diagnosticoDeId, ficherosQueDifieren, huellaDeContenido, motivoDeIdInseguro } from './security.mjs';
import { lineasDePuerta } from './audit.mjs';
import { medirAutoActualizacion } from './auto-update.mjs';
import { scopeOf } from './definitions.mjs';
import { t } from './i18n/index.mjs';
import { pendingRowsFor } from './pending-rows.mjs';
import {
  MAQUINA, SOLO_DSH, declararPropiedad, inventario, leerPropiedad, proyectosConocidos, propiedadEnTexto,
  textoDeSistemas, textoDelEstado,
} from './scope.mjs';

const ok = (text, extra = {}) => ({ kind: 'success', text, ...extra });
const bad = (text, extra = {}) => ({ kind: 'error', text, ...extra });

/** Los comandos son superficie humana: un fallo se cuenta como texto, nunca se lanza hacia el harness. */
const guarded = (run) => (invocation, ...rest) => {
  try {
    return run(invocation, ...rest);
  } catch (error) {
    return bad(t('code.internal-error', { message: error.message }), { code: 'internal-error', params: { message: error.message } });
  }
};

// Una pendiente que actualiza algo activo se anuncia como tal: el mismo id en dos listas, sin decirlo,
// se lee como que la aprobación anterior no sirvió de nada.
const bullet = (rows) => rows.map((row) => t('cmd.bullet.row', {
  id: row.id,
  description: row.description ?? t('cmd.bullet.no-description'),
  updates: row.updatesActive ? t('cmd.bullet.updates') : '',
  auto: row.auto ? ` · ${row.auto}` : '',
})).join('\n');

/** Sin ámbito: se traduce en cada llamada, porque el idioma se resuelve en el momento, no al importar. */
const noScope = () => t('cmd.no-scope');

/**
 * El estado de la lista, pegado al resultado de decidir: así el humano ve el efecto de lo que acaba de
 * hacer sin volver a ejecutar `/skill-proposals`. Medido con el usuario delante: aprobó una skill, su
 * bloque de propuestas siguió enseñándola como pendiente y volvió a intentarlo.
 */
const remaining = (root, key) => {
  const waiting = pending({ root, key });
  return [
    '',
    t('cmd.pending.header', { n: waiting.length }),
    waiting.length ? bullet(waiting) : t('cmd.bullet.none'),
  ];
};

/** El ámbito sale del cwd de la sesión, igual que en las herramientas: el humano no lo declara. */
export function scopeOfAgent(agent) {
  const cwd = scopeOf({ agent });
  return { cwd, key: projectKey(cwd) };
}

// ── Las tres acciones ────────────────────────────────────────────────────────────────────────────
//
// Viven fuera de los handlers porque las usan dos superficies: el comando con argumentos y la fila del
// menú. Duplicarlas sería cómo una de las dos se queda sin la puerta en el próximo cambio.

/**
 * Lee una skill entera —la propuesta pendiente o la ya activa— y, si está pendiente, **su veredicto de
 * puerta**: los fallos que impiden aprobarla y los avisos que exigirán `--force`. Sin eso, decidir
 * sobre una propuesta sería decidir a ciegas.
 */
export function viewProposal({ root = defaultRoot(), cwd, key, id }) {
  if (key === null) return bad(noScope());
  const wanted = String(id ?? '').trim();
  if (wanted === '') return bad(t('cmd.show.missing-id'));

  const proposal = pending({ root, key }).find((row) => row.id === wanted);
  const active = listForProject(cwd, { root }).find((row) => row.id === wanted);
  const chose = proposal ?? active;
  if (chose === undefined) return noEstáElId(wanted, key, root, { que: 'learned-skill' });

  if (proposal === undefined) {
    return ok([t('cmd.show.active', { id: wanted }), `${chose.path}`, '', readFileSync(chose.path, 'utf8')].join('\n'));
  }

  const check = checkProposal(wanted, key, { root });
  return ok([
    t('cmd.show.pending', { id: wanted }),
    `${chose.path}`,
    '',
    check.ok ? t('cmd.show.gate-ok') : t('cmd.show.gate-fail'),
    // Las lineas se componen de los HALLAZGOS (que llevan codigo), no de su texto crudo: la misma puerta que la
    // CLI y la pagina de revision, en el idioma de la sesion. `check.errors`/`check.warnings` siguen siendo el
    // dato que viaja en `params`.
    ...lineasDePuerta(check.findings, 'error', check.errorLines, check.errors).map((e) => t('cmd.show.gate-error', { error: e })),
    ...lineasDePuerta(check.findings, 'warn', null, check.warnings).map((w) => t('cmd.show.gate-warning', { aviso: w })),
    ...(check.warnings.length > 0 ? ['', t('cmd.show.force-hint', { id: wanted })] : []),
    '',
    readFileSync(chose.path, 'utf8'),
  ].join('\n'));
}

/** Activa una propuesta, y sólo si pasa la puerta. `force` acepta los avisos; nunca salta los fallos. */
/**
 * El estado funcional que deja cada `code` del motor.
 *
 * Es DATO del contrato por elemento, no presentacion: el panel decide por `state` + `code` en vez de leer la
 * frase de la primera linea. Un codigo que no este en la tabla no se adivina (sale `unknown`) porque inventar
 * un estado es peor que declararlo desconocido.
 */
const ESTADO_DE_CODIGO = Object.freeze({
  activated: 'approved',
  'already-active': 'approved',
  'updated-disabled': 'disabled',
  published: 'published',
  'already-published': 'published',
  'set-aside': 'rejected',
  'already-set-aside': 'rejected',
  disabled: 'disabled',
  enabled: 'approved',
  retired: 'retired',
});

/**
 * Aprobar **varias** de una vez: la misma puerta, una a una, con resultado por elemento.
 *
 * No es una transacción y no lo finge: cada id se aprueba o falla por su cuenta, y el informe dice cuál fue
 * cuál. Existe porque el panel ejecutaba N órdenes del host y el host no las ejecutaba: con una sola orden —y
 * una sola entrada— el lote no depende de que el host entienda diez llamadas.
 *
 * @returns `ok` si se aprobaron todas; `bad` si alguna falló, con el detalle de todas (un lote con un fallo
 *   necesita que alguien lo mire, y un `success` lo escondería).
 */
export function aprobarLote({ root, key, ids = [], scope = 'project', force = false, catalog } = {}) {
  if (key === null) return bad(noScope());
  const limpios = [...new Set(ids.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (limpios.length === 0) return bad(t('cmd.batch.no-ids'));
  const resultados = [];
  for (const id of limpios) {
    const r = approveProposal({ root, key, id, force, scope, catalog: null });
    resultados.push({
      id,
      ok: r.kind === 'success',
      code: typeof r.code === 'string' ? r.code : '',
      params: r.params ?? {},
      primera: String(r.text ?? '').split('\n')[0],
    });
  }
  const bien = resultados.filter((r) => r.ok).length;
  const mal = resultados.length - bien;
  if (bien > 0) catalog?.notify();
  const texto = [
    t('cmd.batch.title', { n: resultados.length, done: bien, failed: mal }),
    t('cmd.batch.scope', {
      scope: scope === 'global' ? t('cmd.batch.scope-global') : t('cmd.batch.scope-local', { key }),
    }),
    '',
    ...resultados.map((r) => `${r.ok ? 'ok   ' : 'FALLO'} ${r.id} — ${r.primera}`),
    ...(mal > 0 ? ['', t('cmd.batch.failed-hint')] : []),
  ].join('\n');
  // El contrato por ELEMENTO: lo que el panel necesita para decidir sin leer prosa. `text` es la frase que ve
  // el humano; `state` y `code` son el veredicto. Se anaden sin quitar los campos de siempre (`kind`, `text`),
  // asi que un consumidor viejo sigue funcionando igual.
  const items = resultados.map((r) => ({
    id: r.id,
    kind: r.ok ? 'success' : 'error',
    code: r.code,
    state: r.ok ? (ESTADO_DE_CODIGO[r.code] ?? 'unknown') : 'failed',
    params: r.params,
    text: r.primera,
  }));
  return bien === resultados.length ? ok(texto, { items }) : bad(texto, { items });
}

/**
 * El id no está: se dice la verdad y, si huele a letra cambiada, se ofrece el que sí está.
 *
 * Un «no hay ninguna propuesta» que calla cuando el id correcto está a una letra es un callejón: el humano
 * tiene que volver a mirar la lista y teclear otra vez. Medido con `dhs-nexus-protocol` (quería
 * `dsh-nexus-protocol`): el fallo era real —no había nada con ese id— pero la respuesta no ayudaba.
 */
/**
 * El id que llega de la línea de comandos, antes de mirar el disco.
 *
 * Un id es una carpeta: con `..` o una barra no es un id raro, es una ruta a otra parte. Se dice con esas
 * palabras —y no «no hay ninguna propuesta», que sería verdad y no enseñaría nada—.
 */
function idNoUtilizable(wanted) {
  // El juicio es UNO (`diagnosticoDeId`) y la frase es presentacion: se compone con la clave de su codigo, en el
  // idioma que toque. Si la clave faltara en el catalogo, se cae al motivo del propio juicio antes que ensenar
  // una clave cruda a una persona.
  const diagnostico = diagnosticoDeId(wanted);
  if (diagnostico === null) return null;
  const clave = `id.reason.${diagnostico.code}`;
  const traducido = t(clave, diagnostico.params);
  const motivo = traducido === clave ? motivoDeIdInseguro(wanted) : traducido;
  return bad([
    t('cmd.ids.unsafe', { id: wanted, motivo }),
    t('cmd.ids.unsafe-hint'),
  ].join('\n'), { code: 'unsafe-id', params: { id: wanted, motivo } });
}

function noEstáElId(wanted, key, root, { que = 'proposal' } = {}) {
  const cerca = sugerenciaDeId(wanted, key, { root });
  return bad([
    t('cmd.ids.missing', { que: t(`cmd.noun.${que}`), id: wanted, key }),
    ...(cerca
      ? [t('cmd.ids.suggestion', { cerca }), t('cmd.ids.see-all')]
      : [t('cmd.ids.see-list')]),
  ].join('\n'), { code: 'no-proposal', params: { id: wanted, key } });
}

/** El diario del proyecto: una sola ruta, para que tres caminos no inventen tres. */
const diarioDelProyecto = (root, key) => join(root, 'projects', key, 'journal.jsonl');

export function approveProposal({ root = defaultRoot(), key, id, force = false, scope = 'project', catalog, preservarEstado = false } = {}) {
  if (key === null) return bad(noScope());
  const wanted = String(id ?? '').trim();
  if (wanted === '') return bad(t('cmd.approve.missing-id'));
  const noEsId = idNoUtilizable(wanted);
  if (noEsId !== null) return noEsId;

  // Aprobar algo que ya está aprobado no es un fallo: es un acto que ya ocurrió. Decirlo con esas
  // palabras evita el «failed» que hacía pensar que la primera aprobación no había servido.
  const where = locate(wanted, key, { root });
  if (scope === 'global' && (where === 'global' || where === 'published')) {
    return ok([
      t('code.already-published', { id: wanted }),
      t('cmd.approve.no-change'),
      ...remaining(root, key),
    ].join('\n'), { code: 'already-published', params: { id: wanted } });
  }
  if (where === 'approved') {
    return ok([
      t('cmd.approve.already-active', { id: wanted, key }),
      t('cmd.approve.no-change'),
      ...remaining(root, key),
    ].join('\n'), { code: 'already-active', params: { id: wanted } });
  }
  if (where === 'rejected') {
    return bad([
      t('cmd.approve.rejected-dir', { id: wanted, key }),
      t('cmd.approve.rejected-dir-hint'),
    ].join('\n'));
  }
  if (where === null) return noEstáElId(wanted, key, root);

  // La misma puerta que la CLI: sin ella, esta vía sería una vía de aprobación sin validación.
  const check = checkProposal(wanted, key, { root });
  if (!check.ok) {
    return bad([
      t('cmd.approve.gate-failed', { id: wanted }),
      ...lineasDePuerta(check.findings, 'error', check.errorLines, check.errors).map((e) => t('cmd.approve.gate-error', { error: e })),
      t('cmd.approve.gate-hint'),
    ].join('\n'), { code: 'gate-failed', params: { id: wanted, errors: check.errors } });
  }
  if (check.warnings.length > 0 && !force) {
    return bad([
      t('cmd.approve.warnings', { id: wanted }),
      ...lineasDePuerta(check.findings, 'warn', null, check.warnings).map((w) => t('cmd.approve.warning-line', { aviso: w })),
      '',
      t('cmd.approve.force-hint', { id: wanted }),
    ].join('\n'), { code: 'with-warnings', params: { id: wanted, warnings: check.warnings } });
  }

  // Lo que se validó es lo que se mueve. Se mide la huella del **contenido** —`SKILL.md` y su material, sin
  // `meta.json`, que el movimiento reescribe a propósito— y se pasa a `approve`, que la verifica ANTES de
  // renombrar: si alguien cambió la propuesta en medio, no se mueve nada y se dice qué fichero difiere.
  const huellaAntes = huellaDeContenido(check.dir);
  // Corregir una skill apagada **sin encenderla**: el estado se lee del origen, no se pide a mano, así que no
  // hay forma de «activarla sin querer» al repararla.
  // El estado **vivo** de la skill (aprobada o apagada); `locate` mira también lo propuesto y aquí lo que
  // importa es dónde se sirve —o se dejaría de servir—.
  const estadoOrigen = ['approved', 'disabled'].find((estado) => existsSync(join(root, 'projects', key, estado, wanted))) ?? locate(wanted, key, { root });
  if (preservarEstado && estadoOrigen !== 'disabled') {
    return bad(
      t('cmd.approve.preserve-invalid', { id: wanted, estado: estadoOrigen ?? t('cmd.approve.no-live-state') }),
      { code: 'invalid-flag', params: { flag: '--preserve-state', id: wanted } },
    );
  }
  const ejecutada = conCerrojo(root, key, wanted, () => {
    // Primero, cerrar lo que haya quedado a medias de una aprobacion anterior sobre este id.
    const recuperacion = recuperarTransacciones({ root, key });
    if (scope !== 'global') {
      const r = ejecutarAprobacion({
        root, key, id: wanted, scope,
        esperada: huellaAntes,
        estado: preservarEstado ? 'disabled' : 'approved',
        nota: `aprobacion humana de ${wanted}`,
        avisos: check.warnings,
      });
      return r.ok
        ? { ok: true, path: r.path, superseded: r.superseded, manifiesto: r.manifiesto, tx: r.tx, recuperacion }
        : { ok: false, reason: r.error, problemas: r.problemas ?? [], tx: r.tx, recuperacion };
    }
    // Publicar en la biblioteca global sigue por su camino: mueve a otra raiz y deja constancia en `published/`.
    const global = approve(wanted, key, { root, scope, esperada: huellaAntes });
    return { ...global, recuperacion };
  });
  if (ejecutada?.lock) return bad(ejecutada.reason);
  if (!ejecutada.ok) {
    const lineas = [t('cmd.approve.move-failed', { id: wanted, reason: ejecutada.reason })];
    if (Array.isArray(ejecutada.problemas) && ejecutada.problemas.length > 0) lineas.push(...ejecutada.problemas);
    return bad(lineas.join('\n'));
  }
  const moved = ejecutada;

  // El catálogo acaba de cambiar: sin este aviso, la skill no llega al agente hasta reiniciar.
  catalog?.notify();

  // La aprobación queda registrada **con sus huellas**: qué contenido se aprobó y cuál quedó activo. Sin esta
  // entrada, «se aprobó» es una afirmación sin respaldo —y las aprobaciones eran justo lo único que no
  // anotaba el diario, mientras las promociones sí.
  // El asiento de una aprobacion **local** lo escribe la transaccion (`approve-tx.mjs`), que ademas
  // comprueba que quedo escrito y deshace la operacion si no. Aqui solo queda el de la publicacion global,
  // que va por otra raiz y no pasa por esa transaccion.
  if (scope === 'global') {
    anotarEntradaEnDiario(diarioDelProyecto(root, key), {
      id: wanted,
      key,
      decision: 'publicada',
      ambito: scope,
      por: 'humano',
      canal: 'comando',
      hashAnterior: huellaAntes,
      hashResultante: huellaDeContenido(join(moved.path, '..')),
      superseded: moved.superseded ?? null,
      avisos: check.warnings,
    });
  }

  // Belt and braces: si el contenido activado no es el validado, no se queda activo con un aviso — se
  // devuelve a `proposed`, se dice qué fichero difiere y la aprobación se declara fallida.
  const destino = join(moved.path, '..');
  const huellaDespues = huellaDeContenido(destino);
  if (huellaDespues !== huellaAntes) {
    const ficheros = (() => { try { return ficherosQueDifieren(check.dir, destino); } catch { return []; } })();
    const vuelta = move(root, key, wanted, 'approved', 'proposed');
    return bad([
      t('cmd.approve.drift', { id: wanted, antes: huellaAntes.slice(0, 12), despues: huellaDespues.slice(0, 12) }),
      // El dato de cada fichero (`ruta` + `cambio`) se conserva; el marcador se compone aqui, en el idioma de la
      // sesion: `(nuevo)` / `(cambio)` / `(igual)` nunca viajan como frase traducida.
      ...(ficheros.length ? [t('cmd.approve.drift-files', { ficheros: ficheros.map((f) => cambioEnTexto(f)).join(', ') })] : []),
      vuelta.ok
        ? t('cmd.approve.drift-returned')
        : t('cmd.approve.drift-return-failed', { reason: vuelta.reason }),
      t('cmd.approve.drift-superseded'),
    ].join('\n'));
  }

  return ok([
    preservarEstado
      ? t('code.updated-disabled', { id: wanted, key })
      : t('code.activated', { id: wanted, key }),
    t('cmd.approve.path', { path: moved.path }),
    ...(moved.superseded ? [t('cmd.approve.superseded', { path: moved.superseded })] : []),
    ...(check.warnings.length > 0
      ? ['', t('cmd.approve.with-warnings-header'), ...lineasDePuerta(check.findings, 'warn', null, check.warnings).map((w) => t('cmd.approve.warning-bullet', { aviso: w }))]
      : []),
    '',
    preservarEstado ? t('cmd.approve.still-off') : t('cmd.approve.now-served'),
    t('cmd.approve.invoke', { id: wanted }),
    ...remaining(root, key),
  ].join('\n'), scope === 'global'
    ? { code: 'published', params: { id: wanted, key } }
    : preservarEstado
      ? { code: 'updated-disabled', params: { id: wanted, key } }
      : { code: 'activated', params: { id: wanted, key } });
}

/** Aparta una propuesta sin borrarla: queda en `rejected/`, recuperable. */
export function rejectProposal({ root = defaultRoot(), key, id, catalog } = {}) {
  if (key === null) return bad(noScope());
  const wanted = String(id ?? '').trim();
  if (wanted === '') return bad(t('cmd.reject.missing-id'));
  const noEsId = idNoUtilizable(wanted);
  if (noEsId !== null) return noEsId;

  const where = locate(wanted, key, { root });
  if (where === 'rejected') {
    return ok([
      t('cmd.reject.already-set-aside', { id: wanted, key }),
      t('cmd.approve.no-change'),
      ...remaining(root, key),
    ].join('\n'), { code: 'already-set-aside', params: { id: wanted } });
  }
  if (where === 'approved') {
    return bad([
      t('cmd.reject.is-active', { id: wanted, key }),
      t('cmd.reject.is-active-hint'),
    ].join('\n'));
  }
  if (where === null) return noEstáElId(wanted, key, root);

  const moved = reject(wanted, key, { root });
  if (!moved.ok) return bad(t('cmd.reject.move-failed', { id: wanted, reason: moved.reason }));

  catalog?.notify();

  anotarEntradaEnDiario(diarioDelProyecto(root, key), {
    id: wanted, key, decision: 'apartada', ambito: 'project', por: 'humano', canal: 'comando',
    hashAnterior: null, hashResultante: null, superseded: moved.path ?? null,
  });

  return ok([
    t('cmd.reject.done', { id: wanted, key }),
    t('cmd.approve.path', { path: moved.path.replace(/[\\/]SKILL\.md$/, '') }),
    '',
    t('cmd.reject.no-delete'),
    ...remaining(root, key),
  ].join('\n'), { code: 'set-aside', params: { id: wanted } });
}

/**
 * Crea las definiciones base del plugin: **una por operacion, con el nombre ingles**.
 *
 * El nombre que se registra lo decide el idioma (`lib/localized-commands.mjs`), no este modulo: aqui viven el
 * handler, la pista de sus argumentos y la definicion de la que el mapa localizado hereda. El nombre espanol
 * ya no es un alias de esta tabla: es el nombre de la misma operacion en el otro idioma, y se registra **en
 * lugar** del ingles, no ademas.
 *
 * @param root - raíz del almacén.
 * @param catalog - señal de catálogo; recibe el aviso tras cada mutación.
 * @param onListed - se llama al listar las pendientes: es el momento en el que el humano va a decidir, y
 *   por tanto el momento de tener sus filas anunciadas en el menú.
 * @returns las definiciones, en la forma que espera `ctx.commands.register(...)`.
 */
export function skillCommands({ root = defaultRoot(), catalog, onListed, onMount } = {}) {
  /**
   * Envuelve una acción que **mueve** una skill para que avise al catálogo cuando de verdad movió algo.
   *
   * El registro de skills cachea los catálogos sin TTL, así que quien muta el almacén es quien tiene que
   * avisar. Aprobar y rechazar lo hacían; apagar, encender y retirar no — y el resultado era una skill
   * apagada que el agente seguía teniendo delante. Aquí el aviso no depende de que alguien se acuerde:
   * las cinco acciones pasan por el mismo envoltorio, y la suite comprueba que todas avisan.
   */
  const moveAction = (action) => (...args) => {
    const result = action(...args);
    if (result?.ok === true) catalog?.notify();
    return result;
  };
  const disableSkill = moveAction(disable);
  const enableSkill = moveAction(enable);
  const retireSkill = moveAction(retire);

  /**
   * El listado que ve el humano: qué espera su aprobación, qué está activo y qué está apagado. Vive en una
   * función porque lo usan **dos** comandos —`/skill-proposals` y `/skill-approve` sin id—: pedir a un
   * humano que recuerde un identificador para decidir es la nota al pie que este plugin viene evitando
   * desde su primera versión.
   */
  const listar = ({ agent, montaje = { ok: true } } = {}) => {
        const { cwd, key } = scopeOfAgent(agent);
        if (key === null) return bad(noScope());

        // Antes de listar, asegurar las filas: si el humano mira las pendientes, es que va a decidir.
        onListed?.();

        const waiting = pending({ root, key });
        // Una actualización se puede medir aquí mismo: el humano quiere saber, antes de marcar, si esa
        // corrección es de las que puede activar una máquina. Se mide con el MISMO medidor que decide
        // (no una etiqueta aparte), y sólo para las que son actualizaciones: una skill nueva nunca lo es.
        const MAX_MEDIDAS = 6;
        for (const fila of waiting) {
          if (!fila.updatesActive) continue;
          if (waiting.indexOf(fila) >= MAX_MEDIDAS) { fila.auto = t('cmd.list.auto-none', { max: MAX_MEDIDAS }); continue; }
          try {
            const v = medirAutoActualizacion(fila.id, key, { root, curated: curatedLibraryRoot(), cwd });
            fila.auto = v.apto
              ? t('cmd.list.auto-ok', { n: v.medidas.length })
              : t('cmd.list.auto-human', { fallan: v.fallan.slice(0, 2).join(', ') });
          } catch (error) {
            fila.auto = t('cmd.list.auto-fail', { message: error.message });
          }
        }
        const active = listForProject(cwd, { root });
        // Lo apagado no se sirve, pero el humano tiene que verlo: sin esto, la única prueba de que apagó
        // algo es el resultado de aquel comando, y no hay forma de saber qué queda por devolver.
        const fueraDeServicio = retired(key, { root }).filter((skill) => skill.state === 'disabled');
        const auto = autoApproveFromEvents(agent?.session?.snapshotEvents?.() ?? []);
        const rows = pendingRowsFor({ root, cwd });

        return ok([
          t('cmd.list.title', { cwd, key }),
          '',
          t('cmd.pending.header', { n: waiting.length }),
          waiting.length ? bullet(waiting) : t('cmd.bullet.none'),
          // Las filas del menú se nombran SIN barra: no son comandos de barra, son entradas que se eligen.
          // Escribirlas como `/skill-show-<id>` ofrecía una orden que el registro no tiene (la barra invoca
          // `/skill-show`), y encima en un nombre que cambia con el idioma.
          ...rows.map((row) => t('cmd.list.row-line', { row: row.name })),
          // La orden exacta, siempre: con filas o sin ellas. Depender del menú para decidir era depender de
          // un servicio que este anfitrión no compone en el contexto del agente (tres caminos medidos). Una
          // línea pegable decide todas y no pide recordar nada.
          ...(waiting.length > 0
            ? [
              '',
              t('cmd.list.order-all', { ids: waiting.map((fila) => fila.id).join(',') }),
              t('cmd.list.order-one'),
            ]
            : []),
          ...(rows.length > 0 ? ['', t('cmd.list.no-typing')] : []),
          '',
          t('cmd.active.header', { n: active.length }),
          active.length ? bullet(active) : t('cmd.bullet.none'),
          '',
          t('cmd.disabled.header', { n: fueraDeServicio.length }),
          fueraDeServicio.length ? bullet(fueraDeServicio) : t('cmd.bullet.none'),
          ...(fueraDeServicio.length > 0 ? [t('cmd.disabled.hint')] : []),
          '',
          auto ? t('cmd.list.auto-on') : t('cmd.list.auto-off'),
          auto ? t('cmd.list.auto-on-hint') : t('cmd.list.auto-off-hint'),
          '',
          // Sin pendientes no hay nada que anunciar: el aviso sólo aparece cuando de verdad hay una fila
          // que el menú podría ofrecer y no ofrece. Con la lista vacía era ruido en cada consulta.
          ...(montaje.ok || waiting.length === 0 ? [] : [
            t('cmd.list.mount-warning', { motivo: montaje.motivo }),
            t('cmd.list.mount-hint'),
          ]),
          t('cmd.list.with-id'),
        ].join('\n'));
  };

  /**
   * El estado de la propiedad. El texto lo compone `lib/scope.mjs` para las tres superficies —comando,
   * CLI y `doctor`—: una sola redacción, y los cuatro estados se leen distinto porque son distintos.
   */
  const textoDePropiedad = () => textoDelEstado(leerPropiedad({ root }));

  /** Declara la propiedad y devuelve el resultado en la forma que espera un comando. */
  const declararLaPropiedad = (ownership) => {
    const antes = leerPropiedad({ root });
    const r = declararPropiedad(ownership, { root, por: 'humano', esperadaHuella: antes.huella ?? undefined });
    if (!r.ok) return bad(r.reason);
    return ok([
      t('cmd.ownership.declared', { ownership }),
      `  ${propiedadEnTexto(ownership)}`,
      '',
      ownership === MAQUINA ? t('cmd.ownership.now-machine') : t('cmd.ownership.now-dsh-only'),
    ].join('\n'));
  };

  /** El inventario del puesto, con el mismo texto que imprime el CLI (`systems`). */
  const textoDelInventario = () => textoDeSistemas({
    datos: inventario({ root, curada: curatedLibraryRoot(), proyectos: proyectosConocidos({ root }) }),
    estado: leerPropiedad({ root }),
  });

  const definiciones = [
    {
      name: 'skill-proposals',
      description: t('cmd.proposals.description'),
      handler: guarded(({ agent }, montaje) => listar({ agent, montaje })),
    },

    {
      // Sólo los ids, en una línea estable: es la fuente que consulta la tarjeta para saber si lo que
      // muestra sigue pendiente. Sin esto, una tarjeta vieja ofrece decidir algo que el almacén ya no tiene
      // y la orden falla con «no hay ninguna propuesta» —un fallo que el humano no puede arreglar—.
      name: 'skill-pending',
      description: t('cmd.pending.description'),
      handler: guarded(({ agent }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(noScope());
        const waiting = pending({ root, key });
        // Los avisos viajan con los ids para que la tarjeta pueda **preguntar antes** de mandar la orden: si
        // no, la primera orden se niega y el anfitrión pinta un «failed» que el humano no ha provocado.
        const lineas = [`pendientes: ${waiting.length}`, `ids: ${waiting.map((fila) => fila.id).join(',')}`];
        const porId = new Map();
        for (const fila of waiting) {
          let avisos = [];
          try {
            const meta = JSON.parse(readFileSync(join(dirname(fila.path), 'meta.json'), 'utf8'));
            avisos = Array.isArray(meta?.warnings) ? meta.warnings.map(String) : [];
          } catch { avisos = []; }
          porId.set(fila.id, avisos);
        }
        if (porId.size > 0) {
          lineas.push(`avisos: ${[...porId].map(([id, a]) => `${id}=${a.length}`).join(',')}`);
          for (const [id, avisos] of porId) for (const aviso of avisos) lineas.push(`aviso: ${id} · ${aviso}`);
        }
        return ok(lineas.join('\n'), {
          code: 'pending-list',
          params: { ids: waiting.map((fila) => fila.id) },
        });
      }),
    },

    {
      name: 'skill-show',
      description: t('cmd.show.description'),
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { cwd, key } = scopeOfAgent(agent);
        return viewProposal({ root, cwd, key, id: rawInput });
      }),
    },

    {
      name: 'skill-approve',
      description: t('cmd.approve.description'),
      input: { hint: '<id> [--global|--local] [--force]' },
      handler: guarded(({ agent, rawInput }, montaje) => {
        const { key } = scopeOfAgent(agent);
        const input = String(rawInput ?? '').trim();
        // Sin id no es un error de sintaxis: es «enséñame qué hay». Además arma las filas de la sesión.
        if (input === '') return listar({ agent, montaje });
        const force = /(?:^|\s)--force$/.test(input);
        const global = /(?:^|\s)--global(?:\s|$)/.test(input);
        const local = /(?:^|\s)--local(?:\s|$)/.test(input);
        const id = input.replace(/(?:\s+--(?:force|global|local))+$/, '').trim();
        // Varios ids —«a,b,c» o «a b c»— son un LOTE: misma puerta, una a una, resultado por elemento.
        const ids = id.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
        if (ids.length > 1) {
          if (!global && !local) {
            return ok([
              t('cmd.batch.ask', { n: ids.length }),
              '',
              t('cmd.batch.ask-local', { key, ids: ids.join(',') }),
              t('cmd.batch.ask-global', { ids: ids.join(',') }),
              '',
              t('cmd.batch.ask-hint'),
            ].join('\n'), { code: 'scope-ask', params: { ids } });
          }
          return aprobarLote({ root, key, ids, scope: global ? 'global' : 'project', force, catalog });
        }

        // Sin ámbito dicho, se pregunta —con las dos opciones y su nombre de fila— en vez de decidir por el
        // humano. «Local» no es un defecto que se esconde: es una de las dos respuestas.
        if (!global && !local && locate(id, key, { root }) === 'proposed') {
          return ok([
            t('cmd.scope.ask', { id }),
            '',
            t('cmd.scope.ask-local', { key, id }),
            t('cmd.scope.ask-local-hint'),
            t('cmd.scope.ask-global', { id }),
            t('cmd.scope.ask-global-hint'),
            '',
            t('cmd.scope.ask-rows'),
            t('cmd.scope.ask-force'),
          ].join('\n'), { code: 'scope-ask', params: { id } });
        }

        const scope = global ? 'global' : 'project';
        const result = approveProposal({ root, key, id, force, scope, catalog });
        if (result?.kind !== 'ok') return result;
        const nota = scope === 'global'
          ? t('cmd.approve.note-global', { id })
          : t('cmd.approve.note-local', { id });
        return ok([result.text, '', nota].join('\n'));
      }),
    },

    {
      name: 'skill-publish',
      description: t('cmd.publish.description'),
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        const bruto = String(rawInput ?? '').trim();
        // `force: true` incondicional era una puerta trasera: publicar para todos se saltaba los avisos sin
        // que nadie lo dijera. Ahora se pide explícito, como en la aprobación local.
        const force = /(?:^|\s)--force$/.test(bruto);
        const id = bruto.replace(/(?:\s+--force)+$/, '').trim();
        const result = approveProposal({ root, key, id, force, scope: 'global', catalog });
        if (result?.kind !== 'ok') return result;
        return ok([result.text, '', t('cmd.publish.note-local', { id })].join('\n'));
      }),
    },

    {
      name: 'skill-scope',
      description: t('cmd.scope.description'),
      input: { hint: '<id> --global | --local' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        const input = String(rawInput ?? '').trim();
        const to = /(?:^|\s)--global(?:\s|$)/.test(input) ? 'global' : /(?:^|\s)--local(?:\s|$)/.test(input) ? 'project' : null;
        const id = input.replace(/(?:\s+--(?:global|local))+$/, '').trim();
        if (id === '') return bad(t('cmd.scope.missing-id'));
        const moved = ambito(id, key, { root, to });
        if (!moved.ok) return bad(t('cmd.scope.move-failed', { reason: moved.reason }));
        catalog?.notify();
        return ok([
          moved.scope === 'global'
            ? t('cmd.scope.now-global', { id })
            : t('cmd.scope.now-local', { id, key }),
          t('cmd.scope.path', { path: moved.path }),
          t('cmd.scope.hash', { sha: moved.sha256 }),
          moved.scope === 'global'
            ? t('cmd.scope.back-local', { id })
            : t('cmd.scope.to-global', { id }),
        ].join('\n'));
      }),
    },

    {
      name: AUTO_COMMAND,
      description: t('cmd.auto.description'),
      input: { hint: 'activar | desactivar' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(noScope());

        const decision = parseAutoCommand(rawInput);

        // Sin argumento: sólo informa. El estado se pliega del log de la sesión, que es donde vive.
        if (decision === null) {
          const active = autoApproveFromEvents(agent?.session?.snapshotEvents?.() ?? []);
          return ok([
            t('cmd.auto.title', { estado: active ? t('cmd.auto.state-on') : t('cmd.auto.state-off') }),
            '',
            active ? t('cmd.auto.on-body') : t('cmd.auto.off-body'),
            t('cmd.auto.gate-note'),
            t('cmd.auto.log-note'),
            '',
            active ? t('cmd.auto.stop-hint') : t('cmd.auto.start-hint'),
          ].join('\n'));
        }

        return ok(decision
          ? [
            t('cmd.auto.activated-title'),
            '',
            t('cmd.auto.activated-body'),
            t('cmd.auto.activated-same'),
            t('cmd.auto.activated-stop'),
          ].join('\n')
          : [
            t('cmd.auto.deactivated-title'),
            '',
            t('cmd.auto.deactivated-body'),
          ].join('\n'));
      }),
    },

    // ── El ciclo de vida, desde la sesión ───────────────────────────────────────────────────────────
    // Apagar es reversible y no se confunde con retirar. Retirar es el único gesto irreversible del
    // plugin, así que **exige un `--yes` explícito** y dice antes dónde queda el respaldo: un clic, o una
    // línea, no pueden borrar el trabajo de nadie.
    {
      name: 'skill-disable',
      description: t('cmd.disable.description'),
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(noScope());
        const id = String(rawInput ?? '').trim();
        if (id === '') return bad(t('cmd.disable.missing-id'));
        if (!existsSync(join(root, 'projects', key, 'approved', id))) {
          const donde = locate(id, key, { root });
          return bad(donde === null
            ? t('cmd.disable.not-found', { id, key })
            : t('cmd.disable.elsewhere', { id, key, donde }));
        }
        const moved = disableSkill(id, key, { root });
        if (!moved.ok) return bad(t('cmd.disable.failed', { reason: moved.reason }));
        return ok([
          t('cmd.disable.done', { id, key }),
          t('cmd.disable.done-hint', { id }),
        ].join('\n'), { code: 'disabled', params: { id } });
      }),
    },

    {
      name: 'skill-enable',
      description: t('cmd.enable.description'),
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(noScope());
        const id = String(rawInput ?? '').trim();
        if (id === '') return bad(t('cmd.enable.missing-id'));
        const moved = enableSkill(id, key, { root });
        if (!moved.ok) return bad(t('cmd.enable.failed', { reason: moved.reason }));
        return ok(t('cmd.enable.done', { id, key }), { code: 'enabled', params: { id } });
      }),
    },

    {
      name: 'skill-retire',
      description: t('cmd.retire.description'),
      input: { hint: '<id> [--yes]' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(noScope());
        const input = String(rawInput ?? '').trim();
        const yes = /(?:^|\s)--yes$/.test(input);
        const id = input.replace(/(?:\s+--yes)?$/, '').trim();
        if (id === '') return bad(t('cmd.retire.missing-id'));
        if (!yes) {
          return ok([
            t('cmd.retire.confirm', { id, key }),
            t('cmd.retire.confirm-hint'),
            t('cmd.retire.confirm-do', { id }),
          ].join('\n'));
        }
        const moved = retireSkill(id, key, { root });
        if (!moved.ok) return bad(t('cmd.retire.failed', { reason: moved.reason }));
        return ok([
          t('cmd.retire.done', { id, key }),
          t('cmd.retire.backup', { path: moved.backup }),
          t('cmd.retire.hash', { hash: moved.hash }),
          t('cmd.retire.restore', { id }),
          '',
        ].join('\n'), { code: 'retired', params: { id } });
      }),
    },

    {
      name: 'skill-retired',
      description: t('cmd.retired.description'),
      handler: guarded(({ agent }) => {
        const { cwd, key } = scopeOfAgent(agent);
        if (key === null) return bad(noScope());
        const lista = retired(key, { root });
        if (lista.length === 0) return ok(t('cmd.retired.empty', { cwd, key }));
        return ok([
          t('cmd.retired.title', { cwd, key }),
          '',
          ...lista.map((skill) => t('cmd.retired.row', {
            id: skill.id,
            estado: skill.state === 'disabled'
              ? t('cmd.retired.state-disabled')
              : t('cmd.retired.state-retired', { fecha: skill.retiredAt }),
          })),
          '',
          t('cmd.retired.hint'),
        ].join('\n'));
      }),
    },

    {
      name: 'skill-ownership',
      description: t('cmd.ownership.description'),
      input: { hint: `${SOLO_DSH}|${MAQUINA}` },
      handler: guarded(({ rawInput }) => {
        const input = String(rawInput ?? '').trim();
        return input === '' ? ok(textoDePropiedad()) : declararLaPropiedad(input);
      }),
    },

    {
      name: `skill-ownership-${SOLO_DSH}`,
      description: t('cmd.ownership.dsh-only.description'),
      handler: guarded(() => declararLaPropiedad(SOLO_DSH)),
    },

    {
      name: `skill-ownership-${MAQUINA}`,
      description: t('cmd.ownership.machine.description'),
      handler: guarded(() => declararLaPropiedad(MAQUINA)),
    },

    {
      name: 'skill-systems',
      description: t('cmd.systems.description'),
      handler: guarded(() => ok(textoDelInventario())),
    },

    {
      name: 'skill-reject',
      description: t('cmd.reject.description'),
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        return rejectProposal({ root, key, id: rawInput, catalog });
      }),
    },
  ];

  // ── El humano es el otro camino que conoce al agente ────────────────────────────────────────────
  //
  // Si el provider no llegó a montar las filas de esta sesión, ejecutar un comando es la ocasión de
  // intentarlo otra vez —y de saber si no se pudo—: sin esto, la sesión se quedaba sin superficie de
  // decisión y el único aviso era «no hay filas que decidir en el catálogo de esta sesión».
  //
  // Aquí no hay tabla de alias: los nombres espanoles viven en el mapa localizado como el nombre de su
  // operacion en el otro idioma, y el registro activo tiene uno solo por operacion.
  const montar = (invocation) => {
    try {
      return onMount?.(invocation?.agent) ?? { ok: true };
    } catch (error) {
      return { ok: false, motivo: error.message };
    }
  };
  return definiciones.map((command) => ({
    ...command,
    handler: (invocation) => command.handler(invocation, montar(invocation)),
  }));
}

/**
 * Las filas de pendientes como comandos: una por verbo y pendiente, **sin argumentos**, para que
 * elegirlas en el menú `/` sea la decisión completa.
 *
 * El ámbito se comprueba al ejecutar, no al anunciar: las filas viven en un registro global y la sesión
 * que las elige es la que manda. Una fila de otro proyecto falla con el motivo, en vez de aprobar en el
 * proyecto equivocado.
 *
 * @param rows - lo que devolvió `pendingRowsFor` o `pendingRowsForAll`.
 */
export function targetCommands({ root = defaultRoot(), catalog, rows = [] } = {}) {
  return rows.map((row) => ({
    name: row.name,
    description: row.description,
    handler: guarded(({ agent }) => {
      const { cwd, key } = scopeOfAgent(agent);
      if (key === null) return bad(noScope());
      if (key !== row.key) {
        // El texto es presentacion y vive en el catalogo: una fila de otro proyecto se lee igual en los dos
        // idiomas, y nombra el ambito con el que hay que abrirla sin inventarselo.
        return bad(t('row.wrong-project', { id: row.id, project: row.project ?? row.key, cwd }));
      }
      if (row.verb === 'show') return viewProposal({ root, cwd, key, id: row.id });
      if (row.verb === 'approve') return approveProposal({ root, key, id: row.id, force: false, catalog });
      if (row.verb === 'publish') return approveProposal({ root, key, id: row.id, force: false, scope: 'global', catalog });
      if (row.verb === 'reject') return rejectProposal({ root, key, id: row.id, catalog });
      // Las filas de lo APAGADO se ofrecian en el menu y no tenian despacho: el registro las ponia y elegirlas
      // contestaba «Fila desconocida». Son dos verbos del mismo ciclo de vida que los comandos con argumentos.
      if (row.verb === 'enable') {
        const vuelta = enable(row.id, key, { root });
        if (!vuelta?.ok) return bad(t('cmd.enable.failed', { reason: vuelta?.reason ?? 'sin motivo' }));
        catalog?.notify?.();
        return ok(t('cmd.enable.done', { id: row.id, key }), { code: 'enabled', params: { id: row.id } });
      }
      if (row.verb === 'retire') {
        // Retirar es el unico gesto irreversible del plugin y el comando exige `--yes`: la fila no es una
        // excepcion, asi que dice la orden exacta en vez de escribir. Una fila no puede llevar banderas.
        return ok([t('cmd.retire.confirm', { id: row.id, key }), t('cmd.retire.confirm-hint'), t('cmd.retire.confirm-do', { id: row.id })].join('\n'));
      }
      return bad(t('row.unknown-verb', { verb: String(row.verb) }));
    }),
  }));
}
