#!/usr/bin/env node
/**
 * Sondeo de propagación tras un `202` (solo lectura).
 *
 * Consulta la metadata por HTTP (sin caché) y el tarball publicado, con espera creciente, hasta que
 * ambos estén disponibles. NO publica, NO reintenta la publicación y NO mueve dist-tags.
 *
 * Uso: node poll-propagation.mjs [rondas]
 */
const PKG = '@designerbyron/lifecode-rag';
const VERSION = '1.3.0';
const DOC = `https://registry.npmjs.org/${PKG.replace('/', '%2f')}`;
const TGZ = `https://registry.npmjs.org/${PKG}/-/designerbyron-lifecode-rag-${VERSION}.tgz`;
const RONDAS = Number(process.argv[2] ?? 12);
const ESPERA = [0, 10, 15, 20, 25, 30, 40, 45, 50, 60, 60, 60];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const ahora = () => new Date().toISOString();

for (let i = 0; i < RONDAS; i += 1) {
  const espera = (ESPERA[i] ?? 60) * 1000;
  if (espera > 0) await dormir(espera);
  let meta = null;
  let tgz = null;
  try {
    const r = await fetch(DOC, { headers: { 'cache-control': 'no-cache', accept: 'application/json' } });
    const d = await r.json();
    const v = d.versions?.[VERSION];
    meta = {
      http: r.status,
      existe: Boolean(v),
      latest: d['dist-tags']?.latest ?? null,
      fecha: d.time?.[VERSION] ?? null,
      integridad: v?.dist?.integrity ?? null,
      fileCount: v?.dist?.fileCount ?? null,
      shasum: v?.dist?.shasum ?? null,
      unpackedSize: v?.dist?.unpackedSize ?? null,
    };
  } catch (error) {
    meta = { error: error.message };
  }
  try {
    const r = await fetch(TGZ, { method: 'HEAD', headers: { 'cache-control': 'no-cache' } });
    tgz = { http: r.status, bytes: Number(r.headers.get('content-length') ?? 0) || null };
  } catch (error) {
    tgz = { error: error.message };
  }
  console.log(JSON.stringify({ ronda: i + 1, cuando: ahora(), esperaSegundos: espera / 1000, meta, tgz }));
  if (meta.existe && tgz.http === 200) {
    console.log(JSON.stringify({ fin: 'metadata y tarball disponibles', cuando: ahora() }));
    process.exit(0);
  }
}
console.log(JSON.stringify({ fin: 'sigue sin estar completo tras el sondeo', cuando: ahora() }));
process.exit(2);
