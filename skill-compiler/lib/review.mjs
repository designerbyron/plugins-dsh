/**
 * review.mjs — la página de revisión, servida localmente por el CLI.
 *
 * Para qué: una propuesta de skill espera una decisión **humana**, y ese flujo no puede depender de que
 * alguien recuerde la sintaxis de un comando. Esto sirve una página con las pendientes, su resultado de
 * validación y dos botones: aprobar y rechazar.
 *
 * Por qué aquí y no dentro de la aplicación: exponer un remoto al cliente exige decoradores de
 * TypeScript y el pipeline de compilación de `dsh-typert-protocol`, y este plugin escribe su artefacto de
 * navegador a mano, sin build. Está razonado en `docs/FEEDBACK-VISUAL.md`.
 *
 * Y por qué esto es **más** seguro que un botón dentro de la aplicación:
 *
 *   1. **Escucha solo en `127.0.0.1`.** No se expone a la red.
 *   2. **Exige un token de un solo uso** que se genera al arrancar y solo se imprime en la terminal.
 *      Sin él, cualquier página web abierta en el navegador podría enviar peticiones a este puerto: el
 *      token es lo que convierte «algo que escucha en local» en «algo que solo alcanza quien lo arrancó».
 *   3. **El cliente nunca nombra una ruta.** Las acciones solo aceptan un `id`, y ese `id` tiene que estar
 *      entre las propuestas pendientes de ESTE proyecto: no hay forma de pedir un fichero arbitrario.
 *   4. **Todo el texto dinámico se escapa.** Una descripción la escribió un modelo; se pinta como texto,
 *      nunca como marcado.
 *   5. **Vive mientras tú lo tengas abierto.** No queda un puerto escuchando de fondo.
 *
 * El servidor no se arranca solo: lo arranca una persona, y se cierra con Ctrl+C.
 *
 * El texto de la página sale del catalogo (`review.*`) en el idioma **efectivo** de la sesión: es una página
 * para una persona, y las dos superficies humanas (CLI y página) dicen lo mismo. Lo que no se traduce es el
 * dato: ids, rutas, descripciones, y las líneas de la puerta, que se componen de los hallazgos.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { lineasDePuerta } from './audit.mjs';
import { parseFrontmatter } from './compiler.mjs';
import { ejecutarAprobacion } from './approve-tx.mjs';
import { huellaDeContenido } from './security.mjs';
import { resolveLang, t, textoDeCodigo } from './i18n/index.mjs';

/** Un token nuevo por arranque: 128 bits en hexadecimal. */
export function createToken() {
  return randomBytes(16).toString('hex');
}

/**
 * Comparación en tiempo constante. Comparar con `===` filtra, por el tiempo que tarda en fallar, cuántos
 * caracteres del token ha acertado quien prueba. Aquí no hay nada que adivinar.
 */
export function tokenMatches(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Escapa para HTML. Todo lo que se pinta viene de fuera: ids y descripciones escritos por un modelo. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Lee las propuestas de un estado del almacén (proposed, approved, rejected). */
function readState(root, key, state) {
  const dir = join(root, 'projects', key, state);
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const id of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const file = join(dir, id, 'SKILL.md');
    if (!existsSync(file)) continue;
    const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));
    rows.push({
      id: data.name ?? id,
      description: data.description ?? '',
      whenToUse: data.whenToUse ?? '',
      learnedAt: data.metadata?.dsh?.learnedAt ?? '',
      upstreamUrl: data.metadata?.dsh?.upstreamUrl ?? '',
      body,
    });
  }
  return rows;
}

/**
 * El modelo de la página. `check` se inyecta (es el mismo que usa el terminal) para que la validación
 * que ves aquí sea **exactamente** la que decide si se puede aprobar.
 */
export function buildReview(root, key, check) {
  const pending = readState(root, key, 'proposed').map((row) => ({ ...row, check: check(row.id, key) }));
  return {
    root,
    projectKey: key,
    pending,
    approved: readState(root, key, 'approved').map((row) => ({ id: row.id, description: row.description })),
    rejected: readState(root, key, 'rejected').map((row) => ({ id: row.id, description: row.description })),
  };
}

const STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 20px 64px; background: #0b1020; color: #e7e9f3;
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 860px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .08em; opacity: .65; margin: 34px 0 10px; }
.sub { opacity: .7; font-size: 13.5px; margin: 0 0 24px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.card { border: 1px solid #2b3357; border-radius: 14px; padding: 16px 18px; margin: 0 0 14px; background: #121a33; }
.card h3 { margin: 0 0 6px; font-size: 15.5px; }
.card p { margin: 0 0 10px; opacity: .82; font-size: 14px; }
.tag { display: inline-block; border-radius: 999px; padding: 2px 9px; font-size: 11.5px; border: 1px solid currentColor; }
.ok { color: #34d399; } .warn { color: #fbbf24; } .bad { color: #f87171; }
ul { margin: 8px 0 12px; padding-left: 18px; font-size: 13.5px; }
.actions { display: flex; gap: 8px; margin-top: 12px; }
button { border-radius: 9px; padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; border: 1px solid #3d4780; background: #1c2547; color: #e7e9f3; }
button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
button.danger { background: transparent; border-color: #7f1d1d; color: #fca5a5; }
.notice { border-radius: 10px; padding: 11px 14px; margin: 0 0 18px; font-size: 14px; border: 1px solid #2b3357; background: #16203c; }
footer { margin-top: 40px; opacity: .55; font-size: 12.5px; }
.empty { opacity: .6; font-size: 14px; }
`;

/**
 * La página. Todo lo dinámico pasa por `escapeHtml`; todo el texto fijo sale del catalogo en el idioma
 * efectivo (`lang`, que el servidor resuelve por petición).
 */
export function renderPage({ model, token, notice = '', lang = resolveLang().lang }) {
  const tx = (clave, params = {}) => t(clave, params, { lang });
  const items = model.pending.map((row) => {
    const status = row.check.ok
      ? `<span class="tag ok">${escapeHtml(tx('review.tag.ok'))}</span>`
      : `<span class="tag bad">${escapeHtml(tx('review.tag.fail'))}</span>`;
    // Las lineas de la puerta se componen de los HALLAZGOS (que llevan codigo), no de su texto crudo: la misma
    // puerta que la CLI. `check.errors`/`check.warnings` son el dato y siguen siendo la reserva.
    const warnings = lineasDePuerta(row.check.findings, 'warn', null, row.check.warnings, { lang })
      .map((w) => `<li>${escapeHtml(tx('review.warning-item', { aviso: w }))}</li>`).join('');
    const errors = lineasDePuerta(row.check.findings, 'error', row.check.errorLines, row.check.errors, { lang })
      .map((e) => `<li class="bad">${escapeHtml(e)}</li>`).join('');
    // La misma política que el terminal: si no pasa la puerta, no hay botón de aprobar; y si tiene
    // avisos, aprobar es un acto explícito y separado, no el botón de siempre.
    const buttons = !row.check.ok
      ? `<button class="danger" name="action" value="reject">${escapeHtml(tx('review.button.reject'))}</button>
    <span class="sub" style="align-self:center">${escapeHtml(tx('review.cannot-approve'))}</span>`
      : row.check.warnings.length
        ? `<button class="primary" name="action" value="approve">${escapeHtml(tx('review.button.approve-warnings'))}</button>
    <input type="hidden" name="force" value="1">
    <button class="danger" name="action" value="reject">${escapeHtml(tx('review.button.reject'))}</button>`
        : `<button class="primary" name="action" value="approve">${escapeHtml(tx('review.button.approve'))}</button>
    <button class="danger" name="action" value="reject">${escapeHtml(tx('review.button.reject'))}</button>`;
    return `<article class="card">
  <h3><code>${escapeHtml(row.id)}</code> ${status}</h3>
  <p>${escapeHtml(row.description)}</p>
  ${row.whenToUse ? `<p class="sub">${escapeHtml(tx('review.when', { texto: row.whenToUse }))}</p>` : ''}
  ${errors ? `<ul>${errors}</ul>` : ''}${warnings ? `<ul>${warnings}</ul>` : ''}
  <div class="actions">
    <form method="post" action="/action?token=${escapeHtml(token)}">
      <input type="hidden" name="id" value="${escapeHtml(row.id)}">
      ${buttons}
    </form>
  </div>
</article>`;
  }).join('\n');

  const summary = (rows) => (rows.length
    ? `<ul>${rows.map((r) => `<li><code>${escapeHtml(r.id)}</code> - ${escapeHtml(r.description)}</li>`).join('')}</ul>`
    : `<p class="empty">${escapeHtml(tx('review.empty.none'))}</p>`);

  return `<!doctype html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(tx('review.page-title', { key: model.projectKey }))}</title>
<style>${STYLES}</style>
</head><body><main>
<h1>${escapeHtml(tx('review.heading'))}</h1>
<p class="sub">${escapeHtml(tx('review.lead', { key: model.projectKey }))}</p>
${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}
<h2>${escapeHtml(tx('review.section.pending', { n: model.pending.length }))}</h2>
${model.pending.length ? items : `<p class="empty">${escapeHtml(tx('review.empty.pending'))}</p>`}
<h2>${escapeHtml(tx('review.section.approved', { n: model.approved.length }))}</h2>
${summary(model.approved)}
<h2>${escapeHtml(tx('review.section.rejected', { n: model.rejected.length }))}</h2>
${summary(model.rejected)}
<footer>${escapeHtml(tx('review.footer'))}</footer>
</main></body></html>`;
}

/**
 * El aviso de una acción, en el idioma de la sesión: `code` + `params` es lo que se compone, y el texto crudo es
 * la reserva. Así la página no guarda una segunda copia de ninguna frase.
 */
const aviso = (code, params = {}, text = '', lang = undefined) => textoDeCodigo(code, params, text, { lang });

/** El id solo puede ser uno de los pendientes de este proyecto: el cliente nunca nombra una ruta. */
export function resolveAction(model, id, action, { approve, reject, force = false, lang = resolveLang().lang }) {
  // El aviso se compone en el idioma de la pagina que lo va a ensenar: `lang` lo pasa el servidor, y en una
  // llamada suelta es el efectivo.
  const tx = (code, params = {}, text = '') => aviso(code, params, text, lang);
  if (action !== 'approve' && action !== 'reject') return { status: 400, notice: tx('review.notice.bad-action'), noticeCode: 'review.notice.bad-action' };
  const row = model.pending.find((p) => p.id === id);
  if (!row) {
    const params = { id };
    return { status: 404, notice: tx('review.notice.no-pending', params), noticeCode: 'review.notice.no-pending', noticeParams: params };
  }
  if (action === 'reject') {
    reject(id, model.projectKey);
    return { status: 303, notice: tx('review.notice.rejected', { id }), noticeCode: 'review.notice.rejected', noticeParams: { id } };
  }
  // Misma puerta que el terminal: primero la validación, después los avisos como acto explícito.
  if (!row.check.ok) {
    return { status: 303, notice: tx('review.notice.gate', { id }), noticeCode: 'review.notice.gate', noticeParams: { id } };
  }
  if (row.check.warnings.length > 0 && force !== true) {
    return { status: 303, notice: tx('review.notice.warnings', { id }), noticeCode: 'review.notice.warnings', noticeParams: { id } };
  }
  // La misma transaccion que el comando humano: la version viva se aparta con manifiesto y el asiento
  // del diario es obligatorio antes de dar la aprobacion por buena. La carpeta de la propuesta se toma de
  // la validacion si la trae; si no, se compone desde el modelo (el `check` inyectado puede no devolverla).
  const dirPropuesta = row.check.dir ?? join(model.root, 'projects', model.projectKey, 'proposed', id);
  const result = ejecutarAprobacion({
    root: model.root, key: model.projectKey, id,
    esperada: huellaDeContenido(dirPropuesta),
    scope: 'project',
    nota: 'aprobacion desde el panel de revision',
  });
  if (!result.ok) {
    const params = { id, reason: result.error ?? result.reason ?? tx('review.notice.fallback') };
    return { status: 303, notice: tx('review.notice.failed', params), noticeCode: 'review.notice.failed', noticeParams: params };
  }
  const params = { id };
  const texto = `${tx('review.notice.approved', params)}${result.superseded ? tx('review.notice.superseded') : ''}`;
  return { status: 303, notice: texto, noticeCode: 'review.notice.approved', noticeParams: params, superseded: Boolean(result.superseded) };
}

/**
 * Arranca el servidor. Devuelve el servidor (para poder cerrarlo) y la URL con el token.
 * Separado de la lógica para que las pruebas puedan levantarlo de verdad, en un puerto efímero.
 */
export function createReviewServer({ root, key, check, approve, reject, port = 0, token = createToken(), lang: idiomaFijo = null }) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port || 0}`);
    const provided = url.searchParams.get('token') ?? '';
    // El idioma se resuelve POR PETICIÓN: la página sigue al idioma efectivo, también si se cambia con la
    // terminal abierta (`lang --es`). No se guarda en el modelo ni en el token.
    // `lang` existe para las pruebas, que tienen que medir los dos idiomas sin depender del `config.json` del
    // almacen real; en produccion no se pasa y manda el idioma efectivo.
    const lang = idiomaFijo ?? resolveLang().lang;
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
      res.end(body);
    };

    if (!tokenMatches(token, provided)) {
      // Sin el token no se revela ni que existe: 403 y nada más.
      send(403, `<!doctype html><meta charset="utf-8"><p>${escapeHtml(t('review.http.no-token', {}, { lang }))}</p>`);
      return;
    }

    const model = buildReview(root, key, check);

    if (req.method === 'GET') {
      const notice = url.searchParams.get('notice') ?? '';
      send(200, renderPage({ model, token, notice, lang }));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) req.destroy(); // un formulario de dos campos no necesita más
      });
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const result = resolveAction(model, form.get('id') ?? '', form.get('action') ?? '', {
          approve,
          reject,
          force: form.get('force') === '1',
          lang,
        });
        // Patrón «redirige tras actuar»: recargar la página no repite la acción.
        send(result.status, '', { location: `/?token=${encodeURIComponent(token)}&notice=${encodeURIComponent(result.notice)}` });
      });
      return;
    }

    send(405, `<!doctype html><meta charset="utf-8"><p>${escapeHtml(t('review.http.bad-method', {}, { lang }))}</p>`);
  });

  return {
    token,
    server,
    listen: () => new Promise((resolve) => {
      server.listen(port, '127.0.0.1', () => resolve(server.address().port));
    }),
    urlFor: (actualPort) => `http://127.0.0.1:${actualPort}/?token=${token}`,
  };
}
