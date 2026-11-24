/**
 * PASO 3–4 · verificación del respaldo y huella inicial del almacén.
 *
 * 1) Compara fichero a fichero el respaldo con el original (paquete y almacén).
 * 2) Abre las COPIAS en sólo lectura: integrity_check + recuentos.
 * 3) Escribe ESTADO-LOGICO-ANTES.json en el directorio del respaldo.
 * 4) Imprime un resumen con PASS/FAIL por bloque.
 *
 * Sólo lee. Uso: node verify-backup.mjs <dir-respaldo>
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, relative, sep } from 'node:path';

const BK = process.argv[2];
if (!BK) { console.error('uso: node verify-backup.mjs <dir-respaldo>'); process.exit(2); }
const HOME = 'C:/Users/BYRON';
const PAQUETE_REAL = `${HOME}/.dsh/profiles/desktop/node_modules/@designerbyron/lifecode-rag`;
const ALMACEN_REAL = `${HOME}/.dsh/lifecode-rag/profiles/desktop`;

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (statSync(path).isFile()) out.push(path);
  }
  return out;
};
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const rel = (base, path) => relative(base, path).split(sep).join('/');
const comparar = (dirCopia, dirReal) => {
  const copia = new Map(walk(dirCopia).map((p) => [rel(dirCopia, p), { sha: sha(p), bytes: statSync(p).size }]));
  const real = new Map(walk(dirReal).map((p) => [rel(dirReal, p), { sha: sha(p), bytes: statSync(p).size }]));
  const faltan = [...real.keys()].filter((k) => !copia.has(k));
  const sobran = [...copia.keys()].filter((k) => !real.has(k));
  const distintos = [...real.keys()].filter((k) => copia.has(k) && copia.get(k).sha !== real.get(k).sha);
  return { copia: copia.size, real: real.size, faltan, sobran, distintos };
};

const paquete = comparar(join(BK, 'paquete-1.2.0'), PAQUETE_REAL);
const almacen = comparar(join(BK, 'almacen'), ALMACEN_REAL);

// Recuentos sobre las COPIAS (nunca sobre el original).
const leer = (path, work) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return work(db); } finally { db.close(); }
};
const state = { cuando: new Date().toISOString(), respaldo: BK, perfil: {}, scopes: {} };
state.perfil = leer(join(BK, 'almacen/registry.sqlite3'), (db) => ({
  proyectos: db.prepare('SELECT id, name, status FROM projects ORDER BY id').all(),
  raices: db.prepare('SELECT scope_kind, scope_id, path, state FROM roots ORDER BY scope_id, path').all(),
  seleccion: db.prepare('SELECT selection_key, project_id, revision, selected_by FROM pa_selection').all(),
  auditoria: db.prepare('SELECT COUNT(*) n, MAX(seq) head FROM audit_registry').get(),
  integridad: db.prepare('PRAGMA integrity_check').get(),
}));
const scopesDir = join(BK, 'almacen/scopes');
for (const id of existsSync(scopesDir) ? readdirSync(scopesDir) : []) {
  const ruta = join(scopesDir, id, 'rag.sqlite3');
  if (!existsSync(ruta)) continue;
  state.scopes[id] = leer(ruta, (db) => ({
    fuentes: db.prepare('SELECT COUNT(*) n FROM sources').get().n,
    chunks: db.prepare('SELECT COUNT(*) n FROM chunks').get().n,
    vectores: (() => {
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'").get();
      return t ? db.prepare('SELECT COUNT(*) n FROM vectors').get().n : null;
    })(),
    auditoria: db.prepare('SELECT COUNT(*) n, MAX(seq) head FROM audit').get(),
    integridad: db.prepare('PRAGMA integrity_check').get(),
  }));
}
writeFileSync(join(BK, 'ESTADO-LOGICO-ANTES.json'), JSON.stringify(state, null, 2), 'utf8');

const ok = (bloque) => bloque.faltan.length === 0 && bloque.sobran.length === 0 && bloque.distintos.length === 0;
const integridadOk = state.perfil.integridad?.integrity_check === 'ok'
  && Object.values(state.scopes).every((s) => s.integridad?.integrity_check === 'ok');

console.log(JSON.stringify({
  respaldo: BK,
  paquete: { ...paquete, ok: ok(paquete) },
  almacen: {
    ...almacen,
    ok: ok(almacen),
    // Los sidecars se comparan igual: si cambian durante la copia, se avisa y se re-copia tras cerrar el host.
    sidecars: [...almacen.distintos, ...almacen.faltan].filter((p) => /-(wal|shm)$/.test(p)),
  },
  integridadOk,
  estado: state,
}, null, 2));
process.exit(ok(paquete) && ok(almacen) && integridadOk ? 0 : 1);
