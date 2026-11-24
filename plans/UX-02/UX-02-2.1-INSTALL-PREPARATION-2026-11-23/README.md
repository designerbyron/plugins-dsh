# Expediente: instalación de LifeCode RAG 1.3.0 en DSH real
## Preparación — **nada ejecutado**

**Estado:** expediente completo para revisión. La instalación **no se ha ejecutado**; el host sigue con
**1.2.0** y los datos intactos.
**Fecha:** 2026-11-23T03:44–03:49Z · **Perfil inspeccionado:** `desktop` de `C:\Users\BYRON\.dsh`
**Artefacto objetivo:** `@designerbyron/lifecode-rag@1.3.0` publicado (`sha256 f848b73e…`, `dist.integrity sha512-Q/EvDeGx…`, 74 ficheros).

---

## Documentos

| # | Documento | Qué resuelve |
|---|---|---|
| ⭐ | [`PROCEDIMIENTO-DEFINITIVO.md`](PROCEDIMIENTO-DEFINITIVO.md) | **el procedimiento a autorizar**: hashes, respaldos, puertas, comandos exactos, ensayo del lock, las 9 paradas y el rollback |
| ⭐ | [`CONTROLES-PA01-INSTRUCCIONES.md`](CONTROLES-PA01-INSTRUCCIONES.md) | los seis controles que ejecuta el propietario en el panel, con ficha de captura y plan B |
| 1 | [`INFORME-INSPECCION.md`](INFORME-INSPECCION.md) | estado real del perfil, del paquete instalado, del host, de los almacenes y del núcleo headless; separa **observado / inferido / pendiente** |
| 2 | [`INVENTARIO-VERSIONES-Y-DEPENDENCIAS.md`](INVENTARIO-VERSIONES-Y-DEPENDENCIAS.md) | versiones, origen de cada dependencia (`link:` vs npm vs GitHub), las tres entradas del lock y los hashes del 1.2.0 instalado |
| 3 | [`PLAN-INSTALACION.md`](PLAN-INSTALACION.md) | precondiciones, cierre limpio del host, instalación **quirúrgica**, `minimumReleaseAge`, lock y comprobación de carga |
| 4 | [`MANIFIESTO-RESPALDOS-PROPUESTOS.md`](MANIFIESTO-RESPALDOS-PROPUESTOS.md) | qué se respalda, dónde, cómo se valida (hash + apertura en sólo lectura + recuentos) y el formato del manifiesto |
| 5 | [`PLAN-ROLLBACK.md`](PLAN-ROLLBACK.md) | tres niveles de vuelta atrás, verificación y ensayo previo |
| 6 | [`MATRIZ-VALIDACION.md`](MATRIZ-VALIDACION.md) | 10 áreas con criterio PASS/FAIL y qué queda `BLOCKED` sin la sesión del propietario |
| 7 | [`RIESGOS-Y-CONDICIONES-DE-PARADA.md`](RIESGOS-Y-CONDICIONES-DE-PARADA.md) | 12 riesgos con detección y mitigación, 9 condiciones de parada, riesgos residuales |
| 8 | `DELIVERABLES.sha256` | hashes de todo el expediente (LF, `sha256sum -c`) |
| — | `evidence/` | las mediciones crudas: entorno, huella antes, inspección consolidada, procesos/puertos, API sin credencial, comparación 1.2.0 y headless |

## Los cinco datos que gobiernan la fase siguiente

1. **El 1.2.0 instalado es exactamente el publicado**: 73/73 ficheros con el mismo sha256 que el tarball del
   registro. El rollback no depende de reconstruir nada.
2. **`nodeLinker: hoisted` y sin `node_modules/.pnpm`**, con un `link:` y tres dependencias `github:` en el
   mismo perfil → `pnpm add` puede mover paquetes ajenos. La vía del plan es **quirúrgica**.
3. **`minimumReleaseAge` está `undefined` hoy** (no bloquea 1.3.0), pero se re-mide antes de instalar y, si
   aparece, se exceptúa **esa versión** en este perfil, no la política global.
4. **El host está vivo** (5 procesos, `127.0.0.1:57200`, marcador `background-close-confirmed`): hay que
   cerrarlo limpio antes de tocar `node_modules`, y comprobar `-wal` a 0 B.
5. **La compuerta PA01 no se puede superar sin la sesión del propietario**: los controles de API y de
   Workspace Discovery quedan `BLOCKED` para el agente y se cierran con el propietario en el panel o en una
   instancia aislada.

## Decisiones del propietario aplicadas en este expediente

| Decisión | Contenido | Dónde se aplica |
|---|---|---|
| **D-INS-01** | Instalación **quirúrgica**: tarball npm verificado, sustitución controlada del directorio y cambio mínimo del lockfile. Sin `pnpm add` ni resolución general; lock validado en copia con `--frozen-lockfile --offline`; `@local/skill-compiler` y el resto de dependencias ajenas intactas | `PROCEDIMIENTO-DEFINITIVO.md` §0, §5 |
| **D-INS-02** | Controles autenticados los ejecuta el propietario; el agente prepara las instrucciones y registra los resultados, sin pedir credenciales; un `401` no prueba existencia ni funcionamiento | `CONTROLES-PA01-INSTRUCCIONES.md` |

**Estado de autorización:** estas decisiones **no autorizan** la instalación. La ejecución exige autorización
nueva y explícita, atada al hash de `PROCEDIMIENTO-DEFINITIVO.md`.

## Lo que este expediente no hace

No instala, no enlaza, no reinicia el host, no abre bases en escritura, no toca sidecars, no reindexa y no
hace operaciones Git. La ejecución exige una autorización nueva y explícita.
