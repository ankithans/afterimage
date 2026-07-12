import { ConvexError, v } from "convex/values";

import { mutation } from "./_generated/server";

export const select = mutation({
  args: { approvalId: v.id("approvals"), selectionId: v.string() },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval || approval.status !== "pending") throw new ConvexError("Approval is no longer pending");
    if (!approval.options.some((option) => option.id === args.selectionId)) throw new ConvexError("Unknown approval option");
    const production = await ctx.db.get(approval.productionId);
    if (!production || production.status !== "awaiting_input") throw new ConvexError("Production is not awaiting this decision");
    const now = Date.now();
    await ctx.db.patch(args.approvalId, { status: "approved", selectionId: args.selectionId, decidedAt: now });
    if (approval.kind === "treatment") await ctx.db.patch(approval.productionId, { selectedTreatmentId: args.selectionId });

    const tasks = await ctx.db.query("tasks").withIndex("by_production", (q) => q.eq("productionId", approval.productionId)).collect();
    const current = tasks.find((task) => task.key === approval.taskKey);
    const next = current ? tasks.find((task) => task.order === current.order + 1) : null;
    if (!next) throw new ConvexError("Approval has no downstream task");
    await ctx.db.patch(next._id, { status: "ready" });
    await ctx.db.patch(approval.productionId, {
      status: "queued",
      activeTaskKey: next.key,
      updatedAt: now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    await ctx.db.insert("events", {
      productionId: approval.productionId,
      taskKey: approval.taskKey,
      type: `approval.${approval.kind}`,
      summary: `The artist approved ${args.selectionId}.`,
      createdAt: now,
    });
  },
});
