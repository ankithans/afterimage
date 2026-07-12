const BASE_URL = "https://api.seedance2.ai";

type SeedanceTask = {
  id?: string;
  status?: "queued" | "generating" | "completed" | "failed";
  failed_reason?: string | null;
  data?: { results?: string[] };
};

export async function generateStoryVideo(input: {
  apiKey: string;
  prompt: string;
  durationSeconds: 5 | 10 | 15;
  imageUrls?: string[];
  onProgress?: (status: string) => Promise<void>;
}) {
  const imageUrls = (input.imageUrls ?? []).slice(0, 9);
  const response = await fetch(`${BASE_URL}/v1/videos/generations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "seedance-2-0",
      input: {
        prompt: `${input.prompt}\nCreate a coherent cinematic micro-story with a clear beginning, turn, and emotional final image. Use real subject and camera motion, not a slideshow. No captions, logos, or watermark.`,
        generation_type: imageUrls.length ? "reference-to-video" : "text-to-video",
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
        duration: input.durationSeconds,
        aspect_ratio: "16:9",
        resolution: "480p",
        generate_audio: false,
        watermark: false,
        web_search: false,
        return_last_frame: false,
        seed: -1,
      },
    }),
  });
  if (!response.ok) throw new Error(`Seedance task creation failed (${response.status}): ${await response.text()}`);
  const created = (await response.json()) as { taskId?: string };
  if (!created.taskId) throw new Error("Seedance accepted the request without a task ID");

  for (let poll = 0; poll < 90; poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const statusResponse = await fetch(`${BASE_URL}/v1/tasks/${created.taskId}`, {
      headers: { authorization: `Bearer ${input.apiKey}` },
    });
    if (!statusResponse.ok) throw new Error(`Seedance status failed (${statusResponse.status}): ${await statusResponse.text()}`);
    const task = (await statusResponse.json()) as SeedanceTask;
    if (poll === 0 || poll % 3 === 0) await input.onProgress?.(task.status ?? "generating");
    if (task.status === "failed") throw new Error(`Seedance generation failed: ${task.failed_reason ?? "provider_failed"}`);
    if (task.status === "completed") {
      const videoUrl = task.data?.results?.[0];
      if (!videoUrl) throw new Error("Seedance completed without a video URL");
      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) throw new Error(`Could not download the Seedance result (${videoResponse.status})`);
      return Buffer.from(await videoResponse.arrayBuffer());
    }
  }
  throw new Error("Seedance generation timed out after 15 minutes");
}
