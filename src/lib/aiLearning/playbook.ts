// Fase 3 de «IA que aprende»: cuaderno de estilo (playbook) por clase.
// Las reglas las escribe y activa el PROFESOR; los generadores las leen como parte del prompt. Sin playbook activo todo funciona igual que antes.

export interface PlaybookRule {
  text: string;
  evidence?: string;
}

export const MAX_RULES = 10;
export const MAX_RULE_CHARS = 240;
export const MAX_EVIDENCE_CHARS = 240;

// Una regla es texto que va DENTRO de un prompt: se limpia de saltos de linea (no puede abrir secciones nuevas) y de marcadores que imitan instrucciones del sistema.
const clean = (s: unknown, max: number): string =>
  String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[`#<>]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);

export function sanitizeRules(input: unknown): PlaybookRule[] {
  if (!Array.isArray(input)) return [];
  const out: PlaybookRule[] = [];
  const seen = new Set<string>();
  for (const r of input) {
    const text = clean((r as any)?.text ?? r, MAX_RULE_CHARS);
    if (text.length < 8) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const evidence = clean((r as any)?.evidence, MAX_EVIDENCE_CHARS);
    out.push(evidence ? { text, evidence } : { text });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

/** Bloque del prompt, o '' si no hay reglas. Las reglas complementan (nunca reemplazan) la configuracion y el material de la clase. */
export function playbookPromptBlock(rules: PlaybookRule[] | null | undefined): string {
  const list = sanitizeRules(rules ?? []);
  if (!list.length) return '';
  return `REGLAS DE ESTILO APRENDIDAS EN ESTA CLASE (revisadas por el profesor; no contradicen el material ni las instrucciones de arriba):\n${list.map((r, i) => `${i + 1}. ${r.text}`).join('\n')}`;
}

type DbLike = { from: (t: string) => any };

/** Lee el playbook activo de la clase y arma su bloque. Nunca lanza: ante cualquier fallo devuelve '' (la generacion sigue como siempre). */
export async function loadActivePlaybookBlock(db: DbLike | null, classroomId: string): Promise<string> {
  if (!db) return '';
  try {
    const { data } = await db.from('ai_playbooks').select('rules').eq('classroom_id', classroomId).eq('status', 'active').maybeSingle();
    return playbookPromptBlock(data?.rules);
  } catch {
    return '';
  }
}
