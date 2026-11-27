/**
 * Corrección Fase C/UX: idioma del Host, accesibilidad del panel y slot vivo del handoff.
 *
 * Defecto observado en la instancia aislada: `@deepseek-ai/dsh-client-locale` expone
 * `getSnapshot().active` y `getLocale()` devuelve el propio objeto. `readLanguage()` leía
 * `locale/lang/id/name`, convertía el objeto en la cadena `[object Object]` y caía a `es`.
 * Aquí se fija el contrato real, el cambio sin recargar, la persistencia entre remontajes y
 * las reglas de contraste/foco que se midieron en la interfaz.
 *
 * Todo corre en cajas de arena: ni un fetch real, ni `~/.dsh/`, ni la instalación del Host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientSource, createPanelHarness, textOf } from './r17-ui-runtime.mjs';

/** Servidor de locale con la forma del Host y una suscripción que se puede disparar. */
function hostLocale(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    getLocale: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
    subscriberCount: () => listeners.size,
  };
}

async function openRequests(harness) {
  await harness.mount();
  const nav = harness.nodes((node) => node.type === 'button'
    && String(node.props.className ?? '').includes('lsc-rail-item')
    && /Requests|Solicitudes/.test(textOf(node)))[0];
  assert.ok(nav, 'la navegación al Request Center existe en ambos idiomas');
  await harness.click(nav);
  return harness;
}

function railLabels(harness) {
  return harness.nodes((node) => node.type === 'button'
    && String(node.props.className ?? '').includes('lsc-rail-item'))
    .map((node) => textOf(node).trim());
}

function dispose(harness) {
  harness.unmount();
}

/* ───────────────────────────────── idioma ───────────────────────────────── */

test('I1: el contrato real del Host se lee en inglés sin convertir el snapshot en cadena', async () => {
  const service = hostLocale({ active: 'en' });
  const harness = await openRequests(createPanelHarness({ localeService: service }));
  assert.match(harness.text(), /Request Center/);
  assert.doesNotMatch(harness.text(), /Centro de solicitudes/);
  assert.ok(railLabels(harness).includes('Requests'), 'la barra lateral cambia con el locale del Host');
  assert.equal(service.subscriberCount(), 1, 'el panel se suscribe al servicio de idioma');
  dispose(harness);
});

test('I2: el idioma cambia en caliente, sin recargar ni reiniciar el panel', async () => {
  const service = hostLocale({ active: 'es' });
  const harness = await openRequests(createPanelHarness({ localeService: service }));
  assert.match(harness.text(), /Centro de solicitudes/);

  service.set({ active: 'en' });
  await harness.settle();
  assert.match(harness.text(), /Request Center/);
  assert.doesNotMatch(harness.text(), /Centro de solicitudes/);
  assert.ok(railLabels(harness).includes('Requests'));

  service.set({ active: 'es' });
  await harness.settle();
  assert.match(harness.text(), /Centro de solicitudes/);
  assert.doesNotMatch(harness.text(), /Request Center/);
  assert.ok(railLabels(harness).includes('Solicitudes'));
  dispose(harness);
});

test('I3: el idioma persiste entre recarga y reinicio del panel', async () => {
  // La caché del Host guarda una cadena (`en`/`es`); el servicio vivo entrega un objeto.
  for (const cached of ['en', 'es', 'en']) {
    const service = hostLocale({ active: cached });
    for (let boot = 0; boot < 2; boot += 1) {
      const harness = await openRequests(createPanelHarness({ localeService: service }));
      const marker = cached === 'en' ? /Request Center/ : /Centro de solicitudes/;
      const other = cached === 'en' ? /Centro de solicitudes/ : /Request Center/;
      assert.match(harness.text(), marker, `tras arrancar ${boot + 1} con caché ${cached}`);
      assert.doesNotMatch(harness.text(), other);
      dispose(harness);
    }
  }
});

test('I4: se conservan los formatos antiguos y un snapshot sin idioma cae a español', async () => {
  const cases = [
    [{ active: 'en-US' }, 'Requests'],
    [{ locale: 'en' }, 'Requests'],
    [{ lang: 'es-ES' }, 'Solicitudes'],
    ['en', 'Requests'],
    [{ name: 'unknown', id: 7 }, 'Solicitudes'],
    [null, 'Solicitudes'],
  ];
  for (const [value, expected] of cases) {
    const harness = await openRequests(createPanelHarness({ localeService: hostLocale(value) }));
    assert.ok(railLabels(harness).includes(expected), `formato ${JSON.stringify(value)} → ${expected}`);
    dispose(harness);
  }
});

test('I5: el probe de sesión se registra en el slot vivo y en el legacy, sin perder ninguno', () => {
  // Medido en la instancia aislada: `...header.actions` nunca montó el probe; `...header.utilities`
  // entregó `sessionId` en cuanto la conversación dejó la fase hero. Se mantienen ambos para no
  // romper arneses y versiones que sí renderizan el slot antiguo.
  const declaration = /const SESSION_PROBE_SLOTS = \[([^\]]+)\];/.exec(clientSource);
  assert.ok(declaration, 'debe existir la lista de slots del probe');
  assert.match(declaration[1], /'conversation\.session\.header\.actions'/);
  assert.match(declaration[1], /'conversation\.session\.header\.utilities'/);
  assert.match(clientSource, /for \(const slot of SESSION_PROBE_SLOTS\)/);
});

/* ───────────────────────────── accesibilidad ───────────────────────────── */

function hexToRgb(value) {
  const hex = value.replace('#', '');
  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(rgb) {
  const channels = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const first = luminance(hexToRgb(a));
  const second = luminance(hexToRgb(b));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Mezcla un `rgba(...)` translúcido sobre fondo claro, como hace el tema del Host. */
function overLight(rgba, background = '#ffffff') {
  const parts = rgba.match(/[\d.]+/g).map(Number);
  const alpha = parts[3] ?? 1;
  const base = hexToRgb(background);
  return `#${parts.slice(0, 3).map((value, index) => Math.round(value * alpha + base[index] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
}

test('A1: el acento del botón primario y del foco cumple 4.5:1 sobre texto y 3:1 alrededor', () => {
  const accents = [...clientSource.matchAll(/--lsc-accent:\s*(#[0-9a-f]{6})/gi)].map((match) => match[1].toLowerCase());
  assert.ok(accents.length >= 2, 'el panel y el overlay declaran su acento');
  for (const accent of accents) {
    assert.ok(contrast('#ffffff', accent) >= 4.5, `${accent}: blanco sobre acento < 4.5:1`);
    assert.ok(contrast(accent, '#ffffff') >= 3, `${accent}: foco sobre tema claro < 3:1`);
  }
  const soft = /--lsc-accent-soft:\s*rgba\(([^)]+)\)/i.exec(clientSource);
  assert.ok(soft, 'debe existir el fondo suave del acento');
  const tint = overLight(`rgba(${soft[1]})`);
  assert.ok(contrast(accents[0], tint) >= 4.5, `texto sobre acento suave ${tint} < 4.5:1`);
});

test('A2: los estados y avisos usan color de primer plano legible, nunca el color puro como texto', () => {
  for (const selector of [
    '.lsc-rail-item.active', '.lsc-req-id', '.lsc-context-match', '.lsc-context-diff',
    '.lsc-pill.ok', '.lsc-pill.warn', '.lsc-pill.bad', '.lsc-pill.info',
    '.lsc-btn.danger', '.lsc-tone-bad', '.lsc-tone-warn',
  ]) {
    const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(clientSource);
    assert.ok(rule, `falta la regla ${selector}`);
    assert.match(rule[1], /color:\s*var\(--lsc-fg\)/, `${selector} no usa el color legible del tema`);
  }
  assert.match(clientSource, /--lsc-fg:\s*var\(--dsw-alias-label-primary,\s*#e8ecf5\)/);
  assert.doesNotMatch(clientSource, /style:\s*\{\s*color:\s*'var\(--lsc-(?:bad|warn)\)'\s*\}/,
    'ningún aviso pone el color de estado como texto');
});

test('A3: todos los controles interactivos del panel tienen :focus-visible', () => {
  for (const selector of [
    '.lsc-btn', '.lsc-chip', '.lsc-tab', '.lsc-rail-item',
    '.lsc-input', '.lsc-select', '.lsc-project-picker select',
    '.lsc-activity-filter', '.lsc-activity-row-main', '.lsc-toast-close',
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(`${escaped}:focus-visible[^{}]*\\{([^}]*)\\}`).exec(clientSource);
    assert.ok(rule, `falta :focus-visible para ${selector}`);
    assert.match(rule[1], /outline:\s*2px solid var\(--lsc-accent\)/, `${selector} no dibuja un foco visible`);
  }
});

test('A4: los contenedores medidos en 768 y 390 px no desbordan su celda', () => {
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(clientSource);
    assert.ok(match, `falta la regla ${selector}`);
    return match[1];
  };
  assert.match(rule('.lsc-project-picker'), /min-width:\s*0/);
  assert.match(rule('.lsc-project-picker'), /overflow:\s*hidden/);
  assert.match(rule('.lsc-activity-cluster'), /min-width:\s*0/);
  assert.match(rule('.lsc-activity-cluster'), /overflow:\s*hidden/);
  assert.match(rule('.lsc-activity-indicator'), /min-width:\s*0/);
});
