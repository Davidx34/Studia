import { describe, it, expect, vi } from 'vitest';
import { buildSourceQuery, findSourceHint, pickSourceHint, termsOf } from './sourceHint';

const CHUNK = (section: string, body: string, filename = 'Microeconomia_Unidad1.pdf') => ({
  content: `[Sección: ${section}]\n\n${body}`,
  filename,
});

const UTILIDAD = CHUNK(
  'Unidad 1 > Utilidad',
  'La utilidad marginal es el aumento de satisfacción que produce consumir una unidad adicional de un bien. ' +
    'Según la ley de la utilidad marginal decreciente, esa satisfacción adicional disminuye cuando se consumen más unidades. ' +
    'El excedente del consumidor mide la diferencia entre lo que se está dispuesto a pagar y lo que realmente se paga.'
);
const OFERTA = CHUNK(
  'Unidad 2 > Oferta',
  'La curva de oferta muestra la cantidad que los productores están dispuestos a vender a cada precio. ' +
    'Un aumento de los costos de producción desplaza la curva de oferta hacia la izquierda.',
  'Microeconomia_Unidad2.pdf'
);

describe('termsOf', () => {
  it('quita tildes, palabras vacías y palabras cortas, sin repetir', () => {
    expect(termsOf('¿Cuál es la utilidad MARGINAL de la utilidad?').sort()).toEqual(['marginal', 'utilidad']);
    expect(termsOf('el la de un')).toEqual([]);
  });
});

describe('buildSourceQuery', () => {
  it('opción múltiple: pregunta + texto de la opción correcta sin la letra', () => {
    const q = buildSourceQuery({ type: 'multiple_choice', q: '¿Qué mide el excedente del consumidor?', opts: ['A. El costo', 'B. La diferencia entre lo dispuesto a pagar y lo pagado'], ok: 1 });
    expect(q).toContain('excedente del consumidor');
    expect(q).toContain('La diferencia entre lo dispuesto a pagar');
    expect(q).not.toContain('B.');
    expect(q).not.toContain('El costo');
  });

  it('completar: cambia los guiones por la respuesta; corta: usa las palabras clave; emparejar: términos y definiciones', () => {
    expect(buildSourceQuery({ type: 'fill_blank', q: 'La ley de la utilidad ___ decreciente', answers: ['marginal'] })).toBe('La ley de la utilidad decreciente marginal');
    expect(buildSourceQuery({ type: 'short_answer', q: 'Define oferta', keywords: ['cantidad', 'precio'] })).toBe('Define oferta cantidad precio');
    expect(buildSourceQuery({ type: 'match', q: 'Conecta', pairs: [{ term: 'Oferta', def: 'cantidad que vende' }] })).toContain('Oferta cantidad que vende');
  });

  it('se acota a 500 caracteres', () => {
    expect(buildSourceQuery({ type: 'true_false', q: 'palabra '.repeat(200) }).length).toBeLessThanOrEqual(500);
  });
});

describe('pickSourceHint', () => {
  const query = buildSourceQuery({ type: 'fill_blank', q: 'La ley de la utilidad ___ decreciente dice que la satisfacción adicional disminuye', answers: ['marginal'] });

  it('elige el pasaje que más se parece y devuelve material, sección y frase', () => {
    const hint = pickSourceHint([OFERTA, UTILIDAD], query);
    expect(hint).not.toBeNull();
    expect(hint!.material).toBe('Microeconomia Unidad1');
    expect(hint!.section).toBe('Unidad 1 > Utilidad');
    expect(hint!.excerpt).toContain('utilidad marginal decreciente');
    expect(hint!.excerpt).not.toContain('[Sección');
  });

  it('si ningún pasaje comparte al menos 2 términos, no muestra nada', () => {
    expect(pickSourceHint([OFERTA], 'fotosíntesis cloroplasto glucosa')).toBeNull();
    expect(pickSourceHint([], query)).toBeNull();
    expect(pickSourceHint([UTILIDAD], 'utilidad')).toBeNull(); // un solo término no basta
  });

  it('acota el fragmento y sin nombre de archivo usa un nombre genérico', () => {
    const long = CHUNK('S', ('utilidad marginal decreciente satisfacción '.repeat(20) + '.').trim(), '');
    const hint = pickSourceHint([long], 'utilidad marginal satisfacción');
    expect(hint!.excerpt.length).toBeLessThanOrEqual(281);
    expect(hint!.material).toBe('Material de la clase');
  });
});

describe('pickSourceHint: precision', () => {
  const DEMANDA = CHUNK(
    'Unidad 7 > Demanda',
    'La demanda del consumidor depende del precio del bien y del ingreso. ' +
      'Un aumento del precio reduce la cantidad demandada del bien en la demanda ordinaria. ' +
      'La demanda marshalliana se obtiene al maximizar la utilidad sujeta a la restricción presupuestaria. ' +
      'Cambios en el ingreso desplazan la demanda de los bienes normales hacia afuera.'
  );

  it('una frase que solo comparte un termino comun no basta si lo distintivo de la pregunta no esta en el material', () => {
    // "hicksiana" no aparece en ninguna frase: lo unico en comun es "demanda", que sale en todas.
    expect(pickSourceHint([DEMANDA], 'Explique la diferencia entre la demanda marshalliana y la demanda hicksiana')).toBeNull();
  });

  it('con lo distintivo presente si devuelve la frase correcta', () => {
    const hint = pickSourceHint([DEMANDA], 'La demanda marshalliana se obtiene al maximizar la utilidad sujeta a la restricción presupuestaria');
    expect(hint?.excerpt).toContain('demanda marshalliana');
  });

  it('descarta secciones que son un número o un signo y acorta las larguísimas', () => {
    const body = 'La utilidad marginal decreciente indica que la satisfacción adicional disminuye con cada unidad consumida.';
    const q = 'utilidad marginal decreciente satisfacción adicional disminuye';
    expect(pickSourceHint([CHUNK('30', body)], q)?.section).toBeNull();
    expect(pickSourceHint([CHUNK(':', body)], q)?.section).toBeNull();
    const long = pickSourceHint([CHUNK('Sección '.repeat(30), body)], q)?.section ?? '';
    expect(long.length).toBeLessThanOrEqual(81);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('findSourceHint', () => {
  const question = { type: 'fill_blank', q: 'La ley de la utilidad ___ decreciente', answers: ['marginal'] };
  const rows = [{ content: UTILIDAD.content, filename: UTILIDAD.filename }];

  it('busca primero en los materiales del módulo con texto solo (sin embedding) y devuelve la pista', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const hint = await findSourceHint({ rpc }, { classroomId: 'c1', materialIds: ['m1'], question });
    expect(hint?.section).toBe('Unidad 1 > Utilidad');
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('match_material_chunks_hybrid');
    expect(args).toMatchObject({ query_embedding: null, classroom_id_filter: 'c1', material_ids: ['m1'], vector_weight: 0 });
  });

  it('si los materiales del módulo no dan resultados, busca en toda la clase', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: rows, error: null });
    const hint = await findSourceHint({ rpc }, { classroomId: 'c1', materialIds: ['m1'], question });
    expect(hint).not.toBeNull();
    expect(rpc.mock.calls[1][1].material_ids).toBeNull();
  });

  it('un error de la base devuelve null y no lanza', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    expect(await findSourceHint({ rpc }, { classroomId: 'c1', materialIds: [], question })).toBeNull();
    warn.mockRestore();
  });

  it('una consulta sin términos suficientes ni siquiera llama a la base', async () => {
    const rpc = vi.fn();
    expect(await findSourceHint({ rpc }, { classroomId: 'c1', materialIds: [], question: { type: 'true_false', q: 'Es así' } })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('si la base tarda demasiado, devuelve null sin esperar', async () => {
    vi.useFakeTimers();
    try {
      const rpc = vi.fn(() => new Promise(() => {}));
      const pending = findSourceHint({ rpc }, { classroomId: 'c1', materialIds: [], question });
      await vi.advanceTimersByTimeAsync(3000);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
