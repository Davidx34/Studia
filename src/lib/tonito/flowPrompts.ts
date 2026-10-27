// Prompts de Flow/Gemini para el arte de Toñito, YA ARMADOS (identidad + encuadre + fondo + accion + reglas). Es el catalogo de docs/TONITO_CATALOGO_ANIMACIONES.md en forma de
// datos: asi cada prompt sale igual, sin armarlo a mano, y una prueba vigila que ninguno quede sin identidad, sin reglas o con marcadores sin reemplazar.
//
// Funciones puras (sin red ni disco). `npm run flow:prompts` los imprime o escribe docs/TONITO_FLOW_PROMPTS.md.

export type Orientation = 'vertical' | 'horizontal';
export type PromptKind = 'cinematic' | 'short' | 'pose';

// Siempre igual: la identidad del personaje. Se adjunta ademas la imagen de referencia aprobada.
export const IDENTITY =
  'Amigurumi crochet 3D doll character with a large head and visible yarn texture. He wears a beige safari pith helmet with a band, large round dark-framed glasses, ' +
  'a bow tie, a white lab coat over a brown knitted vest, beige-and-brown tartan trousers and brown boots. Use the attached reference image for the exact design; do ' +
  'not change the outfit or the face. Friendly, child-safe.';

// Al final de TODOS los prompts de clip.
export const CLIP_RULES =
  'Fixed camera, no cuts, no zoom, no camera movement. No text, no letters, no numbers, no buttons, no interface, no logos, no other characters. No audio, no music, no ' +
  'speech. Smooth plain gradient background only: no objects, no horizon, no floor texture, no shadows on the background.';

// Encuadre. El texto de la escena ocupa el tercio inferior: los pies van sobre el 60-65 % y el suelo queda vacio.
export const FRAMING: Record<'cinematic' | 'short', Record<Orientation, string>> = {
  cinematic: {
    vertical:
      'Vertical 9:16 frame. The character is centered horizontally, about 55-60% of the frame height, with his feet at about 62% of the frame height. The bottom 30% of the ' +
      'frame is empty background.',
    horizontal:
      'Horizontal 16:9 frame. The character is centered, about 60% of the frame height and no wider than 30% of the frame width, with his feet at about 67% of the frame ' +
      'height. Keep the left and right sides as wide empty background of the same gradient; nothing important within 20% of the left and right edges. The bottom 28% of the ' +
      'frame is empty background. Sparkles and other small effects may spread across the full width of the frame.',
  },
  // Clips cortos: se recortan al cuadrado central dentro de una tarjeta de ~100 px.
  short: {
    vertical:
      'Vertical 9:16 frame. The character is centered and fills the central square of the frame (about 60% of the frame width), full body visible. Keep the top and bottom of ' +
      'the frame as plain empty background.',
    horizontal: '', // los clips cortos solo se piden en vertical
  },
};

export const POSE_FRAMING =
  'Full body, centered, front view, soft even lighting, 1:1 square image, character about 80% of the image height with his feet on a fixed line near the bottom. Plain flat ' +
  'solid magenta (#FF00FF) background with nothing else. No text, no logos, no shadows on the background.';

export type Hex = `#${string}`;

export interface ClipSpec {
  id: string;
  kind: 'cinematic' | 'short';
  title: string;
  // Escena de CinematicScene (solo las cinematicas).
  scene?: string;
  // Degradado diagonal de arriba-izquierda a abajo-derecha (los colores de CinematicScene.tsx), o dos colores en los clips cortos.
  bg: readonly Hex[];
  seconds: string;
  action: string;
  // Clip en bucle: primer y ultimo cuadro iguales.
  loop?: boolean;
  orientations: readonly Orientation[];
  // Ya publicado (por orientacion).
  done?: readonly Orientation[];
}

export interface PoseSpec {
  id: string;
  mood: string;
  priority: 'P0' | 'P1';
  pose: string;
}

export const CLIPS: readonly ClipSpec[] = [
  {
    id: 'A1', kind: 'cinematic', scene: 'welcome', title: 'Entrada epica (primera vez que entra)',
    bg: ['#6D28D9', '#7E22CE', '#3730A3'], seconds: '4 seconds', orientations: ['vertical', 'horizontal'],
    action:
      'the character enters the frame with an energetic hop from just outside the frame, lands in the center with a small bounce, and finishes in a friendly welcoming pose: ' +
      'one hand raised in a wave, a big warm smile. A soft cyan ring of energy glows briefly on the ground around his feet as he lands, then fades. A few tiny golden sparkles ' +
      'float around him. He ends still in the welcoming pose.',
  },
  {
    id: 'A2', kind: 'cinematic', scene: 'lesson_start', title: 'Inicio de leccion (concentracion y entusiasmo)',
    bg: ['#0F172A', '#1E1B4B', '#0F172A'], seconds: '3 to 4 seconds', orientations: ['vertical', 'horizontal'],
    action:
      'the character stands relaxed, pushes his glasses up with one finger with a confident smile, then rubs his hands together eagerly and gives a small excited hop, ready to ' +
      'start. A few soft pale-blue sparkles drift upward behind him. He ends in a ready, smiling pose looking toward the viewer.',
  },
  {
    id: 'A3', kind: 'cinematic', scene: 'module_complete_good', title: 'Celebracion (modulo con 70 % o mas)',
    bg: ['#D97706', '#EA580C', '#E11D48'], seconds: '4 seconds', orientations: ['vertical', 'horizontal'], done: ['vertical'],
    action:
      'the character jumps for joy with both arms raised high, lands, then jumps again with a happy spin, mouth open in a joyful smile. Golden stars and soft warm sparkles burst ' +
      'and spread around him. He lands in a stable proud pose with a big smile, and the sparkles slowly settle.',
  },
  {
    id: 'A4', kind: 'cinematic', scene: 'module_complete_low', title: 'Reflexion calida (modulo con menos de 70 %)',
    bg: ['#075985', '#155E75', '#1E293B'], seconds: '4 seconds, calm and warm', orientations: ['vertical', 'horizontal'],
    action:
      'the character adjusts his glasses thoughtfully, gives a slow, gentle nod, then opens one hand toward the viewer in an encouraging, supportive gesture with a small kind ' +
      'smile. Very slow, soft movement. No sadness, no disappointment, no scolding. He ends in a calm, warm, encouraging pose.',
  },
  {
    id: 'A5', kind: 'cinematic', scene: 'streak', title: 'Hito de racha (3, 5, 10... dias)',
    bg: ['#B91C1C', '#EA580C', '#F59E0B'], seconds: '4 seconds', orientations: ['vertical', 'horizontal'],
    action:
      'the character raises one fist in triumph and does an energetic victory jump, a ring of warm orange energy pulses on the ground and soft glowing ember-like sparkles rise ' +
      'around him (stylized and gentle, not real fire, nothing scary). He lands in a powerful, proud pose with a confident grin.',
  },
  {
    id: 'B1', kind: 'short', title: 'Pensando / esperando (la IA prepara las preguntas, refuerzo, chat)',
    bg: ['#6C5CE7', '#00D2D3'], seconds: '3 seconds seamless loop', loop: true, orientations: ['vertical'],
    action:
      'the character stands thoughtfully with one hand on his chin, glances up and to the side, then back, with a slow gentle sway and a slow blink. Calm and curious, no stress.',
  },
  {
    id: 'B2', kind: 'short', title: 'Triste suave (no se pudo preparar la leccion)',
    bg: ['#6C5CE7', '#00D2D3'], seconds: '3 seconds', orientations: ['vertical'],
    action:
      'the character lowers his gaze with a soft, tender, slightly apologetic expression, shrugs his shoulders gently, then looks up at the viewer with a small hopeful smile as if ' +
      'saying "let\'s try again". Gentle and cute, never dramatic, no tears. He ends in a soft, hopeful pose.',
  },
  {
    id: 'B3', kind: 'short', title: 'Refuerzo completado',
    bg: ['#6C5CE7', '#00D2D3'], seconds: '3 seconds', orientations: ['vertical'],
    action: 'the character gives a happy fist pump and a small proud hop, golden sparkles pop around him, and he ends in a satisfied, smiling pose.',
  },
];

export const POSES: readonly PoseSpec[] = [
  { id: 'P1', mood: 'happy (reposo)', priority: 'P0', pose: 'Standing relaxed with a calm gentle smile, hands in front.' },
  { id: 'P2', mood: 'excited (acierto)', priority: 'P0', pose: 'Joyful, both arms up, eyes wide, lightly leaping.' },
  { id: 'P3', mood: 'encouraging (error, animo)', priority: 'P0', pose: 'One hand extended forward in a supportive gesture, warm gaze, small smile. Never a gesture of reproach.' },
  { id: 'P4', mood: 'thinking', priority: 'P0', pose: 'One hand on his chin, looking up, one eyebrow raised.' },
  { id: 'P5', mood: 'sad', priority: 'P1', pose: 'Eyes lowered, shoulders slightly slumped, soft tender expression, not dramatic.' },
  { id: 'P6', mood: 'surprised', priority: 'P1', pose: 'Eyes and mouth wide open, hands raised in surprise.' },
  { id: 'P7', mood: 'celebrating (nueva)', priority: 'P1', pose: 'Celebrating with both arms high, mouth open with joy, small sparkles around him.' },
  { id: 'P8', mood: 'sleeping (nueva)', priority: 'P1', pose: 'Asleep standing, eyes closed, calm breathing, a small sleep bubble.' },
];

// La linea del fondo: degradado diagonal con los colores de la escena (Flow no clava el color exacto: el arreglo del borde mide el clip real).
export function backgroundLine(bg: readonly Hex[]): string {
  if (bg.length === 3) return `Background: smooth diagonal gradient from ${bg[0]} (top-left) through ${bg[1]} to ${bg[2]} (bottom-right).`;
  return `Background: smooth diagonal gradient from ${bg[0]} (top-left) to ${bg[bg.length - 1]} (bottom-right).`;
}

export function buildClipPrompt(spec: ClipSpec, orientation: Orientation): string {
  if (!spec.orientations.includes(orientation)) throw new Error(`${spec.id} no se pide en ${orientation}`);
  const loop = spec.loop ? ' The first and last frames are identical so the loop is seamless.' : '';
  return [IDENTITY, FRAMING[spec.kind][orientation], backgroundLine(spec.bg), `Action, ${spec.seconds}: ${spec.action}${loop}`, CLIP_RULES].join('\n\n');
}

export function buildPosePrompt(spec: PoseSpec): string {
  return [IDENTITY, `${POSE_FRAMING} ${spec.pose}`].join('\n\n');
}

export const clipById = (id: string): ClipSpec | undefined => CLIPS.find((c) => c.id.toLowerCase() === id.toLowerCase());
export const poseById = (id: string): PoseSpec | undefined => POSES.find((p) => p.id.toLowerCase() === id.toLowerCase());

// Cuantas generaciones faltan: cada (clip, orientacion) no publicada y cada pose.
export function pendingCount(): { clips: number; poses: number; total: number } {
  const clips = CLIPS.reduce((n, c) => n + c.orientations.filter((o) => !c.done?.includes(o)).length, 0);
  return { clips, poses: POSES.length, total: clips + POSES.length };
}

// Documento completo, listo para copiar y pegar.
export function renderPromptsDoc(): string {
  const out: string[] = [];
  out.push('# Toñito: prompts de Flow, ya armados');
  out.push('');
  out.push('> **Generado** por `npm run flow:prompts -- --escribir` desde `src/lib/tonito/flowPrompts.ts`. No se edita a mano: se cambia el catálogo y se vuelve a generar.');
  out.push('> Plan, orden de producción y reglas: [catálogo de animaciones](TONITO_CATALOGO_ANIMACIONES.md).');
  out.push('');
  out.push('**Cada prompt es independiente: se pega completo.** En Flow adjunta siempre la **imagen de referencia aprobada** de Toñito como ingrediente.');
  out.push('Los clips se piden en **9:16 (celular)** y en **16:9 (computador)**; los clips cortos B y las poses, en **una sola proporción**.');
  const p = pendingCount();
  out.push(`Por generar: **${p.clips} clips + ${p.poses} poses = ${p.total}**.`);
  out.push('');
  out.push('## Cinemáticas (A) y clips cortos (B)');
  for (const spec of CLIPS) {
    out.push('');
    out.push(`### ${spec.id} · ${spec.title}${spec.scene ? `  (\`${spec.scene}\`)` : ''}`);
    for (const o of spec.orientations) {
      const done = spec.done?.includes(o);
      const label = o === 'vertical' ? 'Celular, vertical 9:16' : 'Computador, horizontal 16:9';
      out.push('');
      out.push(`**${label}**${done ? ' — ☑ ya publicado (se deja por si hay que rehacerlo)' : ' — ☐ por generar'}`);
      out.push('');
      out.push('```');
      out.push(buildClipPrompt(spec, o));
      out.push('```');
    }
  }
  out.push('');
  out.push('## Poses fijas (imágenes 1:1)');
  for (const spec of POSES) {
    out.push('');
    out.push(`### ${spec.id} · ${spec.mood} — ${spec.priority}`);
    out.push('');
    out.push('```');
    out.push(buildPosePrompt(spec));
    out.push('```');
  }
  out.push('');
  return out.join('\n');
}
