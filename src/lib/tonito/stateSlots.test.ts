import { describe, it, expect } from 'vitest';
import { CINEMATIC_TYPES, CLIP_SCENES, STATE_SLOTS, STATE_SLOT_INFO, isClipScene, isStateSlot, sceneLoopsByDefault } from './scenes';
import { CLIPS, buildClipPrompt, clipById } from './flowPrompts';
import { clipPaths } from './clipPipeline';
import { resolveSceneClip, rowToClip, type SceneClipRow } from './clips';

// Lo que escribe `clip:publish` para un espacio: id = escena con guiones, archivos versionados, 720x1280.
const rowFor = (scene: string, over: Partial<SceneClipRow> = {}): SceneClipRow => {
  const id = scene.replace(/_/g, '-');
  const p = clipPaths(id, 1);
  return { scene, clip_id: id, src: p.video, poster: p.poster, width: 720, height: 1280, loop: false, active: true, ...over };
};

describe('espacios de los clips cortos', () => {
  it('son los tres de B1 a B3 y no chocan con las cinematicas', () => {
    expect([...STATE_SLOTS]).toEqual(['wait_thinking', 'soft_error', 'small_win']);
    for (const s of STATE_SLOTS) expect((CINEMATIC_TYPES as readonly string[]).includes(s)).toBe(false);
    expect(CLIP_SCENES).toHaveLength(CINEMATIC_TYPES.length + STATE_SLOTS.length);
  });

  it('cada nombre pasa la regla de la tabla tonito_scene_clips (minusculas y guion bajo) y da un id de clip valido', () => {
    for (const s of CLIP_SCENES) {
      expect(s).toMatch(/^[a-z_]+$/);
      expect(s.replace(/_/g, '-')).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('isClipScene acepta cinematicas y espacios, y rechaza lo demas', () => {
    expect(isClipScene('welcome')).toBe(true);
    expect(isClipScene('soft_error')).toBe(true);
    expect(isClipScene('inventada')).toBe(false);
    expect(isStateSlot('welcome')).toBe(false);
    expect(isStateSlot('small_win')).toBe(true);
  });

  it('cada espacio apunta a un clip corto (B1 a B3) del catalogo de Flow', () => {
    expect(STATE_SLOTS.map((s) => STATE_SLOT_INFO[s].clip)).toEqual(['B1', 'B2', 'B3']);
    for (const s of STATE_SLOTS) {
      const c = clipById(STATE_SLOT_INFO[s].clip);
      expect(c, s).toBeDefined();
      expect(c!.kind).toBe('short');
    }
    expect(CLIPS.filter((c) => c.kind === 'short').map((c) => c.id)).toEqual(STATE_SLOTS.map((s) => STATE_SLOT_INFO[s].clip));
  });

  it('solo la espera (B1) va en bucle por defecto, y coincide con lo que pide su prompt', () => {
    expect(sceneLoopsByDefault('wait_thinking')).toBe(true);
    expect(sceneLoopsByDefault('soft_error')).toBe(false);
    expect(sceneLoopsByDefault('small_win')).toBe(false);
    expect(sceneLoopsByDefault('welcome')).toBe(false);
    for (const s of STATE_SLOTS) {
      const pideBucle = /primer cuadro y el último son idénticos|first and last frames are identical/i.test(buildClipPrompt(clipById(STATE_SLOT_INFO[s].clip)!, 'vertical'));
      expect(pideBucle, s).toBe(STATE_SLOT_INFO[s].loop);
    }
  });
});

describe('un clip publicado en un espacio se resuelve como cualquier escena', () => {
  it('la fila que escribe clip:publish es valida', () => {
    for (const s of STATE_SLOTS) expect(rowToClip(rowFor(s)), s).not.toBeNull();
  });

  it('con fila activa, ese clip; sin fila, nada (no hay clip de respaldo: se ve la pose)', () => {
    const rows = [rowFor('wait_thinking', { loop: true })];
    expect(resolveSceneClip('wait_thinking', rows)?.src).toBe('clips/wait-thinking.v1.mp4');
    expect(resolveSceneClip('wait_thinking', rows)?.loop).toBe(true);
    expect(resolveSceneClip('soft_error', rows)).toBeUndefined();
    expect(resolveSceneClip('small_win', null)).toBeUndefined();
  });

  it('apagado (active = false) -> nada, y una fila rota se ignora', () => {
    expect(resolveSceneClip('soft_error', [rowFor('soft_error', { active: false })])).toBeUndefined();
    expect(resolveSceneClip('soft_error', [rowFor('soft_error', { src: '../../secreto.mp4' })])).toBeUndefined();
  });
});
