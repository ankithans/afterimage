"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import styles from "./workspace.module.css";

type ApprovalKind = "excerpt" | "treatment" | "master";

const approvalCopy: Record<ApprovalKind, { eyebrow: string; title: string; body: string }> = {
  excerpt: {
    eyebrow: "Your first decision",
    title: "Choose the moment",
    body: "Hermes found the strongest passages. Pick the excerpt the directors should build around.",
  },
  treatment: {
    eyebrow: "Creative direction",
    title: "Choose a world",
    body: "Each direction follows the song differently. Your choice becomes the production brief.",
  },
  master: {
    eyebrow: "Master review",
    title: "Release or reshape it",
    body: "Watch the current cut, approve it for delivery, or send one precise revision.",
  },
};

function formatTime(createdAt: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(createdAt);
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function AudioWorkbench({ title, url }: { title: string; url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[]>(Array.from({ length: 96 }, (_, index) => .2 + ((index * 17) % 11) / 18));
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function analyze() {
      try {
        const bytes = await fetch(url).then((response) => response.arrayBuffer());
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(bytes.slice(0));
        const channel = buffer.getChannelData(0);
        const bucket = Math.max(1, Math.floor(channel.length / 96));
        const values = Array.from({ length: 96 }, (_, index) => {
          let max = 0;
          for (let cursor = index * bucket; cursor < Math.min(channel.length, (index + 1) * bucket); cursor += Math.max(1, Math.floor(bucket / 120))) {
            max = Math.max(max, Math.abs(channel[cursor]));
          }
          return Math.max(.08, Math.min(1, max * 1.7));
        });
        if (!cancelled) setPeaks(values);
        await context.close();
      } catch {
        // The transport still works if a browser blocks waveform analysis.
      }
    }
    void analyze();
    return () => { cancelled = true; };
  }, [url]);

  function seek(event: MouseEvent<HTMLButtonElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    audio.currentTime = ((event.clientX - bounds.left) / bounds.width) * duration;
  }

  return (
    <section className={styles.audioWorkbench}>
      <audio
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        preload="metadata"
        ref={audioRef}
        src={url}
      />
      <button
        aria-label={playing ? "Pause source song" : "Play source song"}
        className={styles.transportButton}
        onClick={() => playing ? audioRef.current?.pause() : void audioRef.current?.play()}
        type="button"
      >{playing ? "Ⅱ" : "▶"}</button>
      <div className={styles.trackMeta}><small>Source master</small><strong>{title}</strong></div>
      <button aria-label="Seek source song" className={styles.waveform} onClick={seek} type="button">
        {peaks.map((peak, index) => (
          <i
            data-played={duration > 0 && index / peaks.length <= time / duration}
            key={index}
            style={{ height: `${Math.max(3, peak * 34)}px` }}
          />
        ))}
      </button>
      <time>{formatDuration(time)} / {formatDuration(duration)}</time>
    </section>
  );
}

export function ProductionWorkspace({ productionId }: { productionId: string }) {
  const id = productionId as Id<"productions">;
  const data = useQuery(api.productions.get, { productionId: id });
  const sendNudge = useMutation(api.chat.sendNudge);
  const selectApproval = useMutation(api.approvals.select);
  const requestRevision = useMutation(api.revisions.request);
  const [text, setText] = useState("");
  const [revision, setRevision] = useState("");
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [revisionStatus, setRevisionStatus] = useState("");

  const activeTask = useMemo(
    () => data?.tasks.find((task) => task.key === data.production.activeTaskKey),
    [data],
  );
  const pendingApproval = data?.approvals.find((approval) => approval.status === "pending");
  const approvedDecisions = data?.approvals.filter((approval) => approval.status === "approved").map((approval) => ({
    kind: approval.kind,
    option: approval.options.find((option) => option.id === approval.selectionId),
  })) ?? [];
  const master = [...(data?.assets ?? [])].reverse().find((asset) => asset.kind === "master" && asset.url);
  const canChat = Boolean(activeTask) && !["completed", "cancelled", "failed"].includes(data?.production.status ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await sendNudge({ productionId: id, taskKey: activeTask?.key, text: text.trim() });
      setText("");
    } finally {
      setSending(false);
    }
  }

  async function decide(approvalId: Id<"approvals">, selectionId: string) {
    if (deciding) return;
    setDeciding(selectionId);
    try {
      await selectApproval({ approvalId, selectionId });
    } finally {
      setDeciding(null);
    }
  }

  async function submitRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!revision.trim() || sending) return;
    setSending(true);
    setRevisionStatus("Sending your note to Hermes…");
    try {
      await requestRevision({ productionId: id, text: revision.trim() });
      setRevision("");
      setRevisionStatus("Revision queued. The plan will update at the next safe checkpoint.");
    } finally {
      setSending(false);
    }
  }

  if (data === undefined) return <main className={styles.loading}>Opening the production room…</main>;
  if (data === null) return <main className={styles.loading}>Production not found.</main>;

  const currentCopy = pendingApproval ? approvalCopy[pendingApproval.kind] : null;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>afterimage<span>.</span></Link>
        <div className={styles.productionName}>{data.production.title}</div>
        <div className={styles.state}>{data.production.status.replaceAll("_", " ")}</div>
      </header>

      <div className={styles.layout}>
        <section className={styles.screeningRoom}>
          {data.sourceAudioUrl && <AudioWorkbench title={data.sourceAudio?.filename ?? data.production.title} url={data.sourceAudioUrl} />}

          <section className={styles.productionMemory}>
            <article className={styles.transcriptCard}>
              <div><span>Speech transcript</span><b>{data.production.lyrics ? "captured" : "listening"}</b></div>
              <p>{data.production.lyrics || "OpenAI speech-to-text is listening for the lyric spine…"}</p>
            </article>
            <article className={styles.decisionLedger}>
              <div><span>Artist decisions</span><b>{approvedDecisions.length} locked</b></div>
              {approvedDecisions.length ? approvedDecisions.map(({ kind, option }) => (
                <p key={kind}><small>{kind}</small><strong>{option?.label ?? "Selection recorded"}</strong></p>
              )) : <em>Your excerpt, world, and master decisions will collect here.</em>}
            </article>
          </section>

          <div className={styles.screen} data-mode={master ? "master" : pendingApproval ? "decision" : "live"}>
            <span className={styles.screenLabel}>{master ? "CURRENT MASTER" : pendingApproval ? "ARTIST DECISION" : "LIVE PRODUCTION"}</span>
            {!pendingApproval && data.production.status !== "completed" && <div className={styles.signal} />}

            {master?.url ? (
              <div className={styles.masterStage}>
                <video className={styles.masterVideo} controls playsInline preload="metadata" src={master.url} />
                {pendingApproval?.kind === "master" && (
                  <div className={styles.masterDecision}>
                    <div><small>Master review</small><strong>Does this feel finished?</strong></div>
                    {pendingApproval.options.map((option) => (
                      <button
                        disabled={Boolean(deciding)}
                        key={option.id}
                        onClick={() => void decide(pendingApproval._id, option.id)}
                        type="button"
                      >
                        {deciding === option.id ? "Applying…" : option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : pendingApproval && currentCopy ? (
              <div className={styles.approvalPanel}>
                <p>{currentCopy.eyebrow}</p>
                <h1>{currentCopy.title}</h1>
                <span>{currentCopy.body}</span>
                <div className={styles.options} data-count={pendingApproval.options.length}>
                  {pendingApproval.options.map((option, index) => (
                    <button
                      className={styles.option}
                      disabled={Boolean(deciding)}
                      key={option.id}
                      onClick={() => void decide(pendingApproval._id, option.id)}
                      type="button"
                    >
                      {option.previewUrl && (
                        <span
                          aria-hidden="true"
                          className={styles.optionPreview}
                          style={{ backgroundImage: `url(${option.previewUrl})` }}
                        />
                      )}
                      <small>{String(index + 1).padStart(2, "0")}</small>
                      <strong>{option.label}</strong>
                      {option.description && <span>{option.description}</span>}
                      <b>{deciding === option.id ? "Applying…" : "Choose →"}</b>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <p>{data.production.status === "completed" ? "The agency has finished" : "Hermes is working as"}</p>
                <h1>{activeTask?.role ?? "AfterImage Producer"}</h1>
                <span>{activeTask?.title ?? "Production complete"}</span>
              </div>
            )}
          </div>

          {master && data.production.status !== "cancelled" && (data.production.revisionCount ?? 0) < 1 && (
            <form className={styles.revisionBox} onSubmit={submitRevision}>
              <div>
                <span>One conversational revision</span>
                <strong>What should feel different?</strong>
              </div>
              <textarea
                aria-label="Revision direction"
                onChange={(event) => setRevision(event.target.value)}
                placeholder="Make the opening quieter, hold longer on the face, then let the color break on the chorus…"
                value={revision}
              />
              <button disabled={!revision.trim() || sending} type="submit">Request revision →</button>
              {revisionStatus && <small>{revisionStatus}</small>}
            </form>
          )}

          <div className={styles.taskStack}>
            <div className={styles.sectionLabel}>Hermes production plan</div>
            {data.tasks.map((task) => (
              <article className={styles.task} data-status={task.status} key={task._id}>
                <div className={styles.taskState} aria-hidden="true" />
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.role} · <span>{task.skill}</span></p>
                  {task.summary && <small>{task.summary}</small>}
                </div>
                <code>{task.status.replaceAll("_", " ")}</code>
              </article>
            ))}
          </div>
        </section>

        <aside className={styles.chat}>
          <div className={styles.chatHeader}>
            <div><span>Hermes live thread</span><i data-live={data.production.status === "working"} /></div>
            <small>{activeTask ? `${activeTask.role} · ${activeTask.skill}` : "Production record"}</small>
            {data.production.status === "working" && <p><b>LIVE</b> Hermes is inside this skill now. Checkpoints appear here as they land.</p>}
          </div>
          <div className={styles.messages}>
            {data.messages.length === 0 && (
              <div className={styles.emptyMessage}>Hermes’s progress and your direction will appear here.</div>
            )}
            {data.messages.map((message) => (
              <article className={styles.message} data-author={message.author} key={message._id}>
                <div>
                  <strong>{message.author === "artist" ? "You" : message.author === "system" ? "AfterImage" : "Hermes"}</strong>
                  <span>{formatTime(message.createdAt)} · {message.status}</span>
                </div>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
          <form className={styles.composer} onSubmit={submit}>
            <div className={styles.composerContext}>
              <span>{activeTask?.role ?? "Production"}</span>
              <b>{activeTask?.skill ?? "complete"}</b>
            </div>
            <textarea
              aria-label="Nudge Hermes"
              onChange={(event) => setText(event.target.value)}
              placeholder={activeTask ? `Nudge the ${activeTask.role}…` : "Production complete"}
              value={text}
              disabled={!canChat}
            />
            <button disabled={!text.trim() || sending || !canChat} type="submit">
              {sending ? "Sending…" : "Send nudge →"}
            </button>
          </form>
        </aside>
      </div>
    </main>
  );
}
