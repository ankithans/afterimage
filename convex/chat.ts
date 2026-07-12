import { ConvexError, v } from "convex/values";

import { mutation } from "./_generated/server";

export const sendNudge = mutation({
  args: {
    productionId: v.id("productions"),
    taskKey: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const production = await ctx.db.get(args.productionId);
    if (!production) throw new ConvexError("Production not found");

    const text = args.text.trim();
    if (!text) throw new ConvexError("A nudge must say what should change");
    if (production.status === "completed" || production.status === "cancelled") {
      throw new ConvexError("This production is no longer accepting nudges");
    }

    const requestedTask = args.taskKey
      ? await ctx.db
          .query("tasks")
          .withIndex("by_production_key", (q) =>
            q.eq("productionId", args.productionId).eq("key", args.taskKey!),
          )
          .unique()
      : null;
    const now = Date.now();
    const taskKey =
      requestedTask && requestedTask.status !== "completed"
        ? requestedTask.key
        : production.activeTaskKey;
    const messageId = await ctx.db.insert("messages", {
      productionId: args.productionId,
      taskKey,
      author: "artist",
      kind: "nudge",
      text,
      status: "pending",
      createdAt: now,
    });

    await ctx.db.insert("events", {
      productionId: args.productionId,
      taskKey,
      type: "artist.nudge",
      summary: "The artist gave Hermes new direction.",
      createdAt: now,
    });

    return messageId;
  },
});
