/**
 * Evidencia PINNED del tag v1.7.3, capturada del objeto Git anotado y verificada el 2026-11-26.
 *
 * Es datos, no código de red: el adaptador la usa para reverificar la firma SSH en cada operación
 * con `ssh-keygen -Y verify`, sin clonar, sin descargar y sin escribir configuración persistente.
 * El núcleo (`lib/**`) nunca importa este fichero; la prueba resultante se le entrega al núcleo.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const VENDOR_TAG_COMMIT = '01d2f069127eeeaf0a02efe8e1429e0bddc57669';

/** Identificador Git del objeto anotado (SHA-1 de 40 hexadecimales, el que publica GitHub). */
export const VENDOR_TAG_OBJECT = 'b51014445da2a325bd520950805ebbb8463d7e8c';
export const VENDOR_SIGNING_PRINCIPAL = 'info@sebastianmendel.de';
export const VENDOR_SIGNING_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMiIH3/oRiL0mClsixaIoBCNlngoZJ+V3R4HML1bMNz1';
export const VENDOR_SIGNING_FINGERPRINT = 'SHA256:NOxv8dcZlMFz3wrLdHILVNSnF6xskqAjN3bnn0i7K30';

export const VENDOR_TAG_PAYLOAD = "object 01d2f069127eeeaf0a02efe8e1429e0bddc57669\ntype commit\ntag v1.7.3\ntagger Sebastian Mendel <info@sebastianmendel.de> 1791349977 +0200\n\nv1.7.3\n";
export const VENDOR_TAG_SIGNATURE = "-----BEGIN SSH SIGNATURE-----\nU1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgyIgff+hGIvSYKWyLFoigEI2WeC\nhkn5XdHgcwvVsw3PUAAAADZ2l0AAAAAAAAAAZzaGE1MTIAAABTAAAAC3NzaC1lZDI1NTE5\nAAAAQG56ugxsuwBhoeIM0fjdbaXM/6TT6j0yOUvREfqJBxEIIPs7F64qlhzM5dSV3RsmDZ\n/xyeeU4rcUHhX89ltXzAE=\n-----END SSH SIGNATURE-----\n";

/**
 * Reverifica la firma en un directorio efímero. No lee ni escribe la configuración del usuario:
 * `allowed_signers` y la firma viven en una caja de arena que se borra en `finally`.
 */
export function verifyPinnedTagSignature({ tag = 'v1.7.3', commit = VENDOR_TAG_COMMIT, now = new Date().toISOString() } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'lsc-vendor-sig-'));
  try {
    const signers = join(temp, 'allowed_signers');
    const signature = join(temp, 'signature');
    writeFileSync(signers, `${VENDOR_SIGNING_PRINCIPAL} ${VENDOR_SIGNING_KEY}\n`, 'utf8');
    writeFileSync(signature, VENDOR_TAG_SIGNATURE, 'utf8');
    const result = spawnSync('ssh-keygen', [
      '-Y', 'verify', '-f', signers, '-I', VENDOR_SIGNING_PRINCIPAL, '-n', 'git', '-s', signature,
    ], { input: VENDOR_TAG_PAYLOAD, encoding: 'utf8' });
    if (result.status !== 0) {
      return {
        ok: false,
        code: 'vendor.host.signature-invalid',
        detail: `ssh-keygen -Y verify devolvió ${result.status}: ${String(result.stderr ?? '').trim()}`,
      };
    }
    if (!/Good "git" signature/i.test(String(result.stdout ?? ''))) {
      return { ok: false, code: 'vendor.host.signature-invalid', detail: 'ssh-keygen no confirmó la firma' };
    }
    return {
      ok: true,
      status: 'verified',
      tag,
      commit,
      tagObject: VENDOR_TAG_OBJECT,
      principal: VENDOR_SIGNING_PRINCIPAL,
      key: VENDOR_SIGNING_KEY,
      keyFingerprint: VENDOR_SIGNING_FINGERPRINT,
      method: 'ssh-keygen -Y verify',
      source: 'pinned evidence captured during FASE F preflight',
      verifiedAt: now,
      detail: result.stdout.trim(),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
