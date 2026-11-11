# Arquitectura de memorias de la IA de Stud.ia: inventario, flechas y sistema de reducción de errores

Estado: **plan + primera entrega (medición)** — 2026-11-09. Complementa `docs/IA_APRENDIZAJE_FASE0.md` (fases 0 a 7, ya construidas) y el diseño `IA_APRENDIZAJE_CONTINUO.md`. Todo lo que dice «hoy» está verificado en producción; lo que dice «plan» no existe todavía.

## 1. Qué hay hoy (verificado en producción el 2026-11-09)

| Memoria | Qué guarda | Filas | ¿Alimenta a la IA hoy? |
|---|---|---|---|
| Memoria de la clase (`class_memory`) | Grafo de conceptos del material | 1 grafo, 4 materiales | Sí (generación) |
| Índice de materiales (RAG) | Fragmentos y vectores | 197 | Sí (generación, juez) |
| Taxonomía de conceptos | Conceptos por módulo | 222 | Sí (`concept_tag`) |
| Banco de preguntas | Preguntas con veredicto | 911 | Es la salida |
| Memoria del estudiante | Respuestas, progreso, repaso | 19 511 (casi todo de prueba de carga) | Repaso dirigido |
| Señales de calidad (`ai_feedback_events`) | Quién decidió qué y por qué | 817 | **No** |
| Estadísticas por pregunta | Aciertos, intentos | 142 | **No** |
| Cuaderno de estilo | Reglas del profesor | 0 | Sí (si hay una activa) |
| Ciclos y retrospectivas | Foto de un curso cerrado | 0 | **No** |
| Rutas de investigación | Lecturas con fuentes | 0 | **No** |
| Memoria global | Promedios anónimos | 0 | **No** |

Solo tres memorias (clase, índice, taxonomía) más el cuaderno cambian lo que la IA genera. El resto mide o muestra: **no hay aprendizaje automático todavía**.

## 2. Principios del sistema que reduce errores
1. **Nada cambia el comportamiento sin evidencia.** Un cambio (regla, doctrina, ejemplo) solo se activa por defecto si una medición A/B dice «mejora» (intervalo de confianza de la diferencia entero del lado bueno, muestra mínima por brazo). «Sin evidencia» no es «no sirve»: es «mide más».
2. **Toda memoria derivada lleva procedencia:** de qué datos salió, quién la aprobó (persona o medición), versión y estado (`propuesta` / `activa` / `retirada`). Lo escrito por una IA nunca entra a un prompt sin aprobación de una persona o de una medición.
3. **Separar el origen del error** (generador, pipeline, infraestructura) antes de actuar: no se «corrige» al generador por un fallo de cuota del juez.
4. **Reglas deterministas donde se pueda** (clasificar motivos, proponer reglas desde plantillas curadas) y LLM solo donde no haya alternativa, con verificación posterior. Menos libertad = menos errores inventados.
5. **Reversible y auditable:** versiones, historial, interruptor para volver atrás, nada se borra.
6. **Muestras pequeñas no concluyen:** todo hallazgo cita su n; por debajo del mínimo dice «no hay datos suficientes».
7. **Probar por la API, no solo en SQL** (lección de la migración 101).

## 3. Taxonomía de errores (entregada) — por qué se rechazan las preguntas
`src/lib/aiLearning/errorTaxonomy.ts`: reglas deterministas que clasifican el motivo del juez en 11 categorías con **origen** (generador / pipeline / infraestructura). Línea base real (clases reales, 304 rechazos o revisiones con motivo): error conceptual o de cálculo 32,6 %; no respaldada por el material 14,1 %; segunda opinión fallida (infraestructura) 13,5 %; veredicto sin motivo (pipeline) 13,2 %; más de una respuesta posible 8,6 %; formato de minijuego 6,6 %; respuesta no evaluable 3,3 %; no autocontenida 2,0 %; duplicada 1,0 %; redacción confusa 0,7 %; sin clasificar 4,6 %. **64 % es atribuible al generador, 13,5 % a la infraestructura y 13 % al pipeline.**

## 4. Medición (entregada)
- `scripts/quality-baseline.ts` (solo lectura): línea base con intervalos de confianza → `memoria-calidad/baseline-2026-11-09.json`. **Hallazgo:** la aprobación del juez pasó de 25 % (9 ago) a 45 % (11 oct), 77 % (27 oct) y 78 % (7 nov). Ojo: cambiaron a la vez el generador (pasarela con Gemini) y el criterio del juez; no se puede atribuir todo al generador.
- `scripts/ab-generation.ts`: experimento A/B que **no escribe preguntas**: mismos módulos, contexto y juez; brazos intercalados; excluye del denominador los fallos de infraestructura; decide con `compareProportions` (`proportion.ts`, intervalo de Newcombe). Resultados en `memoria-calidad/experimentos/`.
- Primera hipótesis medida: `item_writing_v1` (5 reglas de redacción de ítems dirigidas a los 5 errores más frecuentes). Ver el resultado en `memoria-calidad/experimentos/`.

## 5. Flechas que faltan (plan, en este orden)
1. **Medir** (entregado en esta fase).
2. **Doctrina global** de conocimiento de alto prestigio (ver §6) con selección por tarea y activación solo tras A/B.
3. **Rechazos → reglas propuestas:** agrupar los motivos con la taxonomía y proponer, como borrador, la regla de una **plantilla curada** (no texto libre de IA) cuando una categoría supere un umbral de frecuencia.
4. **Calibración del juez → interruptor del pipeline:** si el juez sale «degradado», lo que aprueba pasa a revisión humana.
5. **Estadísticas → banderas:** preguntas con acierto ≈ 0 % con n suficiente se proponen para retiro (decide el profesor).
6. **Retrospectiva aceptada → regla del cuaderno** (borrador).
7. **Monitor de regresión:** si la tasa de aprobación baja de forma significativa tras activar algo, aviso y vuelta a la versión anterior.

## 6. Nuevas memorias (plan)
- **Doctrina pedagógica global** (conocimiento curado de investigación educativa; ver abajo).
- **Errores comunes por concepto:** qué responden mal los estudiantes en cada concepto (sin datos individuales) → distractores plausibles y repaso. Requiere volumen real de estudiantes.
- **Ejemplos aprobados:** preguntas aprobadas por el profesor con buen acierto, como modelo (few-shot).
- **Memoria del profesor:** preferencias que heredan sus clases nuevas.

### La doctrina global
Conocimiento de **esencia** (principios, no textos) con fuentes de universidades y autores reconocidos en pedagogía, psicología del aprendizaje, creatividad e innovación educativa. Cada principio: enunciado propio, **cómo se aplica en Stud.ia** (regla operativa), **límites**, nivel de evidencia (fuerte / moderada / discutida) y fuentes con estado de verificación. Se incluyen también **«anti-principios»** (mitos que la IA no debe repetir: estilos de aprendizaje, etc.). Se selecciona por tarea (generar, dar retroalimentación, interpretar resultados, investigar) y entra al prompt solo si el A/B lo respalda.
**Sobre el «perfil profesional»:** los adjetivos (estricto, creativo, analítico…) no hacen mejor a un modelo por sí solos; lo que sí funciona es convertirlos en **conductas verificables** (p. ej. «estricto» = verifica la clave contra el material; «analítico» = no interpreta con n pequeño; «investigativo» = cita fuente o dice que no la tiene) y medirlas.

## 7. Roadmap de PRs
1. Medición (este PR): taxonomía, línea base, estadística, arnés A/B, primer experimento.
2. Doctrina global: base de conocimiento verificada + persona operacional + selección + vista de transparencia.
3. Flechas 3 a 6.
4. Nuevas memorias (errores comunes, ejemplos, profesor) con su migración.
5. Monitor de regresión y reversión.
Cada PR: pruebas, medición donde cambie el comportamiento, y «Verificado / NO verificado».

## 8. Resultado del primer experimento (2026-11-09) — INCOMPLETO
`item_writing_v1` vs generación base, brazos intercalados, mismos módulos, mismo juez. **Resultado: sin evidencia** (brazo A 43 de 46 pasan = 93,5 %; brazo B 33 de 35 = 94,3 %; diferencia +0,8 pp, IC95 % −12,8 a +12,5 pp). **No es concluyente por dos razones:** (1) el experimento se **interrumpió** a mitad: se agotaron los créditos prepagados de Gemini (HTTP 402, «Your prepayment credits are depleted») y 12 de las 36 llamadas previstas fallaron, de modo que los brazos no quedaron igualados (7 llamadas contra 5); (2) **efecto techo**: el generador actual ya aprueba ~93 % en estos módulos, así que el margen de mejora es pequeño y detectarlo exige mucha más muestra. Hay que **repetirlo completo** cuando haya créditos, y con módulos donde la línea base sea más baja. Archivo: `memoria-calidad/experimentos/2026-11-09-item_writing_v1.json` (marcado `incompleto`).

**Lección operativa (ya corregida):** el arnés ahora evalúa en **pares** (mismo módulo y repetición; solo cuenta un par si responden los dos brazos) y se **detiene** tras 3 pares fallidos seguidos marcando el resultado como incompleto. Probado con los créditos agotados: se detuvo solo a los 3 pares.

## 9. Segundo experimento (2026-11-10) — COMPLETO, y lo que enseña
Tres brazos corriendo juntos (base, reglas `item_writing_v1`, doctrina `2026-11-v1`), **15 grupos completos de 15**, 5 módulos de peor aprobación histórica (29–50 %) × 3 repeticiones, **120 preguntas por brazo**, mismo contexto y mismo juez; 0 grupos descartados; generación legible 15/16 (base; un reintento), 15/15 (reglas), 15/15 (doctrina).

| Brazo | Pasan el juez | Diferencia contra la base (IC 95 %) | Decisión |
|---|---|---|---|
| Base | 116 de 118 (98,3 %) | — | — |
| Reglas | 102 de 102 (100 %) | +1,7 pp (−2,1 a +6,0) | **sin evidencia** |
| Doctrina | 101 de 103 (98,1 %) | −0,2 pp (−5,3 a +4,3) | **sin evidencia** |

**Lectura honesta:**
1. **No hay evidencia de que ni las reglas ni la doctrina cambien la aprobación del juez.** Tampoco la hay de que no sirvan: los intervalos son estrechos (≈ ±5 pp) pero la métrica está en el **techo**.
2. **Efecto techo, ahora comprobado.** Incluso en los módulos donde el generador histórico fallaba más, el generador **actual** pasa el ~98 % ante el juez. La baja aprobación histórica (25 % en agosto) la causaron generadores y criterios viejos, ya superados. **Un juez que aprueba 98 % no puede mostrar mejora**, y además el propio juez es indulgente: en la calibración contra el profesor aprobó 2 preguntas que el profesor rechazó (de 14 comparables).
3. **Conclusión operativa:** la doctrina **permanece APAGADA** (`DOCTRINE` sin definir). Medir «¿pasa el juez?» ya no discrimina; hace falta una métrica **más exigente e independiente** (ver siguiente).
4. **Reserva metodológica:** en este experimento el orden de juicio era fijo (base, reglas, doctrina) y las exclusiones por infraestructura (segunda opinión no disponible) cayeron casi todas en los últimos brazos (base 0, reglas 11, doctrina 13). Se **corrigió** rotando el orden en cada grupo; este resultado debe leerse con esa reserva.

**Qué medir ahora** (en orden de costo): (a) un **auditor estricto** (otro modelo, rúbrica más dura, distinta del juez) sobre una muestra de ambos brazos; (b) una **muestra revisada por el profesor** (p. ej. 40 preguntas ciegas al brazo) — es la verdad de referencia; (c) **rendimiento de estudiantes** (aciertos y discriminación) cuando haya volumen real.

## 10. Flechas cerradas (2026-11-10)
Cuatro conexiones entre memorias, todas **con una persona o una medición en medio**: ninguna cambia por sí sola lo que la IA genera ni publica sin que el profesor lo decida (salvo el interruptor de seguridad del juez, que solo quita un poder). Sin migración.

| # | Flecha | Qué hace | Quién decide | Hoy |
|---|---|---|---|---|
| 1 | Rechazos → reglas propuestas | En «Estilo de la IA»: analiza los motivos de rechazo o revisión de la clase; si una categoría de error **del generador** se repite (≥ 8 casos y ≥ 8 %, sobre ≥ 30 motivos) agrega al cuaderno, como **borrador** de origen «ai», la **plantilla curada** correspondiente con su evidencia («86 de 254 rechazos, 34 %…») | El profesor activa o descarta | Con datos reales propondría 2 reglas (error conceptual/cálculo 34 %, anclaje al material 16 %) |
| 2 | Calibración del juez → pipeline | Si el juez sale **degradado** (≥ 20 comparaciones decisivas y cota inferior del acuerdo < 80 %), lo que **aprueba** pasa a **revisión humana** en vez de publicarse solo. Nunca aprueba ni rechaza de más | Automático, solo para quitar poder al juez | Estado «sin datos suficientes»: **no actúa** |
| 3 | Estadísticas → banderas | En «Revisión»: preguntas con ≥ 10 respuestas y acierto < 20 % o > 95 %; botón «Retirar» | El profesor retira | 0 banderas: ninguna pregunta llega aún a 10 respuestas |
| 4 | Retrospectiva aceptada → regla | Una sugerencia **aceptada** de «reforzar un concepto» se puede agregar al cuaderno como borrador | El profesor acepta y luego agrega | Sin retrospectivas reales todavía |

**Por qué plantillas y no reglas libres:** una IA que redacte reglas puede introducir instrucciones erróneas dentro de los prompts de todos; una plantilla curada y revisada de antemano no. **Honestidad:** que una regla esté bien fundamentada **no prueba** que reduzca errores en este generador (los experimentos A/B no mostraron efecto medible; ver §9). Por eso son propuestas visibles con su evidencia, nunca activas por sí solas. Retirar una pregunta desde una bandera queda registrado como decisión del profesor y alimenta la calibración del juez.

## 11. Auditor estricto y memorias nuevas (2026-11-10)

### 11.1 Por qué un auditor
El juez de producción aprueba ~98 % de lo que genera el generador actual (§9): no discrimina, así que no puede decir si una regla o la doctrina sirven. El **auditor estricto** (`src/lib/questions/auditor.ts`) mide otra cosa con dos protocolos que **no dependen del veredicto del juez**:
1. **Resolución ciega:** el modelo resuelve la pregunta **sin** ver la respuesta marcada ni la explicación. Si su respuesta difiere de la marcada, la pregunta es sospechosa. Solo opción múltiple y verdadero/falso (comparación exacta).
2. **Defectos con cita:** lista cerrada de 12 defectos (respuesta incorrecta, más de una correcta, dato faltante, pista accidental, cálculo erróneo…), cada uno con severidad y una **cita textual** que el código **verifica que exista** en la pregunta; defectos sin cita real se descartan (frena que el modelo invente defectos para parecer estricto).

Una pregunta es **sospechosa** si la resolución ciega discrepa o tiene un defecto crítico o mayor con cita. Es una **medición, no una decisión**: no cambia ninguna pregunta. Y es una señal más dura que el juez, **no la verdad**: la referencia sigue siendo el profesor. Si el auditor no responde (infraestructura), la pregunta **no cuenta** ni a favor ni en contra.

### 11.2 Auditoría del banco real (60 preguntas aprobadas, clases reales, semilla 7)
**10 de 60 sospechosas (16,7 %; IC95 % 9,3–28,0 %)** frente al ~98 % de aprobación del juez: el auditor sí discrimina. Resolución ciega discrepa en 1 de 34. Entre las marcadas hay casos que parecen reales (una pregunta de «curvas de Engel» duplicada y con la frase «el material indica textualmente» dentro del enunciado; un posible error de cálculo en una tasa marginal de sustitución) y otros discutibles (ambigüedad). **Falta saber cuántas son falsas alarmas del auditor:** para eso se generó una **muestra ciega de 40 preguntas** (`memoria-calidad/auditorias/2026-11-10-muestra-ciega.md`) que el profesor decide A/R/X sin ver lo que opinaron el juez ni el auditor; la **clave** (`…-clave.json`) no se le comparte hasta que termine. Con esas decisiones se calcula cuánto acierta el auditor **y** cuánto el juez, contra la misma referencia.

### 11.3 Memorias nuevas
| Memoria | Dónde vive | Quién la escribe | Entra al prompt |
|---|---|---|---|
| **Notas del profesor** (contexto que solo él conoce) | tabla `ai_class_notes` (migración 102, RLS: solo el profesor dueño) | el profesor, en «Estilo de la IA» | sí, cuando existen (es decisión explícita del profesor) |
| **Errores comunes por concepto** | derivada al leer de `lesson_questions` (`review_reason` + `concept_tag`); solo errores del generador, ≥ 3 casos del mismo error en el mismo concepto | automática | **apagada** (`CLASS_MEMORY=on`) |
| **Ejemplos aprobados** | derivada al leer: preguntas aprobadas por el profesor (`reviewed_by='teacher'`), hasta 3, solo como referencia («no las copies») | automática | **apagada** (`CLASS_MEMORY=on`) |

Las dos derivadas **no tienen tabla a propósito**: la fuente de verdad ya es `lesson_questions`; guardarlas aparte las dejaría desincronizadas. Su efecto **no está medido** (el juez estaba en el techo), por eso nacen apagadas y se encienden solo si el auditor estricto muestra mejora. Todo texto que entra al prompt se limpia de saltos de línea y marcadores y se acota por presupuesto.

### 11.4 Tercer experimento: reglas y doctrina medidas con el auditor
Tres brazos juntos, 15 grupos completos de 15 (5 módulos de peor aprobación histórica × 3 repeticiones), orden de juicio rotado, auditor en todas las preguntas válidas de forma. Archivo: `memoria-calidad/experimentos/2026-11-10-base+item_writing_v1+doctrina+auditor.json`.

| Brazo | Pasan el juez | Sospechosas para el auditor | Limpias contra la base (IC 95 %) | Decisión |
|---|---|---|---|---|
| Base | 93 de 95 (97,9 %) | 4 de 87 (4,6 %) | — | — |
| Reglas | 100 de 103 (97,1 %) | 11 de 87 (12,6 %) | −8,0 pp (−17,1 a +0,5) | **sin evidencia** |
| Doctrina | 101 de 104 (97,1 %) | 7 de 85 (8,2 %) | −3,6 pp (−11,9 a +4,2) | **sin evidencia** |

**Lectura honesta:** (1) **No hay evidencia de mejora** de reglas ni doctrina, tampoco con la métrica que sí discrimina. (2) Las estimaciones puntuales van **en contra** de los tratamientos (las reglas llegan casi a ser peores, límite superior del intervalo +0,5 pp), pero con 4, 11 y 7 sospechosas el ruido es grande: **no se puede afirmar que empeoren**. (3) El auditor es otro modelo y puede equivocarse; sus sospechas se calibran con la muestra ciega del profesor. (4) **Decisión operativa:** la doctrina sigue APAGADA, las reglas `item_writing_v1` no se recomiendan como activas por defecto, y las memorias derivadas (§11.3) nacen apagadas por la misma razón. Para repetirlo con más poder hace falta más muestra (≈ 60 preguntas sospechosas por brazo) o una métrica con más señal (la revisión del profesor).

**Defecto de método corregido en este PR:** el archivo de resultados llevaba el mismo nombre que el del experimento anterior y lo habría sobrescrito; ahora incluye `+auditor`.

### 11.5 Calibración contra el profesor (2026-11-11)
El profesor revisó a ciegas la muestra de 40 preguntas **aprobadas por el juez** (A = usable tal cual, R = corregir, X = descartar): **35 A, 4 R, 1 X**. Datos y aciertos en `memoria-calidad/auditorias/2026-11-11-calibracion.json` (solo números e índices; el contenido de las preguntas no se publica).

| Medida | Resultado | IC 95 % |
|---|---|---|
| Preguntas **aprobadas por el juez** que el profesor encontró defectuosas | **5 de 40 (12,5 %)** | 5,5 – 26,1 % |
| Defectos que el **juez** detectó | 0 de 5 (las 40 estaban aprobadas) | — |
| **Auditor**: precisión (de lo que marca, cuánto es defecto real) | 3 de 6 (50 %) | 18,8 – 81,2 % |
| **Auditor**: sensibilidad (de los defectos reales, cuántos marca) | 3 de 5 (60 %) | 23,1 – 88,2 % |

**Lectura honesta:**
1. **El hallazgo importante no es el auditor, es el juez:** el juez aprueba ~98 % de lo que genera, pero el profesor rechaza o corrige ~1 de cada 8 de lo que el juez aprobó (12,5 %, con incertidumbre de 5 a 26 %). La calidad real del banco aprobado es menor que la que reporta el juez.
2. **El auditor no es una referencia confiable por sí solo:** acierta la mitad de lo que marca y deja pasar 2 de 5 defectos reales, incluido un error de fondo (una demanda «derivada de la utilidad indirecta» que se deriva del problema primal). Pero **sirve para priorizar la revisión del profesor**: entre lo que marca, la tasa de defecto real es 50 % frente al 12,5 % base (unas 4 veces más), y el juez no detectó ninguno.
3. **Consecuencia para los experimentos A/B (§9, §11.4):** una métrica con 50 % de precisión y 60 % de sensibilidad añade mucho ruido; «sin evidencia» sigue siendo la lectura correcta y **no** se puede concluir que reglas o doctrina empeoren. La referencia útil es la revisión del profesor.
4. **Límite de la muestra:** n = 40, intervalos amplios; las cifras orientan, no prueban. Falsos positivos del auditor: #15 (cita en la explicación), #18 y #28 (la explicación sí tenía un defecto menor que Gemini corrigió, pero el profesor lo consideró usable).
5. **Efecto sobre la calibración del juez:** si estas 40 decisiones se registraran como decisiones del profesor, el acuerdo del juez con el profesor sería 35 de 40 (87,5 %) con cota inferior de Wilson ≈ 74 % < 80 %: el estado pasaría a «degradado» y el interruptor de §10 enviaría lo que el juez aprueba a revisión humana. Es el sistema funcionando como se diseñó; registrar las decisiones requiere autorización del profesor.
## 12. Monitor de regresión con reversión (2026-11-11)

### 12.1 Qué hace
Vigila que lo que la IA lee (hoy: el **cuaderno de estilo activo**) no **empeore** la calidad de lo que genera, y avisa con evidencia cuando eso parece ocurrir. Vive en «Estilo de la IA» como la tarjeta **Vigilancia de calidad** (`QualityWatch.tsx`), alimentada por `regressionMonitor.ts` (núcleo puro) y `monitorLoader.ts` (lectura; nunca lanza). El script `scripts/quality-monitor.ts` lo corre sobre todas las clases reales y, con `--guardar`, deja una foto **solo con números** en `memoria-calidad/monitor/`.

### 12.2 Qué mide y con qué rigor
Entre las preguntas generadas **antes** y **después** de activar el cuaderno actual (el «antes» es el periodo de la versión previa, o todo lo anterior si no había), la proporción de **buenas**: *buena* = aprobada; *mala* = rechazada por el profesor, o rechazada/en revisión con un motivo atribuible al **generador**; se **excluyen** pendientes, infraestructura, pipeline y validador de forma (misma taxonomía que la línea base). Se compara con la estadística de los experimentos (Wilson/Newcombe, mínimo 30 por periodo):

| Nivel | Condición | Alerta |
|---|---|---|
| `sin_datos` | < 30 en algún periodo | ninguna |
| `estable` / `mejora` | sin cambio claro / intervalo entero del lado bueno | ninguna |
| **`vigilar`** | cae ≥ 10 puntos pero el intervalo aún cruza 0 | atención (propone revertir) |
| **`regresion`** | intervalo de la diferencia entero del lado malo | urgente (propone revertir) |

Además avisa cuando el **juez está degradado** (§10) y cuando la **cola de revisión** tiene ≥ 20 preguntas.

### 12.3 La reversión la decide el profesor
La alerta trae un botón: **«Volver a la versión N»** (activa la versión previa) o **«Desactivar el cuaderno»** (si no había previa), que usan las acciones existentes del cuaderno (reversibles: la versión revertida queda en el historial). El monitor **no escribe nada ni revierte solo**: está cubierto por pruebas (el núcleo y el cargador no contienen insert/update/delete ni activate/deactivate). Decisión de diseño: igual que el resto de la memoria de la clase, ningún cambio de comportamiento ocurre sin una persona; una reversión automática se podría habilitar después con un umbral más exigente (p. ej. solo `regresion` con ≥ 100 preguntas por periodo), pero no hay datos que la justifiquen hoy.

### 12.4 Límites honestos
1. **Observacional, no un experimento:** el antes y el después son periodos distintos (otros módulos, otro material). Una alerta es una pista, no una prueba de causalidad.
2. **Poca potencia:** con aprobación alta (~98 %) y poca muestra, `regresion` casi nunca saltará; por eso existe `vigilar`. **«Estable» no prueba que el cuaderno sirva.**
3. **El juez es ciego a parte de los errores** (§11.5: el profesor halló defecto en 12,5 % de lo aprobado): la señal más confiable son las decisiones del profesor, que el monitor cuenta como verdad cuando existen. Las muestras ciegas periódicas (~40 preguntas) siguen siendo la referencia.
4. Un tramo sin cuaderno entre dos versiones cuenta como «antes».
5. Solo vigila el **cuaderno**. Notas del profesor, doctrina y memorias derivadas no están activas o no se pueden separar por periodo todavía.

### 12.5 Sobre datos reales (2026-11-11)
Ninguna clase tiene hoy un cuaderno activo, así que **la comparación antes/después no se ejerció con datos reales** (solo con pruebas y datos de ejemplo). Sí se ejerció lo demás: **Microeconomía I → `juez_degradado` + `cola_larga`** (46 comparaciones, cota inferior 76,5 %; ≥ 20 preguntas en revisión), las otras dos clases sin alertas.

## 13. Bucle iterativo con juez externo (2026-11-11)

### 13.1 Qué es y por qué
La calibración de la IA de la app dependía de decisiones del profesor, que cuestan conseguir. El bucle agrega un **segundo canal** que no depende de él: un **revisor externo** (un modelo fuerte operado por una persona desde una sesión de Claude Code; **la app nunca lo llama en producción**) revisa y **corrige** preguntas en lote, y las correcciones se integran al banco con trazabilidad. Los dos canales se tratan distinto a propósito:

| Canal | Qué es | Peso |
|---|---|---|
| **Decisiones del profesor** | La verdad de referencia (§10, §11.5, §12) | Calibra al juez y activa el interruptor de seguridad |
| **Juez externo** | Revisor fuerte, rápido y barato, **no validado todavía** | Puede **retirar** preguntas malas de inmediato; solo puede **aprobar** cuando esté **validado** frente al profesor (compuerta 13.3) |

### 13.2 Flujo (`scripts/lote.ts`)
1. `generar` — la IA de la app genera **en local** (sin tocar la base), pasa el validador de forma y el juez de la app, y deja el lote en `memoria-calidad/lotes/<id>/` (`lote.md` para leer).  `exportar-banco` hace lo mismo con preguntas **ya servidas** (solo lectura).
2. El revisor externo escribe `revision.json`: por pregunta, veredicto `bueno | corregir | malo`, defectos del **catálogo del auditor** (12 códigos, severidad y una **cita textual**) y, si corrige, la versión corregida.
3. `resumen <id> [--guardar]` — valida la revisión de forma **estricta** (cada pregunta una vez; citas que existan en la pregunta; «bueno» sin defectos serios; correcciones que pasen el validador de forma, conserven el tipo y sean distintas) y calcula la calidad **cruda** (`bueno/n`: el generador tal como sale) y la **entregable** (`bueno+corregir`) con intervalo de Wilson al 95 %. `comparar <A> <B>` compara dos lotes con la estadística de los experimentos.
4. `aplicar <id> [--db]` — ensayo en seco por defecto; con `--db` inserta/corrige en el banco, deja **una fila por pregunta revisada** en `ai_question_revisions` (antes/después, veredicto, defectos: permite revertir y validar al revisor) y la ronda en `ai_quality_rounds` (solo números). Requiere la **migración 103**.

### 13.3 Regla asimétrica y compuerta de validación
- **Retirar es siempre posible** (quitar una pregunta es la dirección segura y reversible). **Aprobar** exige que el revisor externo esté **validado**: acuerdo con el profesor, sobre preguntas que ambos decidieron, con cota inferior de Wilson ≥ 80 % y ≥ 20 comparaciones (`validateExternal`).
- Mientras no esté validado: sus «bueno» **no cambian el estado**, y lo nuevo o corregido entra como `human_review`, nunca como `approved`.
- **Aviso sobre el estado actual:** hoy el banco **sirve** a estudiantes toda pregunta no rechazada, incluidas las `pending` y `human_review` (`servableQuestions` solo excluye `rejected`). `human_review` no protege a los estudiantes; por eso retirar sí importa.

### 13.4 Ronda 1 (2026-11-11): 79 preguntas revisadas
| Lote | n | Buenas tal como salen (cruda) | IC 95 % | Pasan el juez de la app y tenían defecto |
|---|---|---|---|---|
| Generado en local (base) | 39 | 28 (71,8 %) | 56,2 – 83,5 % | 10 de 38 (precisión del «pass» 73,7 %) |
| Banco servido | 40 | 31 (77,5 %) | 62,5 – 87,7 % | 5 de 17 con juez (70,6 %) |
| **Combinado** | **79** | **59 (74,7 %)** | **64,1 – 83,0 %** | |

La calidad **entregable** (buenas + corregidas) fue 100 % y 97,5 %, pero **no es una medida independiente**: las correcciones las hizo el mismo revisor y el profesor aún no las valida. **Ni la meta del 90 % ni su IC se cumplen hoy.** Para confirmar el 90 % con IC 95 % hace falta, según la tasa real: ≈ 375 preguntas si es 93 %, ≈ 130 si es 95 %, ≈ 70 si es 97 %.

Defectos más frecuentes (28 registrados en ambas rondas): ambigüedad en respuestas aceptadas o en el enunciado (18; p. ej. respuestas aceptadas que dejan mal a quien contesta bien o piden cosas que el calificador no admite), enunciados que dependen de una gráfica que no se da (3), frases del material copiadas sin entenderse, como «(excepto negativos)» (2), definiciones equivalentes en emparejar, explicaciones que contradicen la clave.

### 13.5 Lo aprendido, integrado a la IA de la app
1. **Hallazgo del calificador (activo):** en la app, `fill_blank` y `short_answer` exigen que aparezcan **todas** las respuestas / palabras clave de la lista (cliente y servidor). Una lista de sinónimos, o más respuestas que huecos, o «dos» pedidos con tres palabras clave, hace la pregunta imposible de acertar de forma natural. Tres **reglas deterministas** nuevas en el validador de forma (`typability.ts`, sin costo de IA, activas): una respuesta por hueco; la cantidad pedida («dos», «tres»…) debe coincidir con las palabras clave; en emparejar, términos no repetidos. Impacto medido sobre el banco real: **6 de 575** preguntas no rechazadas dejarían de servirse, todas defectos genuinos (1 completar, 4 respuesta corta, 1 emparejar). *Una regla que propuse al inicio —rechazar definiciones idénticas— se descartó al medirla: ocultaba 3 preguntas legítimas, porque el calificador compara el texto de la definición.*
2. **Reglas de redacción `item_writing_v2`** (8 reglas, cada una con su evidencia): **apagadas**; se miden en la ronda 2 con preguntas nuevas.
3. **Rúbrica v2 del juez** (`JUDGE_RUBRIC=v2`, 7 comprobaciones adicionales): **apagada**; mismo criterio.
4. **El auditor ya ve las preguntas «match»** (antes sus pares eran invisibles para él).
5. **Método anti-sobreajuste:** reglas y rúbrica v2 nacieron de las 79 preguntas de la ronda 1; **no** se miden con ellas, sino con una ronda nueva (`generar --reglas item_writing_v2` contra `generar` base, misma semilla; `comparar`).

### 13.6 Límites honestos
1. El revisor externo **no está validado**: es un modelo, estricto por diseño, y su estándar puede ser más duro que el del profesor (en la muestra ciega el profesor aceptó preguntas que el auditor marcó). Sus cifras son una **estimación a validar**, no la verdad.
2. Se desvió un patrón del propio proceso: **no usé** como validación las 40 preguntas de la muestra ciega, porque ya conocía las decisiones del profesor (no serían ciegas). La validación correcta es **prospectiva**: el revisor externo registra sus veredictos sobre la cola de revisión **antes** de que el profesor decida, y luego se calcula el acuerdo.
3. Muestras pequeñas (≈ 40 por lote): los intervalos son amplios. Un lote nuevo con reglas v2 necesita ≥ 50 por brazo para detectar mejoras de ≈ 20 puntos.
4. La calidad medida es de redacción y corrección; **no** mide aprendizaje de estudiantes.

### 13.7 Validación prospectiva del revisor externo (2026-11-11)
**Qué se hizo:** el revisor externo revisó las **39 preguntas clásicas de la cola de revisión** (human_review; las otras 11 son minijuegos, que el bucle aún no cubre) **antes** de que el profesor las decidiera, y guardó sus veredictos con `aplicar --db --solo-registrar`: queda una fila por pregunta en `ai_question_revisions` con sello de tiempo, **sin modificar ninguna pregunta** (si se aplicaran las correcciones antes, el profesor decidiría sobre un texto distinto y la comparación quedaría contaminada).

**Resultado de la revisión (solo el revisor):** 26 buenas y 13 a corregir (66,7 % tal como salen; IC 95 % 51,0 – 79,4 %). Es una cola que el juez ya había apartado por dudas, así que su calidad es menor que la del banco aprobado. Defectos serios más frecuentes: respuestas aceptadas o palabras clave que dejan mal a quien contesta bien (6), explicación o afirmación falsa (3), etiquetas de figuras (1), opciones que se resuelven por absolutos (1).

**Cómo se cierra la validación:** el profesor decide esas preguntas en «Revisión» (aprobar o rechazar, tal como están). Después, `scripts/lote.ts validacion` calcula el acuerdo entre el revisor externo y el profesor sobre las preguntas que ambos decidieron; con **≥ 20 comparaciones y cota inferior de Wilson ≥ 80 %** el revisor queda **validado** (puede aprobar; ver 13.3). Solo cuentan las preguntas de la cola (las del lote de banco ya aprobadas no pasarán por el profesor). Cuando el profesor termine, se aplican las correcciones con `aplicar --db` (sin `--solo-registrar`).

**Cómo se interpreta la discrepancia:** «el externo dijo corregir y el profesor aprobó» no siempre es un error del externo (el profesor puede aceptar algo que un revisor estricto mejoraría); por eso se reportan por separado falsos aprobados (peligrosos) y falsos rechazos (solo exigencia de más).

### 13.8 Primer intento de validación: **no validado** (2026-11-11)
El profesor decidió 30 de las 39 preguntas clásicas de la cola que el revisor externo había revisado antes (sin cambiar ninguna). Resultado (`memoria-calidad/rondas/validacion-2026-11-11.json`):

| | Profesor aprobó | Profesor rechazó |
|---|---|---|
| Revisor externo: **bueno** (18) | 9 | 9 |
| Revisor externo: **corregir** (12) | 6 | 6 |

- **Acuerdo 15 de 30 (50 %; IC 95 % 33–67 %; cota inferior 33 %) → NO validado.** El revisor externo **no puede aprobar** y sigue sin poder.
- **Hallazgo duro:** el veredicto del revisor externo **no predice** la decisión del profesor en esta cola: la tasa de rechazo del profesor es 50 % tanto entre lo que el revisor llamó «bueno» como entre lo que llamó «corregir». Con 30 pares es una muestra pequeña, pero el resultado no apunta en la dirección esperada.
- **La cola está mucho peor que el banco aprobado:** el profesor rechazó el 50 % (15 de 30), frente al 12,5 % de rechazo en la muestra ciega de preguntas ya aprobadas por el juez (§11.5).
- **Hipótesis probadas y descartadas con los datos:** (1) *duplicados*: rechazadas y aprobadas tienen la misma frecuencia de gemelo aprobado y más antiguo (4/15 y 3/15); (2) *anclaje al material*: cuando el juez no pudo dar segunda opinión, el profesor aprobó 11 y rechazó 11 (sin patrón). **No se puede deducir el criterio del profesor con los datos que hay: hace falta preguntarle el motivo de las discrepancias.**
- **Dos ejes distintos:** parte de las discrepancias (6 de «corregir» que el profesor aprobó) son defectos **funcionales** del calificador (palabras clave de más, variantes de respuesta) que no se ven leyendo el contenido y que ahora detecta el validador determinista; no son errores del revisor. El eje que importa para validar es el **de contenido**.
- **Consecuencia:** no se aplican las 13 correcciones ni se insertan preguntas nuevas con este revisor. Las preguntas rechazadas por el profesor quedan retiradas; las 9 pendientes siguen en su cola.
## 14. El criterio explícito del profesor: «todo debe estar en el material» (2026-11-11)

### 14.1 El criterio
Al revisar las 9 preguntas que el profesor rechazó y el revisor externo había dado por buenas, el profesor explicó su criterio: **no quiere preguntas cuyo contenido no esté explícitamente en los materiales**, por dos razones: (1) si no está explícito, el modelo está fallando en leer, extraer y generar; (2) los estudiantes estudian con los materiales y lo que no está allí no les sirve. También rechaza preguntas con **resultados incorrectos** de procedimientos, conceptos o ideas **no sustentadas por los materiales**. Esto **revierte** la decisión del 2026-10-27 de juzgar por «correcto en la materia» (criterio `subject` del juez): el criterio que coincide con el profesor es `material` (`JUDGE_CRITERION=material`).

### 14.2 Se probó si ese criterio se puede medir de forma automática (70 preguntas con decisión del profesor: 30 de la cola + 40 de la muestra ciega; 20 malas)
| Medida | Resultado |
|---|---|
| **Cobertura léxica** del enunciado + respuesta dentro de una ventana del material (determinista, sin IA) | AUC 0,36 (< 0,5: **invertida**); las malas tienen *más* cobertura (0,74) que las buenas (0,64) |
| Presencia de la **respuesta** en el material | AUC 0,47 (≈ azar) |
| **Verificador semántico** (IA obligada a citar la frase literal; el código comprueba que la cita existe) | En la cola: marca «mala» con precisión 50 % = la tasa base (sensibilidad 40 %); entre las que da por «explícita» el profesor rechazó 9 de 18. En la muestra ciega: precisión 21 % (tasa base 13 %), sensibilidad 60 % |

**Conclusión:** ni el anclaje léxico ni el semántico predicen las decisiones del profesor sobre la cola. Para las 9 rechazadas que el revisor externo había dado por buenas, el verificador encontró una **cita literal válida** en el material (p. ej. las dos de Leontief citan la misma frase exacta, y el «$320» del excedente del consumidor aparece en el material), así que **el anclaje no explica esos rechazos**.

### 14.3 Lo que sí se puede explicar (poco)
- **Casi-duplicados dentro de la cola:** el trío del excedente del consumidor (1 aprobada, 2 rechazadas) y el par de oferta-precio (1 y 1) son compatibles con «un representante por concepto»; el par de Leontief se rechazó entero y los 30 casos sin gemelo se decidieron ≈ 50/50 (11 aprobadas, 10 rechazadas). Los casi-duplicados explican a lo sumo 3–4 de 15 rechazos.
- **Defectos funcionales del calificador** (respuestas aceptadas o palabras clave que dejan mal a quien contesta bien): reales y ya filtrados por el validador determinista (§13.5), pero invisibles al leer el contenido.

### 14.4 Lo que NO se sabe
Por qué el profesor rechaza ≈ 50 % de la cola cuando muchas de las rechazadas están literalmente en el material y son correctas. Candidatos aún sin probar: preguntas **triviales por copia literal** (la frase del material con una palabra quitada), **redundancia por concepto** más amplia que el casi-duplicado léxico, o criterios que dependen de cada pregunta. **Se pregunta al profesor** por el motivo de un conjunto pequeño de rechazos concretos antes de construir cualquier compuerta nueva; construir una sin entender el criterio reproduciría el error de §13.8.

### 14.5 Decisiones operativas
- El revisor externo sigue **no validado**: no aprueba ni inserta preguntas.
- **No** se cambia el criterio por defecto del juez en este PR: el criterio `material` ya existe, pero con la evidencia disponible no se puede asegurar que reduzca el rechazo del profesor (hay que medirlo contra sus decisiones antes de activarlo en producción).
- Código de investigación (cobertura léxica y verificador semántico) **no** se incorpora al sistema: no predice la decisión del profesor.
