/**
 * Parecido entre skills, en un módulo propio.
 *
 * Vive aquí y no dentro de `lib/api.mjs` porque lo necesitan tres sitios: el aviso de duplicados al
 * crear, el elector «skill nueva o mejora» y el plan que se le enseña a la IA. Tenerlo duplicado
 * garantizaba que un día las dos copias dijeran cosas distintas.
 */

/** Minúsculas, sin acentos y sólo letras/números separados por un espacio. */
export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(value) {
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((word) => word.length > 3),
  );
}

/** Proporción de palabras significativas compartidas respecto al lado más corto (0..1). */
export function wordOverlap(left, right) {
  const a = words(left);
  const b = words(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * Compara una candidata (título, descripción, etiquetas) con la biblioteca.
 * Devuelve `[{ id, title, reasons, score }]` ordenado de más a menos parecido.
 */
export function similarSkills(state, candidate) {
  const title = String(candidate?.title ?? '');
  const description = String(candidate?.description ?? '');
  const tags = new Set(Array.isArray(candidate?.tags) ? candidate.tags : []);
  const excludeId = String(candidate?.excludeId ?? '');
  const found = [];

  for (const [id, skill] of Object.entries(state?.skills ?? {})) {
    if (id === excludeId) continue;
    const latest = Array.isArray(skill.versions) ? skill.versions[skill.versions.length - 1] ?? {} : {};
    const reasons = [];
    let score = 0;

    if (title !== '' && normalizeText(skill.title) === normalizeText(title)) {
      reasons.push('mismo título');
      score += 2;
    }
    const sharedTags = (Array.isArray(skill.tags) ? skill.tags : []).filter((tag) => tags.has(tag));
    if (sharedTags.length >= 2) {
      reasons.push(`etiquetas en común: ${sharedTags.join(', ')}`);
      score += 1;
    }
    const overlap = wordOverlap(latest.description ?? skill.description, description);
    if (overlap >= 0.6) {
      reasons.push('descripción muy parecida');
      score += 1;
    }
    if (reasons.length > 0) found.push({ id, title: String(skill.title ?? ''), reasons, score });
  }

  return found.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
