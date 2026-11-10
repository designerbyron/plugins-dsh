/**
 * La puerta de calidad: lo que una skill tiene que cumplir para publicarse.
 *
 * No mide si la skill es *buena* —eso no lo sabe un programa— sino si es **utilizable**: si el modelo
 * puede enrutarla (descripción distinguible, `whenToUse` con una situación concreta), si el
 * procedimiento está escrito (secciones, pasos), si el material enlazado existe, y si no trae secretos.
 *
 * Dos severidades y una regla: `block` impide publicar, `warn` se publica y se dice. Un aviso que se
 * puede ignorar sin decidirlo es ruido, así que los avisos van con su motivo escrito.
 */

import { isSafeId, ID_SOFT_LENGTH } from './format.mjs';

const MIN_DESCRIPTION = 60;
const MAX_DESCRIPTION = 300;
const MIN_WHEN = 20;
const MAX_WHEN = 200;
const MIN_BODY = 200;
const MAX_TAGS = 8;
const MAX_REFERENCE_BYTES = 64 * 1024;

/**
 * Patrones de secreto. Son deliberadamente estrechos: un patrón ancho marcaría como secreto cualquier
 * skill que *hable* de tokens, y una puerta que se equivoca se acaba desactivando.
 */
const SECRET_RULES = [
  { code: 'secret.private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, message: 'el cuerpo contiene una clave privada' },
  { code: 'secret.api-token', re: /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/, message: 'el cuerpo contiene algo con forma de token de API' },
  { code: 'secret.assignment', re: /\b(?:api[_-]?key|password|contrasena|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,}/i, message: 'el cuerpo asigna un valor a una credencial' },
];

function lastMeaningfulLine(body) {
  const lines = String(body ?? '').split('\n').filter((line) => line.trim() !== '');
  return lines.length === 0 ? '' : lines.at(-1).trim();
}

/** Cuenta secciones de nivel 2: un procedimiento sin secciones no es un procedimiento. */
export function countSections(body) {
  return String(body ?? '')
    .split('\n')
    .filter((line) => /^##\s+\S/.test(line.trim())).length;
}

/** Las rutas bajo `references/` que el cuerpo declara, en orden y sin repetir. */
export function declaredReferences(body) {
  const found = [];
  const re = /references\/[A-Za-z0-9._\-/]+/g;
  for (const match of String(body ?? '').match(re) ?? []) {
    if (!found.includes(match)) found.push(match);
  }
  return found;
}

/**
 * Evalúa una versión candidata.
 *
 * @param {{ id?: string, description?: string, whenToUse?: string, body?: string, tags?: string[], references?: Record<string,string> }} candidate
 * @param {{ evaluatedAt?: string }} [options]
 * @returns {{ status: 'pass'|'warn'|'fail', score: number, checks: object[], findings: object[], blocksPublish: boolean, evaluatedAt: string }}
 */
export function evaluateSkill(candidate, { evaluatedAt = new Date().toISOString() } = {}) {
  const id = String(candidate?.id ?? '').trim();
  const description = String(candidate?.description ?? '').replace(/\s+/g, ' ').trim();
  const whenToUse = String(candidate?.whenToUse ?? '').replace(/\s+/g, ' ').trim();
  const body = String(candidate?.body ?? '');
  const tags = Array.isArray(candidate?.tags) ? candidate.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const references = candidate?.references !== null && typeof candidate?.references === 'object' ? candidate.references : {};

  const checks = [];
  const check = (code, severity, ok, message) => {
    checks.push({ code, severity, ok: Boolean(ok), message });
    return Boolean(ok);
  };

  // ── identidad y enrutado ────────────────────────────────────────────────────────────────────────
  check('id.format', 'block', isSafeId(id), id === ''
    ? 'falta el id'
    : 'el id es kebab-case en minúsculas: letras, números y guiones simples');
  check('id.length', 'warn', id.length <= ID_SOFT_LENGTH, `un id de más de ${ID_SOFT_LENGTH} caracteres se recorta mal en el menú`);
  check('description.present', 'block', description !== '', 'falta la descripción: es lo que el modelo lee para elegir la skill');
  check('description.length', 'warn', description.length >= MIN_DESCRIPTION && description.length <= MAX_DESCRIPTION,
    `la descripción debería medir entre ${MIN_DESCRIPTION} y ${MAX_DESCRIPTION} caracteres; mide ${description.length}`);
  check('when-to-use.present', 'block', whenToUse.length >= MIN_WHEN, `falta la situación de uso (al menos ${MIN_WHEN} caracteres): es el campo con el que el harness enruta la skill`);
  check('when-to-use.length', 'warn', whenToUse.length <= MAX_WHEN, `la situación de uso no debería pasar de ${MAX_WHEN} caracteres`);
  check('tags.count', 'warn', tags.length <= MAX_TAGS, `como mucho ${MAX_TAGS} etiquetas`);

  // ── procedimiento ───────────────────────────────────────────────────────────────────────────────
  const sections = countSections(body);
  check('body.length', 'block', body.trim().length >= MIN_BODY, `el cuerpo debería explicar el procedimiento (al menos ${MIN_BODY} caracteres); mide ${body.trim().length}`);
  check('body.sections', 'warn', sections >= 2, sections === 1 ? 'una sola sección: un procedimiento suele necesitar pasos y trampas por separado' : 'sin secciones "## ": el procedimiento no está estructurado');
  check('body.heading', 'warn', lastMeaningfulLine(body).length > 0, 'el cuerpo termina en una sección vacía');

  // ── material enlazado ───────────────────────────────────────────────────────────────────────────
  const declared = declaredReferences(body);
  const missing = declared.filter((path) => !Object.prototype.hasOwnProperty.call(references, path));
  check('references.linked-exists', 'block', missing.length === 0, missing.length === 0 ? '' : `el cuerpo enlaza material que no va con la skill: ${missing.join(', ')}`);
  const unlinked = Object.keys(references).filter((path) => !declared.includes(path));
  check('references.unlinked', 'warn', unlinked.length === 0, unlinked.length === 0 ? '' : `material guardado que el cuerpo no enlaza: ${unlinked.join(', ')}`);
  const badPath = Object.keys(references).filter((path) => !path.startsWith('references/') || path.includes('..'));
  check('references.paths', 'block', badPath.length === 0, badPath.length === 0 ? '' : `rutas de material fuera de references/: ${badPath.join(', ')}`);
  const big = Object.entries(references).filter(([, content]) => typeof content === 'string' && Buffer.byteLength(content, 'utf8') > MAX_REFERENCE_BYTES);
  check('references.size', 'warn', big.length === 0, big.length === 0 ? '' : `material por encima de 64 KiB: ${big.map(([path]) => path).join(', ')}`);

  // ── seguridad y portabilidad ────────────────────────────────────────────────────────────────────
  const haystack = [description, whenToUse, body, ...Object.values(references).filter((value) => typeof value === 'string')].join('\n');
  for (const rule of SECRET_RULES) {
    check(rule.code, 'block', !rule.re.test(haystack), rule.message);
  }
  check('portability.windows-path', 'warn', !/[A-Za-z]:\\[A-Za-z0-9_\\-]/.test(body), 'una ruta absoluta de Windows no sirve en otra máquina: descríbela desde la raíz del proyecto');
  check('portability.todo', 'warn', !/\b(TODO|FIXME|TBD)\b/.test(body), 'el cuerpo tiene un TODO: una skill que se carga en cada sesión no puede dejar cabos sueltos');

  const findings = checks
    .filter((entry) => !entry.ok)
    .map((entry) => ({ code: entry.code, severity: entry.severity, message: entry.message }));
  const penalty = findings.reduce((total, finding) => total + (finding.severity === 'block' ? 40 : 8), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const blocksPublish = findings.some((finding) => finding.severity === 'block');
  return {
    status: blocksPublish ? 'fail' : findings.length > 0 ? 'warn' : 'pass',
    score,
    checks,
    findings,
    blocksPublish,
    evaluatedAt,
  };
}

/** El informe en una línea: lo que se lee en la tabla y en el resultado de la herramienta. */
export function evaluationSummary(evaluation) {
  if (evaluation === null || typeof evaluation !== 'object') return 'sin evaluar';
  const blocking = evaluation.findings.filter((finding) => finding.severity === 'block').length;
  const warnings = evaluation.findings.length - blocking;
  if (evaluation.status === 'pass') return `correcta (${evaluation.score}/100)`;
  const partes = [];
  if (blocking > 0) partes.push(`${blocking} bloqueante${blocking === 1 ? '' : 's'}`);
  if (warnings > 0) partes.push(`${warnings} aviso${warnings === 1 ? '' : 's'}`);
  return `${evaluation.status === 'fail' ? 'no publicable' : 'publicable con avisos'} (${evaluation.score}/100): ${partes.join(' · ')}`;
}
