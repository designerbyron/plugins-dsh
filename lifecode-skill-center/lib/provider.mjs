/**
 * El catálogo: lo que un proyecto **carga de verdad**.
 *
 * `list` contesta con lo encendido para la ruta que pregunta, y sólo con eso: una skill apagada no
 * aparece, y una asignada a otro proyecto tampoco. `get` devuelve el contenido ya materializado.
 *
 * El contenido se sirve desde la vista materializada porque un candidato de skill del harness tiene que
 * apuntar a un fichero real (`path`, `locator.directory`, `resourceBase`). Si la vista quedó atrás
 * —alguien aprobó una versión desde el panel y el provider aún no lo sabía— se rehace antes de leer, y
 * si aun así no se puede, se sirve el texto generado en memoria: quedarse sin la skill por un fallo de
 * disco sería peor que servirla sin sus referencias.
 *
 * Y una cosa que este módulo NO hace: contar una carga como un uso. `skill.loaded` se anota aquí
 * —telemetría de que el catálogo entregó la skill—, pero el plan es explícito en que eso no demuestra
 * que el modelo la aplicara.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureProjectView, centerRoot } from './api.mjs';
import { findProject, assignedSkills } from './operations.mjs';
import { renderSkillFile } from './skillfile.mjs';
import { canWrite, dailyEventExists, loadState, recordDailyEvent, withState } from './state.mjs';
import { projectDirectory } from './materialize.mjs';

export const PROVIDER_NAME = 'lifecode-skill-center';
/** Por debajo del compilador anterior (150): si los dos sirven el mismo nombre, gana el que ya estaba. */
export const PROVIDER_RANK = 160;

function readOr(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * La telemetría de carga es best-effort: nunca puede impedir que una skill llegue al agente.
 *
 * Se mira **antes** de pedir la escritura si falta algún evento del día. Entregar el catálogo es una
 * lectura de cada turno: si cada entrega abriera el candado y guardara, el documento se reescribiría
 * decenas de veces al día sin que nadie hubiera hecho nada (T13). Cuando no falta ninguno, no se abre
 * ni el candado. La deduplicación de dentro del candado sigue siendo la que manda si dos procesos
 * llegan a la vez: el segundo guarda sin cambios y `withState` devuelve `saved: false`.
 */
function noteLoads(root, project, assignments, day) {
  if (assignments.length === 0) return;
  try {
    const loaded = loadState(root);
    const missing = assignments.filter(({ skill }) => !dailyEventExists(loaded.state, { type: 'skill.loaded', skillId: skill.id, projectId: project.id, day }));
    if (missing.length === 0) return;
    withState(root, (state) => {
      for (const { skill, version } of missing) {
        recordDailyEvent(state, { type: 'skill.loaded', skillId: skill.id, projectId: project.id, version: version.version, actor: 'system', day });
      }
      return { ok: true };
    });
  } catch {
    // sin telemetría se pierde una gráfica, no el catálogo
  }
}

/**
 * El proveedor de skills del centro.
 *
 * `onDiagnostic` recibe el aviso cuando el almacén está dañado: la interfaz de un proveedor de skills sólo
 * devuelve una lista, así que un centro ilegible se entrega como lista vacía **sin** materializar, sin
 * escribir eventos y avisando por aquí. Fingir que la biblioteca está vacía sin decirlo sería mentirle al
 * catálogo; decirlo es lo único que el contrato permite.
 *
 * @param {{ root?: string, now?: () => string, onDiagnostic?: (diagnostic: object) => void }} [options]
 */
export function skillProviderFor({ root = centerRoot(), now = () => new Date().toISOString(), onDiagnostic } = {}) {
  // El reloj se acepta como función o como sello fijo: las pruebas pasan una cadena y el plugin pasa
  // una función. Llamar `now()` sin más reventaba con la cadena.
  const clock = () => (typeof now === 'function' ? now() : String(now ?? new Date().toISOString()));
  return {
    name: PROVIDER_NAME,
    async list({ cwd = '' } = {}) {
      const loaded = loadState(root);
      // Un almacén ilegible no se entrega como biblioteca vacía: no se materializa, no se registra carga y
      // se avisa. La lista vuelve vacía porque el contrato no tiene otra forma de decirlo.
      if (!canWrite(loaded.integrity)) {
        try {
          onDiagnostic?.({
            code: 'store-unreadable',
            integrity: loaded.integrity,
            path: loaded.path,
            sha256: loaded.sha256,
            size: loaded.size,
            error: loaded.error,
            message: 'el catálogo no se entrega: el centro no se puede leer y se conserva intacto',
          });
        } catch {
          // un aviso que falla no puede tumbar el catálogo
        }
        return [];
      }
      const project = findProject(loaded.state, cwd);
      if (project === null) return [];
      const assignments = assignedSkills(loaded.state, project.id);
      if (assignments.length === 0) return [];

      const view = ensureProjectView({ root, state: loaded.state, project });
      const directory = view.directory ?? projectDirectory(root, project.id);
      const out = [];
      for (const { skill, version } of assignments) {
        const skillDirectory = join(directory, skill.id);
        const path = join(skillDirectory, 'SKILL.md');
        if (!existsSync(path)) continue;
        out.push({
          name: skill.id,
          description: version.description !== '' ? version.description : skill.description,
          whenToUse: version.whenToUse,
          invocation: { modelInvocable: true, userInvocable: true },
          provider: PROVIDER_NAME,
          source: 'lifecode-skill-center',
          rank: PROVIDER_RANK,
          locator: { path, directory: skillDirectory },
          resourceBase: { kind: 'directory', path: skillDirectory },
          path,
        });
      }
      noteLoads(root, project, assignments, clock().slice(0, 10));
      return out;
    },
    async get(candidate) {
      const path = candidate?.path ?? candidate?.locator?.path ?? '';
      const content = readOr(path);
      if (content !== null) return { ...candidate, content };
      // La ruta pudo quedarse atrás: se rehace la vista y se vuelve a intentar una vez.
      const loaded = loadState(root);
      if (!canWrite(loaded.integrity)) return { ...candidate, content: '' };
      const project = findProject(loaded.state, candidate?.cwd ?? '');
      if (project !== null) {
        ensureProjectView({ root, state: loaded.state, project, now: clock() });
        const retried = readOr(path);
        if (retried !== null) return { ...candidate, content: retried };
      }
      // Última vía: componer el texto en memoria a partir del documento, que es la fuente de la verdad.
      const id = String(candidate?.name ?? '');
      for (const skill of Object.values(loaded.state.skills ?? {})) {
        if (skill.id !== id) continue;
        const version = (skill.versions ?? []).find((entry) => entry.version === skill.currentVersion) ?? (skill.versions ?? []).at(-1);
        if (version !== undefined) return { ...candidate, content: renderSkillFile({ skill, version }) };
      }
      return { ...candidate, content: '' };
    },
  };
}
