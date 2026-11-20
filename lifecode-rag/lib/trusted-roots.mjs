/**
 * Trusted Workspace Roots (auto-discovery 01).
 *
 * Un *workspace confiable* es una carpeta que una persona autoriza una sola vez para que
 * LifeCode RAG descubra los proyectos que contiene. La confianza y la autorización de lectura
 * son decisiones separadas y explícitas:
 *
 *   - `state: 'trusted'`  → se puede escanear (descubrir) dentro de la raíz.
 *   - `readAuthorization` → los proyectos descubiertos pueden registrarse como ámbitos de
 *                           lectura (raíz `authorized`) sin una segunda aprobación.
 *
 * Descubrir NUNCA es indexar ni leer documentos: el escaneo sólo comprueba la existencia de
 * indicadores y, como mucho, lee `package.json` para clasificar el tipo de proyecto.
 *
 * La confianza se guarda en la tabla `meta` del registro (clave `trusted_roots`), en orden
 * estable y sin tocar el esquema. Es idempotente por `pathKey`.
 */

import { RagError } from './errors.mjs';
import { appendRegistryAudit, getMeta, setMeta } from './registry.mjs';
import { assertRootStructure, inspectRoot } from './roots-structure.mjs';

export const TRUST_META_KEY = 'trusted_roots';
const MAX_TRUSTED_ROOTS = 32;

function normalizeTrust(entry) {
  return {
    path: entry.path,
    pathKey: entry.pathKey,
    state: entry.state === 'revoked' ? 'revoked' : 'trusted',
    readAuthorization: entry.readAuthorization === true,
    addedAt: Number(entry.addedAt) || 0,
    addedBy: entry.addedBy === 'host' ? 'host' : 'human',
  };
}

export function listTrustedRoots(db) {
  const raw = getMeta(db, TRUST_META_KEY);
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeTrust).filter((entry) => typeof entry.pathKey === 'string' && entry.pathKey !== '');
}

function writeTrustedRoots(db, roots) {
  const ordered = [...roots]
    .sort((left, right) => left.pathKey.localeCompare(right.pathKey))
    .map(normalizeTrust);
  setMeta(db, TRUST_META_KEY, JSON.stringify(ordered));
  return ordered;
}

function audit(db, { at, actor, action, target, outcome = 'ok', detail }) {
  try {
    appendRegistryAudit(db, {
      at,
      actor: actor === 'host' ? 'host' : 'human',
      sessionId: null,
      action,
      target,
      outcome,
      detail: JSON.stringify(detail ?? {}),
    });
  } catch {
    // La auditoría del registro no debe convertir una operación válida en un fallo silencioso;
    // los rechazos de autorización sí se auditan en resolve/exec-context.
  }
}

/**
 * Añade (o actualiza) un workspace confiable. Idempotente: repetir la misma ruta no duplica,
 * no cambia `addedAt` y devuelve `created: false`.
 */
export function addTrustedRoot(db, {
  path, readAuthorization = true, addedBy = 'human', now = Date.now(),
} = {}) {
  if (addedBy !== 'human' && addedBy !== 'host') {
    throw new RagError('invalid-argument', 'sólo una persona o el host pueden confiar un workspace');
  }
  const info = assertRootStructure(inspectRoot(path));
  const roots = listTrustedRoots(db);
  const existing = roots.find((entry) => entry.pathKey === info.key);
  if (existing) {
    if (existing.state === 'trusted' && existing.readAuthorization === (readAuthorization === true)) {
      return { created: false, changed: false, root: existing };
    }
    const updated = roots.map((entry) => (entry.pathKey === info.key
      ? { ...entry, state: 'trusted', readAuthorization: readAuthorization === true }
      : entry));
    const [root] = writeTrustedRoots(db, updated).filter((entry) => entry.pathKey === info.key);
    audit(db, {
      at: now, actor: addedBy, action: 'trust.update', target: info.key,
      detail: { path: info.canonical, readAuthorization: readAuthorization === true },
    });
    return { created: false, changed: true, root };
  }
  if (roots.length >= MAX_TRUSTED_ROOTS) {
    throw new RagError('invalid-argument', 'demasiados workspaces confiables', {
      details: { limit: MAX_TRUSTED_ROOTS },
    });
  }
  const record = normalizeTrust({
    path: info.canonical,
    pathKey: info.key,
    state: 'trusted',
    readAuthorization: readAuthorization === true,
    addedAt: now,
    addedBy,
  });
  writeTrustedRoots(db, [...roots, record]);
  audit(db, {
    at: now, actor: addedBy, action: 'trust.add', target: info.key,
    detail: { path: info.canonical, readAuthorization: record.readAuthorization },
  });
  return { created: true, changed: true, root: record };
}

/** Revoca la confianza sin tocar los proyectos ya registrados ni sus almacenes. */
export function removeTrustedRoot(db, { path, removedBy = 'human', now = Date.now() } = {}) {
  const info = inspectRoot(path);
  const roots = listTrustedRoots(db);
  const existing = roots.find((entry) => entry.pathKey === info.key);
  if (!existing) return { changed: false, root: null };
  const updated = roots.map((entry) => (entry.pathKey === info.key ? { ...entry, state: 'revoked' } : entry));
  writeTrustedRoots(db, updated);
  audit(db, {
    at: now, actor: removedBy, action: 'trust.remove', target: info.key,
    detail: { path: info.canonical },
  });
  return { changed: true, root: { ...existing, state: 'revoked' } };
}

/** El workspace confiable activo más específico que contiene la clave dada. */
export function trustedRootFor(db, key) {
  if (!key) return null;
  let best = null;
  for (const entry of listTrustedRoots(db)) {
    if (entry.state !== 'trusted') continue;
    const inside = key === entry.pathKey || key.startsWith(`${entry.pathKey}/`);
    if (!inside) continue;
    if (!best || entry.pathKey.length > best.pathKey.length) best = entry;
  }
  return best;
}
