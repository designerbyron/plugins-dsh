/**
 * Fase I — vínculo histórico entre una solicitud y una importación vendor.
 *
 * Dominio puro: no toca disco ni el harness. Sólo muta el estado que recibe, y debe llamarse dentro de
 * `withState` (candado, copia verificada y escritura atómica). La relación vive en `state.requestLinks`,
 * nunca en la solicitud: `req-562393e0835f` conserva byte por byte su contenido semántico y su
 * `status='pending'`.
 *
 * Todo identificador autorizado se fija aquí, en backend. El cuerpo HTTP no aporta `requestId`,
 * `operationId`, `actor`, `role` ni metadatos de procedencia: si los trae, se ignoran. El vínculo es
 * inmutable tras crearse; un reintento idéntico devuelve el existente y una relación distinta se
 * rechaza con `request-link-conflict`. La única corrección es una operación administrativa auditada
 * (`revertRequestLink`) que no revierte la importación de Context7.
 */

import {
  VENDOR_CANDIDATE_ID, VENDOR_COMMIT, VENDOR_MANIFEST_SHA256, VENDOR_REPOSITORY,
  VENDOR_SKILL_ID, VENDOR_TAG,
} from './vendor.mjs';
import { appendEvent, functionalSignature, operationOf, recordOperation } from './state.mjs';

/** Identificadores autorizados por la decisión humana de Fase I. */
export const VENDOR_LINK_REQUEST_ID = 'req-562393e0835f';
export const VENDOR_LINK_REQUEST_TEXT = `vendoriza la skill desde ${VENDOR_REPOSITORY}`;
export const VENDOR_LINK_OPERATION_ID = 'lsc-vendor-7264340c-0859-451b-8bd1-8ed558ac82d6';
export const VENDOR_LINK_SKILL_VERSION = '1.0.0';
export const VENDOR_LINK_ROLE = 'LifeCode Library Maintainer';
export const VENDOR_LINK_CHANNEL = 'browser';
export const VENDOR_LINK_KIND = 'vendor-import';

export const REQUEST_LINK_EVENT_TYPES = Object.freeze(['skill.request-linked', 'skill.request-link-reverted']);

function text(value) {
  return typeof value === 'string' ? value : '';
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Los campos funcionales del vínculo, sin el sello de tiempo: definen la identidad del enlace. */
function linkIdentity(link) {
  if (!object(link)) return '';
  return JSON.stringify([
    text(link.requestId), text(link.operationId), text(link.kind), text(link.skillId),
    text(link.version), text(link.candidateId), text(link.manifestSha256),
    text(link.by), text(link.channel),
  ]);
}

/** ¿La skill vendor está asignada en algún proyecto? Ninguna asignación es autorizada aquí. */
export function vendorSkillAssigned(state) {
  const assignments = object(state?.assignments) ? state.assignments : {};
  for (const row of Object.values(assignments)) {
    if (object(row) && Object.hasOwn(row, VENDOR_SKILL_ID)) return true;
  }
  return false;
}

/** Huella de lo que la operación de vínculo NO puede tocar: la skill y las asignaciones. */
function untouchedFootprint(state) {
  return functionalSignature({
    skills: { [VENDOR_SKILL_ID]: state?.skills?.[VENDOR_SKILL_ID] ?? null },
    assignments: state?.assignments ?? {},
  });
}

function failure(code, message) {
  return { ok: false, code, message };
}

/**
 * Crea el vínculo. `now`, `actor`, `role` y `channel` los fija el adaptador/backend, nunca el cliente.
 * Devuelve el enlace persistido; en un reintento idéntico devuelve el existente sin crear otro evento.
 */
export function linkVendorRequest(state, input = {}, { now, actor, role, channel } = {}) {
  if (actor !== 'human') return failure('request-link.actor-required', 'sólo una persona puede vincular la solicitud');
  if (role !== VENDOR_LINK_ROLE) return failure('request-link.role-required', 'se exige el rol LifeCode Library Maintainer');
  if (channel !== VENDOR_LINK_CHANNEL) return failure('request-link.channel-required', 'sólo el canal humano browser puede vincular');

  const operationId = text(input.operationId);
  if (operationId === '') return failure('request-link.operation-id-required', 'el backend debe generar el operationId del enlace');
  if (operationId === VENDOR_LINK_OPERATION_ID) {
    return failure('request-link.operation-id-conflict', 'el enlace no puede reutilizar el operationId de la importación');
  }
  if (operationOf(state, operationId) !== null) {
    return failure('request-link.operation-id-conflict', 'ese operationId de enlace ya está registrado');
  }

  const request = object(state?.requests) ? state.requests[VENDOR_LINK_REQUEST_ID] ?? null : null;
  if (request === null) return failure('request-link.request-missing', 'no existe la solicitud histórica autorizada');
  if (text(request.text) !== VENDOR_LINK_REQUEST_TEXT) {
    return failure('request-link.text-mismatch', 'el texto de la solicitud no corresponde al repositorio Context7');
  }

  const skill = object(state?.skills) ? state.skills[VENDOR_SKILL_ID] ?? null : null;
  if (skill === null) return failure('request-link.skill-missing', 'la skill context7 no está persistida');

  const importOperation = operationOf(state, VENDOR_LINK_OPERATION_ID);
  if (importOperation === null) return failure('request-link.operation-missing', 'no existe la operación vendor autorizada');
  if (text(importOperation.kind) !== VENDOR_LINK_KIND) {
    return failure('request-link.operation-kind', 'la operación indicada no es una importación vendor');
  }

  const imported = (Array.isArray(state?.events) ? state.events : []).find((event) =>
    event?.type === 'skill-vendor-imported'
    && event?.skillId === VENDOR_SKILL_ID
    && text(event?.operationId) === VENDOR_LINK_OPERATION_ID) ?? null;
  if (imported === null) return failure('request-link.event-missing', 'no existe el evento de importación de esa operación');

  const provenance = object(skill.provenance) ? skill.provenance : {};
  if (text(provenance.candidateId) !== VENDOR_CANDIDATE_ID || text(imported.candidateId) !== VENDOR_CANDIDATE_ID) {
    return failure('request-link.candidate-mismatch', 'el candidateId no es el fijado en la decisión humana');
  }
  if (text(provenance.manifestSha256) !== VENDOR_MANIFEST_SHA256
    || text(imported.manifestSha256) !== VENDOR_MANIFEST_SHA256
    || text(imported.checksum) !== VENDOR_MANIFEST_SHA256) {
    return failure('request-link.manifest-mismatch', 'el manifest SHA-256 no coincide exactamente');
  }
  if (text(imported.commit) !== VENDOR_COMMIT || text(imported.tag) !== VENDOR_TAG
    || text(provenance.upstream?.commit) !== VENDOR_COMMIT || text(provenance.upstream?.tag) !== VENDOR_TAG) {
    return failure('request-link.upstream-mismatch', 'la procedencia upstream no es la autorizada');
  }
  if (text(skill.currentVersion) !== VENDOR_LINK_SKILL_VERSION || text(imported.version) !== VENDOR_LINK_SKILL_VERSION) {
    return failure('request-link.version-mismatch', 'la versión importada no es la autorizada');
  }
  if (text(skill.vendorState) !== 'disabled' || text(imported.vendorState) !== 'disabled') {
    return failure('request-link.not-disabled', 'la skill debe seguir desactivada para vincularse');
  }
  if (vendorSkillAssigned(state)) {
    return failure('request-link.assigned', 'context7 tiene asignaciones: el vínculo no puede activarla');
  }

  const before = untouchedFootprint(state);
  const expected = {
    requestId: VENDOR_LINK_REQUEST_ID,
    operationId: VENDOR_LINK_OPERATION_ID,
    kind: VENDOR_LINK_KIND,
    skillId: VENDOR_SKILL_ID,
    version: VENDOR_LINK_SKILL_VERSION,
    candidateId: VENDOR_CANDIDATE_ID,
    manifestSha256: VENDOR_MANIFEST_SHA256,
    linkedAt: text(now),
    by: VENDOR_LINK_ROLE,
    channel: VENDOR_LINK_CHANNEL,
  };
  const existing = vendorRequestLinkOf(state, VENDOR_LINK_REQUEST_ID);
  const identity = linkIdentity(expected);
  if (existing !== null) {
    if (linkIdentity(existing) !== identity) {
      return failure('request-link-conflict', 'la solicitud ya tiene un vínculo incompatible');
    }
    return { ok: true, replayed: true, link: { ...existing }, operationId: text(existing.operationId) };
  }

  if (!object(state.requestLinks)) state.requestLinks = {};
  state.requestLinks[VENDOR_LINK_REQUEST_ID] = expected;
  recordOperation(state, operationId, {
    kind: 'vendor-link-request',
    uuid: operationId,
    targetSha256: VENDOR_MANIFEST_SHA256,
    registeredAt: text(now),
    status: 'registered',
  });
  appendEvent(state, {
    id: `ev-vendor-link-${operationId}`.slice(0, 120),
    at: text(now),
    type: 'skill.request-linked',
    code: 'vendor.request.linked',
    skillId: VENDOR_SKILL_ID,
    version: VENDOR_LINK_SKILL_VERSION,
    actor: 'human',
    by: VENDOR_LINK_ROLE,
    requestId: VENDOR_LINK_REQUEST_ID,
    operationId: text(operationId),
    channel: VENDOR_LINK_CHANNEL,
    candidateId: VENDOR_CANDIDATE_ID,
    manifestSha256: VENDOR_MANIFEST_SHA256,
    checksum: VENDOR_MANIFEST_SHA256,
    note: 'vínculo histórico append-only; la solicitud conserva su estado original',
  });

  if (untouchedFootprint(state) !== before) {
    // Invariante: si esto cambiara, la correlación dejaría de ser confiable. Lanzar aborta la
    // transacción en `withState`: no se escribe medio vínculo.
    throw new Error('request-link: el vínculo modificó la skill o las asignaciones');
  }
  return { ok: true, replayed: false, link: { ...expected }, operationId: text(operationId) };
}

/** Proyección de lectura del vínculo; no escribe ni rellena valores ausentes. */
export function vendorRequestLinkOf(state, requestId = VENDOR_LINK_REQUEST_ID) {
  const entry = object(state?.requestLinks) ? state.requestLinks[text(requestId)] ?? null : null;
  return object(entry) ? { ...entry } : null;
}

/**
 * Corrección administrativa auditada: retira SOLO el vínculo y deja la importación intacta.
 * No es una herramienta del modelo y exige la misma compuerta humana que la creación.
 */
export function revertRequestLink(state, input = {}, { now, actor, role, channel } = {}) {
  if (actor !== 'human') return failure('request-link.actor-required', 'sólo una persona puede corregir el vínculo');
  if (role !== VENDOR_LINK_ROLE) return failure('request-link.role-required', 'se exige el rol LifeCode Library Maintainer');
  if (channel !== VENDOR_LINK_CHANNEL) return failure('request-link.channel-required', 'sólo el canal humano browser puede corregir el vínculo');
  const operationId = text(input.operationId);
  if (operationId === '' || operationId === VENDOR_LINK_OPERATION_ID || operationOf(state, operationId) !== null) {
    return failure('request-link.operation-id-conflict', 'el backend debe generar un operationId nuevo para la corrección');
  }
  const existing = vendorRequestLinkOf(state, VENDOR_LINK_REQUEST_ID);
  if (existing === null) return failure('request-link.not-found', 'no hay vínculo que corregir');
  if (text(existing.operationId) !== VENDOR_LINK_OPERATION_ID || text(existing.skillId) !== VENDOR_SKILL_ID) {
    return failure('request-link-conflict', 'el vínculo existente no es el autorizado');
  }
  const before = untouchedFootprint(state);
  delete state.requestLinks[VENDOR_LINK_REQUEST_ID];
  if (Object.keys(state.requestLinks).length === 0) delete state.requestLinks;
  recordOperation(state, operationId, {
    kind: 'vendor-unlink-request',
    uuid: operationId,
    targetSha256: VENDOR_MANIFEST_SHA256,
    registeredAt: text(now),
    status: 'registered',
  });
  appendEvent(state, {
    id: `ev-vendor-unlink-${operationId}`.slice(0, 120),
    at: text(now),
    type: 'skill.request-link-reverted',
    code: 'vendor.request.link-reverted',
    skillId: VENDOR_SKILL_ID,
    version: VENDOR_LINK_SKILL_VERSION,
    actor: 'human',
    by: VENDOR_LINK_ROLE,
    requestId: VENDOR_LINK_REQUEST_ID,
    operationId: text(operationId),
    channel: VENDOR_LINK_CHANNEL,
    note: 'corrección administrativa: se retira el vínculo, no se revierte la importación',
  });
  if (untouchedFootprint(state) !== before) {
    throw new Error('request-link: la corrección modificó la skill o las asignaciones');
  }
  return { ok: true, reverted: true, requestId: VENDOR_LINK_REQUEST_ID, operationId: text(operationId) };
}
