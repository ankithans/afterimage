import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function generateHeroImage(input: { apiKey: string; prompt: string }) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt: `${input.prompt}\nCinematic music-video frame, 16:9 composition, no text, no logo, no watermark.`,
      size: "1536x1024",
      quality: "medium",
      output_format: "png",
    }),
  });
  if (!response.ok) throw new Error(`OpenAI image generation failed (${response.status}): ${await response.text()}`);
  const body = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const encoded = body.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI image generation returned no image");
  return Buffer.from(encoded, "base64");
}

export async function renderMaster(input: { imageUrl: string; audioUrl: string }) {
  const workdir = await mkdtemp(join(tmpdir(), "afterimage-master-"));
  try {
    const [imageResponse, audioResponse] = await Promise.all([fetch(input.imageUrl), fetch(input.audioUrl)]);
    if (!imageResponse.ok || !audioResponse.ok) throw new Error("Could not download master inputs");
    const imagePath = join(workdir, "hero.png");
    const audioPath = join(workdir, "source.audio");
    const outputPath = join(workdir, "master.mp4");
    await Promise.all([
      writeFile(imagePath, Buffer.from(await imageResponse.arrayBuffer())),
      writeFile(audioPath, Buffer.from(await audioResponse.arrayBuffer())),
    ]);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", imagePath, "-i", audioPath,
      "-t", "30", "-shortest", "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fade=t=in:st=0:d=0.6,format=yuv420p",
      "-r", "24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-threads", "1",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function renderVideoMaster(input: { videoUrl: string; audioUrl: string }) {
  const workdir = await mkdtemp(join(tmpdir(), "afterimage-video-master-"));
  try {
    const [videoResponse, audioResponse] = await Promise.all([fetch(input.videoUrl), fetch(input.audioUrl)]);
    if (!videoResponse.ok || !audioResponse.ok) throw new Error("Could not download video master inputs");
    const videoPath = join(workdir, "story.mp4");
    const audioPath = join(workdir, "source.audio");
    const outputPath = join(workdir, "master.mp4");
    await Promise.all([
      writeFile(videoPath, Buffer.from(await videoResponse.arrayBuffer())),
      writeFile(audioPath, Buffer.from(await audioResponse.arrayBuffer())),
    ]);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", videoPath, "-i", audioPath,
      "-map", "0:v:0", "-map", "1:a:0", "-shortest",
      "-vf", "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-threads", "1",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function inspectMaster(masterUrl: string) {
  const workdir = await mkdtemp(join(tmpdir(), "afterimage-qa-"));
  try {
    const response = await fetch(masterUrl);
    if (!response.ok) throw new Error(`Could not download delivery master (${response.status})`);
    const masterPath = join(workdir, "master.mp4");
    await writeFile(masterPath, Buffer.from(await response.arrayBuffer()));
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
      "-of", "json", masterPath,
    ]);
    const probe = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    };
    const video = probe.streams?.find((stream) => stream.codec_type === "video");
    const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
    const durationSeconds = Number(probe.format?.duration ?? 0);
    if (!video || !audio || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("Delivery master is missing a valid video stream, audio stream, or duration");
    }
    return {
      passed: true,
      durationSeconds,
      videoCodec: video.codec_name,
      audioCodec: audio.codec_name,
      width: video.width,
      height: video.height,
      byteSize: Number(response.headers.get("content-length") ?? 0),
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
