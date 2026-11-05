# Prueba de carga de Stud.ia (k6)

Herramienta: [grafana/k6](https://github.com/grafana/k6) (scripts en JavaScript, un solo binario). Esta carpeta contiene el plan y los scripts. **Nada de esto se ha ejecutado todavía contra la app: ver «Estado».**

## Qué queremos saber

1. **¿Cuántos estudiantes simultáneos aguanta la app antes de degradarse?** (latencia p95/p99 y tasa de errores).
2. **¿Qué se rompe primero?** Candidatos, de mayor a menor sospecha: conexiones/CPU de Supabase (el flujo de lección escribe en 3 tablas por pregunta), funciones serverless de Vercel (arranque en frío, `maxDuration`), Upstash (límites de uso), proveedores de IA (solo si la prueba llega a generar, y **no debe**).
3. **¿Se recupera después de un pico?** (perfil `spike`) y **¿se degrada con el tiempo?** (perfil `soak`: fugas, tokens que vencen).
4. **¿Un aula completa entrando a la vez funciona?** (perfil `aula`: 40 estudiantes en 10 s). Es el caso real de un colegio.

## Reglas de seguridad (leer antes de correr)

- **No corras `stress`, `spike` ni `soak` contra producción sin avisar**: afectaría a estudiantes reales y puede disparar los límites de Vercel/Supabase/Upstash. Usa una **Preview de Vercel** o la app local (`npm run build && npm start`). Ojo: una Preview usa la misma base si comparte variables; lo que escribe el escenario 03 va a la base real.
- **Solo cuentas de prueba** (`loadtest/users.json`, ignorado por git) y una **clase desechable** con módulos de banco ya lleno. El escenario 03 deja intentos y progreso en esas cuentas.
- **El escenario 03 se aborta solo si el servidor tiene que generar con IA** (`unexpected_generation`): una prueba de carga no debe gastar la cuota de Cohere/Gemini. Por eso los módulos deben tener el banco lleno (`scripts/measure-validity.ts` muestra cuántas válidas tiene cada módulo).
- Ninguna clave va en el repositorio: todo entra con `-e NOMBRE=valor`. La llave `SUPABASE_ANON_KEY` es la pública (la misma del navegador); **nunca** uses la de servicio.
- Vercel puede limitar o bloquear tráfico que parezca un ataque desde una sola IP: empieza por `smoke` y sube de a poco.

## Preparación

1. Instalar k6 (una vez): `winget install k6 --source winget` (Windows), `brew install k6` (macOS) o `docker run --rm -i grafana/k6 run - <script.js` (sin instalar).
2. Crear **5–10 cuentas de estudiante de prueba** (con el flujo normal de registro), matricularlas en una clase desechable y copiar `users.example.json` a `users.json` con sus datos. Cada estudiante virtual usa una cuenta (`vu % cuentas`); con menos cuentas que estudiantes virtuales varios comparten sesión, lo cual es válido para carga pero repite filas.
3. En esa clase: 1–3 módulos con banco de preguntas **ya lleno** y sin prerrequisitos (o con cuentas que ya los dominen: si no, el 403 `locked` se cuenta en `lesson_locked`).
4. `SERVER_GRADING` activo (si no, `/api/lesson/answer` responde 503 y el escenario lo marca).

## Escenarios

| Archivo | Qué hace | Escribe | Necesita sesión |
|---|---|---|---|
| `01-public.js` | `/login`, `/manifest.json`, `/offline`: borde de Vercel + middleware | No | No |
| `02-student-pages.js` | dashboard, mis clases, mapa y página de la clase (páginas del servidor que consultan Supabase) | No | Sí |
| `03-lesson-flow.js` | pedir lección → responder cada pregunta → cerrar (`/api/generate-questions`, `/api/lesson/answer`, `/api/lesson/finish`) | **Sí** | Sí |

Perfiles (`-e PROFILE=...`; `-e TARGET_VUS=N` cambia el pico):

| Perfil | Forma | Para qué |
|---|---|---|
| `smoke` | 1 usuario, 30 s | Comprobar que el script y la sesión funcionan. **Siempre primero.** |
| `load` | sube a 20 en 2 min, 5 min estable | Carga normal esperada |
| `stress` | 12 → 25 → 50 → 100 usuarios (cada 2 min) | Buscar el punto de quiebre |
| `spike` | 2 → 100 en 10 s, 2 min | Entrada masiva repentina y recuperación |
| `soak` | 15 usuarios 30 min | Degradación lenta, vencimiento de tokens (se renuevan solos) |
| `aula` | 40 usuarios en 10 s, 5 min | Un salón entero abriendo la lección a la vez |

## Comandos

```bash
# 1) Humo (siempre primero)
k6 run -e BASE_URL=http://localhost:3000 loadtest/01-public.js

# 2) Páginas con sesión
k6 run -e BASE_URL=https://TU-PREVIEW.vercel.app -e SUPABASE_URL=https://REF.supabase.co -e SUPABASE_ANON_KEY=... \
       -e CLASS_IDS=<uuid-clase> -e PROFILE=load loadtest/02-student-pages.js

# 3) Flujo de lección de un aula
k6 run -e BASE_URL=https://TU-PREVIEW.vercel.app -e SUPABASE_URL=https://REF.supabase.co -e SUPABASE_ANON_KEY=... \
       -e MODULE_IDS=<uuid-modulo> -e PROFILE=aula --summary-export=loadtest/results/aula.json loadtest/03-lesson-flow.js
```

Cada script termina con código distinto de 0 si algún **umbral** falla (p. ej. `/api/lesson/answer` con p95 > 1 s o más de 2 % de errores), así que sirve también en CI.

## Umbrales iniciales (ajustar con la primera medición real)

| Medida | Umbral |
|---|---|
| Errores HTTP | < 1 % (páginas), < 2 % (flujo de lección) |
| `/login` p95 | < 1,2 s |
| Páginas con sesión p95 | < 2,5 s |
| Pedir lección p95 | < 3 s |
| Responder una pregunta p95 / p99 | < 1 s / < 2,5 s |
| Cerrar lección p95 | < 2 s |
| Generaciones con IA inesperadas | 0 (aborta) |
| Fallos de inicio de sesión | 0 |

Son suposiciones razonables, **no mediciones**: se calibran con la primera corrida `load`.

## Qué mirar en cada capa mientras corre

- **k6**: `http_req_duration` por etiqueta (`name:`), `http_req_failed`, `checks`, `lesson_locked`, `questions_skipped_unsupported_type`, `lessons_finished`.
- **Supabase**: conexiones activas (`select count(*) from pg_stat_activity`), CPU, consultas lentas (`pg_stat_statements`), advisores. Puedo consultar esto por ti durante la corrida.
- **Vercel**: duración y errores de funciones, `504`/`FUNCTION_INVOCATION_TIMEOUT`, arranques en frío, límite de concurrencia del plan.
- **Upstash**: comandos/segundo y cuota (los topes de IA y el estado de salud de proveedores pasan por ahí).
- **Registros de la app**: líneas `[LESSON_GATE_*]`, `[GENERATE_*]`, 409 de `lesson/answer` (la escritura con control de concurrencia).

## Resultados (se llena tras cada corrida)

| Fecha | Perfil | Pico VUs | p95 inicio | p95 respuesta | p95 cierre | Errores | Cuello de botella | Notas |
|---|---|---|---|---|---|---|---|---|
| _pendiente_ | | | | | | | | |

## Límites conocidos de este plan

- El escenario 03 solo responde preguntas clásicas (opción múltiple, V/F, completar, respuesta corta); **omite juegos, emparejar y línea del tiempo** (necesitan la forma exacta de cada pregunta). Se cuentan en `questions_skipped_unsupported_type`.
- No cubre el flujo de **exámenes por cortes** (`/api/exam`), el **laboratorio** ni la **generación con IA**: la generación se evita a propósito; medir su capacidad requiere un plan aparte con tope de gasto.
- k6 corre desde una sola máquina/IP: no reproduce la distribución geográfica ni el límite por IP de un colegio detrás de un NAT.
- La carga la genera tu red: con muchos usuarios virtuales conviene correr k6 desde una máquina con buena conexión (o `k6 cloud`).

## Estado

- **Verificado:** la sintaxis de todos los scripts (`node --check`); la cookie de sesión que arma `lib/cookie.js` la lee de vuelta el propio `@supabase/ssr` (prueba `src/lib/loadtest/cookie.test.ts`, incluida la partición en trozos de 3180); los perfiles y los umbrales existen; no hay secretos en los scripts.
- **NO verificado:** ninguna corrida real de k6 (no está instalado en esta máquina y instalarlo es una descarga que requiere tu autorización); los umbrales son estimados; no se sabe el límite real del plan de Vercel/Supabase.
