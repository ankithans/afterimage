import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";

const LEASE_MS = 45_000;

function assertWorkerSecret(secret: string) {
  const expected = process.env.WORKER_SECRET;
  if (!expected || secret !== expected) throw new ConvexError("Invalid worker credentials");
}

export const claimNext = mutation({
  args: { workerId: v.string(), secret: v.string() },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.secret);
    const now = Date.now();
    const candidates = await ctx.db.query("productions").collect();
    const production = candidates.find(
      (item) =>
        item.status === "queued" ||
        (item.status === "working" && (item.leaseExpiresAt ?? 0) < now),
    );
    if (!production) return null;

    await ctx.db.patch(production._id, {
      status: "working",
      leaseOwner: args.workerId,
      leaseExpiresAt: now + LEASE_MS,
      lastHeartbeatAt: now,
      updatedAt: now,
    });

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_production", (q) => q.eq("productionId", production._id))
      .collect();
    const task = tasks.find((item) => item.status === "ready" || item.status === "working");
    if (!task) return null;

    if (task.status === "ready") {
      await ctx.db.patch(task._id, { status: "working", startedAt: now });
    }

    const nudges = await ctx.db
      .query("messages")
      .withIndex("by_production", (q) => q.eq("productionId", production._id))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    const sourceAudio = production.sourceAudioAssetId
      ? await ctx.db.get(production.sourceAudioAssetId)
      : null;
    const sourceAudioUrl = sourceAudio ? await ctx.storage.getUrl(sourceAudio.storageId) : null;
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_production", (q) => q.eq("productionId", production._id))
      .collect();
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_production", (q) => q.eq("productionId", production._id))
      .collect();
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_production", (q) => q.eq("productionId", production._id))
      .collect();
    const assetsWithUrls = await Promise.all(
      assets.map(async (asset) => ({ ...asset, url: await ctx.storage.getUrl(asset.storageId) })),
    );

    return {
      production: { ...production, status: "working" as const },
      task,
      nudges,
      sourceAudio,
      sourceAudioUrl,
      artifacts,
      approvals: approvals.filter((approval) => approval.status === "approved"),
      assets: assetsWithUrls,
    };
  },
});

export const heartbeat = mutation({
  args: { productionId: v.id("productions"), workerId: v.string(), secret: v.string() },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.secret);
    const production = await ctx.db.get(args.productionId);
    if (!production || production.leaseOwner !== args.workerId) {
      throw new ConvexError("Worker does not own this production");
    }
    const now = Date.now();
    await ctx.db.patch(args.productionId, {
      leaseExpiresAt: now + LEASE_MS,
      lastHeartbeatAt: now,
      updatedAt: now,
    });
  },
});

export const postTaskUpdate = mutation({
  args: {
    productionId: v.id("productions"),
    taskKey: v.string(),
    text: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.secret);
    const now = Date.now();
    await ctx.db.insert("messages", {
      productionId: args.productionId,
      taskKey: args.taskKey,
      author: "hermes",
      kind: "task_update",
      text: args.text,
      status: "acknowledged",
      createdAt: now,
    });
    await ctx.db.insert("events", {
      productionId: args.productionId,
      taskKey: args.taskKey,
      type: "task.update",
      summary: args.text,
      createdAt: now,
    });
  },
});

export const completeTask = mutation({
  args: {
    productionId: v.id("productions"),
    taskKey: v.string(),
    summary: v.string(),
    artifactRef: v.optional(v.string()),
    artifactKind: v.optional(v.string()),
    artifactPayload: v.optional(v.any()),
    masterAssetId: v.optional(v.id("assets")),
    lyrics: v.optional(v.string()),
    consumedNudgeIds: v.array(v.id("messages")),
    workerId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.secret);
    const now = Date.now();
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_production", (q) => q.eq("productionId", args.productionId))
      .collect();
    const task = tasks.find((item) => item.key === args.taskKey);
    if (!task) throw new ConvexError("Task not found");
    const production = await ctx.db.get(args.productionId);
    if (!production || production.status === "cancelled") {
      return { requeued: false, cancelled: true };
    }
    if (production.leaseOwner !== args.workerId || production.leaseExpiresAt === undefined || production.leaseExpiresAt < now) {
      throw new ConvexError("Worker lease was lost before task completion");
    }

    const pendingNudges = await ctx.db
      .query("messages")
      .withIndex("by_production", (q) => q.eq("productionId", args.productionId))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("taskKey"), args.taskKey),
        ),
      )
      .collect();
    const consumed = new Set(args.consumedNudgeIds);
    const lateNudges = pendingNudges.filter((message) => !consumed.has(message._id));

    for (const messageId of args.consumedNudgeIds) {
      await ctx.db.patch(messageId, { status: "applied", appliedAt: now });
    }

    if (lateNudges.length > 0) {
      await ctx.db.patch(task._id, { status: "ready" });
      await ctx.db.patch(args.productionId, {
        status: "queued",
        activeTaskKey: task.key,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("messages", {
        productionId: args.productionId,
        taskKey: task.key,
        author: "hermes",
        kind: "task_update",
        text: "New artist direction arrived. I’m revisiting this task before moving on.",
        status: "acknowledged",
        createdAt: now,
      });
      return { requeued: true, cancelled: false };
    }

    await ctx.db.patch(task._id, {
      status: "completed",
      summary: args.summary,
      artifactRef: args.artifactRef,
      completedAt: now,
    });
    if (args.lyrics) await ctx.db.patch(args.productionId, { lyrics: args.lyrics });
    if (args.artifactKind && args.artifactPayload !== undefined) {
      await ctx.db.insert("artifacts", {
        productionId: args.productionId,
        taskKey: args.taskKey,
        kind: args.artifactKind,
        version: (production.revisionCount ?? 0) + 1,
        payload: args.artifactPayload,
        createdAt: now,
      });
    }
    if (args.masterAssetId) {
      await ctx.db.patch(args.productionId, {
        masterAssetId: args.masterAssetId,
        activeVersion: (production.revisionCount ?? 0) + 1,
      });
    }

    const approvalKind =
      task.key === "analyze-music"
        ? "excerpt"
        : task.key === "develop-directions"
          ? "treatment"
          : task.key === "compose-master"
            ? "master"
            : null;
    if (approvalKind) {
      const payload = (args.artifactPayload ?? {}) as Record<string, unknown>;
      const rawOptions =
        approvalKind === "excerpt"
          ? payload.excerpts
          : approvalKind === "treatment"
            ? payload.directions
            : null;
      const options = Array.isArray(rawOptions)
        ? rawOptions.slice(0, approvalKind === "treatment" ? 3 : 5).map((option, index) => {
            const value = option && typeof option === "object" ? (option as Record<string, unknown>) : {};
            return {
              id: String(value.id ?? `${approvalKind}-${index + 1}`),
              label: String(value.title ?? value.label ?? `${approvalKind} ${index + 1}`),
              description: String(value.description ?? value.story ?? value.rationale ?? ""),
            };
          })
        : approvalKind === "master" && args.masterAssetId
          ? [{ id: `master-v${(production.revisionCount ?? 0) + 1}`, label: `Master version ${(production.revisionCount ?? 0) + 1}`, description: "Watch the assembled master, then approve it or request the included revision.", previewUrl: `asset:${args.masterAssetId}` }]
          : [{ id: `${approvalKind}-1`, label: `Approve ${approvalKind}`, description: args.summary.slice(0, 500) }];
      await ctx.db.insert("approvals", {
        productionId: args.productionId,
        taskKey: task.key,
        kind: approvalKind,
        status: "pending",
        options,
        createdAt: now,
      });
      await ctx.db.patch(args.productionId, {
        status: "awaiting_input",
        activeTaskKey: task.key,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("messages", {
        productionId: args.productionId,
        taskKey: args.taskKey,
        author: "hermes",
        kind: "task_update",
        text: args.summary,
        status: "acknowledged",
        createdAt: now,
      });
      return { requeued: false, cancelled: false, awaitingApproval: true };
    }

    const nextTask = tasks.find((item) => item.order === task.order + 1);
    if (nextTask) {
      await ctx.db.patch(nextTask._id, { status: "ready" });
      await ctx.db.patch(args.productionId, {
        status: "queued",
        activeTaskKey: nextTask.key,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
    } else {
      if (!production.masterAssetId && !args.masterAssetId) {
        throw new ConvexError("Cannot deliver a production without a master asset");
      }
      const masterAssetId = args.masterAssetId ?? production.masterAssetId!;
      const versionNumber = production.activeVersion ?? (production.revisionCount ?? 0) + 1;
      const existingVersion = await ctx.db
        .query("versions")
        .withIndex("by_production", (q) => q.eq("productionId", args.productionId))
        .filter((q) => q.eq(q.field("number"), versionNumber))
        .unique();
      if (!existingVersion) {
        await ctx.db.insert("versions", {
          productionId: args.productionId,
          number: versionNumber,
          masterAssetId,
          createdAt: now,
        });
      }
      await ctx.db.patch(args.productionId, {
        status: "completed",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
    }

    await ctx.db.insert("messages", {
      productionId: args.productionId,
      taskKey: args.taskKey,
      author: "hermes",
      kind: "task_update",
      text: args.summary,
      status: "acknowledged",
      createdAt: now,
    });
    return { requeued: false, cancelled: false, awaitingApproval: false };
  },
});

export const generateUploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.secret);
    return ctx.storage.generateUploadUrl();
  },
});

export const registerAsset = mutation({
  args: {
    productionId: v.id("productions"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("generated_image"), v.literal("generated_clip"), v.literal("overlay"), v.literal("master")),
    filename: v.string(),
    contentType: v.string(),
    byteSize: v.number(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    assertWorkerSecret(args.secret);
    return ctx.db.insert("assets", {
      productionId: args.productionId,
      storageId: args.storageId,
      kind: args.kind,
      filename: args.filename,
      contentType: args.contentType,
      byteSize: args.byteSize,
      createdAt: Date.now(),
    });
  },
});

export const health = query({
  args: {},
  handler: async (ctx) => ({
    queued: (await ctx.db.query("productions").withIndex("by_status", (q) => q.eq("status", "queued")).collect()).length,
    now: Date.now(),
  }),
});
