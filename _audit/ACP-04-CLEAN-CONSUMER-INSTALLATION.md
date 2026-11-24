# ACP-04 — Instalación en consumidor limpio

**Verificado:** 2026-11-22 05:08 UTC
**Directorio:** `C:\Users\BYRON\AppData\Local\Temp\lifecode-rag-acp04-consumer` (nuevo, fuera del repo)
**Resultado: FAIL** para la instalación de 1.0.0 desde el registro. El registro sólo sirve el stub.

---

## 1. Instalación de la versión objetivo

```
$ cd %TEMP%\lifecode-rag-acp04-consumer
$ npm init -y
$ npm install @designerbyron/lifecode-rag@1.0.0
npm error notarget No matching version found for @designerbyron/lifecode-rag@1.0.0.
```

El registro no tiene la 1.0.0: la instalación falla antes de descargar nada. No se usó tarball local ni
`npm link`.

## 2. Instalación sin versión (lo que el registro ofrece hoy)

```
$ npm install @designerbyron/lifecode-rag
added 1 package in 1s

$ node -e "console.log(require('./node_modules/@designerbyron/lifecode-rag/package.json'))"
{ name: '@designerbyron/lifecode-rag', version: '0.0.0-stage', stub: true,
  description: 'Temporary package placeholder for staged publishing' }
```

Se instala correctamente, pero es un placeholder: no hay `index.js`, ni `lib/`, ni herramientas, ni panel.

## 3. Criterios del encargo

| Criterio | Resultado | Evidencia |
|---|---|---|
| Instalación exitosa **desde npm** de la versión objetivo | **FAIL** | `E404 notarget` para `@1.0.0` |
| Versión instalada exactamente `1.0.0` | **FAIL** | lo instalable es `0.0.0-stage` |
| Resolución de exports públicos | BLOCKED | no hay módulo que resolver en el stub |
| Resolución de módulos internos (`./lib/*`) | BLOCKED | `lib/` no existe en el stub |
| Imports principales | BLOCKED | idem |
| Ausencia de dependencias del repo de desarrollo | N/A | el stub no tiene dependencias porque no tiene código |
| Instalación con el artefacto autorizado (tarball local) | **PASS** (ACP-03) | 7 herramientas, CLI y panel verificados |

## 4. Lo que sí está probado, y con qué

| Prueba | Artefacto | Resultado |
|---|---|---|
| Instalación en consumidor limpio | `designerbyron-lifecode-rag-1.0.0-MIT.tgz` (`sha256 595c6e19…`, `shasum b2c0f43d…`) | PASS |
| Exports `.`, `./client`, `./package.json`, `./lib/*.mjs` y `./lib/*` | mismo tarball | PASS |
| Siete herramientas registradas | mismo tarball | PASS (`toolCount: 7`) |
| CLI (`project create`, `root add`, `sync run`, `project list`) | mismo tarball | PASS |
| Panel REAL/DEMO en host aislado | mismo tarball | PASS |

Esa evidencia es la de `ACP-03-CONSUMER-INSTALL-REPORT.md` y sigue siendo válida: el tarball no ha
cambiado desde entonces (`sha256 595c6e19…` recalculado hoy).

## 5. Conclusión

La cadena «artefacto → consumidor» está probada y funciona. Lo que falta es el eslabón del registro: la
1.0.0 no está publicada, así que **no existe todavía un consumidor público que pueda instalarla**.

Para cerrar este informe hace falta, y sólo eso:

1. Publicar el tarball del worktree (`C:/xampp/htdocs/plugins-dhs-release/lifecode-rag`, commit
   `7d7e839`, `npm publish --access public`).
2. Volver a ejecutar en este mismo directorio:
   `npm install @designerbyron/lifecode-rag@1.0.0` y la comprobación de exports y herramientas.

## 6. Veredicto

**FAIL** (criterio obligatorio sin superar: instalación desde el registro público). Sin limitaciones
ocultas: el registro no tiene el producto.
