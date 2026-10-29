// Filas de la tabla labs (migracion 078) y su conversion. Lo guardado NUNCA se usa tal cual: cada vez que se lee, la ficha se vuelve a validar y a recortar a los limites de la
// plantilla (por si el catalogo cambio, o alguien escribio en la base por otro camino). Sin React ni red.

import { buildLab, templateOfSpec } from './labSpec';
import { getLabTemplate } from './labTemplates';
import { LAB_AREA_LABEL, type LabArea, type LabSpec, type ResolvedLab } from './types';

export type LabStatus = 'draft' | 'published';

export interface LabRow {
  id: string;
  classroom_id: string;
  teacher_id: string;
  title: string;
  template: string;
  spec: unknown;
  source_material_id: string | null;
  status: LabStatus;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface LabItem {
  id: string;
  title: string;
  status: LabStatus;
  updatedAt: string;
  templateId: string;
  templateName: string;
  area: LabArea | null;
  areaLabel: string;
  sourceMaterialId: string | null;
  // La ficha ya validada; null si lo guardado no se pudo leer (plantilla retirada, dato corrupto).
  spec: LabSpec | null;
  lab: ResolvedLab | null;
}

// Una fila de la base -> lo que muestra el panel. Una ficha ilegible no rompe la lista: se marca y el profesor puede borrarla.
export function rowToItem(row: LabRow): LabItem {
  // El id de la plantilla de la fila manda sobre lo que diga el spec guardado.
  const raw = row.spec && typeof row.spec === 'object' && !Array.isArray(row.spec) ? { ...(row.spec as Record<string, unknown>), template: row.template } : null;
  const built = raw ? buildLab(raw) : null;
  // La plantilla fija del catalogo, o la que sale del modelo a la medida de la ficha.
  const tpl = built && built.ok ? templateOfSpec(built.spec) : getLabTemplate(row.template);
  return {
    id: row.id,
    title: row.title,
    status: row.status === 'published' ? 'published' : 'draft',
    updatedAt: row.updated_at,
    templateId: row.template,
    templateName: tpl?.name ?? row.template,
    area: tpl?.area ?? null,
    areaLabel: tpl ? LAB_AREA_LABEL[tpl.area] : 'Plantilla retirada',
    sourceMaterialId: row.source_material_id,
    spec: built && built.ok ? built.spec : null,
    lab: built && built.ok ? built.lab : null,
  };
}

// Lo que se escribe en la base. El titulo y la plantilla salen de la ficha ya validada (no del formulario).
export function specToFields(spec: LabSpec): { title: string; template: string; spec: LabSpec } {
  return { title: spec.title, template: spec.template, spec };
}

export const STATUS_LABEL: Record<LabStatus, string> = { draft: 'Borrador', published: 'Publicado' };

// Orden del panel: primero los publicados, luego los borradores; dentro de cada grupo, el mas reciente primero.
export function sortItems(items: LabItem[]): LabItem[] {
  return [...items].sort((a, b) => (a.status === b.status ? b.updatedAt.localeCompare(a.updatedAt) : a.status === 'published' ? -1 : 1));
}
