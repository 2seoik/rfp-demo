/** Clean PDF-extracted text */
export function cleanText(text: string): string {
  return text
    .replace(/\t/g, " ")
    .replace(/[ ]+/g, " ")
    .replace(/ ·+/g, "")
    .replace(/^[ ]+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/-- \d+ of \d+ --/g, "")
    .trim();
}

/** Parse LLM response to extract requirement objects, handling various formats */
export function parseRequirements(content: string): any[] {
  const reqs: any[] = [];

  // Try full JSON parse
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed) ? parsed : parsed.requirements || [];
    if (Array.isArray(arr)) return arr;
  } catch {}

  // Try to find JSON array in text (including markdown code blocks)
  const arrayMatch = content.match(/(?:```(?:json)?\s*)?(\[[\s\S]*?\])/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Try to extract individual JSON objects from truncated response
  const objRegex = /\{[^{}]*"id"\s*:\s*"[^"]*"[^{}]*\}/g;
  let match;
  while ((match = objRegex.exec(content)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.id) reqs.push(obj);
    } catch {}
  }

  return reqs;
}

/** Normalize requirement format (handle details array format, etc.) */
export function normalizeReqs(raw: any[]): any[] {
  const result: any[] = [];
  let counter = 0;

  for (const item of raw) {
    // Format 1: Has details array (category+details format from some models)
    if (item.details && Array.isArray(item.details)) {
      for (const detail of item.details) {
        counter++;
        result.push({
          id: `REQ-${String(counter).padStart(3, "0")}`,
          sourceText: typeof detail === "string" ? detail : JSON.stringify(detail),
          name: item.name || item.category || "",
          type: item.type || "technical",
          priority: item.priority || "essential",
        });
      }
    }
    // Format 2: Simple sourceText format
    else if (item.sourceText) {
      counter++;
      result.push({
        id: item.id || `REQ-${String(counter).padStart(3, "0")}`,
        sourceText: item.sourceText,
        name: item.name || "",
        type: item.type || "technical",
        priority: item.priority || "essential",
      });
    }
  }

  return result;
}
