/* Modelo del laboratorio "Multiplicador keynesiano" (economia cerrada con impuestos proporcionales).
 *   Consumo        C  = C0 + c·(Y − T)               c = propension marginal a consumir
 *   Impuestos      T  = T0 + t·Y                      t = tasa impositiva
 *   Equilibrio     Y  = C + I + G
 *   =>  Y* = (C0 − c·T0 + I + G) / (1 − c·(1 − t))      multiplicador del gasto   k = 1 / (1 − c·(1 − t))
 * Cruz keynesiana: el gasto agregado DA(Y) = (C0 − c·T0 + I + G) + c·(1 − t)·Y corta la recta de 45° (DA = Y) en el ingreso de equilibrio.
 * Archivo UMD: en el navegador se registra en window.LabModels; en las pruebas se carga con require.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else (root.LabModels = root.LabModels || {})[m.id] = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Gasto autonomo y pendiente del gasto agregado.
  function parts(v, c) {
    return { a0: c.C0 - v.c * c.T0 + v.I + v.G, slope: v.c * (1 - v.t) };
  }

  function model(v, c) {
    var p = parts(v, c);
    var k = 1 / (1 - p.slope);
    var Y = p.a0 * k;
    var T = c.T0 + v.t * Y;
    return { Y: Y, k: k, consumo: c.C0 + v.c * (Y - T), recaudo: T };
  }

  function describe(v, c, out) {
    function f(n, d) { return n.toFixed(d).replace('.', ','); }
    return 'Cruz keynesiana: con gasto público de ' + v.G + ', inversión de ' + v.I + ', propensión a consumir de ' + f(v.c, 2) + ' y tasa de impuestos de ' + f(v.t, 2) +
      ', el ingreso de equilibrio es ' + f(out.Y, 1) + ' y el multiplicador del gasto es ' + f(out.k, 2) + '.';
  }

  function draw(ctx, W, H, d) {
    var Lab = (typeof window !== 'undefined' && window.Lab) || null;
    if (!Lab) return;
    var v = d.values, c = d.constants, out = d.outputs, col = d.colors, trials = d.trials;

    var maxY = Math.max(out.Y, 300);
    trials.forEach(function (t) { maxY = Math.max(maxY, t.outputs.Y); });
    maxY *= 1.3;
    var area = { l: 56, t: 14, r: W - 14, b: H - 46 };
    var pw = area.r - area.l, ph = area.b - area.t;
    var ax = Lab.draw.axes(ctx, area, [0, maxY], [0, maxY], { xLabel: 'Ingreso (Y)', yLabel: 'Gasto agregado (DA)' });
    var X = ax.X, Y = ax.Y;

    ctx.save();
    ctx.beginPath(); ctx.rect(area.l, area.t, pw, ph); ctx.clip();

    function line(a0, slope) {
      ctx.beginPath(); ctx.moveTo(X(0), Y(a0)); ctx.lineTo(X(maxY), Y(a0 + slope * maxY)); ctx.stroke();
    }

    // Recta de 45 grados: DA = Y.
    ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = col.muted;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(maxY), Y(maxY)); ctx.stroke();
    ctx.setLineDash([]);

    // Ensayos anteriores.
    trials.forEach(function (t) {
      var p = parts(t.inputs, c);
      ctx.lineWidth = t.control ? 2 : 1.5;
      ctx.strokeStyle = t.control ? col.accent : col.muted;
      ctx.globalAlpha = t.control ? 0.9 : 0.5;
      ctx.setLineDash(t.control ? [6, 4] : []);
      line(p.a0, p.slope);
    });
    ctx.globalAlpha = 1; ctx.setLineDash([]);

    // Gasto agregado actual.
    var cur = parts(v, c);
    ctx.lineWidth = 3; ctx.strokeStyle = col.primary;
    line(cur.a0, cur.slope);

    // Equilibrio.
    var ex = X(out.Y), ey = Y(out.Y);
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = col.fg;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex, Y(0)); ctx.moveTo(ex, ey); ctx.lineTo(X(0), ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col.accent;
    ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col.bg; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = col.fg;
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = ex > area.r - 110 ? 'right' : 'left';
    ctx.fillText('Equilibrio: Y* = ' + Lab.draw.fmt(out.Y, 0), ex + (ex > area.r - 110 ? -12 : 12), ey - 10);
    ctx.restore();

    ctx.fillStyle = col.primary;
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('— DA = gasto agregado', area.l + 8, area.t + 6);
    ctx.fillStyle = col.muted;
    ctx.fillText('- - DA = Y (45°)', area.l + 8, area.t + 22);
  }

  return { id: 'multiplicador', areaLabel: 'Economía', animated: false, model: model, parts: parts, draw: draw, describe: describe };
});
