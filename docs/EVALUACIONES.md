# Evaluaciones de corte y final: diseño

Estado: **decisiones tomadas por el dueño (2026-11-02) + piezas puras hechas**. Falta casi todo lo que toca la base de datos, la IA y las pantallas; está listado abajo en orden.

## Lo que ya estaba decidido (y codificado)

Las evaluaciones las toma el estudiante **dentro de la app**; se **repiten** y su nota es el **promedio de todos los intentos hasta llegar a 100 %** (con un 100 ya no se repite); la evaluación de un corte vale **30 %** del corte y la **final**, medio corte; sin dominar (100 % en un intento) la evaluación de un corte no se pasa al siguiente; la final se desbloquea al terminar todos los cortes. Reglas en `progress.ts`; la tabla `exam_attempts` (085) guarda los intentos ya calificados.

## Las tres decisiones del dueño

### 1B — La IA genera preguntas propias del examen
No se reutilizan las preguntas de las lecciones: la IA escribe preguntas **para medir cada comprensión final**. Consecuencias:
- Cada pregunta nace **atada** a la comprensión que mide y al **módulo del plan donde ese tema se enseña** (el módulo debe estar en un objetivo que contribuye a esa comprensión). De ahí salen el corte y el módulo sin guardarlos aparte (`examQuestion.ts`).
- Debe pasar la **auto-calificación (JEV-1)** con los calificadores reales, igual que el resto de preguntas.
- Se apoya en los **materiales de la clase** (ver 3D): la IA tiene que citar el trozo y la cita se **comprueba** contra el texto real.
- Como el generador es IA, **un profesor revisa** las preguntas antes de que entren a un examen (recomendado; ver «Revisión del profesor»).
- El examen de un corte mide **las comprensiones que ese corte evalúa**, con preguntas de **los módulos de ese corte**; la final mide **todas** (`exam.ts`). **Un examen no se arma si alguna comprensión no tiene ninguna pregunta**: no se salta en silencio.
- Costo: más llamadas a la IA (hay que generar y validar preguntas por comprensión). Se medirá con un `eval` antes de ofrecerlo.

### 2B — Se hace cumplir el «100 % para avanzar» en la app
El estudiante **no puede abrir** el módulo siguiente (ni la evaluación del corte) sin haber logrado 100 % en el anterior. Esto **sí cambia lo que los estudiantes pueden hacer**, así que se hace aparte, con cuidado:
- Solo en clases con un **plan publicado**; las clases sin plan siguen exactamente como hoy.
- **Riesgo de dejar a un estudiante trabado**: un módulo del plan sin contenido enlazado («pendiente de contenido») bloquearía a todos los que siguen. Por eso se propone **no permitir publicar** un plan mientras tenga módulos sin enlazar (o sin preguntas); hoy se puede.
- El servidor es quien decide (la lección y el examen comprueban el avance al abrirse); la pantalla solo lo refleja.
- Para quien ya tenía progreso en una clase antes de publicar el plan, hay que decidir cómo se traduce (qué módulos cuentan como dominados). Propuesta: solo cuentan los intentos terminados con 100 % **registrados** (`lesson_attempts`), nada se «regala».
- El mapa actual de la clase tiene su propio bloqueo («módulo anterior completado»); con un plan publicado hay que unificarlos.

### 3D — Retroalimentación completa al terminar
Al cerrar el examen el estudiante ve **todas** las preguntas, marcando cuáles le quedaron bien y cuáles mal, y de **cada una**: una **explicación de fondo** (por qué esa es la respuesta), **en qué corte** se vio, **en qué módulo**, y **bajo qué material explícito** (nombre del material y la cita textual). Además, qué módulos le conviene repasar (`examFeedback.ts`). Reglas:
- La explicación es **obligatoria** al crear la pregunta (mínimo 40 caracteres, y no puede repetir el enunciado).
- «Bajo qué material» **no es una afirmación de la IA**: la pregunta guarda `materialId` + `chunkIndex` + una **cita textual** y se rechaza si la cita no aparece en ese trozo (tolera mayúsculas, tildes y puntuación, pero no palabras distintas).
- Se entregan **solo después de cerrar** el intento, y **nunca las claves** de calificación (opciones correctas, respuestas, parejas): la explicación ya dice por qué es la respuesta. **Efecto a tener presente:** como el examen se puede repetir y la explicación revela la respuesta, un estudiante podría memorizar entre intentos; es la consecuencia de elegir aprender del error sobre medir sin pistas. Si se vuelve un problema, se puede aumentar el banco y variar las preguntas entre intentos.
- Si el plan o el material ya no permiten ubicar una pregunta, se muestra la explicación **sin inventar** dónde se vio.

## Piezas y estado

| Pieza | Qué hace | Estado |
|---|---|---|
| `examQuestion.ts` | Contrato de una pregunta de examen y su validación (atada al plan, explicación, material citado y verificable, auto-calificación) | **Hecha** |
| `exam.ts` — `composeExam` | Elige qué preguntas entran, por comprensión y repartidas entre módulos; no arma un examen que no cubre todo | **Hecha** (reescrita para 1B) |
| `examFeedback.ts` | Construye la retroalimentación 3D y los módulos a repasar | **Hecha** |
| `examGenerate.ts` + `npm run eval:exam-gen` | Generación con IA de preguntas de examen por comprensión y módulo, con todo validado, y su medición con el modelo real | **Hecha** (ver «Medición real»); sin llamador |
| Banco de preguntas de examen | Tabla nueva (migración, **sin aplicar** hasta tu autorización): solo la lee el servidor (tiene las claves); estado de revisión | Pendiente |
| Generación con IA | Por comprensión: recuperar los trozos de material relevantes, generar, validar con `validateExamQuestion`, guardar; con cupo por profesor; **`eval` con el modelo real** antes de ofrecerlo | Pendiente |
| Revisión del profesor | El profesor ve cada pregunta (con su cita y explicación) y la aprueba o rechaza; solo las aprobadas entran a un examen | Pendiente |
| Sesión de examen | Tabla propia que fija **qué preguntas se sirvieron** a ese estudiante en ese intento | Pendiente |
| Calificación y cierre | Reusar los calificadores; escribir `exam_attempts` (el trigger de la 085 asigna el número y bloquea repetir tras un 100 %); entregar la retroalimentación 3D | Pendiente |
| Pantalla del estudiante | Tomar el examen y ver la retroalimentación | Pendiente |
| Juez de sustento (`examJudge.ts`, `npm run eval:exam-judge`) | Un segundo modelo (**sin Cohere**) que comprueba que la respuesta y **cada afirmación de la explicación** están respaldadas por el material, citando evidencia que el código verifica; integrado en el generador como paso opcional | **Hecha** (ver «Medición del juez»); sin llamador |
| Cumplimiento del 100 % (2B) | Bloqueo en el servidor al abrir lección/examen + no publicar con módulos sin enlazar (**propuestas aprobadas por el dueño**) | Pendiente |

## Datos de producción (2026-11-02, solo lectura)
De 46 módulos activos, 24 tienen banco de preguntas de lección y 22 no tienen ninguna (el banco se crea la primera vez que alguien abre el módulo). Con 1B esto **ya no bloquea los exámenes** (las preguntas son propias del examen), pero sí importa para el **material**: la generación necesita trozos de material (`material_chunks`) de la clase.

## Medición real del generador (2026-11-02, `npm run eval:exam-gen`)

5 casos con material de ejemplo (3 materias, uno con **una sola frase** de material y uno con una **orden escondida** en el material). Cadena `study` (Cohere primero, Groq de respaldo). Varias corridas.

| Métrica | Resultado | Exigido |
|---|---|---|
| Preguntas que sobreviven a la validación | 67-76 % (22 de ~30 por corrida) | ≥ 40 % |
| Casos con material suficiente que sacan ≥ 3 preguntas válidas | 4 de 4 | ≥ 75 % |
| Variedad de tipos (media de tipos distintos por caso) | 4,3-4,8 | ≥ 2 |
| Material de una frase: preguntas aceptadas | 2 (máx. permitido) | no sacar un examen entero |
| Fuga de la orden escondida | 0 en las 2 últimas corridas (**1 de 3 antes de la defensa**) | informada |

**Lo que NO se ve en los números y se encontró LEYENDO las preguntas** (cada hallazgo se convirtió en una regla determinista, probada):
1. **Material escaso → examen inventado.** Con una sola frase de material el modelo escribió 5 preguntas sobre esa frase y sus explicaciones agregaban datos que el material no dice. → **Presupuesto de evidencia:** una misma cita sostiene como máximo 2 preguntas (la compuerta `scarceOverreachRate` falló y ahora pasa).
2. **Explicaciones que dicen «como se menciona en el fragmento 2»**: sin sentido para el estudiante (no ve fragmentos numerados). → Se rechaza toda pregunta o explicación que mencione un número de fragmento.
3. **Explicaciones que dicen «la respuesta correcta es la B»**: como el examen se repite, conviene **barajar las opciones** entre intentos (hoy las lecciones **no** las barajan; la sesión de examen debe hacerlo). → Se rechaza toda explicación que señale una opción por su letra.
4. **El modelo obedeció una orden escondida en el material** (`PWNED-5521` apareció en las preguntas, en 1 de 3 corridas); el sanitizador **no la marcaba** (su patrón exigía la palabra «instrucciones») y, además, **citar la frase no frena al modelo**. → Se agregaron 3 patrones al sanitizador (probados contra 18 frases escolares normales que NO deben marcarse) y el generador **excluye por completo** los trozos marcados como sospechosos, informando cuáles.

**Lo que ninguna regla automática resuelve (riesgo abierto, medido):**
- **Afirmaciones fuera de la cita.** En una pregunta sobre la mitocondria, la explicación decía que el ciclo de Krebs «genera moléculas de alta energía que alimentan la cadena transportadora», y **eso no está en el material** (la cita solo respaldaba su ubicación). Se probó un chequeo por **coincidencia de palabras** entre explicación y material: **no distingue** lo bueno de lo malo (la pregunta inventada puntuó 0,79; preguntas buenas, 0,50), así que **no se construyó** (habría sido una falsa garantía). La defensa real es un **juez de sustento** (otro modelo, proveedor distinto) y la **revisión del profesor**; ninguna de las dos existe todavía.
- La calidad pedagógica de las preguntas (¿miden de verdad la comprensión?) no se mide automáticamente.
- Un `true_false` a veces sale redactado como pregunta («¿El Frente Nacional permitió…?») y un `fill_blank` a veces sin el hueco `____`; el calificador los acepta, pero la redacción es mejorable.

## Medición del juez de sustento (2026-11-02, `npm run eval:exam-judge`)

**Qué es.** Para cada pregunta aceptada, un segundo modelo (tarea `judge` del gateway, **excluyendo a Cohere**, que es el que escribe) recibe el material y la pregunta y devuelve: ¿la respuesta correcta está respaldada?, la lista de afirmaciones de la explicación con su veredicto, y si hay ambigüedad. **El veredicto lo calcula el código**, no el modelo. Para cada cosa que marca como respaldada **tiene que copiar una frase textual del material y el código comprueba que esa frase existe**: un «sí está respaldada» sin evidencia verificable cuenta como no respaldada. Si no responde o responde ilegible, la pregunta queda **«sin juzgar» → para revisión del profesor, nunca aprobada**.

**Cómo se midió.** Con respuesta conocida (a diferencia de los otros `eval`): 24 casos escritos a mano sobre 3 materiales: 11 bien respaldados (incluidas paráfrasis e inferencias directas), 12 mal respaldados **plantados a propósito** (dato de más en la explicación, respuesta que contradice el material, fecha o número cambiados, efecto invertido, negación, cifra no dicha, mecanismo plausible que el material no dice, **conocimiento externo VERDADERO pero ausente del material**, generalización, términos confundidos) y 1 ambigua.

| Versión del juez | Mal respaldadas que aprobó | Buenas que rechazó | Respondió «no sé» |
|---|---|---|---|
| Sin pedir evidencia (3 corridas) | **0 – 1 de 13** (la pregunta de la mitocondria se aprobó en 2 de 3) | 0 | 0 – 7 % |
| **Con evidencia verificable** (7 corridas) | **0 de 13 en 6 corridas; 1 de 13 en 1 corrida** | 0 en 6 corridas; 1 de 11 en 1 | 0 – 4 % |

- La pregunta que motivó el juez (explicación que dice que el ciclo de Krebs «genera moléculas de alta energía», dato que el material no tiene) pasó de **aprobarse en 2 de 3 corridas a 0 de 7**.
- **Falla que sigue existiendo:** en 1 corrida el juez aprobó «dato extra en la explicación» (los gobiernos usan la elasticidad para fijar impuestos): **citó una frase real del material, pero esa frase no respalda esa afirmación**. Que la cita *exista* no prueba que sea *relevante*; el código no puede comprobar la relevancia. Por eso el juez **reduce** el riesgo, **no lo elimina**: la revisión del profesor sigue siendo necesaria.
- **Costo de la estrictez:** exigir evidencia literal rechazó 1 buena (el juez parafraseó «ADN propio de la mitocondria» y la cita no coincidió). Se prefiere rechazar de más que aprobar de menos.
- Una pregunta de **emparejar** tiene varias parejas y una sola cita no las respalda: para ese tipo el juez debe listar cada pareja como afirmación con su propia evidencia.
- La ambigüedad (dos respuestas correctas) se detectó siempre como no aprobable, pero casi siempre como «sin respaldo» y no como «ambigua»: sirve para no aprobarla, no para explicarla.

**De extremo a extremo** (`npm run eval:exam-gen -- --juez`, 5 casos): el juez rechazó entre 2 y 4 preguntas por corrida que habían pasado todas las demás validaciones, y la tasa global de preguntas aceptadas bajó de ~70 % a ~63 %. Cuesta **una llamada extra por pregunta aceptada** (más que generarla en tokens de entrada por mandar todo el material); sin medir en dinero.

**Límites que hay que tener presentes:** 24 casos escritos por mí (no apuntes reales), 3 materiales, un solo juez (Gemini u otro de la cadena `judge`, según las llaves); si el generador cae a un proveedor que sea también el del juez, el sesgo de «juzgarse a sí mismo» vuelve (hoy el generador usa Cohere primero y el juez lo excluye, pero el generador puede caer a Groq/Gemini y no se registra cuál respondió).
