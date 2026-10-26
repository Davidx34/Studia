// Las escenas de cinematica de Toñito. Vive aparte del componente para que los scripts (npm run clip:publish) y las pruebas puedan
// usarlo sin cargar React.

export const CINEMATIC_TYPES = ['welcome', 'lesson_start', 'module_complete_good', 'module_complete_low', 'streak'] as const;

export type CinematicType = (typeof CINEMATIC_TYPES)[number];

export const isCinematicType = (s: string): s is CinematicType => (CINEMATIC_TYPES as readonly string[]).includes(s);

// Clip de RESPALDO que trae el codigo para una escena (id de TONITO_CLIPS). Solo se usa si la base no responde o la escena no tiene
// fila en tonito_scene_clips. El clip "de verdad" de cada escena se publica en la base con `npm run clip:publish`, sin tocar esto.
export const SCENE_DEFAULT_CLIP: Partial<Record<CinematicType, string>> = {
  module_complete_good: 'celebracion',
};
