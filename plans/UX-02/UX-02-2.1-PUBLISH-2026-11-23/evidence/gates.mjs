#!/usr/bin/env node
/**
 * G1–G6 · puerta previa a la publicación (Checkpoint B) de LifeCode RAG 1.3.0.
 *
 * Sólo lee: fichero local, sesión npm y metadata pública del registro. No publica, no instala,
 * no modifica `.npmrc` ni imprime credenciales.
 *
 * Uso: node gates.mjs   ·   exit 0 sólo si TODAS las compuertas pasan.
 */
import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const REPO = 'C:/xampp/htdocs/plugins-dhs-release';
const TGZ = `${REPO}/plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/artifact/designerbyron-lifecode-rag-1.3.0.tgz`;
const ESPERADO = {
  sha256: 'f848b73ed2a85d6cecffab694710f062bade3d13f912a52a7ab94b927d724ec3',
  sha512: '43f12f0de1b12624e372ea220748869fe8246a9400d9b290adc3c9c25e5dc773c7e845a98f81d2868d57c094dca81cebb43ff4d9da91d02cf39eba8d156ea1d6',
  bytes: 310675,
  cuenta: 'designerbyron',
  registro: 'https://registry.npmjs.org/',
  version: '1.3.0',
};

const salida = { cuando: new Date().toISOString(), fichero: TGZ, compuertas: [] };
const anotar = (id, control, esperado, observado, ok) => salida.compuertas.push({ id, control, esperado, observado, ok });

const bytes = readFileSync(TGZ);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const sha512 = createHash('sha512').update(bytes).digest('hex');

anotar('G1', 'tamaño exacto', ESPERADO.bytes, statSync(TGZ).size, statSync(TGZ).size === ESPERADO.bytes);
anotar('G2', 'sha256 del artefacto', ESPERADO.sha256, sha256, sha256 === ESPERADO.sha256);
anotar('G2', 'sha512 del artefacto', ESPERADO.sha512, sha512, sha512 === ESPERADO.sha512);
try {
  const cert = execFileSync('certutil', ['-hashfile', TGZ, 'SHA256'], { encoding: 'utf8' })
    .split('\n')[1].trim().replaceAll(' ', '');
  anotar('G2', 'sha256 por certutil (instrumento independiente)', ESPERADO.sha256, cert, cert === ESPERADO.sha256);
} catch (error) {
  anotar('G2', 'sha256 por certutil', ESPERADO.sha256, `no se pudo ejecutar: ${error.message}`, false);
}

// En Windows `npm` es un shim `.cmd`: `execFileSync('npm', …)` falla con ENOENT. Se invoca por shell con
// una cadena fija (sin entrada del usuario) para que la compuerta mida exactamente lo que teclea la persona.
function npm(args) {
  return execSync(`npm ${args.join(' ')}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

try {
  const cuenta = npm(['whoami']);
  anotar('G3', 'sesión npm', ESPERADO.cuenta, cuenta, cuenta === ESPERADO.cuenta);
} catch (error) {
  anotar('G3', 'sesión npm', ESPERADO.cuenta, `falló: ${(error.stderr || error.message).toString().trim().split('\n')[0]}`, false);
}

try {
  const registro = npm(['config', 'get', 'registry']);
  anotar('G5', 'registro configurado', ESPERADO.registro, registro, registro === ESPERADO.registro);
} catch (error) {
  anotar('G5', 'registro configurado', ESPERADO.registro, `falló: ${error.message}`, false);
}

const respuesta = await fetch('https://registry.npmjs.org/@designerbyron%2Flifecode-rag', {
  headers: { 'cache-control': 'no-cache', accept: 'application/json' },
});
const doc = await respuesta.json();
const versiones = Object.keys(doc.versions || {});
const existe = Object.prototype.hasOwnProperty.call(doc.versions || {}, ESPERADO.version);
anotar('G4', 'la versión sigue libre (fuente HTTP, no caché)', 'no existe', existe ? 'EXISTE' : 'no existe', !existe);
salida.registro = {
  status: respuesta.status,
  versiones,
  latest: (doc['dist-tags'] || {}).latest ?? null,
  integridad130: existe ? doc.versions[ESPERADO.version].dist?.integrity ?? null : null,
};

try {
  const perfil = JSON.parse(execSync('npm profile get --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const modo = perfil?.tfa?.mode ?? null;
  anotar('G6', 'modo 2FA conocido (decisión: aprobación por operación)', 'auth-and-writes o auth-only', String(modo), modo === 'auth-and-writes' || modo === 'auth-only');
} catch (error) {
  anotar('G6', 'modo 2FA conocido', 'auth-and-writes o auth-only', `no se pudo leer: ${(error.stderr || error.message).toString().trim().split('\n')[0]}`, false);
}

salida.pass = salida.compuertas.filter((c) => c.ok).length;
salida.fail = salida.compuertas.filter((c) => !c.ok).length;
salida.veredicto = salida.fail === 0 ? 'GO (presentar el comando al propietario)' : 'STOP (no publicar)';
console.log(JSON.stringify(salida, null, 2));
process.exit(salida.fail === 0 ? 0 : 1);
