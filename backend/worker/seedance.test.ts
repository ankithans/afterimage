import { expect, test } from "bun:test";

import { prepareSeedancePrompt } from "./seedance";

test("Seedance prompts always stay inside the provider limit", () => {
  const prompt = prepareSeedancePrompt("story detail ".repeat(1_000));
  expect(prompt.length).toBeLessThanOrEqual(5_000);
  expect(prompt).toContain("[Earlier detail compacted for provider]");
  expect(prompt).toEndWith("No captions, logos, or watermark.");
});

test("short Seedance prompts are preserved", () => {
  const prompt = prepareSeedancePrompt("A woman crosses an empty room toward dawn.");
  expect(prompt).toStartWith("A woman crosses an empty room toward dawn.");
});
