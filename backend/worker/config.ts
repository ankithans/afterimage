export type WorkerConfig = {
  workerId: string;
  port: number;
  convexUrl: string;
  workerSecret: string;
  hermesBaseUrl: string;
  hermesApiKey: string;
  openAiApiKey: string;
  linkupApiKey: string;
  seedanceApiKey: string;
  pollIntervalMs: number;
  dryRun: boolean;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function readConfig(): WorkerConfig {
  return {
    workerId: process.env.WORKER_ID?.trim() || "afterimage-hermes-1",
    port: Number(process.env.PORT || 8080),
    convexUrl: required("CONVEX_URL"),
    workerSecret: required("WORKER_SECRET"),
    hermesBaseUrl: process.env.HERMES_BASE_URL?.trim() || "http://127.0.0.1:8642",
    hermesApiKey: required("API_SERVER_KEY"),
    openAiApiKey: required("OPENAI_API_KEY"),
    linkupApiKey: required("LINKUP_API_KEY"),
    seedanceApiKey: required("SEEDANCE_API_KEY"),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 5000),
    dryRun: process.env.WORKER_DRY_RUN === "true",
  };
}
