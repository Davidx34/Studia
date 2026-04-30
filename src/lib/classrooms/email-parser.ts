// Parser de listas de emails para "Invitar estudiantes"
// Fase 11.B · Stud.ia
//
// Acepta separadores flexibles: coma, punto y coma, salto de línea, espacios.
// Normaliza a lowercase + trim. Deduplica.
// Valida con regex simple per brief.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedEmails {
  valid: string[];
  invalid: string[];
}

export function parseEmailList(raw: string): ParsedEmails {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const tok of tokens) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    if (EMAIL_REGEX.test(tok)) {
      valid.push(tok);
    } else {
      invalid.push(tok);
    }
  }

  return { valid, invalid };
}
