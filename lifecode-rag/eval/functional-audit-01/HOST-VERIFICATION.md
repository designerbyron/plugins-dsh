# Verificación del anfitrión tras el reinicio

**Acto:** `HERMES-LCRAG-FUNCTIONAL-AUDIT-01` · **Fase:** A · **Fecha:** 2026-11-19
**Naturaleza:** auditoría de solo lectura. No se reinició nada, no se instaló nada, no se cambió ningún perfil.

---

## 1. Entorno medido

| Elemento | Valor | Cómo se midió |
|---|---|---|
| Host | DeepSeek Harness **0.2.2-rc.5** | `package.json` dentro de `resources/app.asar` (lectura) |
| Perfil activo | `desktop` (`C:\Users\<USER>\.dsh\profiles\desktop`) | manifiesto del perfil |
| Plugin registrado | sí: `"@local/lifecode-rag": "link:C:/xampp/htdocs/plugins-dhs/lifecode-rag"` y presente en `dsh.profile.bundles` | `profiles/desktop/package.json` líneas 5 y 24 |
| Enlace | `node_modules/@local/lifecode-rag → /c/xampp/htdocs/plugins-dhs/lifecode-rag` | `ls -la` |
| `cordis.patch.yml` del perfil | 2 344 B, sin entrada `lifecode-rag` | la activación va por `bundles`, no por el parche |
| Bundle del cliente | `client.js`, 100 966 B, `exports["./client"]` presente | `package.json` + gate `check.mjs` |

## 2. Los diez puntos de la fase A

| # | Comprobación | Estado | Evidencia / límite |
|---|---|---|---|
| 1 | Plugin registrado en el perfil | **VERIFIED HOST (manifiesto)** | dependencia `link:` + lista `bundles` |
| 2 | Bundle del cliente cargado | **VERIFIED HOST (captura)** | el panel se pinta en las 9 capturas del RAG; un bundle no cargado no pinta nada |
| 3 | Slot del cliente registrado | **VERIFIED HOST (captura)** | fila «LifeCode RAG» seleccionada en la barra y vista en `main` |
| 4 | Panel montado exactamente una vez | **PARTIAL** | una sola instancia visible en cada captura; el conteo `.lcr-root` no se pudo medir (sin acceso al DOM) |
| 5 | Disponible al navegar y volver | **VERIFIED HOST (captura)** | 9 capturas de 9 pestañas distintas, panel estable |
| 6 | Estable al cambiar de workspace/sesión | **NOT TESTED** | no se operó el host; no se intentó acceso entre sesiones |
| 7 | Consola sin errores durante la navegación | **NOT TESTED** | sin acceso a la consola del renderer |
| 8 | Errores de inicialización del cliente | **NOT TESTED** | sin acceso al estado del loader ni a los logs del host |
| 9 | Raíces duplicadas o listeners duplicados | **NOT TESTED** | requiere DOM (`document.querySelectorAll`) |
| 10 | Descarga/disposición del panel | **NOT TESTED** | exige desactivar el plugin en el host, no autorizado |

**Cómo se obtuvo la evidencia de host:** diez capturas aportadas por el propietario tras reiniciar
DeepSeek Harness (`screens/01…10`). Este acto **no** operó el host: las capturas son la evidencia, y por eso
los puntos 4, 7, 8, 9 y 10 quedan como `NOT TESTED` en lugar de deducirse de una imagen.

## 3. Lo que la captura sí y no prueba

| Afirmación | ¿La captura lo prueba? |
|---|---|
| El bundle se compone y se sirve | **sí** (hay UI) |
| El slot `sidebar.panellist` y `main` están ocupados | **sí** |
| El panel monta y renderiza las 9 pestañas | **sí** |
| El panel sobrevive al reinicio | **sí**, si el reinicio ocurrió como reporta el propietario |
| Hay una sola raíz `.lcr-root` | **no** |
| No hay listeners duplicados | **no** |
| La consola está limpia | **no** |
| El panel se dispone correctamente | **no** |
| La API Project-Aware está montada | **no**, y la propia vista «Conexión» dice que no |

## 4. Estado del cliente frente al de la API (no confundir)

| Capa | Estado | Evidencia |
|---|---|---|
| Cliente (mitad navegador) | **montado** | capturas |
| API Project-Aware `/lifecode-rag/ui/api` | **no existe / no montada** | vista «Conexión»: `no montada`; `index.js` no la registra |
| API heredada v0.2 `/lifecode-rag/api` | **no montada en este perfil** | vista «Conexión»: `no`; requiere `rag.sqlite3`, ausente |
| Modo de datos | `fixture` | vista «Conexión» + constante en el código |
| Conexión real con el RAG | **ninguna** | banner permanente en las 9 capturas |

La vista montada **no** implica API montada. Esa distinción es la misma que sostienen PA01 y G6.

## 5. Conclusión de la fase A

El montaje del cliente en el anfitrión queda **verificado por evidencia visual del propietario**: el panel
existe, ocupa su slot y renderiza sus nueve vistas tras el reinicio. Lo que no se verificó es todo lo que
exige instrumentación del DOM o de la consola, y así se declara.
