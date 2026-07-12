import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OPENAI_UPLOAD_LIMIT = 25 * 1024 * 1024;

export function shouldChunkTranscription(byteSize: number) {
  return byteSize >= OPENAI_UPLOAD_LIMIT;
}

async function transcribeBlob(input: {
  apiKey: string;
  blob: Blob;
  filename: string;
}) {
  const form = new FormData();
  form.append("file", input.blob, input.filename);
  form.append("model", "gpt-4o-transcribe");
  form.append(
    "prompt",
    "Transcribe the sung lyrics faithfully in their original language. Preserve line breaks between lyrical phrases. Do not invent words for instrumental passages.",
  );

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`OpenAI transcription failed (${response.status}): ${await response.text()}`);
  }
  const result = (await response.json()) as { text?: string };
  if (!result.text?.trim()) throw new Error("OpenAI returned an empty song transcription");
  return result.text.trim();
}

export async function transcribeSong(input: {
  apiKey: string;
  sourceUrl: string;
  filename?: string;
  contentType?: string;
}) {
  const response = await fetch(input.sourceUrl);
  if (!response.ok) throw new Error(`Could not download source audio (${response.status})`);
  const source = await response.blob();
  const safeName = basename(input.filename || "song.mp3").replace(/[^a-zA-Z0-9._-]/g, "-");

  if (!shouldChunkTranscription(source.size)) {
    return transcribeBlob({
      apiKey: input.apiKey,
      blob: new Blob([await source.arrayBuffer()], { type: input.contentType || source.type }),
      filename: safeName,
    });
  }

  const workdir = await mkdtemp(join(tmpdir(), "afterimage-transcription-"));
  try {
    const sourcePath = join(workdir, `source${extname(safeName) || ".audio"}`);
    const chunksDir = join(workdir, "chunks");
    await writeFile(sourcePath, Buffer.from(await source.arrayBuffer()));
    await execFileAsync("mkdir", ["-p", chunksDir]);
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-f",
      "segment",
      "-segment_time",
      "300",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      join(chunksDir, "chunk-%03d.mp3"),
    ]);

    const chunkNames = (await readdir(chunksDir)).filter((name) => name.endsWith(".mp3")).sort();
    if (chunkNames.length === 0) throw new Error("FFmpeg produced no transcription chunks");
    const transcript: string[] = [];
    for (const chunkName of chunkNames) {
      const bytes = await readFile(join(chunksDir, chunkName));
      transcript.push(
        await transcribeBlob({
          apiKey: input.apiKey,
          blob: new Blob([bytes], { type: "audio/mpeg" }),
          filename: chunkName,
        }),
      );
    }
    return transcript.join("\n").trim();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
