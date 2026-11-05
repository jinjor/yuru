// 外部ツールなしで、ページ数と動作を指定できる最小の PDF をテスト用に作る。
export function makePdf(pages = 1, attackUrl?: string): Buffer {
  const annotationId = 5 + pages * 2;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${attackUrl ? " /OpenAction 4 0 R" : ""} >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    attackUrl ? `<< /S /JavaScript /JS (app.launchURL\("${attackUrl}", true\);) >>` : "<< >>",
  ];
  for (let i = 0; i < pages; i++) {
    const content = `BT /F1 24 Tf 30 100 Td (Native PDF page ${i + 1}) Tj ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + i * 2} 0 R${attackUrl ? ` /Annots [${annotationId} 0 R]` : ""} >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  if (attackUrl) {
    objects.push(
      `<< /Type /Annot /Subtype /Link /Rect [0 0 300 200] /Border [0 0 0] /A << /S /URI /URI (${attackUrl}) >> >>`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
