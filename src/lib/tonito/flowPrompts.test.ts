import { describe, it, expect } from 'vitest';
import {
  CLIPS, CLIP_RULES, IDENTITY, POSES, POSE_FRAMING, backgroundLine, buildClipPrompt, buildPosePrompt, clipById, pendingCount, poseById, renderPromptsDoc,
} from './flowPrompts';

const HEX = /^#[0-9A-F]{6}$/;

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

  it('los clips cortos y las poses se piden en UNA sola proporcion', () => {
    for (const c of CLIPS.filter((x) => x.kind === 'short')) expect(c.orientations).toEqual(['vertical']);
  });

  it('todos los colores son hex de 6 digitos; las cinematicas llevan 3 colores', () => {
    for (const c of CLIPS) for (const h of c.bg) expect(h).toMatch(HEX);
    for (const c of CLIPS.filter((x) => x.kind === 'cinematic')) expect(c.bg).toHaveLength(3);
  });

  it('el unico clip publicado es la celebracion en vertical; faltan 12 clips + 8 poses = 20', () => {
    const hechos = CLIPS.flatMap((c) => (c.done ?? []).map((o) => `${c.id}:${o}`));
    expect(hechos).toEqual(['A3:vertical']);
    expect(pendingCount()).toEqual({ clips: 12, poses: 8, total: 20 });
  });

  it('los colores de las cinematicas son los de CinematicScene (celebracion: ambar, naranja, rosa)', () => {
    expect(clipById('a3')!.bg).toEqual(['#D97706', '#EA580C', '#E11D48']);
    expect(clipById('A5')!.bg).toEqual(['#B91C1C', '#EA580C', '#F59E0B']);
  });
});

describe('prompts de clip', () => {
  const todos = CLIPS.flatMap((c) => c.orientations.map((o) => ({ c, o, p: buildClipPrompt(c, o) })));

  it('cada prompt lleva identidad, reglas, fondo y accion, y ningun marcador sin reemplazar', () => {
    expect(todos).toHaveLength(13);
    for (const { c, o, p } of todos) {
      expect(p, `${c.id} ${o}`).toContain(IDENTITY);
      expect(p, `${c.id} ${o}`).toContain(CLIP_RULES);
      expect(p, `${c.id} ${o}`).toContain('Background: smooth diagonal gradient');
      expect(p, `${c.id} ${o}`).toContain('Action, ');
      expect(p, `${c.id} ${o}`).not.toMatch(/[{}]/);
    }
  });

  it('prohibe texto, botones y audio en todos', () => {
    for (const { p } of todos) {
      expect(p).toMatch(/No text, no letters, no numbers, no buttons, no interface/);
      expect(p).toMatch(/No audio, no music, no speech/);
    }
  });

  it('vertical = 9:16 con el suelo libre; horizontal = 16:9 con los lados libres', () => {
    for (const { o, p, c } of todos.filter((t) => t.c.kind === 'cinematic')) {
      if (o === 'vertical') {
        expect(p).toContain('Vertical 9:16');
        expect(p).toContain('bottom 30%');
      } else {
        expect(p).toContain('Horizontal 16:9');
        expect(p).toMatch(/no wider than 30% of the frame width/);
        expect(p).toMatch(/nothing important within 20%/);
      }
      expect(p).toContain(backgroundLine(c.bg));
    }
  });

  it('los pies quedan por encima del tercio del texto (60-70 % de la altura, nunca 80 %)', () => {
    for (const { p, c } of todos.filter((t) => t.c.kind === 'cinematic')) expect(p, c.id).toMatch(/feet at about (62|67)%/);
  });

  it('los bucles piden primer y ultimo cuadro iguales; los demas no', () => {
    expect(buildClipPrompt(clipById('B1')!, 'vertical')).toContain('first and last frames are identical');
    expect(buildClipPrompt(clipById('A1')!, 'vertical')).not.toContain('first and last frames');
  });

  it('las acciones de fallo no regañan ni dramatizan', () => {
    expect(buildClipPrompt(clipById('A4')!, 'vertical')).toMatch(/No sadness, no disappointment, no scolding/);
    expect(buildClipPrompt(clipById('B2')!, 'vertical')).toMatch(/never dramatic, no tears/);
  });

  it('pedir una orientacion que el clip no tiene es un error claro', () => {
    expect(() => buildClipPrompt(clipById('B1')!, 'horizontal')).toThrow(/no se pide en horizontal/);
  });
});

describe('prompts de pose', () => {
  it('imagen cuadrada con fondo magenta plano, identidad, sin texto', () => {
    for (const s of POSES) {
      const p = buildPosePrompt(s);
      expect(p).toContain(IDENTITY);
      expect(p).toContain(POSE_FRAMING);
      expect(p).toContain('#FF00FF');
      expect(p).toContain(s.pose);
      expect(p).toMatch(/No text, no logos/);
    }
  });

  it('el animo (P3) nunca es un reproche', () => {
    expect(buildPosePrompt(poseById('p3')!)).toMatch(/Never a gesture of reproach/);
  });

  it('las P0 son las 4 mas usadas', () => {
    expect(POSES.filter((p) => p.priority === 'P0').map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
  });
});

describe('documento generado', () => {
  const doc = renderPromptsDoc();
  it('incluye cada prompt armado exactamente una vez por orientacion', () => {
    for (const c of CLIPS) for (const o of c.orientations) expect(doc).toContain(buildClipPrompt(c, o));
    for (const p of POSES) expect(doc).toContain(buildPosePrompt(p));
  });
  it('marca lo ya publicado y cuenta lo que falta', () => {
    expect(doc).toMatch(/ya publicado/);
    expect(doc).toContain('Por generar: **12 clips + 8 poses = 20**');
  });
  it('no deja marcadores sin reemplazar', () => {
    expect(doc).not.toMatch(/\{(IDENTIDAD|ORIENTACION|REGLAS|FONDO|POSE)\}/);
  });
});
