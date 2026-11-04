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
| Banco de preguntas de examen (migración 088, `examBank.ts`, `/api/exam-bank`) | Tabla `exam_questions` con las claves (solo la lee el profesor dueño; **jamás un estudiante**), estado de revisión (pendiente / aprobada / rechazada) y lo que dijo el juez; guardar lo generado, aprobar/rechazar, y armar el banco que usa `composeExam` | **Hecha, migración SIN aplicar** |
| Generación con IA (`examChunks.ts`, `examFlow.ts`, acción `generate` de `/api/exam-bank`) | Por comprensión y módulo: recupera los trozos de material relevantes (búsqueda híbrida real de la clase), genera, valida, pasa el juez y guarda **pendiente**; con cupo por profesor (`examGenerate`: 3/min, 20/h, 80/día). Devuelve solo un resumen, nunca el contenido | **Hecha** (ver «Generación con material real»); sin pantalla |
| Revisión del profesor (`examReviewView.ts`, pantalla `/teacher/classrooms/[id]/plan/examen`) | Por comprensión: cada pregunta con su clave, explicación, material y cita, y el aviso del juez; aprobar o rechazar; lo que pide atención (juez sin decidir o sin pasar) va primero; botón para generar más. Se lee con la sesión del profesor (RLS) y se escribe por `/api/exam-bank` | **Hecha**; verificada con pruebas de marcado, **no vista en navegador con datos reales** |
| Sesión de examen (`examSession.ts`, `examRun.ts`, migración 089 **aplicada**) | Qué preguntas se sirven y cómo se barajan, lo que ve el estudiante sin claves, empezar/retomar y entregar | **Hecha** (rutas `/api/exam`); sin pantalla |
| Calificación y cierre (`gradeSession`, `close_exam_session`) | Califica contra lo servido con los calificadores reales, escribe `exam_attempts` y entrega la retroalimentación 3D; entregar dos veces no da otro intento | **Hecha**; verificada de punta a punta (ver «Rutas del examen») |
| Pantalla del estudiante (`/my-classes/[id]/course/exam/[examId]`, `examForm.ts`) | Empezar o retomar, contestar los 5 tipos de pregunta, entregar y ver la retroalimentación 3D; enlace desde el recorrido del curso cuando la evaluación está desbloqueada | **Hecha**; ver «Pantalla del estudiante» para lo verificado |
| Juez de sustento (`examJudge.ts`, `npm run eval:exam-judge`) | Un segundo modelo (**sin Cohere**) que comprueba que la respuesta y **cada afirmación de la explicación** están respaldadas por el material, citando evidencia que el código verifica; integrado en el generador como paso opcional | **Hecha** (ver «Medición del juez»); sin llamador |
| Cumplimiento del 100 % (2B) (`courseGate.ts`, `lessonAccess.ts`, bloqueo al publicar) | El servidor niega abrir una lección o una evaluación que el plan publicado ordena después de algo sin dominar; un plan con módulos sin enlazar no se publica | **Hecho**; ver «Cumplimiento del 100 %» |

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

## Banco de preguntas de examen (migración 088, **aplicada 2026-11-02**)

**Tabla `exam_questions`.** Cada pregunta pertenece a **una versión del plan** (no se copia entre versiones: los ids de módulo pueden reutilizarse con otro significado al regenerar) y nace **atada** a tres cosas que **la base comprueba**: la comprensión que mide y el módulo donde se ve (el módulo debe estar en un objetivo que contribuye a esa comprensión; los ids viajan como variables de `jsonpath`, no concatenados), el **material de la misma clase** (con la cita) y una explicación de fondo. Un tipo solo puede ser de los 5 que el servidor califica y la **forma de la clave** la exige la base según el tipo (opción correcta dentro del rango, verdadero/falso booleano, respuestas no vacías, ≥ 2 parejas…).

**Seguridad.**
- La tabla **tiene las claves de calificación**: la lee solo el profesor dueño (para revisar) y el servidor. **No hay ninguna política para estudiantes**: se verificó que un estudiante matriculado, con el plan **publicado** y la pregunta **aprobada**, ve **0 filas**.
- Nadie escribe desde el navegador (solo `SELECT`); escribe el servidor tras comprobar sesión y propiedad.
- Una pregunta **nace siempre pendiente** (la base rechaza insertarla aprobada).
- **El contenido no se edita** (enunciado, clave, explicación, material, cita, veredicto y motivos del juez): lo que el profesor aprobó es lo que se sirve. Para cambiarla se rechaza y se genera otra. Solo cambia la revisión, y revisada ⇔ tiene fecha de revisión.
- «No juzgada por el juez» (`not_judged`) **no es lo mismo que aprobada**; solo el profesor aprueba, y un examen solo usa las aprobadas.

**Servidor.** `examBank.ts` (base inyectada, probada): guardar lo generado (con el veredicto y los motivos del juez; un enunciado repetido se cuenta y no tira las demás), `reviewQuestion` (el profesor aprueba o rechaza; valida id y decisión antes de tocar nada; la base comprueba que la pregunta es de **esa clase**; `pending` no es una decisión válida), `approvedPool` (solo ids y tipos de las **aprobadas**, lo que consume `composeExam`) y `bankSummary` (por comprensión: aprobadas, pendientes, rechazadas y cuántas piden atención; una comprensión **sin aprobadas** no se puede examinar). `POST /api/exam-bank` con la acción `review` (sesión + dueño de la clase; el revisor sale de la sesión; nunca devuelve el contenido de la pregunta).

**Verificada contra la base real sin aplicarla** (transacción revertida, 28 comprobaciones): pregunta válida; módulo que no enseña la comprensión, inexistente o con caracteres raros; comprensión inexistente; material de otra clase; nace aprobada; enunciado repetido; forma de la clave por tipo (5 casos); explicación y cita cortas; aprobar sin fecha; editar enunciado, clave y veredicto; rechazar después de aprobar; RLS de profesor / **estudiante** / otro usuario / anon; insertar, actualizar y borrar desde el navegador; plan archivado; cascada al borrar el plan. Después se confirmó que no quedó nada (la tabla no existe).

**Pantalla de revisión hecha; nada sirve aún el examen a un estudiante.**

## Generación con material real (2026-11-02, `scripts/probe-exam-gen.ts`, solo lectura)

La sonda arma un plan en memoria, recupera los trozos reales de una clase (11 PDF de microeconomía) y genera con los modelos reales, sin escribir en la base. Lo que mostró:

- **El modelo devuelve «casi JSON»**: bloques ```json, `"ok": False` (Python) y comas colgando. Con eso se perdía la respuesta entera. `lenientJson.ts` repara solo esos defectos y solo fuera de las cadenas de texto.
- **Respuestas de completar de 15 palabras** (se califican por texto exacto: nadie las acierta). Regla nueva: 1 a 5 palabras y 40 caracteres. Y se rechaza la pregunta que ya trae la respuesta escrita en el enunciado.
- **Tema «elasticidad»** (prosa): 4 preguntas válidas, el juez aprobó las 4.
- **Tema «restricción presupuestaria»** (PDF con fórmulas): 1 a 2 válidas de 5. Los rechazos eran **correctos**, no un fallo del texto del PDF: citas empalmadas de dos sitios, «citas» hechas de restos de fórmula (` = − `), un `match` con tres claves `source`. Se añadió orientación al prompt (una sola frase de prosa, sin fórmulas, un `source`) y mejoró poco: con material de fórmulas el rendimiento es bajo y el sistema falla **hacia el lado seguro** (rechaza lo que no puede probar). Sin arreglo determinista: tolerar texto de PDF alterado dejaría pasar citas inventadas.
- **Casi-duplicados y símbolos sueltos** (probando la pantalla con la clase real): al generar otra vez salió «¿Qué representa…?» junto a la aprobada «¿Qué mide…?» con la misma cita (el índice único solo ve enunciados idénticos), y una pregunta de completar con un «−» suelto de la fórmula. Ahora (`examSimilar.ts`) se rechaza lo que se parece a una pregunta existente de esa comprensión **en cualquier estado** o de la misma tanda: parecido de palabras ≥ 0,75, o ≥ 0,5 si son del mismo tipo y misma cita; antes del juez, así no se gasta. A la IA se le muestran las últimas 15 existentes para que no las repita. Un símbolo de fórmula aislado entre comas (`, − ,`) en el enunciado o la explicación se rechaza. Medido sobre las 9 preguntas reales: 2 pares marcados, ambos duplicados auténticos, 0 falsos positivos. Límite: es parecido de palabras, no de significado; una paráfrasis con otras palabras puede pasar.
- **No medido:** la calidad pedagógica de las preguntas aceptadas (solo se leyeron a mano 6) ni el rendimiento sobre otros materiales.

## Sesión de examen: diseño (piezas puras hechas; tabla y rutas pendientes)

**Flujo.** (1) El estudiante pide empezar una evaluación (un corte o la final) de un plan **publicado**. (2) El servidor elige las preguntas **aprobadas** con `startExam` (repartidas por comprensión y módulo, con el barajado de opciones por intento) y las guarda en una **sesión**. (3) Al estudiante le llega cada pregunta con `presentQuestion`: **sin clave, sin explicación, sin fuente, sin veredicto del juez**. (4) Al terminar, manda sus respuestas; el servidor califica con `gradeSession` contra **lo que se sirvió** (no contra lo que diga el navegador), escribe el intento (`exam_attempts`, cuyo trigger de la 085 asigna el número y bloquea repetir tras 100 %) y devuelve la retroalimentación 3D (`buildExamFeedback`).

**Decisiones de las piezas puras** (con su porqué):
- **Las opciones se barajan por intento.** Las lecciones no barajan las de opción múltiple (se midió); el examen se repite hasta el 100 %, y sin barajar se resolvería memorizando la posición. Las opciones traen una letra («A. …») que al barajar dejaría de coincidir con la posición: se **quita** y la pantalla pone las letras por posición. Por eso la explicación no puede nombrar una letra (regla de la generación).
- **El estudiante contesta una posición de lo que vio**; el servidor la traduce a la original con el barajado guardado. Sin barajado guardado, una opción múltiple es incorrecta (no se adivina).
- **Lo que falta o viene mal cuenta como incorrecto**; nunca tira ni regala puntos. Las respuestas a preguntas que no son del examen se ignoran.
- Se reusan los calificadores reales (`gradeAnswer`), así que **heredan sus límites conocidos** (p. ej. completar y respuesta corta aceptan si la respuesta *contiene* la palabra esperada).

**Migración 089 (`exam_sessions`, escrita y verificada, **sin aplicar**).** Tabla con las preguntas servidas (5 a 60, en orden), el barajado, vigencia (máximo 12 h), y al cerrar los resultados por pregunta, el puntaje y el intento escrito. Seguridad: **ninguna política para estudiantes** y ninguna escritura desde el navegador (solo `SELECT` del profesor dueño; escribe el servidor). Última barrera en la base: plan publicado, estudiante matriculado, corte existente, evaluación no dominada (100 %), preguntas existentes, **aprobadas** y **de ese plan**, sin repetidas, barajado solo de preguntas servidas; una sesión nace abierta; lo servido no cambia nunca; cerrar es de un solo sentido, con **un true/false por cada pregunta servida** y un **puntaje que coincide con esos resultados**. Una sola sesión abierta por estudiante y evaluación; una vencida sin cerrar se descarta al empezar otra. El cierre es **atómico**: `close_exam_session` (SECURITY INVOKER, solo `service_role`) escribe el intento (su trigger de la 085 asigna el número y bloquea tras el 100 %) y cierra la sesión en una sola transacción.

**Verificada contra la base real sin aplicarla** (transacción revertida; la base quedó sin tabla, funciones ni cambios): 41 comprobaciones. Sesión válida; segunda abierta (rechazada) y la final coexistiendo con el corte; pregunta rechazada, repetidas, inexistente, barajado ajeno, 4 preguntas, no matriculado, corte inexistente, final con corte, nacida cerrada y vigencia de 13 h (todo rechazado); lo servido no se edita (preguntas, barajado, estudiante); cierre con puntaje 150 **no deja nada a medias** (sin intento y la sesión sigue abierta); cierre correcto (intento 1, 40 %); cerrar dos veces, modificar una cerrada y cerrar una inexistente (rechazados); una vencida se guarda, no se puede cerrar y se descarta al empezar otra; 100 % cierra y ya no hay más sesiones; permisos (`authenticated` y `anon` no ejecutan `close_exam_session`, solo `service_role`; `authenticated` solo `SELECT`; ninguna función `SECURITY DEFINER`); un estudiante ve 0 sesiones y no puede insertar, el profesor dueño las ve. Coherencia del cierre manual (resultados incompletos, no booleanos, de una pregunta ajena, puntaje que no coincide, sin intento) rechazada y el cierre coherente **sí** se acepta (control positivo).

Lo que **no** se probó: concurrencia real (dos inicios o dos cierres simultáneos; hay un bloqueo asesor y `FOR UPDATE` pero no se ejercitaron con dos conexiones) ni el rendimiento con muchas sesiones.

**Falta:** la pantalla del estudiante.

## Rutas del examen (`POST /api/exam`, acciones `start` y `submit`)

`examRun.ts` (flujo con la base inyectada) y `examRunDb.ts` (adaptador); la ruta solo comprueba sesión y cupo (`examSession`: 12/min, 60/h) y llama al flujo. El estudiante sale **de la sesión**, nunca del cuerpo. **Empezar** exige matrícula y plan publicado, sirve preguntas aprobadas sin claves y **retoma** la sesión abierta y vigente (recargar no da otro examen; una vencida no se retoma). **Entregar** califica contra lo que se sirvió, cierra de forma atómica (`close_exam_session`) y devuelve la retroalimentación 3D; **entregar otra vez devuelve lo mismo, sin otro intento**. Tras el 100 % no se puede empezar otra (409). Los mensajes son para el estudiante y no filtran detalles del banco ni de la base.

**Verificada de punta a punta contra la base real** (clase de prueba, estudiante matriculado, 8 preguntas aprobadas): el profesor no matriculado recibe 403; empezar sirve las 8 preguntas **sin ninguna clave** (opciones barajadas y sin letras); recargar retoma las mismas; entregar con 1 error da 87,5 % (intento 1) y la pregunta fallada, con corte, módulo y material, y el módulo a repasar; entregar otra vez devuelve lo mismo y sigue habiendo **1** intento en la base; un nuevo intento baraja las opciones distinto; entregar perfecto da 100 % (intento 2, dominada); empezar tras dominar da 409; las 2 sesiones quedan cerradas con resultados completos.

**Qué salió mal y por qué importa:** para esa prueba publiqué el plan de prueba de la clase y, al terminar, **no pude devolverlo a borrador**: la base (085) solo permite `draft → published → archived`. Hubo que **archivarlo**; el profesor tendrá que crear un borrador nuevo (v2). Mientras estuvo publicado, un estudiante matriculado pudo verlo. Las pruebas que exijan un plan publicado deben hacerse en una transacción revertida o en una clase desechable.

**No verificado:** la ruta **por HTTP** con una sesión de estudiante real (se ejercitó el flujo con el adaptador real, no el `POST`); la pantalla del estudiante.

## Pantalla del estudiante

`/my-classes/[id]/course/exam/[examId]` (`examId` = el id del corte o `final`): la página lee el plan **publicado** con la sesión del estudiante (RLS) y `ExamClient` habla solo con `/api/exam`. Fases: introducción → respondiendo → resultado. Retomar tras recargar usa el borrador guardado en la pestaña (`sessionStorage`, validado contra las preguntas de la sesión, así que un borrador alterado no se cuela). Entregar con preguntas sin contestar pide confirmación y dice que cuentan como incorrectas. El resultado muestra el puntaje, qué repasar y **cada pregunta** marcada correcta/incorrecta con texto e icono (no solo color), la explicación, el corte, el módulo y el material con su cita; si no llegó al 100 % ofrece intentar de nuevo. Desde el recorrido del curso, una evaluación desbloqueada lleva a esta pantalla (y se quitó el aviso «todavía no está disponible en la app»).

**Verificada en el navegador** (sesión de estudiante real, clase desechable con plan publicado y 6 preguntas aprobadas, ya borrada): la introducción; empezar sirve las 6 preguntas barajadas y mueve el foco al título; el contador «Contestadas X de 6»; entregar con preguntas sin contestar pide confirmación («Te faltan 3…») y «Seguir contestando» vuelve; **recargar retoma** la misma sesión (mismo orden, mismo vencimiento) con las respuestas restauradas del borrador; contestar los 5 tipos con los controles reales; entregar da 83,33 % (5 de 6) con la fallada marcada, «qué repasar» y, de cada pregunta, explicación, corte, módulo y material con su cita; el borrador se limpia al entregar; «Intentar de nuevo» da otro orden de preguntas y de opciones y sin respuestas heredadas; el intento perfecto da 100 %, «dominada» y sin botón de reintento; empezar de nuevo tras dominar muestra el mensaje y no abre nada; un `examId` inexistente muestra «no está disponible». **Móvil (375 px):** sin scroll horizontal y botones de 44 px. **Contraste:** oscuro 4,86–16,3, claro 6,29–15,99.

**Defecto encontrado al probar:** los mensajes del servidor salían **sin tildes** («Ya dominaste esta evaluacion»); corregidos, con una prueba que lo vigila (su primera versión no detectaba nada por un `` convertido en carácter de control; se rehízo y se comprobó que ahora sí falla ante el defecto).

**No verificado:** lector de pantalla real (solo se comprobó que las etiquetas estén asociadas y que el foco se mueva al título); la entrega con dos pestañas a la vez (concurrencia real); preguntas largas o con símbolos raros en pantallas pequeñas.

**Límite conocido:** la evaluación **no se exige** todavía para avanzar (la regla del 100 %, propuesta 2B, es el siguiente paso); hoy el servidor la sirve a cualquier estudiante matriculado cuando el plan está publicado y hay preguntas aprobadas.

## Cumplimiento del 100 % (2B)

Las dos propuestas del dueño, aplicadas en el **servidor** (lo que la pantalla dice «Bloqueado» es lo que el servidor niega: ambas usan la misma cuenta, `buildCourseView`):

1. **No se publica un plan con módulos sin enlazar** (`publishDraft`, comprobado **antes** de archivar nada). Un módulo del plan sin módulo real no se puede dominar y, como los siguientes esperan al anterior, atascaría el curso. Un enlace a un módulo que ya no existe en la clase cuenta como sin enlazar. La respuesta lista los módulos que faltan; la pantalla del profesor deshabilita «Publicar» y dice cuáles faltan.
2. **Abrir lecciones y evaluaciones exige lo anterior al 100 %.**
   - **Lecciones:** `/api/generate-questions` (sin preguntas no hay lección ni intento) niega con 403 y `code: 'locked'` antes del repaso, del caché y de la generación: no se gasta nada. La pantalla de la lección muestra el motivo («Sigue: «Uno». Necesitas 100 %…») y lleva al recorrido. El Mapa pasa por el mismo bloqueo.
   - **Evaluaciones:** `/api/exam` (`start`) exige dominar los módulos del corte; la final, todos los cortes.
   - **Solo cuentan los intentos terminados y registrados por el servidor** (`lesson_attempts`, `exam_attempts`): el progreso viejo que el navegador se escribía no sirve de prueba (propuesta aprobada).

**Qué NO se toca:** una clase sin plan publicado; un módulo que no está enlazado en el plan; un profesor o quien no está matriculado; un módulo ya dominado (se puede repasar). **Si no se pueden leer los intentos** (falla de infraestructura o sin llave de servicio) **no se bloquea** y se registra (`LESSON_GATE_DEGRADED` / `LESSON_GATE_ERROR`): no se castiga al estudiante por una falla nuestra.

**Hoy no afecta a nadie:** en producción no hay ningún plan publicado (solo uno de prueba archivado), así que ninguna clase real cambia hasta que un profesor publique un plan.

**Verificado:** la lógica pura (`courseGate`: 14 pruebas), `lessonAccess` (9), el bloqueo al publicar (6) y el de las evaluaciones (5), con mutación (21 cambios, 19 detectados y 2 equivalentes). **En el navegador con una sesión de estudiante real** y una clase desechable (ya borrada): el recorrido muestra «Dos» bloqueado; abrir su lección directamente da **403** y la pantalla explica qué falta, sin crear intentos ni generar preguntas; la evaluación del corte da 403 con el motivo y sin sesión; al marcar el módulo 1 al 100 %, la lección 2 **pasa el bloqueo**.

**Bloqueo al publicar, verificado contra la base real** (piezas reales del servidor, clase desechable ya borrada): guardar el borrador; publicar **sin enlaces** → 422 con los dos módulos que faltan; enlazar uno y publicar → 422 con el que falta, y el plan sigue en borrador; enlazar los dos y publicar → publicado. **No verificado:** el bloqueo al publicar **en el navegador del profesor** ni por HTTP (solo la lógica contra la base y el marcado de la pantalla; hace falta una sesión de profesor); el bloqueo con dos pestañas a la vez; el efecto sobre un estudiante con progreso previo en una clase que ya tuviera un plan publicado (no existe ninguna hoy).

## Completar en un examen: palabra completa y una sola respuesta

**Defecto hallado** (al revisar qué calificaba `gradeAnswer` para el examen, medido): para la respuesta «elástica», el calificador de las lecciones **acepta «inelástica»** (la *contiene*), acepta «la demanda no es inelástica» y acepta una lista de términos del tema; y con dos «respuestas aceptadas» exige **las dos a la vez** (es la semántica de la app: todas deben aparecer), aunque el generador las trataba como alternativas. En una evaluación que se repite hasta el 100 %, eso regala puntos.

**Arreglo, solo para exámenes** (los calificadores de las lecciones no se tocan: es la decisión abierta del hueco de subcadena):
- `gradeFillBlank` (en `examSession.ts`): la respuesta debe aparecer como palabras, en ese orden y seguidas (cada una igual o con una terminación de hasta 3 letras: «elásticas», «precios»; nunca con otro comienzo: «inelástica»), sin tildes ni mayúsculas ni puntuación, y el texto no puede pasar de la respuesta más larga **+ 3 palabras** («la demanda es elástica» cabe; una lista no).
- `validateExamQuestion`: una pregunta de completar tiene **exactamente una respuesta y un solo espacio** (`____`). El prompt lo pide y pide cuidar que el opuesto o la negación no se confundan con la respuesta.
- Aprovechando la medición con el modelo real: el prompt ahora exige **escribir todo en español** (en una de tres tandas salió una pregunta en inglés a partir de un fragmento en inglés del material; con la regla, 3 de 3 tandas en español).

**Límites que quedan:** con hasta 3 palabras de más todavía se puede «apostar» a dos términos; las preguntas de **respuesta corta** siguen calificándose por «contiene cada palabra clave» (como las lecciones); y las lecciones conservan el hueco. La medición del prompt nuevo es de 3 tandas de una sola clase.

## El hueco de «contiene» en las lecciones: decidido y cerrado

**Decisión (delegada por el dueño):** las lecciones usan la **misma idea** que el examen, pero más suave para no romper lo que ya funcionaba. Una función única, `containsExpected` (`lesson/normalize.ts`), la usan el calificador del servidor (`gradeAnswer`) y el del navegador (que duplicaba el `includes`): **contiene, sin tildes ni mayúsculas, pero la aparición no puede empezar a mitad de una palabra**. «inelástica» ya no vale por «elástica» (ni «desventaja» por «ventaja», ni «microeconomía» por «economía»); «precios» sigue valiendo por «precio» (plural, género, conjugación). Una respuesta esperada vacía nunca se cumple.

**Por qué esa y no «palabra completa» como en el examen:** en lecciones no hay tope de intentos ni un 100 % que defender cada vez, y la palabra completa estricta rechazaría plurales y conjugaciones que hoy se aceptan. En el **examen** (`gradeFillBlank`) se acepta la palabra con una terminación de hasta 3 letras («elásticas», «precios»), nunca con otro comienzo, y con tope de 3 palabras de más.

**Medido antes de decidir:** en producción **ningún estudiante ha contestado nunca** una pregunta de completar o de respuesta corta (0 respuestas registradas), así que no hay evidencia de que la regla vieja le sirva a nadie ni se rompe a nadie; y la **respuesta perfecta de las 233 preguntas de ese tipo del banco sigue acertando**.

**Límites que quedan:** una respuesta de **un solo carácter** (16 preguntas del banco; `selfGrade` ya avisa) todavía se cumple con cualquier palabra que *empiece* por esa letra; un sufijo numérico («150» por «15») sigue valiendo; y respuesta corta sigue siendo «contiene cada palabra clave» (no entiende el significado).

## Concurrencia (verificada contra la base real)

Prueba con la base real y una clase desechable ya borrada (módulo enlazado y dominado, 6 preguntas aprobadas), **a nivel de flujo + adaptador** (no por HTTP):
- **20 inicios simultáneos** de la misma evaluación: **1 sola sesión** en la base y las 20 respuestas con las mismas preguntas. Antes de este cambio, 17 recibían la sesión y 3 un 409 «recarga la página»; ahora quien pierde la carrera **retoma la sesión ganadora** (el índice único y el bloqueo asesor de la 089 ya garantizaban la única sesión).
- **10 entregas simultáneas** de la misma sesión: **1 solo intento** escrito (83,33 %) y las 10 devuelven el **mismo resultado y retroalimentación** (9 como «ya entregada»). Antes, las 9 perdedoras recibían un 409; ahora reciben el resultado de la entrega ganadora (la suya no suma otro intento ni cambia la nota).
- La garantía de fondo sigue siendo de la base (`FOR UPDATE` en `close_exam_session`, trigger de la 085, índice único de la sesión abierta); el flujo solo traduce la carrera en una respuesta útil.

**No verificado:** concurrencia **por HTTP** con varias pestañas reales; carga sostenida (solo 20 y 10 solicitudes simultáneas).

## Re-medición del generador con material de fórmulas (2026-11-03)

La medición inicial del tema «restricción presupuestaria» (PDF con fórmulas) daba **1 a 2 válidas de 5**, con rechazos correctos por citas empalmadas o hechas de restos de fórmula. Tras las mejoras posteriores (orientación de cita en el prompt, una sola respuesta por completar, símbolos sueltos rechazados, español obligatorio, sin casi-duplicados) se **volvió a medir con el modelo real, sin juez**: «restricción presupuestaria» **7, 6 y 7 válidas de 8** pedidas (3 tandas) y «función de utilidad» **8 y 7 de 8** (2 tandas). Se descartó rediseñar la cita (que el modelo señale el número de frase y el código copie el texto): con este rendimiento no compensa.

**Límites:** son 5 tandas de una clase y de dos temas; sin juez (el juez rechazó entre 0 y 1 por tanda en las mediciones anteriores); una pregunta válida **no** es una pregunta buena: la calidad pedagógica sigue sin medirse y la revisión del profesor sigue siendo obligatoria.

## Calidad de las preguntas de completar y respuesta corta (2026-11-04)

**Qué reportó el dueño al probar una lección real (Microeconomía):** (1) las fórmulas se ven mal; (2) las respuestas cortas no son claras y la respuesta **no se puede escribir** (pide una fórmula con «≤»); (3) terminó con 2/5 y pudo seguir al siguiente módulo (ver abajo).

**Lo que mostraban los datos reales de esas 5 preguntas:**
- Completar: «La restricción presupuestaria se define como _____, donde  y  son las cantidades de bienes… y  e  son sus precios.» con la respuesta `pxx + pyy ≤ W`: los símbolos de la fórmula **se perdieron al leer el PDF** (quedaron espacios dobles) y la respuesta es imposible de teclear.
- Respuesta corta: palabras clave «restricción presupuestaria», «precio» y «desplazamiento»; las dos primeras **ya estaban en el enunciado** y una respuesta correcta como «se desplaza hacia adentro» no cumplía la tercera.
- En todo el banco servible (523 preguntas): **55 % de las palabras clave de respuesta corta ya estaban en el enunciado** (104 de 189), 10 respuestas de completar eran fórmulas o símbolos y 12 ya estaban escritas en la oración.

**Qué se hizo (`lesson/typability.ts`, aplicado por `isValidQuestion` y por el validador del examen):**
- Una respuesta (completar) o palabra clave (respuesta corta) debe poder **escribirse con el teclado**: letras, números y signos de palabra; sin `≤ ≥ < > = + * / ^ _ { }`, sin LaTeX, máximo 6 palabras y 60 caracteres. Si la respuesta natural es una fórmula, la pregunta debe ser de opción múltiple.
- Una palabra clave **no puede estar ya en el enunciado**; la respuesta corta lleva de 1 a 5 palabras clave; una respuesta de completar no puede estar ya escrita en la oración.
- Una pregunta con **huecos de fórmula perdida** («donde  y  son», paréntesis o `$ $` vacíos, comas sueltas) en el enunciado, las opciones o los pares **no se genera ni se sirve**.
- Como `isValidQuestion` también filtra lo que ya existe, las preguntas malas **dejan de servirse sin tocar la base**: de 523 preguntas servibles se apartan 77 (15 %): 49 de 65 de respuesta corta, 26 de 86 de completar, 1 de emparejar y 1 de opción múltiple. Siguen en la base; el profesor puede verlas.
- El prompt de generación de las lecciones pide ahora: respuesta corta con 1–3 conceptos claros en el enunciado, palabras clave escribibles, que no estén en el enunciado y en forma de raíz cuando hay variantes (`desplaz`); completar con una sola respuesta escribible de ≤ 3 palabras; si lo natural es una fórmula, usar opción múltiple.

**Límites:** son reglas de forma, no de significado: una respuesta corta sigue calificándose por palabras clave (no entiende paráfrasis); el banco se reducirá en respuestas cortas hasta que se regeneren; la causa de los huecos (el PDF pierde las fórmulas al extraer el texto) **no se arregla aquí**: solo se evita servir lo que quedó roto.

