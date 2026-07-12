export type HermesTask = {
  key: string;
  title: string;
  role: string;
  skill: string;
};

export function selectTaskNudges<T extends { taskKey?: string; text: string }>(
  taskKey: string,
  nudges: T[],
) {
  return nudges.filter((nudge) => !nudge.taskKey || nudge.taskKey === taskKey);
}

export function buildHermesPrompt(input: {
  productionTitle: string;
  task: HermesTask;
  nudges: string[];
}) {
  const artistDirection = input.nudges.length
    ? input.nudges.map((nudge) => `- ${nudge}`).join("\n")
    : "- No additional direction. Follow the approved production context.";

  return `You are the ${input.task.role} working on AfterImage production "${input.productionTitle}".

Use the ${input.task.skill} skill to complete this high-level task:
${input.task.title}

Artist nudges that must influence the work:
${artistDirection}

Work autonomously within this task. Do not start downstream tasks. Preserve decisions already recorded by the production. At meaningful checkpoints, communicate a short high-level progress update that an artist can understand; do not expose terminal logs or private chain-of-thought.

Return a concise final summary and the structured artifact you produced.`;
}

export async function runHermesTask(input: {
  baseUrl: string;
  apiKey: string;
  prompt: string;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => Promise<void> | void;
}) {
  const response = await fetch(`${input.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "hermes-agent",
      messages: [{ role: "user", content: input.prompt }],
      stream: Boolean(input.onChunk),
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    throw new Error(`Hermes request failed (${response.status}): ${await response.text()}`);
  }

  if (input.onChunk && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
        const chunk = event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content ?? "";
        if (!chunk) continue;
        content += chunk;
        await input.onChunk(chunk);
      }
      if (done) break;
    }
    return validateHermesContent(content);
  }

  return extractHermesContent((await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  });
}

export function extractHermesContent(body: {
  choices?: Array<{ message?: { content?: string } }>;
}) {
  const content = body.choices?.[0]?.message?.content?.trim();
  return validateHermesContent(content ?? "");
}

function validateHermesContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Hermes returned no production result");
  if (/^(HTTP \d{3}:|Error code:|AuthenticationError|BadRequestError)/i.test(trimmed)) {
    throw new Error(`Hermes agent failed: ${trimmed}`);
  }
  return trimmed;
}
