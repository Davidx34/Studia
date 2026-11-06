# Evaluación de carga y funcional — 2026-11-06

Hecha por Claude (Sonnet 5.5) con k6 2.3.0, 20 cuentas de estudiante de prueba (creadas por el dueño desde el panel `/dev`), una clase desechable `[CARGA]` (2 módulos, 36 preguntas) y la app de **producción** (`studia-theta.vercel.app`) más una build local de producción. Las calificaciones son **juicio de quien probó**, con la evidencia de abajo; no son una auditoría independiente.

## 1. Carga (producción, escenario `03-lesson-flow`: pedir lección → 5 preguntas → cerrar)

| Corrida | Usuarios virtuales | Pausa entre preguntas | Peticiones/s | Errores | p95 inicio | p95 respuesta | p95 cierre |
|---|---|---|---|---|---|---|---|
| Humo | 1 | 1 s | — | 0 % | ~2 s | ~1,3 s | 0,5 s |
| Carga | 10 | 3 s | 2,2 | 0 % | 1,8 s | 1,33 s | 0,67 s |
| Aula | 20 (entran en 10 s) | 3 s | 5,6 | 0 % | 0,84 s | 0,59 s | 0,37 s |
| Estrés | hasta 60 | 3 s | 6,8 | 0 % | 0,77 s | 0,59 s | 0,38 s |
| Pico | 100 (en 10 s) | 0,4 s | **34** | 0 % | **3,2 s** | **1,56 s** (p99 4,1 s) | 0,58 s |

- **El punto donde se degrada** está cerca de las 34 peticiones por segundo sostenidas (100 estudiantes casi sin pausa): sin errores, pero la latencia p95 de inicio supera los 3 s. Un aula real de 40 estudiantes con pausas de varios segundos genera ≈10 peticiones por segundo, bien por debajo.
- **Integridad de datos tras ~2 700 lecciones y 13 600 respuestas:** 0 respuestas duplicadas, 0 intentos sin resultado, `lesson_attempt_answers` finales = `question_attempts` (13 576 = 13 576), todos los intentos tienen exactamente 5 respuestas. Los 4 intentos «abiertos» son lecciones cortadas al terminar la prueba.
- **IA:** 0 generaciones inesperadas (el banco lleno se sirvió siempre desde la base).
- **Base:** conexiones activas 11–14 de 60 durante las corridas.
- **Salto a Supabase Auth** (escenario `04`, cookie falsa, local, 30 usuarios, 8 min): ≈41 peticiones/s, p95 129 ms, 0 % de errores; una petición aislada tardó 21 s (sin explicar).
- **Páginas públicas** (local, laptop): 300 usuarios virtuales, 0 % de errores, p95 de `/login` 14 ms (son páginas casi estáticas: no representan capacidad real).

### Trampa del instrumento (corregida)
La primera prueba de pico mostró 853 «fallos»: eran inicios de sesión rechazados por Supabase Auth (límite por IP) porque cada usuario virtual iniciaba sesión por su cuenta. Los escenarios ahora inician sesión una vez en `setup()` (PR #230).

### Mejoras encontradas y hechas
- `/dashboard` hacía 11 consultas en serie y era la página más lenta del estudiante; `/api/lesson/answer` leía 3 cosas independientes en serie. En paralelo (PR #231), misma máquina y mismo viaje portátil→Supabase (≈250 ms): **dashboard 2,66 s → 1,48 s (-44 %), respuesta 1,25 s → 1,02 s (-18 %)**. Medición local; el efecto en producción no está medido.
- Pendiente: `/api/generate-questions` (≈8 viajes en serie, ≈2 s de inicio con 1 usuario).

## 2. Funcional (navegador, servidor local, estudiante de prueba)

| Comprobación | Resultado |
|---|---|
| Módulo terminado con 40 % → «En curso», siguiente «Bloqueado: Completa el módulo anterior», «Completados 0/2» | Correcto |
| Abrir la lección bloqueada por URL | «Esta lección todavía no se abre… Primero domina «[CARGA] Módulo 1» al 100 %» (el servidor la niega) |
| Lección con 5 preguntas (V/F, 3 opción múltiple, completar), retroalimentación y «Terminar módulo» | Correcto; «Sacaste 100 %» |
| Tras el 100 %: Módulo 1 «Completado 100 %», Módulo 2 «Disponible», «Completados 1/2» | Correcto |
| Dinero «ingreso de $103 y el bien x cuesta $10» | Se ve como texto (antes se dibujaba como fórmula) |
| Fracciones LaTeX `$\frac{1}{2}+\frac{7}{4}$` en enunciado y opciones | Dibujadas con KaTeX |
| Coherencia servidor/mapa con datos reales (`scripts/check-gate-consistency.ts`) | 35 negados = 35 bloqueados; 0 incoherencias (tras el PR #228) |

### Hallazgos funcionales menores (sin arreglar)
- En «Completar frase» la oración aparece dos veces (el enunciado y el cuadro con el hueco).
- «Tu dominio» (0 dominado, 1 por repasar) convive con «Módulo completado 100 %»: son dos conceptos distintos (dominio por pregunta frente a puntaje del módulo) y pueden confundir.
- Hay 17 módulos reales «completados» con menos de 100 % que ahora aparecen «en curso».

## 3. Calificación (sobre 10)

| Aspecto | Nota | Evidencia |
|---|---|---|
| Calidad de código y pruebas | 8,5 | 4 110 pruebas, tsc en 0, mutaciones en lo nuevo; se escapó una incoherencia que solo apareció con datos reales |
| Seguridad | 7 | Escrituras del estudiante cerradas, calificación en el servidor, puerta del 100 % en servidor; 13 funciones `SECURITY DEFINER` ejecutables por usuarios autenticados, 19 políticas `auth_rls_initplan`, 110 con múltiples políticas permisivas, protección de contraseñas filtradas desactivada |
| Rendimiento y escalabilidad | 8 | 0 errores hasta 34 peticiones/s; integridad perfecta; margen amplio para un aula (≈10 rps); latencia de inicio de lección alta bajo pico |
| Operación y observabilidad | 7 | Etiquetas de registro, banderas, interruptor de cuentas de prueba; sin alertas ni panel de carga continuo |
| Funcional | 7,5 | Flujo central (lección, 100 %, desbloqueo, fórmulas) verificado de punta a punta; sin prueba con personas reales; hallazgos menores arriba |
| **Global** | **7,6** | |

## 4. Límites de esta evaluación
- Solo se probó el flujo de **lección** con preguntas clásicas; no exámenes por cortes, laboratorio, juegos ni generación con IA.
- 20 cuentas compartidas entre hasta 100 usuarios virtuales (varias sesiones por cuenta): repite filas de `student_progress`.
- Una sola IP/ubicación (Colombia); no se probó un colegio detrás de NAT.
- La clase `[CARGA]` y las 20 cuentas siguen en la base marcadas como de prueba (la clase y los módulos están desactivados).
