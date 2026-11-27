/**
 * Fase I, interfaz: sección «Solicitud de origen» en el panel del importador vendor.
 *
 * Se ejecuta sobre el client.js real con el arnés de React mínimo del repositorio: sin stores reales,
 * sin harness y sin instalar nada. Comprueba el texto histórico intacto, la confirmación previa, que
 * el cliente envía un cuerpo vacío (sin requestId/operationId/rol) y el estado «vinculada» posterior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createPanelHarness, defaultSnapshot, jsonResponse, textOf } from './r17-ui-runtime.mjs';

const REQUEST = {
  id: 'req-562393e0835f',
  text: 'vendoriza la skill desde https://github.com/netresearch/context7-skill',
  status: 'pending',
};
const LINK = {
  requestId: REQUEST.id,
  operationId: 'lsc-vendor-7264340c-0859-451b-8bd1-8ed558ac82d6',
  linkedAt: '2026-11-26T23:10:00.000Z',
  by: 'LifeCode Library Maintainer',
  channel: 'browser',
};

function vendorPayload(link) {
  return {
    ok: true,
    vendor: {
      skillId: 'context7', importState: 'disabled', maintainerEnrolled: true,
      repository: 'https://github.com/netresearch/context7-skill', tag: 'v1.7.3',
      commit: '01d2f069127eeeaf0a02efe8e1429e0bddc57669',
      manifestSha256: '5cd772fcd877d40ebf54fa2ef06cf4095c9a08158642acd0aeadd8fb0a20ab2c',
      signatureVerification: 'verified', licensePolicy: 'internal-use-only',
      ambiguousLicense: true, validation: { ok: true, code: 'V12', failures: [] },
      files: [], sourceRequest: { ...REQUEST }, requestLink: link,
      importOperationId: 'lsc-vendor-7264340c-0859-451b-8bd1-8ed558ac82d6',
      importVersion: '1.0.0',
    },
  };
}

async function vendorPanel({ link = null, locale = 'es' } = {}) {
  let linked = link;
  const actions = [];
  const harness = createPanelHarness({
    locale,
    snapshot: defaultSnapshot(),
    responder: (call) => {
      if (call.method === 'POST' && call.url.includes('/api/state')) {
        let body = {};
        try { body = JSON.parse(call.body ?? '{}'); } catch { body = {}; }
        if (body.action === 'vendor-review') return jsonResponse(200, vendorPayload(linked));
        if (body.action === 'vendor-link-request') {
          actions.push(body);
          linked = { ...LINK };
          return jsonResponse(200, { ok: true, replayed: false, link: linked });
        }
      }
      return null;
    },
  });
  await harness.mount();
  const label = locale === 'en' ? 'Vendor' : 'Proveedor';
  const nav = harness.nodes((node) => node.type === 'button'
    && String(node.props.className ?? '').includes('lsc-rail-item')
    && textOf(node).includes(label))[0];
  assert.ok(nav, `la navegación a ${label} existe`);
  await harness.click(nav);
  await harness.settle();
  return { harness, actions };
}

test('I-UI-1 · muestra el ID/texto históricos y la acción antes de vincular', async () => {
  const { harness } = await vendorPanel();
  const body = harness.text();
  assert.match(body, /Solicitud de origen/);
  assert.match(body, /req-562393e0835f/);
  assert.match(body, /vendoriza la skill desde https:\/\/github\.com\/netresearch\/context7-skill/);
  assert.match(body, /Operación original: lsc-vendor-7264340c-0859-451b-8bd1-8ed558ac82d6/);
  assert.match(body, /Manifest SHA-256: 5cd772fc/);
  assert.ok(harness.button('Vincular solicitud histórica'), 'la acción humana existe');
  harness.unmount();
});

test('I-UI-2 · confirma y envía un cuerpo vacío, sin identificadores ni rol', async () => {
  const { harness, actions } = await vendorPanel();
  await harness.click(harness.button('Vincular solicitud histórica'));
  assert.match(harness.text(), /Confirmar vínculo/);
  assert.match(harness.text(), /El estado original se conserva/);
  await harness.click(harness.button('Confirmar vínculo'));
  await harness.settle();
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'vendor-link-request');
  assert.deepEqual(actions[0].payload, {}, 'el cuerpo no aporta datos de autoridad');
  for (const forbidden of ['requestId', 'operationId', 'actor', 'role', 'confirmed', 'by', 'channel']) {
    assert.equal(Object.hasOwn(actions[0].payload, forbidden), false, `el cliente no envía ${forbidden}`);
  }
  assert.match(harness.text(), /Solicitud vinculada/);
  assert.match(harness.text(), /Estado histórico: pending · Relación: linked/);
  assert.doesNotMatch(harness.text(), /Vincular solicitud histórica/, 'no ofrece vincular de nuevo');
  harness.unmount();
});

test('I-UI-3 · después del vínculo no presenta la petición como importación pendiente', async () => {
  const { harness } = await vendorPanel({ link: { ...LINK } });
  const body = harness.text();
  assert.match(body, /Solicitud vinculada/);
  assert.match(body, /Vinculada el 2026-11-26T23:10:00\.000Z por LifeCode Library Maintainer/);
  assert.equal(harness.button('Vincular solicitud histórica'), undefined);
  harness.unmount();
});

test('I-UI-4 · en inglés, con el mismo contrato y sin tools del modelo', async () => {
  const { harness } = await vendorPanel({ locale: 'en' });
  assert.match(harness.text(), /Source request/);
  assert.ok(harness.button('Link historical request'), 'la acción existe en inglés');
  harness.unmount();
});
