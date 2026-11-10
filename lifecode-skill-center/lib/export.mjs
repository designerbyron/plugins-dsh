/**
 * El informe del centro, como documento derivado.
 *
 * Qué es: un Markdown legible que responde «¿qué hay en este centro y en qué estado?» sin abrir el
 * panel ni leer el JSON. Qué no es: una fuente de verdad. Nada de lo que se escribe aquí se vuelve a
 * leer para decidir(1), y el almacén `center.json` no se modifica al exportar(2).
 *
 * (1) La razón es la misma que con `materialized/`: si un documento generado pudiera alimentar el
 *     estado, dos derivados acabarían discrepando y no habría forma de saber cuál manda.
 * (2) El informe escribe SÓLO en `reports/`, dentro de la raíz del centro, con nombre único: dos
 *     exportaciones en el mismo segundo no se pisan (`flag:'wx'`). Si esa carpeta no se puede crear,
 *     el resultado es un error explícito, no un informe a medias.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** La carpeta de informes. Derivada: se puede borrar sin perder nada. */
export function reportsRoot(root) {
  return join(root, 'reports');
}

/** Marca de tiempo apta para nombre de fichero: `20261109-013045-812`. */
export function reportStamp(now = new Date().toISOString()) {
  const text = String(now);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(text);
  if (match === null) return 'sin-fecha';
  const [, year, month, day, hour, minute, second, millis = '0'] = match;
  return `${year}${month}${day}-${hour}${minute}${second}-${String(millis).padEnd(3, '0').slice(0, 3)}`;
}

const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function table(headers, rows) {
  const head = `| ${headers.map(escapeCell).join(' | ')} |`;
  const rule = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`);
  return [head, rule, ...body].join('\n');
}

const sortedValues = (record) => Object.values(record ?? {});

/** La puntuación de una versión: el documento la guarda dentro de `evaluation`, no en la raíz. */
function scoreOf(version) {
  const candidates = [version?.score, version?.evaluation?.score, version?.evaluation?.total];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/** El estado de la evaluación, con el mismo criterio: primero la raíz, luego `evaluation`. */
function statusOf(version) {
  const value = version?.status ?? version?.evaluation?.status;
  return typeof value === 'string' ? value : '';
}

/**
 * El texto del informe. Función pura: recibe el documento ya normalizado y devuelve Markdown.
 * `diagnostics` es opcional y, si falta, el informe lo dice en vez de inventar cifras.
 */
export function buildCenterReport({ state = {}, now = new Date().toISOString(), root = '', diagnostics = null } = {}) {
  const skills = sortedValues(state.skills).sort((left, right) => String(left.title ?? left.id).localeCompare(String(right.title ?? right.id)));
  const projects = sortedValues(state.projects).sort((left, right) => String(left.name ?? left.id).localeCompare(String(right.name ?? right.id)));
  const improvements = sortedValues(state.improvements);
  const requests = sortedValues(state.requests);
  const events = Array.isArray(state.events) ? state.events : [];
  const assignments = state.assignments ?? {};

  const activePairs = [];
  for (const [projectId, row] of Object.entries(assignments)) {
    for (const [skillId, assignment] of Object.entries(row ?? {})) {
      if (assignment?.enabled === true) activePairs.push({ projectId, skillId, version: assignment.version ?? '' });
    }
  }

  const lines = [];
  lines.push('# LifeCode Skill Center — informe del centro');
  lines.push('');
  lines.push(`- Generado: ${now}`);
  if (root !== '') lines.push(`- Raíz del centro: \`${root}\``);
  lines.push(`- Esquema del documento: v${state.schemaVersion ?? '?'}`);
  lines.push('- Este documento es **derivado**: se genera a partir del almacén y no lo modifica. El centro sigue mandando.');
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push(table(
    ['Qué', 'Cuánto'],
    [
      ['Skills publicadas', skills.length],
      ['Versiones', skills.reduce((total, skill) => total + (Array.isArray(skill.versions) ? skill.versions.length : 0), 0)],
      ['Proyectos registrados', projects.length],
      ['Asignaciones encendidas', activePairs.length],
      ['Propuestas de mejora', improvements.length],
      ['Peticiones humanas', requests.length],
      ['Eventos en el diario', events.length],
    ],
  ));
  lines.push('');
  lines.push('## Biblioteca');
  lines.push('');
  if (skills.length === 0) {
    lines.push('_La biblioteca está vacía._');
  } else {
    const rows = skills.map((skill) => {
      const versions = Array.isArray(skill.versions) ? skill.versions : [];
      const current = versions.find((version) => version.version === skill.currentVersion) ?? null;
      const active = activePairs.filter((pair) => pair.skillId === skill.id).length;
      return [
        skill.title ?? skill.id,
        `\`${skill.id}\``,
        skill.currentVersion ?? '—',
        current === null ? '—' : String(scoreOf(current) ?? '—'),
        versions.length,
        active,
      ];
    });
    lines.push(table(['Skill', 'Id', 'Vigente', 'Calidad', 'Versiones', 'Proyectos'], rows));
  }
  lines.push('');
  lines.push('## Versiones por skill');
  lines.push('');
  if (skills.length === 0) {
    lines.push('_Sin versiones._');
  } else {
    for (const skill of skills) {
      const versions = Array.isArray(skill.versions) ? skill.versions : [];
      const marks = versions.map((version) => {
        const score = scoreOf(version);
        const state = statusOf(version);
        const tags = [version.version, score === null ? '' : `${score}/100`, state, version.createdAt ?? '']
          .filter((part) => part !== '');
        return `\`${tags.join(' · ')}\``;
      });
      lines.push(`- **${skill.title ?? skill.id}** (vigente ${skill.currentVersion ?? '—'}): ${marks.join(', ') || 'sin versiones'}`);
    }
  }
  lines.push('');
  lines.push('## Asignaciones por proyecto');
  lines.push('');
  if (projects.length === 0) {
    lines.push('_Ningún proyecto registrado._');
  } else {
    const headers = ['Proyecto', 'Ruta', ...skills.map((skill) => skill.title ?? skill.id)];
    const rows = projects.map((project) => [
      project.name ?? project.id,
      project.cwd ?? '',
      ...skills.map((skill) => {
        const assignment = (assignments[project.id] ?? {})[skill.id];
        if (assignment === undefined || assignment === null) return '·';
        const version = assignment.version ?? '—';
        return assignment.enabled === true ? `encendida ${version}` : `apagada ${version}`;
      }),
    ]);
    lines.push(table(headers, rows));
    lines.push('');
    lines.push('Punto: el proyecto no tiene esa skill. Apagada: la tiene desactivada. El número es la versión fijada.');
  }
  lines.push('');
  lines.push('## Mejoras');
  lines.push('');
  if (improvements.length === 0) {
    lines.push('_No hay propuestas registradas._');
  } else {
    lines.push(table(
      ['Skill', 'Estado', 'Versión', 'Decidida por', 'Fecha'],
      improvements.map((entry) => [
        entry.skillId ?? '',
        entry.status ?? '',
        entry.version ?? '—',
        entry.decidedBy ?? '—',
        entry.decidedAt ?? entry.createdAt ?? '',
      ]),
    ));
  }
  lines.push('');
  lines.push('## Peticiones humanas');
  lines.push('');
  if (requests.length === 0) {
    lines.push('_No hay peticiones registradas._');
  } else {
    lines.push(table(
      ['Id', 'Texto', 'Estado', 'Skill', 'Creada'],
      requests.map((entry) => [
        entry.id ?? '',
        entry.text ?? '',
        entry.status ?? '',
        entry.skillId ?? '—',
        entry.createdAt ?? '',
      ]),
    ));
  }
  lines.push('');
  lines.push('## Diario reciente');
  lines.push('');
  const recent = events.slice(-20).reverse();
  if (recent.length === 0) {
    lines.push('_Sin eventos._');
  } else {
    lines.push(table(
      ['Fecha', 'Tipo', 'Sujeto', 'Actor'],
      recent.map((event) => [
        event.at ?? event.createdAt ?? '',
        event.type ?? '',
        event.skillId ?? event.projectId ?? '',
        event.actor ?? '',
      ]),
    ));
  }
  lines.push('');
  lines.push('## Diagnóstico');
  lines.push('');
  if (diagnostics === null || typeof diagnostics !== 'object') {
    lines.push('_No se pidió diagnóstico en esta exportación: el informe no inventa cifras._');
  } else {
    if (typeof diagnostics.integrity === 'string') lines.push(`- Integridad del almacén: **${diagnostics.integrity}**`);
    if (typeof diagnostics.sha256 === 'string' && diagnostics.sha256 !== '') lines.push(`- SHA-256: \`${diagnostics.sha256}\``);
    if (typeof diagnostics.size === 'number') lines.push(`- Tamaño: ${diagnostics.size} B`);
    if (Array.isArray(diagnostics.checks) === true) {
      lines.push('');
      lines.push(table(
        ['Comprobación', 'Estado', 'Detalle'],
        diagnostics.checks.map((check) => [check.name ?? check.id ?? '', check.status ?? '', check.detail ?? '']),
      ));
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Para volver atrás no hace falta este informe: las copias verificadas viven en `backups/` y se restauran desde el panel.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Escribe el informe y devuelve su ruta, tamaño y hash. No toca el almacén: si falla la escritura, se
 * informa el error y no queda ningún fichero a medias (`wx` no sobrescribe y un fallo de `write` borra
 * lo que se hubiera creado; ver el `try`).
 */
export function writeCenterReport({ root, state, now = new Date().toISOString(), diagnostics = null, mkdir = mkdirSync, writeFile = writeFileSync } = {}) {
  if (typeof root !== 'string' || root.trim() === '') return { ok: false, code: 'bad-root', message: 'el centro no tiene raíz' };
  const directory = reportsRoot(root);
  const name = `center-${reportStamp(now)}.md`;
  const file = join(directory, name);
  const report = buildCenterReport({ state, now, root, diagnostics });
  try {
    mkdir(directory, { recursive: true });
    writeFile(file, report, { encoding: 'utf8', flag: 'wx' });
  } catch (failure) {
    const code = typeof failure?.code === 'string' ? failure.code : '';
    if (code === 'EEXIST') {
      return { ok: false, code: 'report-exists', message: 'ya hay un informe con esta marca de tiempo: vuelve a intentarlo en un segundo' };
    }
    return { ok: false, code: 'report-write-failed', message: `no se pudo escribir el informe: ${failure?.message ?? 'error desconocido'}` };
  }
  return {
    ok: true,
    file,
    bytes: Buffer.byteLength(report, 'utf8'),
    sha256: createHash('sha256').update(report, 'utf8').digest('hex'),
    generatedAt: now,
  };
}
