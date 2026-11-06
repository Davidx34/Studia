# Hallazgos de rendimiento y funcionales

Estado: **A** = abierto, **C** = cerrado, **H** = hipótesis por probar. Fuente: evaluación 2026-11-06 (`docs/EVALUACION_CARGA_Y_FUNCIONAL_2026-11-06.md`).

| # | Estado | Hallazgo | Evidencia | Siguiente paso |
|---|---|---|---|---|
| H1 | A | **El sistema se degrada cerca de 34 peticiones/s sostenidas (100 estudiantes sin pausa)**: inicio de lección p95 3,2 s, respuesta p95 1,56 s, p99 4,1 s; 0 errores | `2026-11-06-prod-03-spike` | Repetir tras #233; mirar CPU/conexiones de Supabase durante el pico |
| H2 | A | Un aula real (40 estudiantes, pausas de ~3 s) genera ≈10 req/s: margen amplio | `2026-11-06-prod-03-aula`, `-stress` | — |
| H3 | A | Abrir lección sigue haciendo varios viajes en serie (puerta del 100 % por `loadCourseData`/`legacyGate`, lectura del banco, `getUser` del middleware) | O3 | Medir en producción; evaluar paralelizar la lectura del banco con la puerta |
| H4 | H | El **middleware** llama a `auth.getUser()` (red) en CADA petición y las rutas lo repiten: verificar el JWT localmente (`getClaims`) ahorraría ~1 viaje por petición | `2026-11-05-local-04-*`: ≈60 ms de mediana por salto | Comprobar si el proyecto usa claves de firma asimétricas antes de probar |
| H5 | A | Una petición aislada tardó **21 s** en el salto a Auth (30 VUs); no se reprodujo | `2026-11-05-local-04-load` | Revisar registros de Auth de esa hora si reaparece |
| H6 | A | Las mediciones locales están infladas por ≈250 ms de viaje portátil→Supabase | RTT medido 0,23–0,31 s | Comparar siempre local con local, producción con producción |
| H7 | A | Conexiones a la base 11–14 de 60 durante las corridas: sin presión | consulta `pg_stat_activity` | Vigilar si crece con exámenes/laboratorio |
| H8 | A | **Sin medir:** exámenes por cortes, laboratorio, minijuegos, generación con IA, resistencia larga (`soak`) | — | Plan en la conversación del 2026-11-06 (escenarios 05–07) |
| H9 | A | `ai_provider_health` tiene 0 filas (¿`AI_HEALTH_PERSIST` guarda?) | SQL 2026-11-06 | Provocar un fallo controlado de proveedor y revisar |
| H10 | A | 17 módulos reales «completados» con <100 % aparecen «en curso» con la regla nueva | SQL 2026-11-06 | Informar; no es un defecto |
| H11 | C | `finish` responde 409 si quedan intentos de una pregunta (el escenario no reintentaba) | `2026-11-06-local-03-smoke-con-sesion` | Corregido en el escenario (#230) |
| H12 | C | «Completar frase» mostraba la oración dos veces | navegador 2026-11-06 | Corregido en #234 |
| H13 | A | Avisos de seguridad de Supabase: 13 funciones `SECURITY DEFINER` ejecutables por usuarios autenticados, 19 políticas `auth_rls_initplan`, 110 con múltiples políticas permisivas, 8 claves foráneas sin índice, protección de contraseñas filtradas desactivada | `get_advisors` 2026-11-06 | Migraciones 092+ (en curso) |
