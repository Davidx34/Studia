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

// Los clips CORTOS (B1 a B3 del catalogo, docs/TONITO_CATALOGO_ANIMACIONES.md §7): no son cinematicas a pantalla completa sino pequeños videos en una tarjeta
// cuadrada, en las pantallas de espera y de estado (hoy una pose fija de ~100 px). Usan la MISMA tabla (tonito_scene_clips) y el mismo comando
// (`npm run clip:publish -- --video B1.mp4 --scene wait_thinking`): la "escena" es el espacio donde se muestra. Mientras un espacio no tenga clip publicado, se ve la pose de siempre.
export const STATE_SLOTS = ['wait_thinking', 'soft_error', 'small_win'] as const;

export type StateSlot = (typeof STATE_SLOTS)[number];

export const isStateSlot = (s: string): s is StateSlot => (STATE_SLOTS as readonly string[]).includes(s);

// Cada espacio: que clip del catalogo es, donde se ve y si va en bucle. Solo la espera (B1) es un bucle; B2 y B3 se reproducen una vez y se quedan en el ultimo cuadro.
export const STATE_SLOT_INFO: Record<StateSlot, { clip: string; loop: boolean; where: string }> = {
  wait_thinking: { clip: 'B1', loop: true, where: 'la IA prepara las preguntas (lección), repaso pensando y aviso de refuerzo' },
  soft_error: { clip: 'B2', loop: false, where: 'no se pudo preparar la lección' },
  small_win: { clip: 'B3', loop: false, where: 'refuerzo del repaso completado' },
};

// Todo lo que se puede publicar con clip:publish / clip:on / clip:off.
export const CLIP_SCENES: readonly string[] = [...CINEMATIC_TYPES, ...STATE_SLOTS];

export const isClipScene = (s: string): boolean => CLIP_SCENES.includes(s);

// Lo que se publica por defecto en bucle para esa escena (se puede forzar con --loop).
export const sceneLoopsByDefault = (s: string): boolean => (isStateSlot(s) ? STATE_SLOT_INFO[s].loop : false);
