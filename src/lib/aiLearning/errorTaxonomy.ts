// Taxonomia de ERRORES de las preguntas generadas: clasifica el motivo que escribe el juez (o el profesor) en una categoria con ORIGEN (de quien es el defecto), para medir y reducir errores sin culpar
// al generador de lo que es del pipeline o de la infraestructura. Es deterministica (reglas), asi que es auditable y reproducible; lo que no encaja queda en «otro» y se mide para afinar las reglas.
//
// Orden de las reglas: de lo mas especifico a lo mas general. Una razon cae en la PRIMERA categoria que coincide.

export type ErrorCategory =
  | 'sin_motivo'
  | 'segunda_opinion_fallida'
  | 'juez_sin_veredicto'
  | 'duplicada'
  | 'formato_minijuego'
  | 'respuesta_no_evaluable'
  | 'redaccion_confusa'
  | 'no_autocontenida'
  | 'ambiguedad_respuesta_unica'
  | 'anclaje_material'
  | 'error_conceptual_o_calculo'
  | 'otro';

/** De quien es el defecto: del generador (se arregla con prompt/reglas), del pipeline (juez, validadores) o de la infraestructura (cuotas, llaves). */
export type ErrorOrigin = 'generador' | 'pipeline' | 'infraestructura' | 'sin_clasificar';

export interface CategoryInfo {
  label: string;
  origin: ErrorOrigin;
  /** Que se puede hacer para reducirlo (texto corto para el profesor/desarrollador). */
  remedy: string;
}

export const CATEGORIES: Record<ErrorCategory, CategoryInfo> = {
  sin_motivo: { label: 'Veredicto sin motivo registrado', origin: 'pipeline', remedy: 'Guardar siempre el motivo del veredicto (sin motivo no se puede aprender de él).' },
  segunda_opinion_fallida: { label: 'No se pudo confirmar con una segunda opinión', origin: 'infraestructura', remedy: 'Reintentar el juicio cuando haya cuota; el profesor confirma mientras tanto.' },
  juez_sin_veredicto: { label: 'El juez no pudo emitir veredicto', origin: 'infraestructura', remedy: 'Reintentar el juicio (cuota, llave o respuesta ilegible).' },
  duplicada: { label: 'Pregunta duplicada', origin: 'generador', remedy: 'Pedir cobertura distinta por pregunta y deduplicar antes de guardar.' },
  formato_minijuego: { label: 'No cumple el formato del minijuego', origin: 'generador', remedy: 'Reforzar el formato exacto del minijuego en el prompt y validar antes de guardar.' },
  respuesta_no_evaluable: { label: 'La respuesta esperada no es específica ni evaluable', origin: 'generador', remedy: 'Pedir respuestas cortas y verificables; si es abierta, usar opción múltiple.' },
  redaccion_confusa: { label: 'Redacción confusa', origin: 'generador', remedy: 'Enunciados breves y directos, una sola idea por pregunta.' },
  no_autocontenida: { label: 'No se entiende sin contexto extra', origin: 'generador', remedy: 'Incluir en el enunciado todos los datos y símbolos que se necesitan.' },
  ambiguedad_respuesta_unica: { label: 'Más de una respuesta posible', origin: 'generador', remedy: 'Una sola respuesta correcta y distractores claramente incorrectos.' },
  anclaje_material: { label: 'No está respaldada por el material', origin: 'generador', remedy: 'Generar solo lo que el material dice; citar el fragmento de apoyo.' },
  error_conceptual_o_calculo: { label: 'Error conceptual o de cálculo', origin: 'generador', remedy: 'Verificar la respuesta contra el material y recalcular antes de guardar.' },
  otro: { label: 'Sin clasificar', origin: 'sin_clasificar', remedy: 'Revisar a mano y, si se repite, agregar una regla de clasificación.' },
};

const RULES: [ErrorCategory, RegExp][] = [
  ['segunda_opinion_fallida', /no se pudo obtener una segunda opini[oó]n|segundo juez[^.]{0,60}no coincide|no coincide \((fail|pass|review)\)/i],
  ['juez_sin_veredicto', /cuota agotada|sin api key|respuesta ilegible|no pudo emitir (un )?veredicto|el juez no pudo/i],
  ['duplicada', /duplicad|repetici[oó]n id[eé]ntica|id[eé]ntic[oa] a la pregunta|misma pregunta/i],
  ['formato_minijuego', /minijuego|formato|estructura|flash_pairs|correct_position|entre \d+ y \d+ (elementos|items|pares|tarjetas)|requiere (la clave|entre|exactamente)/i],
  ['respuesta_no_evaluable', /no es (una )?respuesta espec[ií]fica|no (es )?(espec[ií]fica|evaluable)|oraci[oó]n larga|respuesta abierta|explicaci[oó]n abierta|no acepta variantes|palabras? clave|no se puede escribir|respuesta esperada (es|no)/i],
  ['redaccion_confusa', /redacci[oó]n (confusa|ambigua|forzada)|confus[oa]|gramaticalmente|no est[aá] claro/i],
  ['no_autocontenida', /autocontenid|remite a|referencia a ['"]?el texto|no especifica|faltan datos|no define (los )?s[ií]mbolos|sin (el )?contexto|no se indica/i],
  ['ambiguedad_respuesta_unica', /respuesta [uú]nica|m[uú]ltiples (opciones|respuestas)|ambig[uü]|dos (opciones|respuestas)|tanto la opci[oó]n|expresan exactamente|m[aá]s de una (opci[oó]n|respuesta)/i],
  ['anclaje_material', /(no|ninguno|ni)\b[^.]{0,80}\b(material|fuente)\b|material (fuente )?(no|solo|[uú]nicamente)|no est[aá] anclad|no (se )?(puede|pueden) verificar|aunque el material|no se (menciona|describe|define|proporciona)|(el )?material[^.]{0,160}(pero|y) no (describe|explica|define|especifica|detalla)|pero el material|no (describe|explica|especifica) (expl[ií]citamente|c[oó]mo|el efecto)/i],
  ['error_conceptual_o_calculo', /incorrect|err[oó]ne|\bfals[oa]\b|es falso|error (de|en el) c[aá]lculo|confunde|define (mal|incorrectamente)|invierte|contradice|en realidad|no coincide con|no corresponde|equivocad|imprecis|no es la terminolog[ií]a|el t[eé]rmino ([a-z]+ )?correcto|tautolog|contradicci|l[oó]gicamente correcto|se marc[oó]|marcad[ao] como (correct|verdader|culpable|falsa)|no es [^.]{0,60}, (sino|es)\b|, no (el|la|los|las|\d)/i],
];

/** Clasifica el motivo de un veredicto. Quita las marcas de procedencia («[juez actual: fail]», «Auditoria 2026-10-27:»). */
export function classifyReason(reason: string | null | undefined): ErrorCategory {
  if (!reason || !reason.trim()) return 'sin_motivo';
  const text = reason
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .replace(/^\s*Auditoria[^:]*:\s*/i, '')
    .trim();
  if (!text) return 'otro';
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return 'otro';
}

/** Motivos que NO son defecto de la pregunta (los escribe el validador de forma al retirarla): no entran a la medicion de calidad del generador. */
export const isFormValidatorReason = (reason: string | null | undefined): boolean => !!reason && reason.startsWith('[validador de forma]');

export interface ErrorSummary {
  total: number;
  byCategory: Record<string, number>;
  byOrigin: Record<ErrorOrigin, number>;
  /** Fraccion en «sin clasificar»: si es alta, las reglas de clasificacion necesitan afinarse. */
  unclassifiedShare: number;
}

export function summarizeErrors(reasons: (string | null | undefined)[]): ErrorSummary {
  const byCategory: Record<string, number> = {};
  const byOrigin: Record<ErrorOrigin, number> = { generador: 0, pipeline: 0, infraestructura: 0, sin_clasificar: 0 };
  let total = 0;
  for (const r of reasons) {
    if (isFormValidatorReason(r)) continue;
    const cat = classifyReason(r);
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byOrigin[CATEGORIES[cat].origin]++;
    total++;
  }
  return { total, byCategory, byOrigin, unclassifiedShare: total ? Math.round((byCategory.otro ?? 0) / total * 1000) / 1000 : 0 };
}
