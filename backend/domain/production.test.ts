import { describe, expect, test } from "bun:test";

import { createNudge, createProductionPlan } from "./production";

describe("production plan", () => {
  test("exposes high-level Hermes work with the responsible skill", () => {
    expect(createProductionPlan("production-1")).toEqual([
      {
        key: "analyze-music",
        title: "Map the song’s visual and emotional arc",
        role: "Music Analyst",
        skill: "music-analysis",
        status: "ready",
      },
      {
        key: "develop-directions",
        title: "Develop three distinct creative directions",
        role: "Creative Director",
        skill: "creative-direction",
        status: "blocked",
      },
      {
        key: "produce-shots",
        title: "Produce the approved direction",
        role: "Video Producer",
        skill: "video-production",
        status: "blocked",
      },
      {
        key: "compose-master",
        title: "Compose motion, picture, and sound",
        role: "Motion Editor",
        skill: "motion-composition",
        status: "blocked",
      },
      {
        key: "quality-check",
        title: "Inspect and release the delivery master",
        role: "QA Director",
        skill: "delivery-qa",
        status: "blocked",
      },
    ]);
  });
});

describe("production chat", () => {
  test("turns an artist message into a pending nudge for the active skill", () => {
    expect(
      createNudge({
        productionId: "production-1",
        taskKey: "develop-directions",
        text: "Keep the figure, but make the chorus less literal.",
      }),
    ).toEqual({
      productionId: "production-1",
      taskKey: "develop-directions",
      author: "artist",
      kind: "nudge",
      text: "Keep the figure, but make the chorus less literal.",
      status: "pending",
    });
  });

  test("rejects empty nudges", () => {
    expect(() =>
      createNudge({ productionId: "production-1", taskKey: "analyze-music", text: "   " }),
    ).toThrow("A nudge must say what should change");
  });
});
