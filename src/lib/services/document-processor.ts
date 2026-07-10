import { db } from "@/db";
import { documents, documentChunks } from "@/db/schema";
import { parseDocument } from "@/lib/parser";
import { chunkDocument, Chunk } from "@/lib/chunker";
import { getEmbeddings } from "@/lib/llm";
import { eq, inArray } from "drizzle-orm";
import fs from "fs";

/**
 * Process an uploaded document:
 * 1. Parse (PDF/DOCX → text)
 * 2. Chunk (text → overlapping chunks)
 * 3. Embed (chunks → vectors)
 * 4. Store in database
 */
export async function processDocument(documentId: string, filePath: string) {
  // 1. Update status to parsing
  await db
    .update(documents)
    .set({ parsedStatus: "parsing" })
    .where(eq(documents.id, documentId));

  try {
    // 2. Parse document
    const parsed = await parseDocument(filePath);

    // 3. Chunk document
    const chunks = chunkDocument(parsed.text, parsed.pages, {
      chunkSize: 800,
      overlap: 100,
    });

    // 4. Get embeddings in batch (max 20 at a time)
    const BATCH_SIZE = 20;
    const allChunks: (Chunk & { embedding: number[] })[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content);
      const embeddings = await getEmbeddings(texts);
      batch.forEach((chunk, j) => {
        allChunks.push({ ...chunk, embedding: embeddings[j] });
      });
    }

    // 5. Insert chunks into database
    for (const chunk of allChunks) {
      await db.insert(documentChunks).values({
        documentId,
        content: chunk.content,
        embedding: chunk.embedding,
        page: chunk.page,
        section: chunk.section,
        metadata: JSON.stringify(chunk.metadata),
      });
    }

    // 6. Update status to ready
    await db
      .update(documents)
      .set({ parsedStatus: "ready" })
      .where(eq(documents.id, documentId));

    return { chunkCount: allChunks.length, status: "ready" };
  } catch (error) {
    console.error("Document processing failed:", error);
    await db
      .update(documents)
      .set({ parsedStatus: "error" })
      .where(eq(documents.id, documentId));
    throw error;
  }
}

/**
 * Get processing status summary for documents in a project/org.
 */
export async function getDocumentStatus(orgId: string) {
  return await db
    .select({
      id: documents.id,
      name: documents.name,
      type: documents.type,
      parsedStatus: documents.parsedStatus,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.orgId, orgId))
    .orderBy(documents.createdAt);
}
