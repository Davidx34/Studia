// Mejora Estructural 2: logica compartida para (re)generar el pool completo
// (activo + backup) de un modulo configurado por el profesor. La usan tanto
// /api/regenerate-module-questions (llamada desde fetch del cliente) como el
// server action regenerateModulePool (botón en la UI de objetivos), para no
// duplicar el prompt ni la logica de guardado en dos lugares.
//
// El prompt y la interpretacion de la configuracion de IA de la clase viven en
// src/lib/questions/generationConfig.ts, compartidos con /api/generate-questions:
// antes cada camino tenia su propia copia del prompt y ya habian divergido.

import { isValidQuestion } from '@/lib/lesson/validateQuestion';
import { getRagContext, normalizeGeneratedQuestion, callCohere } from '@/lib/questions/cohereGeneration';
import { getOrCreateModuleConcepts, conceptTaxonomyPromptBlock } from '@/lib/questions/conceptTaxonomy';
import { resolveQuestionCount, countServable, planFill } from '@/lib/questions/poolPlan';
import { resolveConfig, resolveMinigames, enforceAllowedTypes, buildGenerationPrompt } from '@/lib/questions/generationConfig';

export interface RegeneratePoolResult {
  ok: boolean;
  active?: number;
  backup?: number;
  error?: string;
  // Modo 'fill': el modulo ya tenia el pool completo y no se llamo a la IA.
  skipped?: boolean;
}

// 'replace': borra el pool del modulo y genera uno nuevo completo (el boton
//            "Regenerar" de un modulo).
// 'fill':    NO borra nada; genera solo lo que le falta al pool para estar completo
//            (activas + reserva). Es lo que usa "Generar lo que falta": puede correr
//            sobre modulos ya revisados sin destruir el trabajo del profesor.
export type PoolMode = 'replace' | 'fill';

export async function regenerateModulePool(
  supabase: any,
  moduleId: string,
  opts: { mode?: PoolMode } = {}
): Promise<RegeneratePoolResult> {
  const mode: PoolMode = opts.mode ?? 'replace';
  const { data: moduleRow, error: moduleError } = await supabase
    .from('content_modules')
    .select('id, classroom_id, title, description, minigame_types, configured_question_count')
    .eq('id', moduleId)
    .single();

  // RLS de content_modules ya restringe esto al profesor dueno del modulo, asi
  // que un moduleRow nulo aqui significa que no existe o no le pertenece al
  // usuario autenticado en este supabase client.
  if (moduleError || !moduleRow) {
    return { ok: false, error: 'Modulo no encontrado' };
  }

  const { data: aiConfig, error: configError } = await supabase
    .from('classroom_ai_config')
    .select('*')
    .eq('classroom_id', moduleRow.classroom_id)
    .maybeSingle();

  // Un fallo de lectura NO debe pasar callado: la clase se regeneraria con los
  // valores por defecto sin que nadie lo note.
  if (configError) console.error('[REGENERATE_CONFIG_READ_FAILED]', { moduleId, error: configError.message });

  if (!process.env.COHERE_API_KEY) return { ok: false, error: 'No API key' };

  const config = resolveConfig(aiConfig);

  const questionCount = resolveQuestionCount(moduleRow.configured_question_count);

  // Cuantas preguntas hay que generar de cada tanda. En 'replace' el pool completo;
  // en 'fill' solo lo que falta respecto de lo que ya sirve.
  let activeCount = questionCount;
  let backupCount = questionCount; // reserva = 100% extra, per Mejora Estructural 2
  let existingBackup = 0;
  if (mode === 'fill') {
    const { data: existing, error: existingError } = await supabase
      .from('lesson_questions')
      .select('is_backup, review_status')
      .eq('module_id', moduleId);
    if (existingError) return { ok: false, error: existingError.message };
    const have = countServable(existing ?? []);
    const plan = planFill(questionCount, have);
    if (plan.complete) return { ok: true, active: 0, backup: 0, skipped: true };
    activeCount = plan.needActive;
    backupCount = plan.needBackup;
    existingBackup = have.backup;
  }

  const context = await getRagContext(supabase, moduleId);

  // Fase 1.2: taxonomia cerrada de conceptos (Protocolo 7.6) -- ver
  // src/lib/questions/conceptTaxonomy.ts. regeneratePool es el flujo del
  // profesor (boton "Regenerar pool" en /teacher/classrooms/[id]/objectives),
  // asi que casi siempre corre DESPUES de generate-questions y reutiliza la
  // taxonomia ya creada; si el profesor regenera antes de que exista, la crea.
  const closedConcepts = await getOrCreateModuleConcepts(supabase, moduleId, moduleRow.title);
  const conceptBlock = conceptTaxonomyPromptBlock(closedConcepts);

  // Minijuegos de la tanda activa: la lista de la CLASE es la de permitidos; si el
  // profesor fijo una lista para este modulo se usa esa (recortada a lo permitido),
  // y si no, se sortean hasta MAX_MINIGAMES_PER_BATCH de los permitidos. Antes, un
  // modulo sin lista propia se regeneraba SIN minijuegos aunque la clase los
  // tuviera habilitados.
  // Al COMPLETAR un pool a medias no se piden minijuegos de mas: reponer 3 preguntas
  // no debe traer 2 minijuegos nuevos encima. Solo cuando la tanda activa se arma
  // desde cero (modo 'replace', o un modulo sin ninguna activa).
  const activeMinigames = activeCount === questionCount
    ? resolveMinigames({ classAllowed: config.allowedMinigames, moduleChosen: moduleRow.minigame_types })
    : [];

  // Genera un lote de N preguntas en una sola llamada a Cohere. Separado en
  // funcion porque el pool completo (activo+backup, hasta 30) excedia el
  // limite DURO de salida del modelo (4096 tokens -- c4ai-aya-expanse-32b
  // rechaza con HTTP 400 pedir mas, verificado en vivo) y, sin ese limite
  // explicito, la respuesta se truncaba a mitad de un JSON en vez de fallar
  // con un error claro. Pedir el pool en 2 llamadas mas chicas (activas,
  // backup) en vez de 1 sola mantiene cada peticion comodamente por debajo
  // del techo. Los minijuegos (mas pesados en tokens) solo van en el batch
  // activo -- el backup es reserva simple, no necesita la misma variedad.
  async function generateBatch(count: number, minigames: string[]): Promise<{ raw: any[] | null; requested: Set<string> }> {
    if (count <= 0) return { raw: [], requested: new Set() };
    const built = buildGenerationPrompt({
      config,
      moduleTitle: moduleRow.title,
      context,
      classicCount: count,
      minigames,
      conceptBlock,
    });
    return { raw: await callCohere(built.prompt, built.total), requested: new Set(built.requestedTypes) };
  }

  const [activeBatch, backupBatch] = await Promise.all([
    generateBatch(activeCount, activeMinigames),
    generateBatch(backupCount, []),
  ]);

  if (!activeBatch.raw && !backupBatch.raw) {
    return { ok: false, error: 'Cohere generation failed tras reintentos' };
  }

  const normalizeValidate = (batch: { raw: any[] | null; requested: Set<string> }) => {
    const normalized = (batch.raw ?? []).map(normalizeGeneratedQuestion);
    // Defensa en profundidad: el modelo puede ignorar "TIPOS PERMITIDOS". Lo que la
    // configuracion no pidio no se guarda.
    const { kept, dropped } = enforceAllowedTypes(normalized, batch.requested);
    if (dropped.length > 0) {
      console.warn('[REGENERATE_OFF_CONFIG]', { moduleId, descartadas: dropped.map((q: any) => q.type) });
    }
    return kept.filter((q: any) => {
      const check = isValidQuestion(q);
      if (!check.valid) {
        console.warn('[REGENERATE_VALIDATION_FAILED]', { type: q.type, error: check.error });
      }
      return check.valid;
    });
  };

  const activeQuestions = normalizeValidate(activeBatch);
  const backupQuestions = normalizeValidate(backupBatch);
  const validGenerated = [...activeQuestions, ...backupQuestions];

  if (validGenerated.length === 0) {
    return { ok: false, error: 'No se genero ninguna pregunta valida' };
  }

  // Solo 'replace' borra el pool existente; 'fill' agrega a lo que ya hay.
  if (mode === 'replace') {
    const { error: deleteError } = await supabase.from('lesson_questions').delete().eq('module_id', moduleId);
    if (deleteError) return { ok: false, error: deleteError.message };
  }

  const rows = [...activeQuestions, ...backupQuestions].map((q: any, i: number) => ({
    module_id: moduleId,
    type: q.type,
    q: q.q,
    opts: q.opts ?? null,
    ok: q.ok ?? null,
    answers: q.answers ?? null,
    pairs: q.pairs ?? null,
    keywords: q.keywords ?? null,
    exp: q.exp ?? null,
    concept_tag: q.concept_tag ?? null,
    game_type: q.game_type ?? null,
    game_data: q.game_data ?? null,
    is_backup: i >= activeQuestions.length,
    backup_pool_size: existingBackup + backupQuestions.length,
  }));

  const { error: insertError } = await supabase.from('lesson_questions').insert(rows);
  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  return { ok: true, active: activeQuestions.length, backup: backupQuestions.length };
}
