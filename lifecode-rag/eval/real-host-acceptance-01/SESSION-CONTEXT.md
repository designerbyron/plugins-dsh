# Contexto de sesión y ámbito (sólo lectura)

Fuente: copia de `registry.sqlite3`, consultada con `readOnly: true`.

## Proyecto

| Campo | Valor |
|---|---|
| id | `prj_01M7RBSRD33M26HGBEFW51WPP6` |
| nombre | `LifeCode RAG` |
| estado | `active` |
| creado | `1795040272803` |

## Raíz autorizada

| Campo | Valor |
|---|---|
| id | `rt_01M7RBSRD4G6977PYBNPM8WGW5` |
| ámbito | `prj` → `prj_01M7RBSRD33M26HGBEFW51WPP6` |
| ruta | `C:\xampp\htdocs\plugins-dhs\lifecode-rag` |
| `path_key` | `c:/xampp/htdocs/plugins-dhs/lifecode-rag` |
| estado | `authorized` |
| autorizó | `human` |

## Selección de sesión

| Campo | Valor |
|---|---|
| sesión | `session-c90d50d6-aa3d-4330-a9c8-76b21dc0f188` |
| proyecto | `prj_01M7RBSRD33M26HGBEFW51WPP6` |
| estado | `active` |
| origen | `explicit` |
| seleccionó | `human` |
| revisión | 1 |
| actualizada | `1795040714751` |

## Correspondencia proyecto ↔ almacén

El almacén del proyecto está en
`…/profiles/desktop/scopes/prj_01M7RBSRD33M26HGBEFW51WPP6/rag.sqlite3` (3 862 528 B), y contiene 121 fuentes.
El nombre del directorio coincide con el `project_id` de la selección y de la raíz: **una sola cadena**
raíz → proyecto → almacén. No hay ambigüedad de ámbito.

## Resolución en la práctica

La sesión tiene selección **explícita**, así que el proyecto no depende del `cwd`: cualquier llamada de esa
sesión se resuelve contra `prj_01M7RBSRD33M26HGBEFW51WPP6` mientras la selección esté `active`. Para las
lecturas de esta misión no se usó esa sesión (habría escrito métricas): se leyó la copia directamente.
