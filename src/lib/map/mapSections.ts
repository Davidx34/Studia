// Del dato de la base al mapa del estudiante: los modulos se convierten en nodos (con su estado) y se reparten en SECCIONES, una por clase, cada una con la plantilla
// que eligio su profesor. Los modulos generales (sin clase) van en su propia seccion. Sin React ni red, para poder probarlo.

import { normalizeMapTemplate, type MapTemplateId } from './mapTemplates';
import type { MapNode, NodeStatus } from './types';

export interface ModuleRow {
  id: string;
  title: string;
  category: string;
  difficulty_level: number | null;
  order_index: number | null;
  map_position_x: number | null;
  map_position_y: number | null;
  prerequisites: unknown;
  classroom_id: string | null;
}

export interface ProgressRow {
  module_id: string;
  status: string | null;
  best_score: number | null;
  completion_percentage: number | null;
}

export interface ClassroomRow {
  id: string;
  name: string;
  map_template?: string | null;
}

export interface NodeWithClass {
  node: MapNode;
  classroomId: string | null;
}

const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// Estado de cada modulo: completado / en curso segun el progreso; si no, disponible o bloqueado segun sus prerrequisitos. (La misma regla de siempre.)
export function buildNodes(modules: ModuleRow[], progress: ProgressRow[]): NodeWithClass[] {
  const progressMap = new Map(progress.map((p) => [p.module_id, p]));
  const completed = new Set(progress.filter((p) => p.status === 'completed').map((p) => p.module_id));
  const current = progress.find((p) => p.status === 'in_progress')?.module_id ?? null;

  return modules.map((m) => {
    const p = progressMap.get(m.id);
    const prereqs = idsOf(m.prerequisites);
    let status: NodeStatus;
    if (p?.status === 'completed') status = 'completed';
    else if (p?.status === 'in_progress') status = 'in_progress';
    else status = prereqs.length === 0 || prereqs.every((pid) => completed.has(pid)) ? 'available' : 'locked';

    return {
      classroomId: m.classroom_id,
      node: {
        id: m.id,
        title: m.title,
        category: m.category,
        difficulty: m.difficulty_level ?? 1,
        order: m.order_index ?? 0,
        x: m.map_position_x ?? 500,
        y: m.map_position_y ?? 200,
        prerequisites: prereqs,
        status,
        score: p?.best_score || null,
        completionPct: p?.completion_percentage || 0,
        isCurrent: m.id === current,
      },
    };
  });
}

export interface MapSection {
  id: string;
  title: string;
  template: MapTemplateId;
  nodes: MapNode[];
  total: number;
  completed: number;
  general: boolean;
}

export const GENERAL_SECTION_ID = 'general';
export const GENERAL_SECTION_TITLE = 'Módulos generales';

const section = (id: string, title: string, template: unknown, nodes: MapNode[], general: boolean): MapSection => ({
  id,
  title,
  template: normalizeMapTemplate(template),
  nodes,
  total: nodes.length,
  completed: nodes.filter((n) => n.status === 'completed').length,
  general,
});

// Una seccion por clase (en orden alfabetico) con la plantilla de su profesor; los modulos sin clase, o de una clase que no aparece en la lista, van al final en
// "Módulos generales" con el mapa de siempre: ningun modulo desaparece. Una clase sin modulos no genera seccion.
export function buildMapSections(items: NodeWithClass[], classrooms: ClassroomRow[]): MapSection[] {
  const known = new Set(classrooms.map((c) => c.id));
  const sections: MapSection[] = [...classrooms]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((c) =>
      section(c.id, c.name, c.map_template, items.filter((i) => i.classroomId === c.id).map((i) => i.node), false),
    )
    .filter((s) => s.total > 0);
  const general = items.filter((i) => i.classroomId === null || !known.has(i.classroomId)).map((i) => i.node);
  if (general.length > 0) sections.push(section(GENERAL_SECTION_ID, GENERAL_SECTION_TITLE, null, general, true));
  return sections;
}

// La seccion que se abre primero: la que tiene un modulo en curso; si no, la primera con algo disponible; si no, la primera.
export function defaultSectionId(sections: MapSection[]): string | null {
  if (sections.length === 0) return null;
  const withStatus = (st: NodeStatus[]) => sections.find((s) => s.nodes.some((n) => st.includes(n.status)));
  return (withStatus(['in_progress', 'current']) ?? withStatus(['available']) ?? sections[0]).id;
}
