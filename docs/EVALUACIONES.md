# Evaluaciones de corte y final: diseño

Estado: **diseño + primera pieza (componer el examen)**. Lo demás (sesiones, calificación en el servidor, intentos, pantalla) viene en PRs aparte. Este documento fija las decisiones **por defecto** para que se puedan revisar antes de construir encima.

## Lo que ya está decidido por el dueño (y ya codificado)

Las evaluaciones las toma el estudiante **dentro de la app**; se **repiten** y su nota es el **promedio de todos los intentos hasta llegar a 100 %** (con un 100 ya no se repite); la evaluación de un corte vale **30 %** del corte y la **final**, medio corte; sin dominar (100 % en un intento) la evaluación de un corte no se pasa al siguiente; la final se desbloquea al terminar todos los cortes. Reglas en `progress.ts`; la tabla `exam_attempts` (085) guarda los intentos ya calificados.

## Decisiones por defecto de este diseño (revísalas)

1. **De dónde salen las preguntas:** del **banco de los módulos reales enlazados** al corte (la final, de todos los cortes). No se genera contenido nuevo para el examen. *Por qué:* esas preguntas ya existen, ya pasaron la compuerta de auto-calificación (JEV) y ya las califica el servidor. *Alternativa:* generar preguntas propias de examen desde la comprensión final (más fiel al «hacia atrás», pero exige un generador nuevo, su evaluación y mucho más costo de IA).
2. **Solo tipos que el servidor ya califica:** `multiple_choice`, `true_false`, `fill_blank`, `short_answer`, `match`. Los minijuegos no entran (su calificación en el servidor sigue apagada).
3. **Un examen no se arma si no puede comprobar todo el corte.** Un módulo del corte **sin enlace** o enlazado a un módulo **sin preguntas calificables** es un hueco: se devuelve la razón y los módulos que faltan, no se salta en silencio (si no, «dominar el corte» no significaría haberlo comprobado). El profesor ve qué falta.
4. **Tamaño:** 10 preguntas el examen de corte, 20 la final (mínimo 5, máximo 60). Configurable más adelante.
5. **Reparto:** por módulo a partes iguales (+1 a los primeros si no divide); la final reparte primero entre cortes **por su peso** y luego entre sus módulos; si un módulo tiene menos preguntas que su cupo, el sobrante lo ponen los demás. Cada pregunta entra una sola vez.

## Piezas y estado

| Pieza | Qué hace | Estado |
|---|---|---|
| `exam.ts` — `composeExam` | Elige qué preguntas entran (solo ids y tipos; nunca contenido ni claves) con las reglas de arriba | **Hecha** (este PR) |
| Sesión de examen | Una tabla propia (migración nueva) que fija **qué preguntas se sirvieron** a ese estudiante en ese intento, como `lesson_attempts` | Pendiente |
| Calificación en el servidor | Reusar los calificadores de la lección (`gradeAnswer`); el navegador nunca recibe las claves ni manda el puntaje | Pendiente |
| Cierre del intento | Escribir `exam_attempts` (el trigger de la 085 asigna el número y bloquea repetir tras un 100 %) | Pendiente |
| Pantalla del estudiante | Tomar el examen; hoy la página de la lección está pensada para un módulo, hay que decidir si se reutiliza o se hace una vista propia | Pendiente |
| Cumplimiento del orden | Que la app **haga cumplir** «100 % para avanzar» (hoy el recorrido solo lo muestra) | Pendiente, **decisión tuya** |

## Lo que me falta que decidas

- ¿Las preguntas del examen salen del banco de los módulos (recomendado) o se generan aparte?
- ¿Se hace cumplir el avance por dominio en la app, o el recorrido sigue siendo informativo?
- ¿Se permite ver las respuestas correctas al terminar un examen (aprender del error) o no (para que el siguiente intento no sea memorizar)?
