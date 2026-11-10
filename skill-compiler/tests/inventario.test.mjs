#!/usr/bin/env node
/**
 * El inventario de reglas y su clasificacion.
 *
 * Lo que estas pruebas vigilan, y por que:
 *
 *   · un tramo de un solo caracter entre backticks NO puede desalinear el resto del documento (era el
 *     defecto real: el emparejamiento global saltaba al backtick siguiente y "perdia" reglas intactas);
 *   · los bloques de codigo son contenido, no estructura: un `##` dentro de ``` no abre seccion;
 *   · una regla que se mueve de seccion es `reubicada`, no perdida;
 *   · una que se reescribe conservando el sentido es `reformulada`, con su parecido medido;
 *   · lo que no se puede juzgar se declara `incierta`, ni perdido ni conservado.
 *
 *   node --test tests/inventario.test.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clasificarPerdidas, inventario, inventarioPerdido, seccionesConBloques } from '../lib/repair.mjs';

/** El emparejamiento que usaba el inventario antes de este acto, para demostrar el defecto. */
const inventarioViejo = (texto) => [...String(texto).matchAll(/`([^`\n]{2,})`/g)].map((m) => m[1].trim());

const CUERPO = [
  '## When to Use',
  '',
  'Cuando hay que decidir con evidencia medida.',
  '',
  '## Procedure',
  '',
  '1. Medir antes de tocar nada y anotar el numero exacto.',
  '2. Comparar contra el registro previo y declarar la diferencia.',
  '3. Cerrar solo si las dos medidas coinciden.',
].join('\n');

describe('inventario · delimitadores', () => {
  it('un tramo de un caracter no desalinea los tramos siguientes', () => {
    const texto = [
      '## Comillas',
      '',
      'Se escribe `$` suelto y luego `node --test` sobre la copia.',
    ].join('\n');
    // El defecto, reproducido: el tramo de 1 caracter no casa con `{2,}`, el motor salta al backtick
    // de cierre y empareja con el de apertura siguiente; `node --test` desaparece del inventario.
    assert.ok(!inventarioViejo(texto).includes('node --test'), 'el emparejamiento viejo desalinea');
    const nuevo = inventario(texto);
    assert.ok(nuevo.entreBackticks.includes('node --test'), 'el nuevo lee la linea, no el documento');
  });

  it('el caso real de la skill de trampas: siete tramos y uno de un caracter', () => {
    const texto = [
      '## Comillas',
      '',
      'PHP en línea con comillas/`$` → escribir `.php` temporal. `?` suelto rompe el parser. Rutas con `[slug]` son clases de caracteres. `$home` es de solo lectura. Escribir `.sh`, subirlo y `bash /ruta/script.sh`.',
      '',
      'Y despues: `node --test` sin `--force`.',
    ].join('\n');
    // Medido: el viejo devuelve tramos desplazados ('y', 'temporal. Rutas con', '. Escribir'...) y pierde
    // los reales de la linea impar.
    const viejo = inventarioViejo(texto);
    assert.ok(!viejo.includes('bash /ruta/script.sh'), 'el viejo pierde el ultimo tramo de la linea');
    assert.ok(!viejo.includes('[slug]'), 'y los intermedios que caen entre pares desplazados');

    const nuevo = inventario(texto);
    for (const tramo of ['bash /ruta/script.sh', '[slug]', 'node --test', '--force']) {
      assert.ok(nuevo.entreBackticks.includes(tramo), `falta «${tramo}»`);
    }
  });

  it('una linea con delimitador suelto se declara incierta, no se inventa', () => {
    const texto = ['## X', '', 'Abre `sin cerrar y sigue sin cerrar nunca.'].join('\n');
    const inv = inventario(texto);
    assert.equal(inv.inciertas.length, 1, 'la linea queda declarada');
    assert.deepEqual(inv.entreBackticks, [], 'no se inventa un tramo que no esta delimitado');
  });
});

describe('inventario · estructura', () => {
  it('un `##` dentro de un bloque de codigo no abre seccion', () => {
    const texto = [
      '## Procedure',
      '',
      '```bash',
      '## esto es un comentario de shell, no un titulo',
      'npm test --force',
      '```',
      '',
      'Y luego se cierra.',
    ].join('\n');
    const secciones = seccionesConBloques(texto);
    assert.equal(secciones.length, 1, 'el `##` del bloque no crea seccion');
    const inv = inventario(texto);
    assert.ok(!inv.encabezados.some((h) => h.includes('comentario de shell')));
    assert.ok(inv.bloques.includes('npm test --force'), 'el comando del bloque es conocimiento y se inventaria');
  });

  it('los backticks dentro de un bloque no se leen como tramos', () => {
    const texto = ['## X', '', '```', 'echo `fecha`', '```', '', 'Fuera: `node --test`.'].join('\n');
    const inv = inventario(texto);
    assert.deepEqual(inv.entreBackticks, ['node --test'], 'solo los de fuera del bloque');
  });

  it('conserva el preambulo, que va antes del primer titulo', () => {
    const texto = ['Introduccion con `dato` medido.', '', '## Procedure', '', '1. Paso uno concreto.'].join('\n');
    const inv = inventario(texto);
    assert.ok(inv.entreBackticks.includes('dato'));
    assert.ok(inv.pasos.includes('paso uno concreto.'));
  });

  it('dos secciones con el mismo titulo no se confunden', () => {
    const texto = [
      '## Procedure',
      '',
      '1. Paso de la primera.',
      '',
      '## Procedure',
      '',
      '1. Paso de la segunda.',
    ].join('\n');
    const inv = inventario(texto);
    assert.equal(inv.reglas.length, 2);
    assert.deepEqual(inv.reglas.map((r) => r.seccion), ['Procedure', 'Procedure']);
  });

  it('las listas anidadas cuentan como reglas, con su seccion', () => {
    const texto = ['## Verify', '', '- Comprobar la huella.', '  - Y la del diario.', '    - Y su cadena.'].join('\n');
    const inv = inventario(texto);
    assert.equal(inv.reglas.length, 3);
    assert.ok(inv.reglas.every((r) => r.seccion === 'Verify'));
  });
});

describe('clasificarPerdidas · que se conserva, se mueve, se reformula o se pierde', () => {
  it('una regla que cambia de seccion es reubicada, no perdida', () => {
    const antes = ['## A', '', '1. Medir antes de tocar nada y anotar el numero.', '', '## B', '', '1. Otra cosa distinta.'].join('\n');
    const despues = ['## A', '', '1. Otra cosa distinta.', '', '## B', '', '1. Medir antes de tocar nada y anotar el numero.'].join('\n');
    const r = clasificarPerdidas(antes, despues);
    assert.equal(r.perdidas.length, 0, 'no se perdio nada');
    assert.ok(r.reubicadas.some((x) => x.regla.includes('medir antes de tocar nada')));
  });

  it('una regla reescrita conservando el sentido es reformulada, con su parecido', () => {
    const antes = ['## P', '', '1. Medir antes de tocar nada y anotar el numero exacto en el informe del acto.'].join('\n');
    const despues = ['## P', '', '1. Medir siempre antes de tocar nada y anotar el numero en el informe del acto.'].join('\n');
    const r = clasificarPerdidas(antes, despues);
    assert.equal(r.perdidas.length, 0);
    assert.equal(r.reformuladas.length, 1);
    assert.ok(r.reformuladas[0].parecido >= 0.6);
  });

  it('una regla que desaparece sin rastro es perdida', () => {
    const antes = ['## P', '', '- Medir antes de tocar nada y anotar el numero.', '- Declarar la diferencia con su cifra.'].join('\n');
    const despues = ['## P', '', '- Declarar la diferencia con su cifra.'].join('\n');
    const r = clasificarPerdidas(antes, despues);
    assert.equal(r.perdidas.length, 1);
    assert.match(r.perdidas[0].regla, /medir antes de tocar nada/);
  });

  it('con delimitadores sueltos en el origen, la perdida es incierta', () => {
    const antes = ['## P', '', '1. Medir `sin cerrar y seguir con `paso` suelto.', '', '2. Declarar la diferencia con su cifra.'].join('\n');
    const despues = ['## P', '', '1. Medir sin cerrar.'].join('\n');
    const r = clasificarPerdidas(antes, despues);
    assert.equal(r.perdidas.length, 0, 'no se afirma una perdida que no se puede medir');
    assert.ok(r.inciertas.length > 0, 'se declara incierta');
  });

  it('los encabezados renumerados son un cambio estructural, no una perdida', () => {
    const antes = ['## 1. Medir', '', '1. Paso concreto del procedimiento.'].join('\n');
    const despues = ['## 7. Medir', '', '1. Paso concreto del procedimiento.'].join('\n');
    const r = clasificarPerdidas(antes, despues);
    assert.equal(r.perdidas.length, 0, 'no se pierde conocimiento');
    assert.equal(r.reubicadas.length, 0, 'y no es una regla movida');
    assert.equal(r.estructurales.length, 1, 'es un cambio de encabezado');
    assert.match(r.estructurales[0].encabezado, /1\. Medir/);
  });

  it('el resumen cuenta cada categoria y cuadra con las reglas de origen', () => {
    const antes = CUERPO;
    const despues = CUERPO.replace('3. Cerrar solo si las dos medidas coinciden.', '3. Cerrar solo si las dos medidas coinciden, sin excepciones.');
    const r = clasificarPerdidas(antes, despues);
    assert.equal(r.resumen.reglasAntes, 3);
    assert.equal(r.resumen.reglasDespues, 3);
    assert.equal(r.resumen.reglasConservadas + r.resumen.reglasReformuladas + r.resumen.perdidasConfirmadas, 3);
  });
});

describe('inventarioPerdido · solo compara lo comparable', () => {
  it('no compara reglas ni lineas inciertas, que tienen su propia clasificacion', () => {
    const antes = inventario(CUERPO);
    const despues = inventario(`${CUERPO}\n\nNueva linea con \`otro --flag\`.`);
    const perdido = inventarioPerdido(antes, despues);
    assert.deepEqual(perdido, {}, 'anadir no pierde nada');
    assert.ok(!('reglas' in perdido) && !('inciertas' in perdido));
  });
});
