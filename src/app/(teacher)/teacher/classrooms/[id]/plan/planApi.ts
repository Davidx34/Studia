// Llamada a /api/blueprint desde el navegador. Nunca lanza: un corte de red se devuelve como un resultado con un mensaje que el profesor entiende.
export async function call(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch('/api/blueprint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'No hay conexion con el servidor. Revisa tu red e intenta de nuevo.' } };
  }
}
