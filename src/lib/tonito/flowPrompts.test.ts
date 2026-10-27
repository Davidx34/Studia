import { describe, it, expect } from 'vitest';
import {
  AVOID, CLIPS, IDENTITY, POSES, POSE_BACKGROUND, backgroundLine, buildClipPrompt, buildPosePrompt, clipById, framing, pendingCount, poseById, renderPromptsDoc,
} from './flowPrompts';

const HEX = /^#[0-9A-F]{6}$/;

// El prompt de la celebracion que SALIO PERFECTA (docs/TONITO_PRUEBA_DE_CONCEPTO.md §11). Estas frases deben seguir apareciendo tal cual en lo que genera la herramienta: es lo unico
// que se sabe que funciona con Flow, y una version anterior que se alejo de este formato (ingles, sin nombrar al personaje) dio un personaje distinto.
const PROBADO = {
  identidad:
    'Mismo personaje de la imagen de referencia: Toñito, un muñeco amigurumi de crochet renderizado en 3D, con textura de lana visible y cabeza grande. Lleva casco de safari beige con banda, ' +
    'gafas redondas grandes de montura oscura, moño, bata blanca de laboratorio sobre chaleco marrón, pantalón escocés beige y marrón, y botas marrones.',
  noCambies: 'No cambies su diseño ni su ropa en ningún momento.',
  accion:
    '0 a 0,5 s: Toñito está de pie, relajado y sonriente, en el centro del cuadro. 0,5 a 2,5 s: salta de alegría con los brazos en alto y cae. 2,5 a 4 s: se queda en una pose de celebración ' +
    'estable, sonriendo, casi quieto, con los puños cerrados de alegría. El video termina en esa pose estable.',
  encuadre: 'cámara completamente fija, sin zoom, sin movimiento de cámara y sin cortes. Toñito de cuerpo entero, centrado horizontalmente, y siempre dentro del 60 % central del ancho.',
  tercio: 'el tercio inferior queda completamente libre',
  fondo:
    'Fondo: degradado suave y mate en diagonal, sin objetos, sin suelo, sin horizonte y sin sombras marcadas. De arriba a la izquierda a abajo a la derecha: ámbar (#D97706), naranja (#EA580C) y ' +
    'rosa frambuesa (#E11D48).',
  efectos: 'pocos destellos blancos y cremas y algunas estrellitas doradas muy claras alrededor de Toñito durante el salto. Pocos y pequeños, que no tapen su cara.',
  evita:
    'Muy importante, evita: cualquier texto, letras, números, subtítulos, logotipos, botones, iconos de play, banners o elementos de interfaz. Sin otros personajes. Sin cambios de escena. Sin ' +
    'música ni voz.',
};

describe('el prompt de la celebracion (el que salio perfecto) sigue dentro de lo que genera la herramienta', () => {
  const p = buildClipPrompt(clipById('A3')!, 'vertical');

  it('empieza NOMBRANDO al personaje y a la imagen de referencia, y dice la duracion', () => {
    expect(p.startsWith('Video vertical 9:16 de 4 segundos. Mismo personaje de la imagen de referencia: Toñito')).toBe(true);
  });

  it('conserva, tal cual, cada frase del prompt probado', () => {
    for (const [campo, frase] of Object.entries(PROBADO)) expect(p, campo).toContain(frase);
  });

  it('esta en español y por secciones, en el mismo orden', () => {
    const orden = ['Acción:', 'Encuadre:', 'Fondo:', 'Efectos:', 'Muy importante, evita:'].map((s) => p.indexOf(s));
    expect(orden.every((i) => i > 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });
});

describe('catalogo', () => {
  it('ids unicos: 8 clips (A1-A5, B1-B3) y 8 poses (P1-P8)', () => {
    expect(CLIPS.map((c) => c.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3']);
    expect(POSES.map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  });

  it('las 5 cinematicas coinciden con las escenas del sistema, y las 5 pedidas en celular y computador', () => {
    const a = CLIPS.filter((c) => c.kind === 'cinematic');
    expect(a.map((c) => c.scene)).toEqual(['welcome', 'lesson_start', 'module_complete_good', 'module_complete_low', 'streak']);
    for (const c of a) expect(c.orientations).toEqual(['vertical', 'horizontal']);
  });

  it('los clips cortos se piden en UNA sola proporcion', () => {
    for (const c of CLIPS.filter((x) => x.kind === 'short')) expect(c.orientations).toEqual(['vertical']);
  });

  it('todos los colores son hex de 6 digitos; las cinematicas llevan 3 colores', () => {
    for (const c of CLIPS) for (const s of c.bg) expect(s.hex).toMatch(HEX);
    for (const c of CLIPS.filter((x) => x.kind === 'cinematic')) expect(c.bg).toHaveLength(3);
  });

  it('el unico clip publicado es la celebracion en vertical; faltan 12 clips + 8 poses = 20', () => {
    expect(CLIPS.flatMap((c) => (c.done ?? []).map((o) => `${c.id}:${o}`))).toEqual(['A3:vertical']);
    expect(pendingCount()).toEqual({ clips: 12, poses: 8, total: 20 });
  });

  it('los colores de las cinematicas son los de CinematicScene (celebracion: ambar, naranja, rosa)', () => {
    expect(clipById('a3')!.bg.map((s) => s.hex)).toEqual(['#D97706', '#EA580C', '#E11D48']);
    expect(clipById('A5')!.bg.map((s) => s.hex)).toEqual(['#B91C1C', '#EA580C', '#F59E0B']);
  });
});

describe('prompts de clip', () => {
  const todos = CLIPS.flatMap((c) => c.orientations.map((o) => ({ c, o, p: buildClipPrompt(c, o) })));

  it('13 prompts; cada uno nombra al personaje, prohibe cambiar su diseño y lleva todas las secciones', () => {
    expect(todos).toHaveLength(13);
    for (const { c, o, p } of todos) {
      const id = `${c.id} ${o}`;
      expect(p, id).toContain(IDENTITY);
      expect(p, id).toContain(AVOID);
      expect(p, id).toContain('Mismo personaje de la imagen de referencia: Toñito');
      expect(p, id).toContain('No cambies su diseño ni su ropa en ningún momento');
      for (const seccion of ['Acción:', 'Encuadre:', 'Fondo:', 'Efectos:']) expect(p, id).toContain(seccion);
      expect(p, id).not.toMatch(/[{}]/);
    }
  });

  it('la identidad descarta el rostro envejecido que salio en el primer intento (cabello gris, arrugas)', () => {
    expect(IDENTITY).toMatch(/rostro es joven y redondo/);
    expect(IDENTITY).toMatch(/sin cabello gris ni arrugas/);
  });

  it('la accion va POR TIEMPOS y termina en una pose estable', () => {
    for (const { c, p } of todos) {
      expect(p, c.id).toMatch(/\d+(,\d+)? a \d+(,\d+)? s:/);
      expect(p, c.id).toMatch(/pose|bucle|idénticos/i);
    }
  });

  it('prohibe texto, botones y musica en todos', () => {
    for (const { p } of todos) {
      expect(p).toMatch(/cualquier texto, letras, números, subtítulos, logotipos, botones, iconos de play/);
      expect(p).toMatch(/Sin música ni voz/);
    }
  });

  it('nada contradice el encuadre: no hay suelo, ni entradas desde fuera del cuadro, ni anillos en el suelo', () => {
    for (const { c, p } of todos) {
      expect(p, c.id).toContain('sin suelo');
      expect(p, c.id).toMatch(/Nunca sale del encuadre/);
      expect(p, c.id).not.toMatch(/fuera del cuadro|desde el borde|en el suelo/i);
    }
  });

  it('vertical = 9:16 con los pies al 62 % y el tercio inferior libre; horizontal = 16:9 con los lados libres y los pies al 67 %', () => {
    for (const { c, o, p } of todos.filter((t) => t.c.kind === 'cinematic')) {
      if (o === 'vertical') {
        expect(p, c.id).toContain('vertical 9:16');
        expect(p, c.id).toContain('62 %');
      } else {
        expect(p, c.id).toContain('horizontal 16:9');
        expect(p, c.id).toContain('67 %');
        expect(p, c.id).toMatch(/no más ancho que el 30 % del ancho/);
        expect(p, c.id).toMatch(/nada importante a menos del 20 % de los bordes/);
      }
      expect(p, c.id).toMatch(/tercio inferior/);
      expect(p, c.id).toContain(backgroundLine(c.bg));
    }
  });

  it('los bucles piden primer y ultimo cuadro identicos; los demas no', () => {
    expect(buildClipPrompt(clipById('B1')!, 'vertical')).toContain('El primer cuadro y el último son idénticos');
    expect(buildClipPrompt(clipById('A1')!, 'vertical')).not.toContain('primer cuadro y el último');
  });

  it('las acciones de fallo no regañan ni dramatizan', () => {
    expect(buildClipPrompt(clipById('A4')!, 'vertical')).toMatch(/Sin tristeza, sin decepción y sin ningún gesto de regaño/);
    expect(buildClipPrompt(clipById('B2')!, 'vertical')).toMatch(/nunca dramático, sin lágrimas/);
  });

  it('A1: el anillo de energia va alrededor de los pies, no en el suelo', () => {
    expect(buildClipPrompt(clipById('A1')!, 'vertical')).toMatch(/anillo de energía ciano .* alrededor de sus pies/);
  });

  it('pedir una orientacion que el clip no tiene es un error claro', () => {
    expect(() => buildClipPrompt(clipById('B1')!, 'horizontal')).toThrow(/no se pide en horizontal/);
  });

  it('framing: el clip corto usa el cuadrado central; el horizontal deja el tercio inferior libre', () => {
    expect(framing('short', 'vertical')).toMatch(/cuadrado central/);
    expect(framing('cinematic', 'horizontal')).toMatch(/tercio inferior queda libre/);
  });
});

describe('backgroundLine', () => {
  it('reproduce la frase del prompt probado', () => {
    expect(backgroundLine(clipById('A3')!.bg)).toBe(PROBADO.fondo);
  });
  it('con dos colores usa "y"', () => {
    expect(backgroundLine(clipById('B1')!.bg)).toContain('violeta azulado (#6C5CE7) y turquesa (#00D2D3)');
  });
});

describe('prompts de pose', () => {
  it('imagen cuadrada con fondo magenta plano, nombrando al personaje, sin texto', () => {
    for (const s of POSES) {
      const p = buildPosePrompt(s);
      expect(p).toContain(IDENTITY);
      expect(p).toContain('Mismo personaje de la imagen de referencia: Toñito');
      expect(p).toContain(POSE_BACKGROUND);
      expect(p).toContain('#FF00FF');
      expect(p).toContain(`Pose: ${s.pose}`);
      expect(p).toMatch(/cualquier texto, letras, números, logotipos/);
    }
  });

  it('el animo (P3) nunca es un reproche', () => {
    expect(buildPosePrompt(poseById('p3')!)).toMatch(/Nunca un gesto de reproche/);
  });

  it('las P0 son las 4 mas usadas', () => {
    expect(POSES.filter((p) => p.priority === 'P0').map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
  });
});

describe('documento generado', () => {
  const doc = renderPromptsDoc();

  it('incluye cada prompt armado, una vez por orientacion', () => {
    for (const c of CLIPS) for (const o of c.orientations) expect(doc).toContain(buildClipPrompt(c, o));
    for (const p of POSES) expect(doc).toContain(buildPosePrompt(p));
  });

  it('marca lo ya publicado, cuenta lo que falta y pide adjuntar la referencia y generar UNA primero', () => {
    expect(doc).toMatch(/ya publicado/);
    expect(doc).toContain('Por generar: **12 clips + 8 poses = 20**');
    expect(doc).toMatch(/Adjunta la imagen de referencia aprobada/);
    expect(doc).toMatch(/Genera primero UNA/);
  });

  it('no deja marcadores sin reemplazar', () => {
    expect(doc).not.toMatch(/\{(IDENTIDAD|ORIENTACION|REGLAS|FONDO|POSE)\}/);
  });
});
