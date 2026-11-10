// T51 - capturas PUBLICAS neutrales para lifecode-skill-center/docs/images/.
// Monta el cliente real con un Host falso y fixtures genéricas (fixtures-public.mjs),
// serializa el árbol renderizado y captura con Edge headless. No es la GUI viva.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  clientSource,
  createPanelHarness,
  textOf,
} from '../../lifecode-skill-center/tests/r17-ui-runtime.mjs';
import { createHostHarness, toolCall, toolResult } from '../../lifecode-skill-center/tests/t42-ui-runtime.mjs';
import {
  neutralActivityPayload,
  neutralActivities,
  neutralBundlePreview,
  neutralBundleText,
  neutralCapabilities,
  neutralInventory,
  neutralProjectDetail,
  neutralProjects,
  neutralSnapshot,
} from './fixtures-public.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'generated');
const DOCS = path.join(here, '..', '..', 'lifecode-skill-center', 'docs', 'images');
const EDGE = process.env.LSC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const CSS = (() => {
  const match = clientSource.match(/const CSS = `([\s\S]*?)`;\n/);
  if (match === null) throw new Error('no se encontró la CSS del cliente');
  return match[1];
})();

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

function attrsOf(props = {}) {
  const className = props.className;
  const classes = typeof className === 'string'
    ? className
    : Array.isArray(className) ? className.filter(Boolean).join(' ') : '';
  const parts = [classes === '' ? '' : ` class="${esc(classes)}"`];
  const style = props.style;
  if (style !== null && typeof style === 'object') {
    const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink', 'order']);
    const declarations = [];
    for (const [key, value] of Object.entries(style)) {
      if (value === undefined || value === null || value === '') continue;
      const property = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
      const rendered = typeof value === 'number' && !unitless.has(key) ? `${value}px` : String(value);
      declarations.push(`${property}:${rendered}`);
    }
    if (declarations.length > 0) parts.push(` style="${esc(declarations.join(';'))}"`);
  }
  const skip = new Set(['className', 'children', 'key', 'style', 'onClick', 'onChange', 'onKeyDown', 'onInput', 'onSubmit', 'dangerouslySetInnerHTML']);
  for (const [rawKey, value] of Object.entries(props)) {
    if (skip.has(rawKey) || rawKey.startsWith('on')) continue;
    if (value === undefined || value === null || typeof value === 'object' || typeof value === 'function') continue;
    if (value === false) continue;
    const key = rawKey === 'aria-pressed' || rawKey.startsWith('aria-') || rawKey.startsWith('data-') || rawKey === 'role'
      ? rawKey
      : rawKey.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
    if (value === true) { parts.push(` ${key}`); continue; }
    const rendered = typeof value === 'number' ? String(value) : esc(value);
    parts.push(` ${key}="${rendered}"`);
  }
  return parts.join('');
}

function serialize(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  if (Array.isArray(node)) return node.map(serialize).join('');
  if (typeof node !== 'object') return '';
  if (node.type === 'text') return esc(node.text);
  const props = node.props ?? {};
  const tag = String(node.type);
  const inner = tag === 'textarea'
    ? esc(typeof props.value === 'string' ? props.value : '')
    : serialize(node.children ?? props.children);
  const open = `<${tag}${attrsOf(props)}>`;
  if (VOID.has(tag)) return open;
  return `${open}${inner}</${tag}>`;
}

function page(inner) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>
html, body { margin:0; min-height:100%; background:#0b1020; color:#e8ecf5; font:13px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; }
body > .lsc-root { min-height:100vh; height:auto; }
:root { --dsh-frame-overlay-top: 72px; }
/* Captura estática: el mockup no tiene el frame real del Host, así que la pila arranca
   por debajo de la cabecera y las tarjetas se pintan opacas (en producto son 97 % opacas)
   para que el texto de la conversación no se transparente en la imagen pública. */
.lsc-toast-card { animation: none !important; background:#0d1221 !important; }
.lsc-modal-wrap { position:absolute !important; }
${CSS}
</style></head>
<body>${inner}</body></html>`;
}

function capture(name, html, size, target = OUT) {
  fs.mkdirSync(target, { recursive: true });
  const htmlPath = path.join(OUT, `${name}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  const pngPath = path.join(target, `${name}.png`);
  const profile = path.join(process.env.TEMP ?? '/tmp', `lsc-t51-edge-${name}`);
  const result = spawnSync(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--default-background-color=0b1020',
    `--window-size=${size}`,
    `--user-data-dir=${profile}`,
    `--screenshot=${pngPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Edge falló para ${name}: ${result.stderr ?? ''}`);
  const bytes = fs.statSync(pngPath).size;
  console.log(`PNG  ${name}.png · ${bytes} B · ${size}`);
  return pngPath;
}

function responder(call) {
  const url = call.url;
  if (url.includes('/api/capabilities')) return json(200, neutralCapabilities());
  if (url.includes('/api/projects')) return json(200, neutralProjects());
  if (url.includes('/api/inventory')) return json(200, neutralInventory());
  if (url.includes('/api/activity')) return json(200, neutralActivityPayload());
  if (url.includes('/api/state')) {
    if (call.method === 'POST') {
      let body = {};
      try { body = JSON.parse(call.body ?? '{}'); } catch { body = {}; }
      if (body.action === 'open') return json(200, neutralSnapshot());
      if (body.action === 'inspect-project') return json(200, neutralProjectDetail(body.payload?.projectId));
      if (body.action === 'inspect-bundle') return json(200, { ok: true, apiVersion: 1, contractVersion: 2, inspected: true, preview: neutralBundlePreview() });
      return json(200, { ok: true, result: {} });
    }
    return json(200, neutralSnapshot());
  }
  return json(404, { ok: false, code: 'not-found', message: 'fixture pública' });
}

function json(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

function treeHtml(harness) {
  return serialize(harness.tree());
}

function buttonBy(harness, predicate) {
  return harness.nodes((node) => node.type === 'button' && predicate(node))[0];
}

async function newHarness() {
  const harness = createPanelHarness({ snapshot: neutralSnapshot(), responder });
  await harness.mount();
  return harness;
}

async function clickNav(harness, label) {
  const node = buttonBy(harness, (candidate) => textOf(candidate).startsWith(label));
  if (!node) throw new Error(`no se encontró la navegación «${label}»`);
  await harness.click(node);
  await harness.settle();
}

function setTextarea(harness, value) {
  const node = harness.nodes((candidate) => candidate.type === 'textarea')[0];
  if (!node) throw new Error('no se encontró el textarea de importación');
  node.props.onChange?.({ target: { value } });
}

async function projectsFlow() {
  const harness = await newHarness();
  await clickNav(harness, 'Proyectos');
  const discovered = await capture('projects-discovered', page(treeHtml(harness)), '1440,1120');

  const managedTab = buttonBy(harness, (node) => textOf(node).includes('Gestionados'));
  await harness.click(managedTab);
  await harness.settle();
  const detailButton = buttonBy(harness, (node) => textOf(node).includes('Abrir ficha'));
  if (!detailButton) throw new Error('no se encontró «Abrir ficha»');
  await harness.click(detailButton);
  await harness.settle();
  const detail = await capture('project-detail', page(treeHtml(harness)), '1440,1260');

  const close = buttonBy(harness, (node) => textOf(node) === 'Cerrar');
  if (close) await harness.click(close);
  await harness.settle();

  const collisionsTab = buttonBy(harness, (node) => textOf(node).includes('Colisiones'));
  if (!collisionsTab) throw new Error('no se encontró la pestaña Colisiones');
  await harness.click(collisionsTab);
  await harness.settle();
  const collisions = await capture('collisions', page(treeHtml(harness)), '1440,1080');

  const skillButton = buttonBy(harness, (node) => node.props?.title === 'Abrir la ficha de esta skill');
  if (!skillButton) throw new Error('no se encontró el botón de ficha de skill');
  await harness.click(skillButton);
  await harness.settle();
  const skill = await capture('skill-detail', page(treeHtml(harness)), '1440,1260');
  return { discovered, detail, collisions, skill };
}

async function activityFlow() {
  const harness = await newHarness();
  const activityButton = buttonBy(harness, (node) => String(node.props?.['aria-label'] ?? '').includes('Actividad') || String(node.props?.title ?? '').includes('actividad'));
  if (!activityButton) throw new Error('no se encontró el botón de Actividad');
  await harness.click(activityButton);
  await harness.settle();
  const png = await capture('activity-center', page(treeHtml(harness)), '1440,960');
  return png;
}

async function portabilityFlow() {
  const harness = await newHarness();
  await clickNav(harness, 'Biblioteca');
  const toggle = buttonBy(harness, (node) => textOf(node).includes('Portabilidad de Skills'));
  if (!toggle) throw new Error('no se encontró el bloque de Portabilidad');
  await harness.click(toggle);
  await harness.settle();
  setTextarea(harness, neutralBundleText());
  await harness.settle();
  const validate = buttonBy(harness, (node) => textOf(node).includes('Validar paquete'));
  if (!validate) throw new Error('no se encontró «Validar paquete»');
  await harness.click(validate);
  await harness.settle(20);
  const png = await capture('portability', page(treeHtml(harness)), '1440,1120');
  return png;
}

async function chatFlow() {
  const harness = createHostHarness();
  harness.mountProbe('public-session');
  await harness.settle();
  harness.mountOverlay();
  await harness.settle();
  harness.emit('public-session', [
    toolCall('call-public-1', 'lifecode_skill_create'),
    toolResult('call-public-1', {
      ...activityEventForChat('release-checklist'),
    }),
  ]);
  await harness.settle();
  const overlay = serialize(harness.runtime.state.trees.get('overlay') ?? null);
  const html = page(chatBody(overlay));
  const chat = await capture('activity-chat', html, '1280,800');

  const stackHarness = createHostHarness();
  stackHarness.mountProbe('public-stack');
  await stackHarness.settle();
  stackHarness.mountOverlay();
  await stackHarness.settle();
  stackHarness.emit('public-stack', stackEvents());
  await stackHarness.settle();
  const stackHtml = page(chatBody(serialize(stackHarness.runtime.state.trees.get('overlay') ?? null)));
  const toast = await capture('activity-toast', stackHtml, '1440,900');
  harness.dispose();
  stackHarness.dispose();
  return { chat, toast };
}

function activityEventForChat(skill) {
  const event = neutralActivities()[0];
  return {
    ...event,
    skillId: skill,
    skillTitle: 'release-checklist',
    titleVars: { skill },
    referencesAdded: null,
    referencesUpdated: null,
    referencesRemoved: null,
  };
}

function stackEvents() {
  const base = neutralActivities();
  const withSkill = (index, skill, titleKey, titleVars, extra = {}) => {
    const event = base[index];
    return {
      ...event,
      skillId: skill,
      skillTitle: skill,
      titleKey,
      titleVars,
      referencesAdded: null,
      referencesUpdated: null,
      referencesRemoved: null,
      ...extra,
    };
  };
  return [
    toolCall('call-p1', 'lifecode_skill_create'),
    toolResult('call-p1', withSkill(0, 'release-checklist', 'activity.title.skill-created', { skill: 'release-checklist' }, { correlationId: 'corr-public' })),
    toolCall('call-p2', 'lifecode_skill_improve'),
    toolResult('call-p2', withSkill(1, 'release-checklist', 'activity.title.skill-version-saved', { skill: 'release-checklist', version: '1.2.0' }, { eventId: 'evt-public-2b', correlationId: 'corr-public', category: 'update', severity: 'info' })),
    toolCall('call-p3', 'lifecode_skill_improve'),
    toolResult('call-p3', withSkill(2, 'api-contract-review', 'activity.title.improvement-prepared', { skill: 'api-contract-review' }, { eventId: 'evt-public-3b' })),
    toolCall('call-p4', 'lifecode_skill_insight'),
    toolResult('call-p4', withSkill(4, 'css-token-audit', 'activity.title.skill-created', { skill: 'css-token-audit' }, { eventId: 'evt-public-4b' })),
  ];
}

function chatBody(overlay) {
  return `
  <div class="lsc-root" style="height:100vh;">
    <div class="lsc-body" style="display:flex; height:100%;">
      <aside class="lsc-rail" style="width:220px;">
        <div class="lsc-rail-head"><b>LifeCode Skill Center</b></div>
        <div class="lsc-nav-item active">Resumen</div>
        <div class="lsc-nav-item">Biblioteca</div>
        <div class="lsc-nav-item">Proyectos</div>
      </aside>
      <main class="lsc-content" style="flex:1; padding:0; position:relative;">
        <div style="padding:18px 26px; border-bottom:1px solid rgba(148,163,184,.14); font-weight:650;"># Demo — flujo de release</div>
        <div style="padding:26px 32px; display:flex; flex-direction:column; gap:18px; max-width:600px;">
          <div style="align-self:flex-end; max-width:70%; background:rgba(124,92,255,.16); border:1px solid rgba(124,92,255,.35); border-radius:12px; padding:12px 14px;">
            Prepara el checklist de release y deja la actividad a la vista.
          </div>
          <div style="max-width:78%; background:rgba(148,163,184,.08); border:1px solid rgba(148,163,184,.16); border-radius:12px; padding:12px 14px;">
            Hecho: llamé a <span class="lsc-mono">lifecode_skill_create</span> y registré la actividad.
            <div style="margin-top:8px; color:var(--dsw-alias-label-secondary,#93a1b8); font-size:12px;">La persona decide; el aviso sólo informa.</div>
          </div>
          <div style="align-self:flex-end; max-width:70%; background:rgba(124,92,255,.16); border:1px solid rgba(124,92,255,.35); border-radius:12px; padding:12px 14px;">
            Guarda la mejora como versión 1.2.0 y sigue con la revisión de API.
          </div>
        </div>
        <div style="position:absolute; left:26px; right:26px; bottom:18px; border:1px solid rgba(148,163,184,.18); border-radius:12px; padding:12px 14px; color:#7f8ca5;">
          Envía mensajes o ejecuta una tarea…
        </div>
      </main>
    </div>
  </div>
  ${overlay}`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const panels = await projectsFlow();
  const center = await activityFlow();
  const portability = await portabilityFlow();
  const toasts = await chatFlow();
  const final = {
    'projects-discovered.png': panels.discovered,
    'project-detail.png': panels.detail,
    'collisions.png': panels.collisions,
    'skill-detail.png': panels.skill,
    'activity-center.png': center,
    'activity-toast.png': toasts.toast,
    'activity-chat.png': toasts.chat,
    'portability.png': portability,
  };
  for (const [name, source] of Object.entries(final)) {
    fs.copyFileSync(source, path.join(DOCS, name));
  }
  console.log('copiados:', Object.keys(final).join(', '));
}

await main();

