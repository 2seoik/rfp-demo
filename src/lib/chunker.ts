export type Chunk = {
  content: string;
  page: number;
  section: string;
  metadata: Record<string, string>;
};

/**
 * Split text into chunks with overlapping windows.
 * Preserves tables (converted to markdown) as separate chunks.
 */
export function chunkDocument(
  text: string,
  pages: { pageNumber: number; text: string }[],
  options: {
    chunkSize?: number;
    overlap?: number;
  } = {}
): Chunk[] {
  const { chunkSize = 800, overlap = 100 } = options;
  const chunks: Chunk[] = [];

  for (const page of pages) {
    const pageText = page.text;
    if (!pageText) continue;

    // Detect tables (lines with | or consecutive tab/comma-separated values)
    const lines = pageText.split("\n");
    let currentChunk = "";
    let inTable = false;
    let tableBuffer: string[] = [];

    for (const line of lines) {
      const isTableLine = line.includes("|") && line.replace(/\|/g, "").trim().length > 0;

      if (isTableLine) {
        inTable = true;
        tableBuffer.push(line);
        continue;
      }

      // End of table
      if (inTable) {
        const tableMarkdown = tableBuffer.join("\n");
        chunks.push({
          content: tableMarkdown,
          page: page.pageNumber,
          section: "table",
          metadata: { type: "table" },
        });
        tableBuffer = [];
        inTable = false;
      }

      // Regular text chunking
      if (currentChunk.length + line.length > chunkSize && currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          page: page.pageNumber,
          section: detectSection(line),
          metadata: {},
        });
        // Keep overlap tokens from end
        const words = currentChunk.split(/\s+/);
        const overlapWords = words.slice(-Math.floor(overlap / 5)).join(" ");
        currentChunk = overlapWords + "\n";
      }

      currentChunk += line + "\n";
    }

    // Flush remaining table buffer
    if (inTable && tableBuffer.length > 0) {
      chunks.push({
        content: tableBuffer.join("\n"),
        page: page.pageNumber,
        section: "table",
        metadata: { type: "table" },
      });
    }

    // Flush remaining text
    if (currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        page: page.pageNumber,
        section: detectSection(currentChunk),
        metadata: {},
      });
    }
  }

  return chunks;
}

function detectSection(text: string): string {
  // Try to detect section headers like "1. 개요", "가. 일반사항", "■ 보안"
  const headerMatch = text.match(
    /^(?:제\s*(\d+)\s*장\s*|(\d+(?:\.\d+)*)\s*[.．]\s*|[가-힇]\s*[.．)\s]|■\s*|▶\s*)(.+)$/m
  );
  if (headerMatch) {
    return headerMatch[headerMatch.length - 1]?.trim() ?? "general";
  }
  return "general";
}
