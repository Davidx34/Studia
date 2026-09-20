import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import MaterialsClient from './MaterialsClient';
import type { TeachingMaterial } from '@/types/database';

// confirmMaterialUpload y reprocessMaterial convierten los PDF con un modelo con vision dentro del
// mismo request: una presentacion de ~50 paginas tarda 1-2 minutos. Fluid compute permite hasta 300 s.
export const maxDuration = 300;

export default async function MaterialsPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: materials } = await supabase
    .from('teaching_materials')
    .select('*')
    .eq('classroom_id', params.id)
    .order('created_at', { ascending: false });

  return (
    <MaterialsClient
      classroomId={params.id}
      initialMaterials={(materials ?? []) as TeachingMaterial[]}
    />
  );
}
