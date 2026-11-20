# Evidencia de ausencia de acceso a datos reales

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fecha:** 2026-11-19
**Afirmación que se sostiene:** en modo sintético, el panel no habla con ninguna API, no abre ningún
almacén y no escribe nada. **No** se afirma que el producto sea seguro: eso es K1-C y sigue `BLOCKED`.

---

## 1. Cuatro mecanismos independientes

### 1.1 Modo fijado en el código, sin control en la interfaz

```js
const DATA_MODE = 'fixture';   // 'live' no existe como rama habilitada
```

- No hay botón, selector, query, cookie ni atajo de teclado que cambie ese valor.
- `tests/client.test.mjs` falla si aparece `DATA_MODE = 'live'` o si el panel deja de declarar el modo.
- La vista «Conexión» muestra `DATA_MODE` como dato: el modo es visible, no secreto.

### 1.2 La capa de red heredada falla cerrada

La API v0.2 (`/lifecode-rag/api`) sigue existiendo para perfiles con almacén legado, pero su capa
`request()` comprueba el modo **antes** de construir la petición:

```js
if (DATA_MODE !== 'live') { const blocked = new Error(...); blocked.code = 'fixture-mode'; throw blocked; }
```

Prueba: `la capa heredada falla cerrada antes de tocar la red` — el rechazo ocurre con `code:
'fixture-mode'` y el espía de `fetch` queda en **0**.

### 1.3 Espías de red y temporizadores durante toda la interacción

El módulo se ejecuta en un contexto `vm` con `fetch`, `setInterval`, `setTimeout` y
`requestAnimationFrame` instrumentados. La prueba `ninguna interacción dispara red ni temporizadores`
recorre **las nueve pestañas** y pulsa «Reiniciar datos sintéticos»; el resultado es:

```
{ fetch: 0, setInterval: 0, setTimeout: 0, requestAnimationFrame: 0 }
```

Es decir: ni una petición, ni un temporizador, en el flujo completo de navegación.

### 1.4 Puerta hermética sobre el almacén real

`node tools/hermetic.mjs` toma la huella SHA-256 del almacén real antes y después de la suite completa:

```
almacén vivo: C:\Users\<USER>\.dsh\lifecode-rag
huella previa: 5 fichero(s) 0879533f007ccbf9…
✓ hermético: el almacén real no cambió (5 fichero(s))
```

Salida completa en `hermetic.txt`. La suite entera (305 pruebas) corrió entre las dos huellas.

## 2. Qué **no** demuestra esta evidencia

- **No** demuestra que la API visual sea segura: no hay API visual.
- **No** demuestra identidad de sesión: no se envió ninguna cabecera de sesión porque no hay peticiones.
- **No** demuestra aislamiento topológico ni nada de K1-C.
- **No** sustituye a una prueba en el anfitrión: el bundle nuevo **no** se ha cargado en el host (eso exige
  reiniciar, prohibido en este acto).
- Los espías son del sandbox de pruebas; prueban el código del módulo, no el comportamiento del host.

## 3. Lo que sí queda cerrado

| Riesgo | Estado tras K1 |
|---|---|
| El panel lee el almacén legado por accidente | cerrado: la capa de red lanza `fixture-mode` |
| El panel sirve datos reales en un perfil Project-Aware | cerrado: no hay ruta `/ui/api` ni llamada alguna |
| Las operaciones simuladas escriben en el RAG | cerrado: son funciones puras sobre el estado en memoria; el almacén no cambia (hermético) |
| Un control oculto activa `live` | cerrado: el modo es una constante y el gate lo vigila |
