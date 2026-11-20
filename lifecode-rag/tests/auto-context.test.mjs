/**
 * PA6 — contexto recuperado antes de responder.
 *
 * Se prueba lo que decide (texto, formato, dedupe, filtros) y lo que toca el almacén (una recuperación
 * real sobre un perfil temporal, con la misma ruta de autorización que las herramientas).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTO_CONTEXT_HEADER,
  AUTO_CONTEXT_SOURCE,
  collectContext,
  contextMessage,
  createAutoContext,
  isHumanPrompt,
  queryFromMessages,
  renderContext,
  stripSystemReminders,
} from '../lib/auto-context.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { makeEightWorld, servicesFor } from './pa4-helpers.mjs';

function human(text) {
  return { id: 'm1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } };
}

function enabled(extra = {}) {
  return validateConfig({ autoContext: { enabled: true, maxChars: 800, maxChunks: 3, budgetTokens: 400, ...extra } });
}

test('autoContext está desactivado por defecto y el validador rechaza claves y rangos', () => {
  const config = validateConfig({});
  assert.equal(config.autoContext.enabled, false);
  assert.equal(config.autoContext.maxChars, 1_600);
  assert.throws(() => validateConfig({ autoContext: { desconocida: 1 } }), /desconocida/);
  assert.throws(() => validateConfig({ autoContext: { budgetTokens: 99_999 } }), /budgetTokens/);
});

test('los recordatorios de sistema no entran en la consulta', () => {
  const raw = '<system-reminder>nada útil</system-reminder> ¿dónde está el contrato de datos?';
  assert.equal(stripSystemReminders(raw), '¿dónde está el contrato de datos?');
});

test('sólo un prompt humano cuenta: ni herramientas ni nuestro propio mensaje', () => {
  assert.equal(isHumanPrompt(human('una pregunta de verdad')), true);
  assert.equal(isHumanPrompt({ ...human('texto de herramienta'), source: { kind: 'tool' } }), false);
  assert.equal(isHumanPrompt({ ...human('resultado'), role: 'assistant' }), false);
  assert.equal(isHumanPrompt({ ...human('corto'), content: [{ type: 'text', text: 'corto' }] }), false);
  assert.equal(isHumanPrompt(contextMessage(`${AUTO_CONTEXT_HEADER}\n\nalgo`)), false);
});

test('la consulta es el último prompt humano del lote', () => {
  const messages = [human('primera pregunta'), { ...human('segunda pregunta'), id: 'm2' }];
  assert.equal(queryFromMessages(messages), 'segunda pregunta');
  assert.equal(queryFromMessages([{ ...human('x'), source: { kind: 'tool' } }]), '');
});

test('el bloque inyectado lleva cabecera, proyecto y citas, y respeta el tope', () => {
  const text = 'fragmento '.repeat(200);
  const rendered = renderContext({
    projectName: 'Proyecto A',
    scopes: [{ id: 'lib_1', name: 'Biblioteca 1' }],
    citations: [{ title: 'doc.md', uri: 'doc.md' }],
    text,
    maxChars: 300,
  });
  assert.ok(rendered.startsWith(AUTO_CONTEXT_HEADER));
  assert.match(rendered, /Proyecto: Proyecto A · bibliotecas: Biblioteca 1/);
  assert.match(rendered, /Citas: 1\. doc\.md/);
  assert.ok(rendered.length <= 300, `cabecera + texto + citas deben caber: ${rendered.length}`);
  assert.equal(renderContext({ text: '' }), '');
});

test('el mensaje del host es un UserMessage válido sin depender de @deepseek-ai', () => {
  const message = contextMessage('hola');
  assert.equal(message.role, 'user');
  assert.equal(message.content[0].type, 'text');
  assert.equal(message.source.kind, AUTO_CONTEXT_SOURCE.kind);
  assert.match(message.id, /^[0-9a-f-]{36}$/);
});

test('desactivado no recupera nada', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const collector = createAutoContext({ services: servicesFor(world), config: validateConfig({}) });
    const message = await collector.messageFor(
      { agent: { id: 'sesion-a' }, turn: 1, step: 1 },
      [human('¿qué dice kappaproyecto?')],
    );
    assert.equal(message, null);
  } finally {
    world.cleanup();
  }
});

test('un turno real recupera el contexto del proyecto autorizado', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const collector = createAutoContext({
      services: servicesFor(world),
      config: enabled(),
      logger: { debug() {}, warn() {} },
    });
    const payload = { agent: { id: 'sesion-a' }, turn: 1, step: 1 };
    const message = await collector.messageFor(payload, [human('kappaproyecto')]);
    assert.ok(message, 'debe inyectar el contenido indexado del proyecto A');
    assert.match(message.content[0].text, /kappaproyecto/);
    assert.match(message.content[0].text, new RegExp(AUTO_CONTEXT_HEADER.replace(/[[\]]/g, '\\$&')));
    // Dedupe: el mismo turno y la misma consulta no se inyectan dos veces.
    assert.equal(await collector.messageFor(payload, [human('kappaproyecto')]), null);
    // Otro turno sí vuelve a inyectar.
    assert.ok(await collector.messageFor({ ...payload, turn: 2 }, [human('kappaproyecto')]));
  } finally {
    world.cleanup();
  }
});

test('pasos posteriores y sesiones sin resolución no inyectan nada', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const fuera = join(world.base, 'fuera-de-toda-raiz');
    mkdirSync(fuera, { recursive: true });
    const collector = createAutoContext({
      services: servicesFor(world, { sessionId: 'sesion-sin-registro', cwd: fuera }),
      config: enabled(),
      logger: { debug() {}, warn() {} },
    });
    // Un paso posterior nunca inyecta: el contexto es del turno, no de cada paso.
    assert.equal(await collector.messageFor({ agent: { id: 'sesion-a' }, turn: 1, step: 2 }, [human('kappaproyecto')]), null);
    // Sesión sin selección y con un cwd que no cae en ninguna raíz: nada que recuperar.
    assert.equal(
      await collector.messageFor({ agent: { id: 'sesion-sin-registro' }, turn: 1, step: 1 }, [human('kappaproyecto')]),
      null,
    );
  } finally {
    world.cleanup();
  }
});

test('una señal abortada no recupera contexto', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const controller = new AbortController();
    controller.abort();
    const collector = createAutoContext({ services: servicesFor(world), config: enabled(), logger: { debug() {} } });
    const message = await collector.messageFor(
      { agent: { id: 'sesion-a' }, turn: 1, step: 1, signal: controller.signal },
      [human('kappaproyecto')],
    );
    assert.equal(message, null);
  } finally {
    world.cleanup();
  }
});

test('collectContext es fail-closed: sin resolución lanza y el hook lo ignora', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const fuera = join(world.base, 'fuera-de-toda-raiz');
    mkdirSync(fuera, { recursive: true });
    const services = servicesFor(world, { sessionId: 'sesion-x', cwd: fuera });
    const config = enabled();
    await assert.rejects(
      collectContext({ services, agent: { id: 'sesion-x' }, query: 'kappaproyecto', config }),
      (error) => error.code === 'scope-unresolved',
    );
  } finally {
    world.cleanup();
  }
});

test('sin aprobación no hay egreso: con proveedor remoto el hook recupera sólo por léxico', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const config = validateConfig({
      embedding: {
        provider: 'remote',
        remote: { endpoint: 'https://example.invalid/embed', model: 'text-embedding-test' },
      },
      autoContext: { enabled: true, maxChars: 800, maxChunks: 3, budgetTokens: 400 },
    });
    // Sin endpoint válido, crear el embedder remoto fallaría o enviaría la consulta a un tercero:
    // el hook debe ignorarlo y seguir con FTS.
    let fetched = 0;
    const services = { ...servicesFor(world), fetch: () => { fetched += 1; throw new Error('no debe egresar'); } };
    const collector = createAutoContext({ services, config, logger: { debug() {}, warn() {} } });
    const message = await collector.messageFor({ agent: { id: 'sesion-a' }, turn: 1, step: 1 }, [human('kappaproyecto')]);
    assert.ok(message, 'el contexto léxico sigue disponible');
    assert.equal(fetched, 0, 'el hook automático no puede enviar texto a un proveedor remoto');
  } finally {
    world.cleanup();
  }
});

test('un prompt de sólo stopwords no abre la puerta léxica', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const collector = createAutoContext({
      services: servicesFor(world), config: enabled(), logger: { debug() {}, warn() {} },
    });
    assert.equal(await collector.messageFor({ agent: { id: 'sesion-a' }, turn: 1, step: 1 }, [human('¿y la de el que con?')]), null);
  } finally {
    world.cleanup();
  }
});

test('el hook respeta el presupuesto: no bloquea el turno aunque el servicio no responda', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const services = {
      ...servicesFor(world),
      // Un servicio que nunca resuelve: sin presupuesto, el pre-step colgaría el turno.
      workingDirectory: { ensure: () => new Promise(() => {}) },
    };
    const collector = createAutoContext({
      services,
      config: enabled({ timeoutMs: 150 }),
      logger: { debug() {}, warn() {} },
    });
    const started = Date.now();
    const message = await collector.messageFor({ agent: { id: 'sesion-a' }, turn: 1, step: 1 }, [human('kappaproyecto')]);
    const elapsed = Date.now() - started;
    assert.equal(message, null);
    assert.ok(elapsed < 1_500, `presupuesto respetado (${elapsed} ms)`);
  } finally {
    world.cleanup();
  }
});
