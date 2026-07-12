export type LinkupSource = {
  name: string;
  url: string;
  snippet: string;
};

export type LinkupResearch = {
  answer: string;
  sources: LinkupSource[];
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function shouldResearchTask(taskKey: string) {
  return taskKey === "develop-directions" || taskKey === "produce-shots";
}

export function buildResearchQuery(input: {
  title: string;
  intent?: string;
  taskKey: string;
}) {
  const phase = input.taskKey === "produce-shots" ? "cinematic execution references" : "visual direction references";
  return [
    `Find current, credible ${phase} for an original music video titled “${input.title}”.`,
    input.intent ? `Creative intent: ${input.intent.slice(0, 800)}.` : "",
    "Prioritize specific filmmaking techniques, production design, cinematography, and recent cultural references.",
    "Return practical inspiration, not a generic trend summary, and do not suggest copying another artist's work.",
  ].filter(Boolean).join(" ");
}

export async function searchWithLinkup(input: {
  apiKey: string;
  query: string;
  fetchImpl?: Fetcher;
}): Promise<LinkupResearch> {
  const response = await (input.fetchImpl ?? fetch)("https://api.linkup.so/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: input.query,
      depth: "standard",
      outputType: "sourcedAnswer",
      includeInlineCitations: true,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Linkup search failed (${response.status}): ${detail}`);
  }
  const result = await response.json() as Partial<LinkupResearch>;
  return {
    answer: typeof result.answer === "string" ? result.answer : "",
    sources: Array.isArray(result.sources)
      ? result.sources.filter((source): source is LinkupSource =>
          typeof source?.name === "string" && typeof source?.url === "string" && typeof source?.snippet === "string")
      : [],
  };
}

export function formatResearchForHermes(research: LinkupResearch) {
  const sources = research.sources.slice(0, 5).map((source, index) =>
    `${index + 1}. ${source.name} — ${source.url}\n${source.snippet.slice(0, 600)}`
  ).join("\n");
  return `Live web research supplied by Linkup:\n${research.answer.slice(0, 4_000)}\n\nSources:\n${sources}\n\nUse these as current research signals. Synthesize an original treatment and preserve source URLs in your reasoning.`;
}

export function formatResearchUpdate(research: LinkupResearch) {
  const sources = research.sources.slice(0, 3).map((source) => `- [${source.name}](${source.url})`).join("\n");
  return `Linkup live search returned ${research.sources.length} sourced references for this production.\n\n${sources}`;
}
