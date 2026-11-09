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
