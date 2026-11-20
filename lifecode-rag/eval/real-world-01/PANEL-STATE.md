# Panel Project-Aware: estado tras la investigación

## Resultado de la investigación

- **No se ha encontrado API de proyección de sesión host → renderer** para plugins de cliente en el host
  extraído (`app.asar` 0.2.2-rc.5): `useProjection` no aparece en `client-modules-README.md`,
  `client-modules-index.ts`, `client-modules-manifest.ts` ni en el resto de ficheros extraídos. La única
  mención de «projection» es interna del boot graph, no una superficie para plugins.
- La vía HTTP sigue sin identidad de sesión (PA01 / D-UI-03): montar un endpoint sería exponer el almacén a
  cualquier proceso local.

## Decisión

El panel **sigue siendo demostrativo**, con `DATA_MODE='fixture'` fijado en código:

- declara el modo en la cabecera (banner `SYNTHETIC DATA MODE`);
- no ejecuta operaciones reales;
- no hay botones que aparenten funcionar sin backend: las acciones se resuelven contra el estado en memoria y
  lo que no tiene backend está deshabilitado o marcado.

No se ha creado ningún transporte inseguro y **no se ha bloqueado el uso del agente**: las siete herramientas
operan con datos reales por su cuenta.

## Qué haría falta

1. Que el host publique una proyección de sesión para plugins (o una capacidad de sesión efímera).
2. Registrar en el plugin una unidad que proyecte `proyecto activo`, `bibliotecas`, `fuentes`, `estado` y
   `errores` ya filtrados por ámbito.
3. Verificar en host el montaje, la consola y el desmontaje (hoy `NOT TESTED`).
