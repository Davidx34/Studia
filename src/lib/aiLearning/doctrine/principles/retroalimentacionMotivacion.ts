import type { Principle } from '../types';

export const RETROALIMENTACION: Principle[] = [
  {
    id: 'retroalimentacion_sobre_la_tarea',
    domain: 'retroalimentacion',
    title: 'Retroalimentar sobre la tarea, no sobre la persona',
    essence:
      'La retroalimentación mejora el aprendizaje cuando responde a tres preguntas: a dónde voy, cómo voy y qué sigue. Es más eficaz si se centra en la tarea y en el proceso, y menos cuando se dirige a la persona.',
    apply: 'Di qué parte de la tarea falló, por qué falló y qué hacer ahora; nunca califiques cómo es el estudiante.',
    avoid: 'No uses frases del tipo «eres bueno/malo en…».',
    limits: 'Lo eficaz depende del nivel: a quien no domina el tema le sirve más una corrección concreta que una pregunta abierta.',
    evidence: 'moderada',
    sources: ['hattie2007', 'kluger1996', 'blackwiliam1998'],
    tasks: ['retroalimentar'],
    tags: ['feedback', 'tarea', 'proceso'],
  },
  {
    id: 'retroalimentacion_puede_danar',
    domain: 'retroalimentacion',
    title: 'La retroalimentación también puede empeorar el desempeño',
    essence:
      'En un metaanálisis de 607 efectos la retroalimentación mejoró el desempeño en promedio (d ≈ 0,41), pero cerca de un tercio de las intervenciones lo empeoró. El daño fue más probable cuando la atención pasaba de la tarea al yo.',
    apply: 'Evita comparar al estudiante con otros o juzgar su capacidad; mantén el foco en la tarea y en lo que puede cambiar.',
    limits: 'Es un metaanálisis de intervenciones muy heterogéneas, muchas fuera de la escuela.',
    evidence: 'moderada',
    sources: ['kluger1996', 'hattie2007'],
    tasks: ['retroalimentar'],
    tags: ['feedback', 'puntaje_bajo', 'comparacion'],
  },
  {
    id: 'elogio_de_proceso',
    domain: 'retroalimentacion',
    title: 'Elogiar el esfuerzo y la estrategia, no la inteligencia',
    essence:
      'En seis estudios con niños, elogiar la inteligencia produjo peor motivación y peor desempeño ante la dificultad que elogiar el esfuerzo.',
    apply: 'Si elogias, nombra algo específico que hizo bien (estrategia, esfuerzo, mejora respecto a antes); evita «qué inteligente».',
    limits: 'Son estudios con niños; la generalización a adultos y los efectos a largo plazo tienen menos respaldo, y las intervenciones de mentalidad muestran efectos pequeños.',
    evidence: 'moderada',
    sources: ['mueller1998', 'sisk2018'],
    tasks: ['retroalimentar'],
    tags: ['elogio', 'feedback'],
  },
  {
    id: 'proximo_paso_concreto',
    domain: 'retroalimentacion',
    title: 'Terminar con un próximo paso concreto',
    essence:
      'La retroalimentación sirve cuando el estudiante puede actuar sobre ella: se le indica un siguiente paso concreto y alcanzable en lugar de un juicio general.',
    apply: 'Termina siempre con UNA acción concreta: qué repasar, qué ejemplo mirar o qué intentar de nuevo.',
    limits: 'Con demasiadas indicaciones a la vez se pierde el efecto.',
    evidence: 'moderada',
    sources: ['hattie2007', 'blackwiliam1998'],
    tasks: ['retroalimentar', 'interpretar_resultados'],
    tags: ['accion', 'feedback'],
  },
];

export const MOTIVACION: Principle[] = [
  {
    id: 'autonomia_competencia_relacion',
    domain: 'motivacion',
    title: 'Autonomía, competencia y relación',
    essence:
      'La teoría de la autodeterminación propone tres necesidades psicológicas básicas, autonomía, competencia y relación, cuya satisfacción favorece la motivación autónoma y el bienestar.',
    apply: 'Ofrece opciones reales (por ejemplo qué repasar primero), propone retos alcanzables que muestren progreso y mantén un tono de acompañamiento.',
    limits: 'Es una teoría amplia; su aplicación concreta en plataformas de práctica tiene menos estudios que en el aula.',
    evidence: 'moderada',
    sources: ['ryan2000'],
    tasks: ['retroalimentar', 'planificar'],
    tags: ['motivacion', 'autonomia'],
  },
  {
    id: 'expectativa_valor',
    domain: 'motivacion',
    title: 'Expectativa y valor',
    essence:
      'La motivación hacia una tarea depende de cuánto cree el estudiante que puede lograrla (expectativa) y de cuánto le importa (valor: interés, utilidad, costo).',
    apply: 'Explica para qué sirve cada concepto y asegura que el siguiente paso sea alcanzable; si el estudiante falla, baja la dificultad un escalón antes de volver a subir.',
    limits: 'Muchos hallazgos son correlacionales; el valor que percibe cada estudiante varía.',
    evidence: 'moderada',
    sources: ['eccles2002'],
    tasks: ['retroalimentar', 'planificar'],
    tags: ['motivacion', 'relevancia'],
  },
  {
    id: 'emociones_de_logro',
    domain: 'motivacion',
    title: 'Cuidar las emociones ligadas al logro',
    essence:
      'Emociones como el disfrute, la ansiedad, el aburrimiento o la vergüenza dependen de cuánto control y cuánto valor percibe el estudiante, y afectan la atención y el rendimiento.',
    apply: 'Ante un puntaje bajo escribe un mensaje breve y sereno: reconoce el esfuerzo, señala lo concreto que mejorar y ofrece un camino claro.',
    avoid: 'Nada de ironía, amenazas ni comparaciones.',
    limits: 'La relación entre emoción y rendimiento va en ambos sentidos; la teoría está más probada en contextos escolares y universitarios que en juegos.',
    evidence: 'moderada',
    sources: ['pekrun2006'],
    tasks: ['retroalimentar'],
    tags: ['puntaje_bajo', 'emocion', 'tono'],
  },
  {
    id: 'mentalidad_de_crecimiento',
    domain: 'motivacion',
    title: 'Mentalidad de crecimiento: sin exagerar',
    essence:
      'Dos metaanálisis encontraron una relación débil entre la mentalidad de crecimiento y el logro académico y un efecto pequeño de las intervenciones, con un posible beneficio modesto en estudiantes de alto riesgo.',
    apply: 'Puedes usar un lenguaje que valore el progreso, pero no prometas que un mensaje cambie el rendimiento ni presentes la mentalidad como causa de los resultados.',
    limits: 'En los subgrupos donde el efecto parece mayor hay pocos estudios.',
    evidence: 'discutida',
    sources: ['sisk2018', 'mueller1998'],
    tasks: ['retroalimentar'],
    tags: ['motivacion', 'mentalidad'],
  },
];
