/**
 * LE-RAG-03 · Contexto de configuración de los trabajadores (scheduler, automatización).
 *
 * Resolución en tres niveles, sin romper contratos existentes:
 *   1. `config` explícita inyectada por el anfitrión (la que ya resolvió el plugin).
 *   2. `dataRoot` + `profileKey` explícitos → resolvedor único (perfil > global > defaults).
 *   3. compatibilidad histórica: el `config.json` del `root` que recibe el trabajador.
 *
 * El nivel 3 se conserva a propósito: hay consumidores legacy que operan sobre un almacén con su
 * propia configuración y no deben heredar la del perfil.
 */
import { loadConfig } from './paths.mjs';
import { resolveConfig, resolveProfileKey } from './config-resolve.mjs';

export function workerConfig({ config = null, dataRoot = null, profileKey = null, root = null, env = process.env } = {}) {
  if (config) return { config, source: 'injected' };
  if (dataRoot) {
    return { config: resolveConfig({ dataRoot, profileKey: profileKey ?? resolveProfileKey(env) }).config, source: 'resolver' };
  }
  if (!root) throw new TypeError('workerConfig necesita config, dataRoot o root');
  return { config: loadConfig(root, env).config, source: 'root' };
}
