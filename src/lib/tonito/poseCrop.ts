// Las poses de Toñito son de CUERPO ENTERO (512x512, pies cerca del 95 % de la altura). En los lugares donde se muestra pequeño (avatar del chat de 42 px,
// widget de 72 px, pantallas de estado de ~100 px) el cuerpo entero dejaria la cara de ~15 px. Ahi se recorta al BUSTO con CSS, sobre la misma imagen
// (sin archivos aparte): se ve la cabeza con el casco, el moño y el pecho, como los PNG viejos de solo cabeza pero con el diseño nuevo.
//
// Region del cuadro que se muestra: x del 25 % al 77 % y y del 3,5 % al 55,5 % (52 % de lado; la cabeza queda centrada en x ~51 %).

export const POSE_DIR = '/tonito/poses';
export const POSE_EXT = 'webp';

// Hasta este tamaño (px) se muestra el busto; por encima, el cuerpo entero (cinematicas y pantallas grandes).
export const BUSTO_MAX_SIZE = 120;

const BUSTO_SIDE = 0.52; // lado de la region, como fraccion del cuadro
const BUSTO_LEFT = 0.25;
const BUSTO_TOP = 0.035;

export const poseSrc = (mood: string) => `${POSE_DIR}/${mood}.${POSE_EXT}`;

export const usesBusto = (size: number) => size <= BUSTO_MAX_SIZE;

// Estilo de la imagen para mostrar solo el busto dentro de un cuadro de size x size con overflow oculto.
export function bustoImgStyle(size: number) {
  const zoom = 1 / BUSTO_SIDE;
  return {
    position: 'absolute' as const,
    width: size * zoom,
    height: size * zoom,
    maxWidth: 'none',
    left: -size * zoom * BUSTO_LEFT,
    top: -size * zoom * BUSTO_TOP,
  };
}
