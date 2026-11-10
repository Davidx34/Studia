# Doctrina pedagógica global (memoria global de «esencia»)

Estado: construida y **apagada en los prompts** (2026-11-09). Código en `src/lib/aiLearning/doctrine/`; pantalla en cada clase: pestaña «Doctrina».

## Qué es
Conocimiento curado de investigación educativa que **todas las clases heredan**: **44 principios** en 7 dominios, con **41 fuentes** de revistas y editoriales de referencia (Psychological Science, Psychological Bulletin, Review of Educational Research, Science, Educational Researcher, Cambridge University Press, Carnegie Mellon, National Research Council, ASCD…).

| Dominio | Principios |
|---|---|
| Cómo se aprende | 16: práctica de recuperación, práctica espaciada, intercalar, dificultades deseables, carga cognitiva, inversión de la pericia, zona de desarrollo próximo, fracaso productivo, conocimiento previo, organización del conocimiento, práctica dirigida, dominio antes de avanzar, autorregulación, ilusión de dominio, instrucción en pasos, diseño multimedia |
| Evaluación y redacción de preguntas | 9: alineación objetivo–evidencia, niveles cognitivos, redacción de opción múltiple, distractores de errores reales, clave defendible, respuestas cortas verificables, evaluación formativa, pruebas de bajo riesgo, cobertura y dificultad |
| Retroalimentación | 4: sobre la tarea, puede dañar, elogio de proceso, próximo paso concreto |
| Motivación y emociones | 4: autonomía–competencia–relación, expectativa–valor, emociones de logro, mentalidad de crecimiento (discutida) |
| Creatividad, indagación y conocimiento del profesor | 4: mini-c, creatividad y conocimiento, andamiaje en indagación (discutida), conocimiento didáctico del contenido |
| Interpretación de resultados | 2: muestras pequeñas (Wilson), comparar con intervalo (Newcombe) |
| Lo que NO hay que creer ni hacer | 5: estilos de aprendizaje, «10 000 horas», descubrimiento sin guía, «cuanto más difícil mejor», rendimiento inmediato |

Cada principio trae: **enunciado propio** (no copia de obras), **regla operativa** para la IA (en imperativo), **límites**, **nivel de evidencia** (fuerte, moderada, limitada, discutida) y **fuentes**.

## Cómo se garantiza que las citas existen
El 2026-11-09 se verificó por búsqueda en línea que **36 de las 41 fuentes existen con esos datos bibliográficos** (autores, año, revista, volumen, páginas, DOI cuando coincidía entre fuentes; se **omiten** las páginas o el DOI donde las fuentes discrepaban). Las 5 restantes son libros clásicos citados como referencia y están marcadas **«pendiente de verificar»** en la pantalla: Downing y Haladyna (2006), Wiliam (2011), Vygotsky (1978), Amabile (1996), Sawyer (2012). Un test impide que un principio de evidencia **fuerte** se apoye solo en fuentes sin verificar y exige que más del 85 % de las fuentes estén verificadas.
**Qué significa «verificada»:** la obra existe y sus datos son esos. **No** significa que se haya releído la obra completa: por eso cada principio lleva su resumen y sus límites, y las cifras que no se pudieron comprobar (p. ej. el tamaño de efecto 0,4–0,7 de Black y Wiliam) **no se usan** (hay un test).

## Honestidad sobre la evidencia (matices que la doctrina conserva)
- **Retroalimentación:** Kluger y DeNisi hallaron que ~1/3 de las intervenciones **empeoró** el desempeño; la doctrina no dice «da retroalimentación» a secas.
- **Mentalidad de crecimiento:** efecto pequeño en dos metaanálisis (Sisk et al., 2018); marcada **discutida**, no entra a los prompts.
- **Estilos de aprendizaje:** sin respaldo experimental (Pashler et al., 2008); la IA tiene el principio contrario.
- **Práctica deliberada / «10 000 horas»:** las réplicas hallan un efecto menor que el original (Macnamara y Maitra, 2019).
- **Aprendizaje para el dominio (Bloom):** la cifra de «dos sigmas» viene de pocos estudios; la doctrina prohíbe prometerla.
- **Guía mínima vs. indagación:** controversia real (Kirschner et al. 2006 / Hmelo-Silver et al. 2007); marcada **discutida**.

## Cómo se aplica (y cómo se nota)
1. **Selección por tarea** (`select.ts`): generar preguntas, retroalimentar, interpretar resultados, investigar, planificar, juzgar. Determinista, máximo 5 principios, tope de 1 400 caracteres; las etiquetas del contexto (tipo de pregunta, profundidad) cambian la selección. Los mitos y la evidencia discutida **nunca** entran como regla.
2. **Perfil operacional** (`persona.ts`): los 7 rasgos pedidos (profesional, estricto, creativo, pedagógico, investigativo, pragmático, analítico) convertidos en **conductas con su forma de comprobarlas** y asignadas a la tarea donde aplican. Un adjetivo no mejora a un modelo; una conducta que se verifica, sí.
3. **Prompt de generación:** `buildGenerationPrompt` agrega el bloque solo si `useDoctrine` es verdadero, que los dos generadores toman de la variable **`DOCTRINE=on`**. Apagada, el prompt es **idéntico** al de antes (test).
4. **Retrospectiva:** cada sugerencia muestra su **«Fundamento»** (principios y autores). Funciona siempre, sin bandera, porque no cambia lo que genera la IA.
5. **Pantalla «Doctrina»:** muestra todo (principios, fuentes con su estado de verificación, límites, perfil) y dice si la doctrina está aplicada o no.

## Por qué está apagada
Regla del sistema: **nada cambia el comportamiento de la IA sin evidencia.** Que un principio esté bien respaldado en la literatura **no demuestra** que agregarlo al prompt de ESTE generador reduzca los errores. Se enciende (`DOCTRINE=on` en Vercel) solo cuando el experimento A/B (`scripts/ab-generation.ts`, PR de medición, con `--doctrina`) diga **«mejora»**. Hoy no hay esa evidencia: el primer experimento con reglas de redacción quedó incompleto por créditos agotados de Gemini y mostró efecto techo (el generador base ya aprueba ~93 % en esos módulos). Ver `docs/IA_ARQUITECTURA_DE_MEMORIAS.md` §8.

## Cómo agregar o corregir un principio
1. Verificar la fuente en línea (autores, año, revista, páginas) y registrarla en `sources.ts` con `verified: true` y la fecha; si no se pudo, `verified: false`.
2. Escribir el principio en su dominio con enunciado propio, regla operativa (≤ 330 caracteres, sin `<>#` ni saltos de línea), límites y nivel de evidencia **honesto** (si hay controversia: `discutida`).
3. Subir `DOCTRINE_VERSION`. Los tests validan integridad (ids únicos, fuentes existentes y usadas, cobertura mínima por tarea).

## Pendiente
- Repetir el experimento A/B con la doctrina cuando haya créditos de Gemini, en módulos con línea base más baja.
- Más principios (la doctrina crece por dominios): diferenciación y accesibilidad, evaluación de proyectos y rúbricas, lectura y comprensión, ciencias y matemáticas por área.
- Verificar las 5 fuentes pendientes.

## Actualización 2026-11-10: primer experimento con la doctrina
Corrido el A/B de tres brazos (base, reglas, doctrina; 120 preguntas por brazo): **sin evidencia de efecto** (doctrina −0,2 pp, IC −5,3 a +4,3 pp), con la métrica en el techo (base 98,3 %). **La doctrina sigue apagada.** Que no haya mejora medible **no la invalida** como contenido de referencia ni como material de transparencia (la pantalla «Doctrina» y el «Fundamento» de las sugerencias siguen activos); solo significa que **no hay evidencia para meterla al prompt de generación**. Detalle y qué medir ahora en `docs/IA_ARQUITECTURA_DE_MEMORIAS.md` §9.
