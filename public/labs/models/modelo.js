/* Laboratorio "a la medida": un modelo descrito como DATOS (variables, constantes, pasos, salidas y escena con formulas de texto).
 * Las formulas las interpreta el evaluador propio (expr.js, sin eval); aqui solo se calcula y se dibuja la escena. prepare(lab) recibe el modelo ya validado por la app
 * (src/lib/lab/model.ts) y devuelve { model(v, c), draw(...), describe(...) }, igual que una plantilla fija.
 * Archivo UMD: en el navegador se registra en window.LabModels; en las pruebas se carga con require.
 */
(function (root, factory) {
  var Expr = typeof module === 'object' && module.exports ? require('../expr.js') : root.LabExpr;
  var m = factory(Expr);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else (root.LabModels = root.LabModels || {})[m.id] = m;
})(typeof self !== 'undefined' ? self : this, function (Expr) {
  'use strict';

  var SWEEP_POINTS = 90;
  var PARAM_POINTS = 140;

  function finite(n) { return typeof n === 'number' && isFinite(n); }

  function compile(lab) {
    var md = lab.model;
    if (!md || !Expr) return null;
    var c = Expr.compileModel({ variables: md.variables, constants: md.constants, derived: md.derived, outputs: md.outputs, scene: md.scene });
    return c && c.ok ? c : null;
  }

  // Puntos de la escena para unos valores dados: [{ label, dashed, pts: [[x, y], ...] }], marcas [{ label, x, y }], y si hay curvas "sweep" cual es la variable independiente.
  function sceneData(lab, compiled, values, constants) {
    var md = lab.model;
    var env0 = compiled.run(values, constants);
    var curves = [];
    var marks = [];
    var sc = compiled.scene;
    var ind = null;
    for (var i = 0; i < md.variables.length; i++) if (md.variables[i].id === lab.independent) ind = md.variables[i];

    function sweep(outputId, label, dashed) {
      var pts = [];
      if (!ind) return;
      for (var k = 0; k <= SWEEP_POINTS; k++) {
        var v = {};
        Object.keys(values).forEach(function (key) { v[key] = values[key]; });
        v[ind.id] = ind.min + ((ind.max - ind.min) * k) / SWEEP_POINTS;
        var y = compiled.run(v, constants)[outputId];
        if (finite(y)) pts.push([v[ind.id], y]);
      }
      curves.push({ label: label, dashed: dashed, pts: pts, sweep: outputId });
    }

    if (sc.curves.length === 0 && sc.points.length === 0) {
      // Sin escena declarada: la salida de la grafica contra la variable independiente.
      sweep(lab.chart.y, '', false);
    }
    sc.curves.forEach(function (cv) {
      if (cv.kind === 'sweep') return sweep(cv.output, cv.label, cv.dashed);
      var a = cv.from(env0), b = cv.to(env0), pts = [];
      if (finite(a) && finite(b) && a < b) {
        for (var j = 0; j <= PARAM_POINTS; j++) {
          var e = Object.create(null);
          Object.keys(env0).forEach(function (key) { e[key] = env0[key]; });
          e[compiled.param] = a + ((b - a) * j) / PARAM_POINTS;
          var x = cv.x(e), y = cv.y(e);
          if (finite(x) && finite(y)) pts.push([x, y]);
        }
      }
      curves.push({ label: cv.label, dashed: cv.dashed, pts: pts });
    });
    sc.points.forEach(function (p) {
      var x = p.x(env0), y = p.y(env0);
      if (finite(x) && finite(y)) marks.push({ label: p.label, x: x, y: y });
    });
    return { curves: curves, marks: marks, ind: ind, env: env0 };
  }

  function prepare(lab) {
    var compiled = compile(lab);
    if (!compiled) return null;
    var md = lab.model;

    function model(v, c) {
      var env = compiled.run(v, c);
      var out = {};
      compiled.outputIds.forEach(function (id) { out[id] = env[id]; });
      return out;
    }

    function describe(v, c, out) {
      function f(n, d) { return Number(n).toFixed(d).replace('.', ','); }
      var ins = md.variables.map(function (d) { return d.label + ' = ' + f(v[d.id], d.decimals) + (d.unit ? ' ' + d.unit : ''); }).join(', ');
      var outs = md.outputs.map(function (o) { return o.label + ' = ' + f(out[o.id], o.decimals) + (o.unit ? ' ' + o.unit : ''); }).join(', ');
      return lab.title + '. Con ' + ins + ': ' + outs + '.';
    }

    function draw(ctx, W, H, d) {
      var Lab = (typeof window !== 'undefined' && window.Lab) || null;
      if (!Lab) return;
      var col = d.colors;
      var data = sceneData(lab, compiled, d.values, d.constants);
      var sc = md.scene || { xLabel: '', yLabel: '' };

      // Ensayos anteriores (solo si la escena es la respuesta contra la variable independiente).
      var dots = [];
      var sweepCurve = null;
      data.curves.forEach(function (cv) { if (cv.sweep && !sweepCurve) sweepCurve = cv; });
      if (sweepCurve && data.ind) {
        d.trials.forEach(function (t) {
          var x = t.inputs[data.ind.id], y = t.outputs[sweepCurve.sweep];
          if (finite(x) && finite(y)) dots.push({ x: x, y: y, control: t.control });
        });
      }

      // Rango de los ejes: todo lo que hay que dibujar, con un margen.
      // El marco lo definen la PRIMERA curva, las marcas y los ensayos; las demas curvas se recortan a ese marco (una curva de indiferencia que se dispara cerca de 0 no debe aplastar la escena).
      var xs = [], ys = [];
      function take(x, y) { xs.push(x); ys.push(y); }
      if (data.curves.length) data.curves[0].pts.forEach(function (p) { take(p[0], p[1]); });
      data.marks.forEach(function (m) { take(m.x, m.y); });
      dots.forEach(function (p) { take(p.x, p.y); });
      if (xs.length === 0) data.curves.forEach(function (cv) { cv.pts.forEach(function (p) { take(p[0], p[1]); }); });
      if (xs.length === 0) return;
      function range(a) {
        var lo = Math.min.apply(null, a), hi = Math.max.apply(null, a);
        if (lo >= 0 && lo < (hi - lo) * 0.6) lo = 0;
        if (hi <= 0 && hi > -(hi - lo) * 0.6) hi = 0;
        if (hi - lo < 1e-9) { hi = lo + 1; }
        var pad = (hi - lo) * 0.06;
        return [lo === 0 ? 0 : lo - pad, hi + pad];
      }
      var xr = range(xs), yr = range(ys);

      var xLabel = sc.xLabel || (data.ind ? data.ind.label + (data.ind.unit ? ' (' + data.ind.unit + ')' : '') : '');
      var yLabel = sc.yLabel || (sweepCurve ? labelOf(sweepCurve.sweep) : '');
      // La leyenda va en un margen propio encima del grafico (no se encima con las curvas).
      var labeled = data.curves.filter(function (cv) { return cv.label; });
      var area = { l: 56, t: 14 + (labeled.length ? labeled.length * 16 + 4 : 0), r: W - 14, b: H - 46 };
      var ax = Lab.draw.axes(ctx, area, xr, yr, { xLabel: xLabel, yLabel: yLabel });
      var X = ax.X, Y = ax.Y;

      ctx.save();
      ctx.beginPath(); ctx.rect(area.l, area.t, area.r - area.l, area.b - area.t); ctx.clip();
      var palette = [col.primary, col.accent, col.fg, col.muted];
      data.curves.forEach(function (cv, i) {
        if (cv.pts.length < 2) return;
        ctx.lineWidth = i === 0 ? 3 : 2.2;
        ctx.strokeStyle = palette[i % palette.length];
        ctx.setLineDash(cv.dashed ? [6, 5] : []);
        ctx.beginPath();
        cv.pts.forEach(function (p, k) { if (k === 0) ctx.moveTo(X(p[0]), Y(p[1])); else ctx.lineTo(X(p[0]), Y(p[1])); });
        ctx.stroke();
      });
      ctx.setLineDash([]);
      dots.forEach(function (p) {
        ctx.fillStyle = p.control ? col.accent : col.muted;
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), p.control ? 5 : 4, 0, Math.PI * 2); ctx.fill();
      });
      // Marca del valor actual sobre la curva de respuesta.
      if (sweepCurve && data.ind) {
        var cx = d.values[data.ind.id], cy = d.outputs[sweepCurve.sweep];
        if (finite(cx) && finite(cy)) {
          ctx.fillStyle = col.primary;
          ctx.beginPath(); ctx.arc(X(cx), Y(cy), 7, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = col.bg; ctx.lineWidth = 2; ctx.stroke();
        }
      }
      data.marks.forEach(function (m) {
        ctx.fillStyle = col.accent;
        ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col.bg; ctx.lineWidth = 2; ctx.stroke();
        if (m.label) {
          ctx.fillStyle = col.fg;
          ctx.font = '700 12px system-ui, sans-serif';
          ctx.textBaseline = 'bottom';
          ctx.textAlign = X(m.x) > area.r - 120 ? 'right' : 'left';
          ctx.fillText(m.label, X(m.x) + (X(m.x) > area.r - 120 ? -11 : 11), Y(m.y) - 9);
        }
      });
      ctx.restore();

      // Leyenda.
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      var ly = 8;
      data.curves.forEach(function (cv, i) {
        if (!cv.label) return;
        ctx.fillStyle = palette[i % palette.length];
        ctx.fillText((cv.dashed ? '- - ' : '— ') + cv.label, area.l, ly);
        ly += 16;
      });
    }

    function labelOf(id) {
      for (var i = 0; i < md.outputs.length; i++) if (md.outputs[i].id === id) return md.outputs[i].label + (md.outputs[i].unit ? ' (' + md.outputs[i].unit + ')' : '');
      return id;
    }

    return { id: 'modelo', areaLabel: 'Modelo', animated: false, model: model, draw: draw, describe: describe };
  }

  // Sin modelo no hay nada que calcular: el runtime muestra "no se pudo cargar".
  return { id: 'modelo', areaLabel: 'Modelo', animated: false, prepare: prepare, sceneData: sceneData };
});
