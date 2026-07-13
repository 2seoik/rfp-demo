import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core/columns/vector_extension/vector";
import { relations } from "drizzle-orm";

// ─── Organization ───────────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── User ────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").notNull().default("member"), // 'owner' | 'member'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Project ─────────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  period: text("period"), // 사업기간 (예: 착수일로부터 6개월)
  dueDate: timestamp("due_date"),
  status: text("status").notNull().default("draft"), // 'draft' | 'analyzing' | 'review' | 'final'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Document ────────────────────────────────────────────────
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  projectId: uuid("project_id").references(() => projects.id),
  type: text("type").notNull().default("rfp"), // 'rfp' | 'knowledge'
  name: text("name").notNull(),
  fileUrl: text("file_url").notNull(),
  parsedStatus: text("parsed_status").notNull().default("pending"), // 'pending' | 'parsing' | 'ready' | 'error'
  headerText: text("header_text"), // 문서 앞부분 2,000자 — 사업개요/목표/목적 (유사 RFP 문서수준 비교용)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Document Chunk (with vector embedding) ──────────────────
export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }), // 1536(OpenAI) / 1024(bge-m3) — ALTER 필요 시 변경
    page: integer("page"),
    section: text("section"),
    metadata: text("metadata"), // JSON string for flexible metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("chunk_document_idx").on(table.documentId),
  ]
);

// ─── Requirement ────────────────────────────────────────────
export const requirements = pgTable("requirements", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  originalId: text("original_id"), // RFP 원문의 고유번호 (ECR-001, SFR-005 등)
  name: text("name"), // RFP 원문의 요구사항 명칭 (예: 시스템 아키텍처 설계)
  sourceText: text("source_text").notNull(),
  type: text("type").notNull().default("general"), // 'general' | 'qualification' | 'security' | 'operation' | 'format'
  priority: text("priority").notNull().default("essential"), // 'essential' | 'recommended' | 'optional'
  status: text("status").notNull().default("pending"), // 'pending' | 'in_progress' | 'answered' | 'confirmed'
  assignee: text("assignee"), // user id (2단계)
  order: integer("order"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Response ───────────────────────────────────────────────
export const responses = pgTable("responses", {
  id: uuid("id").defaultRandom().primaryKey(),
  requirementId: uuid("requirement_id")
    .notNull()
    .references(() => requirements.id),
  draftText: text("draft_text"),
  confidenceLabel: text("confidence_label").notNull().default("insufficient"), // 'sufficient' | 'partial' | 'needs_review' | 'insufficient'
  finalText: text("final_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Citation ───────────────────────────────────────────────
export const citations = pgTable("citations", {
  id: uuid("id").defaultRandom().primaryKey(),
  responseId: uuid("response_id")
    .notNull()
    .references(() => responses.id),
  chunkId: uuid("chunk_id")
    .notNull()
    .references(() => documentChunks.id),
  score: integer("score"), // 유사도 점수 (0-100)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Audit Log ──────────────────────────────────────────────
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(), // 'upload' | 'download' | 'delete' | 'analyze' | 'export'
  target: text("target").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Job Queue (Worker Pattern) ────────────────────────────
export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(), // 'rfp_analyze' | 'embedding' | ...
  status: text("status").notNull().default("pending"), // pending | processing | completed | failed
  projectId: uuid("project_id").references(() => projects.id),
  documentId: uuid("document_id").references(() => documents.id),
  progress: integer("progress").default(0),
  message: text("message"),
  error: text("error"),
  result: text("result"), // JSON string
  retryCount: integer("retry_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Relations ──────────────────────────────────────────────
export const organizationRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  projects: many(projects),
  documents: many(documents),
  auditLogs: many(auditLogs),
}));

export const userRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.orgId],
    references: [organizations.id],
  }),
  auditLogs: many(auditLogs),
}));

export const projectRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.orgId],
    references: [organizations.id],
  }),
  documents: many(documents),
  requirements: many(requirements),
}));

export const documentRelations = relations(documents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [documents.orgId],
    references: [organizations.id],
  }),
  project: one(projects, {
    fields: [documents.projectId],
    references: [projects.id],
  }),
  chunks: many(documentChunks),
}));

export const chunkRelations = relations(documentChunks, ({ one, many }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
  citations: many(citations),
}));

export const requirementRelations = relations(requirements, ({ one, many }) => ({
  project: one(projects, {
    fields: [requirements.projectId],
    references: [projects.id],
  }),
  responses: many(responses),
}));

export const responseRelations = relations(responses, ({ one, many }) => ({
  requirement: one(requirements, {
    fields: [responses.requirementId],
    references: [requirements.id],
  }),
  citations: many(citations),
}));

export const citationRelations = relations(citations, ({ one }) => ({
  response: one(responses, {
    fields: [citations.responseId],
    references: [responses.id],
  }),
  chunk: one(documentChunks, {
    fields: [citations.chunkId],
    references: [documentChunks.id],
  }),
}));
