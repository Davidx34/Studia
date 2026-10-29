// Sustituto de next/font/google para las pruebas (vitest.config.ts lo pone como alias). Las funciones de esa libreria solo existen dentro del compilador de Next: fuera de
// el, importarlas y llamarlas falla ("Baloo_2 is not a function"), y cualquier prueba que renderice un componente que declare una fuente web se rompia (paso en el CI).
// Aqui devuelven lo mismo que daria Next: una clase que define la variable CSS de la fuente.

const font = (name: string) => () => ({ variable: `font-${name}`, className: `font-${name}`, style: { fontFamily: name } });

export const Inter = font('inter');
export const Baloo_2 = font('baloo');
export const Playfair_Display = font('playfair');
