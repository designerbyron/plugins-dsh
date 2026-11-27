/**
 * Fase F / F-31: configuración local de las rutas de las dependencias del importador.
 *
 * Vive en `host/**`, nunca en `lib/**`: es configuración del Host, no del núcleo. Se guarda por
 * perfil, fuera de `center.json` y de los stores RAG, y el adaptador la resuelve de forma explícita
 * para pasarla al preflight y al script. No depende de PATH ni de que una variable de entorno aparezca
 * mágicamente en un proceso hijo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export function vendorConfigPath({ env = process.env, home = homedir(), profile = '' } = {}) {
  const override = typeof env?.LIFECODE_VENDOR_CONFIG === 'string' ? env.LIFECODE_VENDOR_CONFIG.trim() : '';
  if (override !== '') return override;
  const name = String(profile || env?.DSH_PROFILE || 'desktop').replace(/[^A-Za-z0-9_-]/g, '') || 'desktop';
  return join(home, '.dsh', 'profiles', name, 'lifecode-vendor.json');
}

/** Devuelve rutas absolutas o cadenas vacías: una configuración rota nunca habilita un binario. */
export function loadVendorConfig(options = {}) {
  const path = vendorConfigPath(options);
  if (!existsSync(path)) return { path, found: false, jqBin: '', curlBin: '' };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const pick = (key) => {
      const value = typeof raw?.[key] === 'string' ? raw[key].trim() : '';
      return value !== '' && isAbsolute(value) ? value : '';
    };
    return { path, found: true, jqBin: pick('jqBin'), curlBin: pick('curlBin') };
  } catch {
    return { path, found: false, jqBin: '', curlBin: '' };
  }
}
