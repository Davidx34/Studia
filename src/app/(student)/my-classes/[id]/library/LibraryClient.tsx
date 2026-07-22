'use client';

// Mejora 3: biblioteca de materiales interactiva para el estudiante.
// El profesor sube PDF/Word, se procesan en chunks — hasta ahora el
// estudiante nunca veía ese material original, solo preguntas generadas.
// Esta pagina le da acceso de lectura, con busqueda/highlight y notas
// personales, reusando el RLS que ya deja leer teaching_materials/
// material_chunks a estudiantes inscritos (Fase de materiales, Sesion previa).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { BookOpen, Search, ChevronLeft, ChevronRight, Minus, Plus, Sparkles } from 'lucide-react';

interface MaterialSummary {
  id: string;
  display_name: string;
  chunk_count: number | null;
  topics_detected: string[] | null;
  created_at: string;
}

interface Chunk {
  id: string;
  chunk_index: number;
  content: string;
}

interface ProcessedChunk {
  chunk_id: string;
  summary: string;
  key_points: string[];
  main_concepts: string[];
}

interface RelatedModule {
  id: string;
  title: string;
  difficulty_level: number | null;
}

export function LibraryClient({
  classroomId,
  classroomName,
  materials,
}: {
  classroomId: string;
  classroomName: string;
  materials: MaterialSummary[];
}) {
  const supabase = createClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MaterialSummary | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [chunkIdx, setChunkIdx] = useState(0);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [relatedModules, setRelatedModules] = useState<RelatedModule[]>([]);
  const [processedByChunk, setProcessedByChunk] = useState<Map<string, ProcessedChunk>>(new Map());
  const [processing, setProcessing] = useState(false);
  const [showFullText, setShowFullText] = useState(false);

  const filteredMaterials = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter(
      (m) =>
        m.display_name.toLowerCase().includes(q) ||
        (m.topics_detected || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [materials, search]);

  const selectMaterial = async (m: MaterialSummary) => {
    setSelected(m);
    setChunkIdx(0);
    setChunks([]);
    setLoadingChunks(true);
    setNotesSaved(false);
    setShowFullText(false);
    setProcessedByChunk(new Map());

    const [{ data: chunkRows }, { data: noteRow }, { data: moduleRows }] = await Promise.all([
      supabase
        .from('material_chunks')
        .select('id, chunk_index, content')
        .eq('material_id', m.id)
        .order('chunk_index'),
      supabase
        .from('study_notes')
        .select('notes_content')
        .eq('material_id', m.id)
        .maybeSingle(),
      supabase
        .from('content_modules')
        .select('id, title, difficulty_level')
        .eq('classroom_id', classroomId)
        .contains('source_material_ids', [m.id])
        .limit(5),
    ]);

    const chunkList = (chunkRows as Chunk[]) || [];
    setChunks(chunkList);
    setNotes((noteRow as any)?.notes_content || '');
    setRelatedModules((moduleRows as RelatedModule[]) || []);
    setLoadingChunks(false);

    await loadProcessedChunks(m.id, chunkList.length);
  };

  // Sesion I, Fix 3: carga los resumenes ya procesados; si faltan (material
  // nuevo o recien migrado), dispara el procesamiento una vez y recarga.
  const loadProcessedChunks = async (materialId: string, totalChunks: number) => {
    const { data } = await supabase
      .from('material_chunks_processed')
      .select('chunk_id, summary, key_points, main_concepts')
      .eq('material_id', materialId);

    const map = new Map<string, ProcessedChunk>((data as ProcessedChunk[] | null || []).map((p) => [p.chunk_id, p]));
    setProcessedByChunk(map);

    if (map.size < totalChunks && totalChunks > 0) {
      setProcessing(true);
      try {
        await fetch('/api/process-material-chunks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ materialId }),
        });
        const { data: refreshed } = await supabase
          .from('material_chunks_processed')
          .select('chunk_id, summary, key_points, main_concepts')
          .eq('material_id', materialId);
        setProcessedByChunk(new Map((refreshed as ProcessedChunk[] | null || []).map((p) => [p.chunk_id, p])));
      } catch (e) {
        console.warn('Error procesando material:', e);
      }
      setProcessing(false);
    }
  };

  const saveNotes = async () => {
    if (!selected) return;
    setNotesSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('study_notes').upsert(
        { student_id: user.id, material_id: selected.id, notes_content: notes, updated_at: new Date().toISOString() },
        { onConflict: 'student_id,material_id' }
      );
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    }
    setNotesSaving(false);
  };

  const activeChunk = chunks[chunkIdx];
  const activeProcessed = activeChunk ? processedByChunk.get(activeChunk.id) : undefined;
  const highlighted = useMemo(() => {
    if (!activeChunk) return null;
    if (!search.trim()) return activeChunk.content;
    const parts = activeChunk.content.split(new RegExp(`(${escapeRegExp(search.trim())})`, 'gi'));
    return parts;
  }, [activeChunk, search]);

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/my-classes/${classroomId}`} className="text-sm text-slate-400 hover:text-white transition">
          ← {classroomName}
        </Link>
        <h1 className="text-2xl font-bold text-white mt-1 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-blue-400" /> Biblioteca de Clase
        </h1>
        <p className="text-slate-400 text-sm mt-1">{materials.length} materiales disponibles</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_260px] gap-4">
        {/* Sidebar */}
        <aside className="bg-slate-800 rounded-lg border border-slate-700 p-4 space-y-3 lg:max-h-[70vh] lg:overflow-y-auto">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en materiales..."
              className="w-full pl-8 pr-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {filteredMaterials.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-6">
              {materials.length === 0 ? 'Aún no hay materiales disponibles.' : 'Ningún material coincide.'}
            </p>
          )}

          <div className="space-y-2">
            {filteredMaterials.map((m) => (
              <button
                key={m.id}
                onClick={() => selectMaterial(m)}
                className={`w-full text-left p-3 rounded-lg border-2 transition ${
                  selected?.id === m.id
                    ? 'bg-blue-500/15 border-blue-500'
                    : 'bg-slate-900 border-slate-700 hover:border-slate-500'
                }`}
              >
                <div className="text-sm font-medium text-white truncate">{m.display_name}</div>
                <div className="text-xs text-slate-400 mt-0.5">{m.chunk_count ?? 0} secciones</div>
              </button>
            ))}
          </div>
        </aside>

        {/* Viewer */}
        <main className="bg-slate-800 rounded-lg border border-slate-700 p-5 min-h-[50vh]">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16 text-slate-500">
              <BookOpen className="w-10 h-10 mb-3" />
              <p>Elige un material de la izquierda para leerlo.</p>
            </div>
          ) : loadingChunks ? (
            <p className="text-slate-400 text-sm">Cargando contenido…</p>
          ) : chunks.length === 0 ? (
            <p className="text-slate-400 text-sm">Este material no tiene contenido procesado todavía.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-white font-bold truncate">{selected.display_name}</h2>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setFontSize((s) => Math.max(12, s - 2))}
                    className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center"
                    aria-label="Reducir texto"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-slate-400 w-8 text-center">{fontSize}px</span>
                  <button
                    onClick={() => setFontSize((s) => Math.min(24, s + 2))}
                    className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center"
                    aria-label="Agrandar texto"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400">
                <button
                  onClick={() => { setChunkIdx((i) => Math.max(0, i - 1)); setShowFullText(false); }}
                  disabled={chunkIdx === 0}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 disabled:opacity-30 hover:text-white"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>
                <span>
                  Sección {chunkIdx + 1} / {chunks.length}
                </span>
                <button
                  onClick={() => { setChunkIdx((i) => Math.min(chunks.length - 1, i + 1)); setShowFullText(false); }}
                  disabled={chunkIdx === chunks.length - 1}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 disabled:opacity-30 hover:text-white"
                >
                  Siguiente <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="max-h-[45vh] overflow-y-auto pr-1 space-y-3">
                {processing && !activeProcessed && (
                  <p className="text-xs text-blue-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse" /> Preparando un resumen de esta sección…
                  </p>
                )}

                {activeProcessed && !showFullText ? (
                  <>
                    <div className="bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl p-4 text-white">
                      <h3 className="text-xs font-semibold uppercase tracking-wide opacity-80 mb-1">📌 Resumen</h3>
                      <p style={{ fontSize: `${fontSize}px` }} className="leading-relaxed">
                        {activeProcessed.summary}
                      </p>
                    </div>

                    {activeProcessed.key_points.length > 0 && (
                      <div className="bg-slate-900/60 rounded-xl p-4 border-l-4 border-emerald-500">
                        <h3 className="text-xs font-semibold uppercase text-emerald-400 mb-2">✓ Puntos Clave</h3>
                        <ul className="space-y-1.5">
                          {activeProcessed.key_points.map((point, i) => (
                            <li key={i} className="text-slate-200 text-sm pl-4 relative">
                              <span className="absolute left-0 text-emerald-400">✓</span>
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {activeProcessed.main_concepts.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {activeProcessed.main_concepts.map((concept, i) => (
                          <span key={i} className="text-xs px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-200">
                            {concept}
                          </span>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => setShowFullText(true)}
                      className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg px-3 py-1.5 transition"
                    >
                      ▼ Ver texto completo
                    </button>
                  </>
                ) : (
                  <>
                    {activeProcessed && (
                      <button
                        onClick={() => setShowFullText(false)}
                        className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg px-3 py-1.5 transition"
                      >
                        ▲ Ocultar texto completo
                      </button>
                    )}
                    <div
                      className="text-slate-200 leading-relaxed whitespace-pre-wrap"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {Array.isArray(highlighted)
                        ? highlighted.map((part, i) =>
                            part.toLowerCase() === search.trim().toLowerCase() ? (
                              <mark key={i} className="bg-blue-500/60 text-white rounded px-0.5">
                                {part}
                              </mark>
                            ) : (
                              <span key={i}>{part}</span>
                            )
                          )
                        : highlighted}
                    </div>
                  </>
                )}
              </div>

              {relatedModules.length > 0 && (
                <div className="pt-3 border-t border-slate-700">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Módulos que usan este material</h3>
                  <div className="flex flex-wrap gap-2">
                    {relatedModules.map((mod) => (
                      <Link
                        key={mod.id}
                        href={`/lesson/${mod.id}`}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 transition"
                      >
                        {mod.title} →
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Notes panel */}
        <aside className="bg-slate-800 rounded-lg border border-slate-700 p-4 space-y-2 lg:max-h-[70vh]">
          <h3 className="text-sm font-bold text-white">📝 Mis Notas</h3>
          {!selected ? (
            <p className="text-xs text-slate-500">Elige un material para tomar notas.</p>
          ) : (
            <>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Escribe tus notas aquí..."
                className="w-full h-40 resize-none rounded-lg bg-slate-900 border border-slate-700 text-sm text-white p-2.5 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={saveNotes}
                disabled={notesSaving}
                className={`w-full text-xs font-semibold py-2 rounded-lg transition ${
                  notesSaved
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {notesSaved ? '✓ Guardado' : notesSaving ? 'Guardando…' : 'Guardar Notas'}
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
