// Minimal image PDF container. Browser canvas supplies Unicode text and font fallback;
// the print view remains selectable, accessible HTML. No provider calls or PDF service.
export type PdfPage = { jpeg: Uint8Array; links: { url: string; x: number; y: number; width: number; height: number }[] };
const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
function join(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export function imagePdf(pages: PdfPage[]): Uint8Array {
  if (!pages.length || pages.length > 50) throw new Error("PDF page limit exceeded");
  const objects: Uint8Array[] = [bytes("<< /Type /Catalog /Pages 2 0 R /Lang (en) >>"), bytes("")];
  const pageIds: number[] = [];
  for (const page of pages) {
    if (!page.jpeg.length || page.jpeg.length > 5_000_000) throw new Error("Invalid PDF page");
    const imageId = objects.push(join([bytes(`<< /Type /XObject /Subtype /Image /Width 1190 /Height 1684 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`), page.jpeg, bytes("\nendstream")]));
    const commands = "q 595 0 0 842 0 0 cm /Image Do Q";
    const streamId = objects.push(bytes(`<< /Length ${bytes(commands).length} >>\nstream\n${commands}\nendstream`));
    const annotations = page.links.map(link => {
      const url = new URL(link.url);
      if (url.protocol !== "https:" || !["www.openstreetmap.org", "www.google.com"].includes(url.hostname)) throw new Error("Invalid PDF link");
      const escaped = url.href.replace(/[\\()]/g, v => `\\${v}`);
      return `${objects.push(bytes(`<< /Type /Annot /Subtype /Link /Rect [${link.x} ${842 - link.y - link.height} ${link.x + link.width} ${842 - link.y}] /Border [0 0 0] /A << /S /URI /URI (${escaped}) >> >>`))} 0 R`;
    });
    pageIds.push(objects.push(bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Image ${imageId} 0 R >> >> /Contents ${streamId} 0 R /Annots [${annotations.join(" ")}] >>`)));
  }
  objects[1] = bytes(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] >>`);
  const chunks = [bytes("%PDF-1.4\n%NomviraAI\n")], offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = join([bytes(`${index + 1} 0 obj\n`), object, bytes("\nendobj\n")]);
    chunks.push(chunk); offset += chunk.length;
  });
  chunks.push(bytes(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return join(chunks);
}
