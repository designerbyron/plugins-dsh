/**
 * UX-2.1 · inventario de SOLO LECTURA del almacén RAG real del propietario.
 *
 * Abre cada base con `readOnly: true`, cuenta y hashea ficheros. No escribe, no migra, no abre
 * con permiso de escritura y no crea nada: si el almacén no existe, lo dice y sale con 0.
 *
 * Uso:  node audit-readonly.mjs [raíz]   (por defecto ~/.dsh/lifecode-rag)
 * Salida: JSON por stdout, para comparar antes/después con diff.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

const root = process.argv[2] || join(homedir(), '.dsh', 'lifecode-rag');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function files(rootDir) {
  return walk(rootDir).map((path) => ({
    path: relative(rootDir, path).split('\\').join('/'),
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  })).sort((a, b) => a.path.localeCompare(b.path));
}

function readOnly(path, work) {
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return work(db);
  } finally {
    db.close();
  }
}

const list = files(root);
const profile = join(root, 'profiles');
const profiles = existsSync(profile)
  ? readdirSync(profile, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  : [];

const inventario = profiles.map((key) => {
  const dir = join(profile, key);
  const registry = join(dir, 'registry.sqlite3');
  const scopes = join(dir, 'scopes');
  const scopeIds = existsSync(scopes)
    ? readdirSync(scopes, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  return {
    perfil: key,
    registro: readOnly(registry, (db) => ({
      proyectos: db.prepare('SELECT id, name, status FROM projects ORDER BY id').all(),
      raices: db.prepare('SELECT scope_kind, scope_id, path, state FROM roots ORDER BY scope_id, path').all(),
      seleccion: db.prepare('SELECT selection_key, project_id, revision, selected_by FROM pa_selection').all(),
      auditoria: db.prepare('SELECT COUNT(*) n, MAX(seq) head FROM audit_registry').get(),
      confianza: db.prepare("SELECT key, value FROM meta WHERE key='trusted_roots'").all()
        .map((row) => ({ clave: row.key, entradas: (() => { try { return JSON.parse(row.value).length ?? null; } catch { return null; } })() })),
      integridad: db.prepare('PRAGMA integrity_check').get(),
    })),
    almacenes: scopeIds.map((scopeId) => ({
      scopeId,
      fichero: join('scopes', scopeId, 'rag.sqlite3'),
      datos: readOnly(join(scopes, scopeId, 'rag.sqlite3'), (db) => ({
        fuentes: db.prepare('SELECT COUNT(*) n FROM sources').get().n,
        chunks: db.prepare('SELECT COUNT(*) n FROM chunks').get().n,
        vectores: (() => {
          const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'").get();
          return row ? db.prepare('SELECT COUNT(*) n FROM vectors').get().n : null;
        })(),
        auditoria: db.prepare('SELECT COUNT(*) n, MAX(seq) head FROM audit').get(),
        integridad: db.prepare('PRAGMA integrity_check').get(),
      })),
    })),
  };
});

const huella = createHash('sha256').update(list.map((row) => `${row.path}|${row.bytes}|${row.sha256}`).join('\n')).digest('hex');

console.log(JSON.stringify({
  raiz: root,
  existe: existsSync(root),
  ficheros: list.length,
  huella,
  inventario,
  detalle: list,
}, null, 2));
