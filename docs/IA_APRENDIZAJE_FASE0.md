# IA que aprende con cada curso — Fase 0 (línea base) y Fase 1 (registro de señales)

Fecha de las mediciones: 2026-11-06, base de producción, solo lectura. Excluye la clase sintética `[CARGA]`. El diseño completo (propuesta del dueño) está en `IA_APRENDIZAJE_CONTINUO.md` (fuera de este PR).

## Fase 0: qué hay hoy

| Medida | Valor | Lectura |
|---|---|---|
| Clases reales | 3 (2 con intentos de estudiantes) | Muy pocas para cualquier benchmark global |
| Preguntas en el banco | 775 (513 de respaldo) | |
| Veredictos del juez IA | 266 aprobadas, 197 rechazadas, 37 en revisión humana | |
| Veredictos sin procedencia (anteriores a la migración 044) | 48 aprobadas, 40 rechazadas | Irrecuperable: no se sabe quién las decidió |
| Sin juzgar (`pending`) | 171, todas de «5to grado · Sección A» | Cola sin procesar |
| Decisiones del profesor | 16 (1 aprobada, 15 rechazadas) | **Es toda la verdad humana disponible** |
| Intentos de estudiantes en clases reales | 200, de 3 estudiantes, 142 preguntas | Acierto global 61,5 % |
| Preguntas con ≥5 intentos | **0** | La dificultad por pregunta aún no se puede estimar |

### Acuerdo juez ↔ profesor (muestra de 15 rechazos del profesor)
La razón de cada rechazo del profesor guarda el veredicto que tenía el juez en ese momento (`[juez actual: …]`):

| Veredicto del juez cuando el profesor rechazó | Preguntas |
|---|---|
| fail (acuerdo) | 12 (80 %) |
| pass (el juez dejó pasar algo que el profesor rechazó) | 2 |
| review | 1 |

**Cuidado al interpretar:** n = 15, todas de una sola clase (Microeconomía), y el profesor solo actúa sobre lo que se le muestra (sobre todo la cola de revisión humana), así que hay sesgo de selección. Sirve como línea base, **no** como conclusión sobre la calidad del juez. Tampoco se puede medir el caso contrario («el juez rechaza y el profesor aprobaría») porque hay una sola aprobación del profesor y no guarda el veredicto previo del juez.

### Hallazgo de fondo
`lesson_questions.review_status` guarda solo el **último** veredicto. Cuando el profesor corrige al juez, el veredicto del juez desaparece (sobrevive solo como texto dentro de `review_reason`). Sin historial no se puede calibrar al juez, que es el requisito de la fase 2. Eso es lo que resuelve la fase 1.

## Fase 1: migración 096 (aditiva, no cambia el producto)

- `ai_feedback_events`: registro solo de añadir de cada cambio de `review_status`/`reviewed_by` (quién: `judge`/`teacher`/`unknown`; veredicto nuevo y anterior; razón). Lo llena un **trigger**, así captura a todos los escritores sin tocar el código de la app.
- Respaldo inicial: un evento por cada pregunta ya veredictada (`source='backfill'`). Incluye también las preguntas de la clase `[CARGA]`; filtrar por `classroom_id` al analizar.
- `question_stats` + `recompute_question_stats()`: aciertos, intentos y estudiantes distintos por pregunta, recalculable; excluye `[CARGA]`. Con <5 intentos la tasa es ruido: usar `attempts` como umbral.
- Seguridad: RLS activado sin políticas y sin permisos para `anon`/`authenticated`; la función solo para `service_role`.

**Verificado (transacción revertida, antes de aplicar):** crea las tablas, 644 eventos de respaldo (266/37/197 del juez, 1/15 del profesor, 88/40 sin procedencia más las de `[CARGA]`), el trigger registra `teacher: pending→approved` al cambiar una pregunta, `recompute_question_stats()` devuelve 142 filas (= preguntas con intentos reales), `anon` y `authenticated` no pueden leer ni ejecutar, `service_role` sí ejecuta. Nada quedó en producción.

**No verificado:** que el trigger no añada latencia apreciable cuando el juez califica lotes grandes (cada fila cambiada = un `INSERT`); es un insert por pregunta, se medirá en la primera corrida real del juez. Aún nadie llama a `recompute_question_stats()`: falta una tarea periódica o un botón (fase 2).

## Siguiente paso
Aplicar la 096 tras el merge. Para la fase 2 (calibrar al juez) falta volumen: hoy hay 16 decisiones humanas. Conviene que el profesor revise la cola de `human_review` (37 preguntas) y las 171 sin juzgar de 5.º grado para generar más señal.

## Fase 2: calibración del juez (sin cambiar el comportamiento del pipeline)
- `src/lib/aiLearning/judgeCalibration.ts` (puro, con tests): por pregunta empareja la última decisión del profesor con el último veredicto del juez anterior a ella (o, en datos previos a la 096, con la etiqueta `[juez actual: …]` de la razón). Calcula acuerdo, falsos «pass» (el juez aprobó y el profesor rechazó) y falsos «fail», y la cota inferior de Wilson al 95 %.
- Estado: `insufficient` (menos de 20 pares decisivos: **no concluye**), `trusted` (cota inferior ≥ 80 %) o `degraded`. Los veredictos `review` no cuentan a favor ni en contra.
- Panel: tarjeta «Acuerdo del juez con tus decisiones» arriba de la cola de revisión del profesor (`/teacher/classrooms/[id]/review`). Se lee con la llave de servicio solo si la clase es del profesor que mira; si algo falla, la página funciona igual sin la tarjeta.
- **Con los datos de hoy el estado es `insufficient`**: 14 pares decisivos (12 acuerdos, 2 falsos «pass»), 1 «review», 1 aprobación sin veredicto previo. Necesita ≥ 20.
- **No se aplicó el peso al pipeline todavía** (p. ej. mandar a revisión humana lo que el juez rechaza cuando esté `degraded`): con 14 pares sería actuar sobre ruido. Se decide cuando el estado deje de ser `insufficient`.

## Fase 3: cuaderno de estilo (playbook) por clase — migración 097
- **Tabla `ai_playbooks`** (097, aditiva): versiones por clase (`draft`/`active`/`retired`), hasta 10 reglas `{text, evidence?}`, una sola versión activa por clase (índice único parcial). RLS: solo el profesor dueño de la clase; el estudiante no ve nada.
- **Pantalla** `/teacher/classrooms/[id]/playbook` (pestaña «Estilo de la IA»): el profesor escribe reglas, cada guardado crea una versión nueva, activa la que quiera, vuelve a una anterior o desactiva todo. Nunca se edita una versión existente: el historial queda.
- **Generadores:** `generate-questions` y `regeneratePool` agregan al prompt el bloque «REGLAS DE ESTILO APRENDIDAS EN ESTA CLASE» si hay una versión activa. Sin playbook activo el prompt es **idéntico** al de antes (hay un test). Las reglas se limpian (sin saltos de línea ni marcadores `# < >`, sin duplicados, 240 caracteres) porque van dentro de un prompt.
- **Qué NO hace todavía:** la IA no propone reglas (`origin='ai'` existe pero nadie lo escribe). Con 14 pares juez-profesor y 0 preguntas con ≥5 intentos no hay evidencia para proponer nada sin inventar; se habilita cuando la fase 2 salga de `insufficient`. Tampoco cambia las preguntas ya generadas: solo las nuevas.
- **Cuidado de rendimiento:** `generate-questions` suma una lectura (una fila, con llave de servicio) dentro del `Promise.all` existente, sin viaje extra en serie. Medirlo en producción tras el merge.

## Fase 4: ciclos y retrospectiva — migración 098
- **Tablas** `course_cycles` (periodo cerrado + instantánea) y `cycle_retrospectives` (hallazgos y sugerencias con estado). RLS: solo el profesor dueño. El «ciclo abierto» es implícito: empieza donde terminó el último cerrado (o en la creación de la clase), así que solo se guardan ciclos **cerrados**.
- **Pantalla** `/teacher/classrooms/[id]/cycles` (pestaña «Ciclos»): el profesor nombra y cierra el ciclo (con confirmación, no se puede deshacer) y ve los hallazgos y las sugerencias; cada sugerencia se acepta, rechaza o pospone. Lo rechazado también queda guardado.
- **La retrospectiva la calculan reglas, no un LLM** (`src/lib/aiLearning/retrospective.ts`): módulos con promedio < 60 % (≥ 5 lecciones terminadas), conceptos con acierto < 50 % (≥ 10 intentos), preguntas con acierto < 20 % o > 95 % (≥ 10 intentos), cola de revisión sin resolver y estado del juez. Cada hallazgo cita su dato y su tamaño de muestra. Con muestra menor dice «no hay datos suficientes» y no concluye. Se eligió así porque un LLM podría inventar causas con datos escasos; un resumen narrativo con LLM se puede añadir encima sin cambiar los hallazgos.
- **Privacidad:** la instantánea guarda solo conteos, tasas e ids de preguntas; nada de identificadores de estudiantes ni texto de preguntas. Cerrar un ciclo no borra ni modifica respuestas (hay un test).
- **Límites:** las lecturas se paginan hasta 50 000 filas por tabla; si se alcanza el tope, la instantánea lo marca como «datos truncados». Las sugerencias aceptadas todavía **no** se convierten solas en reglas del cuaderno de estilo ni en cambios del plan: el profesor las aplica a mano. Esa conexión viene cuando haya ciclos reales que la justifiquen.

## Fase 6: memoria del profesor entre cursos (sin migración)
- **Traer reglas de otra clase:** en «Estilo de la IA» el profesor ve el cuaderno (activo, o la versión más reciente) de **sus otras clases** y puede traerlo. Entra como **borrador nuevo**: las reglas actuales mandan, sin duplicados, tope de 10, y avisa cuántas entraron y cuántas no. Él decide si lo activa. La RLS de `ai_playbooks` (097) ya impide ver clases de otros profesores (probado en la 097: un usuario ajeno ve 0 filas).
- **«Para este ciclo»:** en «Ciclos» se muestra como lista de tareas lo **aceptado y pospuesto** de la retrospectiva más reciente (aceptado primero). Lo rechazado **no** se arrastra: es lo que el profesor dijo que no quiere. Pendiente tampoco.
- **Qué NO hace:** no copia nada entre profesores (eso es la fase 7, con consentimiento y asesoría legal); no aplica solo ninguna regla ni sugerencia; no importa retrospectivas completas ni estadísticas de otra clase.
- Lógica pura en `src/lib/aiLearning/carryOver.ts` (con tests): `mergeRules` y `nextCycleChecklist`.
