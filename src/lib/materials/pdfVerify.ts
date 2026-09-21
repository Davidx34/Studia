// Verificacion AUTOMATICA y gratuita de lo que transcribe un modelo con vision, pagina por pagina.
//
// Motivo (medido): con el mismo PDF, el mismo modelo y temperatura 0, una corrida transcribio bien una
// tabla de demandas y otra la dejo transpuesta y con "B" en lugar de "β". Nadie se dio cuenta porque el
// control de calidad solo miraba paginas y palabras. Sin pedirle nada al profesor, se comprueba:
//
//   1. Que cada formula sea LaTeX VALIDO (KaTeX, determinista): atrapa formulas rotas o truncadas.
//   2. Que los SIMBOLOS (letras griegas, operadores) y los NUMEROS que la extraccion determinista si pudo
//      leer aparezcan en la transcripcion, con su frecuencia: atrapa "β" -> "B" y terminos perdidos.
//   3. Que las PALABRAS del texto leido aparezcan: atrapa paginas resumidas u omitidas.
//
// Si una pagina no pasa, esa pagina vuelve al texto determinista (ver pdfToMarkdown.ts).
// Limite conocido: una tabla transpuesta tiene los mismos simbolos y el mismo LaTeX valido; esto no la ve.

export type LatexRenderer = (expression: string, displayMode: boolean) => void;

const GREEK_COMMANDS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', varrho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ',
  Psi: 'Ψ', Omega: 'Ω', partial: '∂', sum: '∑', int: '∫', infty: '∞', leq: '≤', le: '≤', geq: '≥', ge: '≥',
  neq: '≠', ne: '≠', in: '∈', nabla: '∇',
};

const SYMBOL_RE = /[α-ωΑ-Ω∂∑∫∞≤≥≠∈∇]/g;
const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

// Simbolos que la extraccion determinista si leyo, normalizados a Unicode ("ϕ" y "φ", "ϵ" y "ε" cuentan igual).
function canonicalSymbol(ch: string): string {
  const alias: Record<string, string> = { ϕ: 'φ', ϵ: 'ε', ϑ: 'θ', ϱ: 'ρ', ς: 'σ', '∗': '*' };
  return alias[ch] ?? ch;
}

function countSymbols(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of text.match(SYMBOL_RE) ?? []) {
    const k = canonicalSymbol(m);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

// El LaTeX escribe "\beta"; el texto extraido trae "β". Se pasa todo a Unicode para poder comparar.
export function latexToUnicodeSymbols(text: string): string {
  return text.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (m, name: string) => GREEK_COMMANDS[name] ?? m);
}

export function extractMathSegments(markdown: string): { expression: string; display: boolean }[] {
  const out: { expression: string; display: boolean }[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    if (m[1] !== undefined) out.push({ expression: m[1].trim(), display: true });
    else out.push({ expression: m[2].trim(), display: false });
  }
  return out;
}

export async function defaultLatexRenderer(): Promise<LatexRenderer> {
  const katex: any = (await import('katex')).default ?? (await import('katex'));
  return (expression, displayMode) => {
    // strict 'ignore': solo interesa si NO se puede interpretar, no los avisos de estilo.
    katex.renderToString(expression, { throwOnError: true, displayMode, strict: 'ignore' });
  };
}

export function countInvalidLatex(markdown: string, render: LatexRenderer): { total: number; invalid: number } {
  const segments = extractMathSegments(markdown);
  let invalid = 0;
  for (const s of segments) {
    if (!s.expression) continue;
    try {
      render(s.expression, s.display);
    } catch {
      invalid++;
    }
  }
  return { total: segments.length, invalid };
}

// Fraccion (0..1) de los simbolos del texto leido que aparecen en la transcripcion, contando repeticiones.
export function symbolRecall(plainText: string, aiMarkdown: string): { ratio: number | null; total: number } {
  const plain = countSymbols(plainText);
  let total = 0;
  plain.forEach((n) => (total += n));
  if (total < 4) return { ratio: null, total }; // muy pocos simbolos para comparar
  const ai = countSymbols(latexToUnicodeSymbols(aiMarkdown));
  let matched = 0;
  plain.forEach((n, sym) => (matched += Math.min(n, ai.get(sym) ?? 0)));
  return { ratio: matched / total, total };
}

export function numberRecall(plainText: string, aiMarkdown: string): { ratio: number | null; total: number } {
  const plain = plainText.match(NUMBER_RE) ?? [];
  if (plain.length < 6) return { ratio: null, total: plain.length };
  const ai = new Map<string, number>();
  for (const n of aiMarkdown.match(NUMBER_RE) ?? []) ai.set(n, (ai.get(n) ?? 0) + 1);
  let matched = 0;
  const used = new Map<string, number>();
  for (const n of plain) {
    const u = used.get(n) ?? 0;
    if (u < (ai.get(n) ?? 0)) {
      matched++;
      used.set(n, u + 1);
    }
  }
  return { ratio: matched / plain.length, total: plain.length };
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
  );
}

export function pageWordRecall(plainText: string, aiMarkdown: string): number | null {
  const plain = words(plainText);
  if (plain.size < 8) return null;
  const ai = words(latexToUnicodeSymbols(aiMarkdown));
  let hit = 0;
  plain.forEach((w) => {
    if (ai.has(w)) hit++;
  });
  return hit / plain.size;
}

export const MIN_SYMBOL_RECALL = 0.8;
export const MIN_NUMBER_RECALL = 0.75;
export const MIN_PAGE_WORD_RECALL = 0.8;

export interface PageVerdict {
  ok: boolean;
  reasons: string[];
}

export function verifyPage(plainText: string, aiMarkdown: string, render: LatexRenderer): PageVerdict {
  const reasons: string[] = [];

  if (aiMarkdown.trim().length < 5) reasons.push('la transcripcion quedo vacia');

  const latex = countInvalidLatex(aiMarkdown, render);
  if (latex.invalid > 0) reasons.push(`${latex.invalid} de ${latex.total} formulas no son LaTeX valido`);

  const sym = symbolRecall(plainText, aiMarkdown);
  if (sym.ratio !== null && sym.ratio < MIN_SYMBOL_RECALL) {
    reasons.push(`solo aparece el ${Math.round(sym.ratio * 100)}% de los simbolos que tenia la pagina`);
  }

  const num = numberRecall(plainText, aiMarkdown);
  if (num.ratio !== null && num.ratio < MIN_NUMBER_RECALL) {
    reasons.push(`solo aparece el ${Math.round(num.ratio * 100)}% de los numeros de la pagina`);
  }

  const wr = pageWordRecall(plainText, aiMarkdown);
  if (wr !== null && wr < MIN_PAGE_WORD_RECALL) {
    reasons.push(`solo aparece el ${Math.round(wr * 100)}% de las palabras de la pagina`);
  }

  return { ok: reasons.length === 0, reasons };
}
