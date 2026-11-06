# Libro de optimizaciones

Cada fila: qué se cambió, por qué, cómo se midió y el resultado. «Mismas condiciones» = misma máquina, mismo destino, mismo perfil.

| # | Fecha | PR | Cambio | Hipótesis | Antes | Después | Condiciones | Estado |
|---|---|---|---|---|---|---|---|---|
| O1 | 2026-11-06 | #231 | `/dashboard`: 7 lecturas iniciales + clases/módulos + profesores/progreso + planes en `Promise.all` | 11 consultas en serie = 11 viajes a la base | **2,66 s** (media, 1 usuario) | **1,48 s** (-44,4 %) | local, build de producción, ≈250 ms de viaje a Supabase | Medido |
| O1b | 2026-11-06 | #231 | (mismo cambio) efecto en producción | menos viajes serie | 2,74 s (media, 1 usuario, `2026-11-06-prod-02-smoke`) | 0,54–0,87 s (2 corridas de `bench.js`) | producción, 1 usuario; **no controlado** (funciones frías en la primera) | Medido, con reservas |
| O2 | 2026-11-06 | #231 | `/api/lesson/answer`: intento + pregunta + respuesta previa en `Promise.all` | 3 lecturas independientes en serie | **1,25 s** (media) | **1,02 s** (-18 %) | local, igual que O1 | Medido |
| O3 | 2026-11-06 | #233 | `/api/generate-questions`: 1 sola consulta a Auth (memoizada, antes 3), config + puerta del 100 % a la vez, intento + progreso a la vez | ≈8 viajes en serie, 3 a Auth | **1,89 s** (media) | **1,3 s** (-31 %) | local, igual que O1 | Medido localmente; en producción sin medir |
| I1 | 2026-11-06 | #230 | (instrumento) k6 inicia sesión UNA vez en `setup()` | con 100 VUs el login por VU topaba el límite de Auth por IP y falseaba el pico | 853 logins rechazados (`2026-11-06-prod-03-spike-invalida`) | 0 fallos (`2026-11-06-prod-03-spike`) | producción, 100 VUs | Cerrado |

## No son de rendimiento pero cambian lo medido
- #223/#224/#225/#228: la regla del 100 % para avanzar (mapa, servidor, conteos, coherencia). Añade consultas a `generate-questions` solo en clases sin plan o con módulos sin enlazar (`legacyGate`: prerrequisitos + intentos + progreso).
- 081 y 090: extensiones (`vector`, `pg_trgm`, `pg_net`) fuera de `public`. La búsqueda híbrida del RAG devolvió 3 filas antes y después; no se midió su latencia.
