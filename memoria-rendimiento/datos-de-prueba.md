# Datos de prueba en la base de producción

**Decisión del dueño (2026-11-06): se conservan** (no se borran) como trazabilidad y para repetir mediciones. Aquí no hay credenciales: las contraseñas de las cuentas solo están en `loadtest/users.json` (en la máquina del dueño, ignorado por git).

## Cuentas
- 20 estudiantes `carga01` … `carga20` en el dominio reservado `.test` (`studia-carga.test`), creadas por el dueño desde `/dev/dashboard` → *Cuentas de prueba* (migración 091: interruptor apagado por defecto, tope 20). Registradas en `public.test_accounts`; se cuentan como «de prueba» (también cualquier correo `.test`).
- Había además 8 estudiantes y 2 profesores `.test` anteriores.
- Registro 2026-11-06: 32 perfiles = 2 reales (1 estudiante, 1 profesor) + 30 de prueba.

## Clase desechable
- `[CARGA] Aula desechable de pruebas`: `120b406d-2079-4476-b504-92d5250830b6`, dueña la cuenta de profesor del dueño, 20 estudiantes matriculados. **Desactivada** (`is_active = false`) salvo mientras se mide.
- Módulos (todos `auto_generated = true`, `is_active = false` en reposo): Módulo 1 `e88f739d-ce4d-437e-8082-46982091d841` (sin prerrequisitos), Módulo 2 `7293a13b-87ff-4866-aebe-4e38be6cd1a5` (requiere el 1 al 100 %).
- Banco: 36 preguntas sembradas por SQL (16 opción múltiple —con fracciones LaTeX y dinero—, 12 verdadero/falso, 6 completar, 6 respuesta corta), `review_status = 'approved'`.

## Volumen generado (instantánea `instantaneas/2026-11-06-base.json`)
2 736 intentos de lección de prueba (2 731 terminados, 5 abiertos por cortes al final de las corridas), 13 675 respuestas, 0 duplicadas, 13 671 `question_attempts`.

## Cómo reactivar para medir
```sql
update classrooms set is_active = true where id = '120b406d-2079-4476-b504-92d5250830b6';
update content_modules set is_active = true where classroom_id = '120b406d-2079-4476-b504-92d5250830b6';
```
y al terminar, lo mismo con `false`. Para el estado «módulo con menos de 100 %» de una cuenta: `update student_progress set status='in_progress', best_score=40 ...` sobre su fila del módulo 1.

## Cómo limpiar (solo si el dueño lo pide)
Borrar en este orden: `question_attempts` y `lesson_attempts` (cascada a `lesson_attempt_answers`) de las cuentas de prueba, `student_progress` de esas cuentas, `class_enrollments` de la clase, `lesson_questions` de sus módulos, los módulos, la clase; las cuentas se borran desde el panel de Auth. Hacerlo con una transacción y contar antes y después.
