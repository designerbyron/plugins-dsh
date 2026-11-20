# Capturas de pantalla — por qué no hay

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fecha:** 2026-11-19

---

## 1. Decisión

**No se incluyen capturas.** No es un olvido: la única captura que aportaría algo exige una condición que
esta autorización prohíbe.

## 2. Razonamiento

| Captura posible | ¿Aporta? | ¿Se puede obtener? |
|---|---|---|
| Estado actual del host (sin reiniciar) | **No**: muestra el estado anterior a K1, con el plugin sin cargar. Presentarla como evidencia del trabajo sería engañoso | sí, pero no se hizo para no interferir con una sesión viva |
| Panel nuevo montado en el host | **Sí**: es la prueba visual de A-4/A-5/A-8 | **no**: exige reiniciar el host (prohibido) |
| Panel a 390 px en navegador real | sí (parcial) | no: no hay navegador con el bundle servido sin host |
| Consola sin `TypeError` | sí | no: requiere el host con el bundle nuevo |

## 3. Qué haría falta para tenerlas

1. Autorización de un **reinicio controlado** del host.
2. Tras el reinicio: `__DSH_BOOT__.entries` filtrado a `@local/lifecode-rag`, captura de la fila en la barra
   (con la barra desplegada), captura del panel en `main`, consola limpia y conteo DOM
   (`.lcr-root` 1 → 0 al cambiar de panel).
3. Repetir tras un segundo reinicio, para A-8.

Ese paquete es exactamente el que `02 — K1-A-CLIENT-INTEGRATION.md` §8 K1-A-09 describe y el que la
evidencia de este acto **no** puede producir.

## 4. Sustituto usado

Mientras no haya host, la evidencia es estructural y ejecutable: 31 pruebas del módulo que montan el panel
con un runtime de hooks, recorren las pestañas, verifican la región viva, el aviso, la navegación y la
ausencia de red y temporizadores. Eso demuestra el **contrato del módulo**, no el montaje del anfitrión, y
así se declara en `CRITERIOS.md` (A-2/A-4/A-5/A-8 = `NOT TESTED`).
