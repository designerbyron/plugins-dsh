// R16.3 — sanea la evidencia de `_audit/r16.3-recon/` para entrega.
//
// Uso:
//   node _audit/r16.3-recon/sanitize-r163.mjs            # genera los ficheros saneados
//   node _audit/r16.3-recon/sanitize-r163.mjs --check    # falla si queda una ruta personal
//
// Regla: ningún nombre de usuario ni ruta `.../Users/<usuario>` sale de aquí. Se sustituye
// por `<home>`. Los ficheros CRUDOS no se borran: quedan como `.raw.*` y están excluidos de
// la entrega (ver README §Saneado). No toca el almacén real ni datos del plugin.
import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Cubre el prefijo de perfil con separador simple, doble (JSON escapado) o barra.
const USER_PATH = /C:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+[A-Za-z0-9._-]+/gi;

export function sanitizeText(text) {
  let count = 0;
  const out = text.replace(USER_PATH, () => {
    count += 1;
    return '<home>';
  });
  return { text: out, count };
}

export function countPersonal(text) {
  const m = text.match(USER_PATH);
  return m ? m.length : 0;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// origen -> destino. Si el origen es el propio destino (TXT/JSON ya canónicos), se conserva
// una copia cruda `.raw.*` y se reescribe el canónico saneado.
const JOBS = [
  { from: 'live-api-sanitized.json', to: 'live-api.json' },
  { from: 'live-inventory-snapshot.json', to: 'live-inventory.json' },
  { from: 'case-selfshadow.json', to: 'case-selfshadow.json', keepRaw: 'case-selfshadow.raw.json' },
  { from: 'live-summary.txt', to: 'live-summary.txt', keepRaw: 'live-summary.raw.txt' },
];

function run() {
  const report = [];
  for (const job of JOBS) {
    let source = path.join(HERE, job.from);
    if (job.keepRaw) {
      const raw = path.join(HERE, job.keepRaw);
      if (!existsSync(raw)) renameSync(source, raw);
      source = raw;
    }
    const before = readFileSync(source, 'utf8');
    const { text, count } = sanitizeText(before);
    const target = path.join(HERE, job.to);
    writeFileSync(target, text, 'utf8');
    report.push({ target: job.to, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text), replaced: count });
  }
  for (const row of report) {
    console.log(`${row.summary ?? row.target}\t${row.bytes} B\tsha256=${row.sha256}\treemplazos=${row.replaced}`);
  }
  return report;
}

function check() {
  // Los crudos quedan fuera: sólo se comprueban los ficheros que entran en la entrega.
  const delivered = [
    'live-api.json',
    'live-inventory.json',
    'case-selfshadow.json',
    'live-summary.txt',
    'README.md',
    'capture.mjs',
    'analyze-live.mjs',
    'extract-case.mjs',
    'sanitize-r163.mjs',
    'catalog-snapshot.json',
    'catalog-builtin.json',
    'catalog-office.json',
  ];
  let bad = 0;
  for (const name of delivered) {
    const file = path.join(HERE, name);
    if (!existsSync(file)) {
      console.log(`FALTA ${name}`);
      bad += 1;
      continue;
    }
    const hits = countPersonal(readFileSync(file, 'utf8'));
    if (hits > 0) {
      console.log(`RUTA PERSONAL ${name}: ${hits}`);
      bad += hits;
    }
  }
  console.log(bad === 0 ? 'OK: 0 rutas personales en los ficheros entregados' : `FALLO: ${bad} coincidencias`);
  return bad === 0 ? 0 : 1;
}

if (process.argv.includes('--check')) {
  process.exit(check());
} else {
  run();
}
