#!/usr/bin/env node
/**
 * Coherencia entre lo que hay, lo que se declara y lo que se documenta.
 *
 * ── El defecto que esto cierra ──────────────────────────────────────────────────────────────────
 *
 * Un comando que existe en el código y no aparece en la ayuda no existe para quien lo necesita; un comando
 * documentado que no está implementado es una promesa falsa; y una versión que no coincide con su entrada en
 * el changelog es una entrega que nadie puede fechar. Nada de eso lo caza un test de comportamiento, porque
 * el comportamiento es correcto: lo que falla es la **coherencia**.
 *
 *   node --test tests/coherencia.test.mjs
 */
import assert from 'node:assert/strict';

import { initialLearning, learningView } from '../lib/presentation.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(RAIZ, '..');
const leer = (...partes) => readFileSync(join(RAIZ, ...partes), 'utf8');

describe('la versión, la ayuda y la documentación dicen lo mismo que el código', () => {
  it('la versión del manifiesto tiene su entrada en el changelog del repositorio', () => {
    const version = JSON.parse(leer('package.json')).version;
    const changelog = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8');
    assert.match(version, /^\d+\.\d+\.\d+$/, `la versión «${version}» no es semántica`);
    assert.match(changelog, new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'), `el CHANGELOG no tiene entrada para ${version}`);
    // Y la entrada no puede estar vacía: un titular sin contenido no documenta la entrega.
    const entrada = changelog.split(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'))[1].split('\n## [')[0];
    assert.ok(entrada.trim().length > 500, 'la entrada del changelog de la versión actual está vacía o es un titular');
  });

  it('cada comando implementado está en la ayuda, y cada comando de la ayuda existe', () => {
    const bin = leer('bin', 'skill-compiler.mjs');
    // La ayuda vive en la tabla `AYUDA` (sintaxis + clave de traduccion) y la pinta `usage()`. Antes vivia en
    // el comentario de cabecera; el contrato es el mismo: ni un comando de mas en la ayuda, ni uno de menos.
    const desde = bin.indexOf('const AYUDA = [');
    assert.ok(desde > 0, 'la ayuda tiene que ser una tabla, no un comentario');
    const tabla = bin.slice(desde, bin.indexOf('];', desde));
    const documentados = [...tabla.matchAll(/^\s*\['([^']+)',\s*'cli\.help\.[a-z0-9-]+'\],?$/gm)].map((m) => m[1].split(/[ |\[]/)[0]);
    const implementados = [...bin.matchAll(/^\s*case '([a-z]+)':/gm)].map((m) => m[1]);
    assert.ok(implementados.length >= 15, `se esperaban los comandos del CLI, y se leyeron ${implementados.length}`);
    assert.ok(documentados.length >= implementados.length, `la ayuda se quedo corta: ${documentados.length} de ${implementados.length}`);
    for (const comando of implementados) {
      assert.ok(documentados.includes(comando), `el comando «${comando}» está implementado y no aparece en la ayuda`);
    }
    for (const comando of new Set(documentados)) {
      assert.ok(implementados.includes(comando), `la ayuda promete «${comando}», que no está implementado`);
    }
  });

  it('todos los documentos están en el índice del README', () => {
    const readme = leer('README.md');
    const docs = readdirSync(join(RAIZ, 'docs')).filter((n) => n.endsWith('.md'));
    assert.ok(docs.length >= 8, `se esperaban los documentos del plugin, y hay ${docs.length}`);
    for (const doc of docs) {
      assert.match(readme, new RegExp(`docs/${doc.replace(/[.\\-]/g, '\\$&')}`), `«docs/${doc}» no está en el índice del README`);
    }
  });

  it('los módulos del núcleo están en el mapa de ficheros, y el mapa no inventa módulos', () => {
    const desarrollo = leer('docs', 'DESARROLLO.md');
    const modulos = readdirSync(join(RAIZ, 'lib')).filter((n) => n.endsWith('.mjs'));
    assert.ok(modulos.length >= 10, `se esperaban los módulos del núcleo, y hay ${modulos.length}`);
    for (const modulo of modulos) {
      assert.ok(desarrollo.includes(`lib/${modulo}`), `«lib/${modulo}» no está en el mapa de ficheros de DESARROLLO.md`);
    }
    for (const citado of new Set([...desarrollo.matchAll(/`lib\/([\w.-]+\.mjs)`/g)].map((m) => m[1]))) {
      assert.ok(modulos.includes(citado), `DESARROLLO.md cita «lib/${citado}», que no existe`);
    }
  });

  it('las herramientas del modelo están declaradas en el README con su nombre exacto', () => {
    const readme = leer('README.md');
    const definitions = leer('lib', 'definitions.mjs');
    const herramientas = [...definitions.matchAll(/name: '(skill_[a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(herramientas.length >= 4, `se esperaban las herramientas del plugin, y se leyeron ${herramientas.length}`);
    for (const herramienta of new Set(herramientas)) {
      assert.ok(readme.includes(herramienta), `la herramienta «${herramienta}» no aparece en el README`);
    }
  });

  it('la portada del repositorio anuncia la versión del manifiesto, no otra', () => {
    // El defecto que esto vigila: la tabla de la portada se quedó en «v4.0.1 · 777 pruebas» mientras el
    // propio README declaraba la 5.0.2 con 902. Nadie lo vio porque ninguna prueba leía la portada, y una
    // versión vieja en la tabla es una promesa falsa sobre lo que hay publicado.
    const version = JSON.parse(leer('package.json')).version;
    const portada = readFileSync(join(REPO, 'README.md'), 'utf8');
    const fila = portada.split('\n').find((linea) => linea.startsWith('| [`LifeCode Skill-Compiler`]'));
    assert.ok(fila !== undefined, 'la portada tiene que tener la fila de este plugin en la tabla');
    const anunciada = fila.match(/Estable\s*·\s*v(\d+\.\d+\.\d+)/);
    assert.ok(anunciada !== null, 'la fila tiene que declarar su versión estable');
    assert.equal(anunciada[1], version, `la portada anuncia v${anunciada[1]} y el manifiesto dice ${version}`);
  });

  it('la compatibilidad declara UN anfitrión, y el README cita el mismo que la ficha', () => {
    // El defecto que esto vigila: el README citaba la rc.2 mientras la ficha declaraba otra, y dos versiones
    // de anfitrión en la misma documentación se leen como una sola promesa. El número no se fija aquí: se
    // fija en la ficha —su fila «Anfitrión», con la fecha de la medición— y el README tiene que decir el mismo.
    const ficha = leer('docs', 'ANFITRION.md');
    const lineas = ficha.split(/\r?\n/);
    const fila = lineas.find((linea) => linea.startsWith('| **Anfitrión** (DSH instalado)'));
    assert.ok(fila !== undefined, 'ANFITRION.md tiene que declarar el anfitrión con el que se midió');
    const declarado = fila.match(/`(\d+\.\d+\.\d+-rc\.\d+)`/);
    assert.ok(declarado !== null, 'la ficha tiene que dar la versión del anfitrión, no sólo su nombre');
    // Sin fecha, «compatible» no se puede comprobar.
    assert.match(ficha, /^\| \*\*Medición\*\* \| \d{4}-\d{2}-\d{2}/m, 'la ficha no fecha la medición');

    const readme = leer('README.md');
    const citados = [...new Set([...readme.matchAll(/`(\d+\.\d+\.\d+-rc\.\d+)`/g)].map((m) => m[1]))];
    assert.equal(citados.length, 1, `el README tiene que citar un solo anfitrión medido, y cita: ${citados.join(', ') || 'ninguno'}`);
    assert.equal(citados[0], declarado[1], `el README cita el anfitrión ${citados[0]} y la ficha declara el ${declarado[1]}`);
  });
});

describe('la píldora cuenta lo que pasó, y se retira', () => {
  const cliente = () => readFileSync(join(RAIZ, 'client.js'), 'utf8');

  it('cuenta por TIPO y no por el último resultado', () => {
    // El defecto que esto vigila: un `outcome` único hacía que un turno con una creación y un rechazo
    // dijera «no se creó ninguna skill». Contar por tipo es lo que impide volver a esa frase.
    const c = cliente();
    assert.match(c, /part_rejected_s/, 'la píldora tiene que poder decir que algo se rechazó');
    assert.match(c, /part_blocked_s/, 'y que algo se bloqueó');
    assert.match(c, /partes\.length/, 'y componer la frase con las cuentas');
  });

  it('no enseña un id suelto cuando el turno hizo varias cosas', () => {
    const c = cliente();
    assert.match(c, /const simple = partes\.length === 1 && total === 1/, 'la frase con id es sólo para una skill y un resultado');
    assert.match(c, /simple && id \?/, 'y el id se pinta sólo en ese caso');
  });

  it('los dos tiempos están declarados y el aviso no es indefinido', () => {
    const c = cliente();
    assert.match(c, /MS_INFORMATIVO = 8000/, 'el informativo: 2× el peor tiempo de lectura medido');
    assert.match(c, /MS_ATENCION = 30000/, 'el que pide atención: puede exigir una decisión');
    assert.match(c, /setTimeout/, 'y alguien tiene que retirarlo');
  });

  it('la vista expone los ids y los recuentos, y la proyección los declara', () => {
    const view = learningView(initialLearning());
    // Cadena (y no lista): la vista de esta unidad sólo lleva primitivos. El par de arriba prueba que no
    // se rompa esa regla, así que aquí se comprueba la forma que sí cumple.
    assert.equal(view.ids, '', 'la vista tiene que traer el acumulado (aunque esté vacío)');
    for (const campo of ['created', 'updated', 'rejected', 'blocked']) {
      assert.equal(view[campo], 0, `la vista tiene que traer «${campo}»`);
    }
    const proyeccion = readFileSync(join(RAIZ, 'lib', 'projection.mjs'), 'utf8');
    assert.match(proyeccion, /ids: z\.array\(z\.string\(\)\).catch\(\[\]\)/, 'el estado declara la lista');
    assert.match(proyeccion, /ids: z\.string\(\)/, 'la vista la expone como cadena');
  });
});
