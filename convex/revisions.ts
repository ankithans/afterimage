import { ConvexError, v } from "convex/values";

import { mutation } from "./_generated/server";

export const request = mutation({
  args: { productionId: v.id("productions"), text: v.string() },
  handler: async (ctx, args) => {
    const production = await ctx.db.get(args.productionId);
    if (!production) throw new ConvexError("Production not found");
    if ((production.revisionCount ?? 0) >= 1) throw new ConvexError("The included revision has already been used");
    const text = args.text.trim();
    if (!text) throw new ConvexError("Describe what should change");
    const tasks = await ctx.db.query("tasks").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect();
    const compose = tasks.find((task) => task.key === "compose-master");
    const qa = tasks.find((task) => task.key === "quality-check");
    if (!compose || !qa) throw new ConvexError("Revision tasks are unavailable");
    const now = Date.now();
    await ctx.db.patch(compose._id, { status: "ready", summary: undefined, completedAt: undefined });
    await ctx.db.patch(qa._id, { status: "blocked", summary: undefined, completedAt: undefined });
    const pendingApprovals = await ctx.db.query("approvals").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect();
    for (const approval of pendingApprovals.filter((item) => item.kind === "master" && item.status === "pending")) {
      await ctx.db.patch(approval._id, { status: "superseded" });
    }
    await ctx.db.insert("messages", {
      productionId: args.productionId,
      taskKey: "compose-master",
      author: "artist",
      kind: "nudge",
      text,
      status: "pending",
      createdAt: now,
    });
    await ctx.db.patch(args.productionId, {
      status: "queued",
      activeTaskKey: "compose-master",
      revisionCount: 1,
      updatedAt: now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
  },
});
