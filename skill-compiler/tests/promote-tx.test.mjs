#!/usr/bin/env node
/**
 * La promocion, ahora por el motor transaccional (ACTO E.9).
 *
 * Lo que este fichero vigila, y por que:
 *
 *   · `promover` ya no sustituye la version viva con `rename` sueltos: la transaccion aparta el paquete con
 *     su manifiesto de hashes, instala, verifica contra lo validado, escribe el asiento y confirma;
 *   · lo propio de promover (meta, base, verificador del integrador) se comprueba DENTRO, antes de
 *     confirmar, asi que hay UNA reversion y no dos;
 *   · una promocion fallida nunca deja la skill viva inaccesible;
 *   · el contrato publico (status, huellas de 16, reason) no cambia.
 *
 *   node --test tests/promote-tx.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approve, folderHash, projectKey, propose, vigenteDe } from '../lib/compiler.mjs';
import { conCerrojo, leerDiario, promover } from '../lib/promote.mjs';
import { reparar } from '../lib/repair.mjs';
import { recuperarTransacciones } from '../lib/approve-tx.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);
const opts = (arena) => ({ root: arena.root, curated: arena.curated });
const dirProps = (arena, id) => join(arena.root, 'projects', KEY, 'proposed', id);
const dirAprob = (arena, id) => join(arena.root, 'projects', KEY, 'approved', id);
const dirSup = (arena) => join(arena.root, 'projects', KEY, 'superseded');
const sha = (t) => createHash('sha256').update(t).digest('hex');

const TEMA = (id) => ({
  id,
  description: `Mantiene al dia el ${id.replace(/-/g, ' ')} con pasos medidos y comprobados en produccion.`,
  whenToUse: `Cuando haya que ocuparse del ${id.replace(/-/g, ' ')} tras una recepcion de material.`,
  body: [
    '## Cuando se usa', '',
    `Cuando toca el ${id.replace(/-/g, ' ')}, con las hojas de conteo delante.`, '',
    '## Procedimiento', '',
    '1. Recorre el registro entero y anota el numero que sale.',
    '2. Compara con el registro previo y declara la diferencia.',
    '3. Cierra solo las referencias que cuadren.',
  ].join('\n'),
});

const CUERPO_SUCIO = '## Cuando se usa   \r\n\r\nAl cerrar la jornada, con el registro delante.   \r\n\r\n## Procedimiento  \r\n\r\n1. Recorre el registro entero.   \r\n2. Anota lo observado sin interpretarlo.  \r\n3. Cierra lo resuelto y deja el resto abierto.  \r\n\r\n\r\n';

const ensuciar = (dir) => {
  const texto = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  const cabecera = texto.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n#\s[^\n]*\r?\n/)[0];
  writeFileSync(join(dir, 'SKILL.md'), cabecera + CUERPO_SUCIO);
};

/** Skill viva y sucia + propuesta de nivel 1 lista para promocionar. */
const conPropuesta = (arena, id, extra = {}) => {
  assert.equal(propose(TEMA(id), { ...opts(arena), cwd: CWD }).status, 'proposed');
  assert.equal(approve(id, KEY, opts(arena)).ok, true);
  const dir = dirAprob(arena, id);
  for (const [ruta, texto] of Object.entries(extra)) {
    mkdirSync(join(dir, ruta, '..'), { recursive: true });
    writeFileSync(join(dir, ruta), texto);
  }
  ensuciar(dir);
  const huella = vigenteDe(id, KEY, opts(arena)).hash;
  const r = reparar(id, KEY, { ...opts(arena), cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r.bloqueos ?? r.reason));
  return { huella, dir };
};

const historicos = (arena) => {
  const dir = dirSup(arena);
  return existsSync(dir) ? readdirSync(dir).filter((n) => !n.endsWith('.json')).sort() : [];
};

describe('1-4 · promocion por la transaccion', () => {
  it('con version anterior: se aparta entera, con manifiesto de hashes, y la nueva queda activa', () => {
    const arena = sandbox({ curated: false });
    const { huella } = conPropuesta(arena, 'registro-de-hojas', { 'references/detalle.md': '## Detalle\n\nEl conteo va por hojas.\n' });
    const viva = readFileSync(join(dirAprob(arena, 'registro-de-hojas'), 'SKILL.md'), 'utf8');

    const r = promover('registro-de-hojas', KEY, { ...opts(arena), cwd: CWD, niveles: [1] });
    assert.equal(r.status, 'promoted', JSON.stringify(r.reason ?? r.regresion));
    assert.equal(r.hashAnterior, huella);
    assert.ok(existsSync(r.superseded), 'la anterior esta en superseded/');
    assert.equal(folderHash(r.superseded), huella, 'byte a byte igual a la viva');

    const manifiesto = JSON.parse(readFileSync(`${r.superseded}.json`, 'utf8'));
    assert.equal(manifiesto.id, 'registro-de-hojas');
    assert.equal(manifiesto.from, 'approved');
    assert.ok(manifiesto.files.some((f) => f.path === 'references/detalle.md'), 'la referencia viaja con el paquete');
    for (const f of manifiesto.files) {
      assert.equal(f.sha256, sha(readFileSync(join(r.superseded, f.path))), `hash de ${f.path}`);
    }
    assert.equal(readFileSync(join(r.superseded, 'SKILL.md'), 'utf8'), viva, 'el SKILL.md apartado es el de antes');
    assert.equal(r.manifiesto.endsWith('.json'), true);
  });

  it('sin version anterior: NO activa — promover es para actualizar una viva, y lo dice', () => {
    const arena = sandbox({ curated: false });
    const id = 'registro-de-sin-previa';
    assert.equal(propose(TEMA(id), { ...opts(arena), cwd: CWD }).status, 'proposed');
    const metaFile = join(dirProps(arena, id), 'meta.json');
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    writeFileSync(metaFile, JSON.stringify({ ...meta, repair: { ...(meta.repair ?? {}), nivel: 1 } }, null, 2));

    const r = promover(id, KEY, { ...opts(arena), cwd: CWD, niveles: [1] });
    // Medido: sin version viva fallan `base-vigente`, `conservacion` y `reversible`; promover no inventa
    // una base. Una skill nueva entra por aprobacion, no por promocion.
    assert.equal(r.status, 'regression', JSON.stringify(r.reason ?? r.regresion));
    assert.match(r.reason, /base-vigente|conservacion|reversible/);
    assert.equal(existsSync(dirAprob(arena, id)), false, 'no se activa nada');
    assert.ok(existsSync(dirProps(arena, id)), 'la propuesta sigue pendiente');
    assert.deepEqual(historicos(arena), []);
  });

  it('con upstream/: el paquete historico lo conserva', () => {
    const arena = sandbox({ curated: false });
    conPropuesta(arena, 'registro-de-upstream', { 'upstream/original.md': '# Original\n\nTexto del proveedor.\n' });
    const r = promover('registro-de-upstream', KEY, { ...opts(arena), cwd: CWD, niveles: [1] });
    assert.equal(r.status, 'promoted', JSON.stringify(r.reason));
    const manifiesto = JSON.parse(readFileSync(`${r.superseded}.json`, 'utf8'));
    assert.ok(manifiesto.files.some((f) => f.path === 'upstream/original.md'));
  });

  it('el asiento unico dice `promovida` y lleva las dos huellas y las pruebas', () => {
    const arena = sandbox({ curated: false });
    conPropuesta(arena, 'registro-de-asiento');
    const r = promover('registro-de-asiento', KEY, { ...opts(arena), cwd: CWD, niveles: [1] });
    const asientos = leerDiario(KEY, opts(arena)).filter((e) => e.decision === 'promovida');
    assert.equal(asientos.length, 1, 'un asiento, no dos: la aprobacion interna no anota el suyo');
    assert.equal(asientos[0].hashAnterior, r.hashAnterior);
    assert.equal(asientos[0].hashResultante, r.hashResultante);
    assert.ok(asientos[0].pruebas.every((p) => p.ok));
    assert.equal(asientos[0].nivel, 1);
    assert.equal(asientos[0].por, 'motor');
  });
});

describe('5-7 · fallas del motor durante la promocion', () => {
  it('fallo al instalar: la viva sigue activa y no hay historico suelto', () => {
    const arena = sandbox({ curated: false });
    const { huella } = conPropuesta(arena, 'registro-de-fallo-instalar');
    const r = promover('registro-de-fallo-instalar', KEY, { ...opts(arena), cwd: CWD, niveles: [1], hooks: { fallar: 'installed' } });
    assert.equal(r.status, 'critical');
    assert.match(r.reason, /no se pudo activar/);
    assert.equal(vigenteDe('registro-de-fallo-instalar', KEY, opts(arena)).hash, huella);
    assert.deepEqual(historicos(arena), []);
    assert.ok(existsSync(dirProps(arena, 'registro-de-fallo-instalar')), 'la propuesta sigue en su sitio');
  });

  it('fallo al escribir el manifiesto: se revierte y la viva vuelve con su huella', () => {
    const arena = sandbox({ curated: false });
    const { huella } = conPropuesta(arena, 'registro-de-fallo-manifiesto');
    const r = promover('registro-de-fallo-manifiesto', KEY, { ...opts(arena), cwd: CWD, niveles: [1], hooks: { fallar: 'manifest' } });
    assert.equal(r.status, 'critical');
    assert.equal(vigenteDe('registro-de-fallo-manifiesto', KEY, opts(arena)).hash, huella);
    assert.deepEqual(historicos(arena), []);
  });

  it('fallo al anotar el diario: la promocion se deshace y no queda asiento', () => {
    const arena = sandbox({ curated: false });
    const { huella } = conPropuesta(arena, 'registro-de-fallo-diario');
    const r = promover('registro-de-fallo-diario', KEY, { ...opts(arena), cwd: CWD, niveles: [1], hooks: { fallar: 'journal' } });
    assert.equal(r.status, 'critical');
    assert.equal(vigenteDe('registro-de-fallo-diario', KEY, opts(arena)).hash, huella);
    assert.equal(leerDiario(KEY, opts(arena)).filter((e) => e.decision === 'promovida').length, 0);
  });

  it('interrupcion: la intencion queda y la recuperacion cierra el estado sin perder la viva', () => {
    const arena = sandbox({ curated: false });
    conPropuesta(arena, 'registro-de-interrupcion');
    const r = promover('registro-de-interrupcion', KEY, { ...opts(arena), cwd: CWD, niveles: [1], hooks: { interrumpir: 'archived' } });
    assert.notEqual(r.status, 'promoted');

    const recuperacion = recuperarTransacciones({ root: arena.root, key: KEY });
    assert.equal(recuperacion.incompletas, 0, JSON.stringify(recuperacion.detalles));
    assert.ok(vigenteDe('registro-de-interrupcion', KEY, opts(arena)), 'siempre hay una version viva');
  });
});

describe('8-10 · verificacion posterior y compensacion', () => {
  it('el verificador del integrador se ejecuta DENTRO: revierte y la viva vuelve con su huella', () => {
    const arena = sandbox({ curated: false });
    const { huella } = conPropuesta(arena, 'registro-de-verificador');
    const r = promover('registro-de-verificador', KEY, {
      ...opts(arena), cwd: CWD, niveles: [1],
      verificador: () => ['la comprobacion del integrador dice que no'],
    });
    assert.equal(r.status, 'reverted', JSON.stringify(r));
    assert.equal(vigenteDe('registro-de-verificador', KEY, opts(arena)).hash, huella, 'la viva esta de vuelta con su huella');
    assert.ok(existsSync(dirProps(arena, 'registro-de-verificador')), 'la propuesta vuelve a proposed/');
    assert.equal(leerDiario(KEY, opts(arena)).at(-1).decision, 'revertida');
  });

  it('el verificador solo puede anadir problemas, nunca autorizar', () => {
    const arena = sandbox({ curated: false });
    conPropuesta(arena, 'registro-de-verificador-mudo');
    const r = promover('registro-de-verificador-mudo', KEY, { ...opts(arena), cwd: CWD, verificador: () => [] });
    assert.equal(r.status, 'pending', 'sin nivel autorizado no se promociona, diga lo que diga el integrador');
  });

  it('si la reversion no puede completarse, se dice: nunca se declara deshecho', () => {
    const arena = sandbox({ curated: false });
    conPropuesta(arena, 'registro-de-reversion-rota');
    const r = promover('registro-de-reversion-rota', KEY, {
      ...opts(arena), cwd: CWD, niveles: [1],
      verificador: () => ['fallo forzado'],
      hooks: {
        // Se ocupa `proposed/<id>` mientras la transaccion tiene la candidata instalada: la reversion podra
        // apartar lo instalado, pero no devolverlo a su sitio. Eso es un rollback incompleto, y se declara.
        trasInstalar: () => writeFileSync(dirProps(arena, 'registro-de-reversion-rota'), 'estorbo en proposed'),
      },
    });
    assert.equal(r.status, 'critical', JSON.stringify(r));
    assert.match(r.reason, /NI deshacer/);
    assert.ok(r.reverso.problemas.length > 0, 'el problema del rollback no se oculta');
    assert.equal(leerDiario(KEY, opts(arena)).at(-1).decision, 'reversion-fallida');
  });
});

describe('11-14 · cerrojo, repeticion, aislamiento y ambito', () => {
  it('con el cerrojo tomado, la promocion no entra y lo dice', () => {
    const arena = sandbox({ curated: false });
    conPropuesta(arena, 'registro-de-cerrojo');
    const dentro = conCerrojo(arena.root, KEY, 'registro-de-cerrojo', () =>
      promover('registro-de-cerrojo', KEY, { ...opts(arena), cwd: CWD, niveles: [1] }));
    assert.equal(dentro.status, 'locked', JSON.stringify(dentro));
    assert.ok(existsSync(dirProps(arena, 'registro-de-cerrojo')), 'no se movio nada');
  });

  it('promover dos veces la misma propuesta no duplica historicos ni asientos', () => {
    const arena = sandbox({ curated: false });
    const { huella } = conPropuesta(arena, 'registro-de-repeticion');
    const primera = promover('registro-de-repeticion', KEY, { ...opts(arena), cwd: CWD, niveles: [1] });
    assert.equal(primera.status, 'promoted');
    const segunda = promover('registro-de-repeticion', KEY, { ...opts(arena), cwd: CWD, niveles: [1] });
    assert.notEqual(segunda.status, 'promoted', 'ya no hay propuesta que activar');
    assert.equal(historicos(arena).length, 1);
    assert.equal(leerDiario(KEY, opts(arena)).filter((e) => e.decision === 'promovida').length, 1);
    assert.notEqual(vigenteDe('registro-de-repeticion', KEY, opts(arena)).hash, huella);
  });

  it('promocionar en un proyecto no toca los historicos de otro', () => {
    const arena = sandbox({ curated: false });
    conPropuesta(arena, 'registro-de-aislamiento');
    const otroKey = projectKey('C:\\xampp\\htdocs\\otro-proyecto');
    const antes = existsSync(join(arena.root, 'projects', otroKey)) ? readdirSync(join(arena.root, 'projects', otroKey)).length : 0;
    assert.equal(promover('registro-de-aislamiento', KEY, { ...opts(arena), cwd: CWD, niveles: [1] }).status, 'promoted');
    const despues = existsSync(join(arena.root, 'projects', otroKey)) ? readdirSync(join(arena.root, 'projects', otroKey)).length : 0;
    assert.equal(despues, antes, 'el otro proyecto no cambia');
  });

  it('no publica en global: `published/` y `global/` siguen sin existir', () => {
    const arena = sandbox({ curated: false });
    const { huella } = conPropuesta(arena, 'registro-de-ambito');
    const r = promover('registro-de-ambito', KEY, { ...opts(arena), cwd: CWD, niveles: [1] });
    assert.equal(r.status, 'promoted');
    assert.equal(existsSync(join(arena.root, 'projects', KEY, 'published')), false, 'no se publica nada');
    assert.equal(existsSync(join(arena.root, 'global')), false, 'ni se crea la biblioteca global');
    assert.equal(existsSync(join(arena.root, 'projects', KEY, 'global')), false);
    assert.notEqual(vigenteDe('registro-de-ambito', KEY, opts(arena)).hash, huella);
  });
});
