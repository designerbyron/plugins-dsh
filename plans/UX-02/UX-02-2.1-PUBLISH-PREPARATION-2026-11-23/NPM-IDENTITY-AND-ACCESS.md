# Identidad y acceso npm (Fase B)

**Acto:** preparación de la publicación de `@designerbyron/lifecode-rag@1.3.0`
**Medido:** 2026-11-23T02:56–02:57Z · **Registro:** `https://registry.npmjs.org/`

> Ningún token, contraseña, OTP ni secreto se ha leído, copiado, impreso ni registrado. No se ha
> modificado `.npmrc` ni la configuración global de npm. El contenido de `C:\Users\BYRON\.npmrc` **no se
> ha abierto**; sólo se comprobó su existencia (necesaria para que npm use la sesión).

---

## 1. Entorno

| Dato | Valor |
|---|---|
| `node --version` | `v24.21.0` |
| `npm --version` | `11.19.0` |
| Registro configurado | `https://registry.npmjs.org/` |
| Fichero de usuario npm | `C:\Users\BYRON\.npmrc` — **existe** (contenido no leído) |
| Conectividad con el registro | `npm ping` → `PONG 340ms` |

## 2. Identidad

| Control | Comando | Resultado | Estado |
|---|---|---|---|
| Sesión iniciada | `npm whoami` | **`designerbyron`** (exit 0) | PASS |
| Cuenta = mantenedor del paquete | comparación con los mantenedores del registro (§4) | `designerbyron` es el único mantenedor | PASS |

## 3. Permisos de publicación

| Control | Comando | Resultado | Estado |
|---|---|---|---|
| Acceso al paquete | `npm access list packages @designerbyron` | `lifecode-rag => read-write` · `dsh-lifecode-skill-center => read-write` | PASS |
| Visibilidad | `npm access get status @designerbyron/lifecode-rag` | **`public`** | PASS |
| Permiso sobre el ámbito `@designerbyron` | implícito en lo anterior (el paquete ya existe bajo el ámbito y la cuenta lo mantiene con escritura) | `read-write` | PASS |

`read-write` sobre un paquete **public** es lo que hace falta para publicar una versión nueva.

## 4. Segundo factor (2FA)

| Control | Comando | Resultado | Estado |
|---|---|---|---|
| Modo de 2FA de la cuenta | `npm profile get --json` → sólo `tfa.mode` | **`auth-and-writes`** | PASS (medido) |

**Consecuencia medida, no supuesta:** con `auth-and-writes`, cada operación de escritura —y `npm publish`
lo es— exige una **aprobación propia de la operación**, distinta del login. Por tanto:

- El token de la sesión web **no basta** para publicar.
- El `PUT` de publicación responderá `401`/`EOTP` y abrirá un flujo de aprobación.
- **El OTP lo teclea o lo aprueba el propietario.** Este acto no solicita, no lee y no consume ningún
  código, y la publicación no está autorizada.

## 5. Lo que este acto NO ha hecho

- No ha ejecutado `npm publish` ni ninguna escritura contra el registro.
- No ha pedido ni consumido un OTP.
- No ha leído ni impreso el token (ni su longitud ni su prefijo).
- No ha cambiado credenciales, permisos, dist-tags, `.npmrc` ni configuración global.

## 6. Corrección de una nota previa del entorno

Una nota anterior de operación decía que «npm en este equipo no tiene sesión y `~/.npmrc` no existe». La
medición de hoy lo contradice: **hay sesión activa** (`designerbyron`) y `~/.npmrc` existe. Se documenta la
discrepancia y se actúa según la medición: el procedimiento de publicación puede apoyarse en esa sesión,
con la aprobación 2FA por operación descrita en §4. La nota queda corregida en la memoria de operación.
