/* Runtime de los laboratorios de Stud.ia.
 *
 * Cada plantilla (public/labs/<id>.html) carga este archivo y su modelo (models/<id>.js). La app le manda la descripcion del experimento (postMessage 'init') y este
 * runtime construye TODA la interfaz: controles con la variable independiente y las controladas, resultados en vivo, escena, registro de ensayos, tabla, grafica y preguntas.
 * El modelo (fisica, economia...) es lo unico propio de cada plantilla: { id, model(v, c) -> salidas, draw(ctx, W, H, d), describe(v, c, out), animated? }.
 *
 * Seguridad: no hay innerHTML ni eval en ningun lado; todo texto entra por textContent. El laboratorio corre en un iframe aislado (sandbox sin allow-same-origin).
 * Sin dependencias, sin red, sin almacenamiento del navegador.
 */
(function () {
  'use strict';

  var HOST = 'studia-host';
  var LAB = 'studia-lab';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var models = (window.LabModels = window.LabModels || {});
  var S = null; // estado de la sesion

  // ───────── utilidades ─────────
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
      else if (k in n && k !== 'list' && k !== 'form') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function svg(tag, attrs, kids) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  var fmtCache = {};
  function fmt(n, d) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    d = d || 0;
    if (!fmtCache[d]) fmtCache[d] = new Intl.NumberFormat('es', { minimumFractionDigits: d, maximumFractionDigits: d });
    return fmtCache[d].format(n);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function withUnit(n, d, unit) { return fmt(n, d) + (unit ? ' ' + unit : ''); }

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function post(msg) {
    msg.source = LAB;
    try { window.parent.postMessage(msg, '*'); } catch (e) { /* sin padre: se ignora */ }
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var a = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, a); }, ms);
    };
  }

  // ───────── tema ─────────
  var SAFE_VALUE = /^[#a-zA-Z0-9(),.%\s\/-]+$/;
  function applyTheme(theme) {
    Object.keys(theme || {}).forEach(function (k) {
      if (/^--lab-[a-z0-9-]+$/.test(k) && typeof theme[k] === 'string' && SAFE_VALUE.test(theme[k])) document.documentElement.style.setProperty(k, theme[k]);
    });
    // Los controles del navegador (casillas, barras, listas) siguen el tema de la APP: oscuro si su fondo es oscuro, aunque el sistema sea otro.
    var m = String((theme || {})['--lab-bg'] || '').match(/^rgb\((\d+)\s+(\d+)\s+(\d+)\)$/);
    var dark = m ? (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255 < 0.5 : false;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }

  function colors() {
    var cs = getComputedStyle(document.documentElement);
    function g(n, fb) { return (cs.getPropertyValue(n) || '').trim() || fb; }
    return {
      bg: g('--lab-bg', '#ffffff'), surface: g('--lab-surface', '#f8fafc'), surface2: g('--lab-surface2', '#eef2f7'), line: g('--lab-line', '#cbd5e1'),
      fg: g('--lab-fg', '#0f172a'), muted: g('--lab-muted', '#475569'), primary: g('--lab-primary', '#4f46e5'), accent: g('--lab-accent', '#ea580c'),
      success: g('--lab-success', '#15803d'), danger: g('--lab-danger', '#b91c1c'),
    };
  }

  // ───────── dibujo: ejes y marcas "bonitas" ─────────
  function niceStep(range, count) {
    var raw = range / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / mag;
    var nice = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
    return nice * mag;
  }

  function ticks(min, max, count) {
    if (!(max > min)) return [min];
    var step = niceStep(max - min, count);
    var out = [];
    for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
    return out;
  }

  // Ejes sobre un canvas. area = {l,t,r,b} en px; xr/yr = [min,max]. Devuelve los conversores del mundo a pantalla.
  function axes(ctx, area, xr, yr, o) {
    o = o || {};
    var c = colors();
    var w = area.r - area.l;
    var h = area.b - area.t;
    function X(x) { return area.l + ((x - xr[0]) / (xr[1] - xr[0])) * w; }
    function Y(y) { return area.b - ((y - yr[0]) / (yr[1] - yr[0])) * h; }
    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.line;
    ctx.fillStyle = c.muted;
    ctx.textBaseline = 'middle';
    ticks(yr[0], yr[1], 5).forEach(function (v) {
      var y = Y(v);
      ctx.beginPath(); ctx.moveTo(area.l, y); ctx.lineTo(area.r, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(fmt(v, v % 1 ? 1 : 0), area.l - 6, y);
    });
    ctx.textBaseline = 'top';
    ticks(xr[0], xr[1], 6).forEach(function (v) {
      var x = X(v);
      ctx.beginPath(); ctx.moveTo(x, area.t); ctx.lineTo(x, area.b); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(fmt(v, v % 1 ? 1 : 0), x, area.b + 6);
    });
    ctx.strokeStyle = c.fg;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(area.l, area.t); ctx.lineTo(area.l, area.b); ctx.lineTo(area.r, area.b); ctx.stroke();
    ctx.fillStyle = c.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    if (o.xLabel) ctx.fillText(o.xLabel, (area.l + area.r) / 2, area.b + 34);
    if (o.yLabel) {
      ctx.translate(14, (area.t + area.b) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'top';
      ctx.fillText(o.yLabel, 0, 0);
    }
    ctx.restore();
    return { X: X, Y: Y, colors: c };
  }

  window.Lab = {
    register: function (m) { if (m && m.id) models[m.id] = m; },
    draw: { axes: axes, ticks: ticks, fmt: fmt, colors: colors },
  };

  // ───────── estado y calculos ─────────
  function valuesNow() {
    var v = {};
    S.lab.variables.forEach(function (d) { v[d.id] = S.values[d.id]; });
    return v;
  }

  function constantsNow() {
    var c = {};
    S.lab.constants.forEach(function (d) { c[d.id] = d.value; });
    return c;
  }

  function computeOutputs(values) {
    var out = {};
    try {
      var r = S.model.model(values, constantsNow());
      S.lab.outputs.forEach(function (o) { out[o.id] = typeof r[o.id] === 'number' && isFinite(r[o.id]) ? r[o.id] : 0; });
    } catch (e) {
      S.lab.outputs.forEach(function (o) { out[o.id] = 0; });
    }
    return out;
  }

  function currentState() {
    return {
      hypothesis: S.hypothesis,
      trials: S.trials.map(function (t, i) { return { n: i + 1, control: !!t.control, inputs: t.inputs, outputs: t.outputs }; }),
      answers: S.answers.slice(),
      conclusion: S.conclusion,
    };
  }

  var emitState = debounce(function () { if (S && !S.readOnly) post({ type: 'state', state: currentState() }); }, 500);

  // ───────── construccion de la interfaz ─────────
  var ui = {};

  function lockIcon() {
    return svg('svg', { viewBox: '0 0 24 24', width: '14', height: '14', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, [
      svg('rect', { x: '3', y: '11', width: '18', height: '11', rx: '2' }),
      svg('path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }),
    ]);
  }

  function section(n, title, intro, body, id) {
    return el('section', { class: 'lab-card', 'aria-labelledby': id }, [
      el('h2', { id: id, class: 'lab-h2' }, [el('span', { class: 'lab-step', 'aria-hidden': 'true', text: String(n) }), title]),
      intro ? el('p', { class: 'lab-intro', text: intro }) : null,
    ].concat(body));
  }

  function buildControls() {
    var wrap = el('div', { class: 'lab-controls' });
    S.lab.variables.forEach(function (d) {
      var id = 'var-' + d.id;
      var out = el('output', { class: 'lab-val', for: id, text: withUnit(S.values[d.id], d.decimals, d.unit) });
      var input = el('input', {
        type: 'range', id: id, min: String(d.min), max: String(d.max), step: String(d.step), value: String(S.values[d.id]),
        disabled: d.locked || S.readOnly,
        on: {
          input: function () {
            S.values[d.id] = clamp(Number(input.value), d.min, d.max);
            out.textContent = withUnit(S.values[d.id], d.decimals, d.unit);
            S.t = 1;
            refresh();
          },
        },
      });
      ui['in-' + d.id] = input;
      ui['out-' + d.id] = out;
      var tag = d.role === 'independiente'
        ? el('span', { class: 'lab-tag lab-tag-ind', text: 'Variable independiente' })
        : el('span', { class: 'lab-tag lab-tag-fixed' }, d.locked ? [lockIcon(), 'Controlada (fija)'] : ['Controlada']);
      wrap.appendChild(el('div', { class: 'lab-var' + (d.locked ? ' is-locked' : '') + (d.role === 'independiente' ? ' is-ind' : '') }, [
        el('div', { class: 'lab-var-head' }, [el('label', { for: id, text: d.label }), tag]),
        el('div', { class: 'lab-var-row' }, [input, out]),
      ]));
    });
    return wrap;
  }

  function buildConstants() {
    if (S.lab.constants.length === 0) return null;
    var dl = el('dl', { class: 'lab-consts' });
    S.lab.constants.forEach(function (c) {
      dl.appendChild(el('div', {}, [el('dt', { text: c.label }), el('dd', { text: withUnit(c.value, c.decimals, c.unit) })]));
    });
    return el('div', {}, [el('h3', { class: 'lab-h3', text: 'Entorno (constantes)' }), dl]);
  }

  function buildOutputs() {
    var g = el('div', { class: 'lab-outs', role: 'group', 'aria-label': 'Resultados del experimento' });
    S.lab.outputs.forEach(function (o) {
      var v = el('span', { class: 'lab-out-val', text: '—' });
      ui['res-' + o.id] = v;
      g.appendChild(el('div', { class: 'lab-out' }, [el('span', { class: 'lab-out-label', text: o.label }), v]));
    });
    return g;
  }

  function buildScene() {
    ui.canvas = el('canvas', { class: 'lab-canvas', role: 'img', 'aria-label': 'Escena del experimento' });
    var kids = [ui.canvas];
    if (S.model.animated) {
      kids.push(el('button', { type: 'button', class: 'lab-btn lab-btn-ghost', text: S.model.animateLabel || 'Reproducir', disabled: S.readOnly, on: { click: play } }));
    }
    return el('div', { class: 'lab-scene' }, kids);
  }

  function buildTrialsBar() {
    ui.control = el('input', { type: 'checkbox', id: 'ctrl-trial', checked: S.trials.length === 0, disabled: S.readOnly });
    ui.status = el('p', { class: 'lab-status', role: 'status', 'aria-live': 'polite', text: '' });
    ui.progress = el('p', { class: 'lab-progress' });
    ui.record = el('button', { type: 'button', class: 'lab-btn lab-btn-primary', text: 'Registrar ensayo', disabled: S.readOnly, on: { click: recordTrial } });
    ui.undo = el('button', { type: 'button', class: 'lab-btn lab-btn-ghost', text: 'Deshacer último', disabled: S.readOnly, on: { click: undoTrial } });
    return el('div', { class: 'lab-actions' }, [
      el('label', { class: 'lab-check', for: 'ctrl-trial' }, [ui.control, 'Es el ensayo de control (línea base)']),
      el('div', { class: 'lab-btn-row' }, [ui.record, ui.undo]),
      ui.progress,
      ui.status,
    ]);
  }

  function buildTable() {
    ui.tableWrap = el('div', { class: 'lab-table-wrap' });
    ui.csv = el('button', { type: 'button', class: 'lab-btn lab-btn-ghost', text: 'Exportar CSV', on: { click: exportCsv } });
    return el('div', {}, [ui.tableWrap, el('div', { class: 'lab-btn-row' }, [ui.csv])]);
  }

  function selectOf(id, label, options, value, onChange) {
    var s = el('select', { id: id, class: 'lab-select', on: { change: function () { onChange(s.value); } } },
      options.map(function (o) { return el('option', { value: o.id, text: o.label + (o.unit ? ' (' + o.unit + ')' : ''), selected: o.id === value }); }));
    return el('div', { class: 'lab-field' }, [el('label', { for: id, text: label }), s]);
  }

  function buildChart() {
    ui.chartHost = el('div', { class: 'lab-chart' });
    return el('div', {}, [
      el('div', { class: 'lab-chart-controls' }, [
        selectOf('chart-x', 'Eje horizontal', S.lab.variables, S.chart.x, function (v) { S.chart.x = v; drawChart(); }),
        selectOf('chart-y', 'Eje vertical', S.lab.outputs, S.chart.y, function (v) { S.chart.y = v; drawChart(); }),
      ]),
      ui.chartHost,
    ]);
  }

  function textareaField(id, label, value, rows, onInput) {
    var t = el('textarea', { id: id, class: 'lab-textarea', rows: String(rows), maxlength: '2000', disabled: S.readOnly, on: { input: function () { onInput(t.value); emitState(); } } });
    t.value = value || '';
    return el('div', { class: 'lab-field lab-field-block' }, [el('label', { for: id, text: label }), t]);
  }

  function buildReport() {
    var kids = S.lab.questions.map(function (q, i) {
      return textareaField('q-' + q.id, q.text, S.answers[i] || '', 3, function (v) { S.answers[i] = v; });
    });
    kids.push(textareaField('conclusion', 'Conclusión: ¿qué descubriste? Apóyate en tus datos.', S.conclusion, 4, function (v) { S.conclusion = v; }));
    ui.submitMsg = el('p', { class: 'lab-status', role: 'alert', text: '' });
    ui.submit = el('button', { type: 'button', class: 'lab-btn lab-btn-primary', text: S.submitted ? 'Informe entregado' : 'Entregar informe', disabled: S.readOnly || S.submitted, on: { click: submit } });
    kids.push(el('div', { class: 'lab-btn-row' }, [ui.submit]), ui.submitMsg);
    return kids;
  }

  function build() {
    var root = document.getElementById('lab');
    root.textContent = '';
    ui = {};
    var L = S.lab;

    root.appendChild(el('header', { class: 'lab-head' }, [
      el('p', { class: 'lab-kicker', text: 'Laboratorio · ' + (S.model.areaLabel || '') }),
      el('h1', { class: 'lab-h1', text: L.title }),
      el('p', { class: 'lab-objective', text: L.objective }),
      L.context ? el('p', { class: 'lab-context', text: L.context }) : null,
      el('p', { class: 'lab-mode' }, [L.mode === 'controlado'
        ? 'Experimento controlado: solo se mueve la variable independiente (' + varLabel(L.independent) + '); todo lo demás se mantiene fijo para que puedas comparar con justicia.'
        : 'Modo libre: puedes mover todas las variables. Procura cambiar una a la vez.'])
    ]));

    root.appendChild(section(1, 'Tu hipótesis', null, [textareaField('hypothesis', L.hypothesisPrompt, S.hypothesis, 3, function (v) { S.hypothesis = v; })], 'sec-hyp'));

    var left = el('div', { class: 'lab-col' }, [buildScene(), buildOutputs()]);
    var right = el('div', { class: 'lab-col' }, [buildControls(), buildConstants(), buildTrialsBar()]);
    root.appendChild(section(2, 'Experimenta', 'Mueve la variable independiente y registra cada ensayo. Repetir ensayos hace tus datos más confiables.', [el('div', { class: 'lab-grid' }, [left, right])], 'sec-exp'));
    root.appendChild(section(3, 'Tus datos', 'Cada ensayo queda en la tabla. El ensayo de control es la línea base.', [buildTable()], 'sec-data'));
    root.appendChild(section(4, 'Gráfica', 'Elige qué relacionar. Busca el patrón en tus puntos.', [buildChart()], 'sec-chart'));
    root.appendChild(section(5, 'Informe', 'Responde con tus propias palabras y con tus datos.', buildReport(), 'sec-report'));
    refresh();
  }

  function varLabel(id) {
    var v = S.lab.variables.filter(function (x) { return x.id === id; })[0];
    return v ? v.label : id;
  }

  // ───────── actualizacion ─────────
  function refresh() {
    var v = valuesNow();
    var out = computeOutputs(v);
    S.lab.outputs.forEach(function (o) { ui['res-' + o.id].textContent = withUnit(out[o.id], o.decimals, o.unit); });
    drawScene(v, out);
    renderTable();
    drawChart();
    updateProgress();
  }

  function drawScene(v, out) {
    var canvas = ui.canvas;
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var W = Math.max(280, Math.round(rect.width || canvas.parentNode.clientWidth || 480));
    var H = Math.round(W * 0.62);
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    try {
      S.model.draw(ctx, W, H, { values: v, constants: constantsNow(), outputs: out, trials: S.trials, t: S.t, lab: S.lab, colors: colors() });
    } catch (e) { /* un fallo de dibujo no debe tumbar el laboratorio */ }
    if (S.model.describe) canvas.setAttribute('aria-label', S.model.describe(v, constantsNow(), out));
  }

  function renderTable() {
    var L = S.lab;
    var wrap = ui.tableWrap;
    wrap.textContent = '';
    if (S.trials.length === 0) {
      wrap.appendChild(el('p', { class: 'lab-empty', text: 'Todavía no registraste ningún ensayo.' }));
      return;
    }
    var head = el('tr', {}, [el('th', { scope: 'col', text: '#' }), el('th', { scope: 'col', text: 'Control' })]
      .concat(L.variables.map(function (d) { return el('th', { scope: 'col', text: d.label + (d.unit ? ' (' + d.unit + ')' : '') }); }))
      .concat(L.outputs.map(function (o) { return el('th', { scope: 'col', class: 'is-out', text: o.label + (o.unit ? ' (' + o.unit + ')' : '') }); })));
    var body = S.trials.map(function (t, i) {
      return el('tr', {}, [el('th', { scope: 'row', text: String(i + 1) }), el('td', { text: t.control ? 'Sí' : '' })]
        .concat(L.variables.map(function (d) { return el('td', { text: fmt(t.inputs[d.id], d.decimals) }); }))
        .concat(L.outputs.map(function (o) { return el('td', { class: 'is-out', text: fmt(t.outputs[o.id], o.decimals) }); })));
    });
    wrap.appendChild(el('table', { class: 'lab-table' }, [el('caption', { class: 'lab-sr', text: 'Ensayos registrados' }), el('thead', {}, [head]), el('tbody', {}, body)]));
  }

  function updateProgress() {
    var n = S.trials.length;
    var need = S.lab.minTrials;
    ui.progress.textContent = n >= need ? 'Ensayos: ' + n + ' (ya tienes los necesarios, puedes seguir)' : 'Ensayos: ' + n + ' de ' + need + ' necesarios';
    ui.undo.disabled = S.readOnly || n === 0;
    ui.record.disabled = S.readOnly || n >= 60;
  }

  // ───────── ensayos ─────────
  function recordTrial() {
    if (S.readOnly || S.trials.length >= 60) return;
    var v = valuesNow();
    var out = computeOutputs(v);
    S.trials.push({ n: S.trials.length + 1, control: !!ui.control.checked, inputs: v, outputs: out });
    ui.control.checked = false;
    ui.status.textContent = 'Ensayo ' + S.trials.length + ' registrado.';
    refresh();
    emitState();
  }

  function undoTrial() {
    if (S.readOnly || S.trials.length === 0) return;
    S.trials.pop();
    ui.status.textContent = 'Se deshizo el último ensayo.';
    if (S.trials.length === 0) ui.control.checked = true;
    refresh();
    emitState();
  }

  function play() {
    if (reduceMotion || !S.model.animated) { S.t = 1; refresh(); return; }
    var start = null;
    var dur = (S.model.duration || 1.4) * 1000;
    function step(ts) {
      if (start === null) start = ts;
      S.t = clamp((ts - start) / dur, 0, 1);
      drawScene(valuesNow(), computeOutputs(valuesNow()));
      if (S.t < 1) requestAnimationFrame(step);
    }
    S.t = 0;
    requestAnimationFrame(step);
  }

  // ───────── grafica ─────────
  function drawChart() {
    var host = ui.chartHost;
    if (!host) return;
    host.textContent = '';
    var L = S.lab;
    var xd = L.variables.filter(function (d) { return d.id === S.chart.x; })[0] || L.variables[0];
    var yd = L.outputs.filter(function (o) { return o.id === S.chart.y; })[0] || L.outputs[0];
    var pts = S.trials.map(function (t) { return { x: t.inputs[xd.id], y: t.outputs[yd.id], control: t.control }; });
    var c = colors();

    var curve = [];
    if (L.showModelCurve) {
      var v = valuesNow();
      for (var i = 0; i <= 60; i++) {
        var vv = {}; Object.keys(v).forEach(function (k) { vv[k] = v[k]; });
        vv[xd.id] = xd.min + ((xd.max - xd.min) * i) / 60;
        curve.push({ x: vv[xd.id], y: computeOutputs(vv)[yd.id] });
      }
    }
    if (pts.length < 2 && curve.length === 0) {
      host.appendChild(el('p', { class: 'lab-empty', text: 'Registra al menos 2 ensayos distintos para ver la gráfica.' }));
      return;
    }

    var all = pts.concat(curve);
    var xs = all.map(function (p) { return p.x; });
    var ys = all.map(function (p) { return p.y; });
    var xr = [Math.min.apply(null, xs.concat([xd.min])), Math.max.apply(null, xs.concat([xd.max]))];
    var ymin = Math.min.apply(null, ys.concat([0]));
    var ymax = Math.max.apply(null, ys);
    if (ymax === ymin) ymax = ymin + 1;
    var yr = [ymin, ymax + (ymax - ymin) * 0.08];

    var W = 620, H = 320, area = { l: 64, t: 14, r: W - 16, b: H - 52 };
    function X(x) { return area.l + ((x - xr[0]) / (xr[1] - xr[0])) * (area.r - area.l); }
    function Y(y) { return area.b - ((y - yr[0]) / (yr[1] - yr[0])) * (area.b - area.t); }
    var g = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'lab-svg', role: 'img', 'aria-label': 'Gráfica de ' + yd.label + ' según ' + xd.label + ' con ' + pts.length + ' ensayos' });

    ticks(yr[0], yr[1], 5).forEach(function (v) {
      g.appendChild(svg('line', { x1: area.l, x2: area.r, y1: Y(v), y2: Y(v), stroke: c.line, 'stroke-width': '1' }));
      g.appendChild(svg('text', { x: area.l - 8, y: Y(v) + 4, 'text-anchor': 'end', fill: c.muted, 'font-size': '12' }, [document.createTextNode(fmt(v, v % 1 ? 1 : 0))]));
    });
    ticks(xr[0], xr[1], 6).forEach(function (v) {
      g.appendChild(svg('line', { x1: X(v), x2: X(v), y1: area.t, y2: area.b, stroke: c.line, 'stroke-width': '1' }));
      g.appendChild(svg('text', { x: X(v), y: area.b + 18, 'text-anchor': 'middle', fill: c.muted, 'font-size': '12' }, [document.createTextNode(fmt(v, v % 1 ? 1 : 0))]));
    });
    g.appendChild(svg('path', { d: 'M' + area.l + ' ' + area.t + 'V' + area.b + 'H' + area.r, fill: 'none', stroke: c.fg, 'stroke-width': '1.5' }));
    g.appendChild(svg('text', { x: (area.l + area.r) / 2, y: H - 8, 'text-anchor': 'middle', fill: c.fg, 'font-size': '13', 'font-weight': '600' }, [document.createTextNode(xd.label + (xd.unit ? ' (' + xd.unit + ')' : ''))]));
    var ylab = svg('text', { transform: 'translate(16 ' + (area.t + area.b) / 2 + ') rotate(-90)', 'text-anchor': 'middle', fill: c.fg, 'font-size': '13', 'font-weight': '600' }, [document.createTextNode(yd.label + (yd.unit ? ' (' + yd.unit + ')' : ''))]);
    g.appendChild(ylab);

    if (curve.length) {
      g.appendChild(svg('path', { d: curve.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' '), fill: 'none', stroke: c.muted, 'stroke-width': '2', 'stroke-dasharray': '6 5' }));
    }
    if (pts.length > 1) {
      var sorted = pts.slice().sort(function (a, b) { return a.x - b.x; });
      g.appendChild(svg('path', { d: sorted.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' '), fill: 'none', stroke: c.primary, 'stroke-width': '2' }));
    }
    pts.forEach(function (p) {
      var dot = svg('circle', { cx: X(p.x), cy: Y(p.y), r: p.control ? 7 : 5, fill: p.control ? c.accent : c.primary, stroke: c.bg, 'stroke-width': '2' });
      dot.appendChild(svg('title', {}, [document.createTextNode(xd.label + ': ' + fmt(p.x, xd.decimals) + ' · ' + yd.label + ': ' + fmt(p.y, yd.decimals) + (p.control ? ' (control)' : ''))]));
      g.appendChild(dot);
    });
    host.appendChild(g);
    var legend = [el('span', { class: 'lab-legend-item' }, [el('i', { class: 'lab-dot lab-dot-primary' }), 'Ensayo']), el('span', { class: 'lab-legend-item' }, [el('i', { class: 'lab-dot lab-dot-accent' }), 'Ensayo de control'])];
    if (curve.length) legend.push(el('span', { class: 'lab-legend-item' }, [el('i', { class: 'lab-dash' }), 'Curva del modelo']));
    host.appendChild(el('div', { class: 'lab-legend' }, legend));
  }

  // ───────── CSV ─────────
  function csvCell(v) {
    var s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var L = S.lab;
    var head = ['ensayo', 'control'].concat(L.variables.map(function (d) { return d.id + (d.unit ? ' (' + d.unit + ')' : ''); })).concat(L.outputs.map(function (o) { return o.id + (o.unit ? ' (' + o.unit + ')' : ''); }));
    var rows = S.trials.map(function (t, i) {
      return [i + 1, t.control ? 'si' : 'no'].concat(L.variables.map(function (d) { return t.inputs[d.id]; })).concat(L.outputs.map(function (o) { return t.outputs[o.id]; }));
    });
    var csv = [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\n');
    try {
      var url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      var a = el('a', { href: url, download: 'laboratorio-' + L.template + '.csv' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      ui.status.textContent = 'Datos exportados.';
    } catch (e) {
      ui.status.textContent = 'No se pudo exportar en este navegador.';
    }
  }

  // ───────── entrega ─────────
  function submit() {
    var L = S.lab;
    var missing = L.minTrials - S.trials.length;
    var problems = [];
    if (missing > 0) problems.push('Te faltan ' + missing + ' ensayo' + (missing === 1 ? '' : 's') + ' (necesitas ' + L.minTrials + ').');
    if (!S.trials.some(function (t) { return t.control; })) problems.push('Marca al menos un ensayo como ensayo de control.');
    if (S.hypothesis.trim().length < 10) problems.push('Escribe tu hipótesis.');
    if (S.conclusion.trim().length < 20) problems.push('Escribe tu conclusión (al menos una o dos frases).');
    if (problems.length) {
      ui.submitMsg.textContent = 'Antes de entregar: ' + problems.join(' ');
      return;
    }
    S.submitted = true;
    S.readOnly = true;
    post({ type: 'submit', state: currentState() });
    build();
    ui.submitMsg.textContent = 'Informe entregado. ¡Buen trabajo!';
  }

  // ───────── arranque ─────────
  function sizeToParent() {
    var last = 0;
    function send() {
      var h = Math.ceil(document.documentElement.scrollHeight);
      if (Math.abs(h - last) > 2) { last = h; post({ type: 'resize', height: h }); }
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(send).observe(document.body);
    window.addEventListener('load', send);
    send();
  }

  function init(msg) {
    var lab = msg.lab;
    var model = models[lab.template];
    var root = document.getElementById('lab');
    if (!model) { root.textContent = 'Este laboratorio no se pudo cargar.'; return; }
    applyTheme(msg.theme);
    var st = msg.state || {};
    S = {
      lab: lab, model: model, values: {}, trials: [], hypothesis: st.hypothesis || '', answers: (st.answers || []).slice(), conclusion: st.conclusion || '',
      readOnly: !!msg.readOnly, submitted: !!msg.readOnly, chart: { x: lab.chart.x, y: lab.chart.y }, t: 1,
    };
    lab.variables.forEach(function (d) { S.values[d.id] = d.default; });
    (st.trials || []).forEach(function (t) { S.trials.push({ n: S.trials.length + 1, control: !!t.control, inputs: t.inputs, outputs: t.outputs }); });
    // Si hay ensayos guardados, los controles arrancan en los valores del ultimo.
    if (S.trials.length) lab.variables.forEach(function (d) { var v = S.trials[S.trials.length - 1].inputs[d.id]; if (typeof v === 'number') S.values[d.id] = clamp(v, d.min, d.max); });
    document.title = lab.title;
    build();
    window.addEventListener('resize', debounce(function () { if (S) drawScene(valuesNow(), computeOutputs(valuesNow())); }, 120));
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || d.source !== HOST || d.type !== 'init' || !d.lab) return;
    init(d);
  });

  document.addEventListener('DOMContentLoaded', function () {
    sizeToParent();
    post({ type: 'ready', template: document.documentElement.getAttribute('data-lab-template') || '' });
  });
})();
