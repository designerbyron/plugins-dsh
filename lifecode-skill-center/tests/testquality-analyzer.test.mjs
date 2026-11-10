/**
 * Pruebas del analizador de calidad de pruebas.
 *
 * Cada caso siembra UN defecto en una raíz temporal (mkdtemp) y comprueba que
 * `tools/testquality.mjs` lo encuentra con la severidad y la LÍNEA exactas. Si una regla se rompe
 * o empieza a señalar otra línea, esto falla: el analizador no puede degradarse en silencio.
 *
 * Nada de esto toca `tests/` del plugin ni el almacén real: la raíz auditada es siempre temporal.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, '..', 'tools', 'testquality.mjs');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'testquality-'));
  mkdirSync(join(root, 'tests'));
  mkdirSync(join(root, 'tools'));
  mkdirSync(join(root, 'lib'));
  return root;
}

function seed(root, relative, source) {
  writeFileSync(join(root, relative), source);
  return source;
}

function lineOf(source, marker) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `falta el marcador ${marker} en el fixture`);
  return source.slice(0, at).split('\n').length;
}

function audit(root) {
  const run = spawnSync(process.execPath, [TOOL, '--root', root, '--json'], { encoding: 'utf8' });
  assert.equal(run.stderr, '', `el analizador escribió en stderr: ${run.stderr}`);
  const report = JSON.parse(run.stdout);
  return { ...report, status: run.status };
}

function only(report, rule) {
  const found = report.findings.filter((finding) => finding.rule === rule);
  assert.equal(found.length, 1, `se esperaba un hallazgo ${rule}, hay ${found.length}: ${JSON.stringify(found)}`);
  return found[0];
}

// ---------------------------------------------------------------------------
// Raíz con un defecto sembrado por patrón
// ---------------------------------------------------------------------------

const TAUTOLOGY = `import test from 'node:test';
import assert from 'node:assert/strict';

test('el estado se compara consigo mismo', () => {
  const state = { skills: {} };
  assert.equal(state, state); // MARCA-AUTO
});

test('el árbol no menciona act', () => {
  const tree = { type: 'div', props: { onImport: () => {} } };
  const flat = JSON.stringify(tree);
  assert.ok(!flat.includes('act(')); // MARCA-JSON
});
`;

const SUBSTRINGS = `import test from 'node:test';
import assert from 'node:assert/strict';

test('el resumen cuenta las entregas', () => {
  const flat = renderSummary({ total: 7 });
  assert.ok(flat.includes('7')); // MARCA-NUMERO
});

test('el texto no repite una stopword', () => {
  const result = summarize('hola mundo');
  assert.ok(!result.includes('los')); // MARCA-VACUA
});

test('la vista filtra por ruta', () => {
  const mine = rows.filter((project) => String(project.cwd).includes('/z-')); // MARCA-POSIX
  assert.equal(mine.length, 1);
});

test('el panel avisa mientras carga', () => { // MARCA-AVISO
  const tree = renderPanel({ loading: true });
  assert.ok(tree);
});
`;

const CONTRACTS = `import test from 'node:test';
import assert from 'node:assert/strict';

test('la escritura es atómica', () => { // MARCA-ATOMICA
  const raw = saveAndRead({ schemaVersion: 1 });
  assert.doesNotThrow(() => JSON.parse(raw));
});

test('los estilos se inyectan una vez', () => { // MARCA-UNAVEZ
  const cleanups = [];
  injectStyles({ cleanups });
  assert.ok(cleanups.length >= 1);
});
`;

const GREEN = `import test from 'node:test';
import assert from 'node:assert/strict';

test('publicar registra el evento', () => { // MARCA-SIN
  publish();
});

test('según el resultado de la operación', () => { // MARCA-CONDICIONAL
  const result = run();
  if (result.ok === true) {
    assert.equal(result.kind, 'publicada');
  } else {
    assert.equal(result.kind, 'rechazada');
  }
});

test('la herramienta se salta cuando no aplica', (t) => { // MARCA-SKIP
  t.skip('entorno sin permiso');
});
`;

const SWALLOWED = `import test from 'node:test';
import assert from 'node:assert/strict';

test('publicar no deja comprobante si falla', () => {
  try { publish(); } catch {} // MARCA-CATCH
  assert.equal(readOperations(), undefined);
});

test('el adaptador no propaga su fallo', () => {
  const done = load().catch(() => {}); // MARCA-PROMESA
  assert.ok(done);
});
`;

const SPY = `import test from 'node:test';
import assert from 'node:assert/strict';

test('la biblioteca delega en el panel', () => {
  const calls = []; // MARCA-ESPIA
  const onImport = (text) => calls.push(text);
  const tree = mount({ onImport });
  assert.ok(tree);
});
`;

// La ruta se compone para que el fixture sembrado sea realista sin que este
// fichero (que también se audita) contenga un perfil de usuario literal.
const USER_DIR = ['C:', 'Users', 'example'].join('/');

const STORE = `import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const REAL_STORE = '${USER_DIR}/.dsh/lifecode-skill-center/center.json'; // MARCA-RUTA
const HOME_STORE = join(homedir(), '.dsh', 'lifecode-skill-center'); // MARCA-ALMACEN

test('copia el almacén real para el fixture', () => {
  const source = readFileSync(REAL_STORE, 'utf8');
  assert.ok(source.length > 0);
});
`;

const SOURCE_TEXT = `import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8'); // MARCA-FUENTE

test('el panel cablea la acción', () => {
  assert.ok(source.includes('detectState'));
  assert.ok(source.includes('act('));
  assert.ok(source.includes('IdentityDialog'));
});
`;

const MUTATION_CATALOG = `export const MUTANTS = [
  { // MARCA-MUT-IDENTIDAD
    id: 'identidad',
    file: 'lib/target.mjs',
    line: 3,
    find: 'export const two = 2;',
    replace: 'export const two = 2;',
    covers: 'tests/target.test.mjs',
  },
  { // MARCA-MUT-NOUNICO
    id: 'no-unico',
    file: 'lib/target.mjs',
    line: 1,
    find: 'export const one',
    replace: 'export const uno',
    covers: 'tests/target.test.mjs',
  },
  { // MARCA-MUT-DESVIADO
    id: 'desviado',
    file: 'lib/target.mjs',
    line: 1,
    find: 'export const gate = (x) => x !== true;',
    replace: 'export const gate = (x) => true;',
    covers: 'tests/target.test.mjs',
  },
  { // MARCA-MUT-HUECO
    id: 'hueco',
    file: 'lib/target.mjs',
    line: 4,
    find: 'export const gate = (x) => x !== true;',
    replace: 'export const gate = (x) => false;',
    covers: 'sin prueba que lo mate', // MARCA-MUT-COVERS
  },
];

const detected = run.exitCode !== 0; // MARCA-MUT-CIEGA
`;

const TARGET = `export const one = 1;
export const oneAgain = 1;
export const two = 2;
export const gate = (x) => x !== true;
`;

function seeded() {
  const root = fixture();
  seed(root, 'tests/tautology.test.mjs', TAUTOLOGY);
  seed(root, 'tests/substrings.test.mjs', SUBSTRINGS);
  seed(root, 'tests/contracts.test.mjs', CONTRACTS);
  seed(root, 'tests/green.test.mjs', GREEN);
  seed(root, 'tests/swallowed.test.mjs', SWALLOWED);
  seed(root, 'tests/spy.test.mjs', SPY);
  seed(root, 'tests/store.test.mjs', STORE);
  seed(root, 'tests/source-text.test.mjs', SOURCE_TEXT);
  seed(root, 'tests/target.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('suma', () => {\n  assert.equal(1 + 1, 2);\n});\n");
  seed(root, 'lib/target.mjs', TARGET);
  seed(root, 'tools/mutation.mjs', MUTATION_CATALOG);
  // El corpus debe contener las rutas críticas que el analizador exige en toda la suite; si no,
  // además de los casos sembrados aparecerían los hallazgos de cobertura (que se prueban aparte).
  seed(root, 'tests/coverage-tokens.test.mjs', `// approval-required evidence integrity events.length
// el aislamiento se mide con notEqual(root, real)
import test from 'node:test';
import assert from 'node:assert/strict';

test('suma', () => {
  assert.equal(1 + 1, 2);
});
`);
  return root;
}

test('el analizador sale con 1 cuando hay un hallazgo de severidad alta', () => {
  const report = audit(seeded());
  assert.equal(report.status, 1);
  assert.ok(report.summary.alta > 0);
});

test('detecta una comparación de un valor consigo mismo, en su línea', () => {
  const report = audit(seeded());
  const found = only(report, 'tautologia/valor-contra-si-mismo');
  assert.equal(found.severity, 'alta');
  assert.equal(found.file, 'tests/tautology.test.mjs');
  assert.equal(found.line, lineOf(TAUTOLOGY, '// MARCA-AUTO'));
});

test('detecta una negación sobre JSON.stringify que nunca puede fallar', () => {
  const report = audit(seeded());
  const found = only(report, 'tautologia/json-stringify');
  assert.equal(found.severity, 'alta');
  assert.equal(found.file, 'tests/tautology.test.mjs');
  assert.equal(found.line, lineOf(TAUTOLOGY, '// MARCA-JSON'));
});

test('detecta una aguja numérica suelta y una negación vacua', () => {
  const report = audit(seeded());
  const numeric = only(report, 'fragil/aguja-numerica');
  assert.equal(numeric.severity, 'alta');
  assert.equal(numeric.file, 'tests/substrings.test.mjs');
  assert.equal(numeric.line, lineOf(SUBSTRINGS, '// MARCA-NUMERO'));

  const vacuous = only(report, 'fragil/negacion-vacua');
  assert.equal(vacuous.severity, 'media');
  assert.equal(vacuous.file, 'tests/substrings.test.mjs');
  assert.equal(vacuous.line, lineOf(SUBSTRINGS, '// MARCA-VACUA'));
});

test('detecta una prueba que depende de separadores POSIX', () => {
  const report = audit(seeded());
  const found = only(report, 'fragil/separador-posix');
  assert.equal(found.severity, 'media');
  assert.equal(found.file, 'tests/substrings.test.mjs');
  assert.equal(found.line, lineOf(SUBSTRINGS, '// MARCA-POSIX'));
});

test('detecta un nombre que promete un aviso que el cuerpo no comprueba', () => {
  const report = audit(seeded());
  const found = only(report, 'nombre/promete-aviso');
  assert.equal(found.severity, 'media');
  assert.equal(found.file, 'tests/substrings.test.mjs');
  assert.equal(found.line, lineOf(SUBSTRINGS, '// MARCA-AVISO'));
});

test('detecta un nombre que promete una ventana crítica sin ejercerla', () => {
  const report = audit(seeded());
  const found = only(report, 'nombre/promete-atomicidad');
  assert.equal(found.severity, 'alta');
  assert.equal(found.file, 'tests/contracts.test.mjs');
  assert.equal(found.line, lineOf(CONTRACTS, '// MARCA-ATOMICA'));
});

test('detecta un contador que se conforma con uno o más', () => {
  const report = audit(seeded());
  const found = only(report, 'nombre/promete-una-vez');
  assert.equal(found.severity, 'media');
  assert.equal(found.file, 'tests/contracts.test.mjs');
  assert.equal(found.line, lineOf(CONTRACTS, '// MARCA-UNAVEZ'));
});

test('detecta una prueba sin aserciones y otra verde en las dos ramas', () => {
  const report = audit(seeded());
  const empty = report.findings.find((finding) =>
    finding.rule === 'verde/sin-aserciones' && finding.file === 'tests/green.test.mjs');
  assert.ok(empty, 'falta verde/sin-aserciones para green.test.mjs');
  assert.equal(empty.severity, 'alta');
  assert.equal(empty.line, lineOf(GREEN, '// MARCA-SIN'));

  const conditional = only(report, 'verde/solo-condicional');
  assert.equal(conditional.severity, 'alta');
  assert.equal(conditional.file, 'tests/green.test.mjs');
  assert.equal(conditional.line, lineOf(GREEN, '// MARCA-CONDICIONAL'));
});

test('detecta una prueba que se declara omitible', () => {
  const report = audit(seeded());
  const found = only(report, 'verde/prueba-omitible');
  assert.equal(found.severity, 'baja');
  assert.equal(found.file, 'tests/green.test.mjs');
  assert.equal(found.line, lineOf(GREEN, '// MARCA-SKIP'));
});

test('detecta un catch vacío y una promesa que se traga su error', () => {
  const report = audit(seeded());
  const empty = only(report, 'error/catch-vacio');
  assert.equal(empty.severity, 'alta');
  assert.equal(empty.file, 'tests/swallowed.test.mjs');
  assert.equal(empty.line, lineOf(SWALLOWED, '// MARCA-CATCH'));

  const silent = only(report, 'error/promesa-silenciada');
  assert.equal(silent.severity, 'alta');
  assert.equal(silent.file, 'tests/swallowed.test.mjs');
  assert.equal(silent.line, lineOf(SWALLOWED, '// MARCA-PROMESA'));
});

test('detecta un espía que acumula llamadas y nadie lee', () => {
  const report = audit(seeded());
  const found = only(report, 'cobertura/espia-sin-leer');
  assert.equal(found.severity, 'alta');
  assert.equal(found.file, 'tests/spy.test.mjs');
  assert.equal(found.line, lineOf(SPY, '// MARCA-ESPIA'));
});

test('detecta una ruta con el perfil del autor y una lectura del almacén real', () => {
  const report = audit(seeded());
  const hardcoded = only(report, 'fragil/ruta-de-usuario');
  assert.equal(hardcoded.severity, 'alta');
  assert.equal(hardcoded.file, 'tests/store.test.mjs');
  assert.equal(hardcoded.line, lineOf(STORE, '// MARCA-RUTA'));

  const real = only(report, 'fragil/almacen-real');
  assert.equal(real.severity, 'media');
  assert.equal(real.file, 'tests/store.test.mjs');
  assert.equal(real.line, lineOf(STORE, 'import { homedir }'));
});

test('detecta aserciones sobre el texto fuente del producto', () => {
  const report = audit(seeded());
  const found = only(report, 'fragil/texto-fuente');
  assert.equal(found.severity, 'media');
  assert.equal(found.file, 'tests/source-text.test.mjs');
  // Se reporta la primera lectura textual del producto, no el comentario.
  assert.equal(found.line, lineOf(SOURCE_TEXT, "assert.ok(source.includes('detectState'))"));
});

test('detecta los defectos del catálogo de mutantes', () => {
  const report = audit(seeded());
  const blockLine = (id) => lineOf(MUTATION_CATALOG, `id: '${id}'`) - 1;

  const identity = only(report, 'mutante/identidad');
  assert.equal(identity.severity, 'alta');
  assert.equal(identity.file, 'tools/mutation.mjs');
  assert.equal(identity.line, blockLine('identidad'));

  const notUnique = only(report, 'mutante/no-unico');
  assert.equal(notUnique.severity, 'alta');
  assert.equal(notUnique.line, blockLine('no-unico'));

  const drift = only(report, 'mutante/linea-desviada');
  assert.equal(drift.severity, 'media');
  assert.equal(drift.line, blockLine('desviado'));
  assert.match(drift.message, /línea 4/);

  const gap = only(report, 'mutante/hueco-declarado');
  assert.equal(gap.severity, 'media');
  assert.equal(gap.line, lineOf(MUTATION_CATALOG, '// MARCA-MUT-COVERS'));

  const blind = only(report, 'mutante/deteccion-ciega');
  assert.equal(blind.severity, 'alta');
  assert.equal(blind.line, lineOf(MUTATION_CATALOG, '// MARCA-MUT-CIEGA'));
});

// ---------------------------------------------------------------------------
// Contrapartida: una suite sana sale limpia
// ---------------------------------------------------------------------------

test('una suite con aserciones reales y las rutas críticas cubiertas sale con 0', () => {
  const root = fixture();
  seed(root, 'tests/sana.test.mjs', `// approval-required evidence integrity events.length
// notEqual(root, real)
import test from 'node:test';
import assert from 'node:assert/strict';

test('suma', () => {
  assert.equal(1 + 1, 2);
});

test('rechaza la ruta desconocida', () => {
  const result = runAction({ action: 'desconocida' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown-action');
});
`);
  const report = audit(root);
  assert.deepEqual(report.findings, []);
  assert.equal(report.status, 0);
  assert.deepEqual(report.summary, { alta: 0, media: 0, baja: 0, files: 1, tests: 1, tools: 0 });
});

test('sin tests/ el analizador falla con un mensaje claro y no audita nada', () => {
  const root = mkdtempSync(join(tmpdir(), 'testquality-vacio-'));
  const run = spawnSync(process.execPath, [TOOL, '--root', root], { encoding: 'utf8' });
  // 2 = error de uso, distinto del 1 reservado a «hay hallazgos de severidad alta».
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no hay tests\//);
  assert.equal(run.stdout, '');
});
