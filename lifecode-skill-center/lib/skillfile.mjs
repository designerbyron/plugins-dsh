/**
 * El fichero `SKILL.md`: componerlo como lo acepta DeepSeek Harness, y leerlo cuando es de otro.
 *
 * El contrato es el mismo que el resto de la casa: `name` y `description` en el frontmatter, el
 * procedimiento en el cuerpo, y la procedencia bajo `metadata.dsh` en dos niveles —el parser de la
 * biblioteca del harness modela dos, y anidar un tercero obligaría a escribir un YAML de verdad para
 * no ganar nada.
 */

/** Un valor de una línea: ni saltos ni espacios repetidos. Un `description` con un salto rompe el YAML. */
export function singleLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** El escalar entrecomillado, que es la única forma de que un `:` o una coma en el texto no rompan nada. */
export function quoteYaml(value) {
  return `"${singleLine(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Compone el `SKILL.md` de una versión concreta.
 *
 * @param {{ skill: object, version: object }} input
 * @returns {string} el fichero completo, listo para escribir.
 */
export function renderSkillFile({ skill, version }) {
  const description = singleLine(version.description ?? skill.description);
  const whenToUse = singleLine(version.whenToUse ?? skill.whenToUse);
  const tags = Array.isArray(version.tags ?? skill.tags) ? version.tags ?? skill.tags : [];
  const front = [
    '---',
    `name: ${skill.id}`,
    `description: ${quoteYaml(description)}`,
  ];
  if (whenToUse !== '') front.push(`whenToUse: ${quoteYaml(whenToUse)}`);
  front.push('metadata:', '  dsh:');
  front.push('    origin: lifecode-skill-center');
  front.push(`    skillId: ${quoteYaml(skill.id)}`);
  front.push(`    version: ${quoteYaml(version.version)}`);
  front.push(`    createdAt: ${quoteYaml(version.createdAt ?? skill.createdAt)}`);
  if (tags.length > 0) front.push(`    tags: [${tags.map((tag) => quoteYaml(tag)).join(', ')}]`);
  front.push('---', '', `# ${description}`, '');
  const body = String(version.body ?? '')
    .replace(/^\s*\n/, '')
    .replace(/\s+$/, '');
  return `${front.join('\n')}\n${body}\n`;
}

/**
 * Lee un `SKILL.md`, sea nuestro o de otra herramienta.
 *
 * Es tolerante a propósito: un fichero de otra biblioteca puede traer un YAML que este subconjunto no
 * entiende, y en ese caso se devuelve lo que sí se pudo leer en vez de rechazar el fichero entero. La
 * detección de skills existentes necesita justamente eso — ver lo que hay, aunque no sea nuestro.
 *
 * @param {string} text
 * @returns {{ data: Record<string, unknown>, body: string }}
 */
export function parseSkillFile(text) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { data: {}, body: raw };
  const header = raw.slice(3, end).replace(/^\n/, '');
  // El aire alrededor del cuerpo no es contenido: quitarlo hace que componer y leer sea ida y vuelta.
  const body = raw.slice(end + 4).replace(/^\n+/, '').replace(/\s+$/, '');
  return { data: parseYamlSubset(header), body };
}

/**
 * Subconjunto de YAML que basta para un frontmatter de skill: mapas anidados por sangría, escalares
 * entrecomillados y listas en línea. Lo que no entiende lo ignora, que es lo correcto aquí: el objetivo
 * es leer un `description`, no editar un fichero ajeno.
 */
export function parseYamlSubset(header) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const rawLine of String(header ?? '').split('\n')) {
    const line = rawLine.replace(/\t/g, '  ');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const match = /^(\s*)([^:#][^:]*):\s*(.*)$/.exec(line);
    if (match === null) continue;
    const indent = match[1].length;
    const key = match[2].trim();
    const rest = match[3].trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    if (rest === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseScalar(rest);
    }
  }
  return root;
}

function parseScalar(text) {
  const value = text.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value
      .slice(1, -1)
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"');
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitInlineList(value.slice(1, -1)).map(parseScalar).filter((item) => item !== '');
  }
  return value;
}

function splitInlineList(text) {
  const items = [];
  let current = '';
  let quote = null;
  for (const char of text) {
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ',') {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') items.push(current.trim());
  return items;
}

/**
 * Lo que la detección necesita de un `SKILL.md` ajeno, ya en la forma de un candidato comparable.
 * Devuelve `null` si el fichero no declara ni nombre ni descripción: entonces no es una skill.
 */
export function candidateFromSkillFile(text, { path = '', source = 'externo' } = {}) {
  const { data } = parseSkillFile(text);
  const name = singleLine(data.name ?? '');
  const description = singleLine(data.description ?? '');
  if (name === '' && description === '') return null;
  const tags = Array.isArray(data.tags) ? data.tags.map(singleLine).filter(Boolean) : [];
  return {
    id: name !== '' ? name : path,
    name,
    description,
    whenToUse: singleLine(data.whenToUse ?? ''),
    tags,
    source,
    path,
  };
}
