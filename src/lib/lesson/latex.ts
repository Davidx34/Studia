// Formulas en el texto de las preguntas: reparar lo que se corrompio y separar bien «texto» de «matematica». Codigo puro (lo usa MathText, que solo dibuja).
//
// Fallos medidos en preguntas reales de Microeconomia (2026-11-04; de 392 campos con `$`, 70 tenian una formula que KaTeX no podia dibujar):
//   1. LaTeX CORRUPTO: al leer el JSON de la IA, `\frac` quedo como «salto de pagina + rac» y `\beta` como «retroceso + eta» (26 preguntas guardadas, la ultima del 11 de octubre; hoy ya se
//      protege al leer). Se repara al MOSTRAR, sin tocar la base.
//   2. DOLARES de moneda leidos como formula: «ingreso de $100 y los precios son $10 y $20» se dibujaba como matematica entre el primer y el segundo signo.
//   3. La casilla en blanco de «completar» DENTRO de una formula («... = ___») rompe KaTeX (doble subindice).

// Una secuencia de escape de JSON se comio la barra invertida de estos comandos de LaTeX: \f (salto de pagina), \b (retroceso), \t (tabulador), \v (tab. vertical), \a (campana), \r.
// Solo se reparan combinaciones CONOCIDAS (control + resto del comando), para no inventar nada.
const REPAIRS: [RegExp, string][] = [
  [/\f(rac|orall|lat)/g, '\\f$1'],
  [/\x08(eta|ar|oxed|egin|inom|ig|ullet|oldsymbol|ot)/g, '\\b$1'],
  [/\t(imes|heta|ext|au|ilde|riangle|o\b|op)/g, '\\t$1'],
  [/\x0b(ec|arepsilon|arphi|artheta|ee|dots)/g, '\\v$1'],
  [/\x07(lpha|pprox|ngle)/g, '\\a$1'],
  [/\r(ho|ightarrow|ight|angle)/g, '\\r$1'],
  // \n (salto de linea real): solo ante comandos que NO son una palabra normal al empezar linea (\neq, \nabla, \newline, \less, \leq, \geq).
  [/\n(?=(eq|abla|ewline|less|leq?|geq?)\b)/g, '\\n'],
];

export function repairLatexControlChars(text: string): string {
  if (!/[\x07\x08\t\x0b\f\r\n]/.test(text)) return text;
  return REPAIRS.reduce((t, [re, to]) => t.replace(re, to), text);
}

// Dentro de una FORMULA: la casilla en blanco («= ___») se escribe con guiones bajos escapados, y un comando como \neq o \nabla cuyo «\n» quedo como salto de linea real se repara (solo aqui:
// fuera de una formula un salto de linea es texto).
export function fixMathContent(value: string): string {
  // Un `%` sin escapar es un COMENTARIO para KaTeX (se come el resto de la formula): «\frac{%\Delta Q}{...}».
  return value.replace(/(?<!\\)_{2,}/g, (m) => '\\_'.repeat(m.length)).replace(/(?<!\\)%/g, '\\%');
}

export type MathSegment = { kind: 'text'; value: string } | { kind: 'inline'; value: string } | { kind: 'block'; value: string };

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && /[0-9]/.test(c);

// Reglas de Pandoc para `$...$`: el `$` que abre tiene un caracter que NO es espacio a su derecha; el que cierra tiene un caracter que NO es espacio a su izquierda y NO va seguido de un
// digito. Asi «$100 y los precios son $10» no abre formula (el segundo `$` va precedido de un espacio). `\$` es un dolar literal (en la formula se conserva, KaTeX lo entiende).
export function splitMath(input: string): MathSegment[] {
  const s = repairLatexControlChars(input);
  const out: MathSegment[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ kind: 'text', value: text });
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }
    if (c === '$' && s[i + 1] === '$') {
      const end = s.indexOf('$$', i + 2);
      if (end > i + 2 && s.slice(i + 2, end).trim()) {
        flush();
        out.push({ kind: 'block', value: fixMathContent(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (c === '$' && !isSpace(s[i + 1]) && s[i + 1] !== '$') {
      let end = -1;
      for (let j = i + 1; j < s.length; j++) {
        if (s[j] === '\\') {
          j++; // el caracter escapado (incluido «\$») no cierra
          continue;
        }
        if (s[j] === '$' && !isSpace(s[j - 1]) && !isDigit(s[j + 1])) {
          end = j;
          break;
        }
        // Otro `$` que PARECE abrir (espacio antes, texto pegado despues) antes de encontrar un cierre: el primero era dinero («de $100 se cumple $p_x$»).
        if (s[j] === '$' && isSpace(s[j - 1]) && !isSpace(s[j + 1])) break;
      }
      if (end > i + 1) {
        flush();
        out.push({ kind: 'inline', value: fixMathContent(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    text += c;
    i++;
  }
  flush();
  return out;
}
