// Que le decimos al profesor sobre como se leyo su PDF (ver pdfToMarkdown.ts).

export interface ExtractionLabel {
  tone: 'ok' | 'warn';
  text: string;
}

interface Report {
  pages?: number;
  risky_pages?: number;
  ai_pages_accepted?: number;
  warnings?: string[];
}

export function describeExtraction(method: string | null | undefined, report: unknown): ExtractionLabel | null {
  if (!method) return null; // material anterior a la migracion 048 o que no es PDF
  const r: Report = report && typeof report === 'object' ? (report as Report) : {};
  const warnings = Array.isArray(r.warnings) && r.warnings.length > 0 ? ` ${r.warnings.join(' ')}` : '';
  const tone: 'ok' | 'warn' = warnings ? 'warn' : 'ok';
  const pages = typeof r.pages === 'number' ? ` (${r.pages} páginas)` : '';

  // Metodos anteriores a la conversion hibrida.
  if (method === 'plain_text') {
    return { tone: 'warn', text: `Se leyó como texto simple: las fórmulas y los gráficos pueden faltar.${warnings}` };
  }
  if (method.startsWith('vision_')) {
    return { tone, text: `Convertido a Markdown con IA${pages}: incluye fórmulas y descripción de gráficos.${warnings}` };
  }

  if (method === 'hybrid') {
    const accepted = r.ai_pages_accepted ?? 0;
    const risky = r.risky_pages ?? accepted;
    return {
      tone,
      text: `Convertido a Markdown${pages}: ${accepted} de ${risky} páginas con fórmulas o gráficos se transcribieron con IA y se verificaron automáticamente.${warnings}`,
    };
  }

  if (method === 'deterministic') {
    const risky = r.risky_pages ?? 0;
    if (risky === 0) return { tone, text: `Convertido a Markdown${pages} sin necesidad de IA.${warnings}` };
    return { tone: 'warn', text: `Convertido a Markdown${pages}. ${risky} páginas con fórmulas o gráficos quedaron como texto simple.${warnings}` };
  }

  return null;
}
