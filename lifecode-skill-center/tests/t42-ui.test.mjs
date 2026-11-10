import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityFixture,
  createHostHarness,
  toolCall,
  toolResult,
  walk,
} from './t42-ui-runtime.mjs';

async function connected(sessionId = 's-1') {
  const harness = createHostHarness();
  harness.mountProbe(sessionId);
  await harness.settle();
  harness.mountOverlay();
  await harness.settle();
  return harness;
}

function buttons(harness) {
  const found = [];
  walk(harness.runtime.state.tree, (node) => {
    if (node.type === 'button') found.push(node);
  });
  return found;
}

test('un tool/result de LifeCode con activity persistida crea un aviso global', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-1', 'lifecode_skill_create'),
    toolResult('call-1', activityFixture()),
  ]);
  await harness.settle();

  assert.equal(harness.toasts().length, 1);
  assert.match(harness.text(), /Skill «Demo» creada/);
  assert.equal(harness.sessionSubscribers('s-1'), 1);
  assert.equal(harness.intervals.length, 0);
  harness.dispose();
});

test('sin persisted no hay aviso: el resultado del tool no basta', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-2', 'lifecode_skill_create'),
    toolResult('call-2', activityFixture({ eventId: 'evt-2', persisted: false })),
  ]);
  await harness.settle();

  assert.equal(harness.toasts().length, 0);
  assert.doesNotMatch(harness.text(), /creada/);
  harness.dispose();
});

test('el mismo eventId no se duplica aunque lleguen dos resultados', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-3', 'lifecode_skill_create'),
    toolResult('call-3', activityFixture({ eventId: 'evt-same' })),
    toolCall('call-4', 'lifecode_skill_create'),
    toolResult('call-4', activityFixture({ eventId: 'evt-same' })),
  ]);
  await harness.settle();

  assert.equal(harness.toasts().length, 1);
  harness.dispose();
});

test('dos eventos distintos producen dos avisos y nunca más de tres', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-5', 'lifecode_skill_create'),
    toolResult('call-5', activityFixture({ eventId: 'evt-a', titleVars: { skill: 'Alpha' } })),
    toolCall('call-6', 'lifecode_skill_improve'),
    toolResult('call-6', activityFixture({
      eventId: 'evt-b',
      titleKey: 'activity.title.improvement-prepared',
      titleVars: { skill: 'Beta' },
      severity: 'info',
    })),
  ]);
  await harness.settle();
  assert.equal(harness.toasts().length, 2);

  harness.emit('s-1', [
    toolCall('call-7', 'lifecode_skill_create'),
    toolResult('call-7', activityFixture({ eventId: 'evt-c', titleVars: { skill: 'Gamma' } })),
    toolCall('call-8', 'lifecode_skill_create'),
    toolResult('call-8', activityFixture({ eventId: 'evt-d', titleVars: { skill: 'Delta' } })),
  ]);
  await harness.settle();

  assert.equal(harness.toasts().length, 3);
  const visible = harness.text();
  assert.match(visible, /Delta/);
  assert.doesNotMatch(visible, /Alpha/);
  harness.dispose();
});

test('el overlay se monta sin panel: la pila es global, no del panel', async () => {
  const harness = createHostHarness();
  harness.mountProbe('s-only');
  await harness.settle();
  // Sin montar el panel (su slot `main` nunca se resuelve), sólo el overlay:
  harness.mountOverlay();
  await harness.settle();
  harness.emit('s-only', [
    toolCall('call-9', 'lifecode_skill_create'),
    toolResult('call-9', activityFixture({ eventId: 'evt-only' })),
  ]);
  await harness.settle();

  assert.equal(harness.toasts().length, 1);
  assert.equal(harness.registrations.filter((item) => item.name === 'shell.overlay').length, 1);
  harness.dispose();
});

test('dispose libera la suscripción al stream y deja de escuchar', async () => {
  const harness = await connected();
  assert.equal(harness.sessionSubscribers('s-1'), 1);

  harness.dispose();
  assert.equal(harness.sessionSubscribers('s-1'), 0);
  assert.doesNotThrow(() => {
    harness.emit('s-1', [
      toolCall('call-10', 'lifecode_skill_create'),
      toolResult('call-10', activityFixture({ eventId: 'evt-after-dispose' })),
    ]);
  });
});

test('el puente no crea intervalos ni polling', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-11', 'lifecode_skill_create'),
    toolResult('call-11', activityFixture({ eventId: 'evt-no-poll' })),
  ]);
  await harness.settle();
  await harness.settle();

  assert.deepEqual(harness.intervals, []);
  harness.dispose();
});

test('un tool que no es de LifeCode no produce aviso aunque traiga activity', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-12', 'skill_compiler_doctor'),
    toolResult('call-12', activityFixture({ eventId: 'evt-other' })),
  ]);
  await harness.settle();

  assert.equal(harness.toasts().length, 0);
  harness.dispose();
});

test('un resultado replayed no vuelve a avisar', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-13', 'lifecode_skill_create'),
    toolResult('call-13', activityFixture({ eventId: 'evt-replay' }), { replayed: true }),
  ]);
  await harness.settle();

  assert.equal(harness.toasts().length, 0);
  harness.dispose();
});

test('la activity también se acepta desde presentationMeta (ruta defensiva)', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-14', 'lifecode_skill_create'),
    toolResult('call-14', activityFixture({ eventId: 'evt-meta' }), { meta: true, jsonContent: false }),
  ]);
  await harness.settle();

  assert.equal(harness.toasts().length, 1);
  harness.dispose();
});

test('el aviso ofrece «Ver Skill» y cierra con su botón', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-15', 'lifecode_skill_create'),
    toolResult('call-15', activityFixture({ eventId: 'evt-actions' })),
  ]);
  await harness.settle();

  const labels = buttons(harness).map((node) => (node.props?.children ?? '').toString());
  assert.ok(labels.some((label) => label.includes('Ver Skill')), `botones: ${labels.join(', ')}`);
  const close = buttons(harness).find((node) => node.props?.title === 'Cerrar aviso');
  assert.ok(close !== undefined);
  close.props.onClick();
  await harness.settle();
  assert.equal(harness.toasts().length, 0);
  harness.dispose();
});

test('un aviso del stream no sella la lectura: la marca la pone abrir el historial', async () => {
  const harness = await connected();
  harness.emit('s-1', [
    toolCall('call-16', 'lifecode_skill_create'),
    toolResult('call-16', activityFixture({ eventId: 'evt-seen', at: '2026-11-09T20:15:00.000Z' })),
  ]);
  await harness.settle();

  // T45.4-C, R2: la llegada de un aviso no es una lectura. Antes se escribía aquí la marca y eso
  // apagaba el indicador de no leídas justo cuando debía encenderse (defecto C8 de T45.4-B).
  // La marca la pone abrir el cajón de actividad (cubierto en t45.4c-unread-indicator.test.mjs).
  assert.equal(harness.storage.get('lifecode-skill-center/activity-seen'), undefined,
    'recibir un aviso no debe marcar el evento como leído');
  harness.dispose();
});
