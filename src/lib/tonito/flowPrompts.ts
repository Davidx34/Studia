// Prompts de Flow/Gemini para el arte de Toñito, YA ARMADOS, con el FORMATO QUE SI FUNCIONO: el de la celebracion (docs/TONITO_PRUEBA_DE_CONCEPTO.md §11), que salio perfecta.
//
// Una primera version en ingles con un bloque de identidad generico ("Amigurumi crochet 3D doll...") dio un personaje DISTINTO a Toñito. Lo que tiene el prompt probado y aquel no:
//   1. empieza NOMBRANDO al personaje y a la imagen: "Mismo personaje de la imagen de referencia: Toñito, ...";
//   2. "No cambies su diseño ni su ropa en ningun momento";
//   3. la ACCION POR TIEMPOS (0 a 0,5 s, 0,5 a 2,5 s...), terminando en una pose estable;
//   4. secciones: Accion, Encuadre, Fondo, Efectos y "Muy importante, evita";
//   5. nada que contradiga el encuadre (sin suelo, sin entradas desde fuera del cuadro).
// Es UN solo caso de exito contra UN fallo, asi que la causa exacta es una hipotesis; el formato probado es lo mas seguro que hay.
//
// Funciones puras (sin red ni disco). `npm run flow:prompts` los imprime o escribe docs/TONITO_FLOW_PROMPTS.md.

export type Orientation = 'vertical' | 'horizontal';

// Siempre igual, al principio de TODO prompt. Se adjunta ademas la imagen de referencia aprobada.
export const IDENTITY =
  'Mismo personaje de la imagen de referencia: Toñito, un muñeco amigurumi de crochet renderizado en 3D, con textura de lana visible y cabeza grande. Lleva casco de safari beige con ' +
  'banda, gafas redondas grandes de montura oscura, moño, bata blanca de laboratorio sobre chaleco marrón, pantalón escocés beige y marrón, y botas marrones. Su rostro es joven y ' +
  'redondo, de lana color durazno con mejillas rosadas, sin cabello gris ni arrugas. No cambies su diseño ni su ropa en ningún momento.';

// Al final de todo prompt.
export const AVOID =
  'Muy importante, evita: cualquier texto, letras, números, subtítulos, logotipos, botones, iconos de play, banners o elementos de interfaz. Sin otros personajes. Sin cambios de escena. ' +
  'Sin música ni voz.';

const CAMERA = 'cámara completamente fija, sin zoom, sin movimiento de cámara y sin cortes.';

// Encuadre. El texto de la escena ocupa el tercio inferior: los pies van sobre el 62-67 % y el suelo (el tercio de abajo) queda VACIO.
export function framing(kind: 'cinematic' | 'short', orientation: Orientation): string {
  if (kind === 'short') {
    return (
      `Encuadre: ${CAMERA} Toñito de cuerpo entero, centrado, ocupando el cuadrado central del cuadro (alrededor del 60 % del ancho). La parte de arriba y la de abajo del cuadro quedan ` +
      'libres, de fondo liso. Nunca sale del encuadre.'
    );
  }
  if (orientation === 'vertical') {
    return (
      `Encuadre: ${CAMERA} Toñito de cuerpo entero, centrado horizontalmente, y siempre dentro del 60 % central del ancho. Mide alrededor del 55-60 % de la altura del cuadro y sus pies ` +
      'quedan a la altura del 62 % del cuadro: el cuerpo se mantiene en la mitad superior y media y el tercio inferior queda completamente libre, solo fondo. Nunca sale del encuadre.'
    );
  }
  return (
    `Encuadre: ${CAMERA} Toñito de cuerpo entero, centrado, de alrededor del 60 % de la altura del cuadro y no más ancho que el 30 % del ancho. Sus pies quedan a la altura del 67 % del ` +
    'cuadro. Los lados izquierdo y derecho quedan como fondo amplio y vacío del mismo degradado: nada importante a menos del 20 % de los bordes. El tercio inferior queda libre, solo ' +
    'fondo. Nunca sale del encuadre.'
  );
}

export type Hex = `#${string}`;
export interface ColorStop {
  name: string;
  hex: Hex;
}

export interface ClipSpec {
  id: string;
  kind: 'cinematic' | 'short';
  title: string;
  // Escena de CinematicScene (solo las cinematicas).
  scene?: string;
  // Degradado diagonal de arriba-izquierda a abajo-derecha (los colores de CinematicScene.tsx).
  bg: readonly ColorStop[];
  seconds: number;
  // La accion POR TIEMPOS, terminando en una pose estable (en los bucles: primer y ultimo cuadro iguales).
  action: string;
  effects: string;
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

const STREAK_BG: readonly ColorStop[] = [
  { name: 'rojo', hex: '#B91C1C' },
  { name: 'naranja', hex: '#EA580C' },
  { name: 'ámbar', hex: '#F59E0B' },
];
const CARD_BG: readonly ColorStop[] = [
  { name: 'violeta azulado', hex: '#6C5CE7' },
  { name: 'turquesa', hex: '#00D2D3' },
];

export const CLIPS: readonly ClipSpec[] = [
  {
    id: 'A1', kind: 'cinematic', scene: 'welcome', title: 'Entrada épica (primera vez que entra)', seconds: 4, orientations: ['vertical', 'horizontal'],
    bg: [{ name: 'violeta', hex: '#6D28D9' }, { name: 'púrpura', hex: '#7E22CE' }, { name: 'índigo', hex: '#3730A3' }],
    action:
      '0 a 0,6 s: Toñito aparece en el centro del cuadro con un salto enérgico hacia arriba. 0,6 a 1,6 s: aterriza en el centro con un pequeño rebote. 1,6 a 4 s: se queda en una pose de ' +
      'bienvenida estable: una mano levantada saludando, sonrisa grande y cálida, casi quieto. El video termina en esa pose estable.',
    effects:
      'un anillo de energía ciano brilla un instante alrededor de sus pies cuando aterriza y se desvanece. Pocos destellos dorados muy pequeños flotan a su alrededor. Que no tapen su cara.',
  },
  {
    id: 'A2', kind: 'cinematic', scene: 'lesson_start', title: 'Inicio de lección (concentración y entusiasmo)', seconds: 4, orientations: ['vertical', 'horizontal'],
    bg: [{ name: 'azul noche', hex: '#0F172A' }, { name: 'índigo muy oscuro', hex: '#1E1B4B' }, { name: 'azul noche', hex: '#0F172A' }],
    action:
      '0 a 1 s: Toñito está de pie, relajado, y se sube las gafas con un dedo con una sonrisa segura. 1 a 2,6 s: se frota las manos con ganas y da un pequeño salto emocionado. 2,6 a 4 s: ' +
      'se queda en una pose lista para empezar, sonriendo y mirando al frente, casi quieto. El video termina en esa pose estable.',
    effects: 'pocos destellos azul pálido que suben suavemente detrás de él. Pequeños, que no tapen su cara.',
  },
  {
    id: 'A3', kind: 'cinematic', scene: 'module_complete_good', title: 'Celebración (módulo con 70 % o más)', seconds: 4, orientations: ['vertical', 'horizontal'], done: ['vertical'],
    bg: [{ name: 'ámbar', hex: '#D97706' }, { name: 'naranja', hex: '#EA580C' }, { name: 'rosa frambuesa', hex: '#E11D48' }],
    action:
      '0 a 0,5 s: Toñito está de pie, relajado y sonriente, en el centro del cuadro. 0,5 a 2,5 s: salta de alegría con los brazos en alto y cae. 2,5 a 4 s: se queda en una pose de celebración ' +
      'estable, sonriendo, casi quieto, con los puños cerrados de alegría. El video termina en esa pose estable.',
    effects: 'pocos destellos blancos y cremas y algunas estrellitas doradas muy claras alrededor de Toñito durante el salto. Pocos y pequeños, que no tapen su cara.',
  },
  {
    id: 'A4', kind: 'cinematic', scene: 'module_complete_low', title: 'Reflexión cálida (módulo con menos de 70 %)', seconds: 4, orientations: ['vertical', 'horizontal'],
    bg: [{ name: 'azul', hex: '#075985' }, { name: 'cian', hex: '#155E75' }, { name: 'pizarra', hex: '#1E293B' }],
    action:
      '0 a 1,2 s: Toñito está de pie y se ajusta las gafas con calma, pensativo. 1,2 a 2,8 s: asiente despacio, con suavidad. 2,8 a 4 s: abre una mano hacia quien mira, en un gesto de apoyo y ' +
      'ánimo, con una sonrisa pequeña y amable, casi quieto. Todos los movimientos son muy lentos y suaves. Sin tristeza, sin decepción y sin ningún gesto de regaño. El video termina en esa ' +
      'pose estable, cálida y alentadora.',
    effects: 'casi ninguno: como mucho unas pocas partículas de luz muy suaves y lentas, lejos de su cara.',
  },
  {
    id: 'A5', kind: 'cinematic', scene: 'streak', title: 'Hito de racha (3, 5, 10... días)', seconds: 4, orientations: ['vertical', 'horizontal'], bg: STREAK_BG,
    action:
      '0 a 0,6 s: Toñito está de pie, sonriente, en el centro del cuadro. 0,6 a 2,4 s: levanta un puño con orgullo y da un salto de victoria enérgico. 2,4 a 4 s: aterriza en una pose poderosa y ' +
      'orgullosa, con una sonrisa de confianza, casi quieto. El video termina en esa pose estable.',
    effects:
      'un anillo de energía naranja cálida pulsa alrededor de sus pies cuando aterriza, y unos destellos suaves parecidos a brasas suben a su alrededor (estilizados y amables, no fuego real, nada que ' +
      'asuste). Pocos y pequeños, que no tapen su cara.',
  },
  {
    id: 'B1', kind: 'short', title: 'Pensando / esperando (la IA prepara las preguntas, refuerzo, chat)', seconds: 3, loop: true, orientations: ['vertical'], bg: CARD_BG,
    action:
      'Bucle perfecto de 3 s. 0 a 1 s: Toñito está de pie con una mano en la barbilla, pensativo. 1 a 2 s: mira hacia arriba y hacia un lado, y luego vuelve la mirada al frente, con un balanceo ' +
      'suave y un parpadeo lento. 2 a 3 s: vuelve exactamente a la pose del principio. El primer cuadro y el último son idénticos para que el bucle no se note. Tranquilo y curioso, sin estrés.',
    effects: 'ninguno.',
  },
  {
    id: 'B2', kind: 'short', title: 'Triste suave (no se pudo preparar la lección)', seconds: 3, orientations: ['vertical'], bg: CARD_BG,
    action:
      '0 a 1,2 s: Toñito baja la mirada con una expresión suave y tierna, un poco apenada. 1,2 a 2,2 s: se encoge de hombros con delicadeza. 2,2 a 3 s: levanta la mirada hacia quien mira con una ' +
      'pequeña sonrisa esperanzada, como diciendo "intentémoslo otra vez", y queda casi quieto. Tierno y simpático, nunca dramático, sin lágrimas. El video termina en esa pose estable.',
    effects: 'ninguno.',
  },
  {
    id: 'B3', kind: 'short', title: 'Refuerzo completado', seconds: 3, orientations: ['vertical'], bg: CARD_BG,
    action:
      '0 a 0,5 s: Toñito está de pie, sonriente. 0,5 a 1,8 s: cierra el puño con alegría y da un pequeño salto orgulloso. 1,8 a 3 s: queda en una pose satisfecha, sonriendo, casi quieto. El video ' +
      'termina en esa pose estable.',
    effects: 'pocos destellos dorados pequeños que aparecen alrededor de él durante el salto. Que no tapen su cara.',
  },
];

export const POSES: readonly PoseSpec[] = [
  { id: 'P1', mood: 'happy (reposo)', priority: 'P0', pose: 'De pie, relajado, con una sonrisa tranquila y amable, las manos al frente.' },
  { id: 'P2', mood: 'excited (acierto)', priority: 'P0', pose: 'Alegre, con los dos brazos en alto, los ojos muy abiertos, dando un saltito.' },
  { id: 'P3', mood: 'encouraging (error, ánimo)', priority: 'P0', pose: 'Una mano extendida hacia adelante en un gesto de apoyo, mirada cálida y una sonrisa pequeña. Nunca un gesto de reproche.' },
  { id: 'P4', mood: 'thinking', priority: 'P0', pose: 'Una mano en la barbilla, mirando hacia arriba, con una ceja levantada.' },
  { id: 'P5', mood: 'sad', priority: 'P1', pose: 'La mirada baja, los hombros un poco caídos, expresión suave y tierna, nada dramática.' },
  { id: 'P6', mood: 'surprised', priority: 'P1', pose: 'Ojos y boca muy abiertos, las manos levantadas por la sorpresa.' },
  { id: 'P7', mood: 'celebrating (nueva)', priority: 'P1', pose: 'Celebrando con los dos brazos en alto, la boca abierta de alegría, con pequeños destellos a su alrededor.' },
  { id: 'P8', mood: 'sleeping (nueva)', priority: 'P1', pose: 'Dormido de pie, con los ojos cerrados y respiración tranquila, con una pequeña burbuja de sueño.' },
];

// "De arriba a la izquierda a abajo a la derecha: ámbar (#D97706), naranja (#EA580C) y rosa frambuesa (#E11D48)." Los colores de la escena; Flow no clava el hex exacto (el clip real se mide al publicar).
export function backgroundLine(bg: readonly ColorStop[]): string {
  const stops = bg.map((c) => `${c.name} (${c.hex})`);
  const lista = stops.length === 1 ? stops[0] : `${stops.slice(0, -1).join(', ')} y ${stops[stops.length - 1]}`;
  return (
    'Fondo: degradado suave y mate en diagonal, sin objetos, sin suelo, sin horizonte y sin sombras marcadas. De arriba a la izquierda a abajo a la derecha: ' + lista + '.'
  );
}

const orientationWord = (o: Orientation): string => (o === 'vertical' ? 'vertical 9:16' : 'horizontal 16:9');

export function buildClipPrompt(spec: ClipSpec, orientation: Orientation): string {
  if (!spec.orientations.includes(orientation)) throw new Error(`${spec.id} no se pide en ${orientation}`);
  return [
    `Video ${orientationWord(orientation)} de ${spec.seconds} segundos. ${IDENTITY}`,
    `Acción: ${spec.action}`,
    framing(spec.kind, orientation),
    backgroundLine(spec.bg),
    `Efectos: ${spec.effects}`,
    AVOID,
  ].join('\n\n');
}

export const POSE_FRAMING =
  'Imagen cuadrada 1:1, de cuerpo entero, centrado, de frente, con iluminación suave y pareja. Toñito ocupa alrededor del 80 % de la altura y sus pies quedan siempre sobre una misma línea ' +
  'fija, cerca del borde inferior.';

export const POSE_BACKGROUND = 'Fondo: color magenta plano y liso (#FF00FF), sin nada más: sin objetos, sin degradado y sin sombras sobre el fondo.';

export const POSE_AVOID = 'Muy importante, evita: cualquier texto, letras, números, logotipos o elementos de interfaz. Sin otros personajes.';

export function buildPosePrompt(spec: PoseSpec): string {
  return [`Imagen. ${IDENTITY}`, `Pose: ${spec.pose}`, `Encuadre: ${POSE_FRAMING}`, POSE_BACKGROUND, POSE_AVOID].join('\n\n');
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
  out.push('**Cada prompt es independiente: se pega completo, tal cual.** Están en el formato que **sí funcionó** con la celebración (en español, por secciones y con la acción por tiempos).');
  out.push('');
  out.push('**Antes de generar, siempre:**');
  out.push('1. **Adjunta la imagen de referencia aprobada de Toñito** como ingrediente/referencia. Sin ella Flow inventa un personaje.');
  out.push('2. **Genera primero UNA** (por ejemplo A1 vertical) y compárala con la referencia **antes de hacer las demás**.');
  out.push('3. Revisa: ¿es Toñito (cara redonda de lana color durazno, mejillas rosadas, casco, gafas, moño, bata, pantalón escocés)? ¿los pies caen cerca del 62 % de la altura? ¿el tercio inferior está vacío?');
  out.push('');
  out.push('**Si el personaje no se parece:** no cambies el prompt a ciegas. Prueba (a) volver a adjuntar la referencia, (b) generar 2 o 3 variantes y quedarte con la mejor, (c) acortar la acción a menos movimientos.');
  out.push('');
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
