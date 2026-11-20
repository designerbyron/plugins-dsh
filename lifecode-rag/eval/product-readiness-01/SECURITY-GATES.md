# Gates de seguridad — estado y salida técnica

Ningún gate se ha movido. Para cada uno: qué bloquea, si existe solución técnica dentro de esta autorización y
qué haría falta.

| Gate | Estado | Qué bloquea | ¿Hay solución técnica? | Decisión necesaria |
|---|---|---|---|---|
| **PA01** | `BLOCKED` | Identidad de sesión en peticiones HTTP: el host autentica autoridad de GUI, no la conversación | **Parcial**: evitar el HTTP usando una proyección de sesión (sin canal que autenticar) | Sí: elegir vía (proyección vs capacidad de sesión) |
| **D-UI-03** | `PENDING HUMAN DECISION` | Aceptar o no el riesgo residual del transporte del panel | No es técnica: es de riesgo | **Sí, del propietario** |
| **Ruta A** | `BLOCKED` | Capacidad de sesión emitida por el host | No existe hoy en el host | Sí (host) |
| **Ruta B** | `NOT DEMONSTRATED` | Aislamiento topológico demostrado (instancia dedicada) | Sí, pero exige crear topología | Sí: designar responsable (Q-06 / TI-7) |
| **Ruta C** | `NOT ACCEPTED` | Aceptación explícita del riesgo residual | No aplica | Sí, del propietario |
| **G6** | `BLOCKED` | Auditoría de lecturas del panel (`ui.read`) | Depende de PA01 | Sí |
| **Q-06 / TI-7** | `PENDING DESIGNATION` | Revisor de seguridad de la Ruta B | No | Sí: nombrar persona |
| **GAP-20** | `OPEN / DOCUMENTED HOST LIMITATION` | El host no expone identidad de conversación al HTTP | Es limitación del anfitrión | Documentada; no se rodea |
| **GAP-05/06/07/10** | Abiertos | Paginación de fragmentos, diagnóstico multi-ámbito, auditoría de lecturas, detalle por embedding | Algunos sí (paginación en `get`) | No urgente |

## Lo que esta misión sí ha hecho por la seguridad

- Verificado que **cada herramienta** revalida la autorización en el backend: sesión invalidada →
  `scope-forbidden`; fuente de otro proyecto → `source-not-found` (humo, pasos 11-13).
- Verificado el fallo cerrado en aprobaciones: sin `allowed-once`, `forget`/`reindex` no se ejecutan.
- Documentado el diseño de concesión para subagentes y **por qué no se implementa todavía**: sin señal de
  linaje, el control no sería real.

## Lo que no se hará

- No se monta la API para «probar» con datos reales.
- No se acepta riesgo residual en nombre del propietario.
- No se habilita delegación en el perfil real.
