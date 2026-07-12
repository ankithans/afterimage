export const productionTaskStatuses = [
  "blocked",
  "ready",
  "working",
  "awaiting_input",
  "completed",
  "failed",
] as const;

export type ProductionTaskStatus = (typeof productionTaskStatuses)[number];

export type ProductionTask = {
  key: string;
  title: string;
  role: string;
  skill: string;
  status: ProductionTaskStatus;
};

export type ProductionNudge = {
  productionId: string;
  taskKey: string;
  author: "artist";
  kind: "nudge";
  text: string;
  status: "pending";
};

const taskDefinitions = [
  ["analyze-music", "Map the song’s visual and emotional arc", "Music Analyst", "music-analysis"],
  ["develop-directions", "Develop three distinct creative directions", "Creative Director", "creative-direction"],
  ["produce-shots", "Produce the approved direction", "Video Producer", "video-production"],
  ["compose-master", "Compose motion, picture, and sound", "Motion Editor", "motion-composition"],
  ["quality-check", "Inspect and release the delivery master", "QA Director", "delivery-qa"],
] as const;

export function createProductionPlan(productionId: string): ProductionTask[] {
  void productionId;
  return taskDefinitions.map(([key, title, role, skill], index) => ({
    key,
    title,
    role,
    skill,
    status: index === 0 ? "ready" : "blocked",
  }));
}

export function createNudge(input: {
  productionId: string;
  taskKey: string;
  text: string;
}): ProductionNudge {
  const text = input.text.trim();
  if (!text) {
    throw new Error("A nudge must say what should change");
  }

  return {
    productionId: input.productionId,
    taskKey: input.taskKey,
    author: "artist",
    kind: "nudge",
    text,
    status: "pending",
  };
}
