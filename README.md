# LifeCode Plugins — plugins de DeepSeek Harness

![Póster de LifeCode Skill-Compiler: la letra L dibujada como una cinta blanca, azul y magenta dentro de un anillo neón, sobre fondo azul oscuro, con el nombre LifeCode y el subtítulo Skill-Compiler for DeepSeek Harness](assets/poster.png)

Colección de plugins propios para DeepSeek Harness, bajo la familia de producto **LifeCode**. Cada plugin
vive en su propia carpeta, con su código, sus pruebas y su documentación, y **se instala por ruta
absoluta** con el gestor de plugins del harness.

> **Marca y titularidad.** *LifeCode* es la familia de producto; el titular del copyright de este
> repositorio es `designerbyron` (ver [`LICENSE`](LICENSE)). Una marca no sustituye a un titular: si algún
> día la familia cambia de manos, la licencia sigue diciendo de quién es el código.

| Plugin | Qué hace | Estado |
|---|---|---|
| [`LifeCode Skill-Compiler`](skill-compiler/README.md) | Aprendizaje progresivo: convierte el conocimiento reutilizable de una tarea en una **skill propuesta**, con **ámbito** —de un proyecto o de todos, lo eliges tú al aprobar—; y vendoriza skills de repositorios ajenos como **nuestra versión**, con procedencia. Se decide **dentro** de la sesión: comandos, una fila por pendiente en el menú `/` y tarjetas de resultado que se pueden **cerrar**. Con feedback visual en la interfaz: engranaje mientras analiza, y aviso de skill **nueva** o **actualizada**. | Estable · v5.0.2 · suite en verde (902 pruebas en la última ejecución medida) |
| [`LifeCode Skill Center`](lifecode-skill-center/README.md) | El centro visual del conocimiento reutilizable: biblioteca persistente, compuerta de calidad, versiones inmutables con vuelta atrás, **interruptor por proyecto** y detección de lo que ya existe en disco. La IA crea y propone; la persona aprueba y enciende. Panel completo propio en la barra lateral y cuatro herramientas para el agente. | En curso · v1.0.0 · suite en verde (103 pruebas + puerta hermética) |

## Por qué está en `htdocs`

Decisión del operador: llevar estos plugins bajo control de versiones en un repositorio propio, junto al
resto de su trabajo. Como la carpeta puede acabar dentro de un docroot de Apache (por ejemplo si se clona
en el árbol de XAMPP), lleva un `.htaccess` que
**deniega todo**:

```apache
Require all denied
```

Ese fichero protege dos cosas que no deberían servirse nunca por HTTP: el código en sí y, sobre todo, el
directorio `.git/` (un `.git/config` accesible es una fuga clásica). `httpd.conf` tiene
`AllowOverride All` para `htdocs`, así que la regla se aplica de verdad; aun así, **la carpeta no debe
publicarse**: si algún día se quiere servir algo desde aquí, ese `.htaccess` es lo primero que hay que
revisar, y la decisión merece su propio acto.

## Instalar un plugin de este repositorio

El gestor de plugins de DSH no lee repositorios: instala un **bundle** por ruta o por dirección git.

### En este equipo (recomendado)

1. **Instala las dependencias del plugin**, que van declaradas en su manifiesto:

   ```sh
   cd <donde-clonaste-el-repo>/skill-compiler
   npm install
   node bin/skill-compiler.mjs doctor   # dice si algo falta, y con qué comando se arregla
   ```

   Este paso es obligatorio y no es un detalle: el plugin importa paquetes del harness, y al instalarse
   por ruta el perfil **enlaza** esta carpeta, así que el plugin carga sus dependencias **de aquí**. Sin
   `npm install`, el bundle se instala y después falla al activarse con `failed to import`. El porqué
   completo, en [`skill-compiler/docs/DEPENDENCIAS.md`](skill-compiler/docs/DEPENDENCIAS.md).

2. Abre la página **Plugins** de la barra lateral y pulsa **Add plugin**.
3. En el diálogo, pega la ruta absoluta de la carpeta del plugin:

   ```
   <donde-clonaste-el-repo>/skill-compiler
   ```

4. Cuando diga **Installed**, pulsa **Enable now**. Si el resultado pide reiniciar, reinicia el harness.
5. **Recarga la página** para que el navegador cargue la pieza de interfaz del plugin.

### En otra máquina

1. Clona el repositorio donde quieras, entra en la carpeta del plugin y ejecuta **`npm install`** —sin
   ese paso el bundle se instala y falla al activarse, porque sus dependencias del harness no están.
2. **Desde ese clon** instala por ruta absoluta (o por la dirección git del repositorio, si el gestor la
   acepta).
3. Si el plugin referencia rutas de este equipo (el caso de `skill-compiler` con su CLI), exporta la
   variable que corresponda: cada plugin la documenta en su README.

### Desinstalar

Desde la misma página **Plugins**: deselecciona el bundle. El plugin no escribe nada fuera de
`$DSH_HOME/<nombre-del-plugin>/` (sus datos), así que desinstalarlo no deja restos en el perfil más allá
de la dependencia, que el gestor retira.

## Trabajar en un plugin

```sh
cd skill-compiler
npm test              # las pruebas automáticas
npm run test:hermetic # las pruebas + huella del almacén real antes y después
```

Reglas de la casa, que valen para cualquier plugin de esta colección:

1. **Núcleo puro, adaptador fino.** Lo que decide algo vive en `lib/`, sin dependencias del harness, y
   se prueba con `node --test`. Lo que se registra en el harness (`index.js`) es lo más corto posible,
   porque es la única parte que no se puede probar antes de instalar.
2. **Las pruebas no tocan nada real.** Cada plugin con estado en disco debe redirigir su raíz a una caja
   de arena, y tener una puerta que **mida** que el almacén real no cambió.
3. **Nada se activa solo.** Si un plugin produce algo que el modelo va a leer, lo propone y espera
   aprobación humana.
4. **Un commit = una cosa**, y el push se decide y se declara. Nunca `git add -A`.

## Licencia

[MIT](LICENSE) — uso, modificación, redistribución y uso comercial libres, conservando el aviso de
copyright. Texto estándar, sin añadidos: una licencia con cláusulas propias deja de ser estándar, y
GitHub y las herramientas de cumplimiento dejan de reconocerla.

### Atribución: una petición, no una condición

Si este código te sirve, **te pedimos** que referencies el repositorio original:

```
https://github.com/designerbyron/plugins-dsh
```

Y decimos «petición» con precisión: MIT **no** obliga a ello, y por eso esta línea vive aquí y no en el
`LICENSE`. Lo que sí obliga MIT es a conservar el aviso de copyright al redistribuir. Si algún día
quieres que la referencia sea **exigible**, la vía estándar no es añadir una cláusula a MIT —eso la saca
del estándar— sino cambiar a Apache-2.0 con un fichero `NOTICE`, que sí obliga a conservarlo y a declarar
los cambios.

Es la misma regla que aplica el propio plugin con las skills que vendoriza: guarda de dónde vinieron, con
su hash y su fecha, para que nadie tenga que creerse nada de memoria.

## Estado: versión estable actual (**5.0.2**)

La estable hoy es la **5.0.2** (etiqueta `v5.0.2`, release publicada). «Estable» no es un adjetivo: son
criterios y un compromiso.

**Lo que lo sostiene**

- **902 pruebas en verde** en **224 suites**, con la suite **hermética** que mide la huella del almacén real
  antes y después, y con las puertas de **i18n** (938 claves por idioma, 16 operaciones × 2 nombres) y **ASCII**
  (8.289 caracteres medidos, tope igual al medido, 26/26 ficheros de primera parte) colgadas de `npm test`
  (`pretest`): la suite no corre una sola prueba con una puerta en rojo.
- Los contratos se comprueban contra los **paquetes reales** del harness (registro de skills, de comandos y de
  proyecciones), no contra dobles escritos a mano.
- `doctor` verde: cada comprobación **ejecuta** el camino que vigila, no lo reimplementa.
- `audit` mide el almacén sin tocarlo y `security` verifica ids, contenido, árboles y la cadena del diario
  (0 bloqueos, 0 avisos, cadena válida; estado del almacén de la máquina al cerrar la 5.0.0: **50 skills
  auditadas** —PASS 49 · WARN 1 · ERROR 0— con **32 archivadas** fuera del recuento y **45 revisadas**). En
  `WARN` puede quedar una propuesta esperando decisión humana —estado, no defecto— o una skill ya aprendida con
  un aviso de ámbito: hoy hay **una**, `absolute-path` sobre una skill del almacén, que se cierra localizándola o
  parametrizando la ruta; se declara y no se oculta.
- El flujo completo **probado en vivo**: proponer, aprobar, reparar, apagar, encender, publicar, localizar,
  retirar y recuperar.

**El compromiso**: no cambian de forma incompatible sin subir de versión *major*:

| Qué | Se mantiene |
|---|---|
| Comandos de la sesión | **Un nombre por operación en el idioma activo** (inglés o español ASCII; el nombre del otro idioma no se registra y no es invocable) y su forma (`input` opcional, resultado `{kind, text}`; `code`, `params` e `items` son aditivos y nunca obligatorios). El idioma se cambia con `/skill-compiler-language --es\|--en` (o `lang es` en el CLI) **sin reiniciar**; precedencia `DSH_LANG` → preferencia guardada → `en`. Guía completa, con la tabla de los 16 nombres: [`skill-compiler/README.md`](skill-compiler/README.md#idiomas-qué-hay-cómo-se-cambia-y-qué-no-cambia) |
| CLI | `where`, `list`, `show`, `check`, `approve`, `scope`, `disable`, `enable`, `delete`, `retired`, `restore`, `reject`, `active`, `vendor`, `upstream`, `provenance`, `ownership`, `systems`, `security`, `auto`, `doctor`, `audit`, `repair`, `promote`, `history`, `review` |
| Almacén | `projects/<clave>/{proposed,approved,published,disabled,rejected,superseded}`, `global/superseded` y el `SKILL.md` con su frontmatter |
| Ámbito | El proyecto sale del `cwd` de la sesión; nunca lo declara el modelo. Publicar o localizar es una decisión aparte, y deja asiento en el diario |

**Lo que «estable» no significa**: que no haya límites —los hay, y están declarados uno a uno— ni que la
versión pase a 1.0.0. La numeración es la que es; esto declara una garantía, no renombra nada.

**Los recuentos de pruebas son mediciones, no una cifra prometida.** La garantía es que la suite esté en
verde —con sus puertas colgadas— en la ejecución sobre la que se declara la versión; el total cambia cada vez
que se añade una prueba, y por eso cada número de este documento va pegado a la ejecución de la que sale en vez
de leerse como un estado permanente.

### Historia: la primera declaración (1.7.1)

La **1.7.1** fue la primera versión que este repositorio declaró estable, con 276 pruebas y el mismo
compromiso. Se conserva como historia de lo que se declaró entonces, no como estado de hoy; el registro de
versiones y sus motivos está en [`CHANGELOG.md`](CHANGELOG.md).

### Historia: la declaración anterior (3.9.3)

La **3.9.3** fue la estable inmediatamente anterior a esta entrega (etiqueta `v3.9.3`, release publicada), y se
declaró con **730 pruebas**. También se conserva como historia: la portada decía eso y era cierto entonces.

## Estado del repositorio

- Rama `main`. El remoto se configura con `git remote add origin <url>` (ver más abajo).
- Licencia **MIT** (ver arriba), con la referencia al repositorio como petición destacada.
- Identidad de autor configurada **solo en este repositorio** (`git config user.name/user.email`), no en
  el global de la máquina: así no condiciona otros proyectos.
- **Publicado** en `https://github.com/designerbyron/plugins-dsh` (rama `main`), con el remoto y el local
  sincronizados. El push sigue siendo un acto declarado: un commit se decide, y el envío se dice.

## Publicar en GitHub

El remoto ya está configurado en este clon. Para el primer envío:

```sh
cd <donde-clonaste-el-repo>
git remote -v                 # comprobar a dónde apunta
git push -u origin main       # el primer envío; después basta `git push`
```

Si el repositorio se llama distinto de `plugins-dsh`, corrige el remoto antes:

```sh
git remote set-url origin https://github.com/designerbyron/<nombre>.git
```

**El push no se ha ejecutado.** Es una decisión del operador, como manda la gobernanza de este puesto.
