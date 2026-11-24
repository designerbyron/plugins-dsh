/**
 * Auditoría del tarball: extrae, compara con el worktree autorizado y busca contenido privado.
 *
 * Uso: node audit-tarball.mjs <ruta-al.tgz> <dir-de-extraccion>
 * Salida: informe por stdout (y JSON), sin escribir en el paquete ni en el worktree.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const [tgzArg, destArg] = process.argv.slice(2);
if (!tgzArg || !destArg) {
  console.error('uso: node audit-tarball.mjs <tgz> <destino-extraccion>');
  process.exit(2);
}

const RAIZ = 'C:/xampp/htdocs/plugins-dhs-release/lifecode-rag';
const dest = destArg.split('\\').join('/');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

// bsdtar de Windows: se le pasan rutas nativas y se ejecuta con cwd para no tropezar con los dos puntos.
execFileSync('tar', ['--force-local', '-xzf', tgzArg.split('\\').join('/'), '-C', dest.split('\\').join('/')], { stdio: 'pipe' });

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const rel = (base, path) => relative(base, path).split(sep).join('/');

const extraidos = walk(join(dest, 'package')).map((path) => {
  const ruta = rel(join(dest, 'package'), path);
  const fuente = join(RAIZ, ruta);
  return {
    ruta,
    bytes: statSync(path).size,
    sha256: sha(path),
    enWorktree: existsSync(fuente),
    sha256Fuente: existsSync(fuente) ? sha(fuente) : null,
  };
}).sort((a, b) => a.ruta.localeCompare(b.ruta));

const identicos = extraidos.filter((f) => f.enWorktree && f.sha256Fuente === f.sha256);
const distintos = extraidos.filter((f) => f.enWorktree && f.sha256Fuente !== f.sha256);
const sinFuente = extraidos.filter((f) => !f.enWorktree);

// Ficheros del worktree que el manifiesto NO publica: se informa, no se juzga.
const paqueteJson = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
const delWorktree = walk(RAIZ).map((path) => rel(RAIZ, path))
  .filter((ruta) => !ruta.startsWith('node_modules/'));
const publicados = new Set(extraidos.map((f) => f.ruta));
const noPublicados = delWorktree.filter((ruta) => !publicados.has(ruta)).sort();

const patrones = [
  { nombre: 'token', re: /\b(token|access_token|refresh_token)\b/i },
  { nombre: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{8,}/ },
  { nombre: 'password', re: /\b(password|passwd|contrase(ñ|n)a)\b/i },
  { nombre: 'api-key', re: /\b(api[_-]?key|secret[_-]?key|client[_-]?secret)\b/i },
  { nombre: 'clave privada PEM', re: /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/ },
  { nombre: 'ruta de usuario', re: /C:\\+Users\\+[A-Za-z0-9._-]+/i },
  { nombre: 'npmrc/.env', re: /(\.npmrc|\.env\b)/ },
  { nombre: 'lunascape/mcp', re: /lunascape|mcp-audit/i },
  { nombre: 'sqlite', re: /\.sqlite3?\b/i },
  { nombre: 'evidencia local', re: /(_audit|plans\/UX-02|UX-02-2\.1)/ },
];
const hallazgos = [];
for (const archivo of extraidos) {
  const binario = /\.(tgz|db|sqlite3?|png|jpg|zip)$/i.test(archivo.ruta);
  if (binario) continue;
  if (archivo.bytes > 2_000_000) continue;
  const texto = readFileSync(join(dest, 'package', archivo.ruta), 'utf8');
  for (const patron of patrones) {
    const m = patron.re.exec(texto);
    if (!m) continue;
    const linea = texto.slice(0, m.index).split('\n').length;
    hallazgos.push({ archivo: archivo.ruta, patron: patron.nombre, linea, muestra: m[0].slice(0, 60) });
  }
}

// Extensiones y tipos presentes: lo que no debe viajar (bases, secretos, artefactos).
const prohibidas = extraidos.filter((f) => /(\.sqlite3?|\.db|\.env|\.npmrc|\.pem|\.key|\.tgz|\.log)$/i.test(f.ruta)
  || /(^|\/)(node_modules|tests|tools|eval|bench|demo|plans|_audit)\//.test(f.ruta));

const informe = {
  tgz: tgzArg,
  destino: dest,
  ficherosExtraidos: extraidos.length,
  identicos: identicos.length,
  distintos,
  sinFuenteEnWorktree: sinFuente,
  ficherosDelWorktreeNoPublicados: noPublicados.length,
  listaNoPublicados: noPublicados,
  prohibidas,
  hallazgos,
  entryCountDeclarado: paqueteJson.files,
  extraidosDetalle: extraidos,
};
writeFileSync(join(dest, '..', 'compare.json'), JSON.stringify(informe, null, 2), 'utf8');
console.log(JSON.stringify({
  ficherosExtraidos: informe.ficherosExtraidos,
  identicos: informe.identicos,
  distintos: informe.distintos.length,
  sinFuenteEnWorktree: informe.sinFuenteEnWorktree.map((f) => f.ruta),
  noPublicados: informe.ficherosDelWorktreeNoPublicados,
  prohibidas: informe.prohibidas.map((f) => f.ruta),
  hallazgos: informe.hallazgos,
}, null, 2));
