import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { repairLatexControlChars, splitMath, type MathSegment } from './latex';

const FF = '\f'; // «salto de pagina»: lo que quedo de la barra de \frac
const BS = '\b'; // «retroceso»: lo que quedo de la barra de \beta
const kinds = (s: string): string => splitMath(s).map((x: MathSegment) => `${x.kind}:${x.value}`).join(' | ');

describe('repairLatexControlChars: LaTeX corrupto de preguntas guardadas', () => {
  it('los dos casos reales: \\frac y \\beta', () => {
    expect(repairLatexControlChars(`$${FF}rac{\\partial U}{\\partial x} = 0$`)).toBe('$\\frac{\\partial U}{\\partial x} = 0$');
    expect(repairLatexControlChars(`$U(x,y) = ax^{\\alpha}y^{${BS}eta}$`)).toBe('$U(x,y) = ax^{\\alpha}y^{\\beta}$');
  });
  it('otros comandos conocidos', () => {
    expect(repairLatexControlChars('a\times b')).toBe('a\\times b');
    expect(repairLatexControlChars('\theta + \text{x}')).toBe('\\theta + \\text{x}');
    expect(repairLatexControlChars('\x07lpha')).toBe('\\alpha');
    expect(repairLatexControlChars('\x0bec{v}')).toBe('\\vec{v}');
    expect(repairLatexControlChars('\rho')).toBe('\\rho');
  });
  it('no inventa: un caracter de control que no forma un comando conocido se deja igual', () => {
    expect(repairLatexControlChars('col1\tcol2')).toBe('col1\tcol2');
    expect(repairLatexControlChars(`${FF}zzz`)).toBe(`${FF}zzz`);
    expect(repairLatexControlChars('linea1\rlinea2')).toBe('linea1\rlinea2');
  });
  it('un texto sin caracteres de control queda IGUAL (misma cadena)', () => {
    const t = 'La función $\\frac{a}{b}$ es continua.';
    expect(repairLatexControlChars(t)).toBe(t);
  });
});

describe('splitMath: formula frente a dinero', () => {
  it('formulas en linea y en bloque', () => {
    expect(kinds('La utilidad $U(x,y)$ crece')).toBe('text:La utilidad  | inline:U(x,y) | text: crece');
    expect(kinds('Mira: $$x^2 + y^2$$ fin')).toBe('text:Mira:  | block:x^2 + y^2 | text: fin');
    expect(kinds('$a$ y $b$')).toBe('inline:a | text: y  | inline:b');
  });
  it('los casos reales de DINERO no son formula', () => {
    const q1 = 'Si un consumidor tiene un ingreso de $100 y los precios de los bienes x e y son $10 y $20 respectivamente';
    expect(splitMath(q1)).toEqual([{ kind: 'text', value: q1 }]);
    const q2 = 'cuál es la pérdida de eficiencia generada por un impuesto de $2 en el mercado';
    expect(splitMath(q2)).toEqual([{ kind: 'text', value: q2 }]);
    const q3 = 'Si el costo marginal es constante e igual a $2, la oferta será horizontal a P = ___.';
    expect(splitMath(q3)).toEqual([{ kind: 'text', value: q3 }]);
  });
  it('dinero Y formula en la misma frase', () => {
    expect(kinds('Con ingreso de $100 se cumple $p_x x + p_y y \\le 100$ siempre')).toBe('text:Con ingreso de $100 se cumple  | inline:p_x x + p_y y \\le 100 | text: siempre');
  });
  it('el real con «\\$»: un dolar literal DENTRO de la formula se conserva', () => {
    const q = 'con demanda lineal dada por $P = 10 - Q/10$ y un costo marginal constante $CMg = \\$2$, ¿cuál es el equilibrio?';
    expect(kinds(q)).toBe('text:con demanda lineal dada por  | inline:P = 10 - Q/10 | text: y un costo marginal constante  | inline:CMg = \\$2 | text: , ¿cuál es el equilibrio?'.replace(' ,', ','));
  });
  it('un «\\$» fuera de formula es un dolar de texto', () => {
    expect(splitMath('cuesta \\$5 hoy')).toEqual([{ kind: 'text', value: 'cuesta $5 hoy' }]);
  });
  it('un $ suelto sin pareja se queda como texto, y los vacios no abren formula', () => {
    expect(kinds('solo un $ aqui')).toBe('text:solo un $ aqui');
    expect(kinds('precio $')).toBe('text:precio $');
    expect(kinds('vacio $$ y $ $')).toBe('text:vacio $$ y $ $');
    expect(kinds('')).toBe('');
    expect(kinds('a $$   $$ b')).toBe('text:a $$   $$ b'); // un bloque solo con espacios no es formula
    expect(kinds('vale $ a$ fin')).toBe('text:vale $ a$ fin'); // el $ que abre no puede ir seguido de un espacio
  });
  it('el cierre no puede ir pegado a un digito: «$x$2» no cierra, «$x$ 2» si', () => {
    expect(kinds('vale $x$2 y')).toBe('text:vale $x$2 y');
    expect(kinds('vale $x$ 2 y')).toBe('text:vale  | inline:x | text: 2 y');
  });
  it('repara LaTeX corrupto antes de separar', () => {
    expect(kinds(`derivada $${FF}rac{dU}{dx}$`)).toBe('text:derivada  | inline:\\frac{dU}{dx}');
  });
  it('conserva el texto exacto (sin perder caracteres) en una frase mezclada', () => {
    const s = 'a $x$ b $$y$$ c $100 d';
    const back = splitMath(s).map((x) => (x.kind === 'inline' ? `$${x.value}$` : x.kind === 'block' ? `$$${x.value}$$` : x.value)).join('');
    expect(back).toBe(s);
  });
});

describe('dentro de la formula: casillas en blanco y comandos con salto de linea', () => {
  it('«= ___» (completar) ya no rompe la formula: guiones bajos escapados', () => {
    expect(splitMath('El Índice de Lerner se define como $L = (P - CMg)/P = ___$')[1]).toEqual({ kind: 'inline', value: 'L = (P - CMg)/P = \\_\\_\\_' });
    expect(splitMath('derivada $x = ____$ fin')[1]).toEqual({ kind: 'inline', value: 'x = \\_\\_\\_\\_' });
  });
  it('un % sin escapar (comentario para KaTeX) se escapa; uno ya escapado no se duplica', () => {
    expect(splitMath('la elasticidad $\\frac{%\\Delta Q}{%\\Delta I}$ mide')[1]).toEqual({ kind: 'inline', value: '\\frac{\\%\\Delta Q}{\\%\\Delta I}' });
    expect(splitMath('sube un $5\\%$')[1]).toEqual({ kind: 'inline', value: '5\\%' });
    expect(splitMath('texto con 50% fuera')).toEqual([{ kind: 'text', value: 'texto con 50% fuera' }]);
  });
  it('un subindice normal NO se toca (un solo guion bajo), ni uno ya escapado', () => {
    expect(splitMath('$p_x x + p_y y$')[0]).toEqual({ kind: 'inline', value: 'p_x x + p_y y' });
    expect(splitMath('$a\\_\\_b$')[0]).toEqual({ kind: 'inline', value: 'a\\_\\_b' });
  });
  it('un \\neq / \\nabla cuyo «\\n» quedo como salto de linea real se repara SOLO dentro de la formula', () => {
    expect(splitMath('si $x \neq y$ entonces')[1]).toEqual({ kind: 'inline', value: 'x \\neq y' });
    expect(splitMath('$\nabla f$')[0]).toEqual({ kind: 'inline', value: '\\nabla f' });
    // un salto de linea normal (antes de una palabra cualquiera) no se toca, dentro ni fuera de la formula
    expect(splitMath('linea uno\ndos')).toEqual([{ kind: 'text', value: 'linea uno\ndos' }]);
    expect(splitMath('linea\nabla de cosas')).toEqual([{ kind: 'text', value: 'linea\\nabla de cosas' }]); // limite conocido: «\nabla» al empezar linea se toma por el comando
    expect(splitMath('$a\nb$')[0]).toEqual({ kind: 'inline', value: 'a\nb' });
  });
});

describe('MathText y pantallas de examen usan esas reglas', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  it('MathText delega en splitMath y repara el texto sin formulas tambien', () => {
    const m = read('src/components/MathText.tsx');
    expect(m).toContain("import { repairLatexControlChars, splitMath } from '@/lib/lesson/latex';");
    expect(m).toContain('splitMath(content)');
    expect(m).toContain('repairLatexControlChars(content)');
    expect(m).not.toContain('content.split(/');
  });
  it('el examen del estudiante dibuja enunciado, opciones, explicacion, cita y emparejar con MathText', () => {
    const c = read('src/app/(student)/my-classes/[id]/course/exam/[examId]/ExamClient.tsx');
    expect(c).toContain("import { MathText } from '@/components/MathText';");
    for (const frag of ['<MathText content={q.q} />', '<MathText content={o} />', '<MathText content={i.explanation} />', '<MathText content={i.question} />', '<MathText content={i.where.quote} />', '<MathText content={t} />']) expect(c, frag).toContain(frag);
  });
  it('la revision del profesor tambien', () => {
    const c = read('src/app/(teacher)/teacher/classrooms/[id]/plan/examen/ExamBankClient.tsx');
    expect(c).toContain("import { MathText } from '@/components/MathText';");
    for (const frag of ['<MathText content={i.q} />', '<MathText content={o.text} />', '<MathText content={i.exp} />', '<MathText content={i.quote} />']) expect(c, frag).toContain(frag);
  });
});
