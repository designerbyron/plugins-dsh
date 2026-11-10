# E2E autónomo — LifeCode Skill Center (ronda 11)

Ejecutado: 26 pasos · **26 PASS · 0 FAIL**

| Paso | Resultado | Detalle |
| --- | --- | --- |
| 1 · dos proyectos temporales y política efectiva | PASS | A=proyecto-a-b6ca4e4f · B=proyecto-b-fe886900 · modo=guarded-autonomous |
| 2 · necesidad explícita registrada | PASS | requestId=req-1a37b1735a88 |
| 3 · consulta de biblioteca y elector | PASS | operación=create-skill · razones=1 |
| 4 · hallazgo de subagente con origen declarado | PASS | estado=received · verificado=false |
| 5 · validación del hallazgo por el principal | PASS | estado=validated |
| 6 · creación autónoma con petición y hallazgo | PASS | skill=autonomous-skill · 1.0.0 · hallazgo=decided |
| 7 · evaluación suficiente | PASS | score=100/100 |
| 8 · dos observaciones independientes verificadas | PASS | observaciones=2 |
| 9 · activación autónoma en A | PASS | A encendida · by=ai · versión=1.0.0 |
| 10 · aislamiento del proyecto B | PASS | B sin asignación · decisiones=2 |
| 11 · veto humano respetado | PASS | bloqueado con approval-required |
| 12 · evidencia insuficiente bloquea la activación | PASS | bloqueado: policy:true,evidence:false,project:true,skill:true,evaluation:true,human-veto:true |
| 13 · duplicado avisado | PASS | duplicados=2 · razón="etiquetas en común: dsh, skills" |
| 14 · mejora propuesta desde un segundo hallazgo | PASS | improvementId=imp-9489bd8e23fb |
| 15 · aprobación y publicación autónomas | PASS | vigente=1.1.0 · versiones=2 |
| 16 · publicar no mueve el pin | PASS | pin=1.0.0 · vigente=1.1.0 |
| 17 · avance de pin autorizado | PASS | A pin=1.1.0 · B sin asignación |
| 18 · rollback autónomo ante regresión | PASS | pin=1.0.0 · 1.1.0 conservada |
| 19 · acted-on exige una acción terminada | PASS | rechazado con insight-action-not-done |
| 20 · acted-on tras acción correcta | PASS | estado=acted-on · versión=1.0.0 · operación=create+publish |
| 21 · la IA no puede cambiar la política | PASS | rechazado con approval-required |
| 22 · acted-on no se cierra con una acción fallida | PASS | rechazado con insight-action-not-done · estado=decided |
| 23 · una persona fija la política del proyecto | PASS | proyecto-b=human-approved → restaurado |
| 24 · el paquete declara rutas no portables y la copia nace sin asignaciones | PASS | portable=true · avisos=0 · copia=autonomous-skill-copia-2 |
| 25 · contradicción preservada | PASS | contradicciones=2 · resultados=2 |
| 26 · almacén real intacto | PASS | center.json sha256=9704ee160de8466a · 52063 B |

## Cómo se ejecutó

- Almacén temporal propio (`LIFECODE_SKILL_CENTER_ROOT` redirigido por el arnés) y dos workspaces temporales.
- Todas las acciones por `runAction` (las mismas rutas y compuertas que usa el panel), no por funciones internas de operación.
- El agente principal actúa con `actor:"ai"`; las acciones humanas (registro de proyectos, petición y apagado) con `actor:"human"`.
- El origen del subagente entra **declarado**; la verificación contra `subagents.listChildren` es una ruta del Host y no se simula aquí.

## Lo que este arnés no demuestra

- Que el Host haya verificado la identidad del subagente (`origin.verified` sigue en `false` en este recorrido).
- Que la política real de un proyecto se haya cambiado: la autonomía se configura por una persona y aquí sólo se comprueba el rechazo de la IA.
- Que la skill se aplicara: `skill.applied` es una declaración, no una medición.
