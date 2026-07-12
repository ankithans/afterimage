import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const taskStatus = v.union(
  v.literal("blocked"),
  v.literal("ready"),
  v.literal("working"),
  v.literal("awaiting_input"),
  v.literal("completed"),
  v.literal("failed"),
);

export default defineSchema({
  productions: defineTable({
    title: v.string(),
    intent: v.optional(v.string()),
    videoDurationSeconds: v.optional(v.union(v.literal(5), v.literal(10), v.literal(15))),
    status: v.union(
      v.literal("draft"),
      v.literal("queued"),
      v.literal("working"),
      v.literal("awaiting_input"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    activeTaskKey: v.optional(v.string()),
    sourceAudioAssetId: v.optional(v.id("assets")),
    lyrics: v.optional(v.string()),
    selectedTreatmentId: v.optional(v.string()),
    masterAssetId: v.optional(v.id("assets")),
    activeVersion: v.optional(v.number()),
    revisionCount: v.optional(v.number()),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    lastHeartbeatAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status"]),

  assets: defineTable({
    productionId: v.id("productions"),
    storageId: v.id("_storage"),
    kind: v.union(
      v.literal("source_audio"),
      v.literal("artwork"),
      v.literal("reference"),
      v.literal("generated_clip"),
      v.literal("generated_image"),
      v.literal("overlay"),
      v.literal("master"),
    ),
    filename: v.string(),
    contentType: v.string(),
    byteSize: v.number(),
    createdAt: v.number(),
  }).index("by_production", ["productionId", "createdAt"]),

  tasks: defineTable({
    productionId: v.id("productions"),
    key: v.string(),
    title: v.string(),
    role: v.string(),
    skill: v.string(),
    status: taskStatus,
    order: v.number(),
    summary: v.optional(v.string()),
    artifactRef: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_production", ["productionId", "order"])
    .index("by_production_key", ["productionId", "key"]),

  messages: defineTable({
    productionId: v.id("productions"),
    taskKey: v.optional(v.string()),
    author: v.union(v.literal("artist"), v.literal("hermes"), v.literal("system")),
    kind: v.union(v.literal("message"), v.literal("nudge"), v.literal("task_update")),
    text: v.string(),
    status: v.union(v.literal("pending"), v.literal("applied"), v.literal("acknowledged")),
    createdAt: v.number(),
    appliedAt: v.optional(v.number()),
  }).index("by_production", ["productionId", "createdAt"]),

  transcriptChunks: defineTable({
    productionId: v.id("productions"),
    taskKey: v.string(),
    runId: v.string(),
    sequence: v.number(),
    kind: v.union(v.literal("output"), v.literal("status"), v.literal("error")),
    text: v.string(),
    createdAt: v.number(),
  })
    .index("by_production", ["productionId", "createdAt"])
    .index("by_production_task", ["productionId", "taskKey", "createdAt"]),

  events: defineTable({
    productionId: v.id("productions"),
    taskKey: v.optional(v.string()),
    type: v.string(),
    summary: v.string(),
    createdAt: v.number(),
  }).index("by_production", ["productionId", "createdAt"]),

  artifacts: defineTable({
    productionId: v.id("productions"),
    taskKey: v.string(),
    kind: v.string(),
    version: v.number(),
    payload: v.any(),
    createdAt: v.number(),
  }).index("by_production", ["productionId", "createdAt"]),

  approvals: defineTable({
    productionId: v.id("productions"),
    taskKey: v.string(),
    kind: v.union(v.literal("excerpt"), v.literal("treatment"), v.literal("master")),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("superseded")),
    options: v.array(v.object({
      id: v.string(),
      label: v.string(),
      description: v.optional(v.string()),
      previewUrl: v.optional(v.string()),
    })),
    selectionId: v.optional(v.string()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  }).index("by_production", ["productionId", "createdAt"]),

  versions: defineTable({
    productionId: v.id("productions"),
    number: v.number(),
    masterAssetId: v.id("assets"),
    feedback: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_production", ["productionId", "number"]),

  attempts: defineTable({
    productionId: v.id("productions"),
    taskKey: v.string(),
    provider: v.string(),
    status: v.union(v.literal("started"), v.literal("completed"), v.literal("failed")),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_production", ["productionId", "startedAt"]),
});
