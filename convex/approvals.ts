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

export const skipInvalidExcerpt = mutation({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    const production = await ctx.db.get(args.productionId);
    if (!production || production.status !== "awaiting_input") return false;
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_production", (q) => q.eq("productionId", args.productionId))
      .collect();
    const invalid = approvals.find(
      (approval) => approval.kind === "excerpt" && approval.status === "pending" && approval.options.length < 2,
    );
    if (!invalid) return false;
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_production", (q) => q.eq("productionId", args.productionId))
      .collect();
    const current = tasks.find((task) => task.key === invalid.taskKey);
    const next = current ? tasks.find((task) => task.order === current.order + 1) : null;
    if (!next) throw new ConvexError("Invalid excerpt approval has no downstream task");
    const now = Date.now();
    await ctx.db.patch(invalid._id, { status: "superseded", decidedAt: now });
    await ctx.db.patch(next._id, { status: "ready" });
    await ctx.db.patch(args.productionId, {
      status: "queued",
      activeTaskKey: next.key,
      updatedAt: now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    await ctx.db.insert("events", {
      productionId: args.productionId,
      taskKey: invalid.taskKey,
      type: "approval.excerpt.skipped",
      summary: "AfterImage skipped an invalid excerpt decision because it contained no real alternatives.",
      createdAt: now,
    });
    return true;
  },
});

export const regenerateStaticTreatment = mutation({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    const production = await ctx.db.get(args.productionId);
    if (!production || production.status !== "awaiting_input") return false;
    const approvals = await ctx.db.query("approvals").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect();
    const legacyLabels = new Set(["Narrative Memory", "Performance Portrait", "Sensory Afterimage"]);
    const invalid = approvals.find((approval) =>
      approval.kind === "treatment" && approval.status === "pending" && approval.options.every((option) => legacyLabels.has(option.label)),
    );
    if (!invalid) return false;
    const tasks = await ctx.db.query("tasks").withIndex("by_production", (q) => q.eq("productionId", args.productionId)).collect();
    const creative = tasks.find((task) => task.key === "develop-directions");
    if (!creative) throw new ConvexError("Creative Direction task is missing");
    const now = Date.now();
    await ctx.db.patch(invalid._id, { status: "superseded", decidedAt: now });
    await ctx.db.patch(creative._id, { status: "ready", summary: undefined, completedAt: undefined });
    await ctx.db.patch(args.productionId, {
      status: "queued",
      activeTaskKey: creative.key,
      updatedAt: now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    await ctx.db.insert("events", {
      productionId: args.productionId,
      taskKey: creative.key,
      type: "approval.treatment.regenerated",
      summary: "AfterImage discarded legacy static treatments and queued media-backed directions.",
      createdAt: now,
    });
    return true;
  },
});
