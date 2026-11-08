# Operación

## Arranque

1. El plugin está instalado por ruta en el perfil (`link:` + entrada en `dsh.profile.bundles`).
2. Al montar: deja su sección de prompt, registra las cuatro herramientas, registra el proveedor de skills,
   monta el vigilante del almacén y registra la ruta del panel si hay `webServer`.
3. El log del arranque dice la raíz y la ruta: `lifecode-skill-center: centro en … · api /lifecode-skill-center/api` (la base se registra sin barra final).
   Es lo primero que se mira cuando «el panel no aparece».

Si el perfil no tiene servidor web, el plugin sigue sirviendo herramientas y catálogo; lo único que falta es
la interfaz.

## La rutina de cada día

- **Crear** desde el panel (botón *Nueva skill*) o pidiéndoselo al agente. La compuerta enseña los hallazgos
  antes de publicar: lo bloqueante no entra.
- **Encender** en el proyecto: interruptor por skill y proyecto en *Projects*. Es una decisión humana; la IA
  recibe `approval-required` si lo intenta.
- **Cambiar de versión**: selector por skill y proyecto. Apagar no olvida la versión puesta.
- **Aprobar mejoras** en *Improvements*: se ve la diferencia calculada en el servidor (la interfaz no ejecuta
  el núcleo) y el resultado de la compuerta.
- **Importar** lo que ya existía: en *Library* aparecen los candidatos externos detectados en disco.

## Dónde mirar cuando algo no cuadra

| Síntoma | Qué comprobar |
|---|---|
| No aparece el icono en la barra lateral | El plugin montó (log de arranque). Reinicia el harness tras instalar. |
| El panel abre pero no carga datos | `GET /lifecode-skill-center/api/state` en la misma sesión del navegador; mira el estado HTTP. |
| Enciendo y el agente no la ve | ¿El proyecto del agente es el mismo que encendiste? El selector del panel usa la carpeta del proceso; el agente usa la de su sesión. |
| Cambié una skill y el agente sigue con lo viejo | El catálogo se invalida al guardar; si el almacén se tocó por fuera, el vigilante tarda hasta 4 s. |
| El panel dice «no publicable» | Los hallazgos salen en el cajón de la skill: primero los bloqueantes. |
| `storeError` en *Analytics* | El `center.json` no parsea. El centro arranca tolerante con un documento vacío; el fichero roto se aparta antes de seguir. |

## Copias y restauración

Todo el estado son dos cosas: `center.json` (la verdad) y `materialized/` (derivado, reproducible con
`sync`). Copiar el almacén entero basta; restaurar el documento y pedir `sync` rehace la vista.

Nada de esto se toca sin permiso de la persona: instalar, borrar, importar o publicar son decisiones suyas.
Las pruebas **miden** que el almacén real no cambia (`npm run test:hermetic`).

## Diagnóstico rápido

```sh
npm test                 # comportamiento
npm run check            # instalación y pureza del núcleo
node tests/check-hermetic.mjs
```

## Límites conocidos, dichos sin adornos

- Las revisiones no corren con el harness cerrado: no hay servicio de fondo. Se disparan por acción, por
  apertura del panel y por cambio del almacén.
- `skill.loaded` es telemetría de entrega, no de aplicación. La analítica lo dice en el panel.
- La vista materializada no se limpia sola si un proyecto desaparece de la carpeta: se limpia al sincronizar
  ese proyecto. No borra nada fuera de su carpeta.
- El texto visible está en español e inglés; el diccionario es del cliente, no del harness.- Mover o renombrar la carpeta de un proyecto cambia su id (sale de la ruta) y las asignaciones **no
  siguen**. El registro conserva la identidad vieja: hay que volver a encender las skills en la nueva.
- La API vive en localhost y **no tiene credenciales**: cualquier proceso local puede actuar como persona.
  Las páginas de otro origen se rechazan con 403 comparando `Origin`, pero eso no autentica a un proceso.
  El almacén está en el perfil del usuario y no hay acción de borrado de skills.
- `skill.loaded` se anota **una vez por día, skill y proyecto** (deduplicado): la KPI «Cargas» cuenta días
  con al menos una entrega del catálogo, no cada entrega.
