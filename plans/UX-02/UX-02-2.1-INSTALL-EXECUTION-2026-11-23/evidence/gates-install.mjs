/**
 * G1–G9 · compuertas previas a la instalación quirúrgica.
 *
 * Sólo lee (fichero, perfil, almacén y registro por HTTP). No escribe nada salvo su propia salida.
 * Uso: node gates-install.mjs <dir-respaldo>
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const BK = process.argv[2];
const B = 'plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/artifact/designerbyron-lifecode-rag-1.3.0.tgz';
const REPO = 'C:/xampp/htdocs/plugins-dhs-release';
const HOME = 'C:/Users/BYRON';
const PROF = `${HOME}/.dsh/profiles/desktop`;
const STORE = `${HOME}/.dsh/lifecode-rag/profiles/desktop`;

const ESP = {
  artefacto: 'f848b73ed2a85d6cecffab694710f062bade3d13f912a52a7ab94b927d724ec3',
  bytes: 310675,
  integridad: 'sha512-Q/EvDeGxJiTjcuoiB0iGn+gkapQA2bKQrcPJwl5dx3PH6EWpj4HSho1XwJTcqBzrtD/02dqR0CzznrqNFW6h1g==',
  fileCount: 74,
  perfil: {
    'package.json': '50012c7fd12c3fdcd9f54d0c08e7c29ad6bb900eabb199ee49c1f15b53de248f',
    'pnpm-lock.yaml': 'ff5ac0c9451dc45e04a5a0e3640ae45852632e2b0ef62ef9f5bb4d5d9da1c973',
    'pnpm-workspace.yaml': '5bcb2d94df3e88a5ba91d4a36dfc07ffbc70bf08bec64785f4b15ef36f76f8d7',
  },
  datos: {
    'registry.sqlite3': '4b67cadc9afee8f6c24fb92ab9e1e4742429bd745b4ffb68c1fb1e11b3e45fae',
    'scopes/prj_01M7RBSRD33M26HGBEFW51WPP6/rag.sqlite3': '4dcf31c4cb7058bb37528ad2c35ec33faa171ff003ad1faffb3bfec8b2472ae5',
    'scopes/prj_01M7TRDQYRAPJR03QTM3PP6PX2/rag.sqlite3': '6130ecbae17b8e8241c792a036165ffa42902537dc838eeb649201e748ababcb',
  },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const salida = { cuando: new Date().toISOString(), respaldo: BK, compuertas: [] };
const anotar = (id, control, esperado, observado, ok) => salida.compuertas.push({ id, control, esperado, observado, ok });

// G1 · artefacto
const rutaArtefacto = `${REPO}/${B}`;
const bytes = readFileSync(rutaArtefacto);
anotar('G1', 'sha256 del artefacto', ESP.artefacto, sha(rutaArtefacto), sha(rutaArtefacto) === ESP.artefacto);
anotar('G1', 'tamaño del artefacto', ESP.bytes, statSync(rutaArtefacto).size, statSync(rutaArtefacto).size === ESP.bytes);

// G2 · registro
const doc = await (await fetch('https://registry.npmjs.org/@designerbyron%2Flifecode-rag', { headers: { 'cache-control': 'no-cache' } })).json();
const v = doc.versions?.['1.3.0'];
anotar('G2', 'integrity publicado de 1.3.0', ESP.integridad, v?.dist?.integrity ?? '(ausente)', v?.dist?.integrity === ESP.integridad);
anotar('G2', 'fileCount publicado', ESP.fileCount, v?.dist?.fileCount ?? '(ausente)', v?.dist?.fileCount === ESP.fileCount);

// G3 · perfil
for (const [nombre, esperado] of Object.entries(ESP.perfil)) {
  const p = `${PROF}/${nombre}`;
  const real = existsSync(p) ? sha(p) : '(no existe)';
  anotar('G3', `perfil · ${nombre}`, esperado, real, real === esperado);
}

// G4 · gate de edad
let edad = '(no se pudo leer)';
try { edad = execSync('pnpm config get minimumReleaseAge', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { /* se anota abajo */ }
anotar('G4', 'minimumReleaseAge (anotar; si ≠ undefined → excepción por versión)', 'valor medido', edad, true);

// G5 · datos
for (const [nombre, esperado] of Object.entries(ESP.datos)) {
  const p = `${STORE}/${nombre}`;
  const real = existsSync(p) ? sha(p) : '(no existe)';
  anotar('G5', `datos · ${nombre.split('/')[0]}`, esperado, real, real === esperado);
}

// G6 · host cerrado
const procesos = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name=\'DeepSeek Harness.exe\'\\" | Measure-Object).Count"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
anotar('G6', 'procesos DeepSeek Harness', '0', procesos, procesos === '0');
const escucha = execSync('netstat -ano', { encoding: 'utf8' }).split('\n').filter((l) => /LISTENING/.test(l) && /:57200\b/.test(l));
anotar('G6', 'puerto 57200', 'libre', escucha.length === 0 ? 'libre' : `ocupado (${escucha.length})`, escucha.length === 0);
const wal = execSync('ls -l ' + STORE + '/*.sqlite3-* ' + STORE + '/scopes/*/*.sqlite3-* 2>/dev/null || true', { encoding: 'utf8' })
  .split('\n').filter((l) => l.includes('-wal')).map((l) => Number(l.trim().split(/\s+/)[4]));
anotar('G6', 'tamaño de los -wal', '0 B', wal.length ? wal.join(',') : 'sin -wal', wal.every((n) => n === 0));

// G7 · respaldo verificado
const manifiesto = `${BK}/MANIFIESTO.sha256`;
let verif = 'no se pudo verificar';
try {
  verif = execSync(`sha256sum -c MANIFIESTO.sha256`, { cwd: BK, encoding: 'utf8' });
} catch (error) {
  verif = String(error.stdout ?? '') + String(error.stderr ?? '');
}
const fallosManifiesto = verif.split('\n').filter((l) => l && !l.includes(': OK')).length;
const totales = verif.split('\n').filter((l) => l.includes(': OK')).length;
anotar('G7', 'manifiesto del respaldo', '0 fallos', `${totales} OK / ${fallosManifiesto} fallos`, fallosManifiesto === 0 && totales > 0);
anotar('G7', 'estado lógico del respaldo', 'existe', existsSync(`${BK}/ESTADO-LOGICO-ANTES.json`) ? 'existe' : 'falta', existsSync(`${BK}/ESTADO-LOGICO-ANTES.json`));

// G8 · espacio libre
const espacio = execSync('df -k /c | tail -1 | awk \'{print $4}\'', { encoding: 'utf8' }).trim();
const mb = Math.round(Number(espacio) / 1024);
anotar('G8', 'espacio libre en C:', '>= 200 MB', `${mb} MB`, mb >= 200);

// G9 · inventario
const inventario = `${REPO}/plans/UX-02/UX-02-2.1-INSTALL-EXECUTION-2026-11-23/evidence/inventario-node_modules-antes.txt`;
const lineas = existsSync(inventario) ? readFileSync(inventario, 'utf8').trim().split('\n').length : 0;
anotar('G9', 'inventario de node_modules', 'generado (>80)', `${lineas} paquetes`, lineas > 80);

// Integridad de las bases (lectura) con el host cerrado
for (const [nombre] of Object.entries(ESP.datos)) {
  const p = `${STORE}/${nombre}`;
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const r = db.prepare('PRAGMA integrity_check').get().integrity_check;
    anotar('G5b', `integrity_check · ${nombre.split('/')[0]}`, 'ok', r, r === 'ok');
  } finally { db.close(); }
}

salida.pass = salida.compuertas.filter((c) => c.ok).length;
salida.fail = salida.compuertas.filter((c) => !c.ok).length;
salida.veredicto = salida.fail === 0 ? 'GO (instalar)' : 'STOP (no instalar)';
salida.minimumReleaseAge = edad;
console.log(JSON.stringify(salida, null, 2));
process.exit(salida.fail === 0 ? 0 : 1);
