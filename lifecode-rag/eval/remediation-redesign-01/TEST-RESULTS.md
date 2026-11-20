# Resultados de pruebas

Todo ejecutado en este equipo, Node **v24.21.0**, Windows 11. Sin host, sin red, sin almacén real.

## Comandos y resultados

| Comando | Resultado | Registro |
|---|---|---|
| `node --test` | **320 tests · 320 pass · 0 fail · 0 skipped** (25 s) | `logs/suite.txt` |
| `node --test tests/client.test.mjs` | **46 tests · 46 pass · 0 fail** | `logs/client.txt` |
| `node tools/check.mjs` | **ok** — 7 herramientas, sin `@deepseek-ai/*`, manifiesto y G3 correctos | `logs/check.txt` |
| `node tools/hermetic.mjs` | **320/320** + «el almacén real no cambió (5 fichero(s))» | `logs/hermetic.txt` |
| `node eval/…/render-html.mjs` | 10 vistas renderizadas | `logs/render.txt` |

## Comparación Fase A / Fase B

| | Fase A (tras remediar) | Fase B (tras rediseñar) |
|---|---|---|
| Suite | 320 / 320 | 320 / 320 |
| Cliente | 46 / 46 | 46 / 46 |
| `check.mjs` | ok | ok |
| Hermético | almacén sin cambios | almacén sin cambios |
| `fetch` en pruebas | 0 | 0 |

El rediseño **no introdujo ni una regresión**: el mismo conjunto de pruebas pasa antes y después. La fase B
sólo añadió CSS y composición; las únicas pruebas tocadas son las cuatro de la tabla de
`DEFECT-RESOLUTION-MATRIX.md`.

## Cobertura de las regresiones nuevas (14)

1. Claves crudas en las 9 vistas.
2. Diccionario completo y con paridad ES/EN.
3. Aislamiento de clases (estático + dinámico) y ausencia de `!important`.
4. Consulta vacía/en blanco conserva resultados y marca `aria-invalid`.
5. Consulta > 512 rechazada con mensaje.
6. URI duplicada rechazada, con normalización de mayúsculas/espacios/barras.
7. Frontera de error con reintento y sin filtrar el mensaje interno.
8. Cuerpo de tarjeta presente en todas las tarjetas.
9. Contexto deshabilitado sin resultados y habilitado con ellos.
10. Explicación del `degraded` en Diagnóstico y Conexión.
11. Paginación: página 1 ↔ 3, primera/última, anterior/siguiente.
12. Título de fuente coherente con su colección en las 121 fuentes.
13. Caption oculto (uno por tabla).
14. Cabecera con los cuatro estados y una sola región viva.
15. Pestañas y cabecera no comprimibles + raíz con scroll propio (V-07, defecto observado en host).

## Lo que estas pruebas no demuestran

- Que el anfitrión cargue el bundle y monte la fila: eso exige reiniciar Harness (`NOT TESTED` aquí).
- Que el DOM del host no tenga duplicados: sólo se ejercita el componente aislado.
- Comportamiento con lector de pantalla real.

## Pruebas no destructivas

Ninguna prueba abre el almacén, escribe en `.dsh` ni usa red. El hermético compara la huella del almacén
antes y después: **5 ficheros, misma huella**.
