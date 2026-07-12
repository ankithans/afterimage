"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import styles from "./new.module.css";

type UploadResponse = { storageId: Id<"_storage"> };

export function NewProduction() {
  const router = useRouter();
  const createProduction = useMutation(api.productions.create);
  const generateUploadUrl = useMutation(api.assets.generateUploadUrl);
  const registerAsset = useMutation(api.assets.register);
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [song, setSong] = useState<File | null>(null);
  const [artwork, setArtwork] = useState<File | null>(null);
  const [references, setReferences] = useState<File[]>([]);
  const [duration, setDuration] = useState<5 | 10 | 15>(5);
  const [status, setStatus] = useState("Ready for your song");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!song || busy) return;
    setBusy(true);
    try {
      setStatus("Preparing the production…");
      const productionId = await createProduction({
        title: title.trim() || song.name.replace(/\.[^.]+$/, ""),
        intent: intent.trim() || undefined,
        videoDurationSeconds: duration,
      });

      async function upload(file: File, kind: "source_audio" | "artwork" | "reference") {
        const uploadUrl = await generateUploadUrl({ productionId });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) throw new Error(`Upload failed (${response.status})`);
        const { storageId } = (await response.json()) as UploadResponse;
        await registerAsset({
          productionId,
          storageId,
          kind,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          byteSize: file.size,
        });
      }

      if (artwork) {
        setStatus("Adding the cover artwork…");
        await upload(artwork, "artwork");
      }
      for (const [index, reference] of references.entries()) {
        setStatus(`Adding visual reference ${index + 1} of ${references.length}…`);
        await upload(reference, "reference");
      }
      setStatus("Uploading the original song…");
      await upload(song, "source_audio");
      setStatus("The Music Analyst is listening…");
      router.push(`/p/${productionId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start this production");
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>afterimage<span>.</span></Link>
        <span>New production</span>
        <span className={styles.step}>01 / Brief</span>
      </header>
      <div className={styles.layout}>
        <section className={styles.intro}>
          <span className={styles.kicker}>The first frame starts with sound</span>
          <h1>Give the agency<br />one song.</h1>
          <p>Hermes will listen for structure, emotion and lyrics, then bring back three visual worlds.</p>
        </section>
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.titleField}>
            <span>Production title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Untitled memory" />
          </label>
          <label className={styles.intentField}>
            <span>What should it feel like? <i>optional</i></span>
            <textarea
              maxLength={500}
              onChange={(event) => setIntent(event.target.value)}
              placeholder="A memory returning in fragments—warm at first, then impossible to hold."
              value={intent}
            />
          </label>
          <fieldset className={styles.durationField}>
            <legend>Video length <i>Seedance story</i></legend>
            <div>
              {([5, 10, 15] as const).map((seconds) => (
                <label data-selected={duration === seconds} key={seconds}>
                  <input
                    checked={duration === seconds}
                    name="duration"
                    onChange={() => setDuration(seconds)}
                    type="radio"
                    value={seconds}
                  />
                  <strong>{seconds}s</strong>
                  <small>{seconds === 5 ? "Preview" : seconds === 10 ? "Standard" : "Extended"}</small>
                </label>
              ))}
            </div>
            <p>Longer stories use more Seedance credits and take longer to render.</p>
          </fieldset>
          <label className={styles.dropzone} data-filled={Boolean(song)}>
            <input
              type="file"
              accept="audio/mpeg,audio/mp4,audio/wav,audio/x-m4a,audio/webm,.mp3,.m4a,.wav,.webm"
              onChange={(event) => setSong(event.target.files?.[0] ?? null)}
            />
            <span className={styles.plus}>{song ? "✓" : "+"}</span>
            <strong>{song?.name ?? "Drop the mastered song here"}</strong>
            <small>{song ? `${(song.size / 1024 / 1024).toFixed(1)} MB · ready` : "MP3, M4A, WAV or WebM"}</small>
          </label>
          <div className={styles.referenceFields}>
            <label>
              <span>Cover artwork <i>optional</i></span>
              <input accept="image/*" onChange={(event) => setArtwork(event.target.files?.[0] ?? null)} type="file" />
              <b>{artwork?.name ?? "Choose image"}</b>
            </label>
            <label>
              <span>Visual references <i>optional</i></span>
              <input
                accept="image/*"
                multiple
                onChange={(event) => setReferences(Array.from(event.target.files ?? []).slice(0, 5))}
                type="file"
              />
              <b>{references.length ? `${references.length} image${references.length === 1 ? "" : "s"} selected` : "Choose up to 5"}</b>
            </label>
          </div>
          <div className={styles.submitRow}>
            <span>{status}</span>
            <button disabled={!song || busy} type="submit">{busy ? "Starting…" : "Let Hermes listen →"}</button>
          </div>
        </form>
      </div>
    </main>
  );
}
