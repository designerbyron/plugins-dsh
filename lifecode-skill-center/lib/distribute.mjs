/**
 * Distribución de skills: un fichero portable por versión, con su huella, y una importación que **crea una
 * copia aislada** en el centro de destino en vez de mover o tocar la fuente.
 *
 * Por qué así:
 *   - La biblioteca de este centro es global por diseño (un almacén, varios proyectos), y la directiva pide
 *     además distribución entre centros con clones/imports **aislados**: importar no puede cambiar el original,
 *     ni sus asignaciones, ni su versión vigente.
 *   - El fichero se publica con `wx`: dos exportaciones del mismo id+versión no se pisan. La calidad de la
 *     entrega está en la huella del cuerpo, que se verifica al leer.
 *
 * Puro: no toca disco salvo en `writeBundle`, que recibe las funciones de sistema de ficheros por parámetro
 * cuando se prueba.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isSafeId } from './format.mjs';
import { appendEvent } from './state.mjs';

export const BUNDLE_SCHEMA = 'lifecode-skill-center/skill-bundle';
export const BUNDLE_SCHEMA_VERSION = 1;

const text = (value) => (typeof value === 'string' ? value : '');

/** Las referencias viajan con su forma: mapa `ruta → contenido` o lista de `{ path, content }`. */
function copyReferences(value) {
  if (Array.isArray(value)) return value.map((entry) => (entry !== null && typeof entry === 'object' ? { ...entry } : entry));
  if (value !== null && typeof value === 'object') return { ...value };
  return {};
}

/**
 * Referencias que **no** son portables a otro proyecto: rutas absolutas de una máquina concreta.
 *
 * La directiva pide que el aprendizaje entre proyectos no comparta datos privados, y el modo de fuga más
 * frecuente en una skill es una referencia que apunta a `C:\...` o `/home/...`: funciona en el centro de
 * origen y miente en el de destino. Se detecta y se declara; **no** se borra el contenido, porque quién
 * decide si el dato es privado es la persona, no este módulo.
 */
const ABSOLUTE_PATH = /(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:home|Users|root|mnt)\/)/u;

function referenceEntries(references) {
  if (Array.isArray(references)) {
    return references
      .filter((entry) => entry !== null && typeof entry === 'object')
      .map((entry) => ({ path: text(entry.path), content: text(entry.content) }));
  }
  if (references !== null && typeof references === 'object') {
    return Object.entries(references).map(([path, content]) => ({ path, content: text(content) }));
  }
  return [];
}

/** Lista las referencias con ruta absoluta, con el motivo escrito, para poder avisar sin inventar. */
export function privateReferences(references) {
  return referenceEntries(references)
    .filter((entry) => ABSOLUTE_PATH.test(entry.content))
    .map((entry) => ({
      path: entry.path,
      reason: 'absolute-path',
      detail: 'la referencia contiene una ruta absoluta de una máquina concreta: no es portable tal cual',
    }));
}


/**
 * Referencias que `createSkill` rechazaría: sólo `references/…`, sin `..` y sin `:`. Se comprueba también
 * que el contenido sea texto. Devuelve la lista de problemas con su ruta, sin lanzar ni corregir nada.
 */
export function invalidBundleReferences(references) {
  const problems = [];
  const entries = Array.isArray(references)
    ? references.map((entry) => (entry !== null && typeof entry === 'object' ? [entry.path, entry.content] : [undefined, undefined]))
    : references !== null && typeof references === 'object'
      ? Object.entries(references)
      : [];
  for (const [path, content] of entries) {
    const name = typeof path === 'string' ? path : '';
    const usable = typeof content === 'string' && name.startsWith('references/') && !name.includes('..') && !name.includes(':');
    if (!usable) {
      problems.push({
        path: name === '' ? '(sin ruta)' : name,
        reason: 'invalid-reference',
        detail: 'sólo se admiten rutas "references/…" con contenido de texto, sin ".." ni ":"',
      });
    }
  }
  return problems;
}

/**
 * Avisos de posible secreto. **No bloquean**: una skill puede documentar cómo se configura una API key.
 * Lo que se evita es distribuir un secreto real sin que la persona lo vea antes de importar.
 */
const SECRET_PATTERNS = [
  { reason: 'private-key-block', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u },
  { reason: 'api-key-assignment', re: /\bapi[_-]?key\s*[:=]/iu },
  { reason: 'password-assignment', re: /\bpassword\s*[:=]/iu },
];

export function possibleSecretWarnings(bundle) {
  const skill = bundle?.skill ?? {};
  const fields = [
    ['skill.body', text(skill.body)],
    ['skill.description', text(skill.description)],
    ['skill.whenToUse', text(skill.whenToUse)],
    ...referenceEntries(skill.references).map((entry, index) => [`references[${index}]${entry.path === '' ? '' : `:${entry.path}`}`, entry.content]),
  ];
  const warnings = [];
  for (const [path, content] of fields) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(content)) {
        warnings.push({
          path,
          reason: 'possible-secret',
          detail: `el contenido parece incluir un secreto (${pattern.reason}): revisa el paquete antes de compartirlo`,
        });
      }
    }
  }
  return warnings;
}

/** Huella estable del contenido: cuerpo + metadatos que un proyecto ejecuta. */
export function bundleChecksum({ body, description, whenToUse, tags }) {
  const payload = JSON.stringify({
    body: text(body),
    description: text(description),
    whenToUse: text(whenToUse),
    tags: Array.isArray(tags) ? tags.map((tag) => String(tag)) : [],
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Empaqueta una versión concreta. Sin versión se usa la vigente, que es lo que la persona ve en el panel.
 */
export function skillBundle(state, skillId, { version = '', now = new Date().toISOString(), note = '' } = {}) {
  const skill = state?.skills?.[String(skillId ?? '')];
  if (skill === undefined) return { ok: false, code: 'skill-not-found', message: `no existe la skill ${skillId}` };
  const wanted = text(version) === '' ? String(skill.currentVersion ?? '') : text(version);
  const chosen = (skill.versions ?? []).find((entry) => entry.version === wanted);
  if (chosen === undefined) return { ok: false, code: 'version-not-found', message: `la skill ${skill.id} no tiene la versión ${wanted}` };

  const body = text(chosen.body);
  const references = copyReferences(chosen.references);
  const notPortable = privateReferences(references);
  return {
    ok: true,
    bundle: {
      schema: BUNDLE_SCHEMA,
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      exportedAt: now,
      checksum: bundleChecksum({ body, description: chosen.description, whenToUse: chosen.whenToUse, tags: chosen.tags }),
      note: text(note),
      // Procedencia aditiva (R16.4 §C): el esquema 1 sigue siendo válido sin este campo, y `readBundle`
      // devuelve `null` cuando falta (paquetes anteriores a esta ronda).
      origin: {
        app: 'lifecode-skill-center',
        skillId: String(skill.id),
        version: chosen.version,
        exportedAt: now,
      },
      // Declarado, no corregido: quién decide si ese dato es privado es la persona que exporta.
      portable: notPortable.length === 0,
      warnings: notPortable,
      skill: {
        id: String(skill.id),
        title: text(skill.title),
        description: text(chosen.description),
        whenToUse: text(chosen.whenToUse),
        tags: Array.isArray(chosen.tags) ? chosen.tags.map(String) : [],
        references,
        body,
        version: chosen.version,
        // Aditivo y tolerado por el esquema 1: la versión no cambia su significado por saber si estaba
        // publicada o retirada, y el lector no lo exige.
        status: skill.status === 'deprecated' ? 'deprecated' : 'published',
        publishedAt: text(chosen.createdAt),
      },
    },
  };
}

/** Carpeta de exportaciones del centro. Es una vista derivada: se puede borrar sin perder nada. */
export function exportsRoot(root) {
  return join(root, 'exports');
}

/** Tope de lectura: un paquete es texto; medio megabyte ya es más de lo que una skill razonable ocupa. */
export const MAX_BUNDLE_BYTES = 512 * 1024;

/**
 * Nombre seguro para el fichero. El id y la versión vienen de fuera: si se concatenan sin comprobar, un
 * `skillId` como `../../otro` escribe fuera de `exports/`. Se valida la forma, no se "limpia" el valor.
 */
export function isSafeBundlePart(value, kind) {
  const text = typeof value === 'string' ? value : '';
  if (kind === 'version') return /^\d+\.\d+\.\d+$/.test(text);
  // Misma forma de id que la puerta de creación (`isSafeId`): una sola regla, sin divergencias.
  return isSafeId(text);
}

/** Ruta del fichero de una versión. Nombre estable: una versión exportada dos veces choca a propósito. */
export function bundlePath(root, skillId, version) {
  if (!isSafeBundlePart(skillId, 'skillId')) return null;
  if (!isSafeBundlePart(version, 'version')) return null;
  return join(exportsRoot(root), `${skillId}-${version}.json`);
}

/**
 * Escribe el paquete. `flag:'wx'` es la garantía de no pisar: si ya existe, se devuelve el error en vez de
 * reemplazar un artefacto que quizá alguien ya distribuyó.
 */
export function writeBundle({
  root,
  state,
  skillId,
  version = '',
  now = new Date().toISOString(),
  note = '',
  mkdir = mkdirSync,
  writeFile = writeFileSync,
} = {}) {
  const packaged = skillBundle(state, skillId, { version, now, note });
  if (packaged.ok !== true) return packaged;

  const file = bundlePath(root, packaged.bundle.skill.id, packaged.bundle.skill.version);
  if (file === null) {
    return { ok: false, code: 'unsafe-bundle-name', message: 'el id o la versión no dan un nombre de fichero seguro' };
  }
  const contents = `${JSON.stringify(packaged.bundle, null, 2)}\n`;
  // Simetría con la lectura (G10): un paquete que no se podría volver a leer no se escribe.
  if (Buffer.byteLength(contents, 'utf8') > MAX_BUNDLE_BYTES) {
    return { ok: false, code: 'bundle-too-large', message: 'el paquete empaquetado supera el tope de lectura' };
  }
  try {
    mkdir(exportsRoot(root), { recursive: true });
    writeFile(file, contents, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const code = String(error?.code ?? '');
    if (code === 'EEXIST') {
      return { ok: false, code: 'bundle-exists', message: 'esa versión ya está exportada: el fichero no se reescribe', file };
    }
    return { ok: false, code: 'bundle-write-failed', message: `no se pudo escribir el paquete: ${code || 'error'}`, file };
  }

  return {
    ok: true,
    file,
    bytes: Buffer.byteLength(contents, 'utf8'),
    sha256: createHash('sha256').update(contents, 'utf8').digest('hex'),
    checksum: packaged.bundle.checksum,
    skillId: packaged.bundle.skill.id,
    version: packaged.bundle.skill.version,
    origin: packaged.bundle.origin,
    // El JSON serializado permite copiar o descargar desde el panel sin releer el fichero (R16.4 §5).
    json: contents,
    // Lo que la persona tiene que saber antes de llevar el paquete a otro proyecto.
    portable: packaged.bundle.portable,
    warnings: packaged.bundle.warnings,
  };
}

/** Procedencia del paquete, tolerante con paquetes anteriores a R16.4 (sin `origin` ⇒ `null`). */
function normalizeOrigin(value) {
  if (value === null || typeof value !== 'object') return null;
  const app = text(value.app);
  const skillId = text(value.skillId);
  if (app === '' || skillId === '') return null;
  return {
    app,
    skillId,
    version: text(value.version),
    exportedAt: text(value.exportedAt),
  };
}

/** Lee y valida un paquete. La huella se recalcula: un fichero tocado a mano no entra. */
export function readBundle(input) {
  const raw = typeof input === 'string' ? input : '';
  if (Buffer.byteLength(raw, 'utf8') > MAX_BUNDLE_BYTES) {
    return { ok: false, code: 'bundle-too-large', message: 'el paquete supera el tope de lectura' };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid-bundle', message: 'el paquete no es JSON' };
  }
  if (parsed === null || typeof parsed !== 'object') return { ok: false, code: 'invalid-bundle', message: 'el paquete no es un objeto' };
  if (parsed.schema !== BUNDLE_SCHEMA) return { ok: false, code: 'invalid-bundle', message: `el paquete no declara ${BUNDLE_SCHEMA}` };
  if (Number(parsed.schemaVersion) !== BUNDLE_SCHEMA_VERSION) {
    return { ok: false, code: 'unsupported-schema', message: `la versión de esquema ${String(parsed.schemaVersion)} no se lee aquí` };
  }
  const skill = parsed.skill;
  if (skill === null || typeof skill !== 'object') return { ok: false, code: 'invalid-bundle', message: 'el paquete no trae la skill' };
  if (text(skill.id) === '' || text(skill.body) === '') return { ok: false, code: 'invalid-bundle', message: 'el paquete no trae id o cuerpo' };
  const expected = bundleChecksum({
    body: text(skill.body),
    description: text(skill.description),
    whenToUse: text(skill.whenToUse),
    tags: skill.tags,
  });
  if (text(parsed.checksum) !== expected) {
    return { ok: false, code: 'checksum-mismatch', message: 'la huella del paquete no coincide con su contenido' };
  }
  return { ok: true, bundle: parsed, checksum: expected, origin: normalizeOrigin(parsed.origin) };
}

/**
 * Importa el paquete como **copia aislada**. Nunca sobrescribe y nunca renombra en silencio: con el id
 * ocupado hay que pedir `onConflict:'copy'` de forma explícita (decisión de la persona). Registra
 * procedencia completa y un evento `skill-imported` con la huella y si hubo renombrado (R16.4 §B/§C).
 */
export function importBundle(state, bundle, { now = new Date().toISOString(), note = '', from = null, createSkill = null, onConflict = 'abort' } = {}) {
  const skill = bundle?.skill;
  if (skill === null || typeof skill !== 'object') return { ok: false, code: 'invalid-bundle', message: 'no hay skill que importar' };
  const baseId = text(skill.id);
  if (baseId === '') return { ok: false, code: 'invalid-bundle', message: 'la skill no trae id' };

  const expectedChecksum = bundleChecksum({
    body: text(skill.body),
    description: text(skill.description),
    whenToUse: text(skill.whenToUse),
    tags: skill.tags,
  });
  const declaredChecksum = text(bundle?.checksum);
  if (declaredChecksum !== expectedChecksum) {
    return { ok: false, code: 'checksum-mismatch', message: 'la huella del paquete no coincide con su contenido' };
  }

  const exportedOrigin = normalizeOrigin(bundle?.origin);
  const originalVersion = text(skill.version) || text(exportedOrigin?.version);
  const already = Object.values(state?.skills ?? {}).find((row) => row !== null
    && typeof row === 'object'
    && row.origin?.kind === 'import'
    && text(row.origin?.bundleChecksum) === expectedChecksum
    && text(row.origin?.originalSkillId) === baseId);
  if (already !== undefined) {
    return {
      ok: false,
      code: 'already-imported',
      message: `este mismo paquete ya se importó como "${String(already.id)}"`,
      existingId: String(already.id),
      checksum: expectedChecksum,
    };
  }
  // El normalizador del documento conserva sólo el núcleo de `origin`; el diario sí guarda la procedencia
  // completa. Sin esta segunda lectura, recargar el centro haría que el mismo paquete entrara otra vez.
  const importedEvent = (Array.isArray(state?.events) ? state.events : []).find((event) => event?.code === 'skill-imported'
    && text(event.checksum) === expectedChecksum
    && text(event.originalSkillId) === baseId);
  if (importedEvent !== undefined) {
    return {
      ok: false,
      code: 'already-imported',
      message: `este mismo paquete ya se importó como "${String(importedEvent.skillId ?? '')}"`,
      existingId: String(importedEvent.skillId ?? ''),
      checksum: expectedChecksum,
    };
  }

  let id = baseId;
  let renamed = false;
  if (state.skills?.[id] !== undefined) {
    if (onConflict !== 'copy') {
      return {
        ok: false,
        code: 'conflict',
        message: `ya existe una skill con el id "${baseId}": no se sobrescribe; para conservar ambas, pide una copia`,
        existingId: baseId,
        existingVersion: state.skills[baseId].currentVersion,
        checksum: expectedChecksum,
      };
    }
    for (let attempt = 1; state.skills?.[id] !== undefined; attempt += 1) {
      id = attempt === 1 ? `${baseId}-copia` : `${baseId}-copia-${attempt}`;
      renamed = true;
    }
  }

  const candidate = {
    id,
    title: text(skill.title) || text(skill.description) || id,
    description: text(skill.description),
    whenToUse: text(skill.whenToUse),
    tags: Array.isArray(skill.tags) ? skill.tags.map(String) : [],
    body: text(skill.body),
    references: copyReferences(skill.references),
    notes: text(note),
    origin: {
      kind: 'import',
      from,
      fromVersion: text(skill.version),
      note: renamed ? `copia aislada de ${baseId} v${text(skill.version)}` : `importada de un paquete (${text(skill.version)})`,
    },
  };

  // Se importa por la misma puerta que cualquier creación: validación de referencias, evaluación y versión
  // inmutable. Una importación no se salta la calidad.
  if (typeof createSkill !== 'function') return { ok: false, code: 'create-unavailable', message: 'falta la función de creación' };
  const created = createSkill(state, candidate, { now });
  if (created.ok !== true) return created;

  // La procedencia completa se guarda en el estado (createSkill sólo conserva el núcleo): checksum del
  // paquete y versión original son lo que permite detectar la repetición y auditar de dónde vino.
  const importedOrigin = {
    kind: 'import',
    from: text(from) === '' ? null : text(from),
    fromVersion: originalVersion === '' ? null : originalVersion,
    bundleChecksum: expectedChecksum,
    originalSkillId: baseId,
    originalVersion: originalVersion === '' ? null : originalVersion,
    importedAt: now,
  };
  state.skills[created.id].origin = importedOrigin;
  const event = appendEvent(state, {
    type: 'skill-imported',
    at: now,
    skillId: created.id,
    version: created.version?.version ?? '1.0.0',
    actor: 'human',
    note: renamed ? `importada como copia de ${baseId}` : `importada de ${baseId}`,
  });
  // El diario guarda un núcleo fijo de campos; los de auditoría de esta operación se añaden al evento ya
  // empujado para que viajen en el mismo documento (misma transacción de `withState`).
  if (event !== null && typeof event === 'object') {
    event.code = 'skill-imported';
    event.checksum = expectedChecksum;
    event.renamed = renamed;
    event.renamedFrom = renamed ? baseId : null;
    event.originalSkillId = baseId;
    event.originalVersion = originalVersion;
    event.from = importedOrigin.from;
  }

  const notPortable = privateReferences(candidate.references);
  return {
    ok: true,
    id: created.id,
    skill: created.id,
    renamed,
    renamedFrom: renamed ? baseId : null,
    from: importedOrigin.from,
    version: created.version?.version ?? '1.0.0',
    checksum: expectedChecksum,
    bundleChecksum: expectedChecksum,
    origin: importedOrigin,
    portable: notPortable.length === 0,
    warnings: notPortable,
  };
}

