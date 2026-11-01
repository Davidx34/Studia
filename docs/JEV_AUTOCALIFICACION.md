# JEV-1: auto-calificación de preguntas y minijuegos

Primera pieza del motor JEV (juicio, evaluación y verificación) de `especificacion_maestra_cdm_y_jev_para_claude.md`, adaptada a los nombres reales del repositorio. Código puro en `src/lib/jev/selfGrade.ts`.

## Idea

Antes de dar por buena una pregunta o un minijuego se **simula la jugada perfecta con los calificadores reales del servidor** (`gradeAnswer` y `gradeGame`) y se exige:

1. que la respuesta oficial salga **correcta**;
2. que **cualquier otra** opción salga incorrecta (si no, la solución es ambigua);
3. que los datos no sean contradictorios (una opción repetida, dos impostores, categorías que no existen, posiciones que no forman un orden, el culpable que no es ningún párrafo…).

Distingue **fallas** (el ejercicio no sirve y el estudiante lo vería imposible o con dos respuestas) de **avisos** (sospechoso pero legítimo).

`selfGrade(row)` devuelve `{ status: 'pass' | 'fail' | 'skip', kind, failures, warnings }`. Cubre las 5 clases de pregunta clásica y los 8 minijuegos. Un tipo que el servidor no califica se omite (`skip`).

## Por qué simula en vez de solo mirar la estructura
La simulación es **redundante con las comprobaciones estructurales mientras el calificador y los datos se entiendan**. Existe para detectar el día en que **el calificador cambie su protocolo** (otro nombre de campo, otra forma de responder) y deje de coincidir con los datos guardados: la jugada perfecta dejaría de puntuar 100 % y la compuerta lo notaría antes de que lo vea un estudiante. Las pruebas lo fuerzan simulando un calificador que rechaza la jugada perfecta y otro que acepta cualquier cosa.

## Auditoría de lo ya guardado (solo lectura)
`npm run audit:games` lee `lesson_questions` con la llave de servicio, aplica `selfGrade` y lista lo que no sirve. No escribe nada.

Corrida del 2026-11-01 sobre producción (775 preguntas):

- **0 fallas.** Todo lo guardado se puede resolver y ninguna solución es ambigua.
- **17 avisos**, todos de respuestas esperadas de **un solo carácter** (ver el hallazgo siguiente) y una pregunta de emparejar con dos definiciones iguales (legítima: dos alimentos con el mismo origen).
- Lo que se **sirve hoy a estudiantes** (todo lo no rechazado): 173 de opción múltiple, 115 de emparejar, 86 de completar, 65 de respuesta corta, 65 de verdadero/falso, y solo **19 de minijuegos**: impostor (4), línea del tiempo (6), cuarto de crisis (3), descifrador (3) y alquimia (3). **Categorías, cartas y juicio no tienen ninguna pregunta servible hoy** (solo respaldos rechazados): un estudiante no los verá hasta que se generen nuevas.

## Hallazgo: el calificador acepta respuestas de un carácter dentro de cualquier texto
`fill_blank` y `short_answer` dan por buena la respuesta si el texto del estudiante **contiene** la cadena esperada (`contained()` en `gradeAnswer.ts`, heredado de las reglas del navegador). Con respuestas esperadas como `{y}`, `{x,y}`, `{px,py,W}`, `{0}`, `{2}`, `{6}`, `{1}` o `{x,y,lambda}` (hoy hay 12 preguntas servibles así), un texto como «xy», o cualquier frase que contenga una «y», cuenta como acierto. No es un fallo de la auditoría (el ejercicio sí es resoluble) sino de **la regla de calificación**.

Posible arreglo (no incluido aquí, es un cambio de regla con impacto pedagógico): para respuestas esperadas cortas (≤ 2 caracteres normalizados, o solo números y símbolos) exigir **coincidencia por palabra completa** en vez de por subcadena.

## JEV-2: la compuerta en la generación

`gateGenerated` (`src/lib/jev/runtimeGate.ts`) aplica `selfGrade` a todo lo que genera la IA **antes de guardarlo**, en los dos caminos que insertan en `lesson_questions`:

- `/api/generate-questions` (cuando un estudiante abre una lección y el caché no alcanza);
- `regenerateModulePool` (el botón «Regenerar» / «Generar lo que falta» del profesor).

Reglas:
- **Solo las fallas descartan.** Los avisos (una respuesta de un carácter, dos definiciones iguales) se conservan. Un tipo que el servidor no califica se conserva.
- **La compuerta no puede dejar a una clase sin lecciones:** si ella misma falla (no debería), el ejercicio se conserva y se registra `[JEV_GATE_ERROR]`.
- **Interruptor de emergencia:** `JEV_GATE=off` en el servidor la apaga sin desplegar código (como `GRADING_SHADOW=off`).
- **Registro sin contenido:** `[JEV_REJECTED:GENERATE|REGENERATE]` dice el módulo, cuántas se descartaron y, por cada una, el **tipo** y el **motivo**; nunca el enunciado ni las respuestas.
- **No destruye lo que ya hay:** en modo `replace`, un lote entero imposible devuelve error («No se generó ninguna pregunta válida») **antes** de borrar el pool existente.

Efecto esperable: casi ninguno sobre lo normal (la auditoría de lo guardado dio 0 fallas); evita que una pregunta ambigua o con datos contradictorios entre al banco. Para saber cuánto descarta en la práctica hay que mirar los registros tras unos días.

## Lo que sigue
- Decidir la regla de coincidencia por palabra completa para respuestas cortas (hallazgo de arriba).
- Medir con los registros cuántas preguntas descarta la compuerta y de qué tipos; si son muchas, afinar el prompt de generación.
