/**
 * El portero de calidad. Cada prueba fija una decisión que, si se pierde, deja publicar una skill que
 * el harness cargaría mal o que filtra algo que no debe salir del proyecto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateSkill, evaluationSummary, countSections, declaredReferences } from '../lib/evaluate.mjs';
import { candidate } from './helpers.mjs';

test('una skill completa pasa con 100 y sin hallazgos', () => {
  const evaluation = evaluateSkill(candidate(), { evaluatedAt: '2026-11-08T12:00:00.000Z' });
  assert.equal(evaluation.status, 'pass');
  assert.equal(evaluation.score, 100);
  assert.equal(evaluation.blocksPublish, false);
  assert.deepEqual(evaluation.findings, []);
  assert.equal(evaluation.evaluatedAt, '2026-11-08T12:00:00.000Z');
});

test('lo que el modelo necesita para enrutar es bloqueante: id, descripción y situación de uso', () => {
  const evaluation = evaluateSkill({ ...candidate(), id: 'Con Espacios', description: '', whenToUse: 'corto' });
  assert.equal(evaluation.status, 'fail');
  assert.equal(evaluation.blocksPublish, true);
  const codes = evaluation.findings.map((finding) => finding.code);
  assert.ok(codes.includes('id.format'));
  assert.ok(codes.includes('description.present'));
  assert.ok(codes.includes('when-to-use.present'));
  // Tres bloqueantes ya hunden la puntuación: 100 − 120 se recorta en 0, no en negativo.
  assert.equal(evaluation.score, 0);
});

test('un cuerpo vacío o diminuto no se publica y las secciones son sólo un aviso', () => {
  const empty = evaluateSkill({ ...candidate(), body: '' });
  assert.ok(empty.findings.some((finding) => finding.code === 'body.length' && finding.severity === 'block'));

  const flat = evaluateSkill({ ...candidate(), body: 'Un párrafo suficientemente largo para pasar el mínimo de caracteres y que sin embargo no tiene ninguna sección de ningún tipo: explica cómo hacer el trabajo de principio a fin, en orden, mencionando lo que hay que comprobar al terminar y la evidencia que hay que adjuntar cuando ya está hecho, todo seguido.' });
  assert.equal(flat.status, 'warn');
  assert.equal(flat.blocksPublish, false);
  assert.ok(flat.findings.some((finding) => finding.code === 'body.sections' && finding.severity === 'warn'));
});

test('el material enlazado tiene que existir, y el guardado tiene que estar enlazado', () => {
  const body = `${candidate().body}\n\nVer \`references/trampas.md\` para el detalle.\n`;
  const missing = evaluateSkill({ ...candidate(), body });
  assert.ok(missing.findings.some((finding) => finding.code === 'references.linked-exists' && finding.severity === 'block'));

  const withReference = evaluateSkill({ ...candidate(), body, references: { 'references/trampas.md': 'contenido' } });
  assert.equal(withReference.status, 'pass');

  const unlinked = evaluateSkill({ ...candidate(), references: { 'references/suelto.md': 'contenido' } });
  assert.equal(unlinked.status, 'warn');
  assert.ok(unlinked.findings.some((finding) => finding.code === 'references.unlinked'));
});

test('una ruta de material fuera de references/ o con .. es bloqueante', () => {
  const evaluation = evaluateSkill({ ...candidate(), references: { '../secreto.txt': 'x', 'C:/ruta.txt': 'y' } });
  assert.ok(evaluation.findings.some((finding) => finding.code === 'references.paths' && finding.severity === 'block'));
});

test('los secretos no salen del proyecto: clave privada, token y asignación de credencial', () => {
  for (const leak of [
    '-----BEGIN RSA PRIVATE KEY-----\nabc',
    'usa el token sk-abcdefghijklmnopqrstuvwx para probar',
    'password = "correcto-horse-battery"',
  ]) {
    const evaluation = evaluateSkill({ ...candidate(), body: `${candidate().body}\n\n${leak}\n` });
    assert.equal(evaluation.blocksPublish, true, `debería bloquear: ${leak}`);
    assert.ok(evaluation.findings.some((finding) => finding.code.startsWith('secret.')));
  }
});

test('las trampas de portabilidad avisan pero no bloquean', () => {
  const evaluation = evaluateSkill({ ...candidate(), body: `${candidate().body}\n\nEn C:\\Users\\BYRON\\proyecto queda el TODO pendiente.\n` });
  assert.equal(evaluation.blocksPublish, false);
  const codes = evaluation.findings.map((finding) => finding.code);
  assert.ok(codes.includes('portability.windows-path'));
  assert.ok(codes.includes('portability.todo'));
});

test('el resumen en una línea dice lo que hay que arreglar', () => {
  assert.equal(evaluationSummary(null), 'sin evaluar');
  assert.equal(evaluationSummary(evaluateSkill(candidate())), 'correcta (100/100)');
  const failing = evaluateSkill({ ...candidate(), description: '', body: '' });
  assert.match(evaluationSummary(failing), /^no publicable \(\d+\/100\): \d+ bloqueante/);
  const warning = evaluateSkill({ ...candidate(), tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] });
  assert.match(evaluationSummary(warning), /^publicable con avisos/);
});

test('las utilidades cuentan secciones y enlaces sin depender del render', () => {
  assert.equal(countSections('## a\ntexto\n## b\ntexto'), 2);
  assert.equal(countSections('sin nada'), 0);
  assert.deepEqual(declaredReferences('mira `references/a.md` y references/b.md'), ['references/a.md', 'references/b.md']);
});
