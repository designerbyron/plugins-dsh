import { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempRoot, autonomyRoot } from './helpers.mjs';
import {
  BASENAME_PATTERNS,
  FILE_KINDS,
  PATH_CODES,
  basenameProblem,
  checkExistingFile,
  checkProjectedFile,
  checkPublishedFile,
  isInside,
  parentOf,
} from '../lib/paths.mjs';

const { equal, ok } = assert;

/** Un workspace temporal con su `.dsh/` dentro, como el real. */
function workspace(label) {
  const root = autonomyRoot(`lsc-paths-${label}-`);
  const dsh = join(root, '.dsh');
  mkdirSync(dsh, { recursive: true });
  return { root, dsh };
}

test('T1 · el nombre canónico se acepta y cualquier otro de su clase se rechaza', () => {
  equal(basenameProblem('lifecode-skill-center.json', FILE_KINDS.manifest).ok, true);
  equal(basenameProblem('lifecode-center.json', FILE_KINDS.manifest).code, PATH_CODES.badName);
  equal(basenameProblem('LIFECODE-SKILL-CENTER.JSON', FILE_KINDS.manifest).code, PATH_CODES.badName);
  equal(basenameProblem('lifecode-skill-center.json', FILE_KINDS.forkIntent).ok, false);
});

test('T2 · los nombres generados (archivado, intención y temporales) siguen su patrón exacto', () => {
  equal(basenameProblem('lifecode-skill-center.manifest-20261109T035911Z-af017e36.json', FILE_KINDS.archived).ok, true);
  equal(basenameProblem('lifecode-skill-center.manifest-2026-11-09.json', FILE_KINDS.archived).ok, false);
  equal(basenameProblem('.lifecode-tmp-fork-intent-3', FILE_KINDS.temp).ok, true);
  equal(basenameProblem('.lifecode-tmp-FORK-intent', FILE_KINDS.temp).ok, false);
  equal(basenameProblem('lifecode-skill-center.fork-intent.json', FILE_KINDS.forkIntent).ok, true);
  equal(basenameProblem('lifecode-skill-center.repair-published.json', FILE_KINDS.repairPublished).ok, true);
});

test('T3 · nombres con traversal, separadores o reservados de Windows se rechazan', () => {
  for (const name of ['../lifecode-skill-center.json', 'sub/lifecode-skill-center.json', 'sub\\x.json', '..', '.']) {
    equal(basenameProblem(name, FILE_KINDS.manifest).ok, false, name);
  }
  // Un nombre reservado de Windows es un caso propio: se distingue de «no cuadra con el patrón».
  equal(basenameProblem('NUL.json', FILE_KINDS.temp).code, PATH_CODES.reserved);
});

test('T4 · `isInside` respeta la frontera del separador y no acepta prefijos de nombre', () => {
  ok(isInside('C:/xampp/htdocs/a', 'C:/xampp/htdocs/a/.dsh/x.json'));
  ok(isInside('C:/xampp/htdocs/a/.dsh', 'C:/xampp/htdocs/a/.dsh/x.json'));
  equal(isInside('C:/xampp/htdocs/a/.dsh', 'C:/xampp/htdocs/a/.dsh-otro/x.json'), false);
  equal(isInside('C:/xampp/htdocs/a/.dsh', 'C:/xampp/htdocs/b/.dsh/x.json'), false);
});

test('T5 · un fichero regular contenido se mide con su identidad física', () => {
  const { root, dsh } = workspace('existing');
  const file = join(dsh, 'lifecode-skill-center.json');
  writeFileSync(file, '{"hola":1}', 'utf8');
  const checked = checkExistingFile({ path: file, dshRoot: dsh, kind: FILE_KINDS.manifest });
  equal(checked.ok, true);
  equal(typeof checked.dev, 'bigint');
  equal(typeof checked.ino, 'bigint');
  equal(checked.size, BigInt(Buffer.byteLength('{"hola":1}')));
  const normalizedRoot = dsh.replaceAll('\\', '/').toLowerCase();
  equal(checked.root.replaceAll('\\', '/').toLowerCase(), normalizedRoot);
  equal(parentOf(checked.path).replaceAll('\\', '/').toLowerCase(), normalizedRoot);
  ok(root.length > 0);
});

test('T6 · un fichero dentro de un junction escapa: `lstat` no basta y se rechaza', (tc) => {
  const { root, dsh } = workspace('junction');
  const outside = join(root, 'fuera');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'lifecode-skill-center.json'), '{}', 'utf8');
  const link = join(dsh, 'enlace');
  let junction = true;
  try {
    symlinkSync(outside, link, 'junction');
  } catch {
    junction = false;
  }
  if (!junction) {
    // Sin permiso para crear el enlace, la prueba no puede medir lo que dice medir: el TAP debe
    // mostrarlo como omitida, no como verde (un verde aquí es una cobertura que no existe).
    tc.skip('junction no disponible en este entorno');
    return;
  }
  const throughLink = join(link, 'lifecode-skill-center.json');
  const checked = checkExistingFile({ path: throughLink, dshRoot: dsh, kind: FILE_KINDS.manifest });
  equal(checked.ok, false);
  equal(checked.code, PATH_CODES.outside);
});

test('T7 · un destino que no existe responde `path-missing` y no inventa identidad', () => {
  const { dsh } = workspace('missing');
  const checked = checkExistingFile({ path: join(dsh, 'lifecode-skill-center.json'), dshRoot: dsh, kind: FILE_KINDS.manifest });
  equal(checked.ok, false);
  equal(checked.code, PATH_CODES.missing);
});

test('T8 · un directorio donde debería haber un fichero no se acepta como fichero', () => {
  const { dsh } = workspace('dir');
  mkdirSync(join(dsh, 'lifecode-skill-center.json'), { recursive: true });
  const checked = checkExistingFile({ path: join(dsh, 'lifecode-skill-center.json'), dshRoot: dsh, kind: FILE_KINDS.manifest });
  equal(checked.ok, false);
  equal(checked.code, PATH_CODES.notFile);
});

test('T9 · el destino proyectado valida el nombre y el padre antes de escribir', () => {
  const { dsh } = workspace('projected');
  const good = checkProjectedFile({ dir: dsh, name: 'lifecode-skill-center.json', dshRoot: dsh, kind: FILE_KINDS.manifest });
  equal(good.ok, true);
  equal(good.root.replaceAll('\\', '/').toLowerCase(), dsh.replaceAll('\\', '/').toLowerCase());
  const traversal = checkProjectedFile({ dir: dsh, name: '../lifecode-skill-center.json', dshRoot: dsh, kind: FILE_KINDS.manifest });
  equal(traversal.ok, false);
  // El traversal tiene código propio: «no cuadra con el patrón» sería menos informativo.
  equal(traversal.code, PATH_CODES.traversal);
  // Un `.dsh/` que aún no existe es ENOENT esperado, no «no es un directorio»: la diferencia decide si
  // el inventario se detiene (ilegible) o si la carpeta puede crearla su dueño (ausente).
  const absent = checkProjectedFile({ dir: join(dsh, 'no-existe'), name: 'lifecode-skill-center.json', dshRoot: dsh, kind: FILE_KINDS.manifest });
  equal(absent.ok, false);
  equal(absent.code, PATH_CODES.missing);
});

test('T10 · tras publicar se vuelve a medir y un escape se denuncia', (tc) => {
  const { root, dsh } = workspace('published');
  const file = join(dsh, 'lifecode-skill-center.json');
  writeFileSync(file, '{"x":1}', 'utf8');
  const fine = checkPublishedFile({ path: file, dshRoot: dsh, kind: FILE_KINDS.manifest });
  equal(fine.ok, true);

  const outside = join(root, 'fuera2');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'lifecode-skill-center.json'), '{"x":2}', 'utf8');
  const link = join(dsh, 'salida');
  let junction = true;
  try {
    symlinkSync(outside, link, 'junction');
  } catch {
    junction = false;
  }
  if (!junction) {
    tc.skip('junction no disponible en este entorno');
    rmSync(outside, { recursive: true, force: true });
    return;
  }
  const escaped = checkPublishedFile({ path: join(link, 'lifecode-skill-center.json'), dshRoot: dsh, kind: FILE_KINDS.manifest });
  equal(escaped.ok, false);
  // Después de publicar, un escape no es «fuera del workspace» a secas: es el aviso de que el nombre
  // recién creado apunta fuera, y eso obliga a cuarentena en vez de a reintentar.
  equal(escaped.code, PATH_CODES.escapedAfterPublish);
});

test('T11 · las clases de nombre son disjuntas: un patrón sólo vale para su clase', () => {
  for (const [kind, pattern] of Object.entries(BASENAME_PATTERNS)) {
    ok(pattern instanceof RegExp, kind);
  }
  const archived = 'lifecode-skill-center.manifest-20261109T035911Z-af017e36.json';
  equal(basenameProblem(archived, FILE_KINDS.archived).ok, true);
  equal(basenameProblem(archived, FILE_KINDS.manifest).ok, false);
  equal(basenameProblem('lifecode-skill-center.json', FILE_KINDS.archived).ok, false);
});
