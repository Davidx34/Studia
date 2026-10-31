# Calificación en el servidor de los minijuegos (fase 4(a), primera entrega)

Las preguntas clásicas ya se califican en el servidor (PR #95): la solución no viaja al navegador. Los minijuegos seguían calificándose en el navegador con la solución dentro de `game_data`. Esta entrega cierra **los cuatro juegos de «elegir una opción»**: El Impostor Cognitivo, Alquimia Conceptual, Cuarto de Crisis y El Juicio al Conocimiento. La línea del tiempo y las categorías se cerraron en una segunda entrega (ver más abajo). Las cartas y el descifrador se cerraron en una tercera entrega: **los ocho minijuegos** se califican ya en el servidor.

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

## Segunda entrega: línea del tiempo y categorías

Seis de los ocho minijuegos se califican ya en el servidor. Los dos nuevos tienen más de una oportunidad, así que el servidor lleva la cuenta (`MAX_TRIES`: línea del tiempo 3, categorías 2).

**Línea del tiempo** (`{ order: [id, …] }`, los eventos en el orden que puso el jugador):
- Al navegador salen el id, el texto y el año de cada evento; **la posición correcta no**.
- Un intento fallido **no cierra** la pregunta: el servidor responde solo qué **posiciones** estaban mal (lo mismo que el juego ya marcaba en rojo por su cuenta), sin revelar el orden. Al acertar o al agotar el tercer intento cierra y revela el orden correcto y la explicación.
- Con el servidor, **su** cuenta de intentos decide cuándo se cierra (la del navegador podría no coincidir si se recargó la página).

**Categorías:** el juego clasifica elemento por elemento con retroalimentación inmediata y sin penalización, y tiene un temporizador con una segunda oportunidad. Se respeta tal cual:
- Cada toque envía un **sondeo** `{ probe: { itemId, category } }`: el servidor dice si esa categoría es la del elemento y **no cierra la pregunta, no gasta intentos y no escribe nada**. Es lo que el jugador descubriría por ensayo y error, y no tiene penalización en el juego.
- Al clasificar todo, el navegador manda la clasificación completa `{ assignment: { id: categoría } }`; el servidor la verifica y cierra. Lo que el servidor impide es **declarar** una clasificación que no sea la correcta.
- El tiempo agotado se informa como `{ timeout: true }` (intento fallido); el segundo cierra la pregunta y revela la clasificación. El reloj sigue siendo del navegador.
- Si falla la comprobación final (sin conexión), aparece «Reintentar»; no se inventa un resultado.

**Límite de los sondeos:** un cliente modificado puede sondear todas las combinaciones y obtener la clasificación sin jugar (no hay tope de sondeos por pregunta). Es el mismo ensayo y error que el juego permite sin penalización, sin ahorrar más que tiempo; no se puede, en cambio, **registrar** un acierto sin la clasificación correcta.

## Tercera entrega: cartas y descifrador

Con ellas, los **ocho** minijuegos del catálogo se califican en el servidor (detrás de `SERVER_GRADING_GAMES=on`). Los dos usan sondeos, como las categorías.

**Cartas (memoria de pares).** Las cartas viajan con una clave numérica y su texto, en un orden **determinista** que sale de un hash del texto: no deja las dos cartas de un par juntas ni en un patrón, y servir y sondear calculan el mismo orden a partir de los mismos datos, sin guardar nada. Cada par que se voltea es un sondeo `{ probe: { a, b } }` («¿coinciden?»). Al encontrar el último par, el navegador manda la lista de pares y el servidor cierra. No existe un final «perdido» (igual que antes: el juego termina al encontrar el último par); una lista de pares equivocada o incompleta se rechaza (400) y la pregunta queda abierta.

**Descifrador (palabra letra por letra).**
- Al navegador viaja la **máscara** de la palabra (letras ocultas; espacios, guiones y signos visibles, como antes) y **cuántas** pistas hay. La palabra y las pistas no viajan.
- Cada letra es un sondeo `{ probe: { letter } }`: el servidor responde en qué posiciones aparece (y el carácter original). Las **pistas se piden de a una** (`{ probe: { hint: n } }`), como el botón que las va mostrando.
- Para cerrar, el navegador manda el conjunto de letras que probó y **el servidor decide**: gana si cubre la palabra con menos de 6 fallos; pierde si hay 6 o más; si el juego aún no terminó (faltan letras y quedan intentos) no se puede cerrar (400). Si cubrió la palabra pero hay 6 o más fallos, pierde (con un conjunto no se sabe qué ocurrió primero).
- La Ñ es una letra distinta de la N. Las letras con tilde en la palabra se muestran tal cual y no cuentan como letras que adivinar (en el navegador antiguo contaban como su letra base, lo que hacía imposible ganar una palabra con tilde; los datos nuevos no las llevan).

**Límite (el mismo que en las categorías):** un cliente modificado puede sondear todas las letras o todas las combinaciones de cartas y obtener la solución sin jugar; es el mismo ensayo y error que los juegos permiten, y lo que no se puede es **registrar** un resultado sin haberlo logrado.
