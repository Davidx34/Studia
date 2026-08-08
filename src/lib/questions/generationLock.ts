// Lock optimista para evitar cache stampede en generación de preguntas.
// Patrón: solo una generación por módulo puede estar en curso simultáneamente.

export async function acquireGenerationLock(supabase: any, moduleId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('content_modules')
    .update({ is_generating: true })
    .eq('id', moduleId)
    .eq('is_generating', false)
    .select('id');

  if (error) {
    console.error('[acquireGenerationLock]', error);
    return false;
  }

  // Si no hay filas actualizadas, significa que ya hay generación en curso
  return (data?.length ?? 0) > 0;
}

export async function releaseGenerationLock(supabase: any, moduleId: string): Promise<void> {
  await supabase
    .from('content_modules')
    .update({ is_generating: false })
    .eq('id', moduleId);
}
