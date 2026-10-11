import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { validateInfographic, generateInfographics, pickGroups, infographicRow, buildInfographicPrompt } from './infographics';
import { InfographicView } from '@/components/study/InfographicView';

const source =
  'El Antiguo Egipto duro mas de 3181 anios. Hacia el 3100 a. C. se unificaron el Alto y el Bajo Egipto bajo Narmer. ' +
  'En el 2560 a. C. se construyo la Gran Piramide de Guiza. Hacia 1274 a. C. ocurrio la batalla de Kadesh contra los hititas. ' +
  'Los escribas redactaban documentos; los campesinos cultivaban las orillas del Nilo y el faraon gobernaba el reino. ' +
  'El proceso de momificacion incluia extraer los organos, secar el cuerpo con natron y vendar la momia.';

const timeline = {
  tipo: 'timeline',
  titulo: 'Hitos del Antiguo Egipto',
  eventos: [
    { cuando: '3100 a. C.', titulo: 'Unificacion del Alto y Bajo Egipto', detalle: 'Bajo Narmer.' },
    { cuando: '2560 a. C.', titulo: 'Gran Piramide de Guiza', detalle: '' },
    { cuando: '1274 a. C.', titulo: 'Batalla de Kadesh', detalle: 'Contra los hititas.' },
  ],
};

describe('validateInfographic', () => {
  it('acepta una cronologia cuyas fechas salen del material', () => {
    const r = validateInfographic(timeline, source);
    expect(r?.tipo).toBe('timeline');
  });

  it('rechaza una cronologia con una fecha INVENTADA', () => {
    const bad = { ...timeline, eventos: [...timeline.eventos.slice(0, 2), { cuando: '1500 a. C.', titulo: 'Batalla de Kadesh', detalle: '' }] };
    expect(validateInfographic(bad, source)).toBeNull();
  });

  it('el separador de miles no cuenta: 3.181 = 3181', () => {
    const r = validateInfographic({ tipo: 'stats', titulo: 'Egipto en cifras', cifras: [{ valor: '3.181', etiqueta: 'Anios de duracion', nota: '' }, { valor: '2560', etiqueta: 'Gran Piramide', nota: '' }] }, source);
    expect(r?.tipo).toBe('stats');
  });

  it('cifras: descarta las que no estan en el material y exige al menos dos', () => {
    const r = validateInfographic({ tipo: 'stats', titulo: 'Cifras', cifras: [{ valor: '3181', etiqueta: 'Anios de duracion', nota: '' }, { valor: '9999', etiqueta: 'Dato inventado', nota: '' }] }, source);
    expect(r).toBeNull(); // quedo solo una valida
  });

  it('comparativa: cada fila necesita un valor por columna; rechaza texto ajeno al material', () => {
    const ok = { tipo: 'comparison', titulo: 'Escribas y campesinos', columnas: ['Escribas', 'Campesinos'], filas: [{ criterio: 'Tarea', valores: ['Redactaban documentos', 'Cultivaban las orillas del Nilo'] }, { criterio: 'Lugar', valores: ['Reino del faraon', 'Orillas del Nilo'] }] };
    expect(validateInfographic(ok, source)?.tipo).toBe('comparison');
    expect(validateInfographic({ ...ok, filas: [{ criterio: 'Tarea', valores: ['uno'] }, ok.filas[1]] }, source)).toBeNull();
    expect(validateInfographic({ ...ok, columnas: ['Vikingos', 'Samurais'], filas: [{ criterio: 'Armas', valores: ['Hachas de guerra', 'Katanas afiladas'] }, { criterio: 'Barcos', valores: ['Drakkars veloces', 'Ninguno'] }] }, source)).toBeNull();
  });

  it('proceso: minimo 3 pasos apoyados en el material', () => {
    const p = { tipo: 'process', titulo: 'Momificacion', pasos: [{ titulo: 'Extraer los organos', detalle: '' }, { titulo: 'Secar el cuerpo con natron', detalle: '' }, { titulo: 'Vendar la momia', detalle: '' }] };
    expect(validateInfographic(p, source)?.tipo).toBe('process');
    expect(validateInfographic({ ...p, pasos: p.pasos.slice(0, 2) }, source)).toBeNull();
  });

  it('tipo desconocido, sin titulo o basura', () => {
    expect(validateInfographic({ ...timeline, tipo: 'pastel' }, source)).toBeNull();
    expect(validateInfographic({ ...timeline, titulo: '' }, source)).toBeNull();
    for (const bad of [null, undefined, 'x', 3, []]) expect(validateInfographic(bad as any, source)).toBeNull();
  });
});

describe('generateInfographics', () => {
  const group = (n: number) => ({ section: `S${n}`, text: source, chunkIndexes: [n] });

  it('guarda las validas, tolera {"infografia":null} sin reintentar y reintenta los JSON rotos', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ infografia: timeline })) // grupo 0
      .mockResolvedValueOnce(JSON.stringify({ infografia: null })) // grupo 1: no se presta
      .mockResolvedValueOnce('no es json') // grupo 2, intento 1
      .mockResolvedValueOnce(JSON.stringify({ infografia: { tipo: 'process', titulo: 'Momificacion', pasos: [{ titulo: 'Extraer los organos', detalle: '' }, { titulo: 'Secar el cuerpo con natron', detalle: '' }, { titulo: 'Vendar la momia', detalle: '' }] } })); // grupo 2, intento 2
    const r = await generateInfographics([group(0), group(1), group(2)], 'Mat', call, 1);
    expect(r.items.map((i) => i.section)).toEqual(['S0', 'S2']);
    expect(call).toHaveBeenCalledTimes(4);
  });

  it('acota los bloques y los reparte a lo largo del material', () => {
    const many = Array.from({ length: 12 }, (_, i) => group(i));
    const picked = pickGroups(many, 6);
    expect(picked).toHaveLength(6);
    expect(picked[0].section).toBe('S0');
    expect(picked[5].section).toBe('S10');
  });

  it('la fila a guardar usa kind infografia y deja los datos en extra', () => {
    const v = validateInfographic(timeline, source)!;
    const row = infographicRow('m1', { ...v, section: 'Sec' }, 2);
    expect(row).toMatchObject({ material_id: 'm1', kind: 'infografia', position: 2, front: 'Hitos del Antiguo Egipto', back: 'Línea de tiempo', section: 'Sec' });
    expect(row.extra).toMatchObject({ tipo: 'timeline' });
    expect((row.extra as any).section).toBeUndefined();
  });

  it('el prompt permite decir "no se presta" y exige usar solo el fragmento', () => {
    const p = buildInfographicPrompt(group(0), 'Mat');
    expect(p).toContain('{"infografia":null}');
    expect(p).toContain('SOLO informacion del fragmento');
  });
});

describe('InfographicView', () => {
  const render = (data: any) => renderToStaticMarkup(h(InfographicView as any, { title: data.titulo, section: 'Sec', data }));

  it('cronologia: lista ordenada con fechas y titulos', () => {
    const html = render(validateInfographic(timeline, source));
    expect(html).toContain('<ol');
    expect(html).toContain('3100 a. C.');
    expect(html).toContain('Línea de tiempo');
  });

  it('comparativa: tabla real con encabezados de columna y de fila', () => {
    const html = render({ tipo: 'comparison', titulo: 'T', columnas: ['A', 'B'], filas: [{ criterio: 'C1', valores: ['x', 'y'] }, { criterio: 'C2', valores: ['z', 'w'] }] });
    expect(html).toContain('<table');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('<caption');
  });

  it('proceso: numera los pasos y los anuncia ("Paso N")', () => {
    const html = render({ tipo: 'process', titulo: 'T', pasos: [{ titulo: 'Uno', detalle: '' }, { titulo: 'Dos', detalle: '' }, { titulo: 'Tres', detalle: '' }] });
    expect(html).toContain('Paso 1');
    expect(html).toContain('Paso 3');
  });

  it('cifras: lista de definiciones con termino antes que valor', () => {
    const html = render({ tipo: 'stats', titulo: 'T', cifras: [{ valor: '3181', etiqueta: 'Anios', nota: 'n' }, { valor: '2560', etiqueta: 'Piramide', nota: '' }] });
    expect(html).toContain('<dl');
    expect(html.indexOf('<dt')).toBeLessThan(html.indexOf('<dd'));
    expect(html).toContain('3181');
  });

  it('no usa colores fijos: solo tokens', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/study/InfographicView.tsx'), 'utf8');
    expect(src).not.toMatch(/\btext-white\b|\b(bg|text|border)-(slate|gray|violet|blue|green|red|amber)-\d|#[0-9a-f]{3,6}\b/i);
  });
});

describe('integracion', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

  it('la regeneracion de fichas ya no borra las infografias', () => {
    expect(read('src/app/api/study/generate/route.ts')).toContain(".in('kind', ['ficha', 'flashcard'])");
  });

  it('la ruta de infografias valida usuario, acceso por RLS y reclama de forma atomica', () => {
    const route = read('src/app/api/study/infographics/route.ts');
    expect(route).toContain('auth.getUser()');
    expect(route).toContain("processing_status !== 'completed'");
    expect(route).toContain(".eq('started_at', current.started_at)");
    expect(route).toContain('RETRY_COOLDOWN_MS');
  });

  it('la migracion amplia el tipo y deja la generacion escrita solo por el servidor', () => {
    const sql = read('supabase/migrations/057_study_infographics.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toContain("CHECK (kind IN ('ficha', 'flashcard', 'infografia'))");
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.study_infographic_generation FROM anon, authenticated/);
    expect(sql).not.toMatch(/FOR ALL/);
  });
});

describe('isDuplicate', () => {
  const tl = (...c: string[]) => ({ tipo: 'timeline' as const, titulo: 'X', eventos: c.map((x) => ({ cuando: x, titulo: 'Algo', detalle: '' })) });
  it('dos cronologias con las mismas fechas son la misma', async () => {
    const { isDuplicate } = await import('./infographics');
    expect(isDuplicate(tl('3100 a. C.', '2560 a. C.', '1274 a. C.'), tl('3100 a. C.', '2560 a. C.', '30 a. C.'))).toBe(true);
    expect(isDuplicate(tl('3100 a. C.', '2560 a. C.', '1274 a. C.'), tl('500', '600', '700'))).toBe(false);
  });
  it('tipos distintos nunca se consideran duplicados', async () => {
    const { isDuplicate } = await import('./infographics');
    expect(isDuplicate(tl('1', '2', '3'), { tipo: 'process', titulo: 'X', pasos: [] })).toBe(false);
  });
});
