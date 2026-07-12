# Linkup integration proof

Verified: 2026-07-12 16:49 IST

## Product use

Hermes calls Linkup before the `develop-directions` and `produce-shots` tasks. The sourced answer is added to the agent prompt, and the source links are published into the production conversation for the artist to inspect.

- API client: `backend/worker/linkup.ts`
- Hermes orchestration: `backend/worker/main.ts`
- Contract tests: `backend/worker/linkup.test.ts`
- Runtime: Railway service `hermes`, deployment `69af7312-dbad-4205-a97d-ad58855639ad`

## Live verification

A live `POST https://api.linkup.so/v1/search` request completed successfully using `depth: standard`, `outputType: sourcedAnswer`, and inline citations. The response included a sourced recommendation and these references:

1. [What are the Best Film Techniques in 2026?](https://www.accesscreative.ac.uk/blog/what-are-the-best-film-techniques-2026/)
2. [Top 10 Cinematography Techniques for Filmmakers in 2026](https://aaft.com/blog/cinema/top-10-cinematography-techniques-for-filmmakers/)
3. [Cinematography as Worship](https://www.churchproduction.com/magazine/cinematography-as-worship-practical-insights-for-church-film/)

The API key is stored only as the `LINKUP_API_KEY` Railway environment variable. It is not committed to this repository or returned to the browser.

## User-visible evidence

On the next production, the conversation will show:

> Linkup live search returned N sourced references for this production.

followed by clickable source links. This event is written before Hermes generates the creative treatment, proving the search results are used as task input rather than added after generation.
