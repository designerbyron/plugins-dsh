#!/usr/bin/env node
/**
 * Contratos con el harness.
 *
 * Estas pruebas existen por dos defectos reales, y cada una cierra el suyo:
 *
 *   1. **La importación que nadie declaró.** El plugin importaba `@deepseek-ai/dsh-tools` sin
 *      declararlo, así que funcionaba en la máquina del autor por accidente y fallaba al instalarlo en
 *      un perfil: `failed to import`. La regla es simple y ahora se comprueba: **todo paquete que se
 *      importa está declarado como dependencia**.
 *   2. **La herramienta que no se podía compilar.** Las definiciones se construían solo al activarse el
 *      plugin, así que un esquema inválido se descubría instalando. Ahora se compilan aquí, con el
 *      compilador **real** del harness, que es el mismo que usa el arranque.
 *
 * Que estas pruebas puedan importar `@deepseek-ai/dsh-tools` es, en sí, la prueba de que la dependencia
 * está bien declarada: en el repositorio se resuelve desde `node_modules`.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { defineTool } from '@deepseek-ai/dsh-tools';

import { skillImprove, skillPropose, skillReview, skillUpstreamCheck, skillVendor } from '../lib/definitions.mjs';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));

/** Fuentes que se ejecutan en el Host. `client.js` queda fuera a propósito: es un artefacto de
 *  navegador y sus importaciones vienen de la tabla de módulos del navegador, no de `node_modules`. */
function hostSources(dir = PACKAGE_ROOT, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (join(PACKAGE_ROOT, 'tests') === full) continue;
      hostSources(full, found);
    } else if (/\.(mjs|js)$/.test(entry.name) && entry.name !== 'client.js') {
      found.push(full);
    }
  }
  return found;
}

describe('contratos con el harness', () => {
  it('las cinco herramientas compilan con el compilador REAL del harness', () => {
    const root = join(PACKAGE_ROOT, 'tmp-de-prueba');
    const definitions = {
      skill_propose: skillPropose({ root, curated: [] }),
      skill_vendor: skillVendor({ root }),
      skill_review: skillReview({ root }),
      skill_upstream_check: skillUpstreamCheck({ root }),
      skill_improve: skillImprove({ root }),
    };
    for (const [name, definition] of Object.entries(definitions)) {
      // Si un esquema no es válido, `defineTool` lanza JsonSchemaError. Es exactamente lo que hacía el
      // arranque del plugin, y por eso se comprueba aquí y no al instalar.
      const tool = defineTool(definition);
      assert.equal(tool.name, name);
      assert.equal(typeof tool.execute, 'function');
    }
  });

  it('el modelo ve los parámetros que el plugin declara, y los obligatorios son obligatorios', () => {
    const tool = defineTool(skillPropose({ root: 'x', curated: [] }));
    const properties = tool.parameters.properties;
    for (const key of ['id', 'description', 'body', 'whenToUse', 'evidence', 'tags', 'references']) {
      assert.equal(key in properties, true, `falta el parámetro ${key}`);
    }
    // Los obligatorios son los que la puerta de calidad no puede dejar pasar vacíos: `whenToUse` entró
    // aquí en la v2.0.0 porque es el campo con el que el harness decide cuándo aparece una skill, y una
    // skill sin él no se selecciona. Si la herramienta no lo marcara obligatorio, el modelo no lo
    // enviaría y la puerta rechazaría cada propuesta: contrato y puerta dicen lo mismo o no sirven.
    assert.deepEqual([...tool.parameters.required].sort(), ['body', 'description', 'id', 'whenToUse']);
    // Y el material pesado se declara con su forma: `path` y `content`, sin campos libres.
    const items = properties.references.items;
    assert.equal(items.type, 'object');
    assert.deepEqual(Object.keys(items.properties).sort(), ['content', 'path']);
    assert.deepEqual([...items.required].sort(), ['content', 'path'], 'sin `path` y `content` el material no se puede escribir');
  });

  it('todo paquete que se importa está declarado como dependencia', () => {
    // La regla que faltaba. Un `import` de un paquete no declarado funciona en la máquina donde está
    // suelto y falla en cuanto el plugin se instala en un perfil.
    //
    // Los patrones son de sentencia, no de palabra suelta: una lista de palabras vacías que contenga
    // `'from'` no es una importación, y confundirlas convertiría esta puerta en ruido.
    const STATEMENTS = [
      /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm, // import x from 'a' · import 'a'
      /^\s*export\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/gm,      // export { x } from 'a'
      /\brequire\s*\(\s*['"]([^'"]+)['"]/g,                    // require('a')
      /\bimport\s*\(\s*['"]([^'"]+)['"]/g,                     // import('a')
    ];
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));
    const undeclared = [];
    for (const file of hostSources()) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of STATEMENTS) {
        for (const match of source.matchAll(pattern)) {
          const specifier = match[1];
          if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
          const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
          if (!declared.has(name)) undeclared.push(`${file.slice(PACKAGE_ROOT.length + 1)} → ${name}`);
        }
      }
    }
    assert.deepEqual(undeclared, [], 'importaciones sin declarar: se instalarían y fallarían al activarse');
  });

  it('el cierre declarado es coherente: la familia dsh comparte una sola versión', () => {
    // Un cierre a medio actualizar es peor que uno viejo: mezcla dos versiones del mismo runtime.
    const versions = new Map();
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      if (!name.startsWith('@deepseek-ai/dsh-')) continue;
      versions.set(version, [...(versions.get(version) ?? []), name]);
    }
    assert.equal(versions.size, 1, `la familia dsh-* tiene versiones distintas: ${JSON.stringify([...versions.keys()])}`);
  });

  it('el cierre declarado está realmente instalado', () => {
    // No se comprueba «el fichero existe» sino que se puede cargar: es lo que hará el plugin.
    for (const name of Object.keys(manifest.dependencies)) {
      const dir = join(PACKAGE_ROOT, 'node_modules', name);
      assert.equal(statSync(dir).isDirectory(), true, `${name} no está instalado: falta «npm install»`);
    }
  });
});
