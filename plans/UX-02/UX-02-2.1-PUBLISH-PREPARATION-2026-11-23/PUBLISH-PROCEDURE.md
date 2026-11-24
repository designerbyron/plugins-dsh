# Procedimiento exacto de publicación (Fase D) — **NO EJECUTADO**

**Artefacto a publicar:** `designerbyron-lifecode-rag-1.3.0.tgz`
**SHA-256 que debe tener el fichero que se sube:** `f848b73ed2a85d6cecffab694710f062bade3d13f912a52a7ab94b927d724ec3`
**Estado de este documento:** procedimiento preparado y **no ejecutado**. Publicar requiere autorización humana explícita y posterior.

---

## 0. Puerta previa obligatoria (Checkpoint B, justo antes de publicar)

Todo lo siguiente se re-mide **en el momento** de publicar, no se reutiliza de este informe:

| # | Comprobación | Comando | Criterio de parada |
|---|---|---|---|
| G1 | Fichero presente y del tamaño aprobado | `stat -c '%s' designerbyron-lifecode-rag-1.3.0.tgz` | ≠ 310675 → **no publicar** |
| G2 | SHA-256 y SHA-512 exactos | `sha256sum` · `sha512sum` · `certutil -hashfile … SHA256` | ≠ `f848b73e…` / `43f12f0d…` → **no publicar** |
| G3 | Sesión npm | `npm whoami` | ≠ `designerbyron` → parar (no se toca la sesión) |
| G4 | La versión sigue libre | HTTP a `https://registry.npmjs.org/@designerbyron%2Flifecode-rag` → ¿`versions["1.3.0"]`? | si **ya existe** → parar y comparar integridad |
| G5 | Registro correcto | `npm config get registry` | ≠ `https://registry.npmjs.org/` → parar |
| G6 | `tfa.mode` conocido | `npm profile get --json` (sólo el campo `tfa`) | si cambia a `auth-only`/`none`, ajustar §3 |

Con **G1–G6 en verde** se pasa a §1.

## 1. Directorio y comando

```sh
cd C:/xampp/htdocs/plugins-dhs-release/plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/artifact
npm publish designerbyron-lifecode-rag-1.3.0.tgz --access public
```

Reglas que no se negocian:

- Se publica **el `.tgz` explícito**, nunca `npm publish` a secas: sin argumento, npm **reempaqueta** desde
  el árbol y podría subir algo aparecido después del `npm pack`.
- No se reconstruye ni se toca el artefacto: el que sube es el byte aprobado.
- `--access public` explícito, aunque `publishConfig.access = public` ya viaja en el manifiesto del tarball.
- El **respaldo** (`artifact-backup/`, solo lectura) es idéntico byte a byte y sirve para restaurar el
  original si éste se dañara; **no** es la fuente de publicación.

## 2. Qué se espera ver (sin 2FA) y dónde se detiene

Con `tfa.mode = auth-and-writes` (medido, `NPM-IDENTITY-AND-ACCESS.md` §4), la secuencia real es:

1. npm sube el tarball y el registro responde **`401`** con un `authUrl` de aprobación **de la operación**.
2. Con terminal interactiva (PTY) npm imprime `Authenticate your account at: …/auth/cli/<id>` y
   `Press ENTER to open in the browser...`. **Un `\n` suelto no llega a un PTY de Windows**: hay que enviar
   un retorno de carro (`submit`), no un salto de línea.
3. El **propietario** abre la URL y aprueba (Windows Hello/PIN). El enlace **caduca en ~7 minutos**.
4. npm reintenta y el registro responde **`202`** con `{"success":true}`.

> **Aviso medido en actos anteriores:** `npm publish` puede **redactar la URL de aprobación en su propio
> mensaje de error** (`https://www.npmjs.com/auth/cli/***`, también en el `-debug-0.log`). Si eso ocurre, no
> se reintenta a ciegas: se pasa a la vía B (§4) o la ejecuta el propietario (§3).

## 3. Vía del propietario (la más simple y siempre válida)

El propietario ejecuta en **su** terminal, en el directorio de §1:

```sh
npm publish designerbyron-lifecode-rag-1.3.0.tgz --access public
```

y teclea su OTP cuando npm lo pida (`--otp=<código>` también vale si prefiere pasarlo). **El agente no pide,
no lee, no copia y no teclea el OTP**, ni lo acepta por el chat, ni lo lee del portapapeles.

## 4. Vía B — `PUT` por API con aprobación web (si el CLI redacta la URL)

Sólo si la vía interactiva no permite entregar la URL. El flujo pide **aprobación sin código**:

1. Construir el documento de publicación (`versions["1.3.0"]` = manifiesto del tarball con `dist.shasum` y
   `dist.integrity`, y `_attachments["designerbyron-lifecode-rag-1.3.0.tgz"]` con el base64 del fichero).
2. `PUT https://registry.npmjs.org/@designerbyron%2Flifecode-rag` con cabeceras
   `npm-auth-type: web`, `npm-otp-mode: web`, `npm-command: publish`, `authorization: Bearer <token>`.
3. La respuesta `401` trae `authUrl` y **`doneUrl`**: se entrega `authUrl` al propietario (que sólo pulsa
   **Aprobar**) y se consulta `doneUrl` hasta que devuelva `{"token": … }`.
4. Repetir el `PUT` añadiendo `npm-otp: <token de un solo uso>`.

El token de sesión se lee de `C:\Users\BYRON\.npmrc` (`//registry.npmjs.org/:_authToken=`) y **no se imprime
nunca**: cualquier salida pasa por `replaceAll(token, '[REDACTED]')`. Respuesta buena: **`202`**.

## 5. Errores posibles y actuación segura

| Síntoma | Significado | Actuación |
|---|---|---|
| `E401` / `ENEEDAUTH` | sesión inválida o caducada | **parar**; no se tocan credenciales; se avisa al propietario |
| `EOTP` / `E403` con `authUrl` | 2FA de la operación pendiente | entregar la URL al propietario y esperar (§2/§4). **Nunca** reintentar en bucle |
| `E403` «you do not have permission» | cuenta sin escritura sobre el paquete | **parar**; revisar permisos **sin** modificarlos |
| `E404` al publicar | ámbito/paquete no accesible o error de nombre | **parar**; con sesión, leer literalmente el mensaje. Un `E404` sin sesión no distingue «no existe» de «sin permiso» |
| `E409` / `EPUBLISHCONFLICT` | la 1.3.0 ya existe | **parar**. La versión es **inmutable**: no se sobrescribe ni se republica; se compara integridad y se decide version nueva |
| `202` | **aceptado**, no disponible | no celebrar todavía: propagación asíncrona (minutos). Sondear metadata **y** tarball (§ verificación posterior) |
| Timeout de red durante el `PUT` | resultado incierto | **no republicar**: primero comprobar en el registro si la versión aparece (metadata y tarball) |

## 6. Después de publicar

Se ejecuta **tal cual** `POST-PUBLISH-VERIFICATION.md`. Resumen del criterio duro: la versión publicada debe
tener `dist.integrity = sha512-Q/EvDeGx…` **y** `dist.fileCount = 74`, y el `.tgz` descargado del registro
debe tener **sha256 `f848b73e…`**. Si el tarball responde `404` tras un `202`, se espera y se remide: **un
404 no autoriza a republicar**.

## 7. Lo que este procedimiento NO hace

- No publica (este acto no está autorizado para ello).
- No instala ni actualiza el plugin en DSH.
- No mueve dist-tags a mano ni toca versiones existentes.
- No modifica `.npmrc`, credenciales, permisos ni configuración global.
