import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { slicePdf } from './pdfSlice';

// Un PDF real con N paginas, cada una con un tamaño distinto para reconocerla despues del recorte.
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) doc.addPage([100 + i, 200]);
  return doc.save();
}

describe('slicePdf', () => {
  it('devuelve un PDF solo con las paginas pedidas, en el orden pedido', async () => {
    const out = await PDFDocument.load(await slicePdf(await makePdf(10), [2, 5, 9]));
    expect(out.getPageCount()).toBe(3);
    expect(out.getPages().map((p) => p.getWidth())).toEqual([102, 105, 109]);
  });

  it('un recorte de una sola pagina', async () => {
    const out = await PDFDocument.load(await slicePdf(await makePdf(4), [4]));
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getWidth()).toBe(104);
  });

  it('no modifica el PDF original', async () => {
    const src = await makePdf(3);
    const before = src.length;
    await slicePdf(src, [1]);
    expect(src.length).toBe(before);
    expect((await PDFDocument.load(src)).getPageCount()).toBe(3);
  });

  it('una pagina que no existe es un error (el orquestador lo usa para caer al PDF completo)', async () => {
    await expect(slicePdf(await makePdf(2), [7])).rejects.toThrow();
  });

  it('un archivo que no es PDF es un error', async () => {
    await expect(slicePdf(new Uint8Array([1, 2, 3, 4]), [1])).rejects.toThrow();
  });
});
