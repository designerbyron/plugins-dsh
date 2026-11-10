#!/usr/bin/env node
/**
 * Inyector de mutantes y runner para el Centro de Skills.
 *
 * Copia el plugin a un directorio temporal (sin node_modules) y enlaza node_modules con un
 * junction, porque el adaptador `index.js` importa `@deepseek-ai/dsh-tools` y las pruebas de
 * `index.test.mjs` lo cargan. Sin ese enlace el baseline falla por importación, no por lógica,
 * y todos los mutantes se contarían como «detectados» en falso.
 *
 * Cada mutante se aplica por reemplazo textual exacto sobre la copia, se corre `node --test`
 * allí y se restaura el fichero original antes del siguiente. El repositorio no se modifica.
 *
 * Uso:
 *   node tools/mutation.mjs                 # baseline + catálogo completo
 *   node tools/mutation.mjs --list          # sólo lista los mutantes
 *   node tools/mutation.mjs --only b-enabled-inverted
 *   node tools/mutation.mjs --keep          # no borra el temporal (para inspeccionar)
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, '..');

/**
 * Catálogo. `critical: true` son los diez del encargo (a–j); el resto son sondas adicionales
 * que documentan huecos de cobertura sin contar en el score crítico.
 */
const MUTANTS = [
  {
    id: 'm-settle-decision',
    critical: true,
    category: 'integridad',
    file: 'lib/knowledge.mjs',
    line: 0,
    skill: 'autorizar sin dejar constancia del resultado',
    find: "  entry.settled = { ok, detail: String(detail ?? ''), at: now };",
    replace: "  entry.settled = null;",
    covers: 'tests/autonomy-binding.test.mjs (el asiento dice si se ejecutó)',
  },
  {
    id: 'm-bind-project',
    critical: true,
    category: 'aislamiento',
    file: 'lib/api.mjs',
    line: 0,
    skill: 'dejar que la IA opere sobre el proyecto que diga el payload',
    find: "  if (String(actor) !== 'ai') return { ok: true, projectId: String(data?.projectId ?? '') };",
    replace: "  return { ok: true, projectId: String(data.projectId ?? '') };",
    covers: 'tests/autonomy-binding.test.mjs (project-mismatch)',
  },
  {
    id: 'a-evidence-gate',
    critical: true,
    category: 'autorización',
    file: 'lib/decisions.mjs',
    line: 138,
    skill: 'dejar pasar cualquier nivel de evidencia',
    find: "  gate('evidence', atLeast(evidence.level, rule.minLevel),",
    replace: "  gate('evidence', true,",
    covers: 'tests/autonomy.test.mjs (sin evidencia no enciende; una fuente no activa)',
  },
  {
    id: 'a-human-veto-gate',
    critical: true,
    category: 'autorización',
    file: 'lib/decisions.mjs',
    line: 162,
    skill: 'ignorar el veto de una persona que apagó la asignación',
    find: "    const humanVeto = isPlainObject(row) && row.enabled === false && text(row.by) === 'human';",
    replace: '    const humanVeto = false;',
    covers: 'tests/autonomy.test.mjs (una decisión humana en contra manda)',
  },
  {
    id: 'a-policy-gate',
    critical: false,
    category: 'autorización',
    file: 'lib/decisions.mjs',
    line: 134,
    skill: 'ignorar la política human-approved del proyecto',
    find: "  gate('policy', preparesOnly || autonomyGranted, preparesOnly",
    replace: "  gate('policy', true, preparesOnly",
    covers: 'tests/autonomy.test.mjs (la política devuelve la decisión a la persona)',
  },
  {
    id: 'b-enabled-inverted',
    critical: true,
    category: 'autorización',
    file: 'lib/operations.mjs',
    line: 507,
    skill: 'invertir el filtro de `enabled` en la entrega al catálogo',
    find: '    const assignment = row[skillId];\n    if (assignment?.enabled !== true) continue;',
    replace: '    const assignment = row[skillId];\n    if (assignment?.enabled === true) continue;',
    covers: 'tests/api.test.mjs:139-170',
  },
  {
    id: 'c-cross-project-toggle',
    critical: true,
    category: 'aislamiento',
    file: 'lib/operations.mjs',
    line: 394,
    skill: 'propagar el toggle a las filas de otros proyectos',
    find: '  state.assignments[projectId] = row;',
    replace:
      '  for (const other of Object.keys(state.assignments)) {\n' +
      '    if (other !== projectId && state.assignments[other][skillId] !== undefined) {\n' +
      '      state.assignments[other][skillId] = { ...row[skillId] };\n' +
      '    }\n' +
      '  }\n' +
      '  state.assignments[projectId] = row;',
    covers: 'tests/operations.test.mjs:135-152',
  },
  {
    id: 'd-integrity-gate-removed',
    critical: true,
    category: 'integridad',
    file: 'lib/state.mjs',
    line: 830,
    skill: 'quitar la comprobación de integridad antes de escribir',
    find: '    if (!canWrite(loaded.integrity)) {',
    replace: '    if (false) {',
    covers: 'tests/integrity.test.mjs:86-105',
  },
  {
    id: 'e-duplicate-skill-overwrite',
    critical: true,
    category: 'integridad',
    file: 'lib/operations.mjs',
    line: 142,
    skill: 'permitir que `create` sobrescriba una skill ya publicada',
    find: '  if (state.skills[id] !== undefined) {',
    replace: '  if (false) {',
    covers: 'tests/api.test.mjs:344-351',
  },
  {
    id: 'f-manifest-overwrite',
    critical: true,
    category: 'integridad',
    file: 'lib/manifest-ops.mjs',
    line: 172,
    skill: 'sobrescribir el manifiesto existente en vez de fallar con EEXIST',
    find: '    hooks.beforeLink?.({ temporary, path });\n    project.linkSync(temporary, path);',
    replace:
      '    hooks.beforeLink?.({ temporary, path });\n' +
      '    project.rmSync(path, { force: true });\n' +
      '    project.linkSync(temporary, path);',
    covers: 'tests/manifest-ops.test.mjs:80-94',
  },
  {
    id: 'g-auto-pin-approve',
    critical: true,
    category: 'aislamiento',
    file: 'lib/operations.mjs',
    line: 347,
    skill: 'mover el pin de todos los proyectos al aprobar una versión',
    find: '  skill.versions.push(version);\n  skill.currentVersion = version.version;\n  skill.description = improvement.description;',
    replace:
      '  skill.versions.push(version);\n' +
      '  skill.currentVersion = version.version;\n' +
      '  for (const row of Object.values(state.assignments)) {\n' +
      '    for (const entry of Object.values(row)) {\n' +
      '      if (entry?.enabled === true) entry.version = version.version;\n' +
      '    }\n' +
      '  }\n' +
      '  skill.description = improvement.description;',
    covers: 'tests/advance.test.mjs:16-57',
  },
  {
    id: 'g2-auto-pin-publish',
    critical: false,
    category: 'aislamiento',
    file: 'lib/operations.mjs',
    line: 245,
    skill: 'mover el pin de todos los proyectos al publicar una versión',
    find: '  skill.versions.push(version);\n  skill.currentVersion = version.version;\n  skill.description = candidate.description;',
    replace:
      '  skill.versions.push(version);\n' +
      '  skill.currentVersion = version.version;\n' +
      '  for (const row of Object.values(state.assignments)) {\n' +
      '    for (const entry of Object.values(row)) {\n' +
      '      if (entry?.enabled === true) entry.version = version.version;\n' +
      '    }\n' +
      '  }\n' +
      '  skill.description = candidate.description;',
    covers: 'sin prueba que publique con un pin activo y compruebe que no se mueve',
  },
  {
    id: 'h-advance-event-omitted',
    critical: true,
    category: 'integridad',
    file: 'lib/operations.mjs',
    line: 488,
    skill: 'omitir el evento `skill.advanced` del diario',
    find: "    appendEvent(state, {\n      id: eventId(now, 'skill', skillId),",
    replace: "    void ({\n      id: eventId(now, 'skill', skillId),",
    covers: 'tests/advance.test.mjs:56',
  },
  {
    id: 'i-blocks-never',
    critical: true,
    category: 'calidad',
    file: 'lib/evaluate.mjs',
    line: 117,
    skill: 'aceptar como publicable una evaluación con hallazgos bloqueantes',
    find: "  const blocksPublish = findings.some((finding) => finding.severity === 'block');",
    replace: '  const blocksPublish = false;',
    covers: 'tests/evaluate.test.mjs (status fail) y tests/operations.test.mjs:62-71',
  },
  {
    id: 'j-lock-removed',
    critical: true,
    category: 'concurrencia',
    file: 'lib/state.mjs',
    line: 825,
    skill: 'quitar el candado del almacén en `withState`',
    find: 'export function withState(root = defaultRoot(), mutate, { now } = {}) {\n  const stamp = now ?? new Date().toISOString();\n  const release = acquireLock(root);',
    replace: 'export function withState(root = defaultRoot(), mutate, { now } = {}) {\n  const stamp = now ?? new Date().toISOString();\n  const release = () => {};',
    covers: 'tests/concurrency.test.mjs:26-42',
  },
  {
    id: 'j2-stale-never-removed',
    critical: false,
    category: 'concurrencia',
    file: 'lib/state.mjs',
    line: 759,
    skill: 'no retirar nunca un candado abandonado',
    find: '        if (Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) rmSync(file, { force: true });',
    replace: '        if (false) rmSync(file, { force: true });',
    covers: 'sin prueba directa de `acquireLock` sobre candado abandonado (inspectLock sí se prueba)',
  },
];

function parseArgs(argv) {
  const out = { only: null, list: false, keep: false, timeout: 240000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') out.list = true;
    else if (arg === '--keep') out.keep = true;
    else if (arg === '--only') out.only = argv[++i] ?? '';
  else if (arg.startsWith('--only=')) out.only = arg.slice('--only='.length);
    else if (arg === '--timeout') out.timeout = Number(argv[++i] ?? out.timeout);
  }
  return out;
}

function copyPlugin() {
  const dir = mkdtempSync(join(tmpdir(), 'lsc-mutation-'));
  cpSync(PLUGIN, dir, {
    recursive: true,
    filter: (source) => {
      const base = source.slice(PLUGIN.length).replace(/^[\\/]/, '');
      if (base === '') return true;
      return !/^(node_modules|\.git)([\\/]|$)/.test(base);
    },
  });
  const modules = join(PLUGIN, 'node_modules');
  if (existsSync(modules)) {
    symlinkSync(modules, join(dir, 'node_modules'), 'junction');
  }
  return dir;
}

function runSuite(cwd, timeout) {
  const started = Date.now();
  const child = spawnSync(process.execPath, ['--test'], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  const text = `${child.stdout ?? ''}\n${child.stderr ?? ''}`;
  const failMatch = text.match(/(?:^|\n)\s*(?:#|ℹ)\s*fail\s+(\d+)/);
  const passMatch = text.match(/(?:^|\n)\s*(?:#|ℹ)\s*pass\s+(\d+)/);
  const failed = [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  const failedSpec = [...text.matchAll(/^\s*✖\s+(.+?)\s+\(\d/gm)].map((m) => m[1].trim());
  const names = [...new Set([...failed, ...failedSpec])];
  return {
    exitCode: child.status,
    signal: child.signal ?? null,
    timedOut: child.error?.code === 'ETIMEDOUT',
    fail: failMatch ? Number(failMatch[1]) : null,
    pass: passMatch ? Number(passMatch[1]) : null,
    failedTests: names.slice(0, 4),
    ms: Date.now() - started,
    tail: text.slice(-4000),
  };
}

function applyMutant(dir, mutant) {
  const target = join(dir, mutant.file);
  const original = readFileSync(target, 'utf8');
  const hits = original.split(mutant.find).length - 1;
  if (hits !== 1) {
    return { applied: false, original, reason: `el patrón aparece ${hits} veces (se exige exactamente 1)` };
  }
  writeFileSync(target, original.replace(mutant.find, mutant.replace), 'utf8');
  return { applied: true, original };
}

function restore(dir, mutant, original) {
  writeFileSync(join(dir, mutant.file), original, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const m of MUTANTS) {
      console.log(`${m.critical ? 'CRIT' : 'extra'} ${m.id}\t${m.file}:${m.line}\t${m.skill}`);
    }
    return;
  }
  const selected = args.only ? MUTANTS.filter((m) => m.id === args.only) : MUTANTS;
  if (selected.length === 0) {
    console.error(`no hay mutante con id "${args.only}"`);
    process.exitCode = 2;
    return;
  }

  const dir = copyPlugin();
  console.log(`[mutation] copia temporal: ${dir}`);
  console.log(`[mutation] node_modules: ${existsSync(join(dir, 'node_modules')) ? 'junction al original' : 'ausente'}`);

  const baseline = runSuite(dir, args.timeout);
  console.log(
    `[baseline] exit=${baseline.exitCode} pass=${baseline.pass ?? '?'} fail=${baseline.fail ?? '?'} (${baseline.ms} ms)`,
  );
  if (baseline.exitCode !== 0) {
    console.error('[baseline] la copia no pasa en verde: se aborta para no contar falsos positivos');
    console.error(baseline.tail);
    if (!args.keep) rmSync(dir, { recursive: true, force: true });
    process.exitCode = 3;
    return;
  }

  const results = [];
  const lineOf = (mutant) => {
    const file = join(PLUGIN, mutant.file);
    if (!existsSync(file)) return null;
    const index = readFileSync(file, 'utf8').indexOf(mutant.find);
    if (index < 0) return null;
    return readFileSync(file, 'utf8').slice(0, index).split('\n').length;
  };
  for (const mutant of selected) {
    const applied = applyMutant(dir, mutant);
    if (!applied.applied) {
      results.push({ ...mutant, status: 'not-applicable', reason: applied.reason });
      console.log(`[${mutant.id}] NO APLICABLE: ${applied.reason}`);
      continue;
    }
    const run = runSuite(dir, args.timeout);
    restore(dir, mutant, applied.original);
    const broken = /SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module/u.test(String(run.stderr ?? run.tail ?? ''));
    if (broken) {
      results.push({ ...mutant, status: 'invalid', reason: 'el mutante rompe el módulo' });
      console.log(`[${mutant.id}] INVALIDO: el mutante rompe el módulo`);
      continue;
    }
    const detected = run.exitCode !== 0 && Number(run.fail ?? 0) > 0;
    results.push({ ...mutant, status: detected ? 'detected' : 'survived', run });
    console.log(
      `[${mutant.id}] ${detected ? 'DETECTADO' : 'SOBREVIVE'} fail=${run.fail ?? '?'} pass=${run.pass ?? '?'} (${run.ms} ms)` +
        (detected && run.failedTests.length > 0 ? ` — ${run.failedTests.join(' | ')}` : ''),
    );
  }

  const valid = results.filter((r) => r.status !== 'not-applicable' && r.status !== 'invalid');
  const critical = valid.filter((r) => r.critical);
  const detectedCritical = critical.filter((r) => r.status === 'detected');
  const detectedAll = valid.filter((r) => r.status === 'detected');

  if (valid.length !== detectedAll.length) {
    process.exitCode = 1;
    console.log('SOBREVIVIENTES: ' + valid.filter((r) => r.status === 'survived').map((r) => r.id).join(', '));
  }
  console.log('\n=== RESULTADOS ===');
  console.log('id\tcrit\tarchivo:linea\testado\tdetectado');
  for (const r of results) {
    r.reportedLine = r.status === 'not-applicable' ? r.line : (lineOf(r) ?? r.line);
    console.log(`${r.id}\t${r.critical ? 'sí' : 'no'}\t${r.file}:${r.reportedLine}\t${r.status}\t${r.status === 'detected' ? 'sí' : 'no'}`);
  }
  console.log(
    `\nCRÍTICOS: ${detectedCritical.length}/${critical.length} (${critical.length === 0 ? 0 : Math.round((detectedCritical.length / critical.length) * 100)}%)`,
  );
  console.log(
    `TOTAL: ${detectedAll.length}/${valid.length} (${valid.length === 0 ? 0 : Math.round((detectedAll.length / valid.length) * 100)}%)`,
  );
  const survivors = valid.filter((r) => r.status === 'survived');
  if (survivors.length > 0) {
    console.log('\nSUPERVIVIENTES:');
    for (const r of survivors) console.log(`- ${r.id} (${r.file}:${r.line}) ${r.skill}`);
  }

  if (!args.keep) rmSync(dir, { recursive: true, force: true });
  else console.log(`\n[mutation] temporal conservado: ${dir}`);
}

main();
