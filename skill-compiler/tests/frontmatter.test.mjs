#!/usr/bin/env node
/**
 * Frontmatter en el motor de auto-mejora.
 *
 * Lo que estas pruebas vigilan, y por que:
 *
 *   · `description` y `whenToUse` son contenido: se pueden mejorar, y el cambio se ve en el informe;
 *   · id, identidad, procedencia, ambito y estado NO: una mejora de contenido no los toca ni por error;
 *   · un valor invalido (vacio, con saltos) no escribe nada;
 *   · si el frontmatter no cambia, no aparece en el informe (no se declara lo que no paso).
 *
 *   node --test tests/frontmatter.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approveProposal } from '../lib/commands.mjs';
import { propose } from '../lib/compiler.mjs';
import { CAMPOS_DE_FRONTMATTER, mejorar, textoDelInforme } from '../lib/improve.mjs';
import { GOOD_DESCRIPTION, buenaRevision, cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const KEY = 'proyecto-arena';
const ID = 'skill-de-prueba';
const DISPARADOR = 'Cuando una decision necesite un numero medido y quede constancia de el.';
const CUERPO = [
  '## When to Use',
  '',
  'Cuando hay que decidir algo con evidencia medida y no con impresiones, y hay que dejar constancia del numero.',
  '',
  '## Procedure',
  '',
  '1. Medir antes de tocar nada y anotar el numero exacto en el informe del acto.',
  '2. Comparar contra el registro previo y declarar la diferencia con su cifra.',
  '3. Cerrar solo si las dos medidas coinciden; si no, volver al paso uno.',
].join('\n');

function sembrar(arena) {
  const alta = propose(
    { id: ID, description: GOOD_DESCRIPTION, whenToUse: DISPARADOR, body: CUERPO },
    { root: arena.root, key: KEY },
  );
  assert.equal(alta.status, 'proposed', `no se pudo sembrar: ${JSON.stringify(alta.errors ?? alta)}`);
  const activada = approveProposal({ root: arena.root, key: KEY, id: ID, force: true, scope: 'project' });
  assert.equal(activada.kind, 'success', `no se pudo activar: ${activada.text}`);
}

const leerMeta = (arena, estado = 'proposed') => JSON.parse(readFileSync(join(arena.root, 'projects', KEY, estado, ID, 'meta.json'), 'utf8'));
const leerSkill = (arena, estado = 'proposed') => readFileSync(join(arena.root, 'projects', KEY, estado, ID, 'SKILL.md'), 'utf8');

describe('frontmatter · lo que se puede cambiar', () => {
  it('cambia whenToUse y lo declara en el informe', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const nuevo = 'Cuando una decision necesite un numero medido, su cifra y la fecha de la medicion.';
    const r = mejorar(
      { id: ID, operacion: 'patch', parches: [], frontmatter: { whenToUse: nuevo }, revision: buenaRevision() },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'proposed', JSON.stringify((r.errors ?? r.errores) ?? r));
    assert.equal(leerMeta(arena).whenToUse, nuevo, 'el meta guarda el disparador nuevo');
    const skill = leerSkill(arena);
    assert.ok(skill.includes(`whenToUse: "${nuevo}"`), 'y el SKILL.md tambien');
    const linea = r.informe.lineas.find((f) => f.ruta === 'meta.json');
    assert.equal(linea?.accion, 'patched', 'el informe declara el frontmatter como tocado');
    assert.match(textoDelInforme(r), /meta\.json/);
  });

  it('cambia description sin tocar el resto del frontmatter', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const antes = leerSkill(arena, 'approved');
    const nueva = 'Decide with measured evidence, the number written down, and the difference declared out loud.';
    const r = mejorar(
      { id: ID, operacion: 'patch', parches: [], frontmatter: { description: nueva }, revision: buenaRevision() },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'proposed', JSON.stringify((r.errors ?? r.errores) ?? r));
    const skill = leerSkill(arena);
    assert.ok(skill.includes(`description: "${nueva}"`));
    // La procedencia y la identidad no se movieron: se comparan los campos del frontmatter que no se tocaron.
    for (const campo of ['name:', 'origin: skill-compiler', 'projectKey:', 'learnedAt:', 'toolVersion:']) {
      assert.ok(skill.includes(campo), `falta ${campo}`);
      assert.equal(skill.split(campo).length, antes.split(campo).length, `${campo} no puede duplicarse ni perderse`);
    }
    assert.ok(skill.includes(`whenToUse: "${DISPARADOR}"`), 'el disparador se conserva');
  });

  it('puede cambiar los dos campos a la vez', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar(
      {
        id: ID, operacion: 'patch', parches: [],
        frontmatter: {
          description: 'Decide with measured evidence and keep the number of every measurement in the report.',
          whenToUse: 'Cuando haya que decidir con una cifra medida y su diferencia declarada.',
        },
        revision: buenaRevision(),
      },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'proposed', JSON.stringify((r.errors ?? r.errores) ?? r));
    assert.match(textoDelInforme(r), /1 confirmed loss\(es\)|0 confirmed loss\(es\)/);
    assert.equal(r.resumen.parcheados, 1, 'solo el meta.json cambio');
  });
});

describe('frontmatter · lo que NO se puede cambiar', () => {
  const protegidos = ['name', 'id', 'metadata', 'origin', 'project', 'projectKey', 'learnedAt', 'state', 'scope'];
  for (const campo of protegidos) {
    it(`rechaza «${campo}» y no escribe nada`, () => {
      const arena = sandbox({ curated: false });
      sembrar(arena);
      const antes = leerSkill(arena, 'approved');
      const r = mejorar(
        { id: ID, operacion: 'patch', parches: [], frontmatter: { [campo]: 'otra-cosa' }, revision: buenaRevision() },
        { root: arena.root, key: KEY },
      );
      assert.equal(r.status, 'invalid');
      assert.match((r.errors ?? (r.errors ?? r.errores))[0], /campo/i);
      assert.match((r.errors ?? (r.errors ?? r.errores))[0], new RegExp(campo));
      // Nada se escribio: la propuesta no existe y la activa sigue igual.
      assert.equal(readFileSync(join(arena.root, 'projects', KEY, 'approved', ID, 'SKILL.md'), 'utf8'), antes);
      assert.throws(() => leerMeta(arena), /ENOENT/);
    });
  }

  it('rechaza un valor vacio o con saltos de linea', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const vacio = mejorar({ id: ID, operacion: 'patch', parches: [], frontmatter: { description: '   ' }, revision: buenaRevision() }, { root: arena.root, key: KEY });
    assert.equal(vacio.status, 'invalid');
    assert.match((vacio.errors ?? vacio.errores)[0], /contenido/);

    const saltos = mejorar({ id: ID, operacion: 'patch', parches: [], frontmatter: { whenToUse: 'una linea\n y otra' }, revision: buenaRevision() }, { root: arena.root, key: KEY });
    assert.equal(saltos.status, 'invalid');
    assert.match((saltos.errors ?? saltos.errores)[0], /una sola linea/);
  });

  it('solo admite los campos declarados en el contrato', () => {
    assert.deepEqual([...CAMPOS_DE_FRONTMATTER], ['description', 'whenToUse']);
  });
});

describe('frontmatter · lo que no cambio no se declara', () => {
  it('un frontmatter identico al vigente no entra en el informe', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar(
      { id: ID, operacion: 'no_change', parches: [], frontmatter: { whenToUse: DISPARADOR }, revision: buenaRevision() },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'no_change');
    assert.ok(!r.informe.lineas.some((f) => f.ruta === 'meta.json'), 'no se declara un cambio que no hubo');
  });
});
