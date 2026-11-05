/**
 * Definiciones del plugin, sin nada del harness.
 *
 * `index.js` no se puede importar fuera del harness (importa `@deepseek-ai/dsh-tools`), y era
 * precisamente la parte sin probar. Aquí quedan el protocolo, las definiciones de las herramientas y
 * el proveedor como objetos planos: se prueban con `node --test` y `index.js` solo los envuelve y los
 * registra.
 */

import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { autoApproveFor } from './auto-approve.mjs';
import { medirAutoActualizacion } from './auto-update.mjs';
import { mejorar, textoDelInforme } from './improve.mjs';
import { promover } from './promote.mjs';
import { checkProposal, defaultRoot, listForProject, overview, projectKey, propose, readSkill } from './compiler.mjs';
import { markerLine } from './presentation.mjs';
import { huellaDeContenido } from './security.mjs';
import { ejecutarAprobacion } from './approve-tx.mjs';
import { upstreamStatus, vendor } from './vendor.mjs';

/**
 * Rango del proveedor. Por encima de la biblioteca de usuario (400) y por debajo de las raíces de
 * proyecto (100/200): lo aprendido para un proyecto gana a lo global, pero no suplanta lo que el
 * propio repositorio declara.
 */
export const PROVIDER_RANK = 150;

/**
 * Protocolo estático. Entra en el prompt de todas las sesiones, así que se paga entero cada vez: corto a
 * propósito, y sin repetir nada de `AGENTS.md`, que ya se inyecta por su cuenta.
 *
 * Presupuesto, medido (2026-10-16, con la vara del propio harness: `CHARS_PER_TOKEN = 4` + `BLOCK_OVERHEAD
 * = 4`, las constantes de `@deepseek-ai/dsh-token-meter`): **1.006 caracteres · 252 tokens**, contra el tope
 * de 1.200 caracteres que exige `tests/definitions.test.mjs`. Antes de la propiedad del puesto: 941
 * caracteres · 240 tokens, y antes de aquella fase 1.175 · 298. Lo que se recortó entonces fue la
 * **redundancia** con la descripción de `skill_vendor` —que ya explica el proceso de vendorizado entero—,
 * nunca criterio de decisión: las tres vías siguen dichas. Lo que se añadió después es lo único que el
 * agente no puede deducir del resto: que existe una propiedad del puesto que hay que declarar.
 */
export const PROTOCOL = [
  '## Progressive learning (skill-compiler)',
  '',
  'Propose (`skill_propose`) with **evidence**: a contract, a trap already paid for, an order, an exact value',
  'you will reuse. "Could be reused" is not enough, nor a solved query, nor repeating `AGENTS.md`.',
  '',
  '- **New** -> a procedure, not a story: the detail that makes the difference (value, order, flag, path);',
  '  heavy material goes to `references/`.',
  '- **It exists and this beats it** -> `skill_propose` **with the same id**: an update, not a duplicate;',
  '  approving sets the previous aside, never deletes it. Check `skill_review` and say how you measured it.',
  '- **From a repository** -> `skill_vendor`: our version; a source with secrets or instructions to the agent',
  '  **is blocked**.',
  '',
  'If another skill covers the topic, it is rejected and says which it clashes with.',
  '**Nothing activates by itself**: it waits for human approval; say how. **Ownership** (DSH only or the whole',
  'PC): `/skill-ownership`.',
].join('\n');

/** El cwd de la sesión es el único origen válido del ámbito: el modelo no lo declara. */
export function scopeOf(exec) {
  return exec?.agent?.session?.header?.cwd;
}

/**
 * Ruta del CLI que se le indica al humano para aprobar.
 *
 * Se **deriva de la ruta de este propio fichero** —el plugin sabe dónde vive— en vez de escribirse: una
 * ruta absoluta en el código se queda obsoleta en cuanto el repositorio se mueve, y además publica la
 * ubicación local de quien la escribió. El CLI del paquete ya lo hace así para enseñarse a sí mismo.
 *
 * `SKILL_COMPILER_CLI` sigue existiendo como escape para un despliegue que mueva el CLI fuera del
 * paquete; no se usa `Config` del harness porque obligaría a importar otro paquete del que depende la
 * resolución de módulos del perfil.
 */
const CLI_PATH = process.env.SKILL_COMPILER_CLI
  ?? fileURLToPath(new URL('../bin/skill-compiler.mjs', import.meta.url));

const approveHint = (id) =>
  `\`/skill-approve ${id}\` en esta sesión (o su fila «skill-approve-${id}» en el menú «/»); alternativa desde el terminal: node "${CLI_PATH}" approve ${id}`;

/**
 * Si el modo «aprobar automáticamente en esta sesión» está activo, activa la propuesta que se acaba de
 * registrar. La puerta de validación se aplica igual: el modo delega la confirmación, nunca la puerta.
 *
 * Se exporta para poder probar el camino de fallo —una propuesta que no pasa la puerta con el modo
 * activo—, que la herramienta no puede provocar por sí sola: `propose` valida antes de escribir.
 *
 * @returns `{ asked, approved, reason?, superseded? }` — lo justo para que el resumen lo cuente tal cual.
 */
export function autoApproveIfAsked({ exec, root, catalog, id, key, curated, cwd = null, esCorreccion = false }) {
  if (!autoApproveFor(exec)) return { asked: false };
  // Una **corrección** de una skill viva no se delega, ni con el modo activo. El modo auto existe para
  // no repetir la confirmación de una skill nueva; una corrección cambia una herramienta que alguien ya
  // usa, y su promoción automática queda reservada a una fase posterior con su política de riesgo.
  // Es el mismo principio que ya rige el ámbito: se delega la confirmación, nunca la puerta ni el juicio.
  if (esCorreccion) {
    // La fase posterior llegó: una corrección de algo vivo se activa sola **sólo si el medidor lo dice**, y el
    // medidor no adivina — mide nivel, evidencia comprobable, disparador, seguridad y las nueve pruebas de la
    // promoción. Si algo falla, la propuesta espera y el motivo que se devuelve es lo que midió.
    const veredicto = medirAutoActualizacion(id, key, { root, ...(curated === undefined ? {} : { curated }), cwd });
    if (!veredicto.apto) {
      return {
        asked: true,
        approved: false,
        reason: `es una corrección de una skill viva, y el medidor dice que la decida una persona — ${veredicto.resumen}`,
        medidas: veredicto,
      };
    }
    const promocion = promover(id, key, {
      root, cwd, ...(curated === undefined ? {} : { curated }), niveles: [1, 2], veredicto, por: 'motor',
    });
    if (promocion.status !== 'promoted') {
      return {
        asked: true,
        approved: false,
        reason: `es una corrección de una skill viva: el medidor la aprobó, pero la promoción no la activó (${promocion.status}) — ${promocion.reason ?? ''}`.trim(),
        medidas: veredicto,
      };
    }
    catalog?.notify();
    return {
      asked: true,
      approved: true,
      superseded: promocion.superseded ?? null,
      reason: `corrección de una skill viva, medida y activada — ${veredicto.resumen}`,
      medidas: veredicto,
    };
  }
  const check = checkProposal(id, key, { root, ...(curated === undefined ? {} : { curated }) });
  if (!check.ok) return { asked: true, approved: false, reason: check.errors[0] };
  // La misma garantía que la aprobación humana: se aprueba el contenido que se validó, y queda anotado. Antes
  // este camino aprobaba sin huella y sin entrada del diario — el modo automático era el único que no dejaba
  // rastro, justo el que más lo necesita.
  const huella = huellaDeContenido(check.dir);
  // La transaccion, igual que la via humana: archiva la version viva con su manifiesto, instala, verifica
  // y deja el asiento (o deshace). El modo automatico no puede tener menos garantias que el humano.
  const moved = ejecutarAprobacion({
    root, key, id, esperada: huella, scope: 'project',
    nota: 'aprobacion automatica del modo auto',
    por: 'auto', canal: 'herramienta', avisos: check.warnings,
  });
  if (!moved.ok) return { asked: true, approved: false, reason: moved.error };
  // El catálogo acaba de cambiar: sin este aviso, la skill no llegaría al agente hasta reiniciar.
  catalog?.notify();
  return { asked: true, approved: true, superseded: moved.superseded, warnings: check.warnings };
}

/** Las líneas del resumen que cuentan qué pasó con la aprobación. La verdad, en los tres casos. */
function autoApprovalLines(auto, id) {
  if (!auto.asked) return ['NO está activa: espera aprobación humana. Para aprobarla:', `  ${approveHint(id)}`];
  if (auto.approved) {
    return [
      'APROBADA AUTOMÁTICAMENTE: el modo «aprobar en esta sesión» está activo, así que ya está activa.',
      'Se sirve al modelo solo en este proyecto. Desactívalo cuando quieras con `/skill-auto desactivar`.',
      ...(auto.superseded ? [`La versión anterior quedó apartada en ${auto.superseded}.`] : []),
    ];
  }
  return [
    `El modo de aprobación automática está activo, pero esta propuesta NO se ha aprobado: ${auto.reason}`,
    'Sigue pendiente de tu decisión:',
    `  ${approveHint(id)}`,
  ];
}

/**
 * El resultado, en una palabra, para el marcador y para la interfaz.
 *
 * `created` y `updated` son la distinción que el usuario quiere ver: su biblioteca creció, o se afinó
 * algo que ya estaba. `rejected` es un intento que se rechazó (solapamiento, validación); `blocked` es
 * una parada deliberada por contenido ajeno peligroso, y por eso se muestra en vez de esconderse;
 * `none` es que no pasó nada, y el motivo está en la transcripción.
 */
function outcomeOf(value) {
  if (value.status === 'proposed') return value.updatesProposal || value.updatesApproved || value.updatesPublished ? 'updated' : 'created';
  if (value.status === 'blocked') return 'blocked';
  if (value.status === 'conflict' || value.status === 'invalid' || value.status === 'no-project') return 'rejected';
  return 'none';
}

/** Todo resultado abre con el marcador: legible para el modelo y estable para el plegado. */
const renderWithMarker = (value) => [{
  type: 'text',
  text: `${markerLine(outcomeOf(value), value.id ?? '')}\n\n${value.summary}`,
}];

/** Definición de `skill_propose`. Objeto plano: `index.js` lo pasa por `defineTool`. */
export function skillPropose({ root = defaultRoot(), curated, catalog } = {}) {
  return {
    name: 'skill_propose',
    description: 'Propose a reusable skill only with evidence you can point at: a contract discovered the hard way, a trap already paid for, an operational order, or an exact value you will need again. "It could be reused" is not evidence - nor is a solved query, restating AGENTS.md/docs, or narrating the session. Pass the id of an existing skill of this project to UPDATE it instead of creating one: the same id means a patch, and approving it moves the previous version to superseded/ (never deleted). The proposal is NOT active: it waits for human approval in this project. If this session learned SEVERAL separate things, propose them one by one (one id each) - do not merge them into a single skill; and if two of them are alike because they come from the same incident while being genuinely different skills, declare `group` on both with a concrete `motivo` so the likeness is reported instead of rejected.',
    parameters: {
      id: { type: 'string', required: true, description: 'Unique kebab-case id of the skill, e.g. "measured-decision-check".' },
      description: { type: 'string', required: true, description: 'One line, 60-300 characters: what it automates and when it is triggered. This is what the model reads when choosing a skill, so it has to distinguish it from the others.' },
      whenToUse: { type: 'string', required: true, description: 'Required (at least 20 characters): the situation that should select this skill. It is the field the harness routes on.' },
      body: { type: 'string', required: true, description: 'The procedure in markdown, at least 200 characters, with at least two "## " sections (one is accepted only for a short body). Distilled knowledge, not a task narrative: steps, contracts and traps already paid for. Heavy reference material does not go here - see `references`.' },
      references: {
        type: 'array',
        description: 'Optional: the heavy material that stays beside the skill instead of inside the body - a full contract list, a long table, a transcript you will consult once. Each item needs a `path` under references/ and its `content`; the body then links it (e.g. "the full contract lives in references/contracts.md"). The link is verified in both directions: a path the body names must exist, and a path you add is checked for escaping the skill folder. The body stays short and is paid on every load; the material is paid only when it is read.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Relative path under references/, e.g. "references/contratos.md". Never absolute, never with "..".' },
            content: { type: 'string', required: true, description: 'The material itself, verbatim: it is written exactly as given and its hash is recorded.' },
          },
        },
      },
      evidence: { type: 'array', description: 'Optional: workspace-relative paths of the files that prove it (a doc, a test, a report).', items: { type: 'string' } },
      revision: {
        type: 'object',
        description: 'REQUIRED when the id already names a skill that is alive (approved, disabled or published): a patch changes a tool somebody uses, so it has to say why. A long text is not evidence - `measurement` needs a number or a command.',
        additionalProperties: false,
        properties: {
          claim: { type: 'string', required: true, description: 'What the current version asserts (at least 20 characters).' },
          evidence: { type: 'string', required: true, description: 'What contradicts it. A workspace-relative path that exists is OBSERVED evidence; anything else is an unverified claim and is reported as such.' },
          measurement: { type: 'string', required: true, description: 'How it was measured, with a number or a command in backticks (at least 20 characters). "I checked" is not a measurement.' },
          change: { type: 'string', required: true, description: 'What the skill says from now on (at least 20 characters).' },
          removed: { type: 'string', description: 'Required if this patch removes lines or reference material: why it is gone and what it is replaced by. Deleting approved knowledge cannot happen silently.' },
        },
      },
      tags: { type: 'array', description: 'Optional: a few words that help comparing it against existing skills. Identifiers, not prose: lowercase kebab-case ASCII (a tag with an accent is tolerated but reported).', items: { type: 'string' } },
      group: {
        type: 'object',
        description: 'Optional, and ONLY when this session learns several things that belong together: declare them as one batch so the overlap veto does not block them. Two skills that are siblings of a group are not rejected for being alike - the likeness is reported instead - because the group states that they go together and why. It is a declaration, not a shortcut: `motivo` is required and must be concrete. Without a group the same likeness is rejected.',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true, description: 'Short kebab-case id shared by every proposal of the batch, e.g. "respaldos-antes-de-migrar".' },
          motivo: { type: 'string', required: true, description: 'Why these proposals go together, in at least 20 characters, naming the incident or the decision they come from.' },
          esperadas: { type: 'number', description: 'Optional, and the only way the automatic path can know whether a sibling is missing: how many proposals this batch has. Without it the automatic promotion of a batch waits (the human path is not blocked either way). It has to be declared when the first proposal is made, because every one of them carries it.' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, description: 'proposed | conflict | invalid | no-project' },
          summary: { type: 'string', required: true },
          id: { type: 'string' },
          project: { type: 'string' },
          projectKey: { type: 'string' },
          path: { type: 'string' },
          // Los dos campos que distinguen PROPONER de ACTUALIZAR. Van declarados porque `execute` los
          // devuelve: el harness valida el valor contra este esquema con `additionalProperties: false`, y
          // un campo que se devuelve sin declarar no es un detalle — rechaza el resultado entero y la
          // propuesta (ya escrita en disco) llega al modelo como un error. Le pasó a `updatesProposal`.
          updatesProposal: { type: 'boolean', description: 'True when this proposal patches a version that already existed instead of creating a new one.' },
          updatesApproved: { type: 'boolean', description: 'True when approving this proposal would replace an already approved skill.' },
          updatesDisabled: { type: 'boolean', description: 'True when approving this proposal would replace a skill that the human had switched off.' },
          updatesPublished: { type: 'boolean', description: 'True when this proposal patches a skill this plugin published for all projects, instead of creating a new one.' },
          // El material pesado que se guarda junto a la skill, con su huella: es lo que permite comprobar
          // después que nadie lo editó, y lo que se verifica byte a byte antes de dar la propuesta por hecha.
          references: { type: 'array', description: 'Heavy material written beside the skill, each with its size and hash as recorded. Empty when the skill carries none.', items: { type: 'object', additionalProperties: true, properties: { path: { type: 'string' }, bytes: { type: 'number' }, sha256: { type: 'string' } } } },
          links: { type: 'array', description: 'The references/ paths the body declares, in the order they appear.', items: { type: 'string' } },
          files: { type: 'array', description: 'Every file written and verified inside the skill folder (SKILL.md, meta.json, references...).', items: { type: 'string' } },
          // Lo que sólo aparece cuando esto es un parche de algo vivo. Se declaran aquí por la misma razón
          // que los anteriores: con `additionalProperties: false`, devolver un campo sin declarar rechaza
          // el resultado entero y la propuesta —ya escrita— llega al modelo como un error.
          base: { type: 'object', additionalProperties: true, description: 'Only on a patch of a live skill: the state and content hash of the version it was built against. If that version moves, approving is refused.', properties: { state: { type: 'string' }, hash: { type: 'string' } } },
          corregida: { type: 'object', additionalProperties: true, description: 'Only on a patch: the accepted revision - what the old version claimed, what contradicted it, how it was measured, what changes.', properties: { claim: { type: 'string' }, evidence: { type: 'string' }, measurement: { type: 'string' }, change: { type: 'string' }, removed: { type: 'string' } } },
          evidenciaObservada: { type: 'boolean', description: 'True only when the revision evidence is a path that exists in the project. False means the evidence is a claim nobody has verified yet.' },
          diff: { type: 'object', additionalProperties: true, description: 'Only on a patch: what the proposal adds and removes, in the body and in the reference material - the exact difference against the base version.' },
          autoApproved: { type: 'boolean', description: 'True when the session\'s auto-approve mode activated this proposal immediately; only present when that mode is on.' },
          conflicts: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, score: { type: 'number' }, reason: { type: 'string' }, where: { type: 'string' } } } },
          relatedElsewhere: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, score: { type: 'number' }, where: { type: 'string' } } } },
          // El lote en el que va esta propuesta, y sus hermanas. Declarados por la misma razón que el resto:
          // con `additionalProperties: false`, devolver un campo sin declarar rechaza el resultado entero.
          group: { type: 'object', additionalProperties: true, description: 'The batch this proposal belongs to (only when one was declared), with its reason.', properties: { id: { type: 'string' }, motivo: { type: 'string' } } },
          siblings: { type: 'array', description: 'Other proposals of the same batch that this one resembles. Reported, not rejected: the batch says they go together.', items: { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, score: { type: 'number' }, where: { type: 'string' } } } },
          warnings: { type: 'array', items: { type: 'string' } },
          errors: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => renderWithMarker(value),
    },
    execute(args, exec) {
      const cwd = scopeOf(exec);
      const result = propose(
        { ...args, project: cwd ? basename(cwd) : undefined },
        {
          root,
          cwd,
          ...(curated === undefined ? {} : { curated }),
          ...(Array.isArray(args.references) ? { references: args.references } : {}),
          ...(args.revision === undefined ? {} : { revision: args.revision }),
          ...(args.group === undefined ? {} : { group: args.group }),
        },
      );
      const base = {
        status: result.status,
        summary: '',
        conflicts: result.conflicts ?? [],
        relatedElsewhere: result.relatedElsewhere ?? [],
        warnings: result.warnings ?? [],
        errors: result.errors ?? [],
        references: result.references ?? [],
        links: result.links ?? [],
        files: result.files ?? [],
        // `group` sólo cuando se declaró un lote: devolver `null` con un esquema `type: 'object'` haría que
        // el harness rechazara el resultado **entero** (con la propuesta ya escrita en disco). Es la misma
        // trampa que ya se pagó con `updatesProposal`, y por eso hay un test que valida el valor real.
        ...(result.group ? { group: result.group } : {}),
        siblings: result.siblings ?? [],
      };
      // Lo que sólo existe cuando esto es un parche de algo vivo: contra qué se hizo, qué cambia y si la
      // evidencia se pudo comprobar. Va declarado en el esquema: un campo devuelto sin declarar rechaza
      // el resultado entero (la lección ya pagada de `updatesProposal`).
      const comoParche = result.base === undefined ? {} : {
        base: result.base,
        corregida: result.revision ?? null,
        evidenciaObservada: result.evidenciaObservada === true,
        diff: result.diff,
      };

      switch (result.status) {
        case 'proposed': {
          const warnings = [
            ...base.warnings,
            ...(result.updatesApproved ? ['Si se aprueba, reemplazará una skill ya aprobada (la anterior queda apartada, no se borra).'] : []),
            ...(result.updatesProposal ? ['Afina una propuesta que ya estaba pendiente: no crea una skill nueva.'] : []),
            ...(result.updatesDisabled ? ['Si se aprueba, reemplazará una skill que está APAGADA (queda apartada en superseded/, no se borra): si querías recuperarla, usa `/skill-enable` en vez de aprobar esto.'] : []),
            ...(result.updatesPublished ? ['Afina una skill que YA está publicada para todos tus proyectos: al aprobarla, la versión anterior queda apartada en global/superseded/.'] : []),
            ...(base.relatedElsewhere.length ? [`El mismo tema ya vive en otro proyecto: ${base.relatedElsewhere.map((c) => c.id).join(', ')}.`] : []),
          ];
          const auto = autoApproveIfAsked({
            exec, root, catalog, id: result.id, key: result.projectKey,
            ...(curated === undefined ? {} : { curated }),
            cwd,
            esCorreccion: comoParche.base !== undefined,
          });
          return {
            ...base,
            ...comoParche,
            warnings,
            id: result.id,
            project: result.project,
            projectKey: result.projectKey,
            path: result.path,
            updatesApproved: result.updatesApproved,
            // Aviso también aquí: reemplazar algo apagado no puede pasar en silencio.
            ...(result.updatesDisabled ? ['Si se aprueba, reemplazará una skill que está APAGADA (queda apartada en superseded/, no se borra): si querías recuperarla, usa `/skill-enable` en vez de aprobar esto.'] : []),
            ...(result.updatesPublished ? ['Afina una skill que YA está publicada para todos tus proyectos: al aprobarla, la versión anterior queda apartada en global/superseded/.'] : []),
            updatesProposal: result.updatesProposal,
            updatesDisabled: result.updatesDisabled,
            updatesPublished: result.updatesPublished,
            ...(auto.asked ? { autoApproved: auto.approved } : {}),
            // Los avisos van TAMBIÉN en el resumen: un aviso que no se lee no es un aviso, y el resumen
            // es lo único que el modelo ve del resultado.
            summary: [
              `Propuesta registrada: ${result.id}`,
              `Ámbito: ${result.project} [${result.projectKey}]`,
              `Archivo: ${result.path}`,
              ...(base.references.length
                ? ['', `Material pesado guardado con la skill (${base.references.length} fichero(s), escritos y verificados byte a byte):`,
                  ...base.references.map((r) => `  · ${r.path} · ${r.bytes} B · ${r.sha256}`)]
                : []),
              ...(comoParche.base !== undefined
                ? ['',
                  `Corrige una skill viva: ${comoParche.base.state}, base ${comoParche.base.hash}.`,
                  `Cambios: +${comoParche.diff.lineas.anadidas.length} línea(s) · −${comoParche.diff.lineas.eliminadas.length} línea(s) · ` +
                  `material +${comoParche.diff.references.anadidas.length} / ~${comoParche.diff.references.modificadas.length} / −${comoParche.diff.references.eliminadas.length}`,
                  comoParche.evidenciaObservada
                    ? 'La evidencia de la corrección es una ruta que EXISTE en el proyecto: observada.'
                    : 'La evidencia de la corrección es una afirmación del modelo: NO verificada — nadie la ha comprobado todavía.']
                : []),
              ...(result.group
                ? ['', `Va en el lote «${result.group.id}»: ${result.group.motivo}`,
                  ...(base.siblings.length
                    ? [`Sus hermanas ya propuestas: ${base.siblings.map((h) => `${h.id} (${h.score})`).join(', ')} — se parecen y aun así se admiten: el lote dice que van juntas.`]
                    : [])]
                : []),
              ...autoApprovalLines(auto, result.id),
              ...(warnings.length ? ['', 'Avisos:', ...warnings.map((w) => `  · ${w}`)] : []),
            ].join('\n'),
          };
        }
        case 'conflict':
          return {
            ...base,
            // El id rechazado va en el TEXTO, no en un campo: un campo `id` en una respuesta que no creó
            // nada se leería como «esta propuesta existe», y no existe.
            summary: [
              `Propuesta RECHAZADA por solapamiento: ${args.id}`,
              'No se escribió nada.',
              ...result.conflicts.map((c) => `  · choca con ${c.id} (${c.reason}, parecido ${c.score}) — en ${c.where}`),
              // Ojo con la vía que se le ofrece al modelo: una skill de OTRA herramienta no se puede
              // «mejorar» —no es nuestra— así que ahí la salida es otro id, y decirlo.
              ...(result.conflicts.some((c) => c.ours === false)
                ? ['Ese id lo ocupa una skill que no es de skill-compiler: no se toca ni se suplanta. Propón el mismo tema con otro id, o pide al humano que la retire si ya no la usa.']
                : ['Mejora esa skill en vez de crear otra, o elige un tema que no exista todavía.',
                  'Si de verdad son DOS skills distintas que nacen del mismo asunto (no una mal partida en dos), vuelve a proponer la segunda declarando `group` con su `id` y un `motivo` concreto: dentro de un lote el parecido se avisa en vez de vetar.']),
            ].join('\n'),
          };
        case 'invalid':
          return {
            ...base,
            summary: [
              `Propuesta RECHAZADA por validación: ${args.id ?? '(sin id)'}`,
              'No se escribió nada.',
              ...base.errors.map((e) => `  · ${e}`),
            ].join('\n'),
          };
        case 'no-project':
          return { ...base, summary: [`Propuesta RECHAZADA: ${args.id ?? '(sin id)'}`, `  · ${base.errors.join(' ')}`].join('\n') };
        default:
          return { ...base, summary: `Estado inesperado: ${result.status}` };
      }
    },
  };
}

/** Definición de `skill_review`: solo lectura. No aprueba nada, y por eso puede ser una herramienta. */
export function skillReview({ root = defaultRoot() } = {}) {
  return {
    name: 'skill_review',
    description: 'List the pending and approved learned skills of the current project. Read-only: it never approves anything. Use it to tell the user what awaits their decision.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string' },
          projectKey: { type: 'string', required: true },
          pending: { type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, description: { type: 'string' } } } },
          approved: { type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, description: { type: 'string' } } } },
          summary: { type: 'string', required: true },
        },
      },
      // Sin marcador: esta herramienta solo lee, no aprende nada, y el marcador es el contrato de
      // «qué resultado tuvo el aprendizaje».
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    execute(_args, exec) {
      const cwd = scopeOf(exec);
      const key = projectKey(cwd);
      if (key === null) return { projectKey: '(sin proyecto)', pending: [], approved: [], summary: 'No hay ámbito: la sesión no tiene un cwd utilizable.' };
      const rows = overview({ root }).find((r) => r.projectKey === key) ?? { proposed: [], approved: [] };
      return {
        project: cwd,
        projectKey: key,
        pending: rows.proposed,
        approved: rows.approved,
        summary: [
          `Ámbito: ${cwd} [${key}]`,
          `Pendientes de aprobación: ${rows.proposed.length ? rows.proposed.map((p) => p.id).join(', ') : 'ninguna'}`,
          `Aprobadas y activas: ${rows.approved.length ? rows.approved.map((p) => p.id).join(', ') : 'ninguna'}`,
        ].join('\n'),
      };
    },
  };
}

/**
 * Fábrica del proveedor de skills. Filtra por el cwd de la consulta: es la pieza que impide que una
 * skill aprendida en un proyecto se cargue en otro.
 */export function skillProvider({ root = defaultRoot(), observe } = {}) {
  return {
    name: 'skill-compiler',
    async list({ cwd, agent }) {
      // El harness dice aquí en qué sesión está sirviendo, y no sólo el `cwd`: entrega el **agente**
      // (medido contra el registro real, que además cachea por `(cwd, agente, revisión)`). Es el único
      // sitio donde el plugin conoce la sesión sin que un humano lo declare, así que es aquí donde se
      // montan —bajo el contexto de ese agente— las filas que su menú puede ofrecer. Montarlas en el
      // global las ofrecía a todas las sesiones, y el humano acabó viendo, en el menú de un proyecto,
      // las pendientes de otro.
      observe?.({ cwd, agent });
      return listForProject(cwd, { root })
        .map((entry) => {
          const loaded = readSkill(entry.path);
          if (loaded === null) return null;
          const directory = entry.path.replace(/[\\/]SKILL\.md$/, '');
          return {
            name: loaded.name,
            description: loaded.description,
            ...(loaded.whenToUse !== undefined ? { whenToUse: loaded.whenToUse } : {}),
            invocation: { modelInvocable: true, userInvocable: true },
            provider: 'skill-compiler',
            source: 'aprendido',
            rank: PROVIDER_RANK,
            locator: { path: entry.path, directory },
            resourceBase: { kind: 'directory', path: directory },
            path: entry.path,
          };
        })
        .filter((candidate) => candidate !== null);
    },
    async get(candidate) {
      const loaded = readSkill(candidate?.locator?.path);
      if (loaded === null) return undefined;
      return {
        name: loaded.name,
        description: loaded.description,
        ...(loaded.whenToUse !== undefined ? { whenToUse: loaded.whenToUse } : {}),
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'skill-compiler',
        source: 'aprendido',
        resourceBase: candidate.resourceBase,
        path: loaded.path,
        content: loaded.content,
      };
    },
  };
}

/**
 * Definición de `skill_vendor`: nuestra versión de una skill externa.
 *
 * No hay parámetro para saltarse un bloqueo, y es la decisión de seguridad del diseño: el modelo no
 * debe poder desactivar la puerta que vigila contenido ajeno. Saltarla es un acto humano por CLI.
 */
export function skillVendor({ root = defaultRoot(), curated, fetchImpl, timeoutMs, catalog } = {}) {
  return {
    name: 'skill_vendor',
    description: 'Create this project\'s own version of a skill published in a repository the user linked. It downloads the upstream markdown, keeps the original verbatim as proof, records its provenance, and adapts it to this project. It installs nothing from the upstream and activates nothing: the result waits for human approval. Origin content containing secrets or instructions aimed at the agent is blocked by design.',
    parameters: {
      url: { type: 'string', required: true, description: 'https link to a .md file, a GitHub blob/tree, or the root of a repository.' },
      id: { type: 'string', description: 'Optional: local id to use, if the upstream name is unsuitable or already taken.' },
      description: { type: 'string', description: 'Optional: rewrite the description, which is what the model reads when choosing a skill.' },
      whenToUse: { type: 'string', description: 'Optional: rewrite the trigger situation.' },
      localNote: { type: 'string', description: 'What this project changed with respect to the original and why. It stays visible in the local version.' },
      tags: { type: 'array', description: 'Optional words that help compare it against existing skills.', items: { type: 'string' } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, description: 'proposed | blocked | conflict | invalid | no-project | bad-url | fetch-failed | needs-choice' },
          summary: { type: 'string', required: true },
          id: { type: 'string' },
          projectKey: { type: 'string' },
          path: { type: 'string' },
          upstreamUrl: { type: 'string' },
          upstreamSha256: { type: 'string' },
          updatesProposal: { type: 'boolean', description: 'True when this vendoring patched a version that already existed instead of creating a new one.' },
          updatesApproved: { type: 'boolean', description: 'True when approving it would replace an already approved skill.' },
          updatesDisabled: { type: 'boolean', description: 'True when approving it would replace a skill that the human had switched off.' },
          updatesPublished: { type: 'boolean', description: 'True when this vendoring patches a skill this plugin published for all projects, instead of creating a new one.' },
          autoApproved: { type: 'boolean', description: 'True when the session\'s auto-approve mode activated this result immediately; only present when that mode is on.' },
          findings: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { file: { type: 'string' }, line: { type: 'integer' }, label: { type: 'string' } } } },
          dirs: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          errors: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => renderWithMarker(value),
    },
    async execute(args, exec) {
      const cwd = scopeOf(exec);
      const result = await vendor(
        { ...args, project: cwd ? basename(cwd) : undefined },
        { root, cwd, ...(curated === undefined ? {} : { curated }), ...(fetchImpl === undefined ? {} : { fetchImpl }), ...(timeoutMs === undefined ? {} : { timeoutMs }) },
      );
      const base = {
        status: result.status,
        summary: '',
        warnings: result.warnings ?? [],
        errors: result.errors ?? [],
        dirs: result.dirs ?? [],
        findings: [],
      };

      switch (result.status) {
        case 'proposed': {
          const auto = autoApproveIfAsked({ exec, root, catalog, id: result.id, key: result.projectKey });
          return {
            ...base,
            id: result.id,
            projectKey: result.projectKey,
            path: result.path,
            upstreamUrl: result.provenance?.source?.url,
            upstreamSha256: result.upstream?.sha256,
            // Re-vendorizar el mismo id es un parche de lo que ya había, y el usuario quiere verlo así.
            updatesProposal: result.updatesProposal,
            updatesDisabled: result.updatesDisabled,
            updatesPublished: result.updatesPublished,
            updatesApproved: result.updatesApproved,
            // Aviso también aquí: reemplazar algo apagado no puede pasar en silencio.
            ...(result.updatesDisabled ? ['Si se aprueba, reemplazará una skill que está APAGADA (queda apartada en superseded/, no se borra): si querías recuperarla, usa `/skill-enable` en vez de aprobar esto.'] : []),
            ...(result.updatesPublished ? ['Afina una skill que YA está publicada para todos tus proyectos: al aprobarla, la versión anterior queda apartada en global/superseded/.'] : []),
            ...(auto.asked ? { autoApproved: auto.approved } : {}),
            summary: [
              `${result.updatesProposal || result.updatesApproved ? 'Nuestra versión ACTUALIZADA' : 'Nuestra versión creada'}: ${result.id}`,
              `Origen: ${result.provenance?.source?.url}${result.upstream?.ref ? ` (${result.upstream.ref})` : ''}`,
              `SHA-256 del original: ${result.upstream?.sha256} · guardado verbatim en upstream/`,
              `Ámbito: ${result.projectKey}`,
              ...autoApprovalLines(auto, result.id),
              ...(base.warnings.length ? ['', 'Avisos:', ...base.warnings.map((w) => `  · ${w}`)] : []),
              '',
              'Comprueba si el origen se movió más adelante con `skill_upstream_check`.',
            ].join('\n'),
          };
        }
        case 'blocked':
          return {
            ...base,
            findings: result.findings ?? [],
            upstreamUrl: result.upstream?.url,
            summary: [
              'VENDORIZADO BLOQUEADO: no se escribió nada.',
              `Motivo: ${base.errors[0]}`,
              ...(result.findings ?? []).map((f) => `  · ${f.file}:${f.line} — ${f.label}`),
              'Un origen así no se guarda ni se adapta. Díselo al usuario con estas líneas, sin reproducir el contenido,',
              'y no intentes rodear el bloqueo: es una decisión de diseño, no un fallo.',
            ].join('\n'),
          };
        case 'needs-choice':
          return {
            ...base,
            dirs: result.dirs ?? [],
            summary: [
              'Ese enlace apunta a una carpeta con varias skills, no a una.',
              ...(base.errors.map((e) => `  · ${e}`)),
              'Pide al usuario que elija una y vuelve a llamar con el enlace a esa subcarpeta.',
            ].join('\n'),
          };
        case 'conflict':
          return {
            ...base,
            findings: result.conflicts ?? [],
            summary: [
              `VENDORIZADO RECHAZADO por solapamiento: ${args.id ?? '(id del origen)'}`,
              'No se escribió nada.',
              ...(result.conflicts ?? []).map((c) => `  · choca con ${c.id} (${c.reason}, parecido ${c.score}) — en ${c.where}`),
              'Si es una versión mejorada de esa skill, dilo y se decide como actualización; si es otro tema, renómbralo.',
            ].join('\n'),
          };
        default:
          return { ...base, summary: [`VENDORIZADO NO REALIZADO (${result.status}): ${args.url}`, ...base.errors.map((e) => `  · ${e}`)].join('\n') };
      }
    },
  };
}

/** Definición de `skill_upstream_check`: ¿se movió el origen? Solo lectura, y no toca nuestra versión. */
export function skillUpstreamCheck({ root = defaultRoot(), fetchImpl, timeoutMs } = {}) {
  return {
    name: 'skill_upstream_check',
    description: 'Check whether the upstream of a vendored skill changed since it was taken, and report it. Read-only: it never overwrites the local version, which is adapted on purpose. Use it when the user asks whether a vendored skill is up to date.',
    parameters: {
      id: { type: 'string', required: true, description: 'Local id of the vendored skill.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          changed: { type: 'boolean' },
          storedSha256: { type: 'string' },
          upstreamSha256: { type: 'string' },
          url: { type: 'string' },
          ref: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute(args, exec) {
      const key = projectKey(scopeOf(exec));
      if (key === null) return { status: 'no-project', summary: 'No hay ámbito: la sesión no tiene un cwd utilizable.' };
      const status = await upstreamStatus(args.id, key, { root, ...(fetchImpl === undefined ? {} : { fetchImpl }), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      if (status.status !== 'checked') {
        return { status: status.status, summary: [`No se pudo comprobar ${args.id}: ${(status.errors ?? []).join(' ')}`].join('\n') };
      }
      return {
        status: 'checked',
        changed: status.changed,
        storedSha256: status.storedSha256,
        upstreamSha256: status.upstreamSha256,
        url: status.url,
        ref: status.ref,
        summary: [
          status.changed ? `El origen CAMBIÓ desde que se tomó (${status.fetchedAt?.slice(0, 10)}).` : 'El origen no ha cambiado.',
          `Origen: ${status.url}${status.ref ? ` (${status.ref})` : ''}`,
          `Guardado: ${status.storedSha256?.slice(0, 16)}… · Ahora: ${status.upstreamSha256?.slice(0, 16)}…`,
          status.changed
            ? 'Nuestra versión NO se ha tocado: está adaptada a propósito. Decide el humano si merece la pena re-vendorizar.'
            : 'Nada que hacer.',
        ].join('\n'),
      };
    },
  };
}

/**
 * Fabrica de la herramienta de auto-mejora.
 *
 * La diferencia con `skill_propose` no es de grado: aqui el trabajo se declara **por seccion y por
 * archivo**, no como un cuerpo entero reescrito. Quien mejora una skill viva dice que seccion cambia, que
 * pasa a una referencia y que se conserva; el motor compone el cuerpo, comprueba que no se pierde ninguna
 * regla del inventario y escribe la candidata con la misma puerta de siempre.
 *
 * No sustituye nada: la version activa sigue sirviendose hasta que un humano aprueba la revision.
 */
export function skillImprove({ root = defaultRoot(), curated } = {}) {
  return {
    name: 'skill_improve',
    description: 'Improve a skill that ALREADY EXISTS: correct it, extend it, move material into a reference, or reorganise it, without rewriting the whole body. Work by SECTION, not by file: each patch names the section it changes and gives its new content; anything you do not name stays byte for byte as it was. The engine reads the current version, applies the patches, creates or updates references, compares the inventory of knowledge (headings, steps, paths, numbers, backticked literals) and REFUSES to write if a rule of the live version would disappear without being declared in `perdidasJustificadas`. It never touches the active version: it prepares a candidate in proposed/ and waits for human approval. Use `operacion` to say what kind of change it is (patch, enhance, write, reorganize, or no_change when there is nothing worth writing). A change to a live skill REQUIRES `revision`: what the old version asserted, what contradicts it, how it was measured, and what it says now.',
    parameters: {
      id: { type: 'string', required: true, description: 'Id of the skill to improve. It has to name a live skill (approved, disabled or published) of this project.' },
      operacion: { type: 'string', required: true, description: 'patch (correct an existing section) | enhance (extend it with new knowledge) | write (add a reference) | reorganize (move material without losing it) | no_change (nothing worth writing).' },
      parches: {
        type: 'array',
        description: 'The sections to change. Each item names an existing section by its title (the `## ` line, number prefix optional) and gives its complete new content, without the heading. To add a section that does not exist, set `nuevaAqui: true` and give it a `titulo`; `despuesDe` places it after another section.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seccion: { type: 'string', required: true, description: 'Title of the existing section, e.g. "3. Comillas" or "Comillas".' },
            contenido: { type: 'string', required: true, description: 'The complete new content of that section, without the `## ` heading. Keep every rule you still need: what is not here disappears from that section.' },
            titulo: { type: 'string', description: 'Optional: new title for the section (for a new section it is required).' },
            nuevaAqui: { type: 'boolean', description: 'True to create a section that does not exist yet.' },
            despuesDe: { type: 'string', description: 'Optional: title of the section it goes after.' },
          },
        },
      },
      referencias: {
        type: 'array',
        description: 'References to write beside the skill: a path under references/ that does not exist yet is created (written), one that exists is updated (patched). The body has to link it, or the gate rejects the proposal.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Relative path under references/, e.g. "references/trampas.md".' },
            content: { type: 'string', required: true, description: 'The material itself, verbatim.' },
          },
        },
      },
      retirarSecciones: { type: 'array', description: 'Sections to remove. Their content must survive elsewhere (usually a reference) or the conservation check refuses the change.', items: { type: 'string' } },
      frontmatter: {
        type: 'object',
        description: 'Frontmatter fields to change. Only `description` and `whenToUse` are allowed: id, identity, provenance, scope and state are managed by the system and a content improvement cannot change them. Use it when the improvement changes WHEN the skill applies or how it presents itself; the body and the trigger have to agree.',
        additionalProperties: false,
        properties: {
          description: { type: 'string', description: 'The new description (one line, at least 60 characters).' },
          whenToUse: { type: 'string', description: 'The new trigger, in one line.' },
        },
      },
      perdidasJustificadas: { type: 'array', description: 'Inventory items (a literal, a path, a number, a step) that are allowed to disappear, each justified by its reason. Without this, any loss blocks the write.', items: { type: 'string' } },
      evidencia: { type: 'array', description: 'Workspace-relative paths that prove the improvement (a report, a test, a log).', items: { type: 'string' } },
      revision: {
        type: 'object',
        description: 'REQUIRED for any change to a live skill: the same four fields `skill_propose` demands. This is what separates a measured correction from an opinion.',
        additionalProperties: false,
        properties: {
          claim: { type: 'string', required: true, description: 'What the current version asserts (at least 20 characters).' },
          evidence: { type: 'string', required: true, description: 'What contradicts it. A workspace-relative path that exists is observed evidence; anything else is reported as an unverified claim.' },
          measurement: { type: 'string', required: true, description: 'How it was measured, with a number or a command in backticks.' },
          change: { type: 'string', required: true, description: 'What the skill says from now on.' },
          removed: { type: 'string', description: 'Required if the change removes lines or material: why, and what replaces it.' },
        },
      },
      description: { type: 'string', description: 'Optional: only if the improvement changes when the skill should be triggered.' },
      whenToUse: { type: 'string', description: 'Optional: only if the trigger changes. Otherwise the live one is kept.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, description: 'proposed | no_change | invalid | no-base' },
          summary: { type: 'string', required: true },
          review: { type: 'string', description: 'The Self-improvement review, one line per file, with what actually happened.' },
          id: { type: 'string' },
          projectKey: { type: 'string' },
          operacion: { type: 'string' },
          archivos: {
            type: 'array',
            description: 'One entry per file examined: patched, written or unchanged, with both hashes.',
            items: { type: 'object', additionalProperties: false, properties: { ruta: { type: 'string' }, accion: { type: 'string' }, shaAntes: { type: 'string' }, shaDespues: { type: 'string' } } },
          },
          resumen: {
            type: 'object',
            additionalProperties: false,
            properties: {
              revisadas: { type: 'number' }, mejoradas: { type: 'number' }, parcheados: { type: 'number' },
              escritos: { type: 'number' }, sinCambios: { type: 'number' },
              reglasAntes: { type: 'number' }, reglasDespues: { type: 'number' },
              perdidas: { type: 'number' }, perdidasJustificadas: { type: 'number' },
            },
          },
          hashAnterior: { type: 'string' },
          sha256: { type: 'string' },
          estadoAnterior: { type: 'string' },
          estadoPropuesto: { type: 'string' },
          base: { type: 'object', additionalProperties: true },
          diff: { type: 'object', additionalProperties: true },
          errors: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.review ?? value.summary }],
    },
    execute(args, exec) {
      const cwd = scopeOf(exec);
      const key = projectKey(cwd);
      if (key === null) return { status: 'no-project', summary: 'No hay ambito: la sesion no tiene un cwd utilizable.' };
      const r = mejorar(args ?? {}, { root, key, cwd, ...(curated ? { curated } : {}) });
      if (r.status !== 'proposed') {
        const errores = r.errors ?? r.errores ?? [];
        return {
          status: r.status,
          id: r.id,
          projectKey: key,
          operacion: r.operacion,
          errors: errores,
          summary: [
            r.status === 'no_change'
              ? `Sin cambios en "${r.id}": no hay ninguna mejora que justifique escribir.`
              : `No se escribio nada para "${r.id}" (${r.status}).`,
            ...errores.map((e) => `- ${e}`),
          ].join('\n'),
        };
      }
      const review = textoDelInforme(r);
      return {
        status: 'proposed',
        id: r.id,
        projectKey: r.projectKey,
        operacion: r.operacion,
        review,
        summary: review,
        archivos: r.informe.lineas.map((f) => ({ ruta: f.ruta, accion: f.accion, shaAntes: f.shaAntes ?? '', shaDespues: f.shaDespues ?? '' })),
        resumen: r.resumen,
        hashAnterior: r.hashAnterior,
        sha256: r.sha256,
        estadoAnterior: r.estadoAnterior,
        estadoPropuesto: r.estadoPropuesto,
        base: r.base,
        diff: r.diff,
      };
    },
  };
}
