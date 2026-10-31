# Escalabilidad de los datos: ¿migrar a NoSQL?

Reflexión de arquitectura, no un plan de migración. Fecha de los números: 2026-10-31 (consultas de solo lectura sobre producción).

## 1. Dónde estamos (medido)

| Dato | Valor |
|---|---|
| Tamaño total de la base | **38 MB** |
| Tabla más grande | `material_chunks`, 4 MB (197 filas) |
| Usuarios / clases | 12 perfiles, 3 clases |
| Tablas / claves foráneas | 40 / **68** |
| Políticas de seguridad por fila (RLS) | **90** |
| Migraciones propias / índices | 84 / 129 |
| Código que consulta la base directamente | **297** llamadas `.from('tabla')` en **83** archivos (40 son componentes o páginas de interfaz), más 27 `rpc` |

Hoy no hay ningún problema de escala. Postgres en Supabase maneja con holgura millones de filas por tabla; con 38 MB el límite está a varios órdenes de magnitud.

## 2. Qué es este sistema

No es un almacén de documentos sueltos: es un sistema **relacional con la seguridad y la lógica dentro de la base**.

- **La integridad vive en la base:** 68 claves foráneas con `ON DELETE CASCADE` (borrar una clase limpia módulos, preguntas, intentos).
- **La seguridad vive en la base:** 90 políticas RLS. Un estudiante solo ve lo de su clase *aunque el código de la aplicación falle*. Es la razón por la que cerramos agujeros con permisos por columna y funciones `SECURITY DEFINER`.
- **Las operaciones críticas son transacciones:** `finish_lesson` bloquea el intento (`FOR UPDATE`) para no sumar dos veces; el límite de uso de la IA usa candados consultivos; la memoria de clase reclama su turno de forma atómica.
- **Las consultas del profesor son uniones y agregados:** métricas por concepto, matriz concepto × estudiante, progreso de la clase.
- **La búsqueda de materiales es híbrida:** vectores (pgvector) + texto completo en español, fusionados en una sola consulta.

Pasar todo a NoSQL (DynamoDB, Firestore, Mongo…) significaría **reescribir estas garantías en el código de la aplicación**: la seguridad por fila, las transacciones, las uniones y la búsqueda híbrida. Es justo donde se cometen los errores de seguridad y de integridad que acabamos de cerrar. Mi recomendación honesta: **no migrar la base principal a NoSQL**.

## 3. Qué crecerá de verdad (y cómo escalarlo sin cambiar de paradigma)

El crecimiento previsible no es «más clases»; son **eventos** y **vectores**:

| Carga | Por qué crece | Primer paso (sigue en Postgres) | Si no basta |
|---|---|---|---|
| `question_attempts`, intentos de lección, registros del tutor | una fila por respuesta, de cada estudiante, cada día | índices por `(estudiante, fecha)` y `(clase, concepto)`; **particionado por mes**; tablas resumen / vistas materializadas para los tableros | archivar lo frío en almacenamiento de objetos y analizarlo en un almacén columnar (BigQuery, ClickHouse) |
| Fragmentos y embeddings | cada material subido | índice **HNSW** de pgvector; un perfil de embedding por consulta | base vectorial dedicada (Qdrant, Pinecone) cuando pasen de millones de fragmentos |
| Lecturas calientes (lección servida, tableros) | muchos estudiantes a la vez | caché (Redis/Upstash), réplica de lectura | — |
| Conexiones | funciones sin servidor abren muchas | pooler de conexiones (ya lo ofrece Supabase) | — |
| Documentos con forma libre (`class_memory`, `labs.spec`, `game_data`) | no crecen en cantidad, sí en tamaño | ya son **JSONB** con restricciones de tamaño; índices GIN si hace falta | — |

Es decir: **persistencia políglota por carga de trabajo**, no una migración total. Postgres sigue siendo la fuente de verdad de identidad, clases, matrículas y notas (lo que necesita transacciones y RLS); las cargas de eventos y de vectores pueden ir saliendo a herramientas especializadas *cuando una señal lo pida*.

## 4. Señales para decidir (en vez de adivinar)

Revisar esto de forma periódica; si alguna se cumple de forma sostenida, se abre el análisis:

- una tabla de eventos pasa de ~**100 millones** de filas, o la base supera cientos de GB;
- escrituras sostenidas de **miles por segundo**;
- el **p95** de una consulta del profesor supera su objetivo *después* de índices, particionado y resúmenes;
- se necesita **multi-región** con escritura local;
- el costo de la base crece más rápido que los ingresos.

Mientras ninguna ocurra, migrar es costo sin beneficio: semanas de trabajo, riesgo de perder integridad y seguridad, y dos sistemas que mantener.

## 5. Qué conviene hacer YA para que cualquier migración futura sea barata

Estas decisiones valen igual para cambiar de paradigma, de proveedor o de esquema:

1. **Capa de acceso a datos.** Hoy 297 consultas están repartidas en 83 archivos, 40 de ellos de interfaz. Migrar *cualquier* parte exige tocar todo eso. Ir sacando las consultas a funciones de dominio (`getClassProgress`, `recordAttempt`…) detrás de una interfaz pequeña, **empezando por las tablas de eventos**, es la inversión con mejor retorno.
2. **Lógica en funciones puras** (ya lo hacemos: `gradeAnswer`, `gameGrading`, `formulaMatch`…): no dependen de la base y se llevan a cualquier lado.
3. **Eventos como datos de solo añadir**, con marca de tiempo y la clave del inquilino (`classroom_id`) en cada fila: es la clave natural para particionar o repartir (shard) por clase.
4. **Identificadores UUID** (ya) y **sin dependencias de orden** en las claves.
5. **Medir**: tamaños de tabla, tasa de escritura y latencia de las consultas más pesadas en un tablero, para que las señales de la sección 4 no dependan de la intuición.

## 6. Si aun así se quisiera NoSQL (por estrategia, no por rendimiento)

Se haría por **estrangulamiento** (strangler): una carga a la vez, empezando por la de menor riesgo y mayor volumen (registros del tutor o eventos de intentos), escribiendo en ambos sitios un tiempo, comparando resultados y recién entonces cambiando las lecturas. Las notas, matrículas y permisos se quedan en Postgres. La seguridad pasa a ser responsabilidad de una capa de servidor, con pruebas como las de esta serie de PRs (mutaciones incluidas).
