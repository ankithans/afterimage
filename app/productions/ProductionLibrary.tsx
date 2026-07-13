"use client";

import { useQuery } from "convex/react";
import Image from "next/image";
import Link from "next/link";
import { useState, type PointerEvent } from "react";

import { api } from "@/convex/_generated/api";

import styles from "./productions.module.css";

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(timestamp);
}

type CoverAsset = { kind: string; url: string };

function ArtifactCover({ assets }: { assets: CoverAsset[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = assets[activeIndex];
  const selectFromPointer = (event: PointerEvent<HTMLSpanElement>) => {
    if (assets.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(.999, (event.clientX - bounds.left) / bounds.width));
    setActiveIndex(Math.floor(position * assets.length));
  };

  return (
    <span
      aria-label={assets.length > 1 ? `Preview ${activeIndex + 1} of ${assets.length}` : undefined}
      className={styles.cover}
      data-kind={active?.kind ?? "empty"}
      onPointerLeave={() => setActiveIndex(0)}
      onPointerMove={selectFromPointer}
    >
      {active?.url && (active.kind === "generated_clip" || active.kind === "master") ? (
        <video autoPlay key={active.url} loop muted playsInline preload="metadata" src={active.url} />
      ) : active?.url ? (
        <i key={active.url} style={{ backgroundImage: `url(${active.url})` }} />
      ) : (
        <b>afterimage<span>.</span></b>
      )}
      <small>{active?.kind?.replaceAll("_", " ") ?? "Awaiting first frame"}</small>
      {assets.length > 1 && (
        <span aria-hidden="true" className={styles.frames}>
          {assets.map((asset, index) => <i className={index === activeIndex ? styles.activeFrame : undefined} key={`${asset.kind}-${asset.url}`} />)}
        </span>
      )}
    </span>
  );
}

export function ProductionLibrary() {
  const productions = useQuery(api.productions.list);

  return (
    <main className={styles.page}>
      <header className={styles.navbar}>
        <Link className={styles.brand} href="/">
          <Image alt="" height={24} priority src="/brand/logo-transparent.png" width={24} />
          <span>afterimage<b>.</b></span>
        </Link>
        <span className={styles.navLabel}>Production library</span>
        <Link className={styles.newButton} href="/new" target="_blank">New production ↗</Link>
      </header>

      <section className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>The work in progress</span>
          <h1>All productions.</h1>
        </div>
        <p>Every song, decision, Hermes thread, and delivered master lives here.</p>
      </section>

      <section className={styles.list} aria-live="polite">
        {productions === undefined && <div className={styles.empty}>Loading the production ledger…</div>}
        {productions?.length === 0 && <div className={styles.empty}>No productions yet. Start with one song.</div>}
        {productions?.map((production, index) => (
          <Link className={styles.production} data-status={production.status} href={`/p/${production._id}`} key={production._id}>
            <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
            <ArtifactCover assets={production.covers ?? (production.cover ? [production.cover] : [])} />
            <div className={styles.titleBlock}>
              <strong>{production.title}</strong>
              <p>{production.intent || "No creative brief added."}</p>
            </div>
            <time>{formatDate(production.createdAt)}</time>
            <span className={styles.status}><i />{production.status.replaceAll("_", " ")}</span>
            <b className={styles.open}>Open workspace →</b>
          </Link>
        ))}
      </section>
    </main>
  );
}
