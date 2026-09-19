// Catalogo unico de minijuegos: identificador, nombre para mostrar y para que
// sirve cada uno.
//
// Antes los nombres vivian solo en un mapa local de ObjectivesClient.tsx, y los
// identificadores en tres sitios mas (MINIGAME_RULES, jsonFormats y el CHECK de
// la migracion 045). Este archivo es el punto unico del lado de la interfaz, y
// minigameCatalog.test.ts verifica que sus identificadores coinciden con los del
// generador: si alguien agrega un minijuego a uno y no al otro, falla un test en
// vez de aparecer un minijuego que nunca se genera (o uno que no se puede elegir).

export interface MinigameInfo {
  id: string;
  icon: string;
  label: string;
  // Que ejercita, en una frase.
  description: string;
  // Para que temas funciona bien (tomado de las reglas de MINIGAME_RULES).
  fitsBest: string;
}

export const MINIGAME_CATALOG: readonly MinigameInfo[] = [
  {
    id: 'el_descifrador',
    icon: '🔤',
    label: 'El Descifrador',
    description: 'Adivinar una palabra clave con pistas cada vez más claras.',
    fitsBest: 'Un término, un nombre propio o un invento clave.',
  },
  {
    id: 'linea_del_tiempo',
    icon: '📅',
    label: 'Línea del Tiempo',
    description: 'Ordenar eventos o pasos de una secuencia.',
    fitsBest: 'Historia, etapas de un proceso, ciclos.',
  },
  {
    id: 'categorias_rapidas',
    icon: '⏱️',
    label: 'Categorías Rápidas',
    description: 'Clasificar elementos en categorías contra reloj.',
    fitsBest: 'Taxonomías con 3-4 categorías claras.',
  },
  {
    id: 'flashcard_rapida',
    icon: '🃏',
    label: 'Flashcard Rápida',
    description: 'Encontrar los pares que van juntos.',
    fitsBest: 'Término-definición, causa-efecto, país-capital.',
  },
  {
    id: 'impostor_cognitivo',
    icon: '🕵️',
    label: 'El Impostor Cognitivo',
    description: 'Detectar la afirmación falsa entre varias verdaderas.',
    fitsBest: 'Datos, leyes o hechos precisos.',
  },
  {
    id: 'alquimia_conceptual',
    icon: '⚗️',
    label: 'Alquimia Conceptual',
    description: 'Encontrar el puente lógico entre dos conceptos.',
    fitsBest: 'Una teoría y su aplicación aparentemente lejana.',
  },
  {
    id: 'cuarto_crisis',
    icon: '🚨',
    label: 'Cuarto de Crisis',
    description: 'Resolver un problema urgente a partir de síntomas.',
    fitsBest: 'Conceptos cuya mala aplicación produce una falla identificable.',
  },
  {
    id: 'juicio_conocimiento',
    icon: '⚖️',
    label: 'El Juicio al Conocimiento',
    description: 'Descubrir el error oculto en un testimonio.',
    fitsBest: 'Argumentos donde cabe un error sutil pero identificable.',
  },
];

export const ALL_MINIGAME_IDS: readonly string[] = MINIGAME_CATALOG.map((m) => m.id);

// "🔤 El Descifrador": el formato que ya usaba la pantalla de Objetivos.
export const MINIGAME_LABELS: Record<string, string> = Object.fromEntries(
  MINIGAME_CATALOG.map((m) => [m.id, `${m.icon} ${m.label}`])
);

// Cuantos minijuegos entran, como maximo, en cada tanda de preguntas cuando el
// profesor no fijo una lista concreta para el modulo. Antes era una constante
// local del generador; esta es la unica fuente.
export const MAX_MINIGAMES_PER_BATCH = 2;

// Deja solo identificadores validos, sin repetidos y en el orden recibido.
// Cualquier cosa que no sea un arreglo de textos conocidos se descarta: la
// entrada puede venir del navegador o de una fila vieja.
export function sanitizeMinigameIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === 'string' && ALL_MINIGAME_IDS.includes(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
