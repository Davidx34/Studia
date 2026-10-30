# Entregas de laboratorio (iteración 4, parte A)

Hasta ahora el profesor podía crear y publicar laboratorios (`docs/LABORATORIOS.md`), pero **los estudiantes no tenían dónde abrirlos ni entregar nada**. Esta parte cierra el circuito: el estudiante abre un laboratorio publicado de su clase, hace sus ensayos, entrega su informe y el profesor lo revisa.

## Recorrido

1. **Estudiante** → en su clase aparece «Laboratorios» (solo si hay publicados) → `/my-classes/[id]/labs` (lista con el estado de su entrega: sin entregar / entregado / revisado con nota) → `/my-classes/[id]/labs/[labId]` abre el laboratorio (`LabFrame`, el iframe aislado de siempre).
   - Mientras trabaja, el borrador se guarda **solo en su navegador** (`localStorage`); no es la entrega.
   - Al entregar, el navegador manda el informe a `POST /api/lab/attempt`. Si el servidor lo rechaza, se muestran los problemas concretos y el estudiante puede corregir.
   - Una vez entregado, ve su informe en solo lectura con la nota y el comentario del profesor.
2. **Profesor** → en cada laboratorio publicado del panel, botón «Entregas» → `/teacher/classrooms/[id]/lab/[labId]`: lista de estudiantes con su estado, el informe tal cual lo entregó (solo lectura, mismo laboratorio) y un formulario de nota (0 a 100) y comentario → `POST /api/lab/attempt/review`.

## Qué valida el servidor (`src/lib/lab/submission.ts`)

Todo lo que manda el navegador es no confiable (un estudiante puede editar la tabla por la consola o llamar a la API directamente). Por eso la entrega **no se inserta desde el navegador**: la ruta la valida y recién entonces la guarda con la llave de servicio.

- Hipótesis ≥ 10 caracteres y conclusión ≥ 20 (los mismos mínimos que el laboratorio y la base), topes de 2 000.
- Al menos `minTrials` ensayos (máximo 60), numerados 1..n, y **el primero es el de control** (el laboratorio del navegador pide ahora lo mismo).
- Una respuesta (≥ 3 caracteres) a **cada** pregunta guía.
- Cada ensayo trae **exactamente** las variables y resultados del laboratorio; las variables dentro de su rango y, en modo controlado, las bloqueadas en su valor fijo.
- **Coherencia numérica:** cada ensayo se **recalcula** con el mismo modelo (el evaluador `expr.js` para los modelos a la medida; los modelos de las plantillas fijas, cargados desde una lista cerrada) con las constantes que fijó el profesor. Lo reportado debe coincidir (tolerancia relativa 1e-6, para absorber diferencias de redondeo entre navegadores). Una tabla inventada o retocada a mano no pasa. Un resultado no finito del modelo cuenta como 0, igual que en el laboratorio.

## Base de datos (migración `082_lab_attempts.sql`)

- Una entrega por estudiante y laboratorio (`UNIQUE`); `CHECK` de mínimos/máximos de texto, tamaño de los `jsonb`, nota 0–100 y «una entrega *revisada* siempre tiene nota».
- **RLS:** el estudiante lee solo las suyas; el profesor dueño de la clase lee las de su clase.
- **Sin `INSERT` desde el navegador** (ni política ni permiso): `anon` y `authenticated` solo tienen `SELECT`. *Esto se aparta a propósito de la idea inicial de dejar `INSERT` por RLS al estudiante*: con ella cualquiera podría saltarse el validador (y falsificar ensayos) usando la llave pública.
- **El profesor solo califica:** `UPDATE` únicamente sobre `status`, `score` y `teacher_feedback` (permiso por columna) y solo en las entregas de su clase. No puede reescribir lo que entregó el estudiante, y la revisión se escribe con **su** sesión (no con la llave de servicio).
- Verificada contra la base real **dentro de una transacción que se revierte** (el estudiante no puede insertar ni ponerse nota ni borrar; el profesor puede calificar pero no reescribir; otro usuario no ve ni toca nada; `anon` ni lee). **La migración NO está aplicada.**

## Límites

- Una sola entrega por estudiante: si se equivoca, hoy no puede rehacerla (el profesor tampoco puede borrarla desde la interfaz).
- Sin límite de frecuencia propio en `POST /api/lab/attempt` (la restricción `UNIQUE` y el tope de tamaño acotan el abuso; la validación es barata).
- El borrador local no se sincroniza entre dispositivos.
- Las pantallas no se probaron en un navegador con sesiones reales (se cubren con pruebas estáticas, de comportamiento de las rutas con una base simulada y tipado).
