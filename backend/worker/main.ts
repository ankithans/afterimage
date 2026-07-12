import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readConfig } from "./config";
import { buildHermesPrompt, runHermesTask, selectTaskNudges } from "./hermes";
import { buildResearchQuery, formatResearchForHermes, formatResearchUpdate, searchWithLinkup, shouldResearchTask } from "./linkup";
import { generateHeroImage, inspectMaster, renderVideoMaster } from "./media";
import { generateStoryVideo } from "./seedance";
import { transcribeSong } from "./transcription";

const config = readConfig();
const convex = new ConvexHttpClient(config.convexUrl);
let hermesHealthy = false;
let activeProductionId: string | null = null;
let stopping = false;

function configureHermesModel() {
  const model = process.env.HERMES_INFERENCE_MODEL || "gpt-5.6-terra";
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const settings = [
    ["model.provider", "custom"],
    ["model.default", model],
    ["model.base_url", baseUrl],
    ["model.api_mode", "codex_responses"],
    ["agent.reasoning_effort", "low"],
  ];

  for (const [key, value] of settings) {
    const result = spawnSync("hermes", ["config", "set", key, value], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Could not configure Hermes setting ${key}`);
  }
}

mkdirSync("/opt/data/skills", { recursive: true });
cpSync("/opt/afterimage/skills", "/opt/data/skills", { recursive: true });
configureHermesModel();

const gateway = spawn("hermes", ["gateway", "run"], {
  env: {
    ...process.env,
    API_SERVER_ENABLED: "true",
    API_SERVER_HOST: "127.0.0.1",
    API_SERVER_PORT: "8642",
  },
  stdio: "inherit",
});

gateway.on("exit", (code) => {
  hermesHealthy = false;
  if (!stopping) {
    console.error(`Hermes gateway exited unexpectedly with code ${code ?? "unknown"}`);
  }
});

async function checkHermes() {
  try {
    const response = await fetch(`${config.hermesBaseUrl}/health`);
    hermesHealthy = response.ok;
  } catch {
    hermesHealthy = false;
  }
  return hermesHealthy;
}

async function waitForHermes() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await checkHermes()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Hermes gateway did not become healthy within 30 seconds");
}

async function workOnce() {
  const claim = await convex.mutation(api.worker.claimNext, {
    workerId: config.workerId,
    secret: config.workerSecret,
  });
  if (!claim) return;

  activeProductionId = claim.production._id;
  const taskNudges = selectTaskNudges(claim.task.key, claim.nudges);
  const nudgeTexts = taskNudges.map((message) => message.text);
  let lyrics: string | undefined;
  if (!config.dryRun && claim.task.key === "analyze-music" && claim.sourceAudioUrl) {
    await convex.mutation(api.worker.postTaskUpdate, {
      productionId: claim.production._id,
      taskKey: claim.task.key,
      text: "Music Analyst is transcribing the song’s lyrics with OpenAI speech-to-text.",
      secret: config.workerSecret,
    });
    lyrics = await transcribeSong({
      apiKey: config.openAiApiKey,
      sourceUrl: claim.sourceAudioUrl,
      filename: claim.sourceAudio?.filename,
      contentType: claim.sourceAudio?.contentType,
    });
    await convex.mutation(api.worker.postTaskUpdate, {
      productionId: claim.production._id,
      taskKey: claim.task.key,
      text: `Transcript captured:\n\n${lyrics}`,
      secret: config.workerSecret,
    });
  }

  const basePrompt = buildHermesPrompt({
    productionTitle: claim.production.title,
    task: claim.task,
    nudges: nudgeTexts,
  });
  const priorContext = JSON.stringify({
    intent: claim.production.intent,
    lyrics: lyrics ?? claim.production.lyrics,
    artifacts: claim.artifacts.map((artifact) => ({ kind: artifact.kind, payload: artifact.payload })),
    approvals: claim.approvals.map((approval) => ({ kind: approval.kind, selectionId: approval.selectionId })),
  });
  let qualityEvidence: Awaited<ReturnType<typeof inspectMaster>> | undefined;
  if (claim.task.key === "quality-check") {
    const master = [...claim.assets].reverse().find((asset) => asset.kind === "master" && asset.url);
    if (!master?.url) throw new Error("QA cannot run without a delivery master");
    qualityEvidence = await inspectMaster(master.url);
  }
  let prompt = `${basePrompt}\n\nApproved production context:\n${priorContext}${qualityEvidence ? `\n\nDeterministic delivery-master inspection (already verified with ffprobe):\n${JSON.stringify(qualityEvidence)}` : ""}`;

  await convex.mutation(api.worker.postTaskUpdate, {
    productionId: claim.production._id,
    taskKey: claim.task.key,
    text: `${claim.task.role} started “${claim.task.title}” using ${claim.task.skill}.`,
    secret: config.workerSecret,
  });

  if (!config.dryRun && shouldResearchTask(claim.task.key)) {
    try {
      const research = await searchWithLinkup({
        apiKey: config.linkupApiKey,
        query: buildResearchQuery({
          title: claim.production.title,
          intent: claim.production.intent,
          taskKey: claim.task.key,
        }),
      });
      prompt += `\n\n${formatResearchForHermes(research)}`;
      await convex.mutation(api.worker.postTaskUpdate, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        text: formatResearchUpdate(research),
        secret: config.workerSecret,
      });
    } catch (error) {
      console.warn("Linkup research unavailable; continuing without it", error);
      await convex.mutation(api.worker.postTaskUpdate, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        text: "Linkup live research is temporarily unavailable. Hermes is continuing with the approved production context.",
        secret: config.workerSecret,
      });
    }
  }

  let heartbeatTicks = 0;
  const heartbeat = setInterval(() => {
    heartbeatTicks += 1;
    void convex.mutation(api.worker.heartbeat, {
      productionId: claim.production._id,
      workerId: config.workerId,
      secret: config.workerSecret,
    }).catch((error) => console.warn("Heartbeat rejected; task completion will be fenced", error));
    if (heartbeatTicks % 2 === 0 && heartbeatTicks <= 6) {
      void convex.mutation(api.worker.postTaskUpdate, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        text: `${claim.task.role} is still working inside ${claim.task.skill}. The production lease is healthy; the next checkpoint will appear here.`,
        secret: config.workerSecret,
      }).catch((error) => console.warn("Could not publish live Hermes checkpoint", error));
    }
  }, 15_000);

  try {
    const transcriptRunId = `${claim.task.key}-${Date.now()}`;
    let transcriptSequence = 0;
    let transcriptBuffer = "";
    const publishTranscript = async (force = false) => {
      if (!transcriptBuffer || (!force && transcriptBuffer.length < 180)) return;
      const text = transcriptBuffer;
      transcriptBuffer = "";
      await convex.mutation(api.worker.appendTranscriptChunk, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        runId: transcriptRunId,
        sequence: transcriptSequence++,
        kind: "output",
        text,
        secret: config.workerSecret,
      });
    };
    await convex.mutation(api.worker.appendTranscriptChunk, {
      productionId: claim.production._id,
      taskKey: claim.task.key,
      runId: transcriptRunId,
      sequence: transcriptSequence++,
      kind: "status",
      text: `${claim.task.role} opened ${claim.task.skill}.`,
      secret: config.workerSecret,
    });
    const summary = config.dryRun
      ? `[Dry run] ${claim.task.role} completed ${claim.task.title}.`
      : await runHermesTask({
          baseUrl: config.hermesBaseUrl,
          apiKey: config.hermesApiKey,
          prompt,
          onChunk: async (chunk) => {
            transcriptBuffer += chunk;
            await publishTranscript();
          },
        });
    await publishTranscript(true);

    let artifactKind: string | undefined;
    let artifactPayload: Record<string, unknown> | undefined;
    let masterAssetId: Id<"assets"> | undefined;

    if (claim.task.key === "analyze-music") {
      artifactKind = "music_map";
      artifactPayload = {
        summary,
        lyrics: lyrics ?? claim.production.lyrics ?? "",
        // A single untimed recommendation is not an artist decision. Timed
        // analysis may populate multiple candidates later; until then the
        // workflow advances without showing a false choice.
        excerpts: [],
      };
    } else if (claim.task.key === "develop-directions") {
      const directions = parseCreativeDirections(summary);
      await convex.mutation(api.worker.postTaskUpdate, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        text: `Hermes defined ${directions.length} song-specific worlds. Their visual probes are generating in parallel.`,
        secret: config.workerSecret,
      });
      const directionsWithMedia = await Promise.all(directions.map(async (direction) => {
        const image = await generateHeroImage({ apiKey: config.openAiApiKey, prompt: direction.imagePrompt });
        const assetId = await uploadAsset({
          productionId: claim.production._id,
          bytes: image,
          kind: "generated_image",
          filename: `${direction.id}.png`,
          contentType: "image/png",
        });
        await convex.mutation(api.worker.postTaskUpdate, {
          productionId: claim.production._id,
          taskKey: claim.task.key,
          text: `Visual probe ready: ${direction.title}.`,
          secret: config.workerSecret,
        });
        return { ...direction, previewUrl: `asset:${assetId}` };
      }));
      artifactKind = "treatment_set";
      artifactPayload = { directions: directionsWithMedia };
    } else if (claim.task.key === "produce-shots") {
      await convex.mutation(api.worker.postTaskUpdate, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        text: "The story prompt is locked. Seedance 2.0 is directing the cinematic video now.",
        secret: config.workerSecret,
      });
      const referenceImages = claim.assets
        .filter((asset) => (asset.kind === "artwork" || asset.kind === "reference") && asset.url)
        .map((asset) => asset.url!)
        .slice(0, 9);
      const storyVideo = await generateStoryVideo({
        apiKey: config.seedanceApiKey,
        // The Video Producer's final artifact already incorporates the approved
        // context. Re-sending every prior artifact can exceed Seedance's 5k
        // prompt ceiling and causes an otherwise healthy lease to retry forever.
        prompt: summary,
        durationSeconds: claim.production.videoDurationSeconds ?? 5,
        imageUrls: referenceImages,
        onProgress: async (status) => {
          await convex.mutation(api.worker.postTaskUpdate, {
            productionId: claim.production._id,
            taskKey: claim.task.key,
            text: `Seedance generation is ${status}. The story render remains attached to this production lease.`,
            secret: config.workerSecret,
          });
        },
      });
      const assetId = await uploadAsset({
        productionId: claim.production._id,
        bytes: storyVideo,
        kind: "generated_clip",
        filename: `story-v${(claim.production.revisionCount ?? 0) + 1}.mp4`,
        contentType: "video/mp4",
      });
      artifactKind = "shot_plan";
      artifactPayload = { prompt: summary, videoAssetId: assetId, provider: "seedance-2-0" };
    } else if (claim.task.key === "compose-master") {
      const videoAsset = [...claim.assets].reverse().find((asset) => asset.kind === "generated_clip" && asset.url);
      if (!videoAsset?.url || !claim.sourceAudioUrl) throw new Error("Master inputs are incomplete");
      await convex.mutation(api.worker.postTaskUpdate, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        text: "Picture and source audio are ready. FFmpeg is assembling the review master.",
        secret: config.workerSecret,
      });
      const master = await renderVideoMaster({ videoUrl: videoAsset.url, audioUrl: claim.sourceAudioUrl });
      masterAssetId = await uploadAsset({
        productionId: claim.production._id,
        bytes: master,
        kind: "master",
        filename: `master-v${(claim.production.revisionCount ?? 0) + 1}.mp4`,
        contentType: "video/mp4",
      });
      artifactKind = "master_version";
      artifactPayload = { summary, masterAssetId };
    } else if (claim.task.key === "quality-check") {
      await convex.mutation(api.worker.postTaskUpdate, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        text: `Media inspection passed: ${qualityEvidence?.videoCodec?.toUpperCase()} video, ${qualityEvidence?.audioCodec?.toUpperCase()} audio, ${qualityEvidence?.width}×${qualityEvidence?.height}, ${qualityEvidence?.durationSeconds.toFixed(2)} seconds.`,
        secret: config.workerSecret,
      });
      artifactKind = "delivery_qa";
      artifactPayload = { summary, ...qualityEvidence };
    }

    await convex.mutation(api.worker.completeTask, {
      productionId: claim.production._id,
      taskKey: claim.task.key,
      summary,
      lyrics,
      artifactKind,
      artifactPayload,
      masterAssetId,
      consumedNudgeIds: taskNudges.map((message) => message._id),
      workerId: config.workerId,
      secret: config.workerSecret,
    });
  } finally {
    clearInterval(heartbeat);
    activeProductionId = null;
  }
}

function parseCreativeDirections(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Creative Director returned no structured directions");
  const parsed = JSON.parse(text.slice(start, end + 1)) as { directions?: unknown[] };
  if (!Array.isArray(parsed.directions) || parsed.directions.length !== 3) {
    throw new Error("Creative Director must return exactly three structured directions");
  }
  return parsed.directions.map((value, index) => {
    const direction = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const id = String(direction.id ?? `direction-${index + 1}`).trim();
    const title = String(direction.title ?? "").trim();
    const description = String(direction.description ?? "").trim();
    const imagePrompt = String(direction.imagePrompt ?? "").trim();
    if (!title || !description || !imagePrompt) throw new Error(`Creative direction ${index + 1} is incomplete`);
    return { id, title, description, imagePrompt };
  });
}

async function uploadAsset(input: {
  productionId: Id<"productions">;
  bytes: Buffer;
  kind: "generated_image" | "generated_clip" | "overlay" | "master";
  filename: string;
  contentType: string;
}) {
  const uploadUrl = await convex.mutation(api.worker.generateUploadUrl, { secret: config.workerSecret });
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "content-type": input.contentType },
    body: new Blob([new Uint8Array(input.bytes)], { type: input.contentType }),
  });
  if (!response.ok) throw new Error(`Convex asset upload failed (${response.status})`);
  const { storageId } = (await response.json()) as { storageId: string };
  return convex.mutation(api.worker.registerAsset, {
    productionId: input.productionId,
    storageId: storageId as never,
    kind: input.kind,
    filename: input.filename,
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    secret: config.workerSecret,
  });
}

const server = createServer(async (request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  await checkHermes();
  response.setHeader("content-type", "application/json");
  response.writeHead(hermesHealthy ? 200 : 503);
  response.end(
    JSON.stringify({
      status: hermesHealthy ? "ok" : "degraded",
      workerId: config.workerId,
      hermes: hermesHealthy ? "healthy" : "unavailable",
      activeProductionId,
    }),
  );
});

async function main() {
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`AfterImage worker health endpoint listening on :${config.port}`);
  });
  await waitForHermes();
  console.log("Hermes gateway is healthy; worker polling started");

  while (!stopping) {
    try {
      await workOnce();
    } catch (error) {
      console.error("Worker iteration failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

function shutdown() {
  stopping = true;
  gateway.kill("SIGTERM");
  server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

void main();
