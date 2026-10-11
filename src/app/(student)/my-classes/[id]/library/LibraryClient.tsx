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
import { BookOpen, Search, ChevronLeft, ChevronRight, Minus, Plus, Sparkles, ExternalLink, Video } from 'lucide-react';

interface MaterialSummary {
  id: string;
  display_name: string;
  chunk_count: number | null;
  topics_detected: string[] | null;
  created_at: string;
  source_type: 'file' | 'link' | 'youtube';
  external_url: string | null;
  external_title: string | null;
  external_favicon: string | null;
  youtube_video_id: string | null;
  thumbnail_url: string | null;
  transcript_source: string | null;
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
    <div className="theme-scope space-y-4">
      <div>
        <Link href={`/my-classes/${classroomId}`} className="inline-flex items-center min-h-[44px] text-sm text-fg-muted hover:text-fg transition motion-reduce:transition-none">
          ← {classroomName}
        </Link>
        <h1 className="text-2xl font-bold text-fg mt-1 flex items-center gap-2">
          <BookOpen aria-hidden="true" className="w-6 h-6 text-primary-text" /> Biblioteca de Clase
        </h1>
        <p className="text-fg-muted text-sm mt-1">{materials.length} materiales disponibles</p>
        {materials.length > 0 && (
          <Link
            href={`/my-classes/${classroomId}/study${selected ? `?m=${selected.id}` : ''}`}
            className="inline-flex items-center gap-2 mt-3 min-h-[44px] px-4 rounded-xl bg-primary text-on-primary hover:brightness-110 text-sm font-semibold transition motion-reduce:transition-none"
          >
            <Sparkles aria-hidden="true" className="w-4 h-4" /> Estudiar con fichas y flashcards
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_260px] gap-4">
        {/* Sidebar */}
        <aside className="bg-surface rounded-lg border border-line p-4 space-y-3 lg:max-h-[70vh] lg:overflow-y-auto">
          <div className="relative">
            <Search aria-hidden="true" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar en materiales"
              placeholder="Buscar en materiales..."
              className="w-full min-h-[44px] pl-8 pr-2 py-2 rounded-lg bg-surface-2 border border-line text-base text-fg placeholder:text-fg-muted focus:outline-none focus:border-primary"
            />
          </div>

          {filteredMaterials.length === 0 && (
            <p className="text-sm text-fg-muted text-center py-6">
              {materials.length === 0 ? 'Aún no hay materiales disponibles.' : 'Ningún material coincide.'}
            </p>
          )}

          <div className="space-y-2">
            {filteredMaterials.map((m) => (
              <button
                key={m.id}
                onClick={() => selectMaterial(m)}
                aria-pressed={selected?.id === m.id}
                className={`w-full min-h-[44px] text-left p-3 rounded-lg border-2 transition motion-reduce:transition-none ${
                  selected?.id === m.id
                    ? 'bg-primary/15 border-primary'
                    : 'bg-surface-2 border-line hover:border-line-strong'
                }`}
              >
                <div className="text-sm font-medium text-fg truncate">{m.display_name}</div>
                <div className="text-xs text-fg-muted mt-0.5">{m.chunk_count ?? 0} secciones</div>
              </button>
            ))}
          </div>
        </aside>

        {/* Viewer */}
        <main className="bg-surface rounded-lg border border-line p-5 min-h-[50vh]">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16 text-fg-muted">
              <BookOpen aria-hidden="true" className="w-10 h-10 mb-3" />
              <p>Elige un material de la izquierda para leerlo.</p>
            </div>
          ) : loadingChunks ? (
            <p className="text-fg-muted text-sm">Cargando contenido…</p>
          ) : chunks.length === 0 && selected.source_type === 'file' ? (
            <p className="text-fg-muted text-sm">Este material no tiene contenido procesado todavía.</p>
          ) : (
            <div className="space-y-4">
              {selected.source_type === 'youtube' && selected.youtube_video_id && (
                <div className="aspect-video w-full rounded-lg overflow-hidden bg-black">
                  <iframe
                    className="w-full h-full"
                    src={`https://www.youtube.com/embed/${selected.youtube_video_id}`}
                    title={selected.display_name}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}

              {selected.source_type === 'link' && selected.external_url && (
                <a
                  href={selected.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 min-h-[44px] p-3 rounded-lg bg-surface-2 border border-line hover:border-line-strong transition motion-reduce:transition-none text-sm"
                >
                  {selected.external_favicon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.external_favicon} alt="" className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="text-primary-text truncate flex-1">{selected.external_title || selected.external_url}</span>
                  <ExternalLink aria-hidden="true" className="w-3.5 h-3.5 text-fg-muted flex-shrink-0" />
                </a>
              )}

              {selected.source_type === 'youtube' && chunks.length === 0 && (
                <p className="text-xs text-accent-text flex items-center gap-1.5">
                  <Video aria-hidden="true" className="w-3.5 h-3.5" /> No encontramos subtítulos automáticos para este video, así que no
                  hay preguntas generadas a partir de él todavía.
                </p>
              )}

              {chunks.length > 0 && (
              <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-fg font-bold truncate">{selected.display_name}</h2>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setFontSize((s) => Math.max(12, s - 2))}
                    className="w-11 h-11 rounded-lg bg-surface-2 border border-line text-fg-muted hover:text-fg flex items-center justify-center"
                    aria-label="Reducir texto"
                  >
                    <Minus aria-hidden="true" className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-fg-muted w-10 text-center" aria-live="polite">{fontSize}px</span>
                  <button
                    onClick={() => setFontSize((s) => Math.min(24, s + 2))}
                    className="w-11 h-11 rounded-lg bg-surface-2 border border-line text-fg-muted hover:text-fg flex items-center justify-center"
                    aria-label="Agrandar texto"
                  >
                    <Plus aria-hidden="true" className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-fg-muted">
                <button
                  onClick={() => { setChunkIdx((i) => Math.max(0, i - 1)); setShowFullText(false); }}
                  disabled={chunkIdx === 0}
                  className="flex items-center gap-1 min-h-[44px] px-3 rounded-lg bg-surface-2 border border-line disabled:opacity-40 hover:text-fg"
                >
                  <ChevronLeft aria-hidden="true" className="w-3.5 h-3.5" /> Anterior
                </button>
                <span>
                  Sección {chunkIdx + 1} / {chunks.length}
                </span>
                <button
                  onClick={() => { setChunkIdx((i) => Math.min(chunks.length - 1, i + 1)); setShowFullText(false); }}
                  disabled={chunkIdx === chunks.length - 1}
                  className="flex items-center gap-1 min-h-[44px] px-3 rounded-lg bg-surface-2 border border-line disabled:opacity-40 hover:text-fg"
                >
                  Siguiente <ChevronRight aria-hidden="true" className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="max-h-[45vh] overflow-y-auto pr-1 space-y-3">
                {processing && !activeProcessed && (
                  <p role="status" className="text-xs text-primary-text flex items-center gap-1.5">
                    <Sparkles aria-hidden="true" className="w-3.5 h-3.5 animate-pulse motion-reduce:animate-none" /> Preparando un resumen de esta sección…
                  </p>
                )}

                {activeProcessed && !showFullText ? (
                  <>
                    <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 text-fg">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-text mb-1">Resumen</h3>
                      <p style={{ fontSize: `${fontSize}px` }} className="leading-relaxed">
                        {activeProcessed.summary}
                      </p>
                    </div>

                    {activeProcessed.key_points.length > 0 && (
                      <div className="bg-surface-2 rounded-xl p-4 border-l-4 border-success">
                        <h3 className="text-xs font-semibold uppercase text-success mb-2">Puntos clave</h3>
                        <ul className="space-y-1.5">
                          {activeProcessed.key_points.map((point, i) => (
                            <li key={i} className="text-fg text-sm pl-4 relative">
                              <span aria-hidden="true" className="absolute left-0 text-success">✓</span>
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {activeProcessed.main_concepts.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {activeProcessed.main_concepts.map((concept, i) => (
                          <span key={i} className="text-xs px-3 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary-text">
                            {concept}
                          </span>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => setShowFullText(true)}
                      className="text-xs min-h-[44px] text-fg-muted hover:text-fg border border-line rounded-lg px-3 transition motion-reduce:transition-none"
                    >
                      ▼ Ver texto completo
                    </button>
                  </>
                ) : (
                  <>
                    {activeProcessed && (
                      <button
                        onClick={() => setShowFullText(false)}
                        className="text-xs min-h-[44px] text-fg-muted hover:text-fg border border-line rounded-lg px-3 transition motion-reduce:transition-none"
                      >
                        ▲ Ocultar texto completo
                      </button>
                    )}
                    <div
                      className="text-fg leading-relaxed whitespace-pre-wrap"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {Array.isArray(highlighted)
                        ? highlighted.map((part, i) =>
                            part.toLowerCase() === search.trim().toLowerCase() ? (
                              <mark key={i} className="bg-accent/40 text-fg rounded px-0.5">
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
                <div className="pt-3 border-t border-line">
                  <h3 className="text-xs font-semibold text-fg-muted uppercase mb-2">Módulos que usan este material</h3>
                  <div className="flex flex-wrap gap-2">
                    {relatedModules.map((mod) => (
                      <Link
                        key={mod.id}
                        href={`/lesson/${mod.id}`}
                        className="inline-flex items-center min-h-[44px] text-xs px-3 rounded-lg bg-primary/10 border border-primary/30 text-primary-text hover:bg-primary/20 transition motion-reduce:transition-none"
                      >
                        {mod.title} →
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              </>
              )}
            </div>
          )}
        </main>

        {/* Notes panel */}
        <aside className="bg-surface rounded-lg border border-line p-4 space-y-2 lg:max-h-[70vh]">
          <h3 className="text-sm font-bold text-fg">Mis notas</h3>
          {!selected ? (
            <p className="text-xs text-fg-muted">Elige un material para tomar notas.</p>
          ) : (
            <>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                aria-label="Mis notas de este material"
                placeholder="Escribe tus notas aquí..."
                className="w-full h-40 resize-none rounded-lg bg-surface-2 border border-line text-base text-fg p-2.5 focus:outline-none focus:border-primary"
              />
              <button
                onClick={saveNotes}
                disabled={notesSaving}
                className={`w-full min-h-[44px] text-sm font-semibold rounded-lg transition motion-reduce:transition-none ${
                  notesSaved
                    ? 'bg-success/15 text-success border border-success/40'
                    : 'bg-primary text-on-primary hover:brightness-110'
                }`}
              >
                {notesSaved ? 'Guardado' : notesSaving ? 'Guardando…' : 'Guardar notas'}
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
