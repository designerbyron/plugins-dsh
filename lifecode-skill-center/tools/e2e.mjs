#!/usr/bin/env node
/**
 * E2E del ciclo de vida completo de una skill del LifeCode Skill Center.
 *
 * Recorre los 19 pasos del encargo usando **sólo** un almacén temporal y workspaces temporales:
 *
 *   node tools/e2e.mjs
 *
 * Reglas del arnés:
 * - No usa red ni dependencias: llama a las funciones de `lib/` directamente.
 * - Redirige `LIFECODE_SKILL_CENTER_ROOT` y `DSH_HOME` a la caja de arena antes de la primera
 *   escritura, y pasa `root` explícito en cada llamada. El almacén real sólo se lee, para medir su
 *   huella antes y después.
 * - Imprime una tabla PASS/FAIL (una línea por paso) y sale con código 1 si algo falla.
 * - Escribe `_audit/E2E-REPORT.md` con los valores medidos. Si hay fallo conserva el almacén
 *   temporal y lo dice; si todo pasa, lo borra.
 *
 * No arregla defectos: los mide y los deja escritos en el informe.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  API_PREFIX,
  buildSnapshot,
  handleApiRequest,
  runAction,
  skillDetail,
} from '../lib/api.mjs';
import { reportsRoot } from '../lib/export.mjs';
import { normalizeCwd, slugId } from '../lib/format.mjs';
import { projectDirectory } from '../lib/materialize.mjs';
import { skillProviderFor } from '../lib/provider.mjs';
import { parseSkillFile, renderSkillFile } from '../lib/skillfile.mjs';
import { centerFile, defaultRoot, loadState, materializedRoot } from '../lib/state.mjs';
import { candidate, tempProject, tempRoot } from '../tests/helpers.mjs';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const CENTER_DIR = resolve(TOOLS_DIR, '..');
const REPO_ROOT = resolve(CENTER_DIR, '..');
const REPORT_PATH = join(REPO_ROOT, '_audit', 'E2E-REPORT.md');

/** Reloj lógico fijo: los eventos y los nombres de informe quedan deterministas. */
const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T12:10:00.000Z';

/** El almacén real del usuario. Se calcula con `defaultRoot({})` para no depender de DSH_HOME. */
const REAL_ROOT = defaultRoot({});

const DESCRIPTION = 'Revisa la estructura y las pruebas de un plugin de DeepSeek Harness antes de instalarlo en un perfil de desarrollo.';
const WHEN = 'Úsala cuando vayas a instalar o actualizar un plugin de DSH y quieras comprobar su manifiesto, su código y sus pruebas antes de confiar en él.';

const BODY_V1 = [
  '## Procedimiento',
  '',
  '1. Lee el manifiesto del plugin y comprueba que el nombre, la versión y las dependencias son los esperados.',
  '2. Abre el adaptador y confirma que la lógica de decisión vive fuera de él, en módulos que se puedan probar sin el harness.',
  '3. Ejecuta la suite del plugin en una caja de arena y exige que termine en verde antes de instalarlo.',
  '',
  '## Evidencia',
  '',
  'Guarda la salida de las pruebas y la huella del almacén real antes y después. Sin esa evidencia, la revisión es una opinión.',
].join('\n');

const BODY_V2 = `${BODY_V1}

## Trampas

- No supongas que el plugin instalado es el del repositorio: compara la ruta registrada.
- Una prueba en verde no demuestra nada si se ejecutó contra otro árbol de código.`;

const BODY_V3 = `${BODY_V2}

## Cuándo no usarla

- Cuando el plugin ya está instalado y verificado en esta máquina hace menos de una semana.`;

const results = [];
const defects = [];
let failures = 0;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function short(value, length = 12) {
  return String(value ?? '').slice(0, length);
}

function dense(value, max = 300) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function escapeCell(value) {
  return dense(value, 220).replace(/\|/g, '\\|');
}

/**
 * Huella de un árbol: ficheros (tamaño + sha256), enlaces y directorios, más el sha256 de center.json.
 * No sigue enlaces simbólicos: un enlace nuevo también cambia la huella.
 */
function fingerprintTree(root) {
  const files = [];
  const dirs = [];
  let exists = false;

  const walk = (directory, prefix) => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    if (prefix === '') exists = true;
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        dirs.push(relative);
        walk(absolute, relative);
      } else if (stat.isSymbolicLink()) {
        files.push({ path: relative, kind: 'link', target: readlinkSync(absolute) });
      } else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        files.push({ path: relative, size: stat.size, sha256: sha256(bytes) });
      } else {
        files.push({ path: relative, kind: 'other' });
      }
    }
  };

  if (!existsSync(root)) {
    return {
      exists: false,
      files,
      dirs,
      digest: sha256('missing'),
      bytes: 0,
      centerSha: null,
      centerSize: 0,
    };
  }

  walk(root, '');
  const center = join(root, 'center.json');
  let centerSha = null;
  let centerSize = 0;
  if (existsSync(center)) {
    const bytes = readFileSync(center);
    centerSha = sha256(bytes);
    centerSize = bytes.length;
  }
  return {
    exists,
    files,
    dirs,
    digest: sha256(JSON.stringify({ files, dirs })),
    bytes: files.reduce((total, entry) => total + (entry.size ?? 0), 0),
    centerSha,
    centerSize,
  };
}

/** Línea de un fichero de `lib/` que contiene una aguja, opcionalmente después de otra. */
function sourceLine(relativePath, needle, after = '') {
  try {
    const lines = readFileSync(join(CENTER_DIR, relativePath), 'utf8').split(/\r?\n/);
    let start = 0;
    if (after !== '') {
      const index = lines.findIndex((line) => line.includes(after));
      if (index >= 0) start = index;
    }
    for (let index = start; index < lines.length; index += 1) {
      if (lines[index].includes(needle)) return index + 1;
    }
  } catch {
    // si el fichero no se puede leer, el informe cita sólo la ruta
  }
  return null;
}

function defectLocation(entry) {
  const line = entry.needle === undefined ? null : sourceLine(entry.file, entry.needle, entry.after ?? '');
  return line === null ? entry.file : `${entry.file}:${line}`;
}

/** Un número de la tabla «## Resumen» del informe exportado. */
function reportMetric(text, label) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length >= 4 && cells[1] === label) {
      const value = Number.parseInt(cells[2], 10);
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

async function step(number, title, fn) {
  const started = Date.now();
  let record;
  try {
    const out = (await fn()) ?? {};
    record = {
      number,
      title,
      pass: out.fail !== true,
      executed: out.executed ?? '',
      measured: out.measured ?? '',
      evidence: out.evidence ?? '',
      ...(out.error !== undefined ? { error: out.error } : {}),
      ms: Date.now() - started,
    };
    if (out.fail === true) failures += 1;
  } catch (error) {
    record = {
      number,
      title,
      pass: false,
      executed: '',
      measured: '',
      evidence: '',
      error: error?.message ?? String(error),
      ms: Date.now() - started,
    };
    failures += 1;
  }
  results.push(record);
  console.log(`→ ${String(number).padStart(2, '0')}. ${title}`);
  return record;
}

function locationOf(projectId, root, skillId) {
  return join(projectDirectory(root, projectId), skillId, 'SKILL.md');
}

function readSkillFile(projectId, root, skillId) {
  return readFileSync(locationOf(projectId, root, skillId), 'utf8');
}

function activeAssignments(state) {
  let count = 0;
  for (const row of Object.values(state.assignments ?? {})) {
    for (const assignment of Object.values(row ?? {})) {
      if (assignment?.enabled === true) count += 1;
    }
  }
  return count;
}

function fillMissingSteps() {
  for (let number = 1; number <= 16; number += 1) {
    if (!results.some((entry) => entry.number === number)) {
      results.push({
        number,
        title: '(no ejecutado)',
        pass: false,
        executed: '',
        measured: '',
        evidence: '',
        error: 'el arnés se detuvo antes de llegar a este paso',
        ms: 0,
      });
      failures += 1;
    }
  }
}

function printTable() {
  console.log('');
  console.log('RESULTADO DEL E2E');
  console.log('=================');
  for (const entry of results.slice().sort((left, right) => left.number - right.number)) {
    const tag = entry.pass ? 'PASS' : 'FAIL';
    const detail = entry.pass ? entry.measured : entry.error ?? entry.measured;
    console.log(`${tag}  ${String(entry.number).padStart(2, '0')}  ${entry.title} — ${dense(detail, 240)}`);
  }
  const passed = results.filter((entry) => entry.pass).length;
  console.log('-----------------');
  console.log(`${passed}/${results.length} PASS · ${results.length - passed} FAIL`);
}

function buildReport({ startedAt, finishedAt, realBefore, realAfter, tempBase, store, kept, fatal }) {
  const lines = [];
  const passed = results.filter((entry) => entry.pass).length;
  const failed = results.length - passed;
  const verdict = failed === 0 && fatal === '' ? 'PASS' : 'FAIL';

  lines.push('# E2E — ciclo de vida completo de una skill (LifeCode Skill Center)');
  lines.push('');
  lines.push(`- **Veredicto:** ${verdict} (${passed}/${results.length} pasos PASS, ${failed} FAIL)`);
  lines.push(`- **Ejecución:** \`node tools/e2e.mjs\` desde \`lifecode-skill-center\`, sin red y sin dependencias nuevas.`);
  lines.push(`- **Inicio:** ${startedAt}`);
  lines.push(`- **Fin:** ${finishedAt}`);
  lines.push(`- **Reloj lógico:** \`${NOW}\` (fijo, para que ids y eventos sean reproducibles).`);
  lines.push(`- **Almacén temporal:** \`${store || '(no se creó)'}\``);
  lines.push(`- **Caja de arena:** \`${tempBase || '(no se creó)'}\` — ${kept ? '**conservada** para inspección porque hubo algún fallo' : 'eliminada al terminar (todos los pasos PASS)'}.`);
  lines.push(`- **Almacén real (sólo lectura):** \`${REAL_ROOT}\``);
  lines.push('');
  lines.push('> El arnés redirige `LIFECODE_SKILL_CENTER_ROOT` y `DSH_HOME` a la caja de arena antes de la');
  lines.push('> primera escritura y pasa `root` explícito en cada llamada. El almacén real sólo se lee para');
  lines.push('> medir su huella antes y después.');
  lines.push('');

  lines.push('## Guardia del almacén real');
  lines.push('');
  lines.push('| Comprobación | Antes | Después |');
  lines.push('|---|---|---|');
  if (realBefore === null || realAfter === null) {
    lines.push('| Huella | no medida | no medida |');
  } else {
    lines.push(`| \`center.json\` sha256 | \`${realBefore.centerSha ?? '(no existe)'}\` | \`${realAfter.centerSha ?? '(no existe)'}\` |`);
    lines.push(`| \`center.json\` tamaño | ${realBefore.centerSize} B | ${realAfter.centerSize} B |`);
    lines.push(`| Ficheros bajo la raíz | ${realBefore.files.length} | ${realAfter.files.length} |`);
    lines.push(`| Directorios bajo la raíz | ${realBefore.dirs.length} | ${realAfter.dirs.length} |`);
    lines.push(`| Huella del árbol (sha256) | \`${realBefore.digest}\` | \`${realAfter.digest}\` |`);
  }
  lines.push('');
  if (realBefore !== null && realAfter !== null) {
    const unchanged = realBefore.exists === realAfter.exists
      && realBefore.digest === realAfter.digest
      && realBefore.centerSha === realAfter.centerSha
      && realBefore.centerSize === realAfter.centerSize
      && realBefore.files.length === realAfter.files.length;
    lines.push(unchanged
      ? 'Resultado: **el almacén real no cambió** (misma huella, mismo tamaño y ningún fichero nuevo).'
      : 'Resultado: **el almacén real cambió** — ver la tabla anterior y la nota de causas externas.');
  }
  lines.push('');

  lines.push('## Tabla de pasos');
  lines.push('');
  lines.push('| # | Paso | Resultado | Medido |');
  lines.push('|---|---|---|---|');
  for (const entry of results.slice().sort((left, right) => left.number - right.number)) {
    lines.push(`| ${entry.number} | ${escapeCell(entry.title)} | ${entry.pass ? 'PASS' : 'FAIL'} | ${escapeCell(entry.pass ? entry.measured : entry.error ?? entry.measured)} |`);
  }
  lines.push('');

  lines.push('## Pasos');
  lines.push('');
  for (const entry of results.slice().sort((left, right) => left.number - right.number)) {
    lines.push(`### ${entry.number}. ${entry.title} — ${entry.pass ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push(`- **Ejecutado:** ${dense(entry.executed || '—', 500)}`);
    lines.push(`- **Resultado medido:** ${dense(entry.measured || '—', 700)}`);
    if (entry.error !== undefined) lines.push(`- **Error:** ${dense(entry.error, 500)}`);
    lines.push(`- **Evidencia:** ${dense(entry.evidence || '—', 500)}`);
    lines.push('');
  }

  lines.push('## Defectos y hallazgos');
  lines.push('');
  if (defects.length === 0) {
    lines.push('_No se confirmaron defectos en esta ejecución._');
  } else {
    for (const entry of defects.slice().sort((left, right) => left.id.localeCompare(right.id))) {
      lines.push(`### ${entry.id} — ${entry.kind}${entry.severity ? ` (${entry.severity})` : ''}: ${entry.title}`);
      lines.push('');
      lines.push(`- **Ubicación:** \`${defectLocation(entry)}\``);
      lines.push(`- **Síntoma:** ${dense(entry.symptom, 600)}`);
      lines.push(`- **Reproducción:** ${dense(entry.repro, 600)}`);
      if (entry.impact) lines.push(`- **Impacto:** ${dense(entry.impact, 400)}`);
      lines.push('');
    }
  }

  lines.push('## Cómo reproducir');
  lines.push('');
  lines.push('```sh');
  lines.push('cd C:\\xampp\\htdocs\\plugins-dhs\\lifecode-skill-center');
  lines.push('node tools/e2e.mjs');
  lines.push('echo $LASTEXITCODE');
  lines.push('```');
  lines.push('');
  lines.push('El arnés no toca la red. Si algún paso falla, conserva el almacén temporal y su ruta queda');
  lines.push('escrita arriba; si todos pasan, lo elimina.');
  lines.push('');
  if (fatal !== '') {
    lines.push('## Fallo fatal del arnés');
    lines.push('');
    lines.push('```text');
    lines.push(fatal);
    lines.push('```');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function writeReport(markdown) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, markdown, 'utf8');
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log('LifeCode Skill Center — E2E del ciclo de vida');
  console.log(`Almacén real (sólo lectura): ${REAL_ROOT}`);

  let realBefore = null;
  let realAfter = null;
  let tempBase = '';
  let store = '';
  let kept = false;
  let fatal = '';

  try {
    realBefore = fingerprintTree(REAL_ROOT);
    console.log(`Huella inicial: center.json ${realBefore.centerSha ?? '(no existe)'} · ${realBefore.files.length} ficheros`);

    // ── caja de arena ────────────────────────────────────────────────────────────────────────────
    tempBase = tempRoot('lsc-e2e');
    store = join(tempBase, 'store');
    mkdirSync(store, { recursive: true });
    const workspaceRoot = join(tempBase, 'workspaces');
    const cwdA = tempProject('proyecto-a', workspaceRoot);
    const cwdB = tempProject('proyecto-b', workspaceRoot);
    const sandboxHome = join(tempBase, 'dsh-home');
    mkdirSync(sandboxHome, { recursive: true });

    assert.ok(resolve(store).startsWith(resolve(tempBase)), 'el almacén temporal debe vivir en la caja de arena');
    assert.notEqual(resolve(store), resolve(REAL_ROOT), 'el almacén temporal no puede ser el almacén real');

    process.env.DSH_HOME = sandboxHome;
    process.env.LIFECODE_SKILL_CENTER_ROOT = store;

    console.log(`Almacén temporal: ${store}`);
    console.log(`Workspaces temporales: ${cwdA} · ${cwdB}`);
    console.log('');

    const ctx = {
      store,
      tempBase,
      cwdA,
      cwdB,
      provider: skillProviderFor({ root: store, now: () => NOW }),
    };
    const stateOf = () => loadState(store).state;

    // ── 1 ────────────────────────────────────────────────────────────────────────────────────────
    await step(1, 'Crear una skill por lenguaje natural, sin id explícito', async () => {
      const payload = {
        id: '',
        description: DESCRIPTION,
        whenToUse: WHEN,
        tags: ['dsh', 'plugins'],
        body: BODY_V1,
      };
      const created = runAction({ root: store, action: 'create', actor: 'ai', cwd: cwdA, now: NOW, payload });
      assert.equal(created.ok, true, `create falló: ${created.code ?? ''} ${created.message ?? ''}`);
      assert.equal(payload.id, '', 'el payload no debe llevar id explícito');
      assert.equal(created.id, slugId(DESCRIPTION), 'el id se deriva del texto, no se inventa');
      assert.equal(created.version.version, '1.0.0');
      assert.equal(created.version.checksum, sha256(BODY_V1).slice(0, 12));
      assert.equal(created.skill.status, 'published');

      ctx.id = created.id;
      ctx.created = created;
      ctx.bodyV1 = BODY_V1;

      defects.push({
        id: 'H-1',
        kind: 'hallazgo de diseño',
        severity: 'informativo',
        title: 'No existe estado borrador: `create` publica la 1.0.0 en el acto',
        file: 'lib/operations.mjs',
        needle: "status: 'published',",
        after: 'export function createSkill',
        symptom: '`createSkill` guarda la skill con `status: \'published\'` y `currentVersion: \'1.0.0\'`; no hay ningún estado previo que una persona pueda revisar antes de publicar.',
        repro: 'runAction({action:\'create\', actor:\'ai\', payload:{description, whenToUse, body}}) → skill.status = "published" y currentVersion = "1.0.0".',
        impact: 'El paso «publicar» no puede publicar la primera versión: ya está publicada, y una publicación explícita crea una segunda versión.',
      });

      return {
        executed: 'runAction({action:\'create\', actor:\'ai\', payload:{description, whenToUse, body, tags}}) sin id ni title.',
        measured: `id derivado=${created.id}; versión=${created.version.version}; estado=${created.skill.status}; checksum=${created.version.checksum}; longitud del cuerpo=${BODY_V1.length} caracteres.`,
        evidence: `center.json en ${store}`,
      };
    });

    // ── 2 ────────────────────────────────────────────────────────────────────────────────────────
    await step(2, 'Validar estructura: frontmatter, checks y evaluación', async () => {
      assert.ok(ctx.id, 'el paso 1 no dejó una skill');
      const state = stateOf();
      const skill = state.skills[ctx.id];
      assert.ok(skill, 'la skill creada no está en el documento');
      const version = (skill.versions ?? []).find((entry) => entry.version === '1.0.0');
      assert.ok(version, 'la versión 1.0.0 no está en la skill');
      assert.equal(version.description, DESCRIPTION);
      assert.equal(version.whenToUse, WHEN);
      assert.ok(version.body.trim().length >= 200);
      assert.deepEqual(Object.keys(version.references ?? {}), []);

      const rendered = renderSkillFile({ skill, version });
      const parsed = parseSkillFile(rendered);
      assert.equal(parsed.data.name, ctx.id);
      assert.equal(parsed.data.metadata?.dsh?.origin, 'lifecode-skill-center');
      assert.equal(parsed.data.metadata?.dsh?.version, '1.0.0');
      assert.ok(parsed.body.includes('## Procedimiento'));
      const sections = (version.body.match(/^##\s+\S/gm) ?? []).length;
      assert.equal(sections, 2);

      const evaluation = version.evaluation;
      assert.equal(evaluation.status, 'pass');
      assert.equal(evaluation.score, 100);
      assert.notEqual(evaluation.blocksPublish, true);
      assert.equal(evaluation.findings.length, 0);
      const failed = evaluation.checks.filter((check) => check.ok !== true);
      assert.equal(failed.length, 0, `checks en rojo: ${failed.map((check) => check.code).join(', ')}`);

      return {
        executed: 'renderSkillFile + parseSkillFile sobre la versión guardada; lectura de evaluation.checks.',
        measured: `frontmatter: name=${parsed.data.name}, origin=${parsed.data.metadata?.dsh?.origin}, version=${parsed.data.metadata?.dsh?.version}; secciones=${sections}; checks=${evaluation.checks.length} (${evaluation.checks.length - failed.length} en verde); status=${evaluation.status}; score=${evaluation.score}/100; blocksPublish persistido=${evaluation.blocksPublish === undefined ? 'ausente (la evaluación guardada omite ese campo)' : evaluation.blocksPublish}.`,
        evidence: `center.json en ${store}; SKILL.md compuesto en memoria (aún sin materializar)`,
      };
    });

    // ── 3 ────────────────────────────────────────────────────────────────────────────────────────
    await step(3, 'Evaluar la skill y mostrar hallazgos', async () => {
      assert.ok(ctx.id);
      const evaluated = runAction({
        root: store,
        action: 'evaluate',
        actor: 'ai',
        now: NOW,
        payload: { id: ctx.id, version: '1.0.0' },
      });
      assert.equal(evaluated.ok, true, `evaluate falló: ${evaluated.code ?? ''}`);
      assert.equal(evaluated.version, '1.0.0');
      const evaluation = evaluated.evaluation;
      assert.equal(evaluation.status, 'pass');
      assert.equal(evaluation.score, 100);
      assert.deepEqual(evaluation.findings, []);
      const checksOk = evaluation.checks.filter((check) => check.ok === true).length;

      return {
        executed: 'runAction({action:\'evaluate\', actor:\'ai\', payload:{id, version:\'1.0.0\'}}) — puerta de calidad vuelta a pasar.',
        measured: `status=${evaluation.status}; score=${evaluation.score}/100; findings=${evaluation.findings.length} (${evaluation.findings.map((finding) => `${finding.severity}:${finding.code}`).join(', ') || 'ninguno'}); checks en verde=${checksOk}/${evaluation.checks.length}; blocksPublish=${evaluation.blocksPublish}.`,
        evidence: `evaluation de la versión 1.0.0 en ${store}/center.json`,
      };
    });

    // ── 4 ────────────────────────────────────────────────────────────────────────────────────────
    await step(4, 'Publicar con confirmación humana simulada', async () => {
      assert.ok(ctx.id);
      const byAi = runAction({
        root: store,
        action: 'publish',
        actor: 'ai',
        now: NOW,
        payload: { id: ctx.id },
      });
      assert.equal(byAi.ok, false, 'la IA no puede publicar una versión');
      assert.equal(byAi.code, 'approval-required');

      // Publicar lo mismo que ya está publicado no gasta un número de versión: el producto lo rechaza.
      const unchanged = runAction({
        root: store,
        action: 'publish',
        actor: 'human',
        now: NOW,
        payload: { id: ctx.id, notes: 'sin tocar nada' },
      });
      assert.equal(unchanged.ok, false, 'publicar sin cambios no puede crear una versión');
      assert.equal(unchanged.code, 'unchanged');
      assert.equal(stateOf().skills[ctx.id].currentVersion, '1.0.0', 'la versión vigente no cambia');

      // Con un cambio real sí hay versión nueva, y el número avanza una sola vez.
      const byHuman = runAction({
        root: store,
        action: 'publish',
        actor: 'human',
        now: NOW,
        payload: { id: ctx.id, body: BODY_V2, notes: 'Publicación explícita de la 1.0.0 revisada' },
      });
      assert.equal(byHuman.ok, true, `publish humano falló: ${byHuman.code ?? ''} ${byHuman.message ?? ''}`);
      assert.equal(byHuman.version.version, '1.1.0');
      assert.notEqual(byHuman.version.checksum, ctx.created.version.checksum, 'la versión nueva cambia el contenido');
      assert.equal(byHuman.skill.currentVersion, '1.1.0');
      assert.equal(byHuman.version.notes, 'Publicación explícita de la 1.0.0 revisada');

      const state = stateOf();
      const skill = state.skills[ctx.id];
      assert.equal(skill.versions.length, 2);
      assert.equal(skill.currentVersion, '1.1.0');

      ctx.v110 = byHuman.version;
      return {
        executed: `publish con la IA (rechazo), publish humano sin cambios (rechazo) y publish humano con un cuerpo nuevo (1.1.0).`,
        measured: `IA: ok=false code=${byAi.code}; sin cambios: ok=false code=${unchanged.code}, vigente sigue 1.0.0; con cambios: ok=true, 1.0.0→1.1.0, checksums ${ctx.created.version.checksum}≠${byHuman.version.checksum}; versiones=2; nota="${byHuman.version.notes}".`,
        evidence: `center.json en ${store} (versiones 1.0.0 y 1.1.0)`,
      };
    });

    // ── 5 ────────────────────────────────────────────────────────────────────────────────────────
    await step(5, 'Asignar la skill al proyecto A (temporal)', async () => {
      assert.ok(ctx.id);
      const opened = runAction({ root: store, action: 'open', cwd: cwdA, actor: 'human', now: NOW });
      assert.equal(opened.ok, true);
      assert.equal(opened.opened, true);
      assert.equal(opened.project.registered, true);
      const projectId = opened.project.id;
      ctx.projectA = projectId;

      const toggled = runAction({
        root: store,
        action: 'toggle',
        actor: 'human',
        now: NOW,
        payload: { projectId, skillId: ctx.id, enabled: true },
      });
      assert.equal(toggled.ok, true, `toggle falló: ${toggled.code ?? ''} ${toggled.message ?? ''}`);
      assert.equal(toggled.projectId, projectId);
      assert.equal(toggled.assignment.enabled, true);
      assert.equal(toggled.assignment.version, '1.1.0');
      assert.equal(toggled.assignment.by, 'human');

      const file = locationOf(projectId, store, ctx.id);
      assert.ok(existsSync(file), 'la asignación debe materializar el SKILL.md en el acto');
      const text = readFileSync(file, 'utf8');
      assert.ok(text.includes('version: "1.1.0"'));

      return {
        executed: 'runAction({action:\'open\', cwd: proyecto A}) + runAction({action:\'toggle\', actor:\'human\', payload:{enabled:true}}).',
        measured: `proyecto A=${projectId}; cwd=${normalizeCwd(cwdA)}; asignación enabled=true version=1.1.0 by=human; SKILL.md materializado=${file}.`,
        evidence: `${join(materializedRoot(store), projectId)}`,
      };
    });

    // ── 6 ────────────────────────────────────────────────────────────────────────────────────────
    await step(6, 'Confirmar que el proyecto B no recibe la skill', async () => {
      assert.ok(ctx.id && ctx.projectA);
      const openedB = runAction({ root: store, action: 'open', cwd: cwdB, actor: 'human', now: NOW });
      assert.equal(openedB.ok, true);
      assert.equal(openedB.project.registered, true);
      const projectId = openedB.project.id;
      ctx.projectB = projectId;
      assert.notEqual(projectId, ctx.projectA, 'dos rutas distintas deben dar dos proyectos distintos');

      const snapshot = buildSnapshot({ root: store, cwd: cwdB, now: NOW, scan: false });
      assert.equal(snapshot.project.id, projectId);
      assert.equal(snapshot.assignments[projectId], undefined, 'B no debe tener fila de asignación');
      const projectB = snapshot.projects.find((entry) => entry.id === projectId);
      assert.ok(projectB);
      assert.deepEqual(projectB.enabled, []);
      assert.equal(projectB.activeSkills, 0);
      const adoptionB = snapshot.skills.flatMap((skill) => skill.adoption ?? []).filter((row) => row.projectId === projectId);
      assert.deepEqual(adoptionB, []);

      const listedB = await ctx.provider.list({ cwd: cwdB });
      assert.deepEqual(listedB, [], 'el catálogo de B debe estar vacío');
      assert.equal(existsSync(join(materializedRoot(store), projectId)), false, 'B no debe tener vista materializada');

      ctx.bRowBefore = JSON.stringify(snapshot.assignments[projectId] ?? null);

      return {
        executed: 'open del proyecto B + buildSnapshot({cwd:B, scan:false}) + skillProvider.list({cwd:B}).',
        measured: `proyecto B=${projectId}; cwd=${normalizeCwd(cwdB)}; fila de asignación en B=ausente; adoption B=0; skill.loaded en B no se pidió; provider.list(B)=0 candidatos; materialized/B existe=false.`,
        evidence: `snapshot de B y ${join(materializedRoot(store), projectId)} (ausente)`,
      };
    });

    // ── 7 ────────────────────────────────────────────────────────────────────────────────────────
    await step(7, 'Encender y apagar la asignación, verificando el estado', async () => {
      assert.ok(ctx.id && ctx.projectA && ctx.projectB);

      const off = runAction({
        root: store,
        action: 'toggle',
        actor: 'human',
        now: NOW,
        payload: { projectId: ctx.projectA, skillId: ctx.id, enabled: false },
      });
      assert.equal(off.ok, true, `apagar falló: ${off.code ?? ''}`);
      assert.equal(off.assignment.enabled, false);
      assert.equal(off.assignment.version, '1.1.0', 'apagar no cambia la versión fijada');
      assert.equal(off.assignment.by, 'human');
      const afterOff = stateOf();
      assert.equal(afterOff.assignments[ctx.projectA][ctx.id].enabled, false);
      const listedOff = await ctx.provider.list({ cwd: cwdA });
      assert.deepEqual(listedOff, [], 'apagada no debe entregarse');
      assert.equal(existsSync(join(projectDirectory(store, ctx.projectA), ctx.id)), false, 'apagada se retira de la vista materializada');

      const on = runAction({
        root: store,
        action: 'toggle',
        actor: 'human',
        now: NOW,
        payload: { projectId: ctx.projectA, skillId: ctx.id, enabled: true },
      });
      assert.equal(on.ok, true, `encender falló: ${on.code ?? ''}`);
      assert.equal(on.assignment.enabled, true);
      assert.equal(on.assignment.version, '1.1.0', 'volver a encender conserva la versión que estaba puesta');
      assert.equal(on.assignment.by, 'human');
      const listedOn = await ctx.provider.list({ cwd: cwdA });
      assert.equal(listedOn.length, 1, 'encendida debe entregarse otra vez');

      // Sonda de la regla de oro: apagar es una escritura humana y la IA no puede hacerla.
      const aiOff = runAction({
        root: store,
        action: 'toggle',
        actor: 'ai',
        now: NOW,
        payload: { projectId: ctx.projectA, skillId: ctx.id, enabled: false },
      });
      const blocked = aiOff.ok === false && aiOff.code === 'approval-required';

      if (!blocked) {
        defects.push({
          id: 'DEF-1',
          kind: 'defecto',
          severity: 'alto',
          title: 'La IA puede apagar una asignación (escritura reservada a la persona)',
          file: 'lib/api.mjs',
          needle: "if (actor === 'ai' && data.enabled === true)",
          symptom: `Con actor:'ai' y payload {enabled:false}, runAction('toggle') devolvió ok:true y dejó la asignación con enabled=false y by='ai'. El propio comentario del caso dice «Encender o apagar es del humano», pero la comprobación sólo mira enabled===true.`,
          repro: 'Con una skill encendida en un proyecto: runAction({root, action:\'toggle\', actor:\'ai\', payload:{projectId, skillId, enabled:false}}) → {ok:true, assignment:{enabled:false, by:\'ai\'}}.',
          impact: 'La IA puede desactivar skills de un proyecto sin confirmación humana; con la misma llamada también puede fijar otra versión (el payload acepta `version`).',
        });
        // Se restaura el estado con la persona para que el resto del ciclo pueda medirse.
        const restored = runAction({
          root: store,
          action: 'toggle',
          actor: 'human',
          now: NOW,
          payload: { projectId: ctx.projectA, skillId: ctx.id, enabled: true },
        });
        assert.equal(restored.ok, true, 'no se pudo restaurar la asignación tras la sonda');
      }

      const final = stateOf();
      assert.equal(final.assignments[ctx.projectA][ctx.id].enabled, true);

      return {
        fail: !blocked,
        executed: 'toggle humano off → verificación → toggle humano on → verificación; después, sonda de regla de oro: toggle con actor \'ai\' y enabled:false.',
        measured: `humano off: enabled=false, version=1.1.0, by=human, catálogo A=0, materializado retirado; humano on: enabled=true, version=1.1.0, by=human, catálogo A=1; sonda IA off: ${blocked ? 'bloqueada (approval-required)' : `PERMITIDA (ok=true, enabled=${aiOff.assignment?.enabled}, by=${aiOff.assignment?.by})`}.`,
        evidence: `center.json y ${join(materializedRoot(store), ctx.projectA)} tras cada toggle`,
        ...(blocked ? {} : { error: 'DEF-1: la IA pudo apagar la asignación; la regla de oro exige approval-required.' }),
      };
    });

    // ── 8 ────────────────────────────────────────────────────────────────────────────────────────
    await step(8, 'Verificar aislamiento: A no cambia B', async () => {
      assert.ok(ctx.projectA && ctx.projectB);
      const snapshotA = buildSnapshot({ root: store, cwd: cwdA, now: NOW, scan: false });
      const snapshotB = buildSnapshot({ root: store, cwd: cwdB, now: NOW, scan: false });
      assert.ok(snapshotA.assignments[ctx.projectA]?.[ctx.id]);
      assert.equal(snapshotA.assignments[ctx.projectA][ctx.id].enabled, true);
      assert.equal(snapshotB.assignments[ctx.projectB], undefined);
      assert.equal(JSON.stringify(snapshotB.assignments[ctx.projectB] ?? null), ctx.bRowBefore, 'la fila de B no puede cambiar por lo que pasa en A');

      const projectB = snapshotB.projects.find((entry) => entry.id === ctx.projectB);
      assert.ok(projectB);
      assert.deepEqual(projectB.enabled, []);
      assert.equal(projectB.updatesCount, 0);
      const adoptionB = snapshotB.skills.flatMap((skill) => skill.adoption ?? []).filter((row) => row.projectId === ctx.projectB);
      assert.deepEqual(adoptionB, []);

      const hashB = sha256(JSON.stringify(snapshotB.assignments[ctx.projectB] ?? null));
      const hashBefore = sha256(ctx.bRowBefore);

      return {
        executed: 'buildSnapshot({cwd:A, scan:false}) y buildSnapshot({cwd:B, scan:false}); comparación de la fila de asignaciones de B.',
        measured: `A: 1 fila enabled=true (version=1.1.0); B: fila ausente (hash antes=${short(hashBefore)}, después=${short(hashB)}); B.enabled=0; B.updatesCount=0; adoption de B=0.`,
        evidence: `snapshots de A y B generados desde ${store}/center.json`,
      };
    });

    // ── 9 ────────────────────────────────────────────────────────────────────────────────────────
    await step(9, 'Medir la entrega al catálogo (skill.loaded / materializado)', async () => {
      assert.ok(ctx.projectA && ctx.id);
      const listed = await ctx.provider.list({ cwd: cwdA });
      assert.equal(listed.length, 1, 'el catálogo de A debe ofrecer exactamente la skill encendida');
      assert.equal(listed[0].name, ctx.id);
      const expectedPath = join(projectDirectory(store, ctx.projectA), ctx.id, 'SKILL.md');
      assert.equal(listed[0].path, expectedPath);
      assert.ok(existsSync(expectedPath));

      const fetched = await ctx.provider.get(listed[0]);
      assert.ok(fetched.content.startsWith('---'));
      assert.ok(fetched.content.includes('version: "1.1.0"'));
      assert.ok(fetched.content.includes('## Procedimiento'));

      // Segunda entrega: la telemetría es diaria y no debe duplicar el evento.
      const again = await ctx.provider.list({ cwd: cwdA });
      assert.equal(again.length, 1);

      const state = stateOf();
      const loads = (state.events ?? []).filter((event) => event.type === 'skill.loaded' && event.skillId === ctx.id && event.projectId === ctx.projectA);
      assert.equal(loads.length, 1, 'skill.loaded se anota una sola vez por día, skill y proyecto');
      assert.equal(loads[0].actor, 'system');
      assert.equal(String(loads[0].at).slice(0, 10), NOW.slice(0, 10));
      assert.equal(loads[0].version, '1.1.0');

      const detail = skillDetail({ root: store, skillId: ctx.id, now: NOW });
      assert.equal(detail.ok, true);
      assert.equal(detail.metrics.loads, 1);

      const manifestPath = join(projectDirectory(store, ctx.projectA), 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.deepEqual(manifest.skills.map((entry) => [entry.id, entry.version]), [[ctx.id, '1.1.0']]);

      return {
        executed: 'skillProvider.list({cwd:A}) dos veces + skillProvider.get(candidato) + skillDetail({skillId}).',
        measured: `candidatos=${listed.length}; name=${listed[0].name}; path=${listed[0].path}; contenido=${Buffer.byteLength(fetched.content, 'utf8')} B; skill.loaded=${loads.length} (actor=${loads[0].actor}, at=${loads[0].at}, version=${loads[0].version}); metrics.loads=${detail.metrics.loads}; manifest=${JSON.stringify(manifest.skills.map((entry) => `${entry.id}@${entry.version}`))}.`,
        evidence: `${expectedPath} y ${manifestPath}`,
      };
    });

    // ── 10 ───────────────────────────────────────────────────────────────────────────────────────
    await step(10, 'Proponer una mejora con actor IA', async () => {
      assert.ok(ctx.id);
      const improved = runAction({
        root: store,
        action: 'improve',
        actor: 'ai',
        cwd: cwdA,
        now: LATER,
        payload: {
          skillId: ctx.id,
          body: BODY_V3,
          rationale: 'Añadir las trampas detectadas al revisar un plugin',
        },
      });
      assert.equal(improved.ok, true, `improve falló: ${improved.code ?? ''} ${improved.message ?? ''}`);
      assert.match(improved.improvementId, /^imp-/);
      assert.equal(improved.improvement.status, 'proposed');
      assert.equal(improved.improvement.baseVersion, '1.1.0');
      assert.equal(improved.improvement.decidedBy, '');
      assert.equal(improved.evaluation.status, 'pass');
      assert.ok(improved.diff.added >= 3, 'la propuesta debe añadir líneas');
      assert.equal(improved.diff.removed, 0);

      const state = stateOf();
      assert.equal(state.skills[ctx.id].currentVersion, '1.1.0', 'una propuesta no mueve la versión vigente');

      ctx.improvementId = improved.improvementId;

      return {
        executed: 'runAction({action:\'improve\', actor:\'ai\', payload:{skillId, body:BODY_V2, rationale}}).',
        measured: `improvementId=${improved.improvementId}; status=proposed; baseVersion=1.1.0; evaluación=${improved.evaluation.status}/${improved.evaluation.score}; diff +${improved.diff.added}/−${improved.diff.removed}; currentVersion sigue 1.1.0; decidida por="${improved.improvement.decidedBy}"; versión nueva todavía no creada.`,
        evidence: `propuesta en ${store}/center.json`,
      };
    });

    // ── 11 ───────────────────────────────────────────────────────────────────────────────────────
    await step(11, 'Aprobar la mejora (humano) y verificar versión inmutable y pin intacto', async () => {
      assert.ok(ctx.improvementId);
      const beforeState = stateOf();
      const beforeVersions = JSON.stringify(
        beforeState.skills[ctx.id].versions.map((version) => ({
          version: version.version,
          checksum: version.checksum,
          body: version.body,
          createdAt: version.createdAt,
          score: version.evaluation?.score,
        })),
      );
      const pinBefore = beforeState.assignments[ctx.projectA][ctx.id].version;

      const byAi = runAction({
        root: store,
        action: 'decide',
        actor: 'ai',
        now: LATER,
        payload: { improvementId: ctx.improvementId, decision: 'approve' },
      });
      assert.equal(byAi.ok, false, 'la IA no puede aprobar una propuesta');
      assert.equal(byAi.code, 'approval-required');

      const byHuman = runAction({
        root: store,
        action: 'decide',
        actor: 'human',
        now: LATER,
        payload: { improvementId: ctx.improvementId, decision: 'approve', note: 'Aprobada tras revisar el diff' },
      });
      assert.equal(byHuman.ok, true, `decide falló: ${byHuman.code ?? ''} ${byHuman.message ?? ''}`);
      assert.equal(byHuman.status, 'approved');
      assert.equal(byHuman.version.version, '1.2.0');

      const state = stateOf();
      const skill = state.skills[ctx.id];
      assert.equal(skill.currentVersion, '1.2.0');
      assert.equal(skill.versions.length, 3);
      const improvement = state.improvements[ctx.improvementId];
      assert.equal(improvement.status, 'approved');
      assert.equal(improvement.decidedBy, 'human');
      assert.equal(improvement.version, '1.2.0');

      // Inmutabilidad: las dos versiones anteriores siguen siendo byte a byte las mismas.
      const afterVersions = JSON.stringify(
        skill.versions.slice(0, 2).map((version) => ({
          version: version.version,
          checksum: version.checksum,
          body: version.body,
          createdAt: version.createdAt,
          score: version.evaluation?.score,
        })),
      );
      const beforeTwo = JSON.stringify(JSON.parse(beforeVersions).slice(0, 2));
      assert.equal(afterVersions, beforeTwo, 'aprobar no puede reescribir las versiones anteriores');

      // El pin del proyecto no se mueve solo.
      const assignment = state.assignments[ctx.projectA][ctx.id];
      assert.equal(assignment.version, pinBefore);
      assert.equal(assignment.version, '1.1.0');

      ctx.v120 = skill.versions.find((version) => version.version === '1.2.0');

      return {
        executed: 'decide con actor \'ai\' (rechazo) + decide con actor \'human\' (approve); comparación de las versiones 1.0.0/1.1.0 antes y después.',
        measured: `IA: approval-required; humano: approved → nueva versión 1.2.0 (checksum=${ctx.v120.checksum}); currentVersion=1.2.0; versiones=3; pin del proyecto A=${assignment.version} (sin mover); 1.0.0/1.1.0 checksums y cuerpos intactos; improvement.status=approved, decidedBy=human.`,
        evidence: `versiones en ${store}/center.json`,
      };
    });

    // ── 12 ───────────────────────────────────────────────────────────────────────────────────────
    await step(12, 'El pin del proyecto A sigue en 1.1.0: publicar no lo mueve', async () => {
      const state = stateOf();
      const a = state.assignments?.[ctx.projectA]?.[ctx.id] ?? null;
      const b = state.assignments?.[ctx.projectB]?.[ctx.id] ?? null;
      assert.ok(a, 'el proyecto A debe tener la asignación');
      assert.equal(a.enabled, true);
      assert.equal(a.version, '1.1.0', 'publicar 1.2.0 no puede mover el pin del proyecto A');
      assert.equal(state.skills[ctx.id].currentVersion, '1.2.0');
      assert.ok(!b || b.enabled !== true, 'el proyecto B no debe recibir la skill');
      return {
        executed: 'loadState() tras aprobar la mejora; lectura de assignments[A] y assignments[B].',
        measured: `currentVersion=${state.skills[ctx.id].currentVersion}; pin A=${a.version} (encendida=${a.enabled}); B=${b ? `encendida=${b.enabled}` : 'sin asignación'}.`,
        evidence: `${store}/center.json`,
      };
    });

    // ── 13 ───────────────────────────────────────────────────────────────────────────────────────
    await step(13, 'Comparar versiones por la API (/api/diff)', async () => {
      assert.ok(ctx.id);
      const pathname = `${API_PREFIX}/diff`;
      const response = handleApiRequest({
        root: store,
        method: 'GET',
        pathname,
        search: `?id=${encodeURIComponent(ctx.id)}&from=1.1.0&to=1.2.0`,
        now: NOW,
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.skillId, ctx.id);
      assert.equal(response.body.from.version, '1.1.0');
      assert.equal(response.body.to.version, '1.2.0');
      assert.notEqual(response.body.from.checksum, response.body.to.checksum);
      assert.ok(response.body.added >= 3, `el diff debe añadir líneas, añadió ${response.body.added}`);
      assert.equal(response.body.removed, 0);
      assert.ok(Array.isArray(response.body.preview));
      assert.equal(response.body.truncated, false);
      assert.equal(response.body.from.score, 100);
      assert.equal(response.body.to.score, 100);

      // Una versión que no existe se dice con 404 y sin inventar un diff vacío.
      const missing = handleApiRequest({
        root: store,
        method: 'GET',
        pathname,
        search: `?id=${encodeURIComponent(ctx.id)}&from=1.0.0&to=9.9.9`,
        now: NOW,
      });
      assert.equal(missing.status, 404);
      assert.equal(missing.body.ok, false);
      assert.notEqual(response.body.from.checksum, response.body.to.checksum);

      const previewFirst = response.body.preview
        .map((line) => `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}${line.text}`)
        .find((line) => line.trim() !== '' && line.trim() !== '+') ?? '';

      return {
        executed: `handleApiRequest({method:'GET', pathname:'${pathname}', search:'?id=…&from=1.0.0&to=1.2.0'}).`,
        measured: `1.1.0→1.2.0: status=200, +${response.body.added}/−${response.body.removed}, preview=${response.body.preview.length} líneas ("${dense(previewFirst, 60)}"), checksums ${short(response.body.from.checksum)}→${short(response.body.to.checksum)}; una versión inexistente responde ${missing.status} (${missing.body.code ?? 'sin código'}).`, 
        evidence: `respuesta de ${pathname} sobre ${store}/center.json`,
      };
    });

    // ── 14 ───────────────────────────────────────────────────────────────────────────────────────
    await step(14, 'Comparar versiones no escribe el almacén', async () => {
      const before = sha256(readFileSync(centerFile(store)));
      const sizeBefore = statSync(centerFile(store)).size;
      for (const [from, to] of [['1.1.0', '1.2.0'], ['1.0.0', '1.2.0'], ['1.2.0', '1.1.0']]) {
        const response = handleApiRequest({
          root: store,
          method: 'GET',
          pathname: `${API_PREFIX}/diff`,
          search: `?id=${encodeURIComponent(ctx.id)}&from=${from}&to=${to}`,
          now: NOW,
        });
        assert.equal(response.status, 200, `diff ${from}→${to} debía responder 200`);
        assert.equal(response.body.ok, true);
      }
      const after = sha256(readFileSync(centerFile(store)));
      const sizeAfter = statSync(centerFile(store)).size;
      assert.equal(after, before, 'comparar versiones no puede modificar center.json');
      assert.equal(sizeAfter, sizeBefore);
      return {
        executed: 'tres lecturas de /api/diff (1.1.0→1.2.0, 1.0.0→1.2.0, 1.2.0→1.1.0) con la huella del almacén antes y después.',
        measured: `center.json sha256 ${short(before)}→${short(after)} (${sizeBefore} B) sin cambio; tres respuestas 200.`,
        evidence: `${store}/center.json`,
      };
    });

    // ── 15 ───────────────────────────────────────────────────────────────────────────────────────
    await step(15, 'Avanzar el pin con acción explícita (humano)', async () => {
      assert.ok(ctx.projectA && ctx.id);
      const byAi = runAction({
        root: store,
        action: 'advance',
        actor: 'ai',
        now: LATER,
        payload: { projectId: ctx.projectA },
      });
      assert.equal(byAi.ok, false, 'la IA no puede avanzar el pin');
      assert.equal(byAi.code, 'approval-required');

      const advanced = runAction({
        root: store,
        action: 'advance',
        actor: 'human',
        now: LATER,
        payload: { projectId: ctx.projectA },
      });
      assert.equal(advanced.ok, true, `advance falló: ${advanced.code ?? ''} ${advanced.message ?? ''}`);
      assert.deepEqual(advanced.updated, [{ skillId: ctx.id, from: '1.1.0', to: '1.2.0' }]);

      const state = stateOf();
      const assignment = state.assignments[ctx.projectA][ctx.id];
      assert.equal(assignment.version, '1.2.0');
      assert.equal(assignment.by, 'human');

      const text = readSkillFile(ctx.projectA, store, ctx.id);
      assert.ok(text.includes('version: "1.2.0"'));
      assert.ok(text.includes('## Trampas'));

      const snapshot = buildSnapshot({ root: store, cwd: cwdA, now: LATER, scan: false });
      const project = snapshot.projects.find((entry) => entry.id === ctx.projectA);
      assert.equal(project.updatesCount, 0);
      assert.equal(snapshot.assignments[ctx.projectA][ctx.id].version, '1.2.0');
      assert.equal(snapshot.assignments[ctx.projectB], undefined);

      return {
        executed: 'advance con actor \'ai\' (rechazo) + advance con actor \'human\' para el proyecto A.',
        measured: `IA: approval-required; humano: updated=[${ctx.id} 1.1.0→1.2.0]; pin A=1.2.0 by=human; SKILL.md materializado con version 1.2.0 y sección "## Trampas"; project.updatesCount=0; B sigue sin fila.`,
        evidence: `${locationOf(ctx.projectA, store, ctx.id)}`,
      };
    });

    // ── 16 ───────────────────────────────────────────────────────────────────────────────────────
    await step(16, 'Rollback del pin a la versión anterior', async () => {
      assert.ok(ctx.projectA && ctx.id);
      const byAi = runAction({
        root: store,
        action: 'rollback',
        actor: 'ai',
        now: LATER,
        payload: { projectId: ctx.projectA, skillId: ctx.id, version: '1.1.0' },
      });
      assert.equal(byAi.ok, false, 'la IA no puede revertir el pin');
      assert.equal(byAi.code, 'approval-required');

      const rolled = runAction({
        root: store,
        action: 'rollback',
        actor: 'human',
        now: LATER,
        payload: { projectId: ctx.projectA, skillId: ctx.id, version: '1.1.0' },
      });
      assert.equal(rolled.ok, true, `rollback falló: ${rolled.code ?? ''} ${rolled.message ?? ''}`);
      assert.equal(rolled.assignment.version, '1.1.0');
      assert.equal(rolled.assignment.enabled, true);

      const state = stateOf();
      assert.equal(state.assignments[ctx.projectA][ctx.id].version, '1.1.0');
      // La versión vigente de la biblioteca no retrocede: sólo el pin del proyecto.
      assert.equal(state.skills[ctx.id].currentVersion, '1.2.0');

      const text = readSkillFile(ctx.projectA, store, ctx.id);
      assert.ok(text.includes('version: "1.1.0"'));
      assert.ok(text.includes('## Trampas'), 'la 1.1.0 ya incluye las trampas');
      assert.ok(!text.includes('## Cuándo no usarla'), 'el SKILL.md vuelve al cuerpo de la 1.1.0, no al de la 1.2.0');
      assert.ok(state.events.some((event) => event.type === 'skill.rollback' && event.skillId === ctx.id && event.projectId === ctx.projectA));

      return {
        executed: 'rollback con actor \'ai\' (rechazo) + rollback con actor \'human\' a la versión 1.1.0.',
        measured: `IA: approval-required; humano: pin 1.2.0→1.1.0, enabled=true; SKILL.md con version "1.1.0" y sin "## Trampas"; currentVersion de la biblioteca sigue 1.2.0; evento skill.rollback registrado.`,
        evidence: `${locationOf(ctx.projectA, store, ctx.id)}`,
      };
    });

    // ── 17 ───────────────────────────────────────────────────────────────────────────────────────
    await step(17, 'Exportar el informe del centro y contrastar sus cifras', async () => {
      assert.ok(ctx.id);
      const centerBefore = sha256(readFileSync(centerFile(store)));
      const sizeBefore = statSync(centerFile(store)).size;

      const byAi = runAction({ root: store, action: 'export', actor: 'ai', now: NOW });
      assert.equal(byAi.ok, false, 'la IA no puede exportar el informe');
      assert.equal(byAi.code, 'approval-required');

      const exported = runAction({ root: store, action: 'export', actor: 'human', now: NOW });
      assert.equal(exported.ok, true, `export falló: ${exported.code ?? ''} ${exported.message ?? ''}`);
      assert.equal(exported.exported, true);
      assert.ok(exported.file.startsWith(reportsRoot(store)), 'el informe vive bajo reports/ del almacén temporal');
      assert.ok(existsSync(exported.file));
      ctx.exportedFile = exported.file;
      assert.equal(statSync(exported.file).size, exported.bytes);
      assert.equal(sha256(readFileSync(exported.file)), exported.sha256);

      const text = readFileSync(exported.file, 'utf8');
      const state = stateOf();
      const expected = {
        'Skills publicadas': Object.keys(state.skills ?? {}).length,
        Versiones: Object.values(state.skills ?? {}).reduce((total, skill) => total + (skill.versions?.length ?? 0), 0),
        'Proyectos registrados': Object.keys(state.projects ?? {}).length,
        'Asignaciones encendidas': activeAssignments(state),
        'Propuestas de mejora': Object.keys(state.improvements ?? {}).length,
        'Peticiones humanas': Object.keys(state.requests ?? {}).length,
        'Eventos en el diario': (state.events ?? []).length,
      };
      const actual = {};
      for (const [label, value] of Object.entries(expected)) {
        actual[label] = reportMetric(text, label);
        assert.equal(actual[label], value, `la cifra "${label}" del informe no coincide con el almacén`);
      }
      assert.ok(text.includes('encendida 1.1.0'), 'el informe debe mostrar el pin vigente del proyecto A');
      assert.ok(text.includes(ctx.id));

      const centerAfter = sha256(readFileSync(centerFile(store)));
      const sizeAfter = statSync(centerFile(store)).size;
      assert.equal(centerAfter, centerBefore, 'exportar no puede tocar center.json');
      assert.equal(sizeAfter, sizeBefore);

      const summary = Object.entries(actual).map(([label, value]) => `${label}=${value}`).join(', ');

      return {
        executed: 'export con actor \'ai\' (rechazo) + export con actor \'human\'; lectura del Markdown y contraste con loadState().',
        measured: `${summary}; informe=${exported.file} (${exported.bytes} B, sha256=${short(exported.sha256)}); center.json sha256 ${short(centerBefore)}→${short(centerAfter)} (${sizeBefore} B) sin cambio; proyectos/versiones/eventos contrastados.`,
        evidence: `${exported.file}`,
      };
    });

    // ── 18 ───────────────────────────────────────────────────────────────────────────────────────
    await step(18, 'Las cifras del informe exportado coinciden con el almacén temporal', async () => {
      assert.ok(ctx.exportedFile, 'el paso de exportación debe dejar la ruta del informe');
      const text = readFileSync(ctx.exportedFile, 'utf8');
      const loaded = loadState(store);
      const state = loaded.state;
      const expected = {
        'Skills publicadas': Object.keys(state.skills ?? {}).length,
        Versiones: Object.values(state.skills ?? {}).reduce((total, skill) => total + (skill.versions?.length ?? 0), 0),
        'Proyectos registrados': Object.keys(state.projects ?? {}).length,
        'Asignaciones encendidas': activeAssignments(state),
        'Eventos en el diario': (state.events ?? []).length,
      };
      const measured = {};
      for (const [label, value] of Object.entries(expected)) {
        measured[label] = reportMetric(text, label);
        assert.equal(measured[label], value, `la cifra "${label}" del informe no coincide con el almacén temporal`);
      }
      const again = readFileSync(ctx.exportedFile, 'utf8');
      assert.equal(again, text, 'el informe exportado no puede cambiar entre dos lecturas');
      return {
        executed: 'lectura del Markdown exportado y contraste contra loadState(store) de un almacén recién abierto.',
        measured: `${Object.entries(measured).map(([label, value]) => `${label}=${value}`).join(', ')}; informe estable entre dos lecturas.`,
        evidence: `${ctx.exportedFile}`,
      };
    });

    // ── 19 ───────────────────────────────────────────────────────────────────────────────────────
    await step(19, 'Comprobar que el almacén real no cambió', async () => {
      const realAfterNow = fingerprintTree(REAL_ROOT);
      assert.ok(realBefore, 'no se pudo medir la huella inicial del almacén real');
      assert.equal(realAfterNow.exists, realBefore.exists, 'la existencia del almacén real cambió');
      assert.equal(realAfterNow.centerSha, realBefore.centerSha, 'center.json del almacén real cambió');
      assert.equal(realAfterNow.centerSize, realBefore.centerSize, 'el tamaño de center.json del almacén real cambió');
      assert.equal(realAfterNow.files.length, realBefore.files.length, 'apareció o desapareció un fichero en el almacén real');
      assert.equal(realAfterNow.dirs.length, realBefore.dirs.length, 'apareció o desapareció un directorio en el almacén real');
      assert.equal(realAfterNow.digest, realBefore.digest, 'la huella del árbol del almacén real cambió');

      // Y la prueba de que el trabajo ocurrió de verdad en la caja de arena.
      assert.ok(existsSync(store));
      assert.ok(readdirSync(store).length > 0);
      assert.ok(existsSync(centerFile(store)));

      return {
        executed: 'fingerprintTree(REAL_ROOT) al empezar y al terminar (ficheros + tamaños + sha256 + directorios); comprobación de center.json y del árbol temporal.',
        measured: `center.json sha256 ${realBefore.centerSha ?? '(no existe)'}→${realAfterNow.centerSha ?? '(no existe)'}; tamaño ${realBefore.centerSize}→${realAfterNow.centerSize} B; ficheros ${realBefore.files.length}→${realAfterNow.files.length}; directorios ${realBefore.dirs.length}→${realAfterNow.dirs.length}; huella del árbol ${short(realBefore.digest, 16)}→${short(realAfterNow.digest, 16)}; almacén temporal con ${readdirSync(store).length} entradas en la raíz.`,
        evidence: `${REAL_ROOT} (sólo lectura) y ${store} (temporal)`,
      };
    });
  } catch (error) {
    fatal = `${error?.stack ?? error?.message ?? error}`;
    failures += 1;
    console.error('');
    console.error('FALLO FATAL DEL ARNÉS:');
    console.error(fatal);
  } finally {
    try {
      realAfter = fingerprintTree(REAL_ROOT);
    } catch (error) {
      realAfter = null;
      console.error(`No se pudo medir la huella final del almacén real: ${error?.message ?? error}`);
    }

    fillMissingSteps();
    printTable();

    if (realBefore !== null && realAfter !== null) {
      const unchanged = realBefore.digest === realAfter.digest
        && realBefore.centerSha === realAfter.centerSha
        && realBefore.centerSize === realAfter.centerSize;
      console.log(`Almacén real: center.json ${realBefore.centerSha ?? '(no existe)'} → ${realAfter.centerSha ?? '(no existe)'} · ${unchanged ? 'SIN CAMBIOS' : 'CAMBIÓ'}`);
    }

    kept = failures > 0 || fatal !== '' || process.env.LSC_E2E_KEEP === '1';
    if (tempBase !== '' && !kept) {
      try {
        rmSync(tempBase, { recursive: true, force: true });
      } catch (error) {
        console.error(`No se pudo limpiar ${tempBase}: ${error?.message ?? error}`);
      }
    }
    if (kept && tempBase !== '') {
      console.log(`Almacén temporal conservado para inspección: ${store}`);
      console.log(`Caja de arena: ${tempBase}`);
    }

    const finishedAt = new Date().toISOString();
    try {
      const markdown = buildReport({ startedAt, finishedAt, realBefore, realAfter, tempBase, store, kept, fatal });
      writeReport(markdown);
      console.log(`Informe: ${REPORT_PATH}`);
    } catch (error) {
      console.error(`No se pudo escribir el informe: ${error?.message ?? error}`);
      failures += 1;
    }

    process.exitCode = failures > 0 ? 1 : 0;
    console.log(`Salida: ${process.exitCode}`);
  }
}

await main();
