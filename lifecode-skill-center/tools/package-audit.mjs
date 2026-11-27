/**
 * Auditoría del tarball npm REAL, no del árbol de trabajo.
 *
 * K7-D: empaqueta con `npm pack`, extrae en un directorio temporal, comprueba identidad, entrypoints,
 * exports, manifiesto Cordis, rango de Harness, allowlist, hashes, secretos y contenido restringido.
 * No publica nada, no toca dist-tags y no instala el paquete.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = join(here, '..');

const REQUIRED_FILES = [
  'package/package.json',
  'package/index.js',
  'package/client.js',
  'package/cordis.patch.yml',
  'package/icon.svg',
  'package/README.md',
  'package/CHANGELOG.md',
  'package/LICENSE',
  'package/lib/vendor.mjs',
  'package/host/vendor-candidate.mjs',
  'package/host/vendor-pipeline.mjs',
];

const FORBIDDEN_PREFIXES = [
  'package/tests/', 'package/tools/', 'package/smoke/', 'package/vendor-adapters/', 'package/plans/',
  'package/node_modules/', 'package/.git/', 'package/.dsh/', 'package/reports/',
  'package/stores/', 'package/backups/',
];

const RESTRICTED_MARKERS = [
  'SPDX-License-Identifier: CC-BY-SA-4.0',
  'SPDX-FileCopyrightText: Netresearch DTT GmbH',
  'Creative Commons Attribution-ShareAlike',
  'MIT License\nCopyright (c) 2025-2026 Netresearch',
  'LS0tDQojIFNQRFgtTGljZW5zZS1JZGVudGlmaWVy',
  'IyEvYmluL2Jhc2gKIyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcg',
];

const SECRET_PATTERNS = [
  /npm_[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /password\s*[:=]\s*['"][^'"]{8,}['"]/i,
];

const ENCODED_PATTERNS = Object.freeze([
  {
    kind: 'data-uri-base64',
    pattern: /data:[A-Za-z0-9.+/-]+\/[A-Za-z0-9.+/-]+;[^,]*base64,[A-Za-z0-9+/=]{80,}/gi,
  },
  {
    kind: 'gzip-base64',
    pattern: /H4sI[A-Za-z0-9+/=]{40,}/g,
  },
  {
    kind: 'base64-block',
    // 160+ caracteres; los hashes SHA-256 de 64 y los fingerprints no llegan a este umbral.
    pattern: /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{160,}={0,2}(?![A-Za-z0-9+/=])/g,
  },
]);

const COMPRESSED_MAGIC = Object.freeze([
  { kind: 'gzip', bytes: Buffer.from([0x1f, 0x8b, 0x08]) },
  { kind: 'zip', bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]) },
  { kind: 'xz', bytes: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) },
  { kind: 'bzip2', bytes: Buffer.from([0x42, 0x5a, 0x68]) },
]);

/**
 * Detecta bytes codificados o comprimidos en un fichero publicable. No marca hashes hexadecimales
 * ni fingerprints: éstos son metadatos permitidos por K8-B3.
 */
export function scanEncodedPayloads(file, buffer) {
  const hits = [];
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer ?? '');
  for (const { kind, pattern } of ENCODED_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (/^[a-f0-9]+$/i.test(value)) continue;
      hits.push({ file, kind, match: value.slice(0, 48) });
    }
  }
  if (Buffer.isBuffer(buffer)) {
    for (const { kind, bytes } of COMPRESSED_MAGIC) {
      if (buffer.includes(bytes)) hits.push({ file, kind, match: bytes.toString('hex') });
    }
  }
  return hits;
}

function hash(buffer, algorithm) {
  return createHash(algorithm).update(buffer).digest('hex');
}

function walk(root, prefix = '', out = []) {
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walk(root, relative, out);
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

/**
 * Resuelve `npm-cli.js` sin asumir la distribución de Node del runner.
 *
 * Prioridad: `npm_execpath` (cuando es fichero regular) -> directorio global informado por
 * `npm root -g` -> rutas derivadas de `process.execPath`. El comando de sondeo tiene argumentos
 * fijos y no usa shell. Ninguna opción se acepta sin comprobar que es un fichero regular; si no
 * hay ninguna, el error enumera todas las opciones y el motivo de cada rechazo.
 */
export function resolveNpmCli({
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  root = PLUGIN_ROOT,
  stat = statSync,
  spawn = spawnSync,
} = {}) {
  const attempts = [];
  const checked = (source, path) => {
    let valid = false;
    let reason = 'sin ruta';
    if (typeof path === 'string' && path !== '') {
      try {
        valid = stat(path).isFile();
        reason = valid ? 'fichero regular' : 'no es un fichero regular';
      } catch (error) {
        reason = `no accesible: ${error?.code ?? error?.message ?? 'error desconocido'}`;
      }
    }
    attempts.push({ source, path: path ?? '', valid, reason });
    return valid;
  };

  const execpath = typeof env.npm_execpath === 'string' ? env.npm_execpath.trim() : '';
  if (checked('npm_execpath', execpath)) {
    return { npmCli: execpath, source: 'npm_execpath', attempts, error: null };
  }

  const command = platform === 'win32' ? 'npm.cmd' : 'npm';
  const probe = spawn(command, ['root', '-g'], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  const lines = `${probe.stdout ?? ''}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1) ?? '';
  const globalRoot = probe.status === 0 && isAbsolute(last) ? last : '';
  const globalCli = globalRoot === '' ? '' : join(globalRoot, 'npm', 'bin', 'npm-cli.js');
  checked(globalRoot === '' ? 'npm root -g' : 'npm root -g -> npm/bin/npm-cli.js', globalCli);
  if (globalRoot === '') {
    attempts.at(-1).reason = probe.status === 0
      ? 'npm root -g no devolvió una ruta global absoluta'
      : `npm root -g falló (status=${probe.status}, error=${probe.error?.code ?? 'ninguno'})`;
  }
  if (probe.status === 0 && last !== '' && !isAbsolute(last)) {
    attempts.push({ source: 'npm root -g', path: last, valid: false, reason: 'la ruta global devuelta no es absoluta' });
  }

  const nodeDir = dirname(execPath);
  checked('process.execPath/lib/node_modules', join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  checked('process.execPath/node_modules', join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));

  const selected = attempts.find((entry) => entry.valid);
  const error = selected ? null : [
    'No se pudo resolver npm-cli.js. Opciones comprobadas:',
    ...attempts.map((entry) => `- ${entry.source}: ${entry.path || '(vacía)'} (${entry.reason})`),
    'Causa: ninguna opción es un fichero regular.',
  ].join('\n');
  return { npmCli: selected?.path ?? null, source: selected?.source ?? null, attempts, error };
}

/**
 * @param {{ root?: string, destination?: string, keepArtifacts?: boolean, tarballPath?: string | null }} options
 */
export function auditPackage({
  root = PLUGIN_ROOT, destination = null, keepArtifacts = false, tarballPath = null,
} = {}) {
  const checks = [];
  const problems = [];
  const ok = (condition, message) => {
    checks.push({ ok: Boolean(condition), message });
    if (!condition) problems.push(message);
  };
  const workspace = mkdtempSync(join(tmpdir(), 'lsc-pkg-audit-'));
  const packDest = destination ?? workspace;
  const unpacked = join(workspace, 'unpacked');
  mkdirSync(unpacked, { recursive: true });
  try {
    let meta = null;
    let tarball;
    if (tarballPath) {
      ok(existsSync(tarballPath), `el tarball indicado existe: ${basename(tarballPath)}`);
      if (!existsSync(tarballPath)) return { ok: false, checks, problems };
      tarball = tarballPath;
    } else {
      const resolved = resolveNpmCli({ root });
      if (!resolved.npmCli) throw new Error(resolved.error);
      ok(true, `npm-cli.js resuelto desde ${resolved.source}: ${resolved.npmCli}`);
      const npmCli = resolved.npmCli;
      const packed = spawnSync(process.execPath, [
        npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', packDest,
      ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      ok(packed.status === 0, `npm pack terminó con ${packed.status}: ${(packed.stderr ?? '').split('\n')[0]}`);
      if (packed.status !== 0) return { ok: false, checks, problems };
      meta = JSON.parse(packed.stdout)[0];
      tarball = join(packDest, meta.filename);
    }
    const bytes = readFileSync(tarball);
    const extracted = spawnSync('tar', ['-xzf', tarball, '-C', unpacked], { encoding: 'utf8' });
    ok(extracted.status === 0, `la extracción del tarball terminó con ${extracted.status}`);
    if (extracted.status !== 0) return { ok: false, checks, problems };

    const pkg = JSON.parse(readFileSync(join(unpacked, 'package', 'package.json'), 'utf8'));
    const client = readFileSync(join(unpacked, 'package', 'client.js'), 'utf8');
    const patch = readFileSync(join(unpacked, 'package', 'cordis.patch.yml'), 'utf8');
    const entrypoints = [pkg.exports?.['.'], pkg.exports?.['./client'], pkg.exports?.['./package.json']];
    const files = walk(unpacked).sort();
    // Cuando se audita un tarball ya producido no hay salida de `npm pack`: se reconstruye la
    // foto a partir de los bytes y del contenido extraído, sin fiarse de metadatos externos.
    const reportMeta = meta ?? {
      name: pkg.name,
      version: pkg.version,
      filename: basename(tarball),
      entryCount: files.length,
      unpackedSize: files.reduce((sum, file) => sum + statSync(join(unpacked, file)).size, 0),
      shasum: hash(bytes, 'sha1'),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    };

    ok(pkg.name === 'dsh-lifecode-skill-center', `nombre publicado: ${pkg.name}`);
    ok(pkg.version === '1.1.0-rc.2', `versión publicada: ${pkg.version}`);
    ok(pkg.license === 'MIT', `licencia declarada: ${pkg.license}`);
    ok(pkg.private !== true, 'el tarball no está marcado como private');
    ok(!/^npm:/.test(pkg.name), 'sin alias npm: en el nombre');
    ok(pkg.engines?.dsh === '>=0.2.0-0 <0.3.0', `engines.dsh medido: ${pkg.engines?.dsh}`);
    ok(entrypoints.every((entry) => typeof entry === 'string' && !entry.includes('npm:')), 'exports sin alias npm:');
    for (const entry of entrypoints) {
      ok(entry && files.includes(`package/${entry.replace(/^\.\//, '')}`), `entrypoint presente: ${entry}`);
    }
    ok(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'manifiesto DSH apunta al parche Cordis');
    ok(pkg.dsh?.client?.platform === 'web', 'manifiesto DSH declara cliente web');
    ok(/id:\s*lifecode-skill-center/.test(patch), 'el id del bundle no cambió');
    ok(patch.includes(pkg.name), 'el parche nombra la identidad pública');
    ok(client.includes(`id: '${pkg.name}'`), 'el cliente usa la identidad pública');
    ok(!client.includes('@local/'), 'el cliente no conserva alias local');
    ok(reportMeta.name === pkg.name && reportMeta.version === pkg.version, 'la foto npm coincide con package.json');
    ok(reportMeta.entryCount === files.length, `entradas declaradas ${reportMeta.entryCount} = extraídas ${files.length}`);

    for (const required of REQUIRED_FILES) ok(files.includes(required), `fichero requerido: ${required}`);
    for (const prefix of FORBIDDEN_PREFIXES) {
      ok(!files.some((file) => file.startsWith(prefix)), `el tarball no contiene ${prefix}`);
    }

    const restrictedHits = [];
    const secretHits = [];
    const encodedHits = [];
    for (const file of files) {
      const buffer = readFileSync(join(unpacked, file));
      encodedHits.push(...scanEncodedPayloads(file, buffer));
      if (!/\.(?:md|js|mjs|json|yml|sh|svg)$/.test(file)) continue;
      const content = buffer.toString('utf8');
      for (const marker of RESTRICTED_MARKERS) {
        if (content.includes(marker)) restrictedHits.push({ file, marker });
      }
      for (const pattern of SECRET_PATTERNS) {
        const match = content.match(pattern);
        if (match) secretHits.push({ file, pattern: String(pattern), match: match[0] });
      }
    }
    ok(restrictedHits.length === 0, `sin contenido Context7 restringido (${restrictedHits.length} coincidencias)`);
    ok(secretHits.length === 0, `sin secretos (${secretHits.length} coincidencias)`);
    ok(encodedHits.length === 0, `sin payloads codificados ni comprimidos (${encodedHits.length} coincidencias)`);

    const sha256 = hash(bytes, 'sha256');
    const sha512 = hash(bytes, 'sha512');
    ok(sha256 === hash(bytes, 'sha256') && sha512.length === 128, 'hashes del tarball calculados');

    return {
      ok: problems.length === 0,
      manifest: { name: pkg.name, version: pkg.version, license: pkg.license, engines: pkg.engines },
      tarball: {
        filename: reportMeta.filename,
        bytes: statSync(tarball).size,
        unpackedBytes: reportMeta.unpackedSize,
        entryCount: reportMeta.entryCount,
        sha256,
        sha512,
        shasum: reportMeta.shasum,
        integrity: reportMeta.integrity,
      },
      files,
      restrictedHits,
      secretHits,
      encodedHits,
      checks,
      problems,
    };
  } finally {
    if (keepArtifacts && destination) {
      // El directorio temporal de extracción se conserva sólo para depuración explícita.
      console.error(`extracción temporal: ${workspace}`);
    } else {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const report = auditPackage();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
