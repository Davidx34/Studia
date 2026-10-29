/* Modelo del laboratorio "Lanzamiento de proyectiles" (cinematica en dos dimensiones, sin resistencia del aire).
 *   x(t) = v0·cos(θ)·t            y(t) = h0 + v0·sin(θ)·t − g·t²/2
 *   tiempo de vuelo   t_f = (v0·sinθ + √((v0·sinθ)² + 2·g·h0)) / g        (la raiz positiva de y(t) = 0)
 *   alcance           R   = v0·cosθ · t_f
 *   altura maxima     H   = h0 + (v0·sinθ)² / (2g)
 *   velocidad al caer v   = √(vx² + (vy − g·t_f)²)
 * Archivo UMD: en el navegador se registra en window.LabModels; en las pruebas se carga con require.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else (root.LabModels = root.LabModels || {})[m.id] = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RAD = Math.PI / 180;

  function model(v, c) {
    var th = v.angulo * RAD;
    var vx = v.v0 * Math.cos(th);
    var vy = v.v0 * Math.sin(th);
    var g = c.g;
    var tf = (vy + Math.sqrt(vy * vy + 2 * g * v.h0)) / g;
    var vyEnd = vy - g * tf;
    return {
      alcance: vx * tf,
      alturaMax: v.h0 + (vy * vy) / (2 * g),
      tiempoVuelo: tf,
      velImpacto: Math.sqrt(vx * vx + vyEnd * vyEnd),
    };
  }

  // Posicion del proyectil en el instante t.
  function pos(v, c, t) {
    var th = v.angulo * RAD;
    return { x: v.v0 * Math.cos(th) * t, y: v.h0 + v.v0 * Math.sin(th) * t - (c.g * t * t) / 2 };
  }

  function describe(v, c, out) {
    function f(n, d) { return n.toFixed(d).replace('.', ','); }
    return 'Proyectil lanzado a ' + v.v0 + ' metros por segundo con un ángulo de ' + v.angulo + ' grados desde ' + v.h0 + ' metros de altura, con gravedad de ' + f(c.g, 2) +
      ' metros por segundo al cuadrado. Alcanza ' + f(out.alcance, 1) + ' metros, sube hasta ' + f(out.alturaMax, 1) + ' metros y vuela ' + f(out.tiempoVuelo, 1) + ' segundos.';
  }

  function draw(ctx, W, H, d) {
    var Lab = (typeof window !== 'undefined' && window.Lab) || null;
    if (!Lab) return;
    var v = d.values, c = d.constants, out = d.outputs, col = d.colors, trials = d.trials;

    var maxX = Math.max(out.alcance, 10);
    var maxY = Math.max(out.alturaMax, v.h0, 5);
    trials.forEach(function (t) { maxX = Math.max(maxX, t.outputs.alcance); maxY = Math.max(maxY, t.outputs.alturaMax); });
    maxX *= 1.12;
    maxY *= 1.2;

    var area = { l: 54, t: 14, r: W - 14, b: H - 46 };
    var pw = area.r - area.l, ph = area.b - area.t;
    // Misma escala en los dos ejes: la trayectoria se ve con sus proporciones reales.
    var xr = maxX, yr = maxY;
    if (maxX / pw >= maxY / ph) yr = (maxX * ph) / pw; else xr = (maxY * pw) / ph;
    var ax = Lab.draw.axes(ctx, area, [0, xr], [0, yr], { xLabel: 'Distancia horizontal (m)', yLabel: 'Altura (m)' });
    var X = ax.X, Y = ax.Y;

    ctx.save();
    ctx.beginPath(); ctx.rect(area.l, area.t, pw, ph); ctx.clip();

    function path(vv, upTo) {
      var tf = model(vv, c).tiempoVuelo;
      var n = 64;
      ctx.beginPath();
      for (var i = 0; i <= n; i++) {
        var p = pos(vv, c, (tf * upTo * i) / n);
        if (i === 0) ctx.moveTo(X(p.x), Y(p.y)); else ctx.lineTo(X(p.x), Y(p.y));
      }
      ctx.stroke();
    }

    // Ensayos anteriores: finos, el de control en otro color.
    trials.forEach(function (t) {
      ctx.lineWidth = t.control ? 2 : 1.5;
      ctx.strokeStyle = t.control ? col.accent : col.muted;
      ctx.globalAlpha = t.control ? 0.9 : 0.5;
      ctx.setLineDash(t.control ? [6, 4] : []);
      path(t.inputs, 1);
    });
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    // Plataforma de lanzamiento.
    if (v.h0 > 0) {
      ctx.fillStyle = col.line;
      ctx.fillRect(X(0) - 12, Y(v.h0), 12, Y(0) - Y(v.h0));
    }

    // Trayectoria actual.
    var prog = Math.max(0, Math.min(1, d.t));
    ctx.lineWidth = 3;
    ctx.strokeStyle = col.primary;
    path(v, prog);

    // Flecha de lanzamiento (el angulo).
    var th = v.angulo * RAD;
    var L = Math.min(pw, ph) * 0.14;
    var ox = X(0), oy = Y(v.h0);
    ctx.strokeStyle = col.fg;
    ctx.fillStyle = col.fg;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + L * Math.cos(th), oy - L * Math.sin(th)); ctx.stroke();
    ctx.beginPath(); ctx.arc(ox, oy, 4, 0, Math.PI * 2); ctx.fill();

    // Proyectil.
    var tNow = out.tiempoVuelo * prog;
    var p = pos(v, c, tNow);
    ctx.fillStyle = col.accent;
    ctx.beginPath(); ctx.arc(X(p.x), Y(Math.max(0, p.y)), 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col.bg; ctx.lineWidth = 2; ctx.stroke();

    // Marca del alcance y de la altura maxima (solo al terminar).
    if (prog >= 1) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = col.muted;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(out.alcance), Y(0)); ctx.lineTo(X(out.alcance), Y(0) - 18); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col.fg;
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(Lab.draw.fmt(out.alcance, 1) + ' m', Math.min(X(out.alcance), area.r - 28), Y(0) - 20);
    }
    ctx.restore();
  }

  return { id: 'trayectoria', areaLabel: 'Física', animated: true, animateLabel: 'Lanzar de nuevo', duration: 1.6, model: model, pos: pos, draw: draw, describe: describe };
});
