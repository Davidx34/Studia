// Pasarela de IA (AI gateway): UNA capa que decide a que proveedor/modelo se manda cada tarea, con respaldo, cortacircuitos
// y ordenamiento adaptativo. Vive en el servidor (nunca en el navegador) y las llaves salen SOLO de variables de entorno.
//
// Idea central: una tarea ("generation", "judge"...) tiene una CADENA de candidatos {proveedor, modelo} en orden de
// preferencia. Un candidato solo existe si su proveedor tiene llave. Cambiar de proveedor, agregar uno gratuito o pasar a
// uno de pago es CONFIGURACION (variables de entorno), no codigo.

export type AiTask = 'generation' | 'judge' | 'analysis' | 'study';

export interface Candidate {
  provider: string;
  model: string;
}

// Por que fallo una llamada. Decide cuanto tiempo se aparta ese candidato.
export type FailureKind =
  | 'rate_minute' // 429 por minuto: reintentar tras esperar SI sirve
  | 'rate_daily' // cuota diaria agotada: no sirve hasta el reinicio
  | 'payment' // 402: sin credito
  | 'auth' // 401/403: llave invalida o sin permiso
  | 'not_found' // 404: el modelo ya no existe en ese proveedor
  | 'server' // 5xx / red
  | 'timeout'
  | 'unparseable' // respondio, pero no en el formato pedido
  | 'bad_request'; // 400: problema de ESTA peticion, no del proveedor

export interface CallRequest {
  task: AiTask;
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  // Pide salida JSON (modo JSON del proveedor cuando lo tiene).
  json?: boolean;
  timeoutMs?: number;
}

export type CallOutcome =
  | { ok: true; text: string; usage?: { prompt?: number; completion?: number } }
  | { ok: false; kind: FailureKind; status?: number; retryAfterMs?: number; message?: string };

export interface Attempt {
  provider: string;
  model: string;
  ok: boolean;
  kind?: FailureKind;
  status?: number;
  ms: number;
}

export type RouteResult<T> =
  | { ok: true; value: T; text: string; provider: string; model: string; quality: number; attempts: Attempt[] }
  | { ok: false; reason: 'no_providers' | 'all_unavailable' | 'exhausted'; attempts: Attempt[] };
