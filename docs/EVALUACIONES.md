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
| Banco de preguntas de examen | Tabla nueva (migración, **sin aplicar** hasta tu autorización): solo la lee el servidor (tiene las claves); estado de revisión | Pendiente |
| Generación con IA | Por comprensión: recuperar los trozos de material relevantes, generar, validar con `validateExamQuestion`, guardar; con cupo por profesor; **`eval` con el modelo real** antes de ofrecerlo | Pendiente |
| Revisión del profesor | El profesor ve cada pregunta (con su cita y explicación) y la aprueba o rechaza; solo las aprobadas entran a un examen | Pendiente |
| Sesión de examen | Tabla propia que fija **qué preguntas se sirvieron** a ese estudiante en ese intento | Pendiente |
| Calificación y cierre | Reusar los calificadores; escribir `exam_attempts` (el trigger de la 085 asigna el número y bloquea repetir tras un 100 %); entregar la retroalimentación 3D | Pendiente |
| Pantalla del estudiante | Tomar el examen y ver la retroalimentación | Pendiente |
| Cumplimiento del 100 % (2B) | Bloqueo en el servidor al abrir lección/examen + no publicar con módulos sin enlazar | Pendiente |

## Datos de producción (2026-11-02, solo lectura)
De 46 módulos activos, 24 tienen banco de preguntas de lección y 22 no tienen ninguna (el banco se crea la primera vez que alguien abre el módulo). Con 1B esto **ya no bloquea los exámenes** (las preguntas son propias del examen), pero sí importa para el **material**: la generación necesita trozos de material (`material_chunks`) de la clase.
