/**
 * Las herramientas son la cara que ve el modelo. Importa que existan, que digan la verdad de lo que
 * pasó y —sobre todo— que ninguna pueda aprobar ni activar: eso es de la persona.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { centerTools, scopeOf, lifecodeSkillSearch, lifecodeSkillCreate, lifecodeSkillImprove, lifecodeSkillStatus } from '../lib/tools.mjs';
import { loadState, centerFile, saveState, emptyState } from '../lib/state.mjs';
import { runAction } from '../lib/api.mjs';
import { candidate, tempProject, tempRoot } from './helpers.mjs';

const NOW = '2026-11-08T12:00:00.000Z';

function store() {
  return tempRoot('lsc-tools');
}

function exec(cwd) {
  return { agent: { session: { header: { cwd } } } };
}

function names(tools) {
  return tools.map((tool) => tool.name);
}

test('hay cuatro herramientas y ninguna es de aprobar o activar', () => {
  const tools = centerTools({ root: store() });
  assert.deepEqual(names(tools), ['lifecode_skill_search', 'lifecode_skill_create', 'lifecode_skill_improve', 'lifecode_skill_status']);
  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 100, `la descripción de ${tool.name} tiene que explicar cuándo usarla`);
    assert.equal(tool.output.schema.type, 'object');
    assert.equal(tool.output.schema.additionalProperties, true, 'el objeto abierto evita rechazar campos devueltos');
    assert.equal(typeof tool.output.render, 'function');
    assert.equal(typeof tool.execute, 'function');
    assert.ok(!/activate|approve/i.test(tool.name));
  }
});

test('el ámbito es la ruta de la sesión, no algo que declare el modelo', () => {
  assert.equal(scopeOf(exec('C:/proyecto')), 'C:/proyecto');
  assert.equal(scopeOf(undefined), undefined);
  assert.equal(scopeOf({ agent: {} }), undefined);
});

test('crear deja la skill en la biblioteca, con calidad, y dice que no está activa', () => {
  const root = store();
  const cwd = tempProject('proyecto', tempRoot('lsc-tools-cwd'));
  const created = lifecodeSkillCreate({ root }).execute(candidate(), exec(cwd));
  assert.equal(created.status, 'published');
  assert.equal(created.version, '1.0.0');
  assert.equal(created.quality, 100);
  assert.match(created.summary, /NOT active in any project/);
  assert.equal(loadState(root).state.skills[candidate().id].origin.kind, 'ai');
});

test('crear dos veces la misma skill se informa como existente, no se sobrescribe', () => {
  const root = store();
  const cwd = tempProject('proyecto', tempRoot('lsc-tools-cwd'));
  const tool = lifecodeSkillCreate({ root });
  tool.execute(candidate(), exec(cwd));
  const again = tool.execute(candidate(), exec(cwd));
  assert.equal(again.status, 'exists');
  // El mensaje al modelo es el del núcleo, en el idioma del producto: propone mejorar en vez de duplicar.
  assert.match(again.summary, /ya existe una skill/);
});

test('una creación que no pasa la puerta devuelve los hallazgos, no un éxito vacío', () => {
  const root = store();
  const cwd = tempProject('proyecto', tempRoot('lsc-tools-cwd'));
  const refused = lifecodeSkillCreate({ root }).execute(candidate({ description: '' }), exec(cwd));
  assert.equal(refused.status, 'failed');
  assert.ok(Array.isArray(refused.findings) && refused.findings.length > 0);
});

test('buscar dice qué hay, dónde está y por qué se parece', () => {
  const root = store();
  const cwd = tempProject('proyecto', tempRoot('lsc-tools-cwd'));
  lifecodeSkillCreate({ root }).execute(candidate(), exec(cwd));
  const found = lifecodeSkillSearch({ root }).execute({ query: 'compila y verifica una skill de dsh' }, exec(cwd));
  assert.equal(found.status, 'found');
  assert.equal(found.matches[0].id, candidate().id);
  assert.equal(found.matches[0].kind, 'library');
  assert.equal(found.matches[0].where, 'library');
  assert.ok(found.matches[0].why.length > 0);
  assert.match(found.summary, /related skill/);

  const empty = lifecodeSkillSearch({ root }).execute({ query: 'facturar un pedido en japón' }, exec(cwd));
  assert.equal(empty.status, 'empty');
  assert.match(empty.summary, /new ground/);
});

test('mejorar propone, no publica: la versión viva no cambia', () => {
  const root = store();
  const cwd = tempProject('proyecto', tempRoot('lsc-tools-cwd'));
  lifecodeSkillCreate({ root }).execute(candidate(), exec(cwd));
  const proposal = lifecodeSkillImprove({ root }).execute({
    skillId: candidate().id,
    rationale: 'La medición del flujo de trabajo cambió el orden de los pasos.',
    body: `${candidate().body}\n\n## Trampa\n\nEsto se aprendió midiendo, no leyendo.`,
  }, exec(cwd));
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.baseVersion, '1.0.0');
  assert.ok(proposal.diff.added >= 3);
  assert.match(proposal.summary, /NOT published/);
  const skill = loadState(root).state.skills[candidate().id];
  assert.equal(skill.currentVersion, '1.0.0');
  assert.equal(skill.versions.length, 1);
});

test('mejorar algo que no existe se dice claro', () => {
  const root = store();
  const cwd = tempProject('proyecto', tempRoot('lsc-tools-cwd'));
  const missing = lifecodeSkillImprove({ root }).execute({ skillId: 'no-existe', rationale: 'una razón suficientemente larga' }, exec(cwd));
  assert.equal(missing.status, 'missing-skill');
});

test('el estado cuenta lo encendido aquí y lo que espera decisión', () => {
  const root = store();
  const cwd = tempProject('proyecto', tempRoot('lsc-tools-cwd'));
  const created = lifecodeSkillCreate({ root }).execute(candidate(), exec(cwd));
  const project = runAction({ root, action: 'open', cwd, now: NOW }).project;
  runAction({ root, action: 'toggle', actor: 'human', payload: { projectId: project.id, skillId: created.id, enabled: true }, cwd, now: NOW });
  lifecodeSkillImprove({ root }).execute({ skillId: created.id, rationale: 'Una razón suficientemente larga para proponer.', body: `${candidate().body}\n\n## Más\n\nDetalle.` }, exec(cwd));

  const status = lifecodeSkillStatus({ root }).execute({}, exec(cwd));
  assert.equal(status.status, 'ok');
  assert.equal(status.project.id, project.id);
  assert.deepEqual(status.enabledHere.map((entry) => entry.id), [created.id]);
  assert.equal(status.pending.length, 1);
  assert.match(status.summary, /1 skill\(s\) enabled here/);
});

test('sin ruta de sesión el estado lo dice en vez de inventarse un proyecto', () => {
  const root = store();
  const status = lifecodeSkillStatus({ root }).execute({}, undefined);
  assert.equal(status.status, 'ok');
  assert.equal(status.project, null);
  assert.match(status.summary, /no working directory/);
});

test('el render de cada herramienta devuelve exactamente su resumen, como bloque de texto', () => {
  const tools = centerTools({ root: store() });
  for (const tool of tools) {
    const blocks = tool.output.render({}, { summary: 'hola' });
    assert.deepEqual(blocks, [{ type: 'text', text: 'hola' }]);
    assert.deepEqual(tool.output.render({}, {}), [{ type: 'text', text: '' }]);
  }
});

test('las herramientas nunca escriben fuera del almacén que se les da', () => {
  const root = store();
  const cwd = tempProject('proyecto', tempRoot('lsc-tools-cwd'));
  lifecodeSkillCreate({ root }).execute(candidate(), exec(cwd));
  // El almacén real del perfil no existe en la caja de arena: aquí sólo se comprueba que el
  // documento que se escribe es el del root inyectado.
  const state = loadState(root).state;
  assert.ok(state.skills[candidate().id]);
  assert.ok(centerFile(root).startsWith(root));
});

test('un almacén vacío se puede crear desde cero con una skill', () => {
  const root = store();
  saveState(root, emptyState(NOW), { now: NOW });
  const created = lifecodeSkillCreate({ root }).execute(candidate(), exec(tempProject('p', tempRoot('lsc-tools-cwd'))));
  assert.equal(created.status, 'published');
});
