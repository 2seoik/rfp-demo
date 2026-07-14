const { Pool } = require("pg");
const fs = require("fs");
const pool = new Pool({ connectionString: "postgres://rfpuser:rfppass@localhost:5432/rfp-demo" });

function extractOverviewSection(fullText: string): string {
  const HEADING_RE = /사\s*업\s*개\s*요/g;
  const coverPart = fullText.slice(0, Math.min(500, fullText.length));

  function lineAt(text: string, pos: number): string {
    const nl = text.indexOf("\n", pos);
    return nl >= 0 ? text.slice(pos, nl) : text.slice(pos, pos + 200);
  }
  function isTocLine(line: string): boolean {
    return (line.match(/[·.]/g) || []).length >= 4 && /\d{1,4}\s*$/.test(line);
  }

  let match;
  HEADING_RE.lastIndex = 0;
  while ((match = HEADING_RE.exec(fullText)) !== null) {
    const line = lineAt(fullText, match.index);
    if (!isTocLine(line)) {
      const idx = match.index;
      const nextHeading = fullText.slice(idx + 10).search(/\n\s*[ⅡⅢⅣ]\./);
      const end = nextHeading > 0 ? idx + 10 + nextHeading : idx + 6000;
      return coverPart + "\n---SECTION---\n" + fullText.slice(idx, Math.min(end, idx + 6000));
    }
  }
  const altRe = /사\s*업\s*(?:개요|명|목적|배경|내용|기간|예산|범위)/g;
  altRe.lastIndex = Math.floor(fullText.length * 0.03);
  const altMatch = altRe.exec(fullText);
  if (altMatch) {
    return coverPart + "\n---SECTION---\n" + fullText.slice(Math.max(0, altMatch.index - 150), Math.min(fullText.length, altMatch.index + 4000));
  }
  const start = Math.floor(fullText.length * 0.1);
  return coverPart + "\n---SECTION---\n" + fullText.slice(start, start + 3000);
}

async function backfill() {
  const client = await pool.connect();
  try {
    const docs = await client.query("SELECT id, name, file_url FROM documents WHERE type = 'rfp'");
    let updated = 0;
    for (const d of docs.rows) {
      try {
        const { PDFParse } = require("pdf-parse");
        const parser = new PDFParse({ data: fs.readFileSync(d.file_url) });
        const result = await parser.getText();
        await parser.destroy();
        const header = extractOverviewSection(result.text);
        if (header.length > 10) {
          await client.query("UPDATE documents SET header_text = $1 WHERE id = $2", [header, d.id]);
          console.log("OK   " + d.name + " (" + header.length + " chars)");
          updated++;
        }
      } catch (e: any) {
        console.log("ERR  " + d.name + ": " + e.message.slice(0, 60));
      }
    }
    console.log("\nBackfill complete: " + updated + " documents updated");
  } finally {
    client.release();
    pool.end();
  }
}
backfill().catch((e) => { console.error(e); process.exit(1); });
