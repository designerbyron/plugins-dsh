/**
 * El registro de conocimiento y la bandeja de hallazgos.
 *
 * Lo que se mide aquí es la asimetría del producto: un subagente puede **reportar** un hallazgo con su
 * procedencia, pero nada de eso decide, publica ni activa; y el registro vive en su propio fichero para
 * que un `knowledge.json` dañado no inutilice el centro.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { knowledgeView, runAction, handleApiRequest, centerRoot } from '../lib/api.mjs';
import { centerTools } from '../lib/tools.mjs';
import { knowledgeFile } from '../lib/knowledge.mjs';

function store() {
  return mkdtempSync(join(tmpdir(), 'lsc-knowledge-'));
}

const exec = (cwd) => ({ agent: { session: { header: { cwd } } } });

const insight = (overrides = {}) => ({
  insightId: 'trampa-medida-1',
  title: 'PowerShell 5.1 lee UTF-8 como cp1252',
  summary: 'Leer y reescribir un fichero con Get-Content -Raw lo doble codifica',
  category: 'trap',
  confidence: 'strong',
  evidence: [{ source: 'prueba', location: 'docs/DESARROLLO.md', verification: 'cmp con Node', result: 'el fichero quedó con â€” y se reparó' }],
  ...overrides,
});

test('sin registro, la vista del conocimiento dice «no existe» y no inventa cifras', () => {
  const root = store();
  const view = knowledgeView({ root });
  assert.equal(view.ok, true);
  assert.equal(view.integrity.status, 'missing');
  assert.equal(view.summary.total, 0);
  assert.equal(view.summary.pending, 0);
  assert.equal(view.summary.approvalRate, undefined, 'la tasa de aprobación no existe si no hay decisiones');
  assert.deepEqual(view.insights, []);
  assert.deepEqual(view.decisions, []);
  assert.equal(existsSync(knowledgeFile(root)), false, 'leer no crea el fichero');
});

test('un hallazgo entra en la bandeja, es idempotente y no toca el centro', () => {
  const root = store();
  const before = existsSync(join(root, 'center.json'));
  const first = runAction({ root, action: 'insight', actor: 'ai', payload: insight() });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.insight.state, 'received');
  assert.equal(first.summary.pending, 1);

  const second = runAction({ root, action: 'insight', actor: 'ai', payload: insight() });
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.summary.total, 1, 'el mismo insightId no duplica');
  assert.equal(existsSync(join(root, 'center.json')), before, 'el centro no se creó por un hallazgo');
});

test('la ruta del conocimiento responde 200 y filtra por estado y proyecto', () => {
  const root = store();
  runAction({ root, action: 'insight', actor: 'ai', payload: insight({ projectId: 'proyecto-a' }) });
  runAction({ root, action: 'insight', actor: 'ai', payload: insight({ insightId: 'global-1', projectId: '', category: 'observation' }) });

  const all = handleApiRequest({ root, method: 'GET', pathname: '/lifecode-skill-center/api/knowledge' });
  assert.equal(all.status, 200);
  assert.equal(all.body.ok, true);
  assert.equal(all.body.summary.total, 2);

  const onlyProject = handleApiRequest({ root, method: 'GET', pathname: '/lifecode-skill-center/api/knowledge', search: '?project=proyecto-a' });
  assert.equal(onlyProject.status, 200);
  assert.equal(onlyProject.body.insights.length, 1);
  assert.equal(onlyProject.body.insights[0].projectId, 'proyecto-a');

  const onlyState = handleApiRequest({ root, method: 'GET', pathname: '/lifecode-skill-center/api/knowledge', search: '?state=triaged' });
  assert.equal(onlyState.body.insights.length, 0, 'recibido no es triado');
});

test('un registro dañado se declara y no se sobrescribe', () => {
  const root = store();
  runAction({ root, action: 'insight', actor: 'ai', payload: insight() });
  writeFileSync(knowledgeFile(root), '{"schema":"otra-cosa"', 'utf8');
  const broken = readFileSync(knowledgeFile(root), 'utf8');

  const view = knowledgeView({ root });
  assert.equal(view.ok, false);
  assert.equal(view.code, 'knowledge-unreadable');
  assert.equal(view.insights, undefined, 'no publica hallazgos de un registro ilegible');

  const response = handleApiRequest({ root, method: 'GET', pathname: '/lifecode-skill-center/api/knowledge' });
  assert.equal(response.status, 409);

  const attempted = runAction({ root, action: 'insight', actor: 'ai', payload: insight({ insightId: 'otro' }) });
  assert.equal(attempted.ok, false);
  assert.equal(readFileSync(knowledgeFile(root), 'utf8'), broken, 'el registro dañado queda intacto');
});

test('dos hallazgos que se contradicen se enseñan, no se resuelven solos', () => {
  const root = store();
  runAction({
    root,
    action: 'insight',
    actor: 'ai',
    payload: insight({
      insightId: 'conflicto-a',
      category: 'contract',
      projectId: 'proyecto-b',
      evidence: [{ source: 'prueba A', location: 'lib/state.mjs', result: 'la escritura es atómica' }],
    }),
  });
  runAction({
    root,
    action: 'insight',
    actor: 'ai',
    payload: insight({
      insightId: 'conflicto-b',
      category: 'contract',
      projectId: 'proyecto-b',
      evidence: [{ source: 'prueba B', location: 'lib/state.mjs', result: 'se perdió una escritura' }],
    }),
  });

  const view = knowledgeView({ root });
  assert.equal(view.contradictions.length, 1);
  assert.equal(view.contradictions[0].location, 'lib/state.mjs');
  assert.equal(view.contradictions[0].results.length, 2);
  assert.equal(view.summary.pending, 2, 'un conflicto no cierra los hallazgos: siguen pendientes de triaje');
});

test('la herramienta del agente reporta sin decidir y lo dice en el resumen', () => {
  const root = store();
  const tools = centerTools({ root });
  const tool = tools.find((entry) => entry.name === 'lifecode_skill_insight');
  assert.ok(tool, 'la quinta herramienta existe');

  const result = tool.execute(insight(), exec('C:/x/proyecto'));
  assert.equal(result.status, 'ok');
  assert.match(result.summary, /decides nothing/);
  assert.equal(result.insight.state, 'received');
  assert.equal(result.inbox.pending, 1);

  const duplicate = tool.execute(insight(), exec('C:/x/proyecto'));
  assert.equal(duplicate.insight.duplicate, true);
});
