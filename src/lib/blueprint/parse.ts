// Lector ESTRICTO de un borrador de plan. Un borrador llega del profesor (formulario) o de la IA (JSON): nada se acepta a ciegas. A diferencia de readGraph (que descarta lo corrupto y sigue),
// aqui se REPORTA todo lo que esta mal con su ruta ("periods[1].objectives[0].title"), porque un borrador a medias no se puede arreglar en silencio sin cambiar lo que el profesor quiso decir.
// Solo comprueba la FORMA (tipos, largos, limites, ids unicos); las reglas del plan (ponderaciones, cobertura, trazabilidad) estan en validate.ts.

import { BLUEPRINT_LIMITS as L, type Blueprint, type BlueprintModule, type BlueprintObjective, type Outcome, type ParseResult, type Period } from './types';

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_ERRORS = 30;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function normalizeText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
}

export function parseBlueprint(raw: unknown): ParseResult {
  const errors: string[] = [];
  const err = (path: string, msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(`${path}: ${msg}`);
  };
  if (!isObj(raw)) return { ok: false, errors: ['El plan debe ser un objeto.'] };

  const text = (v: unknown, path: string, max: number): string => {
    if (typeof v !== 'string') {
      err(path, 'debe ser texto.');
      return '';
    }
    const t = normalizeText(v);
    if (!t) err(path, 'no puede estar vacio.');
    else if (t.length > max) err(path, `no puede pasar de ${max} caracteres.`);
    return t;
  };
  const id = (v: unknown, path: string, seen: Set<string>): string => {
    if (typeof v !== 'string' || !ID_RE.test(v)) {
      err(path, `debe ser un identificador de 1 a ${L.idLength} letras, numeros, "_" o "-".`);
      return '';
    }
    if (seen.has(v)) err(path, `el identificador "${v}" esta repetido.`);
    seen.add(v);
    return v;
  };
  const order = (v: unknown, path: string, fallback: number): number => {
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      err(path, 'debe ser un entero de 0 en adelante.');
      return fallback;
    }
    return v;
  };
  const list = (v: unknown, path: string, max: number): unknown[] => {
    if (!Array.isArray(v)) {
      err(path, 'debe ser una lista.');
      return [];
    }
    if (v.length > max) {
      err(path, `no puede tener mas de ${max} elementos.`);
      return v.slice(0, max);
    }
    return v;
  };

  let version = 1;
  if (raw.version !== undefined) {
    if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) err('version', 'debe ser un entero de 1 en adelante.');
    else version = raw.version;
  }

  const outcomeIds = new Set<string>();
  const outcomes: Outcome[] = list(raw.outcomes, 'outcomes', L.outcomes).map((o, i): Outcome => {
    const p = `outcomes[${i}]`;
    if (!isObj(o)) {
      err(p, 'debe ser un objeto.');
      return { id: '', statement: '' };
    }
    return { id: id(o.id, `${p}.id`, outcomeIds), statement: text(o.statement, `${p}.statement`, L.statement) };
  });

  const periodIds = new Set<string>();
  const unitIds = new Set<string>(); // objetivos y modulos comparten espacio de ids: una referencia nunca es ambigua
  const periods: Period[] = list(raw.periods, 'periods', L.periods).map((pr, pi): Period => {
    const pp = `periods[${pi}]`;
    if (!isObj(pr)) {
      err(pp, 'debe ser un objeto.');
      return { id: '', name: '', order: pi + 1, weight: 0, assessesOutcomeIds: [], objectives: [] };
    }
    const weight = typeof pr.weight === 'number' && Number.isFinite(pr.weight) ? pr.weight : (err(`${pp}.weight`, 'debe ser un numero.'), 0);
    const assessed = list(pr.assessesOutcomeIds, `${pp}.assessesOutcomeIds`, L.outcomes).filter((x, xi): x is string => {
      if (typeof x !== 'string') err(`${pp}.assessesOutcomeIds[${xi}]`, 'debe ser un identificador.');
      return typeof x === 'string';
    });
    const objectives: BlueprintObjective[] = list(pr.objectives, `${pp}.objectives`, L.objectivesPerPeriod).map((ob, oi): BlueprintObjective => {
      const op = `${pp}.objectives[${oi}]`;
      if (!isObj(ob)) {
        err(op, 'debe ser un objeto.');
        return { id: '', title: '', outcomeIds: [], modules: [] };
      }
      const oids = list(ob.outcomeIds, `${op}.outcomeIds`, L.outcomes).filter((x, xi): x is string => {
        if (typeof x !== 'string') err(`${op}.outcomeIds[${xi}]`, 'debe ser un identificador.');
        return typeof x === 'string';
      });
      const modules: BlueprintModule[] = list(ob.modules, `${op}.modules`, L.modulesPerObjective).map((m, mi): BlueprintModule => {
        const mp = `${op}.modules[${mi}]`;
        if (!isObj(m)) {
          err(mp, 'debe ser un objeto.');
          return { id: '', title: '', order: mi + 1 };
        }
        return { id: id(m.id, `${mp}.id`, unitIds), title: text(m.title, `${mp}.title`, L.title), order: order(m.order, `${mp}.order`, mi + 1) };
      });
      return { id: id(ob.id, `${op}.id`, unitIds), title: text(ob.title, `${op}.title`, L.title), outcomeIds: Array.from(new Set(oids)), modules: modules.sort((a, b) => a.order - b.order) };
    });
    return { id: id(pr.id, `${pp}.id`, periodIds), name: text(pr.name, `${pp}.name`, L.title), order: order(pr.order, `${pp}.order`, pi + 1), weight, assessesOutcomeIds: Array.from(new Set(assessed)), objectives };
  });

  if (errors.length > 0) return { ok: false, errors };
  const blueprint: Blueprint = { version, outcomes, periods: periods.sort((a, b) => a.order - b.order) };
  return { ok: true, blueprint };
}
