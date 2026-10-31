# Calificación en el servidor de los minijuegos (fase 4(a), primera entrega)

Las preguntas clásicas ya se califican en el servidor (PR #95): la solución no viaja al navegador. Los minijuegos seguían calificándose en el navegador con la solución dentro de `game_data`. Esta entrega cierra **los cuatro juegos de «elegir una opción»**: El Impostor Cognitivo, Alquimia Conceptual, Cuarto de Crisis y El Juicio al Conocimiento. Los otros cuatro (línea del tiempo, categorías, cartas, descifrador) necesitan otra interacción con el servidor y van en PR aparte.

## Cómo funciona

- **Qué viaja al navegador** (`sanitizeGameData`, `src/lib/grading/gameGrading.ts`): una **lista blanca** de campos por juego. Se quedan en el servidor las marcas de solución (`is_impostor`, `is_correct`, `is_solution`, `guilty_paragraph_id`), las consecuencias de cada intervención y todas las explicaciones. Un campo nuevo que se agregue algún día **no** sale por accidente.
- **Cómo se responde:** el juego manda lo que el jugador eligió (`{ selectedId }`, `{ selectedCode }` o `{ selectedParagraphId }`) a `POST /api/lesson/answer`; el servidor compara, cierra la pregunta (un solo intento), la registra en `question_attempts` con su `game_type` y **revela** la solución, las consecuencias y la explicación.
- **Quién registra el intento:** el servidor. Desde el navegador solo se reacciona al resultado (sin doble registro).
- **Si no se puede comprobar** (sin conexión, sesión vencida): el juego muestra «No se pudo comprobar tu respuesta…» y deja volver a elegir; no inventa un resultado.
- **Un juego sin solución** (datos sin opción correcta) no se califica (400): nunca se aprueba ni se reprueba por omisión.
- **Cuarto de Crisis:** el temporizador sigue siendo del navegador. Al acabarse el tiempo se informa al servidor «sin elección» y la pregunta queda cerrada como fallada.

## Interruptores

Es **opt-in** y reversible en minutos:

| Variable | Efecto |
|---|---|
| `SERVER_GRADING=on` (ya existía) | califica las clásicas en el servidor |
| `SERVER_GRADING_GAMES=on` (nueva) | además, califica los 4 juegos migrados |

Sin `SERVER_GRADING_GAMES`, los juegos se sirven y se califican en el navegador como siempre.

## Límites

- La política `students_read_lesson_questions` todavía deja leer `lesson_questions` completa con la llave pública, así que **un estudiante que consulte la base directamente aún puede ver las soluciones**. Cerrarlo es la Fase 2 del plan (`finish_lesson`, lectura cerrada); esta entrega solo evita que la solución viaje en la respuesta de la lección.
- El temporizador del Cuarto de Crisis no se vigila en el servidor.
- Las pantallas de los juegos no se probaron en un navegador con sesiones reales (necesitan inicio de sesión y datos): se cubren con pruebas del servidor, de la entrega de la lección con una base simulada y pruebas estáticas de los componentes.
