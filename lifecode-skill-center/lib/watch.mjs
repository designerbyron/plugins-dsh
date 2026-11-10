/**
 * Vigilante del almacén: cuando el documento cambia, avisa.
 *
 * Existe por un defecto medido, no por elegancia: el registro de skills **cachea los catálogos** y sólo
 * los tira cuando un provider llama a la invalidación que le entrega al registrarse. Sin este aviso, una
 * skill encendida desde el panel no llegaría al agente hasta reiniciar el harness — y la promesa del
 * producto es que encender y apagar se nota, no que se nota mañana.
 *
 * Dos vías a propósito, porque una sola miente:
 *   - `fs.watch` sobre la carpeta: inmediato, y el que hace que el panel se sienta vivo.
 *   - sondeo del mtime: lento (4 s) y feo, pero `fs.watch` no es fiable en todas las rutas (unidades de
 *     red, algunos montajes de Windows) y ahí la alternativa sería no enterarse nunca.
 *
 * El aviso va con antirrebote: guardar son varias escrituras (temporal y rename) y no queremos invalidar
 * cuatro veces por guardado.
 */

import { existsSync, statSync, watch } from 'node:fs';
import { dirname } from 'node:path';
import { centerFile } from './state.mjs';

/**
 * @param {{ root: string, onChange: () => void, debounceMs?: number, pollMs?: number }} options
 * @returns {{ start: () => void, stop: () => void, poke: () => void }}
 */
export function createStoreSignal({ root, onChange, debounceMs = 120, pollMs = 4000 }) {
  const file = centerFile(root);
  const directory = dirname(file);
  let watcher = null;
  let timer = null;
  let interval = null;
  let last = 0;
  let stopped = true;

  const current = () => {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  };

  const fire = () => {
    if (stopped) return;
    try {
      onChange();
    } catch {
      // un cambio que no se puede invalidar no puede tumbar al vigilante
    }
  };

  const schedule = () => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fire();
    }, debounceMs);
    timer.unref?.();
  };

  const check = () => {
    const next = current();
    if (next === last) return;
    last = next;
    schedule();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      last = current();
      try {
        watcher = watch(directory, { persistent: false }, (event, filename) => {
          if (filename === null || filename === undefined || String(filename) === 'center.json') check();
        });
        watcher.on?.('error', () => {
          try {
            watcher?.close();
          } catch {
            /* ya cerrado */
          }
          watcher = null; // queda el sondeo, que es para lo que está
        });
      } catch {
        watcher = null; // la carpeta aún no existe: el sondeo la detectará cuando aparezca
      }
      interval = setInterval(check, pollMs);
      interval.unref?.();
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      try {
        watcher?.close();
      } catch {
        /* ya cerrado */
      }
      watcher = null;
    },
    /** Fuerza una comprobación: la usa lo que acaba de escribir y no quiere esperar al antirrebote. */
    poke() {
      if (stopped) return;
      if (existsSync(file)) check();
    },
  };
}
