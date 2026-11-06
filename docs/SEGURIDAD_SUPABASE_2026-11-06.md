# Avisos de seguridad y rendimiento de Supabase — revisión 2026-11-06

Fuente: `get_advisors` (seguridad y rendimiento) sobre producción. Decisión del dueño: «aplica todas». Lo que sigue dice **qué se hizo con cada aviso y por qué**; no todos se resuelven con una migración, y uno de ellos **no debe** resolverse como el linter sugiere.

| Aviso | Cantidad | Qué se hizo | Dónde |
|---|---|---|---|
| `authenticated_security_definer_function_executable` | 13 | **Revisado y aceptado a propósito (no se revoca nada)** | abajo |
| `auth_rls_initplan` | 19 | Migración **092** | `supabase/migrations/092_rls_initplan.sql` |
| `multiple_permissive_policies` | 110 (22 grupos × 4–5 roles) | Migración **093** | `supabase/migrations/093_fusionar_politicas_permisivas.sql` |
| `unindexed_foreign_keys` | 8 | Migración **094** | `supabase/migrations/094_indices_claves_foraneas.sql` |
| `auth_leaked_password_protection` | 1 | **Acción del dueño** (interruptor del panel de Supabase) | abajo |
| `rls_enabled_no_policy` | 8 | Intencional (tablas solo del servidor); sin cambios | abajo |
| `unused_index` | 38 | Sin cambios (tablas pequeñas y nuevas; borrar índices ahora sería prematuro) | — |

## Las 13 funciones `SECURITY DEFINER` ejecutables por usuarios autenticados: por qué NO se revocan

El linter sugiere revocar `EXECUTE` o pasarlas a `SECURITY INVOKER`. **Hacerlo rompería la app**: las 13 las llama el navegador o el servidor con la sesión del propio usuario (`supabase.rpc(...)`), y a la vez **todas validan la identidad por dentro** (se revisó el código de cada una en producción):

| Función | Quién la llama | Comprobación interna |
|---|---|---|
| `acquire_generation_lock`, `release_generation_lock` | rutas de generación (sesión del usuario) | `auth.uid()` no nulo y el módulo es del profesor o de una clase donde el estudiante está inscrito |
| `apply_pending_registration` | pantallas de registro/inicio de sesión | el correo debe ser el de la cuenta autenticada (`auth.uid()`) y tener invitación sin usar |
| `claim_pending_enrollments` | panel del estudiante | `auth.uid()` no nulo, rol `authenticated`, perfil de estudiante, correo propio |
| `check_and_update_streak`, `recover_hearts`, `evaluate_achievements` | tienda de juego / logros | `p_user_id` debe ser `auth.uid()` (o `service_role`); si no, error `42501` |
| `invalidate_lesson_cache` | acciones del profesor | solo el profesor dueño de la clase (o `service_role`) |
| `join_classroom_by_code` | registro/inicio de sesión | usa `auth.uid()` para la matrícula; el código debe existir y la clase estar activa |
| `classroom_embedding_coverage`, `match_material_chunks`, `match_material_chunks_scoped`, `match_material_chunks_hybrid` | RAG (generación, pista de fuente, exámenes) | solo `service_role`, el profesor de la clase o un estudiante inscrito |

`anon` no tiene `EXECUTE` en ninguna. Las funciones internas (`_*_impl`, `finish_lesson`, `consume_ai_quota`, `dev_*`, `handle_new_user`, `sync_chunk_embedding`, etc.) ya solo las ejecuta `service_role`/el sistema.

**Riesgo residual conocido (bajo):** `join_classroom_by_code` no limita intentos: el código de clase son 8 caracteres hexadecimales (≈4 000 millones de combinaciones); fuerza bruta es poco práctica pero no hay límite de intentos por usuario.

## Migración 092 (`auth_rls_initplan`)
Reescribe `auth.uid()` → `(SELECT auth.uid())` en las 19 políticas (mismo resultado; Postgres lo evalúa una vez por consulta, no por fila).

## Migración 093 (`multiple_permissive_policies`)
Fusiona, por tabla y comando, las políticas permisivas en una sola con el OR de sus expresiones (que es como Postgres ya las combina). Las políticas `FOR ALL` se parten en una por comando. 98 → 85 políticas; 0 grupos con más de una.

## Migración 094 (claves foráneas)
8 índices (`blueprint_module_links`, `exam_attempts`, `exam_questions` ×2, `exam_sessions`, `lab_attempts`, `labs` ×2). Tablas pequeñas: instantáneo.

## Cómo se verificó (transacción revertida, antes de aplicar)
Se aplicaron 092+093+094 y se comparó, para **cada uno de los 32 usuarios y el rol anónimo y cada una de las 50 tablas de `public`** (1 650 combinaciones), el conjunto exacto de filas visibles (hash de las filas) **antes y después**: **0 diferencias**. Un control (romper a propósito una política de `classrooms`) sí produjo diferencias, así que la comparación detecta cambios. Resultado: 98 → 85 políticas, 0 grupos múltiples, 8 índices.

**Límites:** la verificación cubre la **lectura** (SELECT) con los datos y usuarios actuales; las rutas de **escritura** (INSERT/UPDATE/DELETE) son equivalentes por construcción (se reutilizan las mismas expresiones con OR) pero no se probaron fila a fila. Tras aplicar, conviene recorrer en la app un flujo de profesor (crear/editar un módulo, una clase) y uno de estudiante (inscribirse con código, abrir una lección).

## Acción del dueño: protección contra contraseñas filtradas
Panel de Supabase → Authentication → Sign In / Providers → Email → activar **«Prevent use of leaked passwords»** (verifica contra HaveIBeenPwned). No se puede hacer por SQL ni desde aquí. Puede requerir plan Pro.

## Tablas con RLS y sin políticas (intencional)
`ai_provider_health`, `ai_usage_windows`, `lesson_attempt_answers`, `lesson_attempts`, `material_chunk_embeddings`, `pending_registrations`, `test_account_control`, `test_accounts`: solo las lee y escribe el servidor con la llave de servicio; el navegador no debe tocarlas (RLS activado sin políticas = nadie más puede).

## Aplicación en producción (2026-11-06, tras el merge del #236 y el «aplica todas» del dueño)
092, 093 y 094 aplicadas una por una. **Comprobación real:** la huella de lo que ve cada uno de los 33 actores (32 usuarios + anónimo) en las 50 tablas fue **idéntica antes y después** (`06d9253e…`). Políticas 98 → 85, 0 grupos múltiples, 0 `auth.uid()` sin envolver; los avisos `auth_rls_initplan` y `multiple_permissive_policies` desaparecieron del linter.

**Defecto encontrado en mi propia migración 094:** `exam_sessions` ya tenía un índice con el mismo nombre (`idx_exam_sessions_blueprint`, solo sobre `blueprint_id`, de la 089), así que `CREATE INDEX IF NOT EXISTS` no creó el compuesto y el linter sigue listando esa clave foránea. Los otros 7 índices sí se crearon. Corrección: migración **095** (índice compuesto con nombre nuevo). La prueba previa contaba nombres de índice en vez de comprobar su definición: por eso no lo detectó.

Quedan: 42 `unused_index` (INFO; los 7 nuevos aparecen «sin uso» porque son recientes) y los avisos de seguridad aceptados o de acción del dueño descritos arriba.
