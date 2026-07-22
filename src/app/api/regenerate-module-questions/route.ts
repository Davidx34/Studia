import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { regenerateModulePool } from '@/lib/questions/regeneratePool';

// Mejora Estructural 2: genera el pool completo (activo + backup) de un modulo
// configurado por el profesor desde un objetivo de aprendizaje. A diferencia de
// /api/generate-questions (que genera incrementalmente y elige minijuegos al azar),
// esta ruta respeta exactamente los minigame_types que el profesor eligio para el
// modulo, genera el doble de preguntas configuradas (mitad activas, mitad de
// reserva) y REEMPLAZA el pool existente del modulo de una sola vez.
export async function POST(req: NextRequest) {
  try {
    const { moduleId } = await req.json();
    if (!moduleId) return NextResponse.json({ error: 'moduleId requerido' }, { status: 400 });

    const supabase = await createServerSupabase();
    const result = await regenerateModulePool(supabase, moduleId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'Modulo no encontrado' ? 404 : 500 });
    }
    return NextResponse.json({ active: result.active, backup: result.backup });
  } catch (e) {
    console.error('Error:', String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
