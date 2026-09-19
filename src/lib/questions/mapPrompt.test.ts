import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  buildMapPrompt,
  buildMapConfigSection,
  MAP_CONFIG_FIELDS,
  MAP_CONFIG_NOT_APPLICABLE,
} from '../../../supabase/functions/generate-classroom-map/mapPrompt';

const BASE = {
  classroomName: 'Clase X',
  subjectArea: 'history',
  gradeLevel: '6to',
  description: 'desc',
  topics: ['Egipto'],
  samples: 'extracto',
};

const META = new Set(['id', 'classroom_id', 'teacher_id', 'created_at', 'updated_at']);

function columns(): string[] {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/types/database.generated.ts'), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('classroom_ai_config: {\n        Row: {');
  const end = src.indexOf('\n        }', start);
  return Array.from(src.slice(start, end).matchAll(/^\s{10}(\w+)\??:/gm)).map((m) => m[1]);
}

// Antes, generate-classroom-map diseñaba los modulos SIN leer classroom_ai_config.
// Un profesor podia escribir "no quiero modulos sobre guerras" y la funcion no lo veia.
describe('creacion de modulos: contrato con classroom_ai_config', () => {
  it('cada columna se usa o se declara como no aplicable, con motivo', () => {
    const covered = new Set<string>([...Array.from(META), ...MAP_CONFIG_FIELDS, ...Object.keys(MAP_CONFIG_NOT_APPLICABLE)]);
    const sinDecidir = columns().filter((c) => !covered.has(c));
    expect(sinDecidir, `columnas sin decidir para la creacion de modulos: ${sinDecidir.join(', ')}`).toEqual([]);
  });

  it('lo declarado existe de verdad en la tabla (sin entradas obsoletas)', () => {
    const inTable = new Set(columns());
    for (const k of [...MAP_CONFIG_FIELDS, ...Object.keys(MAP_CONFIG_NOT_APPLICABLE)]) {
      expect(inTable.has(k), `${k} ya no esta en la tabla`).toBe(true);
    }
  });

  it('nada esta a la vez como "usado" y como "no aplicable"', () => {
    for (const k of MAP_CONFIG_FIELDS) expect(MAP_CONFIG_NOT_APPLICABLE[k]).toBeUndefined();
  });

  it('cada motivo de "no aplicable" explica algo', () => {
    for (const reason of Object.values(MAP_CONFIG_NOT_APPLICABLE)) expect(reason.length).toBeGreaterThan(15);
  });
});

describe('buildMapPrompt: cada campo usado llega al prompt', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['subject_description', { subject_description: 'Civilizaciones comparadas' }, 'Descripción de la materia (por el profesor): Civilizaciones comparadas'],
    ['grade_level_detail', { grade_level_detail: '6to, 11-12 años' }, 'Nivel y grado (por el profesor): 6to, 11-12 años'],
    ['learning_objectives', { learning_objectives: '1) Comparar sistemas politicos' }, 'Objetivos de aprendizaje de la clase: 1) Comparar sistemas politicos'],
    ['language_level', { language_level: 'simple' }, 'Nivel de lenguaje: simple'],
    ['question_depth', { question_depth: 4 }, 'Profundidad deseada: 4/5'],
    ['topics_emphasize', { topics_emphasize: 'herencia precolombina' }, 'Temas a ENFATIZAR: herencia precolombina'],
    ['topics_avoid', { topics_avoid: 'guerras' }, 'Temas a EVITAR: guerras'],
    ['custom_instructions', { custom_instructions: 'conectar con Colombia' }, 'Instrucciones especiales: conectar con Colombia'],
  ];

  it('los casos cubren exactamente los campos declarados como usados', () => {
    expect(cases.map(([k]) => k).sort()).toEqual([...MAP_CONFIG_FIELDS].sort());
  });

  it.each(cases)('%s', (_field, cfg, marker) => {
    expect(buildMapPrompt({ ...BASE, config: cfg })).toContain(marker);
  });

  it('los objetivos vienen con la instruccion de cubrirlos todos', () => {
    const p = buildMapPrompt({ ...BASE, config: { learning_objectives: 'obj' } });
    expect(p).toContain('cada uno debe quedar atendido por al menos un módulo');
  });

  it('lo que el profesor pide evitar se traduce en no crear modulos sobre ello', () => {
    const p = buildMapPrompt({ ...BASE, config: { topics_avoid: 'guerras' } });
    expect(p).toContain('No crees módulos sobre ellos');
  });

  it('la configuracion tiene prioridad declarada sobre el material', () => {
    expect(buildMapPrompt({ ...BASE, config: { topics_avoid: 'x' } })).toContain('tiene prioridad sobre tus supuestos');
  });
});

describe('buildMapPrompt: sin configuracion, igual que antes', () => {
  it('sin configuracion no aparece ningun bloque de configuracion', () => {
    for (const cfg of [null, undefined, {}, { subject_description: '', topics_avoid: '   ' }]) {
      expect(buildMapPrompt({ ...BASE, config: cfg as any })).not.toContain('CONFIGURACIÓN DEL PROFESOR');
    }
  });

  it('conserva las reglas del diseñador, incluidas las categorias validas', () => {
    const p = buildMapPrompt({ ...BASE });
    expect(p).toContain('5 a 12 módulos');
    expect(p).toContain('"math", "science", "language", "history", "logic"');
    expect(p).toContain('EXTRACTOS DEL MATERIAL');
  });

  it('las lineas vacias de la configuracion no aparecen', () => {
    expect(buildMapConfigSection({ topics_avoid: 'guerras', topics_emphasize: '' })).not.toContain('ENFATIZAR');
  });
});

describe('funcion de Supabase (index.ts): cableado', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/generate-classroom-map/index.ts'), 'utf8').replace(new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g'), String.fromCharCode(10));

  it('lee classroom_ai_config y arma el prompt con el constructor compartido', () => {
    expect(src).toContain("from('classroom_ai_config')");
    expect(src).toContain("import { buildMapPrompt } from './mapPrompt.ts'");
    expect(src).toMatch(/config: aiConfig/);
  });

  it('pide en el SELECT todos los campos que el prompt usa', () => {
    const select = src.slice(src.indexOf("from('classroom_ai_config')"), src.indexOf('.eq(', src.indexOf("from('classroom_ai_config')")));
    for (const f of MAP_CONFIG_FIELDS) expect(select, `el SELECT no pide ${f}`).toContain(f);
  });

  it('dry_run devuelve el prompt ANTES de llamar a Gemini y de insertar modulos', () => {
    const iDry = src.indexOf('if (body.dry_run)');
    expect(iDry).toBeGreaterThan(-1);
    expect(iDry).toBeLessThan(src.indexOf('callMapDesigner(GEMINI_API_KEY'));
    expect(iDry).toBeLessThan(src.indexOf(".from('content_modules')\n    .insert"));
  });

  it('un error al leer la configuracion se registra, no se calla', () => {
    expect(src).toContain('[MAP_CONFIG_READ_FAILED]');
  });

  it('no se exige la clave de Gemini para un dry_run', () => {
    expect(src).toContain('!GEMINI_API_KEY && !body.dry_run');
  });
});
