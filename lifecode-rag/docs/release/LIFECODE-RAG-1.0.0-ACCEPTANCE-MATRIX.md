# LifeCode RAG 1.0.0 · Matriz de aceptación

Cada fila del «definition of done» con su veredicto y **dónde está la evidencia**. `PASS` = medido;
`PASS (declarado)` = cumple y su prueba en vivo no se repitió en este acto (motivo en el informe final §3).

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Instalado en el perfil habitual de DSH | **PASS** | `package.json` → `link:C:/xampp/htdocs/dsh-plugins-store/lifecode-rag/acp01-7f174851218a`; junction resuelta al mismo destino; `bundles` lo incluye (`ACP-01-FINAL-VERIFICATION.json` → `profile`) |
| 2 | El plugin carga sin errores | **PASS** | Instancia real arrancada 3 veces; panel montado y `GET /snapshot` → `200` con `pa/1.1.0` |
| 3 | Las siete herramientas se registran y funcionan | **PASS (declarado)** | Registro: `apply` monta el panel (misma función registra las 7) y `tools/check.mjs` las enumera; funcionamiento: 433 pruebas, incluidas `tool-golden`, `integration`, `partial-results`. Sin invocación del modelo en esta sesión (final §3.1) |
| 4 | El panel funciona en REAL | **PASS** | Capturas en la instancia del propietario: `data-mode=api`, sin banner, 121 fuentes (página 1 de 3), proyecto y revisión reales |
| 5 | DEMO sigue aislado | **PASS (declarado)** | `client.js` arranca en `fixture` y sólo pasa a `api` si `/snapshot` responde `mode:'api'`; pruebas de diccionarios y de vistas; no se conmutó a DEMO en pantalla (final §3.3) |
| 6 | Rutas PA protegidas por la autenticación oficial del host | **PASS** | Antes: `200` sin cookie en `/pa/health`. Después: `401 unauthenticated` en `/config`, `/snapshot`, `/health`, `/selection`, `/actions` y rutas inventadas, sin cookie; `200` con la cookie del host. Lab y perfil real |
| 7 | No se informa una identidad de usuario falsa | **PASS** | `auth: {principal:'owner'}` (lo único que declara `PrincipalMap`); ninguna cabecera del renderer concede identidad (`x-user`, `x-principal`, `authorization: Bearer` → 401) |
| 8 | CR-1 correcto bajo concurrencia | **PASS** | `tests/selection-cas.test.mjs`: dos paneles con la misma revisión → exactamente un 200 y un 409; revisión avanza una sola vez |
| 9 | La selección de proyecto persiste | **PASS** | Revisión 1 → reinicio del proceso → sigue en 1 y resuelve el proyecto por defecto; luego 2 y 3 desde el panel, con aviso de confirmación |
| 10 | Procedencia de fuentes correcta | **PASS** | `/search` y `/context` devuelven URI relativa a la raíz autorizada y `scopeId`/`scopeKind`; captura de «Fuentes» con URI relativas y fechas reales |
| 11 | El contexto respeta la configuración | **PASS** | `POST /context` con `budgetTokens=300` → 289 tokens, `truncated:false`, 3 citas; banco: 1702 tokens medios con presupuesto 2000 |
| 12 | Las operaciones sensibles siguen protegidas | **PASS** | `POST /actions` → `403 approval-required` aun autenticado; escribir exige las herramientas + aprobación del host |
| 13 | Suite de regresión relevante en verde | **PASS** | 433/433 (`node --test --test-concurrency=1`), `check` ✓, `hermetic` ✓ (almacén real sin cambios) |
| 14 | Los datos existentes siguen intactos | **PASS** | Ambas bases de ámbito con sha256 idéntico al baseline (`4dcf31c4cb70…`, `0788ffb4c59c…`), `quick_check=ok`, 121 y 0 fuentes; sólo cambió `registry.sqlite3` por la migración aditiva v2 + 3 entradas de auditoría |
| 15 | DSH reinicia correctamente | **PASS** | Tres cierres ordenados (ventana → `taskkill /T` → `Stop-Process`, WAL a 0 B) y tres arranques; 0 procesos huérfanos |
| 16 | Simulación de uso diario | **PASS (parcial declarado)** | Abrir ventana, abrir panel, REAL, proyecto activo, listar 121 fuentes, cambiar de proyecto (CAS), comprobar diagnóstico/conexión/operaciones/bibliotecas, reinicio y persistencia. Búsqueda y contexto del panel validados por HTTP autenticado, no tecleando (final §3.2) |
| 17 | Procedimiento de vuelta atrás verificado | **PASS** | Respaldo restaurado en un directorio de ensayo: hashes idénticos al manifiesto (`80d64e0a749d…`, `4dcf31c4cb70…`, `0788ffb4c59c…`), `quick_check=ok`, `user_version=1`, 2 proyectos; y el **build anterior** (`655f03758fe1`, 407 ficheros intactos) **abre** ese registro restaurado (11 tablas, 2 proyectos). Ver `LIFECODE-RAG-1.0.0-ROLLBACK-GUIDE.md` |
| 18 | Documentación y manifiestos completos | **PASS** | Este paquete (7 documentos) + contrato `PA-UI-0` §6.2/§7/§9.1/§15 y contrato de datos §3/§8 actualizados |
| 19 | Sin defectos críticos abiertos | **PASS** | Cuatro defectos encontrados en este acto, corregidos y con prueba: (a) API PA abierta; (b) selección simulada en el cliente; (c) fuentes del proyecto anterior tras cambiar de selección; (d) total de fuentes = tamaño de página |

## Hallazgo que no es del acto (declarado, no corregido)

- `lib/errors.mjs` publica `RAG_CODES` como catálogo cerrado, pero `RagError` no valida el código: hay códigos
  usados en el código que no están en la lista histórica (`registry-corrupt`, `scope-forbidden`,
  `session-expired`, `project-not-authorized`, `scope-ambiguous`…). Mapear errores por esa lista deja fuera
  justo los de seguridad. **Se reporta y se propone** cerrar el catálogo o validar el constructor en un acto
  aparte: cambiarlo aquí tocaría 20+ ficheros fuera del alcance de ACP-01.
