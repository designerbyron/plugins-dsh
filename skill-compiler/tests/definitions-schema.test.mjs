/**
 * Contrato de la superficie del plugin: congelado ANTES de tocar una sola descripcion.
 *
 * Dos decisiones que este fichero materializa:
 *
 *   1. **El inventario no son cuatro herramientas por casualidad.** Lo que el plugin expone es una
 *      superficie: las herramientas del modelo, los comandos de sesion con su nombre en cada idioma, el proveedor de
 *      skills y la seccion estatica del prompt. El manifiesto enumera las cuatro capas y esta prueba
 *      compara la superficie REAL (incluido lo que `index.js` registra, leido del fichero) contra ella:
 *      una herramienta nueva, un comando que desaparece o un nombre que cambia de idioma fallan aqui.
 *   2. **El texto queda fuera del manifiesto a proposito.** La estructura (nombres, tipos, obligatoriedad,
 *      enums, esquema de salida, contrato declarado) esta congelada; el texto visible se protege por sus
 *      propiedades —ASCII, ingles, ninguna ruta obligatoria vacia— para que traducirlo no obligue a
 *      tocar la expectativa ni un cambio de esquema pueda esconderse detras de una traduccion.
 *
 * El manifiesto se congelo sobre el arbol ANTERIOR a la traduccion (`_meta.commit`) y no se regenera
 * desde las definiciones: si la prueba construyera la expectativa a partir de la misma definicion,
 * aceptaria cualquier regresion.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { LOCALIZED_OPERATIONS } from '../lib/localized-commands.mjs';
import {
  PROTOCOL, PROVIDER_RANK, skillImprove, skillPropose, skillReview, skillUpstreamCheck, skillVendor,
} from '../lib/definitions.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const MANIFIESTO = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/definitions-contract.json'), 'utf8'));
const FABRICAS = { skillImprove, skillPropose, skillReview, skillVendor, skillUpstreamCheck };
const HERRAMIENTAS = ['skill_improve', 'skill_propose', 'skill_review', 'skill_upstream_check', 'skill_vendor'];

const ordenado = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const sinFunciones = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v)));

/** La estructura de salida sin una sola cadena de texto: es lo que no puede moverse al traducir. */
const sinTexto = (valor) => {
  if (Array.isArray(valor)) return valor.map(sinTexto);
  if (valor && typeof valor === 'object') {
    const salida = {};
    for (const clave of Object.keys(valor).sort()) {
      if (clave === 'description') continue;
      salida[clave] = sinTexto(valor[clave]);
    }
    return salida;
  }
  return valor;
};

/** Recorre las definiciones y devuelve, por ruta, cada cadena de texto visible al modelo. */
function textosVisibles() {
  const salida = {};
  const recorrer = (valor, ruta, herramienta) => {
    if (typeof valor === 'string') {
      if (ruta.split('.').pop() === 'description') salida[`${herramienta}:${ruta}`] = valor;
      return;
    }
    if (Array.isArray(valor)) { valor.forEach((v, i) => recorrer(v, `${ruta}[${i}]`, herramienta)); return; }
    if (valor && typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor)) recorrer(v, ruta === '' ? k : `${ruta}.${k}`, herramienta);
    }
  };
  for (const [nombre, fabrica] of Object.entries(FABRICAS)) {
    const t = fabrica({});
    recorrer({ description: t.description, parameters: t.parameters, 'output.schema': t.output?.schema }, '', t.name);
    assert.equal(MANIFIESTO.tools[t.name]?.factory, nombre, 'cada fabrica declara el nombre que el manifiesto le supone');
  }
  salida['PROTOCOL:protocol'] = PROTOCOL;
  return salida;
}

/** Huella del almacen entero: sirve para probar «no escribe nada» y «escribe algo». */
function huella(dir) {
  const h = createHash('sha256');
  const recorrer = (d) => {
    for (const entrada of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, entrada.name);
      if (entrada.isDirectory()) recorrer(p);
      else {
        h.update(relative(dir, p).replace(/\\/g, '/'));
        h.update(readFileSync(p));
      }
    }
  };
  recorrer(dir);
  return h.digest('hex');
}

const RAW = 'https://raw.githubusercontent.com/acme/skills/main/medida/SKILL.md';
const UPSTREAM = [
  '---',
  'name: medida-desde-fuera',
  'description: "Decide with measured evidence instead of impressions, every single time."',
  'whenToUse: "Cuando una decision necesite un numero medido y anotado."',
  '---',
  '',
  '# Medida desde fuera',
  '',
  '## When to Use',
  '',
  'Cuando haya que decidir con evidencia y no con impresiones.',
  '',
  '## Procedure',
  '',
  '1. Medir antes de tocar nada y anotar el numero.',
  '2. Comparar contra el registro previo y declarar la diferencia.',
].join('\n');

const fetchFalso = (rutas) => async (url) => {
  const ruta = rutas[url];
  if (ruta === undefined) return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'no encontrado' };
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => ruta };
};

// ── 1 · inventario: la superficie completa, no cuatro nombres ────────────────────────────────────

describe('definitions · inventario del contrato', () => {
  it('el manifiesto cubre las CUATRO capas de la superficie, no solo las herramientas', () => {
    assert.deepEqual(Object.keys(MANIFIESTO.superficie).sort(),
      ['comandos', 'herramientas', 'nombres', 'protocolo', 'proveedor']);
    assert.deepEqual(MANIFIESTO.superficie.herramientas, HERRAMIENTAS);
    // Las herramientas y los comandos son superficies distintas: un comando humano no es una herramienta
    // del modelo, y el manifiesto tiene que declarar las dos.
    assert.equal(MANIFIESTO.superficie.comandos.length, 16);
    // Y los nombres: una operacion, un nombre por idioma. El alias espanol ya no es un metadato del ingles.
    assert.equal(Object.keys(MANIFIESTO.superficie.nombres).length, 16);
  });

  it('lo que index.js REGISTRA es exactamente lo que el manifiesto declara', () => {
    // Se lee el fichero, no una lista copiada: una herramienta nueva registrada en el adaptador tiene que
    // entrar al contrato, y una que se retire tiene que salir.
    const fuente = readFileSync(join(process.cwd(), 'index.js'), 'utf8');
    const registradas = [...fuente.matchAll(/ctx\.tools\.register\(defineTool\((\w+)\(/g)].map((m) => m[1]);
    assert.deepEqual(registradas.sort(), ['skillImprove', 'skillPropose', 'skillReview', 'skillUpstreamCheck', 'skillVendor']);
    const nombres = registradas.map((f) => Object.keys(MANIFIESTO.tools).find((n) => MANIFIESTO.tools[n].factory === f)).sort();
    assert.deepEqual(nombres, Object.keys(MANIFIESTO.tools).sort());
    // Y ninguna herramienta de la superficie puede aprobar: aprobar no es una herramienta.
    for (const nombre of nombres) assert.equal(/approve|publish|retire|enable/.test(nombre), false, nombre);
  });

  it('los comandos vivos son los declarados, con su nombre en cada idioma', () => {
    const s = sandbox({ curated: false });
    const cmds = skillCommands({ root: s.root });
    assert.deepEqual(cmds.map((c) => c.name).sort(), [...MANIFIESTO.superficie.comandos].sort());
    // El manifiesto declara la operacion y sus dos nombres; la prueba compara el mapa REAL contra el, id a id.
    const real = Object.fromEntries(LOCALIZED_OPERATIONS.map((op) => [op.id, { ...op.names }]));
    assert.deepEqual(real, MANIFIESTO.superficie.nombres);
    assert.equal(cmds.length, MANIFIESTO.superficie.comandos.length);
  });

  it('el proveedor y la seccion estatica declaran lo que el manifiesto congela', () => {
    assert.equal(PROVIDER_RANK, MANIFIESTO.superficie.proveedor.rank);
    assert.equal(MANIFIESTO.superficie.proveedor.name, 'skill-compiler');
    const fuente = readFileSync(join(process.cwd(), 'index.js'), 'utf8');
    assert.match(fuente, new RegExp(`name: '${MANIFIESTO.superficie.protocolo.nombre_seccion}'`));
    assert.match(fuente, new RegExp(`const SECTION_ORDER = ${MANIFIESTO.superficie.protocolo.orden};`));
    assert.equal(PROTOCOL.length <= MANIFIESTO.superficie.protocolo.tope_caracteres, true);
    assert.equal(PROTOCOL.length <= MANIFIESTO.superficie.protocolo.presupuesto_trabajo, true,
      `fuera del presupuesto de trabajo: ${PROTOCOL.length}`);
  });
});

// ── 2 · estructura congelada ────────────────────────────────────────────────────────────────────

describe('definitions · contrato congelado', () => {
  const normalizar = (p) => {
    const salida = { type: p.type ?? null, required: p.required === true, enum: Array.isArray(p.enum) ? [...p.enum].sort() : null };
    if (p.additionalProperties !== undefined) salida.additionalProperties = p.additionalProperties;
    if (Array.isArray(p.items)) salida.items = p.items.map(normalizar);
    else if (p.items !== undefined) salida.items = normalizar(p.items);
    if (p.properties !== undefined) salida.properties = ordenado(Object.fromEntries(Object.entries(p.properties).map(([kk, vv]) => [kk, normalizar(vv)])));
    return salida;
  };

  const viva = (nombre) => {
    const t = FABRICAS[MANIFIESTO.tools[nombre].factory]({});
    const params = {};
    for (const clave of Object.keys(t.parameters ?? {}).sort()) {
      const p = t.parameters[clave] ?? {};
      params[clave] = { type: p.type ?? null, required: p.required === true, enum: Array.isArray(p.enum) ? [...p.enum].sort() : null };
    }
    return {
      name: t.name,
      params,
      arbol: ordenado(Object.fromEntries(Object.entries(t.parameters ?? {}).map(([k, v]) => [k, normalizar(v)]))),
      output: sinFunciones(sinTexto(t.output?.schema ?? {})),
    };
  };

  it('están las cuatro herramientas esperadas, con su nombre real', () => {
    const esperadas = Object.keys(MANIFIESTO.tools).sort();
    assert.deepEqual(esperadas, HERRAMIENTAS);
    for (const nombre of esperadas) assert.equal(viva(nombre).name, nombre);
  });

  it('cada herramienta conserva sus parámetros: nombre, tipo, obligatoriedad y enum', () => {
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      assert.deepEqual(viva(nombre).params, esperado.params, `${nombre}: cambió el contrato de parámetros`);
    }
  });

  it('los parámetros anidados también están congelados: objetos, listas y sus obligatorios', () => {
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      assert.deepEqual(viva(nombre).arbol, esperado.params_arbol, `${nombre}: cambió la forma anidada de los parámetros`);
    }
  });

  it('el esquema de salida no cambia: estructura, tipos y obligatoriedad', () => {
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      assert.deepEqual(viva(nombre).output, esperado.output_estructura, `${nombre}: cambió el esquema de salida`);
    }
  });

  it('el manifiesto no guarda texto: traducir no puede excusar un cambio de esquema', () => {
    // Un parámetro llamado `description` es legítimo; lo que no puede haber es una CADENA de descripción
    // congelada, porque entonces traducir obligaría a reescribir la expectativa y una traducción podría
    // tapar un cambio de estructura.
    const textos = (valor, encontrados) => {
      if (Array.isArray(valor)) valor.forEach((v) => textos(v, encontrados));
      else if (valor && typeof valor === 'object') {
        for (const [k, v] of Object.entries(valor)) {
          if (k === 'description' && typeof v === 'string') encontrados.push(v.slice(0, 40));
          else textos(v, encontrados);
        }
      }
      return encontrados;
    };
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      assert.equal(/description/i.test(JSON.stringify(Object.keys(esperado))), false, nombre);
      assert.deepEqual(textos(esperado.output_estructura, []), [], `${nombre}: la salida congelada lleva texto`);
      assert.deepEqual(textos(esperado.params_arbol, []), [], `${nombre}: los parámetros congelados llevan texto`);
    }
  });
});

// ── 3 · contrato declarado: permisos, efectos, seguridad ─────────────────────────────────────────

describe('definitions · contrato declarado (permisos, efectos, seguridad)', () => {
  it('cada herramienta declara el contrato completo, con vocabulario cerrado', () => {
    const claves = ['permisos', 'solo_lectura', 'aprueba', 'atajo_de_seguridad', 'confirmacion',
      'status_permitidos', 'efectos', 'restricciones', 'seguridad'];
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      assert.deepEqual(Object.keys(esperado.contrato).sort(), [...claves].sort(), `${nombre}: contrato incompleto`);
      const c = esperado.contrato;
      assert.equal(['lee', 'lee-red', 'escribe', 'escribe-red'].includes(c.permisos), true, `${nombre}: permisos «${c.permisos}»`);
      assert.equal(typeof c.solo_lectura, 'boolean');
      assert.equal(c.solo_lectura, !c.permisos.startsWith('escribe'), `${nombre}: permisos y solo_lectura se contradicen`);
      assert.equal(c.aprueba, false, `${nombre}: ninguna herramienta aprueba`);
      assert.equal(c.atajo_de_seguridad, false, `${nombre}: ninguna herramienta lleva atajo de seguridad`);
      assert.equal(typeof c.confirmacion, 'string');
      assert.equal(c.confirmacion.length > 10, true);
      assert.equal(Array.isArray(c.efectos) && c.efectos.length > 0, true);
      assert.equal(Array.isArray(c.restricciones) && c.restricciones.length > 0, true);
      assert.equal(Array.isArray(c.seguridad) && c.seguridad.length > 0, true);
    }
  });

  it('ningún parámetro ofrece saltarse una garantía (force, skip, bypass, override)', () => {
    const prohibido = /^(force|forzar|skip|saltar|bypass|override|ignore|quiet|silent|sin_validar|no_validate)$/i;
    const recorrer = (params, ruta, nombre) => {
      for (const [clave, p] of Object.entries(params ?? {})) {
        assert.equal(prohibido.test(clave), false, `${nombre}: el parámetro ${ruta}${clave} sería un atajo de seguridad`);
        if (p?.properties !== undefined) recorrer(p.properties, `${ruta}${clave}.`, nombre);
      }
    };
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      recorrer(FABRICAS[esperado.factory]({}).parameters, '', nombre);
    }
  });

  it('los estados que una herramienta puede devolver están declarados y dichos en su descripción', () => {
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      const permitidos = esperado.contrato.status_permitidos;
      if (permitidos.length === 0) continue;
      const t = FABRICAS[esperado.factory]({});
      const declarados = Object.keys(t.output.schema.properties);
      assert.equal(declarados.includes('status'), true, `${nombre}: declara estados y no tiene campo status`);
      const texto = t.output.schema.properties.status.description ?? '';
      for (const estado of permitidos) assert.equal(texto.includes(estado), true, `${nombre}: el estado «${estado}» no está documentado`);
    }
  });

  it('las herramientas de solo lectura NO escriben en el almacén', async () => {
    const s = sandbox();
    await skillVendor({ root: s.root, curated: s.curated, fetchImpl: fetchFalso({ [RAW]: UPSTREAM }) })
      .execute({ url: RAW, id: 'medida-desde-fuera' }, fakeExec(CWD));
    const antes = huella(s.root);
    skillReview({ root: s.root }).execute({}, fakeExec(CWD));
    await skillUpstreamCheck({ root: s.root, fetchImpl: fetchFalso({ [RAW]: UPSTREAM }) }).execute({ id: 'medida-desde-fuera' }, fakeExec(CWD));
    assert.equal(huella(s.root), antes, 'una herramienta declarada de solo lectura movió el almacén');
  });

  it('las herramientas que escriben SÍ dejan rastro en el almacén', async () => {
    const s = sandbox();
    const antes = huella(s.root);
    const propuesta = skillPropose({ root: s.root, curated: s.curated }).execute(goodInput(), fakeExec(CWD));
    assert.equal(propuesta.status, 'proposed');
    assert.notEqual(huella(s.root), antes, 'skill_propose se declara de escritura y no escribió');

    const otro = sandbox();
    const antesVendor = huella(otro.root);
    const vendorizado = await skillVendor({ root: otro.root, curated: otro.curated, fetchImpl: fetchFalso({ [RAW]: UPSTREAM }) })
      .execute({ url: RAW, id: 'medida-desde-fuera' }, fakeExec(CWD));
    assert.equal(vendorizado.status, 'proposed', JSON.stringify(vendorizado.errors));
    assert.notEqual(huella(otro.root), antesVendor, 'skill_vendor se declara de escritura y no escribió');
  });

  it('el origen peligroso sigue bloqueado: no hay parámetro ni estado que lo desactive', async () => {
    // El bloqueo es una decisión de diseño, no un fallo: el resultado es `blocked` y ninguna herramienta
    // ofrece una bandera para rodearlo.
    const s = sandbox();
    const conSecreto = `${UPSTREAM}\n\ntoken = "sk-live-abcdef0123456789"\n`;
    const result = await skillVendor({ root: s.root, curated: s.curated, fetchImpl: fetchFalso({ [RAW]: conSecreto }) })
      .execute({ url: RAW }, fakeExec(CWD));
    assert.equal(result.status, 'blocked');
    for (const nombre of Object.keys(MANIFIESTO.tools)) {
      const params = Object.keys(FABRICAS[MANIFIESTO.tools[nombre].factory]({}).parameters ?? {});
      assert.equal(params.some((p) => /force|skip|bypass|override/i.test(p)), false, `${nombre}: ofrece un atajo`);
    }
  });
});

// ── 4 · texto visible al modelo: inglés ASCII ────────────────────────────────────────────────────

describe('definitions · texto visible al modelo', () => {
  const ESPANOL = /\b(cuando|para|desde|hasta|también|tambien|nunca|siempre|archivo|ruta|guardado|propuesta|aprobada|puede|debe|sobre|entre|donde|cada|sólo|hay que)\b/i;

  it('es ASCII puro: sin acentos, sin comillas ni guiones tipográficos', () => {
    const malos = [];
    for (const [ruta, texto] of Object.entries(textosVisibles())) {
      const noAscii = texto.match(/[^\x00-\x7F]/g);
      if (noAscii !== null) malos.push(`${ruta}: ${[...new Set(noAscii)].join(' ')}`);
    }
    assert.deepEqual(malos, [], `texto visible fuera de ASCII:\n${malos.join('\n')}`);
  });

  it('está en inglés, que es el idioma canonico del modelo', () => {
    const sospechosas = [];
    for (const [ruta, texto] of Object.entries(textosVisibles())) {
      if (ESPANOL.test(texto)) sospechosas.push(ruta);
    }
    assert.deepEqual(sospechosas, [], `texto visible con prosa española:\n${sospechosas.join('\n')}`);
  });

  it('ninguna ruta que hoy lleva texto se queda sin él', () => {
    const visibles = textosVisibles();
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      for (const ruta of esperado.texto_obligatorio) {
        const clave = `${nombre}:${ruta}`;
        assert.equal(typeof visibles[clave], 'string', `${clave}: la ruta declarada no existe`);
        assert.equal(visibles[clave].trim().length > 0, true, `${clave}: quedó vacía`);
      }
    }
  });
});
