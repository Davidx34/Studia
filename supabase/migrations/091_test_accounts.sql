-- 091: control y registro de las CUENTAS DE PRUEBA (las que usan las pruebas de carga y funcionales).
--
-- Para que sirve:
--   - `test_account_control` (una sola fila): el INTERRUPTOR de seguridad. Nace APAGADO (enabled = false): mientras este apagado, el panel /dev no crea ninguna cuenta de prueba. El
--     dueño lo enciende y lo apaga desde el panel; se vuelve a leer ANTES DE CADA cuenta, asi que apagarlo detiene un lote en marcha. `max_accounts` es el tope de cuentas de prueba.
--   - `test_accounts`: el registro de que cuentas son de prueba (para contar «reales» frente a «de prueba»). SOLO guarda el id y el correo: NUNCA contraseñas (las contraseñas se muestran
--     una sola vez al crearlas y no se guardan en ninguna parte).
--
-- Seguridad: RLS activado y SIN politicas, y sin permisos para anon ni authenticated: solo el servidor (llave de servicio, desde el panel /dev con su propia sesion) lee y escribe.
-- Se borran solas si se borra el usuario de auth (ON DELETE CASCADE). No toca ninguna tabla existente.
--
-- Para deshacer:  DROP TABLE public.test_accounts; DROP TABLE public.test_account_control;

CREATE TABLE IF NOT EXISTS public.test_account_control (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled      boolean NOT NULL DEFAULT false,
  max_accounts integer NOT NULL DEFAULT 20 CHECK (max_accounts BETWEEN 1 AND 50),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.test_account_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.test_accounts (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL UNIQUE CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.test_account_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.test_account_control FROM anon, authenticated;
REVOKE ALL ON TABLE public.test_accounts FROM anon, authenticated;

COMMENT ON TABLE public.test_account_control IS 'Interruptor (apagado por defecto) y tope de cuentas de prueba. Solo el servidor.';
COMMENT ON TABLE public.test_accounts IS 'Registro de cuentas de prueba (id y correo, nunca contraseñas). Solo el servidor.';
