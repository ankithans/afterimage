import { describe, expect, test } from "bun:test";

import { buildResearchQuery, formatResearchUpdate, searchWithLinkup, shouldResearchTask } from "./linkup";

describe("Linkup research", () => {
  test("is limited to creative tasks", () => {
    expect(shouldResearchTask("develop-directions")).toBe(true);
    expect(shouldResearchTask("produce-shots")).toBe(true);
    expect(shouldResearchTask("quality-check")).toBe(false);
  });

  test("keeps the query focused and bounded", () => {
    const query = buildResearchQuery({ title: "Signal", intent: "x".repeat(2_000), taskKey: "develop-directions" });
    expect(query).toContain("Signal");
    expect(query.length).toBeLessThan(1_200);
  });

  test("calls the sourced-answer API and renders clickable proof", async () => {
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer secret" }));
      expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({ depth: "standard", outputType: "sourcedAnswer" }));
      return Response.json({ answer: "A useful signal", sources: [{ name: "Example", url: "https://example.com", snippet: "Evidence" }] });
    };
    const result = await searchWithLinkup({
      apiKey: "secret",
      query: "query",
      fetchImpl: fetchImpl as Parameters<typeof searchWithLinkup>[0]["fetchImpl"],
    });
    expect(formatResearchUpdate(result)).toContain("[Example](https://example.com)");
  });
});
