/** Ayudante mínimo de jq para las pruebas del adaptador: @uri, -e . y el formato de búsqueda. */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const input = readFileSync(0, 'utf8');

function uriEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

if (args.includes('@uri')) {
  process.stdout.write(uriEncode(input));
} else if (args.includes('-e')) {
  try {
    JSON.parse(input);
  } catch {
    process.exit(1);
  }
} else if (args.includes('-r')) {
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed.results)) {
      for (const row of parsed.results) {
        process.stdout.write(`ID: ${row.id}\nName: ${row.title ?? 'Unknown'}\nSnippets: ${row.totalSnippets ?? 'N/A'} | Score: ${row.benchmarkScore ?? 'N/A'}\n---\n`);
      }
    } else if (parsed.error !== undefined) {
      process.stdout.write(`Error: ${parsed.error}\n`);
    } else {
      process.stdout.write(input);
    }
  } catch {
    process.stdout.write(input);
  }
} else {
  process.stdout.write(input);
}
