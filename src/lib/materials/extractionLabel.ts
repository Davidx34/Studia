// Que le decimos al profesor sobre como se leyo su PDF (ver pdfToMarkdown.ts).

export interface ExtractionLabel {
  tone: 'ok' | 'warn';
  text: string;
}

export function describeExtraction(method: string | null | undefined, report: unknown): ExtractionLabel | null {
  if (!method) return null; // material anterior a la migracion 048 o que no es PDF
  const r = (report ?? {}) as { pages?: number; warnings?: string[] };
  const pages = typeof r.pages === 'number' ? ` (${r.pages} páginas)` : '';

  if (method === 'plain_text') {
    const warnings = Array.isArray(r.warnings) && r.warnings.length > 0 ? ` ${r.warnings.join(' ')}` : '';
    return { tone: 'warn', text: `Se leyó como texto simple: las fórmulas y los gráficos pueden faltar.${warnings}` };
  }

  const extra = Array.isArray(r.warnings) && r.warnings.length > 0 ? ` ${r.warnings.join(' ')}` : '';
  return { tone: extra ? 'warn' : 'ok', text: `Convertido a Markdown con IA${pages}: incluye fórmulas y descripción de gráficos.${extra}` };
}
