// Extrae paginas de un PDF en un PDF nuevo, para enviar al modelo con vision SOLO las paginas que lo
// necesitan. Antes cada tanda reenviaba el PDF completo: 47 paginas costaron 61.839 tokens de entrada,
// unas 5 veces el tamaño real del documento.

export async function slicePdf(bytes: Uint8Array, pageNumbers: number[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indices = pageNumbers.map((n) => n - 1);
  const copied = await out.copyPages(source, indices);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}
