// El informe del centro es un derivado: estas pruebas vigilan las dos cosas que pueden salir mal sin
// que se note — que exportar toque el almacén, y que el informe diga cosas que el documento no dice.
import { equal, ok } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { handleApiRequest, runAction } from '../lib/api.mjs';
import { buildCenterReport, reportStamp, reportsRoot, writeCenterReport } from '../lib/export.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';
import { tempRoot, autonomyRoot } from './helpers.mjs';

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Un centro mínimo pero con todas las entidades que el informe debe saber pintar. */
function seededStore(root) {
  const now = '2026-11-09T02:00:00.000Z';
  const state = emptyState(now);
  state.skills = {
    'revisar-un-plugin': {
      id: 'revisar-un-plugin',
      title: 'Revisar un plugin',
      currentVersion: '1.1.0',
      tags: ['dsh'],
      description: 'Revisa un plugin antes de instalarlo',
      whenToUse: 'Cuando vayas a instalar un plugin',
      createdAt: now,
      updatedAt: now,
      origin: { kind: 'ai' },
      versions: [
        { version: '1.0.0', createdAt: now, body: '# A\n\nuno', checksum: 'a'.repeat(64), evaluation: { status: 'pass', score: 92 } },
        { version: '1.1.0', createdAt: now, body: '# A\n\ndos', checksum: 'b'.repeat(64), evaluation: { status: 'pass', score: 100 } },
      ],
    },
  };
  state.projects = {
    'proyecto-a': { id: 'proyecto-a', name: 'proyecto-a', cwd: 'C:/tmp/proyecto-a', createdAt: now },
    'proyecto-b': { id: 'proyecto-b', name: 'proyecto-b', cwd: 'C:/tmp/proyecto-b', createdAt: now },
  };
  state.assignments = {
    'proyecto-a': { 'revisar-un-plugin': { enabled: true, version: '1.1.0', pinnedAt: now, by: 'human' } },
    'proyecto-b': { 'revisar-un-plugin': { enabled: false, version: '1.0.0', pinnedAt: now, by: 'human' } },
  };
  state.improvements = {
    'imp-1': {
      id: 'imp-1',
      skillId: 'revisar-un-plugin',
      status: 'approved',
      version: '1.1.0',
      decidedBy: 'human',
      createdAt: now,
      decidedAt: now,
    },
  };
  state.requests = {
    'req-1': {
      id: 'req-1',
      text: 'necesito una comprobación de la puerta hermética',
      status: 'fulfilled',
      skillId: 'revisar-un-plugin',
      createdAt: now,
    },
  };
  saveState(root, state, { now });
  return state;
}

test('el informe pinta la biblioteca, las versiones, las asignaciones, las mejoras y las peticiones', () => {
  const root = autonomyRoot('lsc-export');
  try {
    seededStore(root);
    const written = writeCenterReport({ root, state: loadState(root).state, now: '2026-11-09T02:10:11.250Z' });
    equal(written.ok, true, written.message);
    equal(written.file, join(reportsRoot(root), 'center-20261109-021011-250.md'));
    ok(existsSync(written.file), 'el informe debe existir');
    const text = readFileSync(written.file, 'utf8');

    ok(text.includes('# LifeCode Skill Center — informe del centro'), 'cabecera');
    ok(text.includes('## Resumen') && text.includes('## Biblioteca') && text.includes('## Versiones por skill'));
    ok(text.includes('## Asignaciones por proyecto') && text.includes('## Mejoras') && text.includes('## Peticiones humanas'));
    ok(text.includes('encendida 1.1.0') && text.includes('apagada 1.0.0'), 'las dos asignaciones se distinguen');
    ok(text.includes('revisar-un-plugin') && text.includes('1.1.0'));
    // El documento real guarda la nota en `evaluation.score`: el informe debe leerla de ahí.
    ok(text.includes('100/100'), 'la calidad de la versión vigente aparece con su nota');
    ok(/\| 1\.1\.0 \| 100 \|/.test(text), 'la tabla de biblioteca trae la nota de la vigente');
    ok(!/\| 1\.0\.0 \| 92 \|/.test(text), 'la tabla no lista versiones antiguas como si fueran la vigente');
    ok(text.includes('1.0.0 · 92/100'), 'cada versión lleva su nota en el histórico');
    ok(text.includes('necesito una comprobación de la puerta hermética'));
    ok(text.includes('derivado'), 'el informe declara que es derivado');
    ok(written.sha256 === sha(written.file), 'el hash devuelto es el del fichero');
    equal(written.bytes, statSync(written.file).size);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('la marca de tiempo del informe es apta para un nombre de fichero', () => {
  equal(reportStamp('2026-11-09T02:10:11.250Z'), '20261109-021011-250');
  equal(reportStamp('2026-11-09T02:10:11Z'), '20261109-021011-000');
  equal(reportStamp('sin fecha'), 'sin-fecha');
});

test('exportar no toca el almacén: mismo hash y mismo tamaño antes y después', () => {
  const root = autonomyRoot('lsc-export-safe');
  try {
    seededStore(root);
    const file = join(root, 'center.json');
    const before = { sha: sha(file), size: statSync(file).size };
    for (let index = 0; index < 3; index += 1) {
      const result = runAction({ root, action: 'export', payload: {}, actor: 'human', now: `2026-11-09T02:20:0${index}.000Z` });
      equal(result.ok, true, result.message);
    }
    equal(sha(file), before.sha, 'el documento del centro no cambia');
    equal(statSync(file).size, before.size);
    const reports = readdirSync(reportsRoot(root)).filter((name) => name.endsWith('.md'));
    equal(reports.length, 3, 'un informe por exportación');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('la IA no exporta: el informe lo pide una persona', () => {
  const root = autonomyRoot('lsc-export-ai');
  try {
    seededStore(root);
    const result = runAction({ root, action: 'export', payload: {}, actor: 'ai' });
    equal(result.ok, false);
    equal(result.code, 'approval-required');
    ok(!existsSync(reportsRoot(root)), 'sin exportación no debe quedar la carpeta');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('con el almacén ilegible no se exporta un informe vacío: se conserva el documento', () => {
  const root = autonomyRoot('lsc-export-broken');
  try {
    seededStore(root);
    const file = join(root, 'center.json');
    truncateSync(file, 40);
    const before = sha(file);
    const result = runAction({ root, action: 'export', payload: {}, actor: 'human' });
    equal(result.ok, false);
    equal(result.code, 'store-unreadable');
    equal(sha(file), before, 'el documento dañado queda intacto');
    ok(!existsSync(reportsRoot(root)), 'no se escribe informe de un almacén ilegible');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('el informe no inventa diagnóstico cuando no se le pasa', () => {
  const text = buildCenterReport({ state: emptyState('2026-11-09T02:00:00.000Z'), now: '2026-11-09T02:00:00.000Z' });
  ok(text.includes('No se pidió diagnóstico'), 'lo dice en vez de fabricar cifras');
  ok(text.includes('_La biblioteca está vacía._'));
  ok(text.includes('_Ningún proyecto registrado._'));
});

test('la ruta HTTP de exportar contesta 200 con la ruta del informe y no cambia el estado', () => {
  const root = autonomyRoot('lsc-export-http');
  try {
    seededStore(root);
    const file = join(root, 'center.json');
    const before = sha(file);
    const result = handleApiRequest({
      root,
      method: 'POST',
      pathname: '/lifecode-skill-center/api',
      body: { action: 'export', payload: {} },
      now: '2026-11-09T02:30:00.000Z',
    });
    equal(result.status, 200, result.body?.message);
    const payload = result.body;
    equal(payload.ok, true, payload.message);
    equal(payload.exported, true);
    ok(payload.file.startsWith(reportsRoot(root)), 'el informe se queda dentro de la raíz del centro');
    ok(payload.sha256 === sha(payload.file));
    equal(sha(file), before, 'el POST de exportar no reescribe el documento');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
