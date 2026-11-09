import type { Principle } from '../types';

export const CREATIVIDAD: Principle[] = [
  {
    id: 'creatividad_mini_c',
    domain: 'creatividad_e_indagacion',
    title: 'La creatividad también ocurre al aprender (mini-c)',
    essence:
      'La creatividad no es solo de genios: interpretar algo de forma nueva y personalmente significativa mientras se aprende es una forma de creatividad ligada al aprendizaje.',
    apply: 'Cuando el tema lo permita, incluye preguntas que pidan un ejemplo propio, una analogía o aplicar la idea a una situación nueva, con criterios de evaluación explícitos.',
    limits: 'Evaluar respuestas abiertas es difícil de automatizar: usa criterios explícitos y revisión humana.',
    evidence: 'limitada',
    sources: ['beghetto2007'],
    tasks: ['generar_pregunta', 'planificar'],
    tags: ['creatividad', 'aplicar', 'ejemplo_propio'],
  },
  {
    id: 'creatividad_y_conocimiento',
    domain: 'creatividad_e_indagacion',
    title: 'Crear exige dominar lo básico y sentir interés',
    essence:
      'La creatividad depende de dominar el área, de habilidades de pensamiento flexible y de motivación intrínseca. Sin conocimiento previo no hay materia con la que crear.',
    apply: 'Pide tareas de creación solo después de asegurar lo básico, deja margen para elegir el enfoque y evita que las recompensas externas dominen la tarea.',
    limits: 'Marco de la psicología de la creatividad; el efecto de las recompensas depende del tipo de tarea.',
    evidence: 'limitada',
    sources: ['amabile1996', 'sawyer2012'],
    tasks: ['planificar', 'generar_pregunta'],
    tags: ['creatividad', 'dominio'],
  },
  {
    id: 'andamiaje_en_indagacion',
    domain: 'creatividad_e_indagacion',
    title: 'Indagar con andamiaje',
    essence:
      'El aprendizaje por problemas o por indagación funciona bien cuando está muy andamiado. La crítica a la guía mínima no aplica de la misma manera a propuestas con apoyo estructurado.',
    apply: 'Si propones indagación, entrega estructura: pregunta clara, pasos, ejemplos y puntos de control, y retira el apoyo gradualmente.',
    limits: 'El debate entre instrucción guiada y aprendizaje por indagación sigue abierto y depende del nivel del estudiante.',
    evidence: 'discutida',
    sources: ['hmelo2007', 'kirschner2006'],
    tasks: ['planificar', 'investigar'],
    tags: ['indagacion', 'andamiaje'],
  },
  {
    id: 'conocimiento_didactico',
    domain: 'creatividad_e_indagacion',
    title: 'Saber el tema y saber cómo enseñarlo',
    essence:
      'Enseñar bien un tema exige conocerlo y además saber cómo representarlo, qué ejemplos y analogías funcionan y qué errores suelen cometerse (conocimiento didáctico del contenido).',
    apply: 'Para cada concepto prepara una explicación breve, un ejemplo concreto, un contraejemplo y el error más frecuente.',
    limits: 'Si este conocimiento es medible como constructo propio sigue en discusión.',
    evidence: 'moderada',
    sources: ['shulman1986', 'ambrose2010'],
    tasks: ['generar_pregunta', 'retroalimentar', 'planificar', 'investigar'],
    tags: ['explicacion', 'ejemplo', 'errores'],
  },
];

export const DATOS: Principle[] = [
  {
    id: 'muestras_pequenas',
    domain: 'datos',
    title: 'Con pocas respuestas, un porcentaje es casi ruido',
    essence:
      'Un porcentaje calculado con pocas respuestas puede variar mucho de una muestra a otra. Un intervalo de confianza muestra cuánto; el intervalo de Wilson se comporta bien con muestras pequeñas.',
    apply: 'Antes de interpretar un porcentaje indica cuántas respuestas lo sustentan; con muy pocas (menos de 10 a 20 por pregunta, menos de 5 lecciones por módulo) di «no hay datos suficientes» y no concluyas.',
    limits: 'Los mínimos son criterios prácticos del proyecto, no umbrales universales.',
    evidence: 'fuerte',
    sources: ['wilson1927'],
    tasks: ['interpretar_resultados', 'juzgar'],
    tags: ['datos', 'muestra', 'intervalo'],
  },
  {
    id: 'comparar_con_intervalo',
    domain: 'datos',
    title: 'Comparar dos versiones con un intervalo de la diferencia',
    essence:
      'Para decidir si una versión es mejor que otra se comparan proporciones con un intervalo de confianza de la diferencia. Si el intervalo incluye el cero no hay evidencia de mejora, lo cual no equivale a demostrar que no sirve.',
    apply: 'Declara «mejora» solo si el intervalo de la diferencia queda entero del lado favorable y hay muestra mínima; si no, di «sin evidencia» y pide más datos.',
    avoid: 'No atribuyas una mejora a una causa sin comparar contra un grupo sin el cambio en las mismas condiciones.',
    limits: 'Método para dos proporciones independientes; con datos pareados o muchas comparaciones hay que ajustar.',
    evidence: 'fuerte',
    sources: ['newcombe1998', 'wilson1927'],
    tasks: ['interpretar_resultados', 'juzgar'],
    tags: ['datos', 'comparacion', 'experimento'],
  },
];

export const MITOS: Principle[] = [
  {
    id: 'mito_estilos_de_aprendizaje',
    domain: 'mitos',
    title: 'Los «estilos de aprendizaje»',
    essence:
      'Adaptar la enseñanza al supuesto estilo de cada estudiante (visual, auditivo, kinestésico) no cuenta con respaldo experimental adecuado. Que las personas tengan preferencias es real; que enseñar según ellas mejore el aprendizaje no se ha demostrado.',
    apply: 'No etiquetes estudiantes por estilos ni prometas personalizar por estilo; personaliza por conocimiento previo y desempeño.',
    limits: 'La revisión advierte que no todas las versiones posibles se han puesto a prueba; lo que falta es evidencia que justifique usarlas en la práctica general.',
    evidence: 'fuerte',
    sources: ['pashler2008'],
    tasks: ['retroalimentar', 'planificar', 'investigar'],
    tags: ['mito', 'personalizacion'],
    antiPrinciple: true,
  },
  {
    id: 'mito_diez_mil_horas',
    domain: 'mitos',
    title: 'Las «10 000 horas» para la maestría',
    essence:
      'La idea popular de que acumular cierto número de horas de práctica basta para la maestría exagera los hallazgos. La práctica explica solo una parte de las diferencias de desempeño, y las réplicas encuentran efectos menores que el estudio original.',
    apply: 'No prometas maestría por cantidad de práctica; recomienda práctica con foco y retroalimentación.',
    limits: 'La práctica sí importa; lo discutible es cuánto explica y la cifra mágica.',
    evidence: 'moderada',
    sources: ['ericsson1993', 'macnamara2019'],
    tasks: ['retroalimentar', 'planificar'],
    tags: ['mito', 'practica'],
    antiPrinciple: true,
  },
  {
    id: 'mito_descubrimiento_sin_guia',
    domain: 'mitos',
    title: 'Dejar que principiantes descubran solos',
    essence:
      'Pedir a quien está empezando que descubra los conceptos sin guía suele ser poco eficiente. Esto se refiere a la guía mínima: el aprendizaje por indagación con andamiaje es otra propuesta y puede funcionar.',
    apply: 'No propongas actividades abiertas sin estructura a quien aún no domina las bases.',
    limits: 'La discusión entre ambas posturas sigue abierta.',
    evidence: 'discutida',
    sources: ['kirschner2006', 'hmelo2007'],
    tasks: ['planificar', 'investigar'],
    tags: ['mito', 'indagacion'],
    antiPrinciple: true,
  },
  {
    id: 'mito_mas_dificil_es_mejor',
    domain: 'mitos',
    title: '«Cuanto más difícil, mejor»',
    essence:
      'Solo ayudan las dificultades que obligan a procesar la idea. Aumentar la dificultad con trampas o enunciados rebuscados frustra sin enseñar.',
    apply: 'No subas la dificultad con trampas ni con enunciados rebuscados; hazla venir del razonamiento que se exige.',
    limits: 'Qué cuenta como dificultad deseable depende del conocimiento previo del estudiante.',
    evidence: 'moderada',
    sources: ['bjork2011'],
    tasks: ['generar_pregunta', 'juzgar'],
    tags: ['mito', 'dificultad'],
    antiPrinciple: true,
  },
  {
    id: 'mito_rendimiento_inmediato',
    domain: 'mitos',
    title: 'Un buen resultado inmediato no prueba que se aprendió',
    essence:
      'El rendimiento durante la práctica puede no reflejar el aprendizaje duradero: lo que se siente fácil y fluido suele olvidarse antes.',
    apply: 'No uses el acierto inmediato como prueba de dominio: confírmalo con repaso espaciado días después.',
    limits: 'Un mal resultado inmediato tampoco prueba que no se aprendió; hace falta una segunda medición.',
    evidence: 'moderada',
    sources: ['bjork2011', 'dunlosky2013'],
    tasks: ['interpretar_resultados', 'planificar'],
    tags: ['mito', 'dominio', 'espaciado'],
    antiPrinciple: true,
  },
];
