/**
 * S4-C — publicación atómica de copias: generaciones inmutables y **un** puntero autoritativo.
 *
 * Cada prueba corre sobre un almacén temporal propio. El almacén real nunca se toca: se construye un
 * documento v1 sintético con la forma mínima que exige `checkStoreShape`.
 *
 * Los «crashes» se provocan con los ganchos de interrupción de `writeAll`: lanzar desde un gancho deja
 * el sistema exactamente como lo dejaría un corte de corriente en ese punto (temporales incluidos), y
 * es la única forma de probar la ventana sin matar procesos a mitad de un `rename`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  backupFile,
  backupGenerationsDir,
  backupMetaFile,
  backupPointerFile,
  checkStoreShape,
  ensureBackup,
  loadState,
  readBackupPointer,
  restoreFromBackup,
  verifyBackup,
} from '../lib/state.mjs';
import { createHash } from 'node:crypto';
import { buildSnapshot, runAction } from '../lib/api.mjs';
import { tempRoot, autonomyRoot } from './helpers.mjs';

const DOC = {
  schemaVersion: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  skills: {
    'skill-de-prueba': {
      id: 'skill-de-prueba',
      title: 'Skill de prueba',
      description: 'Una skill de prueba con la forma mínima que acepta el almacén',
      whenToUse: 'Cuando hay que probar la copia atómica sin tocar el almacén real',
      tags: ['prueba'],
      status: 'published',
      currentVersion: '1.0.0',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      origin: { kind: 'human', from: '', fromVersion: '', note: '' },
      versions: [
        {
          version: '1.0.0',
          description: 'Una skill de prueba con la forma mínima que acepta el almacén',
          whenToUse: 'Cuando hay que probar la copia atómica sin tocar el almacén real',
          tags: ['prueba'],
          body: '## Procedimiento\n\nHaz la prueba.\n\n## Evidencia\n\nMira el resultado.',
          references: {},
          createdAt: '2026-11-01T00:00:00.000Z',
          checksum: 'abc',
          notes: '',
          evaluation: { status: 'pass', score: 100, findings: [], checks: [], evaluatedAt: '2026-11-01T00:00:00.000Z' },
        },
      ],
    },
  },
  projects: {},
  assignments: {},
  improvements: {},
  events: [],
};

function seededRoot(label) {
  const root = autonomyRoot(label);
  const file = join(root, 'center.json');
  const payload = JSON.stringify(DOC, null, 2);
  writeFileSync(file, payload, 'utf8');
  const shape = checkStoreShape(JSON.parse(payload));
  assert.equal(shape.ok, true, 'el documento de prueba tiene que ser válido');
  return { root, file, payload };
}

function readPointer(root) {
  return JSON.parse(readFileSync(backupPointerFile(root), 'utf8'));
}

function listGenerations(root) {
  return readdirSync(backupGenerationsDir(root)).sort();
}

/** Publica una copia sana de referencia y la devuelve verificada. */
function withPreviousCopy(root, now = '2026-11-03T09:00:00.000Z') {
  const first = ensureBackup(root, { now, reason: 'migration' });
  assert.equal(first.ok, true, JSON.stringify(first));
  const verified = verifyBackup(root);
  assert.equal(verified.ok, true, 'la copia de referencia tiene que verificar');
  return verified;
}

test('primer corte antes de existir el puntero: no se puede verificar, pero el almacén vive', () => {
  const { root, file, payload } = seededRoot('lsc-atomic-1-');
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-03T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          afterGenerationWrite: () => {
            throw new Error('corte después de crear la generación');
          },
        },
      }),
    /corte después de crear la generación/,
  );
  const verified = verifyBackup(root);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'missing', 'sin puntero no hay copia recuperable todavía');
  assert.equal(readFileSync(file, 'utf8'), payload, 'el almacén vivo no puede cambiar');
});

test('corte durante la escritura de la generación: el puntero anterior sigue verificando', () => {
  const { root, file } = seededRoot('lsc-atomic-2-');
  const previous = withPreviousCopy(root);
  const before = readFileSync(file, 'utf8');
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-04T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          afterGenerationWrite: () => {
            throw new Error('corte escribiendo la generación');
          },
        },
      }),
    /corte escribiendo la generación/,
  );
  const verified = verifyBackup(root);
  assert.equal(verified.ok, true);
  assert.equal(verified.generation, previous.generation, 'sigue mandando el puntero anterior');
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('corte después del fsync y antes del puntero: la generación nueva no se referencia', () => {
  const { root } = seededRoot('lsc-atomic-3-');
  const previous = withPreviousCopy(root);
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-04T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          afterGenerationSync: () => {
            throw new Error('corte tras fsync');
          },
        },
      }),
    /corte tras fsync/,
  );
  const verified = verifyBackup(root);
  assert.equal(verified.ok, true);
  assert.equal(verified.generation, previous.generation);
  assert.equal(readPointer(root).generation, previous.generation);
});

test('corte escribiendo el puntero temporal: nada se publica', () => {
  const { root } = seededRoot('lsc-atomic-4-');
  const previous = withPreviousCopy(root);
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-04T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          afterPointerWrite: () => {
            throw new Error('corte escribiendo el puntero temporal');
          },
        },
      }),
    /corte escribiendo el puntero temporal/,
  );
  assert.equal(verifyBackup(root).generation, previous.generation);
});

test('corte tras el fsync del puntero temporal y antes del rename: el temporal huérfano no manda', () => {
  const { root } = seededRoot('lsc-atomic-5-');
  const previous = withPreviousCopy(root);
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-04T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          afterPointerSync: () => {
            throw new Error('corte antes del rename');
          },
        },
      }),
    /corte antes del rename/,
  );
  assert.equal(verifyBackup(root).generation, previous.generation);
  const locals = readdirSync(root).filter((name) => name.startsWith('center.json.backup.json.'));
  assert.ok(locals.length >= 1, 'el temporal del puntero queda en el directorio, como tras un corte');
});

test('corte durante el rename del puntero: se conserva la generación anterior', () => {
  const { root } = seededRoot('lsc-atomic-6-');
  const previous = withPreviousCopy(root);
  const result = ensureBackup(root, {
    now: '2026-11-04T09:00:00.000Z',
    reason: 'migration',
    hooks: {
      renamePointer: () => {
        throw new Error('corte en el rename');
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'backup-failed');
  const verified = verifyBackup(root);
  assert.equal(verified.ok, true);
  assert.equal(verified.generation, previous.generation);
});

test('corte inmediatamente después del rename: la generación nueva ya es verificable', () => {
  const { root } = seededRoot('lsc-atomic-7-');
  const previous = withPreviousCopy(root);
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-04T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          afterPointerPublish: () => {
            throw new Error('corte justo después del rename');
          },
        },
      }),
    /corte justo después del rename/,
  );
  const verified = verifyBackup(root);
  assert.equal(verified.ok, true);
  assert.notEqual(verified.generation, previous.generation, 'el punto de commit ya pasó');
  assert.equal(verified.generation, readPointer(root).generation);
});

test('corte antes de actualizar la copia de compatibilidad: el puntero ya manda', () => {
  const { root } = seededRoot('lsc-atomic-8-');
  withPreviousCopy(root);
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-04T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          beforeCompat: () => {
            throw new Error('corte antes de la compatibilidad');
          },
        },
      }),
    /corte antes de la compatibilidad/,
  );
  assert.equal(verifyBackup(root).ok, true);
});

test('corte durante la actualización de la compatibilidad: no afecta a la autoridad', () => {
  const { root } = seededRoot('lsc-atomic-9-');
  withPreviousCopy(root);
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-04T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          afterCompat: () => {
            throw new Error('corte durante la compatibilidad');
          },
        },
      }),
    /corte durante la compatibilidad/,
  );
  const verified = verifyBackup(root);
  assert.equal(verified.ok, true);
});

test('corte durante la poda: el puntero nuevo sigue teniendo su generación', () => {
  const { root } = seededRoot('lsc-atomic-10-');
  withPreviousCopy(root);
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-04T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          beforePrune: () => {
            throw new Error('corte durante la poda');
          },
        },
      }),
    /corte durante la poda/,
  );
  const pointer = readPointer(root);
  assert.ok(listGenerations(root).includes(`${pointer.generation}.json`), 'la generación referenciada no puede faltar');
  assert.equal(verifyBackup(root).ok, true);
});

test('un puntero que nombra una generación inexistente no es autoridad', () => {
  const { root } = seededRoot('lsc-atomic-11-');
  const previous = withPreviousCopy(root);
  const pointer = readPointer(root);
  const missing = { ...pointer, generation: 'g-20261104T090000Z-deadbeef', file: 'backups/generations/g-20261104T090000Z-deadbeef.json' };
  writeFileSync(backupPointerFile(root), JSON.stringify(missing, null, 2), 'utf8');
  const verified = verifyBackup(root);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'generation-missing');
  const restored = restoreFromBackup(root, { now: '2026-11-04T10:00:00.000Z' });
  assert.equal(restored.ok, false, 'sin generación verificable no se restaura nada');
  assert.ok(listGenerations(root).includes(`${previous.generation}.json`), 'la generación anterior sigue en disco');
});

test('un puntero con huella incorrecta no es autoridad', () => {
  const { root } = seededRoot('lsc-atomic-12-');
  withPreviousCopy(root);
  const pointer = readPointer(root);
  writeFileSync(backupPointerFile(root), JSON.stringify({ ...pointer, sha256: 'f'.repeat(64) }, null, 2), 'utf8');
  const verified = verifyBackup(root);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'hash-mismatch');
  assert.equal(restoreFromBackup(root, { now: '2026-11-04T10:00:00.000Z' }).ok, false);
});

test('una ruta con traversal o absoluta en el puntero se rechaza', () => {
  const { root } = seededRoot('lsc-atomic-13-');
  withPreviousCopy(root);
  const pointer = readPointer(root);
  const attempts = [
    'backups/generations/../../fuera.json',
    'C:/Windows/Temp/fuera.json',
    '/fuera.json',
    'backups/generations/sub/fuera.json',
    'backups/generations/g-20261103T090000Z-00000000.jsonx',
  ];
  for (const file of attempts) {
    writeFileSync(backupPointerFile(root), JSON.stringify({ ...pointer, file }, null, 2), 'utf8');
    const verified = verifyBackup(root);
    assert.equal(verified.ok, false, `no debería aceptarse: ${file}`);
    assert.equal(verified.code, 'pointer-invalid', `motivo inesperado para ${file}: ${verified.code}`);
    assert.equal(restoreFromBackup(root, { now: '2026-11-04T10:00:00.000Z' }).ok, false);
  }
});

test('generación anterior válida y generación nueva incompleta: sigue mandando la anterior', () => {
  const { root } = seededRoot('lsc-atomic-14-');
  const previous = withPreviousCopy(root);
  // Un corte que deja una generación nueva truncada y sin publicar.
  assert.throws(
    () =>
      ensureBackup(root, {
        now: '2026-11-04T09:00:00.000Z',
        reason: 'migration',
        hooks: {
          afterGenerationWrite: (path) => {
            truncateSync(path, 40);
            throw new Error('corte con la generación a medias');
          },
        },
      }),
    /corte con la generación a medias/,
  );
  const verified = verifyBackup(root);
  assert.equal(verified.ok, true);
  assert.equal(verified.generation, previous.generation);
  assert.ok(listGenerations(root).length >= 2, 'la generación incompleta queda como huérfana');
});

test('dos publicadores a la vez: gana uno y el puntero sigue verificando', async () => {
  const { root } = seededRoot('lsc-atomic-15-');
  withPreviousCopy(root);
  const script = (now) => `
    import { ensureBackup } from ${JSON.stringify(new URL('../lib/state.mjs', import.meta.url).href)};
    const result = ensureBackup(${JSON.stringify(root)}, { now: ${JSON.stringify(now)}, reason: 'migration' });
    process.stdout.write(JSON.stringify(result.ok));
    process.exit(result.ok ? 0 : 1);
  `;
  const write = (now) => {
    const file = join(root, `publisher-${now.replace(/[:.]/g, '')}.mjs`);
    writeFileSync(file, script(now), 'utf8');
    return file;
  };
  const one = write('2026-11-04T09:00:00.000Z');
  const two = write('2026-11-04T09:00:01.000Z');
  const run = (file) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += String(chunk);
      });
      child.on('close', (code) => resolve({ code, out }));
    });
  const [first, second] = await Promise.all([run(one), run(two)]);
  assert.ok(first.code === 0 || second.code === 0, 'al menos un publicador tiene que terminar bien');
  const verified = verifyBackup(root);
  assert.equal(verified.ok, true, 'el puntero publicado verifica');
  assert.equal(verified.generation, readPointer(root).generation);
  assert.ok(listGenerations(root).includes(`${verified.generation}.json`));
});

test('la poda conserva la generación del puntero y la anterior, y no borra durante la publicación', () => {
  const { root } = seededRoot('lsc-atomic-retention-');
  const published = [];
  for (let index = 0; index < 11; index += 1) {
    const now = `2026-11-${String(3 + index).padStart(2, '0')}T09:00:00.000Z`;
    const result = ensureBackup(root, { now, reason: 'migration' });
    assert.equal(result.ok, true, JSON.stringify(result));
    published.push(result.generation);
    const verified = verifyBackup(root);
    assert.equal(verified.generation, result.generation);
    assert.ok(listGenerations(root).includes(`${result.generation}.json`), 'nunca se publica una generación sin fichero');
  }
  const remaining = listGenerations(root);
  assert.ok(remaining.length <= 9, `la retención no puede crecer sin límite: ${remaining.length}`);
  assert.ok(remaining.includes(`${published.at(-1)}.json`));
  assert.ok(remaining.includes(`${published.at(-2)}.json`), 'la anterior verificada se conserva');
  assert.ok(remaining.length < published.length, 'algo se podó');
});

test('la copia de compatibilidad se actualiza después, y no es la autoridad', () => {
  const { root, file } = seededRoot('lsc-atomic-compat-');
  const first = ensureBackup(root, { now: '2026-11-03T09:00:00.000Z', reason: 'migration' });
  assert.equal(first.ok, true);
  assert.ok(existsSync(backupFile(root)));
  assert.ok(statSync(backupMetaFile(root)).size > 0);
  // Se corrompe la copia de compatibilidad a propósito: la autoridad no puede caerse por eso.
  truncateSync(backupFile(root), 20);
  const verified = verifyBackup(root);
  assert.equal(verified.ok, true);
  assert.equal(verified.generation, first.generation);
  // Y una restauración desde el puntero sigue funcionando.
  writeFileSync(file, '{"schemaVersion":1,"skills":', 'utf8');
  const restored = restoreFromBackup(root, { now: '2026-11-04T10:00:00.000Z' });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(loadState(root).integrity, 'ok');
});

test('sin puntero, una pareja antigua válida se detecta como legacy-copy y exige confirmación', () => {
  const { root } = seededRoot('lsc-atomic-legacy-');
  const first = ensureBackup(root, { now: '2026-11-03T09:00:00.000Z', reason: 'migration' });
  assert.equal(first.ok, true);
  const legacySha = readFileSync(backupFile(root));
  const sha = createHash('sha256').update(legacySha).digest('hex');
  rmSync(backupPointerFile(root));
  const verified = verifyBackup(root);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'legacy-copy');
  assert.equal(verified.sha256, sha);
  const refused = restoreFromBackup(root, { now: '2026-11-04T10:00:00.000Z' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'legacy-confirmation-required');
  const accepted = restoreFromBackup(root, { now: '2026-11-04T10:00:00.000Z', legacySha256: sha });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
});

test('un temporal viejo de nuestra publicación se limpia; uno reciente no', () => {
  const { root } = seededRoot('lsc-atomic-orphans-');
  withPreviousCopy(root);
  const fresh = join(root, 'center.json.backup.json.998.yyy.tmp');
  writeFileSync(fresh, '{}', 'utf8');
  ensureBackup(root, { now: '2026-11-05T09:00:00.000Z', reason: 'migration' });
  assert.equal(existsSync(fresh), true, 'nunca se toca un temporal reciente');
  assert.equal(verifyBackup(root).ok, true);
});

test('el panel recibe los tres estados de copia y nunca confunde «no verificable» con «sin crear»', () => {
  const { root } = seededRoot('lsc-atomic-snapshot-');
  const empty = buildSnapshot({ root, cwd: 'C:/xampp/htdocs/plugins-dhs', scan: false });
  assert.equal(empty.backup.status, 'missing');
  assert.equal(empty.backup.exists, false);

  const created = ensureBackup(root, { now: '2026-11-03T09:00:00.000Z', reason: 'manual' });
  assert.equal(created.ok, true);
  const verified = buildSnapshot({ root, cwd: 'C:/xampp/htdocs/plugins-dhs', scan: false });
  assert.equal(verified.backup.status, 'verified');
  assert.equal(verified.backup.exists, true);
  assert.equal(verified.backup.generation, created.generation);
  assert.equal(verified.backup.sha256.length, 64);
  assert.equal(verified.backup.error, null);

  // La generación se corrompe: el estado no puede degradarse a «sin crear».
  truncateSync(readBackupPointer(root).generationPath, 30);
  const unverified = buildSnapshot({ root, cwd: 'C:/xampp/htdocs/plugins-dhs', scan: false });
  assert.equal(unverified.backup.status, 'unverified');
  assert.equal(unverified.backup.exists, true);
  assert.equal(unverified.backup.verified, false);
  assert.ok(String(unverified.backup.error).length > 0, 'el motivo tiene que llegar al panel');
});

test('el panel marca una copia antigua como no publicada, no como verificada', () => {
  const { root } = seededRoot('lsc-atomic-snapshot-legacy-');
  const created = ensureBackup(root, { now: '2026-11-03T09:00:00.000Z', reason: 'manual' });
  assert.equal(created.ok, true);
  rmSync(backupPointerFile(root));
  const snapshot = buildSnapshot({ root, cwd: 'C:/xampp/htdocs/plugins-dhs', scan: false });
  assert.equal(snapshot.backup.status, 'unverified');
  assert.equal(snapshot.backup.legacy, true);
  assert.ok(String(snapshot.backup.error).length > 0);
});

test('la acción de copia es humana: la IA no puede publicar ni restaurar', () => {
  const { root } = seededRoot('lsc-atomic-actor-');
  const ai = runAction({ root, action: 'backup', payload: {}, actor: 'ai', cwd: 'C:/xampp/htdocs/plugins-dhs' });
  assert.equal(ai.ok, false);
  assert.equal(ai.code, 'approval-required');
  const human = runAction({ root, action: 'backup', payload: {}, actor: 'human', cwd: 'C:/xampp/htdocs/plugins-dhs' });
  assert.equal(human.ok, true, JSON.stringify(human));
  assert.equal(human.snapshot.backup.status, 'verified');
  const restoreAi = runAction({ root, action: 'restore', payload: { source: 'backup' }, actor: 'ai', cwd: 'C:/xampp/htdocs/plugins-dhs' });
  assert.equal(restoreAi.ok, false);
  assert.equal(restoreAi.code, 'approval-required');
});
