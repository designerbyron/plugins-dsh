/**
 * Edición quirúrgica del perfil para pasar `@designerbyron/lifecode-rag` de 1.2.0 a 1.3.0.
 *
 * Toca EXACTAMENTE tres sitios del lockfile y uno del manifiesto:
 *   1. package.json      "…": "1.2.0"                     → "1.3.0"
 *   2. pnpm-lock.yaml    importer: specifier/version 1.2.0 → 1.3.0
 *   3. pnpm-lock.yaml    packages['@designerbyron/lifecode-rag@1.2.0']  → @1.3.0 + integrity nueva
 *   4. pnpm-lock.yaml    snapshots['@designerbyron/lifecode-rag@1.2.0'] → @1.3.0
 *
 * Reglas de seguridad:
 *   - Cada patrón debe aparecer EXACTAMENTE una vez; si no, aborta sin escribir nada.
 *   - Escribe con saltos de línea idénticos a los del fichero original (no convierte CRLF/LF).
 *   - `--check` sólo informa (no escribe): dice si ya está aplicado, si se puede aplicar o si no cuadra.
 *
 * Uso: node apply-lock-edit.mjs <dir-perfil> [--check]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const check = process.argv.includes('--check');
if (!dir) { console.error('uso: node apply-lock-edit.mjs <dir-perfil> [--check]'); process.exit(2); }

const INTEGRIDAD_130 = 'sha512-Q/EvDeGxJiTjcuoiB0iGn+gkapQA2bKQrcPJwl5dx3PH6EWpj4HSho1XwJTcqBzrtD/02dqR0CzznrqNFW6h1g==';

const contar = (texto, patron) => (texto.match(new RegExp(patron.source, patron.flags.includes('g') ? patron.flags : `${patron.flags}g`)) ?? []).length;

const editar = (ruta, reemplazos) => {
  const original = readFileSync(ruta, 'utf8');
  let texto = original;
  const informe = [];
  for (const { nombre, buscar, poner } of reemplazos) {
    const n = contar(texto, buscar);
    informe.push({ archivo: ruta.split(/[\\/]/).pop(), cambio: nombre, coincidencias: n });
    if (n !== 1) {
      return { ok: false, motivo: `${nombre}: ${n} coincidencias (se exige exactamente 1)`, informe };
    }
    texto = texto.replace(buscar, poner);
  }
  if (texto === original) return { ok: true, sinCambios: true, informe };
  if (!check) writeFileSync(ruta, texto, 'utf8');
  return { ok: true, sinCambios: false, informe };
};

const pkgJson = editar(join(dir, 'package.json'), [{
  nombre: 'package.json · dependencia a 1.3.0',
  buscar: /"@designerbyron\/lifecode-rag": "1\.2\.0"/,
  poner: '"@designerbyron/lifecode-rag": "1.3.0"',
}]);

const lock = editar(join(dir, 'pnpm-lock.yaml'), [
  {
    nombre: 'lock · importer (specifier/version)',
    buscar: /('@designerbyron\/lifecode-rag':\r?\n\s+specifier: )1\.2\.0(\r?\n\s+version: )1\.2\.0/,
    poner: '$11.3.0$21.3.0',
  },
  {
    nombre: 'lock · packages (clave, integrity y engines)',
    buscar: /('@designerbyron\/lifecode-rag@)1\.2\.0(':\r?\n\s+resolution: \{integrity: )sha512-E\+81kiagjYjMnEX0MhZWE8\+Z1Te3VlOxN39\/bapGb7CHAF7QQtyqoE3jaAUzxRCV7mE1JjOpap7rOof4lIM9kw==(\}\r?\n\s+engines: \{[^}]*\})/,
    poner: `$11.3.0$2${INTEGRIDAD_130}$3`,
  },
  {
    nombre: 'lock · snapshots (clave)',
    buscar: /('@designerbyron\/lifecode-rag@)1\.2\.0(': \{\})/,
    poner: '$11.3.0$2',
  },
]);

const resultado = { dir, modo: check ? 'check' : 'aplicar', packageJson: pkgJson, lock };
resultado.ok = pkgJson.ok && lock.ok;
console.log(JSON.stringify(resultado, null, 2));
process.exit(resultado.ok ? 0 : 1);
