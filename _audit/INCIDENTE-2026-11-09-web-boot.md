# Incidente — arranque web fallido al recargar el panel (2026-11-09)

## Resumen

Durante la ronda R15.1 se recargó la página del harness para servir un
`client.js` recién editado. La recarga se hizo **después** de desactivar y
reactivar el bundle `@local/lifecode-skill-center` con el gestor de plugins. En
esa secuencia, el renderer pidió el bundle de cliente con una revisión ya
obsoleta, recibió `404` y el arranque web de DSH se detuvo con el diálogo
«La aplicación no pudo iniciarse o se detuvo inesperadamente».

No hubo pérdida de datos, ni cambios en el producto, ni corrupción del perfil.
La aplicación volvió a arrancar y el panel se abrió correctamente.

## Evidencia

Salida de la consola de DevTools en el momento del fallo (capturada en
`_audit/r151-after-reload2.png` y `_audit/r151-recovery.png`):

```
GET dsh-app://app/plugins/?%2e@local/lifecode-skill-center/client.js&rev=5cc245c98577
  → net::ERR_ABORTED 404 (Not Found)
Error: web boot: 1 entry did not activate
  @local/lifecode-skill-center: import failed (see console for the import error)
```

Diálogo del shell: «La aplicación no pudo iniciarse o se detuvo
inesperadamente — web boot: 1 entry did not activate».

## Causa

1. `plugin_manager set_bundle(@local/lifecode-skill-center, enabled:false)` y
   después `enabled:true` cambian la revisión publicada del bundle de cliente.
2. La página que estaba abierta seguía pidiendo la revisión anterior
   (`rev=5cc245c98577`), que ya no estaba disponible: `404`.
3. El arranque web es *fail-closed*: si una entrada del cliente no activa, no
   monta la aplicación y muestra la pantalla de recuperación.

El orden correcto es el inverso: **primero** dejar el bundle activo y su
revisión publicada, **después** recargar; y si el bundle se tocó, la vía
soportada es reiniciar la aplicación, no recargar la página con el manifest
viejo en memoria.

## Recuperación aplicada

1. Reinicio de la aplicación (Diálogo → «Reiniciar»), que vuelve a leer el
   perfil y republica la revisión del bundle.
2. Verificación en vivo: ventana nueva `HWND 460916`, GUI en
   `http://127.0.0.1:65024`, panel abierto en Resumen y Analítica con el CSS
   nuevo (`_audit/r151-panel-reopen.png`, `_audit/r151-after-1920.png`).

## Verificación de integridad tras el incidente

| Elemento | Estado medido |
|---|---|
| `center.json` | 44 522 B · `d431f76337f236486245af563775ae18036311f87559b11ff08a885d9375dfce` · mtime `2026-11-09T07:01:55Z` |
| `knowledge.json` | 6 802 B · `e028af3aa402ce84f834cf206ca9cd9c6d2e4dbaad7719fce4c5d1a557545cea` · mtime `2026-11-09T15:51:58Z` |
| Git | `HEAD 3b29510`, rama `feature/visual-operation-feedback`, 108 entradas en `git status --short`, 0 preparadas |
| `skill-compiler/` | intacto (14 entradas preexistentes) |
| Perfil / plugins | `@local/lifecode-skill-center` habilitado; único aviso preexistente: `hooks-claude-code` no resoluble |

## Reglas que quedan

- No usar `disable → enable` del bundle como atajo para recargar el cliente; si
  hace falta servir código nuevo, reiniciar la aplicación o usar el HMR del
  cliente con su watcher corriendo.
- Recargar sólo con el bundle activo y su revisión publicada.
- El arranque web falla cerrado: un `404` de un bundle de cliente deja la
  aplicación en pantalla de recuperación, no en un estado parcial.
- Un fallo de arranque **no** es evidencia de daño en los almacenes: se verifica
  con las huellas SHA-256 antes de tocar nada.

## Archivos de evidencia

- `_audit/r151-after-reload.png` — primer intento de recarga por Ctrl+R (no recargó).
- `_audit/r151-after-reload2.png` — consola con el `404` y el diálogo de fallo.
- `_audit/r151-recovery.png` — escritorio con la ventana recuperada.
- `_audit/r151-panel-reopen.png` — panel abierto de nuevo (Resumen).
- `_audit/r151-after-1920.png` — Analítica tras la recuperación.
