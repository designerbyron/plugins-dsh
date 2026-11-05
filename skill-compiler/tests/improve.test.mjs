#!/usr/bin/env node
/**
 * Self-improvement: mejorar una skill viva sin reescribirla a ciegas.
 *
 * Lo que estas pruebas vigilan, y por qué:
 *
 *   · la unidad de cambio es la SECCIÓN, así que una regla que no se toca no se pierde por olvido;
 *   · el informe dice lo que **de verdad** pasó en disco (`patched`/`written`/`unchanged`), no lo que el
 *     llamador declaró;
 *   · una pérdida de conocimiento sin justificar **no se escribe**;
 *   · la versión activa no se mueve hasta que un humano aprueba la candidata.
 *
 *   node --test tests/improve.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approveProposal } from '../lib/commands.mjs';
import { propose } from '../lib/compiler.mjs';
import { aplicarParches, mejorar, partirCuerpo, textoDelInforme } from '../lib/improve.mjs';
import { GOOD_DESCRIPTION, buenaRevision, cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const KEY = 'proyecto-arena';
const ID = 'skill-de-prueba';

const PROCEDIMIENTO = [
  '1. Medir antes de tocar nada y anotar el número exacto en el informe del acto.',
  '2. Comparar contra el registro previo y declarar la diferencia con su cifra.',
  '3. Cerrar solo si las dos medidas coinciden; si no, volver al paso uno.',
];

const TRAMPAS = [
  'Una regla que no se puede perder: `npm test` sin `--force`, y el tope de 8.289 caracteres del gate ASCII.',
  'Se comprobó con `node --test` sobre la copia, no sobre el almacén real.',
];

const CUERPO = [
  '## When to Use',
  '',
  'Cuando hay que decidir algo con evidencia medida y no con impresiones, y hay que dejar constancia del número.',
  '',
  '## Procedure',
  '',
  ...PROCEDIMIENTO,
  '',
  '## Trampas',
  '',
  ...TRAMPAS,
].join('\n');

/** Un parche que **amplía** sin borrar: es lo que hace una mejora de verdad. */
const PROCEDIMIENTO_AMPLIADO = [...PROCEDIMIENTO, '4. Si la medida no cuadra, parar y registrar la causa antes de reintentar.'].join('\n');

const DESCRIPCION = GOOD_DESCRIPTION;
const DISPARADOR = 'Cuando una decisión necesite un número medido y quede constancia de él.';

function sembrar(arena, { referencias = [], cuerpo = CUERPO } = {}) {
  const alta = propose(
    { id: ID, description: DESCRIPCION, whenToUse: DISPARADOR, body: cuerpo },
    { root: arena.root, key: KEY, references: referencias },
  );
  assert.equal(alta.status, 'proposed', `no se pudo sembrar: ${JSON.stringify(alta.errors ?? alta)}`);
  const activada = approveProposal({ root: arena.root, key: KEY, id: ID, force: true, scope: 'project' });
  assert.equal(activada.kind, 'success', `no se pudo activar: ${activada.text}`);
}

const leerAprobada = (arena) => readFileSync(join(arena.root, 'projects', KEY, 'approved', ID, 'SKILL.md'), 'utf8');
const hayPropuesta = (arena) => existsSync(join(arena.root, 'projects', KEY, 'proposed', ID));

describe('las piezas puras del motor', () => {
  it('parte el cuerpo sin perder el preámbulo', () => {
    const { preambulo, secciones } = partirCuerpo(`Texto de entrada.\n\n${CUERPO}`);
    assert.equal(preambulo, 'Texto de entrada.');
    assert.deepEqual(secciones.map((s) => s.titulo), ['When to Use', 'Procedure', 'Trampas']);
  });

  it('aplica un parche por título, sin tocar las demás secciones', () => {
    const r = aplicarParches(CUERPO, [{ seccion: 'Procedure', contenido: PROCEDIMIENTO_AMPLIADO }]);
    assert.equal(r.noEncontrados.length, 0);
    assert.match(r.cuerpo, /4\. Si la medida no cuadra/);
    assert.match(r.cuerpo, /## Trampas/, 'la sección que no se tocó sigue ahí');
    assert.match(r.cuerpo, /8\.289 caracteres/, 'y su contenido también');
  });

  it('una sección que no existe no se inventa: se declara', () => {
    const r = aplicarParches(CUERPO, [{ seccion: 'Inexistente', contenido: 'x' }]);
    assert.deepEqual(r.noEncontrados, ['Inexistente']);
  });
});

describe('mejorar una skill viva', () => {
  it('parchea SKILL.md y lo informa como patched', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar(
      { id: ID, operacion: 'patch', parches: [{ seccion: 'Procedure', contenido: PROCEDIMIENTO_AMPLIADO }], revision: buenaRevision() },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r));
    const skill = r.informe.lineas.find((f) => f.ruta === 'SKILL.md');
    assert.equal(skill.accion, 'patched');
    assert.equal(r.resumen.parcheados, 1);
    assert.deepEqual(r.conservacion.sinJustificar, {}, 'no se pierde nada al ampliar');
  });

  it('crea una referencia nueva y la informa como written', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const trampasConVinculo = [...TRAMPAS, '', 'El detalle completo vive en `references/trampas.md`.'].join('\n');
    const r = mejorar(
      {
        id: ID,
        operacion: 'write',
        parches: [{ seccion: 'Trampas', contenido: trampasConVinculo }],
        referencias: [{ path: 'references/trampas.md', content: '## Regla\n\n`npm test` sin `--force`, con el tope de 8.289 caracteres.\n' }],
        revision: buenaRevision({ change: 'Las trampas se detallan en una referencia enlazada desde el cuerpo.' }),
      },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r));
    const ref = r.informe.lineas.find((f) => f.ruta === 'references/trampas.md');
    assert.ok(ref, 'la referencia nueva tiene que aparecer en el informe');
    assert.equal(ref.accion, 'written');
    assert.equal(r.resumen.escritos, 1);
    assert.ok(existsSync(join(arena.root, 'projects', KEY, 'proposed', ID, 'references', 'trampas.md')));
  });

  it('actualiza una referencia existente y la informa como patched', () => {
    const arena = sandbox({ curated: false });
    const cuerpoConRef = `${CUERPO}\n\nVer \`references/extra.md\`.`;
    sembrar(arena, { referencias: [{ path: 'references/extra.md', content: '## Extra\n\nMaterial anterior.\n' }], cuerpo: cuerpoConRef });
    const r = mejorar(
      {
        id: ID, operacion: 'patch',
        parches: [{ seccion: 'When to Use', contenido: 'Cuando hay que decidir algo con evidencia medida y no con impresiones, y hay que dejar constancia del número.\n\nEl material de apoyo está en `references/extra.md`.' }],
        referencias: [{ path: 'references/extra.md', content: '## Extra\n\nMaterial anterior.\n\nAñadido: se midió con `node --test` sobre la copia.\n' }],
        revision: buenaRevision({ change: 'La referencia de apoyo incorpora la medición.' }),
      },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r));
    const ref = r.informe.lineas.find((f) => f.ruta === 'references/extra.md');
    assert.equal(ref.accion, 'patched');
  });

  it('detecta una regla perdida y NO escribe', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const antes = leerAprobada(arena);
    const r = mejorar(
      { id: ID, operacion: 'patch', parches: [{ seccion: 'Trampas', contenido: 'Aquí no queda ninguna regla de las de antes.' }], revision: buenaRevision() },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'invalid');
    assert.match(r.errors[0], /perderia/);
    assert.equal(leerAprobada(arena), antes, 'la activa no se toca ni cuando el motor rechaza');
    assert.ok(!hayPropuesta(arena), 'y no deja propuesta a medias');
  });

  it('mover una regla a una referencia no cuenta como pérdida', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar(
      {
        id: ID,
        operacion: 'reorganize',
        retirarSecciones: ['Trampas'],
        referencias: [{ path: 'references/trampas.md', content: `## Trampas\n\n${TRAMPAS.join('\n')}\n` }],
        parches: [{ seccion: 'Procedure', contenido: `${PROCEDIMIENTO_AMPLIADO}\n\nLas trampas están en \`references/trampas.md\`.` }],
        revision: buenaRevision({ removed: 'Se retira la sección «Trampas» porque su contenido se movió entero a la referencia enlazada; se comprobó que sigue completo.', change: 'Las trampas viven en una referencia y el cuerpo la enlaza.' }),
      },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r));
    assert.equal(r.resumen.perdidas, 0, 'el conocimiento no se perdió: cambió de sitio');
  });

  it('sin cambios no escribe nada y dice no_change', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar(
      { id: ID, operacion: 'no_change', parches: [{ seccion: 'Procedure', contenido: PROCEDIMIENTO.join('\n') }] },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'no_change');
    assert.ok(!hayPropuesta(arena), 'no_change no escribe una propuesta');
  });

  it('el informe dice unchanged para lo que se examinó y no cambió', () => {
    const arena = sandbox({ curated: false });
    const cuerpoConRef = `${CUERPO}\n\nVer \`references/extra.md\`.`;
    sembrar(arena, { referencias: [{ path: 'references/extra.md', content: '## Extra\n\nMaterial que no se va a tocar.\n' }], cuerpo: cuerpoConRef });
    const r = mejorar(
      { id: ID, operacion: 'patch', parches: [{ seccion: 'Procedure', contenido: PROCEDIMIENTO_AMPLIADO }], revision: buenaRevision() },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r));
    const extra = r.informe.lineas.find((f) => f.ruta === 'references/extra.md');
    assert.equal(extra.accion, 'unchanged');
    assert.equal(r.informe.cuenta.unchanged, 1);
  });

  it('la versión activa queda intacta y la candidata vive en proposed', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const antes = leerAprobada(arena);
    const r = mejorar(
      { id: ID, operacion: 'enhance', parches: [{ seccion: 'Trampas', contenido: [...TRAMPAS, 'Regla nueva medida: `--force` nunca para saltarse un error.'].join('\n') }], revision: buenaRevision() },
      { root: arena.root, key: KEY },
    );
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r));
    assert.equal(leerAprobada(arena), antes, 'la activa no se reescribe');
    assert.ok(hayPropuesta(arena));
    assert.equal(r.base.state, 'approved');
    assert.equal(r.estadoPropuesto, 'proposed');
  });

  it('guarda la huella de la base y las de cada archivo', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar({ id: ID, operacion: 'patch', parches: [{ seccion: 'Procedure', contenido: PROCEDIMIENTO_AMPLIADO }], revision: buenaRevision() }, { root: arena.root, key: KEY });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r));
    assert.match(r.hashAnterior, /^[0-9a-f]{16}$/);
    const skill = r.informe.lineas.find((f) => f.ruta === 'SKILL.md');
    assert.match(skill.shaAntes, /^[0-9a-f]{64}$/);
    assert.notEqual(skill.shaAntes, skill.shaDespues);
  });

  it('el informe empieza por el título y una línea por archivo, con el formato acordado', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar({ id: ID, operacion: 'patch', parches: [{ seccion: 'Procedure', contenido: PROCEDIMIENTO_AMPLIADO }], revision: buenaRevision() }, { root: arena.root, key: KEY });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r));
    const texto = textoDelInforme(r);
    const lineas = texto.split('\n');
    assert.equal(lineas[0], 'Self-improvement review');
    assert.ok(lineas.some((l) => l.includes(`Skill '${ID}' patched (SKILL.md)`)), texto);
    assert.match(texto, /Revision: awaiting approval\./);
    assert.match(texto, /Validation: PASS\./);
  });

  it('no hay skill viva: no se inventa una base', () => {
    const arena = sandbox({ curated: false });
    const r = mejorar({ id: 'no-existe', operacion: 'patch', parches: [] }, { root: arena.root, key: KEY });
    assert.equal(r.status, 'no-base');
  });

  it('una operación inventada se rechaza antes de tocar nada', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar({ id: ID, operacion: 'mejorar-mucho' }, { root: arena.root, key: KEY });
    assert.equal(r.status, 'invalid');
    assert.match(r.errors[0], /no es una operacion/);
  });

  it('una sección que no existe se rechaza con salida, no con un parche mudo', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar({ id: ID, operacion: 'patch', parches: [{ seccion: 'No existe', contenido: 'x' }], revision: buenaRevision() }, { root: arena.root, key: KEY });
    assert.equal(r.status, 'invalid');
    assert.match(r.errors[0], /nuevaAqui/);
  });

  it('un parche sin revisión no escribe: la puerta la exige', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena);
    const r = mejorar({ id: ID, operacion: 'patch', parches: [{ seccion: 'Procedure', contenido: PROCEDIMIENTO_AMPLIADO }] }, { root: arena.root, key: KEY });
    assert.notEqual(r.status, 'proposed');
    assert.ok(!hayPropuesta(arena));
  });
});
