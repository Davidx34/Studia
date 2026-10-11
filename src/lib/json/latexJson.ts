// El modelo escribe formulas LaTeX con UNA barra dentro de un string JSON: "$\frac{a}{b}$", "$\beta$", "$\times$".
// En JSON, \f \b \t \n \r son escapes VALIDOS: JSON.parse no da error y convierte "\frac" en salto de pagina + "rac",
// "\beta" en retroceso + "eta", "\times" en tabulacion + "imes"... El texto llega corrupto a la base y a pantalla.
//
// Dentro de $...$ una barra simple es LaTeX, no un escape JSON: se dobla ANTES de parsear. Lo ya doblado ("\\frac",
// el JSON correcto) no se toca. Fuera de las formulas no se hace nada (un "\n" real sigue siendo un salto de linea).
export function protectLatexBackslashes(json: string): string {
  return json.replace(/\$[^$\n]*\$/g, (seg) => seg.replace(/(?<!\\)\\(?!\\)/g, '\\\\'));
}

// Respaldo para barras sueltas que no inician un escape valido (p. ej. "\partial" fuera de una formula).
export function escapeInvalidJsonBackslashes(json: string): string {
  return json.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}
