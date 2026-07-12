import { expect, test } from "bun:test";

import { shouldChunkTranscription } from "./transcription";

test("songs above the OpenAI upload limit are chunked before transcription", () => {
  expect(shouldChunkTranscription(24 * 1024 * 1024)).toBe(false);
  expect(shouldChunkTranscription(25 * 1024 * 1024)).toBe(true);
});
