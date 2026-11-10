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
