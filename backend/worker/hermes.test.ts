import { expect, test } from "bun:test";

import { buildHermesPrompt, extractHermesContent, selectTaskNudges } from "./hermes";

test("Hermes receives the active skill, task, and artist nudges", () => {
  const prompt = buildHermesPrompt({
    productionTitle: "Neon Memory",
    task: {
      key: "develop-directions",
      title: "Develop three distinct creative directions",
      role: "Creative Director",
      skill: "creative-direction",
    },
    nudges: ["Keep the figure, but make the chorus less literal."],
  });

  expect(prompt).toContain("Creative Director");
  expect(prompt).toContain("creative-direction");
  expect(prompt).toContain("Develop three distinct creative directions");
  expect(prompt).toContain("Keep the figure, but make the chorus less literal.");
  expect(prompt).toContain("high-level progress update");
});

test("provider errors returned as Hermes messages fail the task", () => {
  expect(() =>
    extractHermesContent({ choices: [{ message: { content: "HTTP 401: Missing Authentication header" } }] }),
  ).toThrow("Hermes agent failed");
});

test("video production is planning-only and hands off directly to Seedance", () => {
  const prompt = buildHermesPrompt({
    productionTitle: "Summer Memory",
    task: { key: "produce-shots", title: "Produce the approved direction", role: "Video Producer", skill: "video-production" },
    nudges: ["use seedance"],
  });

  expect(prompt).toContain("Do not call image, video, FAL");
  expect(prompt).toContain("worker submits it directly to Seedance");
  expect(prompt).toContain("use seedance");
});

test("only nudges for the active task are consumed", () => {
  expect(
    selectTaskNudges("develop-directions", [
      { _id: "message-1", taskKey: "analyze-music", text: "Use the intro." },
      { _id: "message-2", taskKey: "develop-directions", text: "Make it less literal." },
      { _id: "message-3", text: "Keep it intimate." },
    ]),
  ).toEqual([
    { _id: "message-2", taskKey: "develop-directions", text: "Make it less literal." },
    { _id: "message-3", text: "Keep it intimate." },
  ]);
});
