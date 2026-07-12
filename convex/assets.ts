import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";

const assetKind = v.union(
  v.literal("source_audio"),
  v.literal("artwork"),
  v.literal("reference"),
  v.literal("generated_clip"),
  v.literal("generated_image"),
  v.literal("overlay"),
  v.literal("master"),
);

export const generateUploadUrl = mutation({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.productionId))) throw new ConvexError("Production not found");
    return ctx.storage.generateUploadUrl();
  },
});

export const register = mutation({
  args: {
    productionId: v.id("productions"),
    storageId: v.id("_storage"),
    kind: assetKind,
    filename: v.string(),
    contentType: v.string(),
    byteSize: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.productionId))) throw new ConvexError("Production not found");
    if (args.byteSize <= 0) throw new ConvexError("Uploaded asset is empty");
    const now = Date.now();
    const assetId = await ctx.db.insert("assets", { ...args, createdAt: now });
    if (args.kind === "source_audio") {
      const production = await ctx.db.get(args.productionId);
      if (!production || production.status !== "draft") {
        throw new ConvexError("Source audio can only be attached to a draft production");
      }
      await ctx.db.patch(args.productionId, {
        sourceAudioAssetId: assetId,
        status: "queued",
        updatedAt: now,
      });
      await ctx.db.insert("events", {
        productionId: args.productionId,
        type: "source_audio.ready",
        summary: "The source song is stored. Hermes can begin listening.",
        createdAt: now,
      });
    }
    return assetId;
  },
});

export const list = query({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_production", (q) => q.eq("productionId", args.productionId))
      .collect();
    return Promise.all(
      assets.map(async (asset) => ({ ...asset, url: await ctx.storage.getUrl(asset.storageId) })),
    );
  },
});
