# Cierre de la lección en el servidor (fase 2a)

Hasta ahora cada respuesta se calificaba en el servidor, pero el **progreso** (estado «completado», puntaje, intentos, tiempo) lo escribía el navegador con una política `ALL` sobre la fila propia de `student_progress`. De esa tabla leen los logros, las monedas y los reportes del profesor.

## Qué cambia (paso «expandir», reversible)

- **Migración 084** (`finish_lesson`): una función `SECURITY DEFINER` con `search_path` fijo que **solo ejecuta `service_role`**. Calcula el puntaje desde las respuestas verificadas del intento (`lesson_attempt_answers`) y escribe `student_progress`.
  - Exige que el intento sea del estudiante y que **todas** las preguntas servidas estén cerradas.
  - Es **idempotente** (cerrar dos veces devuelve lo mismo y no suma otro intento) y bloquea el intento (`FOR UPDATE`).
  - El tiempo que manda el navegador se acota a lo que de verdad pasó desde que se abrió el intento y a 2 horas.
  - El mejor puntaje es el máximo y cada cierre suma 1 intento.
- **`POST /api/lesson/finish`**: comprueba la sesión y pasa **el estudiante de la sesión** a la función. El navegador solo dice qué intento termina y cuánto tiempo estuvo; **ni el puntaje ni el estado salen del navegador**.
- **La lección** usa esa ruta cuando hay intento de calificación en el servidor. Si el servidor la **rechaza** (quedan preguntas sin responder, el intento no es suyo…), no se escribe el progreso a mano. Si **no está disponible** (migración sin aplicar → 501, calificación apagada → 503, sin red), sigue como antes. Ese camino es transitorio.
- **`generated_questions`**: dejó de poder leerla cualquier usuario autenticado de cualquier clase (podía traer respuestas); ahora solo el profesor dueño de la clase. Tenía 0 filas y no la usa el navegador.

## Activación

La aplicación funciona con y sin la migración. Para activarlo: aplicar la **084** (con aprobación explícita). No hace falta ninguna variable nueva: usa `SERVER_GRADING=on`, que ya está activo.

## Qué NO hace todavía (y por qué)

La política `ALL` de `student_progress` **sigue abierta**. Cerrarla ahora rompería las lecciones que el servidor aún no califica. Falta, en este orden, para poder «contraer»:

1. ~~Los minijuegos pendientes~~ (hecho: los ocho se califican en el servidor con `SERVER_GRADING_GAMES=on`, ver `docs/CALIFICACION_MINIJUEGOS.md`). Mientras esa variable esté apagada, las preguntas de juego no entran en el intento y una lección solo de juegos no puede cerrarse en el servidor.
2. ~~Pasar `markInProgress` y la ruta sin conexión al servidor~~ (hecho): el servidor marca «en progreso» al servir las preguntas (`markLessonInProgress`, desde `/api/generate-questions`); `persistProgressOffline` no tenía ningún llamador y se eliminó. Además `/api/generate-questions` lee y escribe el banco de preguntas con la llave de servicio, **pero solo si el usuario ve el módulo** (por su RLS de `content_modules`): sin eso, cerrar la lectura del banco habría hecho que cada apertura regenerara preguntas con la IA.
3. Entonces: `student_progress` pasa a solo lectura para el estudiante; `question_attempts` deja de aceptar `INSERT` propio; y se cierra la lectura de `lesson_questions` por estudiantes (hoy deja ver `ok`, `answers`, `keywords` y `game_data` con la llave pública).
   Al revisar la base de producción apareció además que un estudiante matriculado puede **insertar** preguntas en el banco de su clase (`students_insert_lesson_questions`). La migración 086 cierra también eso.

   **Orden seguro:** (1) este código desplegado; (2) `SERVER_GRADING_GAMES=on` en producción tras probar los 8 juegos; (3) recién entonces la migración 086. Si se aplica la 086 antes de (2), los resultados de los minijuegos dejan de registrarse en `question_attempts` (su camino de registro desde el navegador queda cerrado) aunque la lección sí se cierra y puntúa.

## Código heredado del navegador (retirado)

Con la 086 aplicada el navegador ya no puede escribir `student_progress` ni `question_attempts`, así que se retiró lo que lo intentaba:

- El **respaldo de escritura directa** de `saveProgress` (si el servidor fallaba, el navegador escribía el progreso él mismo). Fallaba en silencio y el estudiante terminaba sin saber que su resultado no contó.
- `recordAttempt` y las escrituras de `question_attempts` desde la página.
- El **modo sombra** (`/api/lesson/shadow`, `shadowClient.ts`): comparaba la calificación del navegador con la del servidor; ya no hay calificación en el navegador que comparar. La tabla de la migración 065 se conserva.

Ahora el cierre es `closeLesson` (`src/lib/grading/saveOutcome.ts`, lógica pura con pruebas de comportamiento): un reintento automático tras 1,2 s si el servidor no está disponible, y tres resultados: `saved`, `retry` (aviso con botón **Reintentar guardado**; cerrar es idempotente) y `unrecorded` (no hubo intento o el servidor lo rechazó; aviso sin botón porque reintentar no ayuda). Los logros se evalúan solo si quedó guardado. El aviso sale en las dos pantallas finales.

## Detalle a tener en cuenta

El puntaje que guarda el servidor es **acertadas / servidas por el servidor**. Una lección que mezcla clásicas con minijuegos aún no migrados puntúa solo las verificadas (los juegos no migrados no cuentan hasta que migren). El puntaje que el estudiante ve al terminar sigue calculándose en el navegador.
