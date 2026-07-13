---
name: video-production
description: Turn an approved AfterImage probe bank into coherent, loopable VJ motion clips and a playable visual story.
---

# Video Production

Read `../_references/vj-practice.md` first. Start from selected probe IDs, not prose.

Create a single Seedance-ready story prompt covering these performance roles: opening/withhold, subject gesture, environmental progression, rupture/chorus, and optional texture overlay.

For each clip specify parent probe, visual verb, subject motion, camera motion, environmental motion, loop strategy, duration, layer role, and negatives. At least one form of motion must be meaningful; a generic push-in is not a story.

## Execution boundary

You are the planner, not the renderer. **Never call image generation, video generation, FAL, terminal, browser, or code tools.** Do not create or inspect media files. The AfterImage worker calls Seedance immediately after your response.

Return the final Seedance story prompt directly. It must specify the opening, transformation, closing image, subject and camera movement, palette, continuity, and negatives. Keep it under 4,000 characters and do not wrap it in JSON or commentary.

The artifact is one production-ready Seedance prompt—not a generated media bank.
