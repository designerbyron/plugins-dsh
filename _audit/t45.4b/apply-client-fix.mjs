// Aplica el arreglo T45.4-B sobre lifecode-skill-center/client.js con anclas exactas y
// comprobación de unicidad. Idempotente: si el ancla ya no existe, aborta sin escribir.
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'lifecode-skill-center/client.js';
let source = readFileSync(path, 'utf8');
const steps = [];
const original = source;

function replaceOnce(label, from, to) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`${label}: ancla no encontrada`);
  const second = source.indexOf(from, first + 1);
  if (second >= 0) throw new Error(`${label}: ancla duplicada`);
  source = source.slice(0, first) + to + source.slice(first + from.length);
  steps.push(label);
}

/* ------------------------------------------------------------------ 1. helpers */

const helpers = `    // Devuelve el primer nodo conectado y enfocable de la lista. Comprobar la conexión evita
    // enfocar nodos desmontados (el invocador puede desaparecer mientras el cajón está abierto)
    // y permite no depender de \`document.activeElement\` durante el montaje.
    function focusTargetOf(candidates) {
      for (const candidate of asArray(candidates)) {
        if (candidate === null || candidate === undefined) continue;
        if (candidate.isConnected !== true) continue;
        if (typeof candidate.focus !== 'function') continue;
        return candidate;
      }
      return null;
    }

    // Restaura el foco a un destino válido. Si no hay ninguno no se enfoca nada: nunca se roba
    // el foco a otro elemento de la página por un cierre (Escape, ×, acción del cajón).
    function restoreFocus(candidates) {
      const target = focusTargetOf(candidates);
      if (target === null) return false;
      try {
        target.focus();
        return true;
      } catch (failure) {
        return false;
      }
    }

    // Aviso persistente de una mutación fallida. Un único lugar produce título y detalle para que
    // la ruta genérica (\`act\`) y la creación directa muestren el mismo mensaje y conserven el
    // código real del Host (R17: el error no caduca; se cierra a mano).
    function activityFailureToast(failure, status, labels = {}) {
      const code = text(failure?.code);
      const message = text(failure?.message);
      const codeLabel = text(labels.code) || 'code';
      const failedLabel = text(labels.failed) || 'failed';
      const blockedLabel = text(labels.blocked) || 'blocked';
      const findingText = asArray(failure?.findings).slice(0, 3)
        .map((item) => (isPlainRecord(item) ? [text(item.code), text(item.message)].filter((part) => part !== '').join(': ') : text(item)))
        .filter((part) => part !== '').join(' · ');
      const reasonText = asArray(failure?.reasons).slice(0, 3).map((item) => text(item)).filter((part) => part !== '').join(' · ');
      const detail = [
        \`\${codeLabel}: \${code !== '' ? code : String(status)}\`,
        findingText,
        reasonText,
      ].filter((part) => part !== '').join(' · ');
      return {
        title: message !== '' ? message : failedLabel,
        detail: \`\${blockedLabel} · \${detail}\`,
      };
    }

    function ActivityGlyph({ name, size = 16, className = '' }) {`;

replaceOnce('helpers', '    function ActivityGlyph({ name, size = 16, className = \'\' }) {', helpers);

/* ---------------------------------------------------- 2. indicador: ref del botón */

replaceOnce(
  'indicator-signature',
  '    function ActivityIndicator({ t, lang, apiAvailable, busy, actionPending, pendingCount, lastActivity, unreadCount, hasUnread, onOpen }) {',
  '    function ActivityIndicator({ t, lang, apiAvailable, busy, actionPending, pendingCount, lastActivity, unreadCount, hasUnread, onOpen, triggerRef }) {',
);

replaceOnce(
  'indicator-button-ref',
  `        e('button', {
          type: 'button',
          className: 'lsc-btn ghost lsc-activity-button',`,
  `        e('button', {
          type: 'button',
          ref: triggerRef === undefined ? null : triggerRef,
          className: 'lsc-btn ghost lsc-activity-button',`,
);

/* ------------------------------------------------------ 3. cajón: firma y onCloseRef */

replaceOnce(
  'drawer-signature',
  `    function ActivityDrawer({ t, lang, apiAvailable, onClose, onAction }) {
      const drawerRef = useRef(null);
      const closeRef = useRef(null);`,
  `    function ActivityDrawer({ t, lang, apiAvailable, onClose, onAction, returnFocusRef, fallbackFocusRef }) {
      const drawerRef = useRef(null);
      const closeRef = useRef(null);
      // El cierre se lee por referencia: el efecto de foco no depende de la identidad de \`onClose\`
      // (el panel la recrea en cada render) y aun así Escape usa siempre la última versión.
      const onCloseRef = useRef(onClose);
      onCloseRef.current = onClose;`,
);

/* --------------------------------------------------------- 4. cajón: efecto de foco */

const oldEffect = `      useEffect(() => {
        const previous = typeof document !== 'undefined' ? document.activeElement : null;
        if (closeRef.current !== null && typeof closeRef.current.focus === 'function') closeRef.current.focus();
        const onKeyDown = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
          trapDialogFocus(event, drawerRef.current);
        };
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('keydown', onKeyDown);
        return () => {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('keydown', onKeyDown);
          if (previous !== null && previous !== undefined && typeof previous.focus === 'function') previous.focus();
        };
      }, [onClose]);`;

const newEffect = `      useEffect(() => {
        if (closeRef.current !== null && typeof closeRef.current.focus === 'function') closeRef.current.focus();
        const onKeyDown = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
          trapDialogFocus(event, drawerRef.current);
        };
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('keydown', onKeyDown);
        return () => {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('keydown', onKeyDown);
          // Destinos explícitos: el invocador y, si ya no existe, el contenedor del panel. Sin
          // destino válido no se toca el foco (nunca \`document.activeElement\`, que puede ser BODY
          // o un nodo interno del propio cajón).
          restoreFocus([
            returnFocusRef === undefined || returnFocusRef === null ? null : returnFocusRef.current,
            fallbackFocusRef === undefined || fallbackFocusRef === null ? null : fallbackFocusRef.current,
          ]);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);`;

replaceOnce('drawer-focus-effect', oldEffect, newEffect);

/* ------------------------------------------------------------ 5. panel: refs de foco */

replaceOnce(
  'panel-refs',
  `        const activityOpenRef = useRef(false);
        activityOpenRef.current = activityOpen;`,
  `        const activityOpenRef = useRef(false);
        activityOpenRef.current = activityOpen;
        // Destinos reales de foco al cerrar el cajón: el botón que lo abrió y la raíz del panel
        // (respaldo cuando ese botón ya no está montado). No se consulta \`document.activeElement\`.
        const activityTriggerRef = useRef(null);
        const activityRootRef = useRef(null);`,
);

/* ---------------------------------------------- 6. indicador: recibe el ref del botón */

replaceOnce(
  'indicator-usage',
  `              onOpen: openActivity,
            }),`,
  `              onOpen: openActivity,
              triggerRef: activityTriggerRef,
            }),`,
);

/* ---------------------------------------------------- 7. raíz del panel: foco de respaldo */

replaceOnce(
  'panel-root',
  `        return e('div', { className: 'lsc-root' },
          busy ? e('div', { className: 'lsc-busy' }) : null,

          e('header', { className: 'lsc-header' },`,
  `        return e('div', { className: 'lsc-root', ref: activityRootRef, tabIndex: -1 },
          busy ? e('div', { className: 'lsc-busy' }) : null,

          e('header', { className: 'lsc-header' },`,
);

/* --------------------------------------------------- 8. cajón: props de foco */

replaceOnce(
  'drawer-usage',
  `              apiAvailable: activityApiAvailable,
              onClose: () => setActivityOpen(false),
              onAction: onActivityAction,
            })`,
  `              apiAvailable: activityApiAvailable,
              onClose: () => setActivityOpen(false),
              onAction: onActivityAction,
              returnFocusRef: activityTriggerRef,
              fallbackFocusRef: activityRootRef,
            })`,
);

/* ------------------------------------------------ 9. act(): toast compartido */

const oldActError = `              const findingText = asArray(failure?.findings).slice(0, 3)
                .map((item) => (isPlainRecord(item) ? [text(item.code), text(item.message)].filter((part) => part !== '').join(': ') : text(item)))
                .filter((part) => part !== '').join(' · ');
              const reasonText = asArray(failure?.reasons).slice(0, 3).map((item) => text(item)).filter((part) => part !== '').join(' · ');
              const detail = [
                \`\${t('activity.row.code')}: \${code !== '' ? code : String(response.status)}\`,
                findingText,
                reasonText,
              ].filter((part) => part !== '').join(' · ');
              notify(t('activity.toast.failed'), 'bad', {
                kind: 'error',
                title: message !== '' ? message : t('activity.toast.failed'),
                detail: \`\${t('activity.toast.blocked')} · \${detail}\`,
              });`;

const newActError = `              const toast = activityFailureToast(failure, response.status, {
                failed: t('activity.toast.failed'),
                blocked: t('activity.toast.blocked'),
                code: t('activity.row.code'),
              });
              notify(toast.title, 'bad', { kind: 'error', title: toast.title, detail: toast.detail });`;

replaceOnce('act-toast', oldActError, newActError);

/* ------------------------------------------- 10. onCreate: mismo aviso persistente */

const oldCreateFailure = `            if (!parsed.ok || !result || result.ok === false) {
              const message = result?.message ?? parsed.message;
              if (typeof setError === 'function') setError(asArray(result?.findings).map((finding) => finding.message).join(' · ') || message);
              return;
            }`;

const newCreateFailure = `            if (!parsed.ok || !result || result.ok === false) {
              const failure = result !== null && typeof result === 'object' ? result : { message: parsed.message };
              const toast = activityFailureToast(failure, response.status, {
                failed: t('activity.toast.failed'),
                blocked: t('activity.toast.blocked'),
                code: t('activity.row.code'),
              });
              notify(toast.title, 'bad', { kind: 'error', title: toast.title, detail: toast.detail });
              if (typeof setError === 'function') setError(asArray(result?.findings).map((finding) => text(finding?.message)).join(' · ') || toast.title);
              return;
            }`;

replaceOnce('oncreate-toast', oldCreateFailure, newCreateFailure);

const oldCreateCatch = `          } catch (failure) {
            if (typeof setError === 'function') setError(String(failure?.message ?? failure));
          } finally {
            setBusy(false);
          }
        }, [load, notify, t]);`;

const newCreateCatch = `          } catch (failure) {
            const toast = activityFailureToast({ code: 'network', message: String(failure?.message ?? failure) }, 0, {
              failed: t('activity.toast.failed'),
              blocked: t('activity.toast.blocked'),
              code: t('activity.row.code'),
            });
            notify(toast.title, 'bad', { kind: 'error', title: toast.title, detail: toast.detail });
            if (typeof setError === 'function') setError(String(failure?.message ?? failure));
          } finally {
            setBusy(false);
          }
        }, [load, notify, t]);`;

replaceOnce('oncreate-catch', oldCreateCatch, newCreateCatch);

/* ---------------------------------------------------- 11. seam de pruebas */

replaceOnce(
  'probe',
  `            probe.notify = notify;
            probe.toastFromActivity = toastFromActivity;`,
  `            probe.notify = notify;
            probe.toastFromActivity = toastFromActivity;
            probe.focusTargetOf = focusTargetOf;
            probe.restoreFocus = restoreFocus;
            probe.activityFailureToast = activityFailureToast;`,
);

writeFileSync(path, source, 'utf8');
console.log(JSON.stringify({ steps, bytesBefore: original.length, bytesAfter: source.length }, null, 2));
