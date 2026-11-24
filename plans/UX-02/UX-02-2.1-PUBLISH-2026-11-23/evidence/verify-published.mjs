#!/usr/bin/env node
/**
 * V1–V5 · verificación POST-publicación de LifeCode RAG 1.3.0 (solo lectura).
 *
 * Consulta el registro por HTTP (fuente, no caché), descarga el tarball publicado a un directorio
 * temporal y lo compara con el artefacto aprobado. No publica, no instala, no mueve dist-tags.
 *
 * Uso: node verify-published.mjs   ·   exit 0 sólo si V1–V5 pasan.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const PKG = '@designerbyron/lifecode-rag';
const VERSION = '1.3.0';
const ESPERADO = {
  sha256: 'f848b73ed2a85d6cecffab694710f062bade3d13f912a52a7ab94b927d724ec3',
  sha512Integrity: 'sha512-Q/EvDeGxJiTjcuoiB0iGn+gkapQA2bKQrcPJwl5dx3PH6EWpj4HSho1XwJTcqBzrtD/02dqR0CzznrqNFW6h1g==',
  shasum: '26286f79a3ab742fb666971d55dfdc52186d1132',
  fileCount: 74,
  bytes: 310675,
  tools: 7,
  paVersion: 'pa/1.4.0',
};

const salida = { cuando: new Date().toISOString(), controles: [] };
const anotar = (id, control, esperado, observado, ok) => salida.controles.push({ id, control, esperado, observado, ok });

const urlDoc = `https://registry.npmjs.org/${PKG.replace('/', '%2f')}`;
const respuesta = await fetch(urlDoc, { headers: { 'cache-control': 'no-cache', accept: 'application/json' } });
const doc = await respuesta.json();
const publicada = doc.versions?.[VERSION] ?? null;
salida.registro = {
  status: respuesta.status,
  versiones: Object.keys(doc.versions || {}),
  latest: doc['dist-tags']?.latest ?? null,
  fecha: doc.time?.[VERSION] ?? null,
  modified: doc.time?.modified ?? null,
};

anotar('V1', `existe ${VERSION}`, 'sí', publicada ? 'sí' : 'no', Boolean(publicada));
anotar('V1', 'versión publicada', VERSION, publicada?.version ?? '(ausente)', publicada?.version === VERSION);
anotar('V2', 'dist.integrity', ESPERADO.sha512Integrity, publicada?.dist?.integrity ?? '(ausente)', publicada?.dist?.integrity === ESPERADO.sha512Integrity);
anotar('V2', 'dist.shasum (sha1)', ESPERADO.shasum, publicada?.dist?.shasum ?? '(ausente)', publicada?.dist?.shasum === ESPERADO.shasum);
anotar('V3', 'dist.fileCount', ESPERADO.fileCount, publicada?.dist?.fileCount ?? '(ausente)', publicada?.dist?.fileCount === ESPERADO.fileCount);
anotar('V3', 'dist.unpackedSize', 1078261, publicada?.dist?.unpackedSize ?? '(ausente)', publicada?.dist?.unpackedSize === 1078261);
anotar('V5', 'dist-tags.latest', VERSION, doc['dist-tags']?.latest ?? '(ausente)', doc['dist-tags']?.latest === VERSION);
anotar('V2', 'licencia publicada', 'MIT', publicada?.license ?? '(ausente)', publicada?.license === 'MIT');

// V4 · descargar el tarball publicado y compararlo byte a byte con el aprobado.
// La URL se toma de `dist.tarball` (fuente autoritativa): en un paquete con ámbito el fichero NO lleva el
// prefijo del ámbito (`/-/lifecode-rag-1.3.0.tgz`), a diferencia del nombre que produce `npm pack` en local.
// Usar el nombre local aquí da 404 y parece «no propagado»: fue un fallo de esta sonda, no del registro.
const urlTarball = publicada?.dist?.tarball
  ?? `https://registry.npmjs.org/${PKG}/-/${PKG.split('/')[1]}-${VERSION}.tgz`;
const obra = mkdtempSync(join(tmpdir(), 'verify-1.3.0-'));
const nombre = `descargado-${VERSION}.tgz`;
const destino = join(obra, nombre);
let descargaOk = false;
let bytes = null;
try {
  const r = await fetch(urlTarball, { headers: { 'cache-control': 'no-cache' } });
  salida.tarballHttp = r.status;
  if (r.ok) {
    bytes = Buffer.from(await r.arrayBuffer());
    const { writeFileSync } = await import('node:fs');
    writeFileSync(destino, bytes);
    descargaOk = true;
  }
} catch (error) {
  salida.tarballError = error.message;
}
if (descargaOk) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  anotar('V4', 'sha256 del .tgz descargado', ESPERADO.sha256, sha256, sha256 === ESPERADO.sha256);
  anotar('V4', 'sha512 del .tgz descargado (integrity)', ESPERADO.sha512Integrity, `sha512-${sha512}`, `sha512-${sha512}` === ESPERADO.sha512Integrity);
  anotar('V4', 'tamaño del .tgz descargado', ESPERADO.bytes, bytes.length, bytes.length === ESPERADO.bytes);
  const entradas = execFileSync('tar', ['--force-local', '-tzf', destino], { encoding: 'utf8' }).trim().split('\n').length;
  anotar('V4', 'entradas del .tgz descargado', ESPERADO.fileCount, entradas, entradas === ESPERADO.fileCount);
  const manifiesto = JSON.parse(execFileSync('tar', ['--force-local', '-xzOf', destino, 'package/package.json'], { encoding: 'utf8' }));
  anotar('V4', 'package.json publicado · version', VERSION, manifiesto.version, manifiesto.version === VERSION);
  anotar('V4', 'package.json publicado · license', 'MIT', manifiesto.license, manifiesto.license === 'MIT');
  const api = execFileSync('tar', ['--force-local', '-xzOf', destino, 'package/lib/pa-api.mjs'], { encoding: 'utf8' });
  const pa = /PA_VERSION\s*=\s*'([^']+)'/.exec(api)?.[1] ?? '(no encontrado)';
  anotar('V4', 'PA_VERSION publicado', ESPERADO.paVersion, pa, pa === ESPERADO.paVersion);
  const tools = /lifecode_rag_/.test(execFileSync('tar', ['--force-local', '-xzOf', destino, 'package/lib/tools.mjs'], { encoding: 'utf8' })) ? ESPERADO.tools : 0;
  anotar('V4', 'módulo de herramientas presente', 'sí', tools ? 'sí' : 'no', tools === ESPERADO.tools);
} else {
  anotar('V4', 'descarga del tarball publicado', 'HTTP 200', `HTTP ${salida.tarballHttp ?? 'error'}`, false);
}

salida.pass = salida.controles.filter((c) => c.ok).length;
salida.fail = salida.controles.filter((c) => !c.ok).length;
salida.veredicto = salida.fail === 0 ? 'PUBLICADO Y VERIFICADO' : 'DISCREPANCIA (no instalar; investigar)';
console.log(JSON.stringify(salida, null, 2));
process.exit(salida.fail === 0 ? 0 : 1);
