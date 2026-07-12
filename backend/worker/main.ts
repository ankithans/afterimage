import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readConfig } from "./config";
import { buildHermesPrompt, runHermesTask, selectTaskNudges } from "./hermes";
import { generateHeroImage, inspectMaster, renderMaster } from "./media";
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
  const prompt = `${basePrompt}\n\nApproved production context:\n${priorContext}${qualityEvidence ? `\n\nDeterministic delivery-master inspection (already verified with ffprobe):\n${JSON.stringify(qualityEvidence)}` : ""}`;

  await convex.mutation(api.worker.postTaskUpdate, {
    productionId: claim.production._id,
    taskKey: claim.task.key,
    text: `${claim.task.role} started “${claim.task.title}” using ${claim.task.skill}.`,
    secret: config.workerSecret,
  });

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
    const summary = config.dryRun
      ? `[Dry run] ${claim.task.role} completed ${claim.task.title}.`
      : await runHermesTask({
          baseUrl: config.hermesBaseUrl,
          apiKey: config.hermesApiKey,
          prompt,
        });

    let artifactKind: string | undefined;
    let artifactPayload: Record<string, unknown> | undefined;
    let masterAssetId: Id<"assets"> | undefined;

    if (claim.task.key === "analyze-music") {
      artifactKind = "music_map";
      artifactPayload = {
        summary,
        lyrics: lyrics ?? claim.production.lyrics ?? "",
        excerpts: [{ id: "excerpt-primary", title: "Recommended 20–30 second arc", description: summary.slice(0, 700) }],
      };
    } else if (claim.task.key === "develop-directions") {
      artifactKind = "treatment_set";
      artifactPayload = {
        directions: [
          { id: "treatment-narrative", title: "Narrative Memory", description: `Character-led and emotionally legible. ${summary.slice(0, 350)}` },
          { id: "treatment-portrait", title: "Performance Portrait", description: "A restrained performer study with controlled light, lens intimacy, and visual continuity." },
          { id: "treatment-abstract", title: "Sensory Afterimage", description: "An abstract world of texture, color, delayed reflections, and music-reactive visual bloom." },
        ],
      };
    } else if (claim.task.key === "produce-shots") {
      await convex.mutation(api.worker.postTaskUpdate, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        text: "The production prompt is locked. OpenAI is generating the approved hero frame now.",
        secret: config.workerSecret,
      });
      const image = await generateHeroImage({ apiKey: config.openAiApiKey, prompt: summary });
      const assetId = await uploadAsset({
        productionId: claim.production._id,
        bytes: image,
        kind: "generated_image",
        filename: "hero-frame.png",
        contentType: "image/png",
      });
      artifactKind = "shot_plan";
      artifactPayload = { prompt: summary, imageAssetId: assetId };
    } else if (claim.task.key === "compose-master") {
      const imageAsset = [...claim.assets].reverse().find((asset) => asset.kind === "generated_image" && asset.url);
      if (!imageAsset?.url || !claim.sourceAudioUrl) throw new Error("Master inputs are incomplete");
      await convex.mutation(api.worker.postTaskUpdate, {
        productionId: claim.production._id,
        taskKey: claim.task.key,
        text: "Picture and source audio are ready. FFmpeg is assembling the review master.",
        secret: config.workerSecret,
      });
      const master = await renderMaster({ imageUrl: imageAsset.url, audioUrl: claim.sourceAudioUrl });
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
