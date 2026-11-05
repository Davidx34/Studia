// Configuracion comun de las pruebas de carga (k6). Todo entra por variables de entorno (-e NOMBRE=valor): NADA de secretos en el repositorio.
//
//   BASE_URL           (obligatoria) la app a probar. NO uses produccion con el perfil stress/spike sin avisar: usa una Preview de Vercel o local.
//   SUPABASE_URL       (obligatoria en 02 y 03) https://<ref>.supabase.co
//   SUPABASE_ANON_KEY  (obligatoria en 02 y 03) la llave PUBLICA (anon); la misma que va en el navegador
//   USERS_FILE         ruta del JSON de cuentas de PRUEBA (ver users.example.json); por defecto ./users.json
//   MODULE_IDS         (03) ids de modulos separados por coma, con banco de preguntas YA lleno (si no, se llamaria a la IA y cuesta dinero)
//   CLASS_IDS          (02) ids de clases a abrir, separados por coma (opcional)
//   PROFILE            smoke | load | stress | spike | soak | aula   (por defecto smoke)
//   TARGET_VUS         estudiantes virtuales en el pico (por defecto segun perfil)

export const env = (name, fallback) => {
  const v = __ENV[name];
  return v === undefined || v === '' ? fallback : v;
};

export const required = (name) => {
  const v = env(name);
  if (!v) throw new Error(`Falta la variable ${name} (usa -e ${name}=...)`);
  return v;
};

export const BASE_URL = () => required('BASE_URL').replace(/\/+$/, '');

const vus = (def) => Number(env('TARGET_VUS', def));

// Perfiles de carga (stages de k6). «aula» = lo que mas se parece a un colegio real: toda una clase entra y abre la leccion en los mismos segundos.
export function stagesFor(profile) {
  const p = profile || 'smoke';
  switch (p) {
    case 'smoke':
      return { executor: 'constant-vus', vus: 1, duration: '30s' };
    case 'load':
      return { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '2m', target: vus(20) }, { duration: '5m', target: vus(20) }, { duration: '1m', target: 0 }], gracefulRampDown: '30s' };
    case 'stress': {
      const n = vus(50);
      return { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '2m', target: Math.ceil(n / 4) }, { duration: '2m', target: Math.ceil(n / 2) }, { duration: '2m', target: n }, { duration: '2m', target: n * 2 }, { duration: '2m', target: 0 }], gracefulRampDown: '30s' };
    }
    case 'spike': {
      const n = vus(100);
      return { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '30s', target: 2 }, { duration: '10s', target: n }, { duration: '2m', target: n }, { duration: '10s', target: 2 }, { duration: '1m', target: 0 }], gracefulRampDown: '30s' };
    }
    case 'soak':
      return { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '3m', target: vus(15) }, { duration: '30m', target: vus(15) }, { duration: '2m', target: 0 }], gracefulRampDown: '30s' };
    case 'aula':
      // Una clase de N estudiantes (40 por defecto) que entran TODOS en 10 s y trabajan 5 min.
      return { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '10s', target: vus(40) }, { duration: '5m', target: vus(40) }, { duration: '20s', target: 0 }], gracefulRampDown: '30s' };
    default:
      throw new Error(`PROFILE desconocido: ${p} (smoke | load | stress | spike | soak | aula)`);
  }
}
