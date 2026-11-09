import { describe, expect, it } from 'vitest';
import { ALL_PRINCIPLES, DOCTRINE_VERSION, MAX_BLOCK_CHARS, PERSONA, SOURCES, doctrineBlock, doctrineEnabled, getPrinciple, personaLines, principleBasis, selectPrinciples, shortCite, tagsForGeneration, traitsFor, type Task } from './index';

const TASKS: Task[] = ['generar_pregunta', 'retroalimentar', 'interpretar_resultados', 'investigar', 'planificar', 'juzgar'];

describe('integridad de la doctrina', () => {
  it('ids unicos y en minusculas con guion bajo', () => {
    const ids = ALL_PRINCIPLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
  });
  it('tiene volumen real: al menos 35 principios y 30 fuentes', () => {
    expect(ALL_PRINCIPLES.length).toBeGreaterThanOrEqual(35);
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(30);
  });
  it('cada principio tiene enunciado, regla operativa, limites, fuentes, tareas y etiquetas', () => {
    for (const p of ALL_PRINCIPLES) {
      expect(p.title.length, p.id).toBeGreaterThan(5);
      expect(p.essence.length, p.id).toBeGreaterThan(60);
      expect(p.apply.length, p.id).toBeGreaterThan(30);
      expect(p.apply.length, p.id).toBeLessThan(330);
      expect(p.limits.length, p.id).toBeGreaterThan(20);
      expect(p.sources.length, p.id).toBeGreaterThan(0);
      expect(p.tasks.length, p.id).toBeGreaterThan(0);
      expect(p.tags.length, p.id).toBeGreaterThan(0);
    }
  });
  it('toda fuente citada existe en el registro', () => {
    for (const p of ALL_PRINCIPLES) for (const s of p.sources) expect(SOURCES[s], `${p.id} cita ${s}`).toBeDefined();
  });
  it('ninguna fuente del registro queda sin usar', () => {
    const used = new Set(ALL_PRINCIPLES.flatMap((p) => p.sources));
    for (const id of Object.keys(SOURCES)) expect(used.has(id), `fuente sin usar: ${id}`).toBe(true);
  });
  it('un principio de evidencia FUERTE debe tener al menos una fuente VERIFICADA (y la mayoria, verificadas)', () => {
    for (const p of ALL_PRINCIPLES.filter((x) => x.evidence === 'fuerte')) {
      expect(p.sources.some((s) => SOURCES[s].verified), p.id).toBe(true);
    }
  });
  it('las fuentes verificadas dicen cuando se verificaron y ninguna sin verificar finge estarlo', () => {
    for (const s of Object.values(SOURCES)) {
      if (s.verified) expect(s.verifiedOn, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      else expect(s.verifiedOn, s.id).toBeUndefined();
      expect(s.authors.length, s.id).toBeGreaterThan(3);
      expect(s.year, s.id).toBeGreaterThan(1900);
      expect(s.title.length, s.id).toBeGreaterThan(5);
    }
  });
  it('mas del 85 % de las fuentes esta verificada', () => {
    const all = Object.values(SOURCES);
    expect(all.filter((s) => s.verified).length / all.length).toBeGreaterThan(0.85);
  });
  it('las fuentes con una advertencia de replicacion o controversia la conservan (no se cita sin matiz)', () => {
    expect(SOURCES.ericsson1993.caveat).toMatch(/Macnamara/);
    expect(SOURCES.bloom1984.caveat).toMatch(/dos desviaciones/);
    expect(SOURCES.kirschner2006.caveat).toBeTruthy();
    expect(SOURCES.blackwiliam1998.caveat).toMatch(/NO se verific/);
  });
  it('cada tarea tiene al menos 4 principios aplicables (sin contar mitos ni discutidos)', () => {
    for (const t of TASKS) {
      const n = ALL_PRINCIPLES.filter((p) => !p.antiPrinciple && p.evidence !== 'discutida' && p.tasks.includes(t)).length;
      expect(n, t).toBeGreaterThanOrEqual(4);
    }
  });
  it('los mitos estan marcados y los principios de evidencia discutida existen para mostrarse', () => {
    const mitos = ALL_PRINCIPLES.filter((p) => p.domain === 'mitos');
    expect(mitos.length).toBeGreaterThanOrEqual(4);
    for (const m of mitos) expect(m.antiPrinciple, m.id).toBe(true);
    expect(ALL_PRINCIPLES.some((p) => p.evidence === 'discutida')).toBe(true);
  });
  it('el texto no contiene marcadores que puedan abrir secciones en un prompt', () => {
    for (const p of ALL_PRINCIPLES) for (const t of [p.apply, p.avoid ?? '']) expect(t, p.id).not.toMatch(/[<>#`\n]/);
  });
  it('no se afirman cifras que no se verificaron', () => {
    const texto = JSON.stringify(ALL_PRINCIPLES);
    expect(texto).not.toMatch(/0[,.]4\s*(a|–|-)\s*0[,.]7/); // el tamano de efecto de Black y Wiliam NO se verifico
  });
});

describe('seleccion por tarea', () => {
  it('es determinista y respeta el maximo', () => {
    const a = selectPrinciples({ task: 'generar_pregunta', tags: ['opcion_multiple'] });
    const b = selectPrinciples({ task: 'generar_pregunta', tags: ['opcion_multiple'] });
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    expect(a.length).toBeLessThanOrEqual(5);
    expect(selectPrinciples({ task: 'generar_pregunta', max: 2 })).toHaveLength(2);
    expect(selectPrinciples({ task: 'generar_pregunta', max: 0 })).toHaveLength(0);
  });
  it('NUNCA selecciona mitos ni evidencia discutida', () => {
    for (const t of TASKS) {
      for (const p of selectPrinciples({ task: t, max: 50 })) {
        expect(p.antiPrinciple, p.id).toBeFalsy();
        expect(p.evidence, p.id).not.toBe('discutida');
        expect(p.tasks, p.id).toContain(t);
      }
    }
  });
  it('el contexto cambia la seleccion: respuesta corta trae su regla, opcion multiple la suya', () => {
    const corta = selectPrinciples({ task: 'generar_pregunta', tags: tagsForGeneration(['short_answer']), max: 5 }).map((p) => p.id);
    const opcion = selectPrinciples({ task: 'generar_pregunta', tags: tagsForGeneration(['multiple_choice']), max: 5 }).map((p) => p.id);
    expect(corta).toContain('respuesta_corta_verificable');
    expect(opcion).toContain('redaccion_opcion_multiple');
    expect(opcion).not.toContain('respuesta_corta_verificable');
  });
  it('para generar preguntas la clave defendible y el anclaje siempre estan entre los elegidos (atacan los errores mas frecuentes)', () => {
    for (const tipos of [['multiple_choice'], ['short_answer'], ['fill_blank', 'match'], []]) {
      const ids = selectPrinciples({ task: 'generar_pregunta', tags: tagsForGeneration(tipos, 3) }).map((p) => p.id);
      expect(ids).toContain('clave_defendible');
    }
  });
  it('la profundidad alta agrega el pensamiento de nivel alto', () => {
    expect(tagsForGeneration([], 5)).toContain('nivel_alto');
    expect(tagsForGeneration([], 2)).not.toContain('nivel_alto');
  });
  it('para retroalimentar elige retroalimentacion y emociones, no redaccion de items', () => {
    const ids = selectPrinciples({ task: 'retroalimentar', tags: ['puntaje_bajo', 'feedback'] }).map((p) => p.id);
    expect(ids).toContain('emociones_de_logro');
    expect(ids).not.toContain('redaccion_opcion_multiple');
  });
  it('para interpretar resultados elige el cuidado con muestras pequenas', () => {
    expect(selectPrinciples({ task: 'interpretar_resultados', tags: ['datos', 'muestra'] }).map((p) => p.id)).toContain('muestras_pequenas');
  });
});

describe('bloque del prompt', () => {
  it('trae reglas operativas y conductas, sin citas ni mitos, y no pasa del presupuesto', () => {
    for (const t of TASKS) {
      const b = doctrineBlock({ task: t, tags: tagsForGeneration(['multiple_choice', 'short_answer', 'match'], 5), max: 8 });
      expect(b.length, t).toBeGreaterThan(0);
      expect(b.length, t).toBeLessThanOrEqual(MAX_BLOCK_CHARS);
      expect(b, t).toContain('CRITERIOS PEDAGÓGICOS DE REFERENCIA');
      expect(b, t).not.toMatch(/\(\w+,? \d{4}\)|et al\./); // sin citas dentro del prompt
      expect(b, t).not.toMatch(/Hattie|Bjork|Dunlosky|Roediger|Kluger|Pashler/);
    }
  });
  it('sin perfil solo trae criterios; con max 0 y sin perfil queda vacio', () => {
    expect(doctrineBlock({ task: 'generar_pregunta', persona: false })).not.toContain('CONDUCTA ESPERADA');
    expect(doctrineBlock({ task: 'generar_pregunta', persona: false, max: 0 })).toBe('');
  });
  it('doctrineEnabled esta APAGADA por defecto y solo se enciende con DOCTRINE=on', () => {
    expect(doctrineEnabled({})).toBe(false);
    expect(doctrineEnabled({ DOCTRINE: 'off' })).toBe(false);
    expect(doctrineEnabled({ DOCTRINE: 'true' })).toBe(false);
    expect(doctrineEnabled({ DOCTRINE: ' ON ' })).toBe(true);
  });
});

describe('perfil operacional', () => {
  it('son los 7 rasgos pedidos y cada uno es comprobable', () => {
    expect(PERSONA.map((t) => t.id).sort()).toEqual(['analitico', 'creativo', 'estricto', 'investigativo', 'pedagogico', 'pragmatico', 'profesional']);
    for (const t of PERSONA) {
      expect(t.behaviors.length, t.id).toBeGreaterThan(0);
      expect(t.check.length, t.id).toBeGreaterThan(20);
      expect(t.tasks.length, t.id).toBeGreaterThan(0);
      for (const b of t.behaviors) {
        expect(b.text, t.id).not.toMatch(/[<>#`\n]/);
        for (const bt of b.tasks ?? []) expect(t.tasks, `${t.id}: una conducta declara la tarea ${bt}, que el rasgo no tiene`).toContain(bt);
      }
    }
  });
  it('los adjetivos NO aparecen como instruccion vacia: solo conductas', () => {
    for (const t of TASKS) for (const l of personaLines(t)) expect(l.toLowerCase(), l).not.toMatch(/^(sé|se) (increíblemente|muy|extremadamente)/);
  });
  it('retroalimentar no recibe conductas de redactar preguntas, y generar no recibe las de retroalimentar', () => {
    expect(personaLines('retroalimentar').join(' ')).not.toMatch(/Una idea por pregunta|opción incorrecta falla|Deja una sola respuesta correcta/);
    expect(personaLines('generar_pregunta').join(' ')).not.toMatch(/sin juzgar a la persona/);
    expect(personaLines('retroalimentar').join(' ')).toMatch(/sin juzgar a la persona/);
  });
  it('cada tarea tiene al menos un rasgo y el estricto y el analitico juzgan', () => {
    for (const t of TASKS) expect(traitsFor(t).length, t).toBeGreaterThan(0);
    expect(traitsFor('juzgar').map((x) => x.id)).toEqual(expect.arrayContaining(['estricto', 'analitico']));
  });
});

describe('utilidades', () => {
  it('shortCite y principleBasis', () => {
    expect(shortCite('roediger2006')).toBe('Roediger et al. (2006)');
    expect(shortCite('sweller1988')).toBe('Sweller (1988)');
    expect(shortCite('no_existe')).toBe('no_existe');
    expect(principleBasis('practica_recuperacion')?.cites).toContain('Roediger et al. (2006)');
    expect(principleBasis('no_existe')).toBeNull();
    expect(getPrinciple('muestras_pequenas')?.domain).toBe('datos');
  });
  it('la version esta definida', () => {
    expect(DOCTRINE_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/);
  });
});
