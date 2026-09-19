import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MINIGAME_CATALOG, ALL_MINIGAME_IDS, MINIGAME_LABELS, sanitizeMinigameIds } from './minigameCatalog';
import { MINIGAME_RULES, jsonFormats } from './cohereGeneration';

// Los identificadores de minijuego viven en varios sitios. Estos tests fallan si
// se desincronizan, en vez de dejar un minijuego que se puede elegir y nunca se
// genera (o al reves).
describe('catalogo de minijuegos', () => {
  const sorted = (xs: readonly string[]) => [...xs].sort();

  it('coincide exactamente con los minijuegos que el generador sabe pedir (MINIGAME_RULES)', () => {
    expect(sorted(ALL_MINIGAME_IDS)).toEqual(sorted(Object.keys(MINIGAME_RULES)));
  });

  it('cada minijuego tiene formato JSON para el generador', () => {
    for (const id of ALL_MINIGAME_IDS) expect(jsonFormats[id], `falta jsonFormats.${id}`).toBeTruthy();
  });

  it('coincide con la lista del CHECK de la migracion 045', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/045_classroom_ai_config_minigames.sql'), 'utf8');
    const check = sql.slice(sql.indexOf('ADD CONSTRAINT'));
    const ids = Array.from(check.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    expect(sorted(Array.from(new Set(ids)))).toEqual(sorted(ALL_MINIGAME_IDS));
  });

  it('no hay identificadores repetidos', () => {
    expect(new Set(ALL_MINIGAME_IDS).size).toBe(ALL_MINIGAME_IDS.length);
  });

  it('cada entrada tiene nombre, descripcion y para que temas sirve', () => {
    for (const m of MINIGAME_CATALOG) {
      expect(m.label.length).toBeGreaterThan(2);
      expect(m.description.length).toBeGreaterThan(10);
      expect(m.fitsBest.length).toBeGreaterThan(5);
    }
  });

  it('MINIGAME_LABELS conserva el formato de la pantalla de Objetivos ("🔤 El Descifrador")', () => {
    expect(MINIGAME_LABELS.el_descifrador).toBe('🔤 El Descifrador');
    expect(Object.keys(MINIGAME_LABELS)).toHaveLength(8);
  });
});

describe('sanitizeMinigameIds', () => {
  it('deja validos, sin repetidos y en el orden recibido', () => {
    expect(sanitizeMinigameIds(['cuarto_crisis', 'linea_del_tiempo', 'cuarto_crisis'])).toEqual(['cuarto_crisis', 'linea_del_tiempo']);
  });

  it('descarta lo desconocido y lo que no es texto', () => {
    expect(sanitizeMinigameIds(['inventado', 3, null, 'flashcard_rapida'])).toEqual(['flashcard_rapida']);
  });

  it('cualquier entrada que no sea un arreglo da lista vacia, sin lanzar', () => {
    for (const v of [null, undefined, 'linea_del_tiempo', 42, {}]) expect(sanitizeMinigameIds(v)).toEqual([]);
  });
});
