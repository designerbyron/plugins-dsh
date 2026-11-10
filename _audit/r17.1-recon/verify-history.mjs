#!/usr/bin/env node
// R17.1 — comprobación SÓLO LECTURA de la clasificación de eventos históricos del centro real.
//
// No escribe en el almacén: `loadState` sólo lee, y `buildActivityFeed` es una función pura.
// Uso: node _audit/r17.1-recon/verify-history.mjs [--out <ruta.json>]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', '..', 'lifecode-skill-center');
const { centerFile, loadState } = await import(pathToFileURL(join(plugin, 'lib', 'state.mjs')).href);
const { buildActivityFeed } = await import(pathToFileURL(join(plugin, 'lib', 'activity.mjs')).href);

const root = join(process.env.USERPROFILE ?? '', '.dsh', 'lifecode-skill-center');
const file = centerFile(root);
const bytes = readFileSync(file);
const sha256 = createHash('sha256').update(bytes).digest('hex');

const loaded = loadState(root);
const feed = buildActivityFeed(loaded.state, null, { limit: 50 });
const byId = new Map(feed.events.map((entry) => [entry.eventId, entry]));
const wanted = ['ev-e1d22376f174', 'ev-4b5ef716129b'];
const titles = wanted.map((eventId) => {
  const entry = byId.get(eventId);
  return entry === undefined
    ? { eventId, present: false }
    : { eventId, present: true, type: entry.type, origin: entry.origin, titleKey: entry.titleKey, category: entry.category };
});

const byType = {};
for (const entry of feed.events) {
  if (byType[entry.type] === undefined) byType[entry.type] = entry.titleKey;
}
const persistedTitleKeys = (loaded.state.events ?? []).filter((event) => event.titleKey !== undefined).length;
const home = process.env.USERPROFILE ?? '';
const displayFile = home === '' ? file : file.split(home).join('<home>');

const output = {
  generatedAt: new Date().toISOString(),
  store: { file: displayFile, bytes: bytes.length, sha256, readable: true },
  counts: { events: (loaded.state.events ?? []).length, feed: feed.events.length },
  wanted: titles,
  typeToTitleKey: byType,
  persistedTitleKeys,
};
const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1 && process.argv[outIndex + 1] !== undefined) {
  writeFileSync(process.argv[outIndex + 1], `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(output, null, 2));
