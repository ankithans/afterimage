import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

const taskDefinitions = [
  ["analyze-music", "Map the song’s visual and emotional arc", "Music Analyst", "music-analysis"],
  ["develop-directions", "Develop three distinct creative directions", "Creative Director", "creative-direction"],
  ["produce-shots", "Produce the approved direction", "Video Producer", "video-production"],
  ["compose-master", "Compose motion, picture, and sound", "Motion Editor", "motion-composition"],
  ["quality-check", "Inspect and release the delivery master", "QA Director", "delivery-qa"],
] as const;

export const create = mutation({
  args: {
    title: v.string(),
    intent: v.optional(v.string()),
    videoDurationSeconds: v.optional(v.union(v.literal(5), v.literal(10), v.literal(15))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const productionId = await ctx.db.insert("productions", {
      title: args.title.trim() || "Untitled production",
      intent: args.intent?.trim(),
      videoDurationSeconds: args.videoDurationSeconds ?? 5,
      status: "draft",
      activeTaskKey: taskDefinitions[0][0],
      createdAt: now,
      updatedAt: now,
      revisionCount: 0,
    });

    for (const [order, [key, title, role, skill]] of taskDefinitions.entries()) {
      await ctx.db.insert("tasks", {
        productionId,
        key,
        title,
        role,
        skill,
        order,
        status: order === 0 ? "ready" : "blocked",
      });
    }

    await ctx.db.insert("events", {
      productionId,
      type: "production.created",
      summary: "AfterImage prepared the production plan.",
      createdAt: now,
    });

    return productionId;
  },
});

export const get = query({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    const production = await ctx.db.get(args.productionId);
    if (!production) return null;

    const [tasks, messages, transcriptChunks, events, artifacts, approvals, versions, assets] = await Promise.all([
      ctx.db.query("tasks").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect(),
      ctx.db.query("messages").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect(),
      ctx.db.query("transcriptChunks").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect(),
      ctx.db.query("events").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect(),
      ctx.db.query("artifacts").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect(),
      ctx.db.query("approvals").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect(),
      ctx.db.query("versions").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect(),
      ctx.db.query("assets").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect(),
    ]);

    const sourceAudio = production.sourceAudioAssetId
      ? await ctx.db.get(production.sourceAudioAssetId)
      : null;
    const sourceAudioUrl = sourceAudio ? await ctx.storage.getUrl(sourceAudio.storageId) : null;
    const assetsWithUrls = await Promise.all(
      assets.map(async (asset) => ({ ...asset, url: await ctx.storage.getUrl(asset.storageId) })),
    );
    const approvalsWithPreview = approvals.map((approval) => ({
      ...approval,
      options: approval.options.map((option) => {
        if (!option.previewUrl?.startsWith("asset:")) return option;
        const assetId = option.previewUrl.slice("asset:".length);
        const asset = assetsWithUrls.find((item) => item._id === assetId);
        return { ...option, previewUrl: asset?.url ?? undefined };
      }),
    }));
    return { production, tasks, messages, transcriptChunks, events, sourceAudio, sourceAudioUrl, artifacts, approvals: approvalsWithPreview, versions, assets: assetsWithUrls };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query("productions").order("desc").take(20),
});

export const rename = mutation({
  args: { productionId: v.id("productions"), title: v.string() },
  handler: async (ctx, args) => {
    const production = await ctx.db.get(args.productionId);
    if (!production) throw new Error("Production not found");
    const title = args.title.trim();
    if (!title) throw new Error("Production name cannot be empty");
    await ctx.db.patch(args.productionId, { title, updatedAt: Date.now() });
  },
});

export const cancel = mutation({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    const production = await ctx.db.get(args.productionId);
    if (!production) return;
    if (production.status === "completed" || production.status === "cancelled") return;
    const now = Date.now();
    await ctx.db.patch(args.productionId, {
      status: "cancelled",
      leaseExpiresAt: 0,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      productionId: args.productionId,
      taskKey: production.activeTaskKey,
      type: "production.cancelled",
      summary: "The production was stopped.",
      createdAt: now,
    });
  },
});
