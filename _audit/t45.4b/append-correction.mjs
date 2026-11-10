import fs from 'node:fs';

const path = '_audit/R17-NOTIFICATIONS-UX.md';
let text = fs.readFileSync(path, 'utf8');
const marker = 'Corrección medida — T45.4-B';
if (text.includes(marker)) {
  console.log('exists');
} else {
  const note = [
    '',
    '',
    '---',
    '',
    '## Corrección medida — T45.4-B (2026-11-10)',
    '',
    'La línea «Reabrir el cajón reutiliza el feed vigente y **no** vuelve a consultar» describía el',
    'comportamiento esperado, no el implementado. El cajón se monta sólo mientras está abierto',
    '(`client.js`: montaje condicional) y su efecto de carga corre en cada montaje («Una sola consulta',
    'al montar (el drawer sólo existe cuando está abierto)»), de modo que **cada apertura hace',
    'exactamente una consulta** y cerrar no consulta: 20 aperturas/cierres = 20 GET (una por apertura,',
    'sin multiplicación ni temporizadores).',
    '',
    'Esto coincide con la medición viva de T45.3 (3 aperturas del cajón = 3 GET) y con la prueba',
    '`tests/r17-ux.test.mjs` ajustada en T45.4-B. Para traer eventos nuevos sin cerrar está «Actualizar».',
    'La afirmación anterior se conserva arriba como registro de la expectativa original.',
    '',
  ].join('\n');
  text = text.replace(/\s*$/, '') + note;
  fs.writeFileSync(path, text, 'utf8');
  console.log('appended', Buffer.byteLength(text));
}
