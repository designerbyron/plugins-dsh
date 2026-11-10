#!/usr/bin/env node
/**
 * Test Quality Auditor — analizador estático y determinista de la suite.
 *
 * No ejecuta el producto ni las pruebas: lee `tests/**\/*.test.mjs` y `tools/*.mjs` y busca
 * patrones que permiten un verde falso. Cada hallazgo lleva archivo:línea, una regla con
 * severidad y una razón. La salida es estable (ordenada, sin fechas) para que se pueda
 * comparar entre ejecuciones.
 *
 * Uso:
 *   node tools/testquality.mjs                 # audita este plugin
 *   node tools/testquality.mjs --root <dir>    # audita otra raíz (fixtures de las pruebas)
 *   node tools/testquality.mjs --json          # salida máquina (JSON puro)
 *   node tools/testquality.mjs --rules         # catálogo de reglas y severidades
 *
 * Código de salida: 0 sólo si no hay ningún hallazgo de severidad ALTA. Las severidades
 * MEDIA y BAJA se informan pero no bloquean, porque son deuda declarada y no una mentira.
 *
 * Límites (explícitos, para no vender más de lo que mide):
 *  · Es un análisis de forma, no de intención: no sabe si una aserción «débil» era la única
 *    posible. Por eso toda regla que depende del nombre de la prueba exige además una
 *    ausencia concreta de evidencia (bytes, conteo, texto), no una opinión.
 *  · El enmascarado de literales y comentarios es deliberadamente conservador: un fichero
 *    que el escáner no consigue equilibrar se omite del análisis de bloques y se informa
 *    como `analisis/fichero-ilegible` en vez de inventar hallazgos.
 *  · No ejecuta `tools/mutation.mjs` (tardaría minutos y mutaría una copia): comprueba que
 *    el catálogo sea aplicable y que su línea declarada sea la real. La supervivencia de un
 *    mutante sólo se sabe ejecutándolo.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const SEVERITY_ORDER = { alta: 0, media: 1, baja: 2 };

/** Métodos de `node:assert` que cuentan como aserción. */
const ASSERT_METHODS = [
  'ok', 'equal', 'notEqual', 'strictEqual', 'notStrictEqual', 'deepEqual', 'notDeepEqual',
  'deepStrictEqual', 'notDeepStrictEqual', 'throws', 'doesNotThrow', 'rejects', 'doesNotReject',
  'match', 'doesNotMatch', 'fail', 'ifError',
];

/**
 * Rutas críticas que la suite debe cubrir con una rama negativa. Si el token no aparece en
 * ninguna prueba, la ruta sólo tiene camino feliz. El ancla es el fichero que debería
 * contener esa negativa, para que el hallazgo sea accionable aunque no haya línea exacta.
 */
const CRITICAL_ROUTES = [
  {
    id: 'autorizacion',
    token: /approval-required/,
    anchor: 'tests/autonomy.test.mjs',
    message: 'ninguna prueba exige el rechazo por autorización (approval-required): la IA podría aprobar y todo seguiría verde',
  },
  {
    id: 'evidencia',
    token: /evidence|evidencia/,
    anchor: 'tests/autonomy.test.mjs',
    message: 'ninguna prueba exige el rechazo por evidencia insuficiente: publicar sin medir nada podría pasar',
  },
  {
    id: 'aislamiento',
    token: /resolve\(\s*root\s*\)[\s\S]{0,120}?resolve\(\s*defaultRoot\s*\(\s*\)\s*\)|notEqual\([^)]*root/i,
    anchor: 'tests/adversarial.test.mjs',
    message: 'ninguna prueba compara la raíz de la caja de arena con el almacén real: una prueba podría escribir en producción y seguir verde',
  },
  {
    id: 'integridad',
    token: /store-unreadable|integridad|integrity/,
    anchor: 'tests/integrity.test.mjs',
    message: 'ninguna prueba exige el rechazo de un almacén ilegible: una escritura sobre datos corruptos podría pasar',
  },
  {
    id: 'ledger',
    token: /events\s*\.\s*length|appendEvent|eventos/,
    anchor: 'tests/advance.test.mjs',
    message: 'ninguna prueba cuenta eventos del ledger: una operación podría no registrar su evento y seguir verde',
  },
];

/** Palabras funcionales que, como aguja negativa, no discriminan nada por sí mismas. */
const STOPWORDS = new Set(['los', 'las', 'les', 'una', 'uno', 'unos', 'unas', 'del', 'que', 'como', 'pero', 'por', 'con']);

// ---------------------------------------------------------------------------
// Texto: líneas y enmascarado
// ---------------------------------------------------------------------------

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function makeLineAt(starts) {
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Devuelve `{ masked, code }` con la MISMA longitud que el texto original: los literales
 * (comillas, plantillas, regex) y los comentarios quedan como espacios, conservando los
 * saltos de línea. Así los índices del original siguen siendo válidos y las líneas no se
 * desplazan, pero un `assert.ok(true)` escrito dentro de una cadena no cuenta como código.
 */
function maskSource(text) {
  const n = text.length;
  const out = new Array(n);
  const code = new Uint8Array(n);
  let mode = 'code'; // code | line | block | single | double | template | regex
  const tpl = []; // profundidad de llaves por cada `${ ... }` abierto
  let inClass = false;
  let i = 0;

  const put = (index, asCode) => {
    const ch = text[index];
    if (asCode) {
      out[index] = ch;
      code[index] = 1;
    } else {
      out[index] = ch === '\n' ? '\n' : ' ';
      code[index] = 0;
    }
  };

  const prevCodeChar = (from) => {
    for (let j = from - 1; j >= 0; j -= 1) {
      const ch = out[j];
      if (ch === undefined || /\s/.test(ch)) continue;
      return ch;
    }
    return '';
  };

  const regexAllowed = (from) => {
    const prev = prevCodeChar(from);
    if (prev === '') return true;
    if ('([{,;:=!&|?+-*%<>~^'.includes(prev)) return true;
    if (/[\w$]/.test(prev)) {
      const word = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(Math.max(0, from - 24), from));
      return word !== null && ['return', 'typeof', 'case', 'in', 'of', 'yield', 'await'].includes(word[1]);
    }
    return false;
  };

  while (i < n) {
    const ch = text[i];
    if (mode === 'code') {
      if (ch === '/' && text[i + 1] === '/') {
        put(i, false); put(i + 1, false); i += 2; mode = 'line'; continue;
      }
      if (ch === '/' && text[i + 1] === '*') {
        put(i, false); put(i + 1, false); i += 2; mode = 'block'; continue;
      }
      if (ch === "'") { put(i, false); i += 1; mode = 'single'; continue; }
      if (ch === '"') { put(i, false); i += 1; mode = 'double'; continue; }
      if (ch === '`') { put(i, false); i += 1; mode = 'template'; continue; }
      if (ch === '/' && regexAllowed(i)) { put(i, false); i += 1; inClass = false; mode = 'regex'; continue; }
      if (ch === '}' && tpl.length > 0) {
        if (tpl[tpl.length - 1] === 0) { tpl.pop(); put(i, false); i += 1; mode = 'template'; continue; }
        tpl[tpl.length - 1] -= 1;
      }
      if (ch === '{' && tpl.length > 0) tpl[tpl.length - 1] += 1;
      put(i, true);
      i += 1;
      continue;
    }
    if (mode === 'line') {
      put(i, false);
      if (ch === '\n') mode = 'code';
      i += 1;
      continue;
    }
    if (mode === 'block') {
      if (ch === '*' && text[i + 1] === '/') {
        put(i, false); put(i + 1, false); i += 2; mode = 'code'; continue;
      }
      put(i, false); i += 1; continue;
    }
    if (mode === 'single' || mode === 'double') {
      const quote = mode === 'single' ? "'" : '"';
      if (ch === '\\') { put(i, false); if (i + 1 < n) put(i + 1, false); i += 2; continue; }
      put(i, false);
      if (ch === quote || ch === '\n') mode = 'code';
      i += 1;
      continue;
    }
    if (mode === 'template') {
      if (ch === '\\') { put(i, false); if (i + 1 < n) put(i + 1, false); i += 2; continue; }
      if (ch === '`') { put(i, false); i += 1; mode = 'code'; continue; }
      if (ch === '$' && text[i + 1] === '{') {
        put(i, false); put(i + 1, false); i += 2; tpl.push(0); mode = 'code'; continue;
      }
      put(i, false); i += 1; continue;
    }
    // regex
    if (ch === '\\') { put(i, false); if (i + 1 < n) put(i + 1, false); i += 2; continue; }
    put(i, false);
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) { i += 1; mode = 'code'; continue; }
    else if (ch === '\n') { mode = 'code'; i += 1; continue; }
    i += 1;
  }

  return { masked: out.join(''), code };
}

/** Índice del cierre que equilibra la apertura en `open`, sobre el texto enmascarado. */
function matchBracket(masked, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') stack.push(pairs[ch]);
    else if (ch === ')' || ch === ']' || ch === '}') {
      const want = stack.pop();
      if (want !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Trozos separados por comas de primer nivel dentro de [start, end). */
function splitArgs(masked, start, end) {
  const parts = [];
  let depth = 0;
  let pieceStart = start;
  for (let i = start; i < end; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push({ start: pieceStart, end: i });
      pieceStart = i + 1;
    }
  }
  parts.push({ start: pieceStart, end });
  return parts;
}

// ---------------------------------------------------------------------------
// Lectura de ficheros
// ---------------------------------------------------------------------------

function walkTests(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkTests(path, out);
    else if (entry.name.endsWith('.test.mjs')) out.push(path);
  }
  return out;
}

function sourceFiles(root) {
  const tests = walkTests(join(root, 'tests'));
  const toolsDir = join(root, 'tools');
  let tools = [];
  try {
    tools = readdirSync(toolsDir)
      .filter((name) => name.endsWith('.mjs') && name !== 'testquality.mjs')
      .sort()
      .map((name) => join(toolsDir, name));
  } catch {
    tools = [];
  }
  return [...tests, ...tools];
}

// ---------------------------------------------------------------------------
// Aserciones y bloques de prueba
// ---------------------------------------------------------------------------

/**
 * Nombres locales de aserción. Reconoce el import por defecto (`assert`) y el
 * desestructurado (`import { equal, ok } from 'node:assert/strict'`), que es el estilo de
 * media suite: ignorarlo produciría «cero aserciones» falsos.
 */
function assertionNames(text) {
  const names = new Map();
  const re = /import\s+([^;\n]+?)\s+from\s+['"]node:assert(?:\/strict)?['"]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const spec = match[1].trim();
    if (spec.startsWith('{')) {
      for (const item of spec.replace(/^\{|\}$/g, '').split(',')) {
        const pieces = item.trim().split(/\s+as\s+/);
        const original = (pieces[0] ?? '').trim();
        const local = (pieces[1] ?? original).trim();
        // `import { strict as assert }` es el estilo mayoritario: el espacio de nombres completo.
        if (original === 'strict' && local) names.set(local, '*');
        else if (ASSERT_METHODS.includes(original) && local) names.set(local, original);
      }
    } else if (spec.startsWith('*')) {
      const local = spec.split(/\s+as\s+/)[1];
      if (local) names.set(local.trim(), '*');
    } else {
      names.set(spec.replace(/\s+as\s+.*$/, '').trim(), '*');
    }
  }
  // `const { equal, ok } = assert;` es otro estilo real de la suite: hereda del espacio de nombres.
  const aliasRe = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;
  let alias;
  while ((alias = aliasRe.exec(text)) !== null) {
    if (names.get(alias[2]) !== '*') continue;
    for (const item of alias[1].split(',')) {
      const pieces = item.trim().split(/\s*:\s*/);
      const original = (pieces[0] ?? '').trim();
      const local = (pieces[1] ?? original).trim();
      if (original === 'strict' && local) names.set(local, '*');
      else if (ASSERT_METHODS.includes(original) && local) names.set(local, original);
    }
  }
  return names;
}

function extractAssertions(text, masked, start, end, names) {
  const found = [];
  for (const [local, method] of names) {
    const pattern = method === '*'
      ? new RegExp(`\\b${escapeRe(local)}\\s*\\.\\s*(${ASSERT_METHODS.join('|')})\\s*\\(`, 'g')
      : new RegExp(`(?<![.\\w$])${escapeRe(local)}\\s*\\(`, 'g');
    pattern.lastIndex = start;
    let match;
    while ((match = pattern.exec(masked)) !== null && match.index < end) {
      const open = match.index + match[0].length - 1;
      if (masked[open] !== '(') continue;
      const close = matchBracket(masked, open);
      if (close < 0 || close > end) continue;
      const args = splitArgs(masked, open + 1, close).map((part) => ({
        start: part.start,
        end: part.end,
        text: maskTrim(text.slice(part.start, part.end)),
      }));
      found.push({
        offset: match.index,
        open,
        close,
        method: method === '*' ? match[1] : method,
        args,
        line: null,
      });
    }
  }
  const seen = new Set();
  return found
    .filter((item) => {
      if (seen.has(item.open)) return false;
      seen.add(item.open);
      return true;
    })
    .sort((a, b) => a.offset - b.offset);
}

function maskTrim(value) {
  return value.trim();
}

function ifRanges(masked, start, end) {
  const ranges = [];
  const re = /\bif\s*\(/g;
  re.lastIndex = start;
  let match;
  while ((match = re.exec(masked)) !== null && match.index < end) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(masked, open);
    if (close < 0 || close > end) continue;
    const cond = masked.slice(open + 1, close);
    let cursor = close + 1;
    while (cursor < end && /\s/.test(masked[cursor])) cursor += 1;
    if (masked[cursor] === '{') {
      const blockClose = matchBracket(masked, cursor);
      if (blockClose > 0) ranges.push({ start: cursor, end: blockClose, cond });
    } else {
      let stop = masked.indexOf(';', cursor);
      if (stop < 0 || stop > end) stop = end;
      ranges.push({ start: cursor, end: stop, cond });
    }
    re.lastIndex = close;
  }
  const elseRe = /\belse\b/g;
  elseRe.lastIndex = start;
  while ((match = elseRe.exec(masked)) !== null && match.index < end) {
    let cursor = match.index + 4;
    while (cursor < end && /\s/.test(masked[cursor])) cursor += 1;
    if (masked.startsWith('if', cursor)) continue;
    if (masked[cursor] === '{') {
      const blockClose = matchBracket(masked, cursor);
      if (blockClose > 0) ranges.push({ start: cursor, end: blockClose, cond: '' });
    }
  }
  return ranges;
}

function collectTests(text) {
  const { masked, code } = maskSource(text);
  const starts = lineStarts(text);
  const lineAt = makeLineAt(starts);
  const names = assertionNames(text);
  const tests = [];
  const re = /\b(test|it|describe)\b/g;
  let match;
  while ((match = re.exec(masked)) !== null) {
    if (!code[match.index]) continue;
    const before = masked[match.index - 1];
    // `algo.test(texto)` no declara una prueba: el `.` y los identificadores lo delatan.
    if (before !== undefined && (before === '.' || /[\w$]/.test(before))) continue;
    if (match[1] === 'describe') continue;
    let cursor = match.index + match[1].length;
    let modifier = null;
    const mod = /^\.(only|skip|todo)/.exec(masked.slice(cursor, cursor + 16));
    if (mod !== null) {
      modifier = mod[1];
      cursor += mod[0].length;
    }
    while (cursor < masked.length && /\s/.test(masked[cursor])) cursor += 1;
    if (masked[cursor] !== '(') continue;
    const close = matchBracket(masked, cursor);
    if (close < 0) continue;
    const args = splitArgs(masked, cursor + 1, close);
    const rawName = text.slice(args[0].start, args[0].end).trim();
    const name = rawName.replace(/^['"`]|['"`]$/g, '');
    const body = args[1] ?? null;
    const bodyStart = body === null ? close : body.start;
    const bodyEnd = body === null ? close : body.end;
    const assertions = extractAssertions(text, masked, bodyStart, bodyEnd, names);
    const ranges = ifRanges(masked, bodyStart, bodyEnd);
    for (const assertion of assertions) {
      assertion.line = lineAt(assertion.offset);
      assertion.conditional = ranges.some((range) => assertion.offset > range.start && assertion.offset < range.end);
    }
    tests.push({
      name,
      modifier,
      line: lineAt(match.index),
      bodyStart,
      bodyEnd,
      bodyMasked: masked.slice(bodyStart, bodyEnd),
      bodyText: text.slice(bodyStart, bodyEnd),
      assertions,
      ranges,
      hasBody: body !== null,
    });
  }
  return tests;
}

// ---------------------------------------------------------------------------
// Hallazgos
// ---------------------------------------------------------------------------

function makeReporter(root) {
  const findings = [];
  return {
    findings,
    add(rule, severity, file, line, message) {
      findings.push({
        rule,
        severity,
        file: relative(root, file).split(sep).join('/'),
        line: Math.max(1, Number(line) || 1),
        message,
      });
    },
  };
}

const weakOk = (arg) => {
  if (/['"`]/.test(arg) || /\.(?:includes|match|startsWith|endsWith)\s*\(/.test(arg)) return false;
  const cleaned = arg
    .replace(/!==\s*(?:null|undefined)/g, ' ')
    .replace(/&&|\|\|/g, ' ');
  const parts = cleaned.split(/[^A-Za-z0-9_$.]+/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => part === parts[0]);
};

function normalizeName(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Literales de cadena del cuerpo de una prueba, con su offset, para saber si una aguja existe. */
function stringLiterals(text) {
  const out = [];
  const re = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    out.push({ index: match.index, value: match[0].slice(1, -1) });
  }
  return out;
}

function auditTest(file, test, reporter) {
  const { name, assertions, bodyMasked, bodyText } = test;
  const norm = normalizeName(name);
  const add = (rule, severity, message, line = test.line) => reporter.add(rule, severity, file, line, message);

  // --- SIEMPRE VERDE -------------------------------------------------------
  if (!test.hasBody || assertions.length === 0) {
    add('verde/sin-aserciones', 'alta', 'la prueba no ejecuta ninguna aserción: pasa haga lo que haga el producto');
  }
  if (assertions.length > 0 && assertions.every((assertion) => assertion.conditional)) {
    const guardedByResult = test.ranges.some((range) => /\.\s*ok\b/.test(range.cond));
    if (guardedByResult) {
      add(
        'verde/solo-condicional',
        'alta',
        'todas las aserciones viven dentro de un if sobre el resultado del producto: la prueba es verde tanto si la operación falla como si tiene éxito',
      );
    }
  }
  if (/\bt\s*\.\s*skip\s*\(|\btest\s*\.\s*skip\s*\(/.test(bodyMasked)) {
    add('verde/prueba-omitible', 'baja', 'la prueba se declara omitible (t.skip): una omisión también deja la suite en verde y esa conducta no queda medida');
  }

  // --- TAUTOLOGÍAS ---------------------------------------------------------
  const serialized = new Set();
  const serializedRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*JSON\s*\.\s*stringify\s*\(/g;
  let serializedMatch;
  while ((serializedMatch = serializedRe.exec(bodyText)) !== null) serialized.add(serializedMatch[1]);

  const tautologyOffsets = new Set();
  for (const assertion of assertions) {
    const args = assertion.args;
    if (args.length === 0) continue;
    const first = args[0].text;
    if (assertion.method === 'ok' && /^(?:true|1)$/.test(first)) {
      const guard = test.ranges.find((range) => assertion.offset > range.start && assertion.offset < range.end);
      // Los offsets de las aserciones son absolutos; bodyMasked empieza en bodyStart.
      const after = guard === undefined
        ? ''
        : bodyMasked.slice(assertion.close - test.bodyStart, guard.end - test.bodyStart);
      if (guard !== undefined && /\breturn\b/.test(after)) {
        add(
          'verde/salto-simulado',
          'alta',
          `assert.ok(${first}, …) seguido de return simula un salto: el runner lo cuenta como verde y la conducta queda sin medir (usa t.skip)`,
          assertion.line,
        );
      } else {
        add('tautologia/verdad-constante', 'alta', `assert.ok(${first}) no puede fallar: no mide ninguna conducta`, assertion.line);
      }
      tautologyOffsets.add(assertion.offset);
    }
    if (['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual'].includes(assertion.method) && args.length >= 2) {
      const left = args[0].text.replace(/\s+/g, '');
      const right = args[1].text.replace(/\s+/g, '');
      // Dos invocaciones idénticas (p. ej. `shortHash('hola')`) sí pueden diferir: son una sonda
      // débil de determinismo, no una comparación literal del mismo valor. Sólo se marca lo simple.
      const invokes = /[()]/.test(left);
      if (left.length > 0 && left === right && !invokes) {
        add('tautologia/valor-contra-si-mismo', 'alta', `assert.${assertion.method} compara un valor consigo mismo (${args[0].text}): siempre pasa`, assertion.line);
        tautologyOffsets.add(assertion.offset);
      }
    }
    if (assertion.method === 'ok' && /^!/.test(first)) {
      const direct = /^!\s*JSON\s*\.\s*stringify\s*\(/.test(first);
      const viaVariable = /^!\s*([A-Za-z_$][\w$]*)\s*\.\s*includes\s*\(/.exec(first);
      const needle = /includes\s*\(\s*(['"`])([\s\S]*?)\1\s*\)/.exec(first);
      const suspiciousNeedle = needle !== null && /[()]|=>|\bfunction\b/.test(needle[2]);
      if (suspiciousNeedle && (direct || (viaVariable !== null && serialized.has(viaVariable[1])))) {
        add(
          'tautologia/json-stringify',
          'alta',
          'la aguja contiene una función y el receptor es JSON.stringify: las funciones no se serializan, así que la negación nunca puede fallar',
          assertion.line,
        );
        tautologyOffsets.add(assertion.offset);
      }
    }
  }

  // --- SUBSTRINGS FRÁGILES -------------------------------------------------
  // Los índices de los literales son relativos al cuerpo; las posiciones de las
  // aserciones son absolutas dentro del fichero. Se alinean antes de comparar.
  const literals = stringLiterals(bodyText).map((literal) => ({
    ...literal,
    index: literal.index + test.bodyStart,
  }));
  for (const assertion of assertions) {
    for (const arg of assertion.args) {
      // Aguja puramente numérica de uno o dos dígitos.
      const numeric = /\.\s*includes\s*\(\s*(['"])(\d{1,2})\1\s*\)/g;
      let numericMatch;
      while ((numericMatch = numeric.exec(arg.text)) !== null) {
        add(
          'fragil/aguja-numerica',
          numericMatch[2].length === 1 ? 'alta' : 'media',
          `la aguja '${numericMatch[2]}' es un número suelto: cualquier fecha, id u otro contador del árbol la satisface`,
          assertion.line,
        );
      }
      // Negación de algo que no aparece en ningún literal de la prueba.
      const negative = /!\s*[\w$.]+(?:\([^()]*\))?\s*\.\s*includes\s*\(\s*(['"])([^'"]*)\1\s*\)/g;
      let negativeMatch;
      while ((negativeMatch = negative.exec(arg.text)) !== null) {
        const needle = negativeMatch[2];
        if (tautologyOffsets.has(assertion.offset)) continue;
        if (needle.length === 0 || needle.length > 40) continue;
        if (STOPWORDS.has(needle) === false && needle.length > 8) continue;
        const elsewhere = literals.some(
          (literal) =>
            literal.value.includes(needle) &&
            !(literal.index >= assertion.open && literal.index <= assertion.close),
        );
        if (!elsewhere) {
          add(
            'fragil/negacion-vacua',
            'media',
            `afirma que no aparece '${needle}', pero esa aguja no está en ningún dato de la prueba: la aserción no puede fallar`,
            assertion.line,
          );
        }
      }
      // Separador POSIX sobre una ruta: el producto normaliza a '/', pero eso es un detalle.
      const posix = /\.\s*includes\s*\(\s*['"]\//g;
      let posixMatch;
      while ((posixMatch = posix.exec(arg.text)) !== null) {
        const receiver = arg.text.slice(0, posixMatch.index);
        if (/cwd|path|dir|route/i.test(receiver)) {
          add(
            'fragil/separador-posix',
            'media',
            "filtra una ruta con includes('/…'): depende de que el producto normalice a separadores POSIX y no de la conducta",
            assertion.line,
          );
          break;
        }
      }
    }
  }

  // --- ERRORES TRAGADOS ----------------------------------------------------
  // Separador POSIX también fuera de una aserción: `filter((p) => String(p.cwd).includes('/z-'))`
  // fija la prueba a la normalización del producto, no a la conducta.
  const bodyPosix = /\.\s*includes\s*\(\s*['"]\//g;
  let bodyPosixMatch;
  // Se escanea el texto crudo: en la máscara los literales son espacios y la
  // comilla que abre la ruta ya no se ve.
  while ((bodyPosixMatch = bodyPosix.exec(bodyText)) !== null) {
    const receiver = bodyText.slice(Math.max(0, bodyPosixMatch.index - 60), bodyPosixMatch.index);
    if (/cwd|path|dir|route/i.test(receiver)) {
      add(
        'fragil/separador-posix',
        'media',
        "filtra una ruta con includes('/…'): depende de que el producto normalice a separadores POSIX y no de la conducta",
        lineOfOffset(bodyMasked, bodyPosixMatch.index, test),
      );
    }
  }
  const emptyCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
  let catchMatch;
  while ((catchMatch = emptyCatch.exec(bodyMasked)) !== null) {
    add('error/catch-vacio', 'alta', 'catch vacío: el error desaparece y la prueba sigue como si nada', lineOfOffset(bodyMasked, catchMatch.index, test));
  }
  const catchRe = /catch\s*(?:\([^)]*\))?\s*\{/g;
  while ((catchMatch = catchRe.exec(bodyMasked)) !== null) {
    const open = catchMatch.index + catchMatch[0].length - 1;
    const close = matchBracket(bodyMasked, open);
    if (close < 0) continue;
    const inner = bodyMasked.slice(open + 1, close);
    if (inner.replace(/\s+/g, '') === '') continue; // ya lo cubre catch-vacio
    if (!/\bassert\b|\bthrow\b|\bfail\b/.test(inner)) {
      add(
        'error/catch-sin-verificacion',
        'baja',
        'catch que no registra ni afirma nada sobre el error: si el producto falla por otra causa, la prueba sigue igual',
        lineOfOffset(bodyMasked, catchMatch.index, test),
      );
    }
  }
  const silentCatch = /\.\s*catch\s*\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|(?:null|undefined|false|0)\s*)\)/g;
  while ((catchMatch = silentCatch.exec(bodyMasked)) !== null) {
    add('error/promesa-silenciada', 'alta', 'una promesa se traga su error (catch vacío o que devuelve un valor neutro)', lineOfOffset(bodyMasked, catchMatch.index, test));
  }

  // --- COBERTURA APARENTE: espías que nadie lee ---------------------------
  const spyRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[\s*\]/g;
  let spyMatch;
  while ((spyMatch = spyRe.exec(bodyMasked)) !== null) {
    const name = spyMatch[1];
    const occurrences = [...bodyMasked.matchAll(new RegExp(`\\b${escapeRe(name)}\\b`, 'g'))].length;
    const pushes = [...bodyMasked.matchAll(new RegExp(`\\b${escapeRe(name)}\\s*\\.\\s*push\\s*\\(`, 'g'))].length;
    if (pushes > 0 && occurrences <= 1 + pushes) {
      add(
        'cobertura/espia-sin-leer',
        'alta',
        `el espía '${name}' acumula llamadas y nadie las lee: la prueba no verifica que la llamada ocurriera con el argumento correcto`,
        lineOfOffset(bodyMasked, spyMatch.index, test),
      );
    }
  }

  // --- NOMBRE QUE PROMETE MÁS QUE EL CUERPO -------------------------------
  if (/(avisa|muestra|pinta|dice|explica|nombra|rotula)/.test(norm)) {
    const allWeak = assertions.length > 0 && assertions.every((assertion) =>
      assertion.method === 'ok' ? weakOk(assertion.args[0]?.text ?? '') : assertion.method === 'doesNotThrow');
    if (allWeak) {
      add(
        'nombre/promete-aviso',
        'media',
        'el nombre promete un aviso o un texto visible y el cuerpo sólo comprueba que no lanza o que devuelve algo no nulo',
      );
    }
  }
  if (/(no escribe|no cambia|no modifica|no toca|sin tocar|intact)/.test(norm) && !/\bdom\b/.test(norm)) {
    // «No escribió» sólo se demuestra leyendo algo: bytes, hash, mtime o el estado releído.
    // Y el nombre tiene que hablar de algo persistente; «sin tocar el DOM» no es este caso.
    const persistent = /(almac|disco|fichero|store|centro|biblioteca|skill|versi|manifiest|ledger|historial|conocimiento|knowledge|proyecto|registro)/.test(norm);
    const evidence = /\b(?:readFileSync|readState|loadState|loadKnowledge|statSync|mtime|digest|sha256|fingerprint|readdirSync|existsSync|snapshot|bytes|hash)\b|\.\s*(?:assignments|skills|events|improvements|records|insights|decisions)\b/.test(bodyMasked);
    // Si además todo lo que afirma es «salió bien», no hay ninguna sonda del objeto protegido.
    const onlyOk = assertions.every((assertion) =>
      assertion.method === 'doesNotThrow' ||
      (assertion.method === 'ok' && weakOk(assertion.args[0]?.text ?? '')) ||
      ((/^(?:equal|strictEqual|deepEqual|deepStrictEqual)$/.test(assertion.method)) && /\.\s*ok\b/.test(assertion.args[0]?.text ?? '')));
    if (persistent && !evidence && assertions.length > 0 && onlyOk) {
      add(
        'nombre/promete-no-escritura',
        'media',
        'el nombre promete que no se escribió y lo único que afirma es que la llamada salió bien: no hay forma de saber si el objeto protegido cambió',
      );
    }
  }
  if (/(una vez|una sola vez|solo una vez)/.test(norm)) {
    // Contar es igual de válido con `.length === 1` que con un contador propio (`counters.list === 1`).
    if (!/\.\s*length\s*(?:===|==|,)\s*1\b|\.\s*length\s*!==\s*1\b|matchAll\s*\(|===?\s*1\b|,\s*1\s*[,)]/.test(bodyMasked)) {
      add(
        'nombre/promete-una-vez',
        'media',
        'el nombre promete una sola vez y el cuerpo no cuenta: una comparación >= 1 acepta dos inyecciones o dos llamadas',
      );
    }
  }
  if (/atomic/.test(norm)) {
    const evidence = /\b(?:tmp|rename|renameWithRetry|concurren|spawn|SIGKILL|interrump|child_process)\b/.test(bodyMasked);
    if (!evidence) {
      add(
        'nombre/promete-atomicidad',
        'alta',
        'el nombre promete atomicidad y el cuerpo no ejerce la ventana crítica (tmp/rename, lector concurrente o interrupción): una escritura directa pasaría igual',
      );
    }
  }
}

function lineOfOffset(bodyMasked, offset, test) {
  return test.line + bodyMasked.slice(0, offset).split('\n').length - 1;
}

// ---------------------------------------------------------------------------
// Reglas de fichero completo
// ---------------------------------------------------------------------------

function auditFile(file, text, reporter) {
  const rel = reporter.relative(file);
  const isTest = rel.startsWith('tests/');
  const starts = lineStarts(text);
  const lineAt = makeLineAt(starts);
  // Los literales de un fixture pueden CONTENER una ruta o una llamada como
  // texto; sólo cuenta el código real, así que estas reglas miran la máscara.
  const { masked } = maskSource(text);

  // Rutas de la máquina del autor: no se reproducen en otra máquina ni en CI.
  const userPath = /['"`]([A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^'"`\n]+|\/(?:home|Users)\/[^'"`\n]+)['"`]/g;
  let match;
  while ((match = userPath.exec(text)) !== null) {
    reporter.add('fragil/ruta-de-usuario', 'alta', file, lineAt(match.index), `ruta absoluta del perfil del autor (${match[1]}): la prueba no se reproduce fuera de esta máquina`);
  }

  // Lectura del almacén real: el resultado depende del estado productivo. Las guardas herméticas
  // que sólo fotografía el sha256 del almacén son legítimas y no cuentan.
  const fingerprinted = /\b(?:sha256|createHash|fingerprint|shaOf|digest)\b/.test(text);
  if (!fingerprinted && /\bhomedir\s*\(\s*\)/.test(masked) && /\.dsh/.test(text) && /lifecode-skill-center/.test(text)) {
    const at = masked.indexOf('homedir');
    reporter.add(
      'fragil/almacen-real',
      'media',
      file,
      lineAt(at),
      'la prueba lee el almacén real del usuario: el resultado depende del panel vivo y no es reproducible en otra máquina',
    );
  }

  // Aserciones sobre el texto fuente de otro fichero: acopladas a la implementación.
  const sourceText = /\b(?:source|raw|code|text)\s*\.\s*includes\s*\(/g;
  const hits = [...masked.matchAll(sourceText)];
  if (hits.length >= 3) {
    reporter.add(
      'fragil/texto-fuente',
      isTest ? 'media' : 'baja',
      file,
      lineAt(hits[0].index),
      `${hits.length} aserciones sobre el texto fuente del producto: un refactor legítimo las rompe y un cambio de conducta con el mismo texto pasa`,
    );
  }
}

function auditCoverage(files, reporter, root) {
  const corpus = files.map((file) => file.text).join('\n');
  for (const route of CRITICAL_ROUTES) {
    if (!route.token.test(corpus)) {
      reporter.add(
        'cobertura/ruta-sin-negativa',
        'alta',
        join(root, route.anchor),
        1,
        route.message,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Catálogo de mutantes
// ---------------------------------------------------------------------------

function decodeLiteral(raw) {
  const body = raw.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') { out += ch; continue; }
    const next = body[i + 1];
    i += 1;
    switch (next) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case '\n': break;
      case 'u': {
        const hex = body.slice(i + 1, i + 5);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      case 'x': {
        const hex = body.slice(i + 1, i + 3);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
        break;
      }
      default: out += next ?? '';
    }
  }
  return out;
}

function literalAfter(block, key) {
  const re = new RegExp(`\\b${key}\\s*:`);
  const found = re.exec(block);
  if (found === null) return null;
  let i = found.index + found[0].length;
  while (i < block.length && /\s/.test(block[i])) i += 1;
  const quote = block[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let j = i + 1;
  for (; j < block.length; j += 1) {
    if (block[j] === '\\') { j += 1; continue; }
    if (block[j] === quote) break;
  }
  if (j >= block.length) return null;
  const raw = block.slice(i, j + 1);
  return { value: decodeLiteral(raw), line: block.slice(0, found.index).split('\n').length };
}

function auditMutationCatalog(file, text, root, reporter) {
  const { masked } = maskSource(text);
  const arrayAt = masked.search(/const\s+MUTANTS\s*=\s*\[/);
  if (arrayAt < 0) return;
  const open = masked.indexOf('[', arrayAt);
  const close = matchBracket(masked, open);
  if (close < 0) return;
  const starts = lineStarts(text);
  const lineAt = makeLineAt(starts);
  const blocks = [];
  let depth = 0;
  let blockStart = -1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = masked[i];
    if (ch === '{') {
      if (depth === 0) blockStart = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && blockStart >= 0) {
        blocks.push({ start: blockStart, end: i + 1 });
        blockStart = -1;
      }
    }
  }
  const ids = new Map();
  for (const block of blocks) {
    const raw = text.slice(block.start, block.end);
    const idMatch = /\bid\s*:\s*'([^']+)'/.exec(raw);
    if (idMatch === null) continue;
    const id = idMatch[1];
    const lineMatch = /\bline\s*:\s*(\d+)/.exec(raw);
    const declaredLine = lineMatch === null ? null : Number(lineMatch[1]);
    const fileMatch = /\bfile\s*:\s*'([^']+)'/.exec(raw);
    const coversMatch = /\bcovers\s*:\s*'((?:[^'\\]|\\.)*)'/.exec(raw);
    const covers = coversMatch === null ? null : coversMatch[1];
    const coversLine = coversMatch === null ? lineAt(block.start) : lineAt(block.start + raw.indexOf('covers'));
    const declaredAt = lineAt(block.start);
    const find = literalAfter(raw, 'find');
    const replace = literalAfter(raw, 'replace');

    if (ids.has(id)) {
      reporter.add('mutante/id-duplicado', 'alta', file, declaredAt, `id '${id}' repetido: los resultados de dos mutantes se pisan en el informe`);
    }
    ids.set(id, true);

    if (covers !== null && /sin prueba|no hay prueba|sin cobertura/i.test(covers)) {
      reporter.add(
        'mutante/hueco-declarado',
        'media',
        file,
        coversLine,
        `el catálogo declara que '${id}' no tiene prueba que lo mate: o el mutante no tiene dueño, o el informe miente sobre la cobertura`,
      );
    }
    if (covers !== null) {
      for (const reference of covers.matchAll(/tests\/[\w./-]+\.test\.mjs/g)) {
        const path = resolve(root, reference[0]);
        if (!existsSync(path)) {
          reporter.add('mutante/cubre-inexistente', 'alta', file, coversLine, `'${id}' dice cubrirlo ${reference[0]}, que no existe`);
        }
      }
    }
    if (fileMatch === null || find === null || replace === null) continue;
    const target = resolve(root, fileMatch[1]);
    if (!existsSync(target)) {
      reporter.add('mutante/fichero-inexistente', 'alta', file, declaredAt, `'${id}' apunta a ${fileMatch[1]}, que no existe: nunca se aplica`);
      continue;
    }
    const original = readFileSync(target, 'utf8');
    if (find.value === replace.value) {
      reporter.add('mutante/identidad', 'alta', file, declaredAt, `'${id}' reemplaza el texto por sí mismo: es un mutante equivalente y no puede matarse`);
      continue;
    }
    const hits = original.split(find.value).length - 1;
    if (hits !== 1) {
      reporter.add(
        'mutante/no-unico',
        'alta',
        file,
        declaredAt,
        `'${id}': el patrón aparece ${hits} veces en ${fileMatch[1]} (se exige exactamente 1); el runner lo marca 'not-applicable' y la cobertura baja sin que nadie lo note`,
      );
      continue;
    }
    // La línea real se cuenta sobre el fichero MUTADO, no sobre el catálogo.
    const targetLineAt = makeLineAt(lineStarts(original));
    const actualLine = targetLineAt(original.indexOf(find.value));
    if (declaredLine !== null && declaredLine !== actualLine) {
      reporter.add(
        'mutante/linea-desviada',
        'media',
        file,
        declaredAt,
        `'${id}' declara ${fileMatch[1]}:${declaredLine} y muta realmente la línea ${actualLine}: el informe y el ` +
          '`covers` apuntan a otro sitio',
      );
    }
  }

  // «detectado» = cualquier salida distinta de 0: un error de sintaxis o un timeout también.
  // Sólo es ciego si se cree la salida entera: exigir pruebas fallando ya no lo es.
  const blind = /const\s+detected\s*=\s*run\s*\.\s*exitCode\s*!==\s*0\s*;/;
  const blindMatch = blind.exec(text);
  if (blindMatch !== null) {
    reporter.add(
      'mutante/deteccion-ciega',
      'alta',
      file,
      lineAt(blindMatch.index),
      'cualquier salida distinta de 0 cuenta como mutante detectado: un error de sintaxis, un timeout o un fallo de infraestructura también, y el mutante se apunta como muerto sin que ninguna prueba lo haya matado',
    );
  }
}

// ---------------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { root: resolve(HERE, '..'), json: false, rules: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--rules') args.rules = true;
    else if (arg === '--root') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--root necesita una ruta');
      args.root = resolve(value);
      i += 1;
    } else if (arg.startsWith('--root=')) {
      args.root = resolve(arg.slice('--root='.length));
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`argumento desconocido: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('node tools/testquality.mjs [--root <dir>] [--json] [--rules]\n');
    return;
  }
  if (args.rules) {
    process.stdout.write('Reglas: tautologia/* (alta), fragil/* (media salvo aguja de un dígito y ruta de usuario: alta), ' +
      'nombre/* (media salvo atomicidad: alta), error/catch-vacio y promesa-silenciada (alta), ' +
      'cobertura/* (alta), verde/* (alta salvo prueba-omitible: media), mutante/* (alta salvo linea-desviada y hueco-declarado: media).\n');
    return;
  }
  if (!existsSync(join(args.root, 'tests'))) {
    process.stderr.write(`✖ no hay tests/ bajo ${args.root}\n`);
    process.exitCode = 2;
    return;
  }

  const reporter = makeReporter(args.root);
  reporter.relative = (file) => relative(args.root, file).split(sep).join('/');
  const files = sourceFiles(args.root).map((file) => ({ file, text: readFileSync(file, 'utf8') }));

  for (const { file, text } of files) {
    const rel = reporter.relative(file);
    auditFile(file, text, reporter);
    // Sólo las pruebas se juzgan como pruebas: tools/ tiene su propia regla (catálogo).
    if (rel.startsWith('tests/')) {
      let tests = [];
      try {
        tests = collectTests(text);
      } catch {
        reporter.add('analisis/fichero-ilegible', 'media', file, 1, 'el escáner no pudo equilibrar este fichero; no se juzgan sus pruebas');
        continue;
      }
      for (const test of tests) auditTest(file, test, reporter);
    } else if (rel.endsWith('tools/mutation.mjs') || rel === 'tools/mutation.mjs') {
      auditMutationCatalog(file, text, args.root, reporter);
    }
  }
  auditCoverage(files, reporter, args.root);

  const findings = reporter.findings
    .filter((finding, index, all) =>
      all.findIndex((other) =>
        other.rule === finding.rule && other.file === finding.file && other.line === finding.line) === index)
    .sort((a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule));

  const summary = {
    alta: findings.filter((finding) => finding.severity === 'alta').length,
    media: findings.filter((finding) => finding.severity === 'media').length,
    baja: findings.filter((finding) => finding.severity === 'baja').length,
    files: files.length,
    tests: files.filter((entry) => reporter.relative(entry.file).startsWith('tests/')).length,
    tools: files.filter((entry) => !reporter.relative(entry.file).startsWith('tests/')).length,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ root: args.root, summary, findings }, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push(`Test Quality Auditor — ${summary.tests} fichero(s) de prueba, ${summary.tools} herramienta(s) en ${args.root}`);
    lines.push('');
    for (const finding of findings) {
      lines.push(`[${finding.severity.toUpperCase().padEnd(5)}] ${finding.rule.padEnd(29)} ${finding.file}:${finding.line}`);
      lines.push(`          ${finding.message}`);
    }
    if (findings.length === 0) lines.push('sin hallazgos.');
    lines.push('');
    lines.push(`Resumen: ${summary.alta} alta(s), ${summary.media} media(s), ${summary.baja} baja(s)`);
    lines.push(summary.alta > 0 ? '✖ hay hallazgos de severidad alta: la suite puede dar verde con una implementación incorrecta' : '✓ sin hallazgos de severidad alta');
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  process.exitCode = summary.alta > 0 ? 1 : 0;
}

main();
