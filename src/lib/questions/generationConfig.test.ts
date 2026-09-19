import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  resolveConfig,
  resolveMinigames,
  allowedTypeSet,
  enforceAllowedTypes,
  buildGenerationPrompt,
  remediationPreamble,
  type AiConfigRow,
} from './generationConfig';
import { ALL_MINIGAME_IDS, MAX_MINIGAMES_PER_BATCH } from './minigameCatalog';

// Prompt para una fila de configuracion. Los minijuegos se resuelven igual que
// en los generadores reales: lista de la clase, sin eleccion por modulo, azar fijo.
function promptFor(row: AiConfigRow | null, moduleChosen?: string[]) {
  const config = resolveConfig(row);
  const minigames = resolveMinigames({ classAllowed: config.allowedMinigames, moduleChosen, rng: () => 0 });
  return buildGenerationPrompt({ config, moduleTitle: 'Tema X', context: 'material', classicCount: 6, minigames }).prompt;
}

// ---------------------------------------------------------------------------
// CONTRATO: cada columna de classroom_ai_config o influye en el prompt, o esta
// declarada como ignorada con su motivo. Si alguien agrega una columna y no
// decide que hacer con ella, este test falla.
//
// Auditoria del 2026-09-19: tres campos que el profesor veia o podia guardar no
// llegaban a NINGUNO de los dos generadores (learning_objectives, type_order,
// question_style). El profesor los llenaba sin efecto alguno.
// ---------------------------------------------------------------------------

const META = new Set(['id', 'classroom_id', 'teacher_id', 'created_at', 'updated_at']);

const IGNORED: Record<string, string> = {
  type_order:
    'No existe un tipo de pregunta "ordenar": el orden lo cubre el minijuego linea_del_tiempo. La casilla se quito de la pantalla.',
  question_style:
    'Sin pantalla que la edite y sin significado definido (siempre "mixed"). Se conserva la columna por compatibilidad.',
};

// [columna, valor que la enciende, texto que debe aparecer en el prompt]
const TEXT_FIELDS: [string, string, string][] = [
  ['subject_description', 'Ciencias Sociales del Caribe', 'MATERIA: Ciencias Sociales del Caribe'],
  ['grade_level_detail', '5to grado, Colombia', 'GRADO: 5to grado, Colombia'],
  ['learning_objectives', 'Comparar civilizaciones antiguas', 'OBJETIVOS DE APRENDIZAJE DE LA CLASE: Comparar civilizaciones antiguas'],
  ['language_level', 'advanced', 'NIVEL DE LENGUAJE: advanced'],
  ['custom_instructions', 'Usar ejemplos colombianos', 'INSTRUCCIONES ESPECIALES: Usar ejemplos colombianos'],
  ['example_good_question', 'Que causo la caida de Roma?', 'EJEMPLO DE PREGUNTA IDEAL: Que causo la caida de Roma?'],
  ['example_bad_question', 'Define civilizacion', 'PREGUNTA A EVITAR: Define civilizacion'],
  ['topics_emphasize', 'rutas comerciales', 'TEMAS A ENFATIZAR: rutas comerciales'],
  ['topics_avoid', 'guerras modernas', 'TEMAS A EVITAR: guerras modernas'],
];

const SKILL_FLAGS: [string, string][] = [
  ['skill_memory', 'recordar hechos'],
  ['skill_comprehension', 'comprender conceptos'],
  ['skill_application', 'aplicar conocimiento'],
  ['skill_analysis', 'analizar y descomponer'],
  ['skill_synthesis', 'sintetizar ideas'],
  ['skill_evaluation', 'evaluar criticamente'],
];

const TYPE_FLAGS: [string, string][] = [
  ['type_multiple_choice', 'de tipo "opcion_multiple"'],
  ['type_true_false', 'de tipo "verdadero_falso"'],
  ['type_fill_blank', 'de tipo "completar_frase"'],
  ['type_match', 'de tipo "conectar_conceptos"'],
  ['type_short_answer', 'de tipo "respuesta_corta"'],
];

function classroomAiConfigColumns(): string[] {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/types/database.generated.ts'), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('classroom_ai_config: {\n        Row: {');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n        }', start);
  return Array.from(src.slice(start, end).matchAll(/^\s{10}(\w+)\??:/gm)).map((m) => m[1]);
}

describe('contrato: cada columna de classroom_ai_config se usa o se declara ignorada', () => {
  const columns = classroomAiConfigColumns();

  it('lee las columnas reales de la tabla, incluida la nueva de minijuegos', () => {
    expect(columns.length).toBeGreaterThanOrEqual(24);
    expect(columns).toContain('minigame_types');
  });

  it('ninguna columna queda sin decidir', () => {
    const covered = new Set([
      ...Array.from(META),
      ...Object.keys(IGNORED),
      ...TEXT_FIELDS.map(([k]) => k),
      ...SKILL_FLAGS.map(([k]) => k),
      ...TYPE_FLAGS.map(([k]) => k),
      'question_depth',
      'minigame_types',
    ]);
    const sinDecidir = columns.filter((c) => !covered.has(c));
    expect(sinDecidir, `columnas sin conectar al generador ni declarar como ignoradas: ${sinDecidir.join(', ')}`).toEqual([]);
  });

  it('lo que se declara ignorado o cubierto existe de verdad en la tabla (sin entradas obsoletas)', () => {
    const inTable = new Set(columns);
    for (const k of [...Object.keys(IGNORED), ...TEXT_FIELDS.map(([k]) => k), ...SKILL_FLAGS.map(([k]) => k), ...TYPE_FLAGS.map(([k]) => k)]) {
      expect(inTable.has(k), `${k} ya no esta en la tabla`).toBe(true);
    }
  });

  describe.each(TEXT_FIELDS)('%s', (field, value, marker) => {
    it('llega al prompt cuando tiene valor', () => {
      expect(promptFor({ [field]: value } as AiConfigRow)).toContain(marker);
    });
    it('no deja una linea vacia cuando esta en blanco', () => {
      const p = promptFor({ [field]: '' } as AiConfigRow);
      expect(p).not.toContain(marker);
      if (field !== 'subject_description' && field !== 'grade_level_detail' && field !== 'language_level') {
        expect(p).not.toContain(marker.split(':')[0] + ':');
      }
    });
  });

  describe.each(SKILL_FLAGS)('%s', (flag, label) => {
    // Base: todas apagadas menos una distinta, para probar encendido Y apagado.
    const otra = SKILL_FLAGS.find(([k]) => k !== flag)![0];
    const base = Object.fromEntries(SKILL_FLAGS.map(([k]) => [k, k === otra])) as AiConfigRow;
    it('aparece en HABILIDADES A EVALUAR al encenderlo', () => {
      expect(promptFor({ ...base, [flag]: true })).toMatch(new RegExp(`HABILIDADES A EVALUAR:.*${label}`));
    });
    it('desaparece al apagarlo', () => {
      expect(promptFor({ ...base, [flag]: false })).not.toContain(label);
    });
  });

  describe.each(TYPE_FLAGS)('%s', (flag, marker) => {
    const otro = TYPE_FLAGS.find(([k]) => k !== flag)![0];
    const base = Object.fromEntries(TYPE_FLAGS.map(([k]) => [k, k === otro])) as AiConfigRow;
    it('se pide al generador al encenderlo', () => {
      expect(promptFor({ ...base, [flag]: true })).toContain(marker);
    });
    it('NO se pide al apagarlo', () => {
      expect(promptFor({ ...base, [flag]: false })).not.toContain(marker);
    });
  });

  it('question_depth llega al prompt', () => {
    expect(promptFor({ question_depth: 5 })).toContain('NIVEL DE PROFUNDIDAD: 5/5');
    expect(promptFor({ question_depth: 1 })).toContain('NIVEL DE PROFUNDIDAD: 1/5');
  });

  it('minigame_types decide que minijuegos se piden', () => {
    const p = promptFor({ minigame_types: ['linea_del_tiempo'] });
    expect(p).toContain('"linea_del_tiempo"');
    expect(p).not.toContain('"cuarto_crisis"');
    expect(p).not.toContain('"impostor_cognitivo"');
  });
});

describe('resolveConfig', () => {
  it('una clase SIN fila usa los valores por defecto de la base (cuatro tipos base), no solo opcion multiple', () => {
    const c = resolveConfig(null);
    expect(c.classicTypes.map((t) => t.jsonType)).toEqual(['multiple_choice', 'true_false', 'fill_blank', 'match']);
    expect(c.skills).toEqual(['recordar hechos', 'comprender conceptos', 'aplicar conocimiento']);
    expect(c.depth).toBe(3);
    expect(c.languageLevel).toBe('intermediate');
  });

  it('sin fila o sin valor, todos los minijuegos estan permitidos (comportamiento anterior)', () => {
    expect(resolveConfig(null).allowedMinigames).toEqual([...ALL_MINIGAME_IDS]);
    expect(resolveConfig({ minigame_types: null } as any).allowedMinigames).toEqual([...ALL_MINIGAME_IDS]);
  });

  it('un arreglo VACIO significa "sin minijuegos" y se respeta', () => {
    expect(resolveConfig({ minigame_types: [] }).allowedMinigames).toEqual([]);
  });

  it('descarta identificadores desconocidos y repetidos', () => {
    expect(resolveConfig({ minigame_types: ['linea_del_tiempo', 'inventado', 'linea_del_tiempo'] }).allowedMinigames).toEqual(['linea_del_tiempo']);
  });

  it('si el profesor apago todos los tipos base, queda opcion multiple en vez de un prompt sin tipos', () => {
    const c = resolveConfig({
      type_multiple_choice: false, type_true_false: false, type_fill_blank: false, type_match: false, type_short_answer: false,
    });
    expect(c.classicTypes).toEqual([{ promptName: 'opcion_multiple', jsonType: 'multiple_choice' }]);
  });

  it('un booleano null en la fila cae al valor por defecto', () => {
    expect(resolveConfig({ type_true_false: null } as any).classicTypes.map((t) => t.jsonType)).toContain('true_false');
  });
});

describe('resolveMinigames', () => {
  const clase = ['linea_del_tiempo', 'categorias_rapidas', 'flashcard_rapida'];

  it('sin minijuegos permitidos en la clase, ninguno: aunque el modulo pida alguno', () => {
    expect(resolveMinigames({ classAllowed: [], moduleChosen: ['cuarto_crisis'] })).toEqual([]);
    expect(resolveMinigames({ classAllowed: [] })).toEqual([]);
  });

  it('con eleccion por modulo, usa esa lista recortada a lo que la clase permite', () => {
    expect(resolveMinigames({ classAllowed: clase, moduleChosen: ['linea_del_tiempo', 'cuarto_crisis'] })).toEqual(['linea_del_tiempo']);
  });

  it('si todo lo que el modulo eligio esta desactivado en la clase, no hay minijuegos (la clase gana)', () => {
    expect(resolveMinigames({ classAllowed: clase, moduleChosen: ['cuarto_crisis'] })).toEqual([]);
  });

  it('sin eleccion por modulo, sortea SOLO entre los permitidos y como mucho el maximo', () => {
    for (let i = 0; i < 50; i++) {
      const r = resolveMinigames({ classAllowed: clase });
      expect(r.length).toBeLessThanOrEqual(MAX_MINIGAMES_PER_BATCH);
      for (const id of r) expect(clase).toContain(id);
      expect(new Set(r).size).toBe(r.length);
    }
  });

  it('con menos permitidos que el maximo, devuelve los que hay', () => {
    expect(resolveMinigames({ classAllowed: ['linea_del_tiempo'] })).toEqual(['linea_del_tiempo']);
  });

  it('una eleccion de modulo basura se trata como "sin eleccion"', () => {
    const r = resolveMinigames({ classAllowed: clase, moduleChosen: ['inventado'] as any });
    expect(r.every((id) => clase.includes(id))).toBe(true);
    expect(r.length).toBeGreaterThan(0);
  });
});

describe('allowedTypeSet y enforceAllowedTypes', () => {
  it('una pregunta cuyo tipo la configuracion no permite se descarta', () => {
    const config = resolveConfig({ type_true_false: false, minigame_types: ['linea_del_tiempo'] });
    const allowed = allowedTypeSet(config);
    const { kept, dropped } = enforceAllowedTypes(
      [{ type: 'multiple_choice' }, { type: 'true_false' }, { type: 'linea_del_tiempo' }, { type: 'cuarto_crisis' }, { type: undefined }],
      allowed
    );
    expect(kept.map((q) => q.type)).toEqual(['multiple_choice', 'linea_del_tiempo']);
    expect(dropped.map((q) => q.type)).toEqual(['true_false', 'cuarto_crisis', undefined]);
  });

  it('con minijuegos desactivados en la clase no pasa ninguno', () => {
    const allowed = allowedTypeSet(resolveConfig({ minigame_types: [] }));
    for (const id of ALL_MINIGAME_IDS) expect(allowed.has(id)).toBe(false);
  });
});

describe('buildGenerationPrompt', () => {
  it('pide la cantidad exacta: tipos base mas minijuegos', () => {
    const config = resolveConfig({ minigame_types: ['linea_del_tiempo', 'categorias_rapidas'] });
    const built = buildGenerationPrompt({ config, moduleTitle: 'T', context: 'c', classicCount: 10, minigames: ['linea_del_tiempo', 'categorias_rapidas'] });
    expect(built.total).toBe(12);
    expect(built.prompt).toContain('Genera EXACTAMENTE 12 preguntas');
  });

  it('las reglas de minijuego incluyen SOLO los pedidos, no los ocho', () => {
    const config = resolveConfig(null);
    const { prompt } = buildGenerationPrompt({ config, moduleTitle: 'T', context: 'c', classicCount: 5, minigames: ['linea_del_tiempo'] });
    expect(prompt).toContain('- linea_del_tiempo: "items" debe tener');
    for (const otro of ALL_MINIGAME_IDS.filter((i) => i !== 'linea_del_tiempo')) {
      expect(prompt).not.toContain(`- ${otro}:`);
    }
  });

  it('las reglas de un tipo base apagado no se incluyen', () => {
    const conMatch = promptFor({ type_match: true });
    const sinMatch = promptFor({ type_match: false });
    expect(conMatch).toContain('- match: "pairs" debe tener');
    expect(sinMatch).not.toContain('- match: "pairs" debe tener');
  });

  it('lista explicitamente los tipos permitidos', () => {
    const p = promptFor({ minigame_types: ['linea_del_tiempo'] });
    expect(p).toMatch(/TIPOS PERMITIDOS: el campo "type" solo puede valer .*"linea_del_tiempo"/);
  });

  it('con minijuegos desactivados, el prompt no menciona ninguno', () => {
    const p = promptFor({ minigame_types: [] });
    for (const id of ALL_MINIGAME_IDS) expect(p).not.toContain(`"${id}"`);
    expect(p).not.toContain('(minijuego)');
  });

  it('respeta el tope de caracteres del contexto', () => {
    const config = resolveConfig(null);
    const { prompt } = buildGenerationPrompt({ config, moduleTitle: 'T', context: 'x'.repeat(50000), classicCount: 5, minigames: [] });
    expect(prompt.length).toBeLessThan(50000);
  });

  it('usa la taxonomia de conceptos cuando se le da y la instruccion generica cuando no', () => {
    const config = resolveConfig(null);
    const con = buildGenerationPrompt({ config, moduleTitle: 'T', context: 'c', classicCount: 5, minigames: [], conceptBlock: 'BLOQUE_TAXONOMIA' }).prompt;
    const sin = buildGenerationPrompt({ config, moduleTitle: 'T', context: 'c', classicCount: 5, minigames: [] }).prompt;
    expect(con).toContain('BLOQUE_TAXONOMIA');
    expect(sin).toContain('CONCEPT_TAG (obligatorio');
  });
});

describe('remediationPreamble (repaso dirigido)', () => {
  it('lleva el grado, el nivel de lenguaje, los temas a evitar y las instrucciones del profesor', () => {
    const p = remediationPreamble(resolveConfig({
      grade_level_detail: '5to grado', language_level: 'simple', topics_avoid: 'guerras', custom_instructions: 'usar ejemplos locales',
    }));
    expect(p).toContain('GRADO: 5to grado');
    expect(p).toContain('NIVEL DE LENGUAJE: simple');
    expect(p).toContain('TEMAS A EVITAR: guerras');
    expect(p).toContain('INSTRUCCIONES ESPECIALES: usar ejemplos locales');
  });
  it('omite las lineas vacias y termina en salto de linea para pegarse al bloque siguiente', () => {
    const p = remediationPreamble(resolveConfig(null));
    expect(p).toBe('NIVEL DE LENGUAJE: intermediate' + String.fromCharCode(10));
  });
});
