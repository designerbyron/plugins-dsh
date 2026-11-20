/**
 * Adaptador de identidad de sesión (PA2.1).
 *
 * El host expone `Agent = { id: SessionId }` (ver `@deepseek-ai/dsh-agent`). Este módulo no
 * inventa propiedades: toma `agent.id` como identidad estable, la valida y la ata al perfil
 * activo en el momento de capturarla. El nombre visible de la conversación no se usa nunca.
 *
 * Si algún día el host cambia la forma de `Agent`, este es el único punto que hay que tocar.
 */

import { RagError } from './errors.mjs';
import { profileKey } from './profile.mjs';

/** Un `SessionId` del host es opaco, pero el registro lo guarda como TEXT imprimible de 1..200. */
export const SESSION_ID_PATTERN = /^[\x20-\x7e]{1,200}$/;

export function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new RagError('session-invalid', 'la identidad de sesión no es válida', {
      details: { reason: typeof sessionId === 'string' ? 'format' : 'missing' },
    });
  }
  return sessionId;
}

/**
 * Captura la identidad estable desde el `Agent` del host. Devuelve también la clave del perfil,
 * para que el registro pueda rechazar una identidad capturada en otro perfil.
 */
export function captureSession(agent, { env = process.env, now = Date.now() } = {}) {
  if (!agent || typeof agent !== 'object') {
    throw new RagError('session-invalid', 'no hay identidad de sesión en la ejecución', {
      details: { reason: 'missing-agent' },
    });
  }
  const sessionId = assertSessionId(agent.id);
  return { sessionId, profileKey: profileKey(env), capturedAt: now };
}

/** Verifica que una identidad capturada pertenece al perfil del registro abierto. */
export function assertProfile(identity, expectedProfileKey) {
  if (!identity || typeof identity !== 'object') {
    throw new RagError('session-invalid', 'falta la identidad de sesión', { details: { reason: 'missing-identity' } });
  }
  if (identity.profileKey !== expectedProfileKey) {
    throw new RagError('session-invalid', 'la sesión pertenece a otro perfil', {
      details: { reason: 'profile-mismatch' },
    });
  }
  return identity.sessionId;
}
