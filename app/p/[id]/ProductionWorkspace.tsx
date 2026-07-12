"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

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
            <span>Production conversation</span>
            <small>Direction is attached to the active Hermes skill</small>
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
