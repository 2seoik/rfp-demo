import fs from "fs";
import path from "path";

export type ParsedDocument = {
  text: string;
  pages: { pageNumber: number; text: string }[];
  metadata: Record<string, string>;
};

/**
 * Parse a PDF file and extract text content.
 */
async function parsePDF(filePath: string): Promise<ParsedDocument> {
  const pdfParse = (await import("pdf-parse")).default;
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);

  // Split by page (pdf-parse returns pages joined by form feed chars)
  const pageTexts = data.text.split("\f").filter(Boolean);

  return {
    text: data.text,
    pages: pageTexts.map((text, i) => ({
      pageNumber: i + 1,
      text: text.trim(),
    })),
    metadata: {
      pageCount: String(data.numpages ?? pageTexts.length),
      ...(data.info ? Object.fromEntries(
        Object.entries(data.info).map(([k, v]) => [k, String(v ?? "")])
      ) : {}),
    },
  };
}

/**
 * Parse a DOCX file and extract text content.
 */
async function parseDOCX(filePath: string): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  const dataBuffer = fs.readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer: dataBuffer });

  const text = result.value;
  // DOCX doesn't have natural page breaks, estimate ~3000 chars per page
  const PAGE_ESTIMATE = 3000;
  const pageTexts: string[] = [];
  for (let i = 0; i < text.length; i += PAGE_ESTIMATE) {
    pageTexts.push(text.slice(i, i + PAGE_ESTIMATE));
  }

  return {
    text,
    pages: pageTexts.map((t, i) => ({
      pageNumber: i + 1,
      text: t.trim(),
    })),
    metadata: {
      pageCount: String(pageTexts.length),
      ...(result.messages.length > 0
        ? { warnings: result.messages.map((m: any) => m.message).join("; ") }
        : {}),
    },
  };
}

/**
 * Parse a document file (PDF or DOCX) and extract text content.
 */
export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".pdf":
      return parsePDF(filePath);
    case ".docx":
      return parseDOCX(filePath);
    default:
      throw new Error(`Unsupported file format: ${ext}. Only PDF and DOCX are supported.`);
  }
}
