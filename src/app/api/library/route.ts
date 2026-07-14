import { db } from "drizzle";
import { documents, documentChunks } from "drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const rows = await db
      .select({
        id: documents.id,
        name: documents.name,
        type: documents.type,
        parsedStatus: documents.parsedStatus,
        createdAt: documents.createdAt,
        chunkCount: sql<number>`COUNT(${documentChunks.id})::int`,
      })
      .from(documents)
      .leftJoin(documentChunks, eq(documentChunks.documentId, documents.id))
      .groupBy(documents.id)
      .orderBy(documents.createdAt);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Failed to fetch library:", error);
    return NextResponse.json([], { status: 500 });
  }
}
