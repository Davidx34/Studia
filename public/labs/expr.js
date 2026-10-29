/* Evaluador de formulas y compilador de modelos declarativos de los laboratorios de Stud.ia.
 *
 * La IA (o el profesor) escribe un modelo como DATOS: variables, constantes, pasos intermedios, salidas y una escena, todos con formulas de texto ("x^a * y^(1-a)").
 * Este archivo las lee con un parser PROPIO (recursivo descendente) y las convierte en funciones de JavaScript ya escritas aqui: NO se usa eval ni se construye codigo
 * a partir del texto. Solo existen numeros, nombres declarados, operadores y una lista cerrada de funciones matematicas. Sin bucles, sin acceso a objetos ni a la pagina.
 * Acotado: largo maximo de la formula, numero de nodos y profundidad (no hay formula que cuelgue el navegador).
 *
 * Se usa en DOS lugares con el mismo codigo: en el servidor (para validar un modelo antes de mostrarlo) y dentro del laboratorio aislado (para calcularlo).
 * Archivo UMD: en el navegador queda en window.LabExpr; en las pruebas y el servidor se carga con require.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LabExpr = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = { chars: 240, nodes: 150, depth: 24, name: 24 };

  // Funciones permitidas: nombre -> [aridad minima, maxima, implementacion].
  var FNS = {
    abs: [1, 1, Math.abs], sqrt: [1, 1, Math.sqrt], cbrt: [1, 1, Math.cbrt], exp: [1, 1, Math.exp], ln: [1, 1, Math.log], log10: [1, 1, Math.log10], log2: [1, 1, Math.log2],
    sin: [1, 1, Math.sin], cos: [1, 1, Math.cos], tan: [1, 1, Math.tan], asin: [1, 1, Math.asin], acos: [1, 1, Math.acos], atan: [1, 1, Math.atan], atan2: [2, 2, Math.atan2],
    sinh: [1, 1, Math.sinh], cosh: [1, 1, Math.cosh], tanh: [1, 1, Math.tanh],
    floor: [1, 1, Math.floor], ceil: [1, 1, Math.ceil], round: [1, 1, Math.round], sign: [1, 1, Math.sign],
    min: [2, 4, Math.min], max: [2, 4, Math.max], pow: [2, 2, Math.pow], hypot: [2, 2, Math.hypot],
    mod: [2, 2, function (a, b) { return ((a % b) + b) % b; }],
    clamp: [3, 3, function (x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }],
    if: [3, 3, null], // evaluada de forma perezosa
  };
  var CONSTS = { pi: Math.PI, e: Math.E };
  // Nombre del parametro de las curvas de la escena (la t de x(t), y(t)).
  var PARAM = 'param';
  var RESERVED = Object.create(null);
  Object.keys(FNS).forEach(function (k) { RESERVED[k] = true; });
  Object.keys(CONSTS).forEach(function (k) { RESERVED[k] = true; });
  RESERVED[PARAM] = true;

  var ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;

  // ───────── tokens ─────────
  function tokenize(src) {
    var toks = [];
    var i = 0;
    var n = src.length;
    while (i < n) {
      var ch = src.charAt(i);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      var m;
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src.charAt(i + 1)))) {
        m = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
        // "2x" o "3(": multiplicacion implicita, no permitida (evita ambiguedades).
        var after = src.charAt(i + m[0].length);
        if (/[A-Za-z_(]/.test(after)) throw new Error('Falta el signo * después del número "' + m[0] + '" (escribe ' + m[0] + '*...).');
        toks.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        if (m[0].length > LIMITS.name) throw new Error('El nombre "' + m[0].slice(0, 12) + '…" es demasiado largo.');
        toks.push({ t: 'id', v: m[0] });
        i += m[0].length;
        continue;
      }
      var two = src.substr(i, 2);
      if (two === '<=' || two === '>=' || two === '==' || two === '!=' || two === '&&' || two === '||') { toks.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/^%(),<>!'.indexOf(ch) !== -1) { toks.push({ t: 'op', v: ch }); i++; continue; }
      throw new Error('Carácter no permitido en la fórmula: "' + ch + '".');
    }
    return toks;
  }

  // ───────── parser ─────────
  // Devuelve { ok: true, ast, idents } o { ok: false, error }.
  function parse(src) {
    if (typeof src !== 'string' || !src.trim()) return { ok: false, error: 'La fórmula está vacía.' };
    if (src.length > LIMITS.chars) return { ok: false, error: 'La fórmula es demasiado larga (máximo ' + LIMITS.chars + ' caracteres).' };
    var toks;
    try { toks = tokenize(src); } catch (e) { return { ok: false, error: e.message }; }
    var pos = 0;
    var nodes = 0;
    var depth = 0;
    var idents = [];

    function fail(msg) { throw new Error(msg); }
    function peek() { return toks[pos]; }
    function isOp(v) { var t = toks[pos]; return !!t && t.t === 'op' && t.v === v; }
    function next() { return toks[pos++]; }
    function expect(v) { if (!isOp(v)) fail('Se esperaba "' + v + '".'); pos++; }
    function node(o) { if (++nodes > LIMITS.nodes) fail('La fórmula es demasiado compleja (máximo ' + LIMITS.nodes + ' elementos). Divídela en pasos intermedios.'); return o; }
    function enter() { if (++depth > LIMITS.depth) fail('La fórmula tiene demasiados paréntesis anidados.'); }
    function leave() { depth--; }

    function parseOr() {
      var l = parseAnd();
      while (isOp('||')) { next(); l = node({ k: 'bin', op: '||', l: l, r: parseAnd() }); }
      return l;
    }
    function parseAnd() {
      var l = parseCmp();
      while (isOp('&&')) { next(); l = node({ k: 'bin', op: '&&', l: l, r: parseCmp() }); }
      return l;
    }
    function parseCmp() {
      var l = parseAdd();
      while (peek() && peek().t === 'op' && ['<', '<=', '>', '>=', '==', '!='].indexOf(peek().v) !== -1) { var op = next().v; l = node({ k: 'bin', op: op, l: l, r: parseAdd() }); }
      return l;
    }
    function parseAdd() {
      var l = parseMul();
      while (isOp('+') || isOp('-')) { var op = next().v; l = node({ k: 'bin', op: op, l: l, r: parseMul() }); }
      return l;
    }
    function parseMul() {
      var l = parseUnary();
      while (isOp('*') || isOp('/') || isOp('%')) { var op = next().v; l = node({ k: 'bin', op: op, l: l, r: parseUnary() }); }
      return l;
    }
    function parseUnary() {
      if (isOp('-') || isOp('+') || isOp('!')) {
        var op = next().v;
        enter();
        var a = parseUnary();
        leave();
        return op === '+' ? a : node({ k: 'un', op: op, a: a });
      }
      return parsePower();
    }
    // ^ asocia a la derecha y liga mas fuerte que el menos de la izquierda: -2^2 = -4, y 2^-1 = 0.5.
    function parsePower() {
      var base = parsePrimary();
      if (isOp('^')) { next(); enter(); var ex = parseUnary(); leave(); return node({ k: 'bin', op: '^', l: base, r: ex }); }
      return base;
    }
    function parsePrimary() {
      var t = next();
      if (!t) fail('La fórmula termina de forma inesperada.');
      if (t.t === 'num') return node({ k: 'num', v: t.v });
      if (t.t === 'id') {
        if (isOp('(')) {
          var spec = FNS[t.v];
          if (!spec || !Object.prototype.hasOwnProperty.call(FNS, t.v)) fail('La función "' + t.v + '" no existe. Disponibles: ' + Object.keys(FNS).join(', ') + '.');
          next();
          enter();
          var args = [];
          if (!isOp(')')) {
            args.push(parseOr());
            while (isOp(',')) { next(); args.push(parseOr()); }
          }
          expect(')');
          leave();
          if (args.length < spec[0] || args.length > spec[1]) fail('"' + t.v + '" necesita ' + (spec[0] === spec[1] ? spec[0] : spec[0] + ' a ' + spec[1]) + ' argumento(s).');
          return node({ k: 'call', name: t.v, args: args });
        }
        if (Object.prototype.hasOwnProperty.call(CONSTS, t.v)) return node({ k: 'num', v: CONSTS[t.v] });
        if (Object.prototype.hasOwnProperty.call(FNS, t.v)) fail('"' + t.v + '" es una función: escribe ' + t.v + '(...).');
        if (idents.indexOf(t.v) === -1) idents.push(t.v);
        return node({ k: 'id', name: t.v });
      }
      if (t.v === '(') { enter(); var e = parseOr(); expect(')'); leave(); return e; }
      return fail('Símbolo inesperado: "' + t.v + '".');
    }

    try {
      var ast = parseOr();
      if (pos < toks.length) fail('Sobra algo al final de la fórmula: "' + toks[pos].v + '".');
      return { ok: true, ast: ast, idents: idents };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ───────── compilacion a closures (sin eval) ─────────
  function build(n) {
    switch (n.k) {
      case 'num': { var v = n.v; return function () { return v; }; }
      case 'id': { var name = n.name; return function (env) { return env[name]; }; }
      case 'un': {
        var a = build(n.a);
        return n.op === '-' ? function (env) { return -a(env); } : function (env) { return a(env) ? 0 : 1; };
      }
      case 'bin': {
        var l = build(n.l), r = build(n.r);
        switch (n.op) {
          case '+': return function (env) { return l(env) + r(env); };
          case '-': return function (env) { return l(env) - r(env); };
          case '*': return function (env) { return l(env) * r(env); };
          case '/': return function (env) { return l(env) / r(env); };
          case '%': return function (env) { var d = r(env); return l(env) % d; };
          case '^': return function (env) { return Math.pow(l(env), r(env)); };
          case '<': return function (env) { return l(env) < r(env) ? 1 : 0; };
          case '<=': return function (env) { return l(env) <= r(env) ? 1 : 0; };
          case '>': return function (env) { return l(env) > r(env) ? 1 : 0; };
          case '>=': return function (env) { return l(env) >= r(env) ? 1 : 0; };
          case '==': return function (env) { return l(env) === r(env) ? 1 : 0; };
          case '!=': return function (env) { return l(env) !== r(env) ? 1 : 0; };
          case '&&': return function (env) { return l(env) && r(env) ? 1 : 0; };
          default: return function (env) { return l(env) || r(env) ? 1 : 0; };
        }
      }
      default: {
        var args = n.args.map(build);
        if (n.name === 'if') return function (env) { return args[0](env) ? args[1](env) : args[2](env); };
        var impl = FNS[n.name][2];
        if (args.length === 1) return function (env) { return impl(args[0](env)); };
        if (args.length === 2) return function (env) { return impl(args[0](env), args[1](env)); };
        return function (env) { var vals = []; for (var i = 0; i < args.length; i++) vals.push(args[i](env)); return impl.apply(null, vals); };
      }
    }
  }

  // Compila una formula. `allowed`: nombres que pueden aparecer (variables, constantes, pasos previos...). Devuelve { ok, fn(env) } o { ok:false, error }.
  function compile(src, allowed) {
    var p = parse(src);
    if (!p.ok) return p;
    var ok = Object.create(null);
    (allowed || []).forEach(function (a) { ok[a] = true; });
    for (var i = 0; i < p.idents.length; i++) {
      if (!ok[p.idents[i]]) return { ok: false, error: 'El nombre "' + p.idents[i] + '" no está declarado. Usa solo: ' + ((allowed || []).join(', ') || '(ninguno)') + '.' };
    }
    return { ok: true, fn: build(p.ast), idents: p.idents };
  }

  // ───────── modelos declarativos ─────────
  // model: { variables:[{id}], constants:[{id}], derived:[{id,expr}], outputs:[{id,expr}], scene?:{ curves:[...], points:[...] } }
  // Las formulas de `derived` y `outputs` solo ven lo declarado ANTES (variables, constantes y los pasos/salidas anteriores): no hay ciclos posibles.
  function compileModel(model) {
    var errors = [];
    var names = [];
    var seen = Object.create(null);
    function declare(id, where) {
      if (typeof id !== 'string' || !ID_RE.test(id)) { errors.push(where + ': el id "' + String(id) + '" no es válido (letras y números, empieza por letra, máximo 24).'); return false; }
      if (RESERVED[id]) { errors.push(where + ': "' + id + '" es una palabra reservada (función, constante o "' + PARAM + '").'); return false; }
      if (seen[id]) { errors.push(where + ': el nombre "' + id + '" está repetido.'); return false; }
      seen[id] = true;
      names.push(id);
      return true;
    }
    (model.variables || []).forEach(function (v) { declare(v.id, 'Variable'); });
    (model.constants || []).forEach(function (c) { declare(c.id, 'Constante'); });

    var steps = [];
    (model.derived || []).forEach(function (d) {
      var c = compile(d.expr, names);
      if (!c.ok) errors.push('Paso "' + d.id + '": ' + c.error);
      else steps.push({ id: d.id, fn: c.fn, kind: 'derived' });
      declare(d.id, 'Paso');
    });
    var outs = [];
    (model.outputs || []).forEach(function (o) {
      var c = compile(o.expr, names);
      if (!c.ok) errors.push('Salida "' + o.id + '": ' + c.error);
      else outs.push({ id: o.id, fn: c.fn });
      declare(o.id, 'Salida');
    });

    // Escena: las formulas ven todo lo declarado mas el parametro.
    var sceneNames = names.concat([PARAM]);
    var scene = { xLabel: '', yLabel: '', curves: [], points: [] };
    var sc = model.scene;
    if (sc) {
      scene.xLabel = sc.xLabel || '';
      scene.yLabel = sc.yLabel || '';
      (sc.curves || []).forEach(function (cv, i) {
        var where = 'Curva ' + (i + 1);
        if (cv.kind === 'sweep') {
          if (!seen[cv.output]) errors.push(where + ': la salida "' + String(cv.output) + '" no existe.');
          scene.curves.push({ kind: 'sweep', label: cv.label || '', dashed: !!cv.dashed, output: cv.output });
          return;
        }
        var fx = compile(cv.x, sceneNames), fy = compile(cv.y, sceneNames), f0 = compile(cv.from, names), f1 = compile(cv.to, names);
        [['x', fx], ['y', fy], ['from', f0], ['to', f1]].forEach(function (p) { if (!p[1].ok) errors.push(where + ' (' + p[0] + '): ' + p[1].error); });
        if (fx.ok && fy.ok && f0.ok && f1.ok) scene.curves.push({ kind: 'param', label: cv.label || '', dashed: !!cv.dashed, x: fx.fn, y: fy.fn, from: f0.fn, to: f1.fn });
      });
      (sc.points || []).forEach(function (pt, i) {
        var where = 'Punto ' + (i + 1);
        var fx = compile(pt.x, names), fy = compile(pt.y, names);
        if (!fx.ok) errors.push(where + ' (x): ' + fx.error);
        if (!fy.ok) errors.push(where + ' (y): ' + fy.error);
        if (fx.ok && fy.ok) scene.points.push({ label: pt.label || '', x: fx.fn, y: fy.fn });
      });
    }
    if (errors.length) return { ok: false, errors: errors };

    // run: valores de variables y constantes -> todo el entorno (incluye pasos y salidas).
    function run(values, constants) {
      var env = Object.create(null);
      var k;
      for (k in values) if (Object.prototype.hasOwnProperty.call(values, k)) env[k] = values[k];
      for (k in constants) if (Object.prototype.hasOwnProperty.call(constants, k)) env[k] = constants[k];
      steps.forEach(function (s) { env[s.id] = s.fn(env); });
      outs.forEach(function (o) { env[o.id] = o.fn(env); });
      return env;
    }
    return { ok: true, run: run, scene: scene, outputIds: outs.map(function (o) { return o.id; }), param: PARAM };
  }

  return { LIMITS: LIMITS, FUNCTIONS: Object.keys(FNS), PARAM: PARAM, RESERVED: Object.keys(RESERVED), ID_RE: ID_RE, parse: parse, compile: compile, compileModel: compileModel };
});
