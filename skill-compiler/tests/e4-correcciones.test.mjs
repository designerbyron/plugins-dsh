#!/usr/bin/env node
/**
 * ACTO E.4 — las tres correcciones del motor, con su prueba cada una.
 *
 *   A) la procedencia (`project`) se hereda de la skill viva y NO se inventa con el cwd;
 *   B) el documento generado separa el H1 de la primera seccion (Markdown valido);
 *   C) los contadores del informe no cuentan el mismo elemento dos veces, y distinguen un cambio
 *      estructural de una perdida de conocimiento.
 *
 *   node --test tests/e4-correcciones.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approveProposal } from '../lib/commands.mjs';
import { propose, renderSkill } from '../lib/compiler.mjs';
import { mejorar, textoDelInforme } from '../lib/improve.mjs';
import { clasificarPerdidas } from '../lib/repair.mjs';
import { GOOD_DESCRIPTION, buenaRevision, cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const ID = 'skill-e4';
const CUERPO = [
  '## 1. Medir',
  '',
  '- Medir antes de tocar nada y anotar el numero exacto en el informe.',
  '- Comparar contra el registro previo y declarar la diferencia.',
  '',
  '## 2. Cerrar',
  '',
  '- Cerrar solo si las dos medidas coinciden.',
].join('\n');

const sembrar = (arena, { key = 'proyecto-arena', project = 'proyecto', cuerpo = CUERPO } = {}) => {
  const alta = propose(
    { id: ID, description: GOOD_DESCRIPTION, whenToUse: 'Cuando haya que decidir con una cifra medida.', body: cuerpo, project },
    { root: arena.root, key },
  );
  assert.equal(alta.status, 'proposed', JSON.stringify(alta.errors ?? alta));
  const activada = approveProposal({ root: arena.root, key, id: ID, force: true, scope: 'project' });
  assert.equal(activada.kind, 'success', activada.text);
};

const metaDe = (arena, key, estado = 'proposed') => JSON.parse(readFileSync(join(arena.root, 'projects', key, estado, ID, 'meta.json'), 'utf8'));
const skillDe = (arena, key, estado = 'proposed') => readFileSync(join(arena.root, 'projects', key, estado, ID, 'SKILL.md'), 'utf8');

describe('A · procedencia', () => {
  it('una mejora de una skill local conserva su project', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, { project: 'saas-corporative' });
    const r = mejorar(
      { id: ID, operacion: 'patch', parches: [], frontmatter: { whenToUse: 'Cuando haya que decidir con una cifra medida y fechada.' }, revision: buenaRevision() },
      { root: arena.root, key: 'proyecto-arena' },
    );
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.errores ?? r));
    assert.equal(metaDe(arena, 'proyecto-arena').project, 'saas-corporative');
    assert.ok(skillDe(arena, 'proyecto-arena').includes('project: "saas-corporative"'));
  });

  it('conserva la identidad: el projectKey no cambia', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, { project: 'saas-corporative' });
    const antes = metaDe(arena, 'proyecto-arena', 'approved').projectKey;
    mejorar({ id: ID, operacion: 'patch', parches: [], frontmatter: { whenToUse: 'Cuando haya que decidir con una cifra medida y fechada.' }, revision: buenaRevision() }, { root: arena.root, key: 'proyecto-arena' });
    const despues = metaDe(arena, 'proyecto-arena');
    assert.equal(despues.projectKey, antes);
    assert.equal(despues.project, 'saas-corporative');
  });

  it('una skill sin proyecto no gana uno por el cwd de la sesion', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, { project: '' });
    const r = mejorar(
      { id: ID, operacion: 'patch', parches: [], frontmatter: { whenToUse: 'Cuando haya que decidir con una cifra medida y fechada.' }, revision: buenaRevision() },
      { root: arena.root, key: 'proyecto-arena', cwd: arena.base },
    );
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.errores ?? r));
    assert.equal(metaDe(arena, 'proyecto-arena').project, '', 'no se inventa procedencia');
    assert.ok(!skillDe(arena, 'proyecto-arena').includes(arena.base), 'ni se cuela la ruta de la sesion');
  });

  it('dos proyectos con el mismo id no comparten procedencia', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, { key: 'proyecto-a', project: 'proyecto-a' });
    sembrar(arena, { key: 'proyecto-b', project: 'proyecto-b' });
    mejorar({ id: ID, operacion: 'patch', parches: [], frontmatter: { whenToUse: 'Cuando haya que decidir con una cifra medida y fechada.' }, revision: buenaRevision() }, { root: arena.root, key: 'proyecto-a' });
    assert.equal(metaDe(arena, 'proyecto-a').project, 'proyecto-a');
    assert.equal(metaDe(arena, 'proyecto-b', 'approved').project, 'proyecto-b');
  });
});

describe('B · formato Markdown', () => {
  it('deja una linea en blanco entre el H1 y la primera seccion', () => {
    const skill = renderSkill({ id: 'x', description: GOOD_DESCRIPTION, whenToUse: 'Cuando haga falta.', body: CUERPO, project: 'p', projectKey: 'k', evidence: [], createdAt: '2026-11-05T00:00:00.000Z' });
    assert.match(skill, /# .*\n\n## 1\. Medir/, 'el H1 y el primer titulo no pueden ir pegados');
  });

  it('deja una linea en blanco tambien con secciones sin numerar', () => {
    const cuerpo = ['## When to Use', '', 'Cuando haga falta.', '', '## Procedure', '', '- Hacer una cosa concreta y medible.'].join('\n');
    const skill = renderSkill({ id: 'x', description: GOOD_DESCRIPTION, whenToUse: 'Cuando haga falta.', body: cuerpo, project: 'p', projectKey: 'k', evidence: [], createdAt: '2026-11-05T00:00:00.000Z' });
    assert.match(skill, /# .*\n\n## When to Use/);
  });

  it('no altera los bloques de codigo del cuerpo', () => {
    const cuerpo = ['## 1. Medir', '', '```bash', 'npm test --force', '## esto es un comentario, no un titulo', '```', '', 'Y se cierra.'].join('\n');
    const skill = renderSkill({ id: 'x', description: GOOD_DESCRIPTION, whenToUse: 'Cuando haga falta.', body: cuerpo, project: 'p', projectKey: 'k', evidence: [], createdAt: '2026-11-05T00:00:00.000Z' });
    assert.ok(skill.includes('```bash\nnpm test --force\n## esto es un comentario, no un titulo\n```'), 'el bloque va byte a byte');
  });

  it('conserva el contenido del cuerpo exactamente', () => {
    const skill = renderSkill({ id: 'x', description: GOOD_DESCRIPTION, whenToUse: 'Cuando haga falta.', body: CUERPO, project: 'p', projectKey: 'k', evidence: [], createdAt: '2026-11-05T00:00:00.000Z' });
    assert.ok(skill.includes(CUERPO), 'el cuerpo entra entero');
  });

  it('respeta los saltos de linea que ya trae el cuerpo', () => {
    const cuerpo = ['## 1. A', '', '', 'Texto con dos lineas en blanco antes.'].join('\n');
    const skill = renderSkill({ id: 'x', description: GOOD_DESCRIPTION, whenToUse: 'Cuando haga falta.', body: cuerpo, project: 'p', projectKey: 'k', evidence: [], createdAt: '2026-11-05T00:00:00.000Z' });
    assert.ok(skill.includes('## 1. A\n\n\nTexto'), 'no se colapsan los saltos internos');
  });
});

describe('C · contadores del informe', () => {
  it('un encabezado renumerado es estructural: ni movido ni perdido', () => {
    const antes = ['## 1. Medir', '', '- Paso uno concreto.'].join('\n');
    const despues = ['## 7. Medir', '', '- Paso uno concreto.'].join('\n');
    const r = clasificarPerdidas(antes, despues);
    assert.equal(r.estructurales.length, 1);
    assert.equal(r.reubicadas.length, 0);
    assert.equal(r.perdidas.length, 0);
  });

  it('una seccion reubicada se cuenta una sola vez', () => {
    const antes = ['## A', '', '- Regla concreta del procedimiento.', '', '## B', '', '- Otra cosa distinta.'].join('\n');
    const despues = ['## A', '', '- Otra cosa distinta.', '', '## B', '', '- Regla concreta del procedimiento.'].join('\n');
    const r = clasificarPerdidas(antes, despues);
    assert.equal(r.reubicadas.length, 2, 'las dos se movieron: cada una se cuenta una vez');
    assert.equal(r.perdidas.length, 0);
    assert.equal(r.estructurales.length, 0);
  });

  it('el informe de una mejora no declara perdidas falsas por renumerar', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, { project: 'proyecto' });
    const cuerpoNuevo = ['## 1. Medir', '', '- Medir antes de tocar nada y anotar el numero exacto en el informe.', '- Comparar contra el registro previo y declarar la diferencia.', '', '## 2. Cerrar', '', '- Cerrar solo si las dos medidas coinciden.', '', '## 3. Archivar', '', '- Archivar la revision anterior con su manifiesto.'].join('\n');
    const r = mejorar(
      { id: ID, operacion: 'enhance', parches: [{ seccion: 'Archivar', titulo: '3. Archivar', contenido: '- Archivar la revision anterior con su manifiesto.', nuevaAqui: true }], revision: buenaRevision() },
      { root: arena.root, key: 'proyecto-arena' },
    );
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.errores ?? r));
    assert.equal(r.resumen.perdidas, 0, 'no se pierde ninguna regla');
    assert.equal(r.resumen.seccionesConservadas, 2, 'las dos secciones siguen igual');
    assert.equal(r.resumen.estructurales, 0, 'no hubo renumeracion');

    const texto = textoDelInforme(r);
    assert.match(texto, /2 section\(s\) reviewed, 2 preserved/);
    assert.match(texto, /0 confirmed loss\(es\)/);
    assert.ok(!/structural change/.test(texto), 'sin cambios estructurales no se declara ninguno');
    assert.ok(cuerpoNuevo.includes('- Archivar la revision anterior'));
  });

  it('el texto del informe coincide con los contadores internos', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, { project: 'proyecto' });
    const r = mejorar(
      { id: ID, operacion: 'patch', parches: [], frontmatter: { whenToUse: 'Cuando haya que decidir con una cifra medida y fechada.' }, revision: buenaRevision() },
      { root: arena.root, key: 'proyecto-arena' },
    );
    const texto = textoDelInforme(r);
    assert.match(texto, new RegExp(`- ${r.resumen.seccionesRevisadas} section\\(s\\) reviewed, ${r.resumen.seccionesConservadas} preserved`));
    assert.match(texto, new RegExp(`- ${r.resumen.reglasRevisadas} rule\\(s\\) reviewed`));
    assert.match(texto, new RegExp(`- ${r.resumen.perdidas} confirmed loss`));
  });

  it('una skill sin vinetas no inventa reglas revisadas', () => {
    const arena = sandbox({ curated: false });
    const sinVinetas = ['## 1. Medir', '', 'Medir antes de tocar nada y anotar el numero exacto en el informe del acto, junto al registro previo.', '', '## 2. Cerrar', '', 'Cerrar solo si las dos medidas coinciden; si no, volver al paso uno y dejar la diferencia escrita.'].join('\n');
    sembrar(arena, { project: 'proyecto', cuerpo: sinVinetas });
    const r = mejorar({ id: ID, operacion: 'patch', parches: [], frontmatter: { whenToUse: 'Cuando haya que decidir con una cifra medida y fechada.' }, revision: buenaRevision() }, { root: arena.root, key: 'proyecto-arena' });
    assert.equal(r.resumen.reglasRevisadas, 0);
    assert.equal(r.resumen.reglasConservadas, 0);
    assert.equal(r.resumen.seccionesConservadas, 2, 'las secciones si se cuentan');
    assert.equal(r.resumen.perdidas, 0);
  });

  it('una estructura extensa no falsea las cuentas', () => {
    const grande = [];
    for (let i = 1; i <= 12; i += 1) grande.push(`## ${i}. Seccion ${i}`, '', `- Regla numero ${i} con su detalle medido.`, '');
    const arena = sandbox({ curated: false });
    sembrar(arena, { project: 'proyecto', cuerpo: grande.join('\n') });
    const r = mejorar({ id: ID, operacion: 'patch', parches: [], frontmatter: { whenToUse: 'Cuando haya que decidir con una cifra medida y fechada.' }, revision: buenaRevision() }, { root: arena.root, key: 'proyecto-arena' });
    assert.equal(r.resumen.seccionesRevisadas, 12);
    assert.equal(r.resumen.seccionesConservadas, 12);
    assert.equal(r.resumen.reglasRevisadas, 12);
    assert.equal(r.resumen.reglasConservadas, 12);
    assert.equal(r.resumen.perdidas, 0);
  });

  it('un no_change informa sin inventar contadores', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, { project: 'proyecto' });
    const r = mejorar({ id: ID, operacion: 'no_change', parches: [], revision: buenaRevision() }, { root: arena.root, key: 'proyecto-arena' });
    assert.equal(r.status, 'no_change');
    const texto = textoDelInforme(r);
    assert.match(texto, /No change:/);
    assert.ok(!/confirmed loss/.test(texto), 'un no_change no declara perdidas');
  });
});
