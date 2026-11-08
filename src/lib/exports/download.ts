import { directionsLink, exportDocumentSchema, mapLink, noticeLabels, type ExportDocument } from "./validation";
import { imagePdf, type PdfPage } from "./pdf";

export async function downloadItineraryPdf(input: ExportDocument) {
  const documentData = exportDocumentSchema.parse(input);
  await document.fonts.ready;
  const canvas = document.createElement("canvas"); canvas.width = 1190; canvas.height = 1684;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PDF rendering is unavailable. Use the print option.");
  const pages: PdfPage[] = [];
  let links: PdfPage["links"] = [], y = 60;
  function start() {
    context!.setTransform(2, 0, 0, 2, 0, 0);
    context!.fillStyle = "#ffffff"; context!.fillRect(0, 0, 595, 842);
    context!.fillStyle = "#ed8d46"; context!.fillRect(0, 0, 595, 10);
    context!.fillStyle = "#7a7169"; context!.font = "10px Arial, sans-serif";
    context!.fillText("NOMVIRAAI  /  TRAVEL PLAN", 42, 35);
    y = 60; links = [];
  }
  function finish() {
    context!.fillStyle = "#7a7169"; context!.font = "9px Arial, sans-serif";
    context!.fillText(`Saved ${documentData.exportedAt.slice(0, 10)} · Page ${pages.length + 1}`, 42, 815);
    const raw = atob(canvas.toDataURL("image/jpeg", 0.94).split(",")[1]);
    pages.push({ jpeg: Uint8Array.from(raw, c => c.charCodeAt(0)), links });
    if (pages.length > 50) throw new Error("This document is too large. Use the print option.");
  }
  function text(value: string, size = 11, bold = false, url?: string) {
    context!.font = `${bold ? "bold " : ""}${size}px Arial, sans-serif`;
    const lines: string[] = [];
    // Wrap by code point so long Unicode place names do not overflow the page.
    let line = "";
    for (const character of value.replace(/[\u0000-\u001f\u007f]/g, " ")) {
      if (context!.measureText(line + character).width > 510 && line) { lines.push(line); line = ""; }
      line += character;
    }
    if (line) lines.push(line);
    for (const current of lines) {
      if (y + size + 8 > 790) { finish(); start(); context!.font = `${bold ? "bold " : ""}${size}px Arial, sans-serif`; }
      context!.fillStyle = url ? "#9a4b16" : "#28231f";
      context!.fillText(current, 42, y + size);
      if (url) links.push({ url, x: 42, y, width: Math.min(510, context!.measureText(current).width), height: size + 5 });
      y += size + 6;
    }
    y += 5;
  }
  start();
  text(documentData.destination, 24, true);
  text(`${documentData.startDate} — ${documentData.endDate}`, 12);
  documentData.notices.forEach(n => text(noticeLabels[n], 10));
  if (!documentData.days.length) text("No saved itinerary is available.");
  for (const day of documentData.days) {
    text(`Day ${day.dayNumber} · ${day.date} · ${day.theme}`, 16, true);
    if (!day.items.length) text("No shared activities for this day.");
    day.items.forEach(item => {
      text(`${item.period.toUpperCase()}  ${item.title}`, 12, true);
      const link = mapLink(item); if (link) text("View location on OpenStreetMap", 10, false, link);
    });
    const directions = directionsLink(day);
    if (directions) text("Directions between first and last mapped stop", 10, false, directions);
    y += 10;
  }
  text("Selected hotel", 16, true);
  text(documentData.hotel ? documentData.hotel.name ?? "A stay is selected; current details are unavailable." : "No hotel included.");
  const hotelMap = documentData.hotel && mapLink(documentData.hotel);
  if (hotelMap) text("View hotel location", 10, false, hotelMap);
  text("Saved food spots", 16, true);
  if (!documentData.food.length) text("No saved food spots included.");
  documentData.food.forEach(food => text(`${food.name} · ${food.category.replaceAll("_", " ")}`));
  if (documentData.food.length === 50) text("This document includes the 50 most recently saved food spots.", 10);
  text("Budget", 16, true);
  if (documentData.budget) {
    const b = documentData.budget;
    text(`Trip budget: ${b.currency} ${b.total}`);
    for (const [label, amount] of [["Planned", b.planned], ["Actual", b.actual], ["Remaining after committed costs", b.remaining]]) text(`${label}: ${amount === null ? "Unavailable" : `${b.currency} ${amount}`}`);
    text("Unknown meal, attraction and other costs are excluded. Quotes can expire; this is not a booking or a final cost.", 10);
  } else text("Budget is not included.");
  text("Map links open third-party maps. Times are day periods, not verified opening hours or route durations.", 10);
  text("Place facts: © OpenStreetMap contributors (ODbL). Food: Geoapify / Google Maps. Hotel references: StayAPI.", 9);
  finish();
  const pdf = imagePdf(pages);
  const url = URL.createObjectURL(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `nomvira-itinerary-${documentData.startDate}.pdf`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
