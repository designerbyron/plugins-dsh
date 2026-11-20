# Informe ejecutivo — auditoría funcional de LifeCode RAG

**Acto:** `HERMES-LCRAG-FUNCTIONAL-AUDIT-01` · **Fecha:** 2026-11-19
**Alcance:** verificación post-reinicio y auditoría funcional de las diez vistas, sin rediseño y sin tocar código.
**Resultado global:** **AUDITORÍA COMPLETADA** — cliente montado y funcional sobre fixtures; API real no montada;
14 defectos registrados (0 P0/P1/P2); gates de seguridad intactos.

---

## 1. Las diez preguntas

### 1 · ¿Está LifeCode RAG correctamente montado en DeepSeek Harness?
**Sí, la mitad cliente.** El plugin está registrado en el perfil `desktop` (`link:` + `bundles`), el host es
**0.2.2-rc.5**, y las capturas muestran la fila «LifeCode RAG» con las nueve pestañas operativas tras el
reinicio. Lo que **no** está montado es la API Project-Aware: la propia vista «Conexión» lo dice
(`no montada`). Montaje del cliente y montaje de la API son dos hechos distintos y así se documentan.

### 2 · ¿Qué partes son realmente funcionales?
- Navegación entre 9 vistas, con pestaña activa y teclado.
- Selección de proyecto sobre el fixture (cambia revisión, proyecto y registro).
- Paginación de fuentes (50 de 121, 3 páginas).
- Búsqueda con procedencia por ámbito y contexto con 9 campos de cita.
- Ingesta y reindexación **simuladas**, con éxito, error y registro.
- Diagnóstico, conexión e historial con sus estados.

### 3 · ¿Qué funciona sólo con fixtures?
Todo lo que muestra datos: proyectos, bibliotecas, fuentes, búsqueda, contexto, diagnóstico, versiones y
estado de servicio. No hay una sola lectura real en el panel.

### 4 · ¿Qué está no disponible por diseño?
Historial (sin ruta contractual), concesión/revocación de bibliotecas (sólo lectura), API visual (no existe),
modo `live`, estados de carga (fixtures síncronos), paginación de fragmentos (GAP-05), detalle por embedding
(GAP-10), diagnóstico multi-ámbito completo (GAP-06) y auditoría de lecturas (GAP-07).

### 5 · ¿Hay defectos funcionales?
**Sí: 14.** Ninguno P0/P1/P2. Ocho P3: dos claves sin traducir que llegan a la UI (FA-01 `common.yes` visible
en Diagnóstico; FA-02 `common.detail` latente), formulario de búsqueda roto por colisión de CSS (FA-03),
búsqueda vacía sin validación (FA-05), URI duplicada sin aviso (FA-06), sin frontera de error por vista
(FA-10), botón de contexto activo sin resultados (FA-12) y paginación fuera de vista (FA-14, sin confirmar).
Seis P4 cosméticos. Detalle en `DEFECT-REGISTER.md`.

### 6 · ¿Hay problemas de consistencia de datos?
**Tres, y ninguno de conteo.** (a) Claves sin traducir en dos columnas; (b) el título de una fuente no
concuerda con su colección («Guía de operación» en `normativa`); (c) la versión del anfitrión que muestra
Diagnóstico es un dato del fixture, no una lectura del host — coincide con la real, pero no se lee de ella.
Los conteos y estados **sí** concuerdan entre vistas: 3 ámbitos, 121 fuentes, una biblioteca `missing` en las
tres vistas donde aparece, y `degraded` coherente entre Proyecto y Conexión.

### 7 · ¿Es demostrable el aislamiento de fixtures?
**Sí, con cuatro mecanismos independientes:** modo fijo sin control, guarda que cierra la capa heredada,
espías con 0 `fetch` y 0 temporizadores en todo el recorrido, y puerta hermética con el almacén real intacto
(5 ficheros, misma huella). No es una certificación de seguridad: no hay autenticación de sesión.

### 8 · ¿Qué sigue bloqueado por la arquitectura del anfitrión?
La identidad de sesión (PA01), la API visual, la auditoría `ui.read` (G6b), G5 y G6. D-UI-03 sigue
`PENDING HUMAN DECISION`, la Ruta A `BLOCKED`, la Ruta B `NOT DEMONSTRATED` y Ruta C no aceptada.

### 9 · ¿Qué corregir antes del rediseño?
Los cinco arreglos de comportamiento/texto que no dependen del diseño: FA-01, FA-02 (dos claves), FA-05
(validación), FA-06 (duplicado) y FA-12 (botón). Son cambios pequeños y con prueba de regresión clara.
FA-10 (frontera de error) y FA-14 (paginación) requieren decisión y medición en host. FA-03 es la bisagra:
renombrar las clases del panel resuelve el formulario y evita que el rediseño vuelva a chocar con el CSS
heredado.

### 10 · ¿Alcance recomendado de la fase de rediseño?
Una fase contenida, con estos límites:
- **Dentro:** namespace de clases del panel (`lcr-pa-*`), cuerpo de tarjeta con padding, formulario en fila,
  semántica visual de estados, densidad y cabecera fija de tablas, jerarquía tipográfica, estados vacíos y
  banner más compacto. Los 14 problemas visuales (V-01…V-14) son el backlog.
- **Fuera:** cualquier cambio de comportamiento, la API, la seguridad y los gates. Nada de dependencias nuevas.
- **Invariantes:** banner visible en una sola región viva, sin control de `live`, limitaciones GAP visibles,
  historial declarado no disponible, accesibilidad que no retroceda.

---

## 2. Estado por dimensión

| Dimensión | Estado |
|---|---|
| Montaje del cliente | **VERIFIED HOST** (capturas) |
| Montaje de la API | **NO MONTADA** (por diseño) |
| Datos | **FIXTURES** exclusivamente |
| Vistas operativas | 9/9 renderizan; detalle de fuente `TESTED LOCAL` |
| Acciones de usuario | 13, todas con comportamiento conocido |
| Defectos | 14 (8 P3, 6 P4; 0 P0/P1/P2) |
| Aislamiento | demostrado por pruebas + hermético |
| Gates de seguridad | intactos |
| Rediseño | **no iniciado**, insumos listos |

## 3. Evidencia

`HOST-VERIFICATION.md` · `VIEW-BY-VIEW-RESULTS.md` · `DATA-PROVENANCE-MATRIX.md` ·
`SECURITY-AND-FIXTURE-VERIFICATION.md` · `TEST-RESULTS.md` · `DEFECT-REGISTER.md` ·
`VISUAL-OBSERVATIONS.md` · `ACCEPTANCE-MATRIX.md` · `screens/` (10 capturas, hashes idénticos a los
originales) · `logs/` (suite, hermético, check) · `HASHES.txt`.

## 4. Lo que este acto no hizo

- No modificó código, CSS, layout, tokens ni configuración.
- No reinició el host, no instaló, no cambió perfiles.
- No accedió a datos reales, ni activó `live`, ni montó la API.
- No tocó Git (cero operaciones de escritura).
- No cerró ningún gate de seguridad.

**Parada:** la auditoría termina aquí. El rediseño es otro acto.
