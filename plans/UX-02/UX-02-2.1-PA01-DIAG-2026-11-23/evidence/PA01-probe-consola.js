/**
 * Sonda PA01 · SÓLO LECTURA. No modifica código, ni estado del panel, ni configuración.
 *
 * Para qué: distinguir tres causas que se parecen desde fuera.
 *   A) «Copiar ruta» no copia          → demostrado ya por código (no necesita esta sonda)
 *   B) «Mostrar ruta» cambia el texto pero el CSS lo recorta, o la ruta ya era corta
 *   C) los eventos no llegan al componente (montaje del host)
 *
 * Cómo usarla: en la app, abrir DevTools (Ctrl+Shift+I), pestaña Console, pegar TODO este bloque
 * y pulsar Enter. Copiar el objeto que imprime (botón derecho → «Copy object»).
 *
 * El único efecto: un clic sintético en un botón «Mostrar ruta» (puro estado local, sin red).
 * No toca «Actualizar» (haría una petición) ni ningún control de escritura.
 */
(async () => {
  const out = { cuando: new Date().toISOString(), url: location.href, pasos: {} };

  // 1 · ¿está montada la sección y en qué estado la dejó el panel?
  const view = document.querySelector('[data-view="workspaces"]');
  out.pasos['1_vista'] = view
    ? { montada: true, estado: view.getAttribute('data-ws-state'), filas: view.querySelectorAll('tbody tr').length }
    : { montada: false };

  // 2 · inventario de controles reales de la sección
  const pathBtns = [...document.querySelectorAll('.lcr-pa-path__btn')];
  const refresh = document.querySelector('[data-ws-refresh]');
  out.pasos['2_controles'] = {
    botonesDeRuta: pathBtns.length,
    etiquetasDeRuta: [...new Set(pathBtns.map((b) => b.textContent.trim()))],
    botonActualizar: refresh ? { presente: true, deshabilitado: !!refresh.disabled, texto: refresh.textContent.trim() } : { presente: false },
    chips: document.querySelectorAll('[data-view="workspaces"] .lcr-pa-chip').length,
    enlaces: document.querySelectorAll('[data-view="workspaces"] a').length,
  };

  // 3 · ¿hay algo encima del primer botón? (overlay, sticky, modal)
  const b0 = pathBtns[0];
  if (b0) {
    const r = b0.getBoundingClientRect();
    const top = (r.width > 0 && r.height > 0)
      ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      : null;
    out.pasos['3_hit_test'] = {
      caja: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      elementoEnElPunto: top ? { tag: top.tagName, clase: String(top.className).slice(0, 60) } : null,
      esElPropioBoton: top === b0,
      tapaAlgo: top && top !== b0 && !b0.contains(top),
    };
  }

  // 4 · cadena de pointer-events / opacidad / visibilidad hasta la raíz
  const cadena = [];
  for (let e = b0; e && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.pointerEvents !== 'auto' || cs.visibility !== 'visible' || Number(cs.opacity) < 1) {
      cadena.push({ tag: e.tagName, clase: String(e.className).slice(0, 60), pointerEvents: cs.pointerEvents, visibility: cs.visibility, opacity: cs.opacity });
    }
  }
  out.pasos['4_pointer_events_anomalos'] = cadena;
  out.pasos['5_modal'] = document.querySelector('.lcr-modal') ? 'HAY un .lcr-modal montado' : 'sin .lcr-modal';

  // 6 · prueba decisiva: clic sintético en «Mostrar ruta» y lectura del resultado
  const muestra = pathBtns.find((b) => /^(Mostrar ruta|Show path)$/.test(b.textContent.trim()));
  if (!muestra) {
    out.pasos['6_clic_sintetico'] = { ejecutado: false, motivo: 'no se encontró un botón «Mostrar ruta»' };
  } else {
    const code = muestra.parentElement.querySelector('.lcr-pa-path__value');
    const antes = { etiqueta: muestra.textContent.trim(), texto: code ? code.textContent : null, aria: muestra.getAttribute('aria-expanded') };
    muestra.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const code2 = muestra.parentElement.querySelector('.lcr-pa-path__value');
    const despues = {
      etiqueta: muestra.textContent.trim(),
      texto: code2 ? code2.textContent : null,
      aria: muestra.getAttribute('aria-expanded'),
    };
    out.pasos['6_clic_sintetico'] = {
      ejecutado: true,
      antes,
      despues,
      laEtiquetaCambio: antes.etiqueta !== despues.etiqueta,
      elTextoTambienCambio: antes.texto !== despues.texto,
      // Si la etiqueta cambió, los eventos SÍ llegan y el problema es de presentación (CSS o ruta corta).
      // Si no cambió nada, los eventos NO llegan y hay que mirar el montaje del host.
      veredicto: antes.etiqueta !== despues.etiqueta
        ? 'los eventos llegan; el defecto es de presentación'
        : 'los eventos NO llegan al componente',
      anchoMaximoCss: code2 ? getComputedStyle(code2).maxWidth : null,
      textoRecortado: code2 ? code2.scrollWidth > code2.clientWidth : null,
    };
  }

  // 7 · errores ya ocurridos no se pueden recuperar; sí se puede ver si hay promesas rechazadas ahora
  out.pasos['7_entorno'] = {
    reactPresente: typeof window.React !== 'undefined',
    moduleLoader: typeof window.__ModuleLoader__ !== 'undefined',
    userAgent: navigator.userAgent.slice(0, 80),
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
})();
