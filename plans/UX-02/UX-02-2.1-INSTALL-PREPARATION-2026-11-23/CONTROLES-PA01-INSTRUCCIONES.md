# Controles autenticados (PA01) — instrucciones para el propietario

**Por qué este documento:** la API del plugin vive detrás de la compuerta de autenticación del host (PA01). El
agente no tiene —ni debe tener— la sesión del navegador. Estos seis controles los haces tú en el panel y me
pasas **sólo los valores**, nunca cookies, tokens ni capturas con credenciales.

**Cuándo:** después de que el agente confirme la instalación (§6 del procedimiento definitivo) y **antes** de
declarar la fase cerrada.

---

## Qué NO me envíes

- Cookies, `authId`, tokens, cabeceras `Authorization`, volcados de `localStorage`.
- Capturas que muestren credenciales o rutas personales que no quieras publicar.
- Nada del contenido de `~/.dsh/cordis.patch.yml` (contiene una credencial en claro).

Con los seis valores de abajo basta.

---

## Control 1 · El panel carga y reporta versión

1. Abre la app de DeepSeek Harness (el host ya reiniciado por ti).
2. En la barra lateral, abre el panel **LifeCode RAG**.
3. Ve a **Ajustes** (área de la izquierda) → tarjeta **Salud del servicio**.

| Qué mirar | Valor esperado | Qué me pasas |
|---|---|---|
| Fila **API** | **`pa/1.4.0`** | el texto exacto que muestre |
| Fila **Modo** | `API` (no «sintético») | cuál de los dos |
| Fila **Servicio** | `ok` | el valor |
| Píldora de estado de la cabecera | `API` en verde | sí/no |

**FAIL** si dice `pa/1.3.0`, `pa/1.x` o «sintético».

---

## Control 2 · La sección Workspaces es una tabla real

Abre **Workspaces** en el área de la izquierda.

| Qué mirar | Valor esperado | Qué me pasas |
|---|---|---|
| ¿Hay tabla con columnas Nombre · Ruta · Estado · Proyecto · Relación · Sesiones? | sí | sí/no |
| Chip **«Detectados por DSH: N»** | un número (el del registro del host) | **N** |
| Chip **«Con proyecto: M»** | un número ≤ N | **M** |
| Nº de filas visibles | igual a N (o el límite de 200) | **filas** |
| Texto al pie | «Sólo lectura: esta lista no autoriza, no indexa ni cambia nada del Host.» | sí/no |

**FAIL** si aparece «El Host no ofrece su registro de workspaces» (sería `source:"none"`), o si la sección
queda en «Leyendo los workspaces…» más de 15 s.
**No es FAIL** que alguna fila diga «Sin comprobar»: significa que ese `status()` no respondió a tiempo y es
el comportamiento declarado.

---

## Control 3 · Estados, rutas y relación (una fila de ejemplo)

Sin decirme rutas completas si no quieres, elige **una fila** y dime:

| Campo de la fila | Valores posibles | Qué me pasas |
|---|---|---|
| Estado | `Encontrado` · `No encontrado` · `Sin comprobar` | cuál |
| Relación | `Raíz del proyecto` · `Dentro del proyecto` · `—` | cuál |
| Proyecto | un nombre o `—` | cuál |
| Sesiones | `N vivas · M en total` · `Sin sesiones abiertas · M históricas` · `No se pudo mirar · M registradas` | el texto |
| Botones «Mostrar ruta» / «Copiar ruta» | presentes | sí/no |

**PASS** si los tres estados posibles, la relación y los conteos se muestran en lenguaje de usuario y el botón
**Actualizar** está presente.

---

## Control 4 · Datos intactos desde el panel

Área **Proyectos y contexto** → **Resumen**.

| Qué mirar | Esperado |
|---|---|
| Proyectos con contexto | **3** (los mismos de antes) |
| Documentos | **121** |
| Proyecto seleccionado | el mismo que antes (`LifeCode RAG`, rev. 5) |

Y en **Ajustes → Historial**: total de entradas y la píldora de cadena (debe decir que la cadena está OK).

**FAIL** si cambia el número de documentos, desaparece un proyecto o la cadena de auditoría aparece rota.

---

## Control 5 · Las siete herramientas siguen ahí

En una conversación nueva del host, escribe:

```
¿Qué herramientas de lifecode_rag tienes disponibles? Lista sólo los nombres.
```

Esperado: `lifecode_rag_context, forget, get, ingest, list, reindex, search` (7). **No** hace falta invocar
ninguna: sólo que aparezcan. **No** ejecutes `ingest`, `forget` ni `reindex` —escriben datos reales—.

---

## Control 6 · Nada se movió (opcional, si quieres el dato duro)

Si te apetece cerrar con número: en **Ajustes → Diagnóstico**, anota cualquier aviso que aparezca. Y si el panel
muestra el estado de los almacenes, que digan «presente» para los tres ámbitos.

---

## Ficha de captura (rellena y pégame esto)

```
C1  API: ______   Modo: ______   Servicio: ______
C2  Detectados por DSH: ____   Con proyecto: ____   Filas: ____
C3  Estado: ______  Relación: ______  Proyecto: ______  Sesiones: ______
C4  Proyectos: ____  Documentos: ____  Cadena de auditoría: ______
C5  Herramientas listadas: ____
C6  Avisos del diagnóstico: ______
```

Con eso cierro `MATRIZ-VALIDACION.md` §2, §3 y §5 y te doy el informe final de la instalación.

---

## Plan B si algo del panel no aparece

1. **Si el panel no abre o queda vacío:** dime qué ves exactamente (texto literal de la pantalla) y en qué área.
2. **Si la fila API dice `pa/1.3.0`:** el host sigue sirviendo el 1.2.0 —probablemente el proceso no se
   reinició por completo—. No toco nada: se cierra del todo y se vuelve a abrir.
3. **Si Workspaces dice «El Host no ofrece su registro de workspaces»:** el plugin está bien y el Host no
   expone el servicio en este perfil (perfil sin `dsh-workspace`). Se registra como `source:"none"` y el
   control W-3.1 queda FAIL **del entorno**, no del código; lo verificamos aparte sobre una copia del registro.
4. **Alternativa sin tu sesión:** montar una instancia aislada (`DSH_HOME` y `--user-data-dir` propios) donde
   tú inicias sesión una vez; ahí el agente puede medir la API sin tocar tu perfil real. Requiere su propia
   autorización.
