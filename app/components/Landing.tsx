"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const TICKER_ITEMS = [
  "One song in",
  "One visual world out",
  "Cut to the beat",
  "Three directions, one pick",
  "No timelines, no plugins",
  "Your b-side deserves a film too",
];

const STAGES = [
  {
    num: "01",
    title: "Listen",
    copy: "It loops your track until it knows where the chorus breaks and what the bridge is hiding.",
    visual: (
      <div className="fv-listen" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <i
            key={i}
            style={{
              height: `${34 + ((i * 29) % 62)}%`,
              animationDelay: `${(i * 137) % 900}ms`,
            }}
          />
        ))}
      </div>
    ),
  },
  {
    num: "02",
    title: "Direct",
    copy: "Three directions come back. Real ones, with names and rules. You pick one.",
    visual: (
      <div className="fv-direct" aria-hidden>
        <i /><i /><i />
      </div>
    ),
  },
  {
    num: "03",
    title: "Produce",
    copy: "Shots get made, doubted, and remade. You never see the mess.",
    visual: <div className="fv-produce" aria-hidden />,
  },
  {
    num: "04",
    title: "Cut",
    copy: "Every cut lands on the beat. That part isn't negotiable.",
    visual: (
      <div className="fv-cut" aria-hidden>
        <i /><i /><i /><i />
      </div>
    ),
  },
  {
    num: "05",
    title: "Deliver",
    copy: "One finished film, ready to post. Tell it one thing to change and it changes just that.",
    visual: <div className="fv-deliver" aria-hidden>▶</div>,
  },
];

const TREATMENTS = [
  {
    id: "glasshouse",
    art: "art-glasshouse",
    video: "/videos/glasshouse.mp4",
    tag: "Treatment 01",
    title: "Glasshouse Memory",
    copy: "Warm decay and delayed reflections. Figures that vanish one beat after the chorus lands.",
    quip: "Good eye. The crew hoped you'd pick that one.",
  },
  {
    id: "litany",
    art: "art-litany",
    video: "/videos/litany.mp4",
    tag: "Treatment 02",
    title: "Neon Litany",
    copy: "A slow prayer in signal colors. Every light in the frame answers the vocal.",
    quip: "Bold. The director is thrilled.",
  },
  {
    id: "static",
    art: "art-static",
    video: "/videos/static.mp4",
    tag: "Treatment 03",
    title: "Salt & Static",
    copy: "Pale mornings and broken transmissions. The quiet kind of loud.",
    quip: "The quiet one. It'll hit harder that way.",
  },
];

function useReveal() {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    root.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return rootRef;
}

export default function Landing() {
  const rootRef = useReveal();
  const [scrolled, setScrolled] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const pickedTreatment = TREATMENTS.find((t) => t.id === picked);

  return (
    <div ref={rootRef}>
      <div className="grain" aria-hidden />

      <header className={`masthead ${scrolled ? "scrolled" : ""}`}>
        <div className="shell masthead-inner">
          <a className="brand" href="#top" aria-label="afterimage home">
            <Image
              src="/brand/mark.png"
              alt=""
              width={647}
              height={325}
              className="brand-mark"
              priority
            />
            <span>afterimage</span>
          </a>
          <span className="masthead-note">a film crew for musicians</span>
          <a className="button small" href="#early-access">
            Early access
          </a>
        </div>
      </header>

      <main id="top">
        {/* ————— hero ————— */}
        <section className="hero">
          <div className="beam" aria-hidden />
          <div className="shell hero-inner">
            <div>
              <span className="micro reveal visible">Early access</span>
              <h1>
                Your song
                <br />
                <em>knows</em> what it
                <br />
                looks like.
              </h1>
              <p className="hero-copy">
                A tiny film crew in your browser. Send it a track. It listens,
                pitches <b>three directions</b>, then shoots, cuts and
                delivers your video.
              </p>
              <div className="hero-actions">
                <a className="button primary" href="#early-access">
                  Send us a song →
                </a>
                <a className="button" href="#how">
                  How it works
                </a>
              </div>
              <p className="hero-footnote">
                No timelines. No plugins. No render buttons.
                <br />
                Just one decision at a time.
              </p>
            </div>

            <div className="screen-wrap reveal d1">
              <div className="screen">
                <video
                  className="screen-video"
                  src="/videos/hero-song.mp4"
                  poster="/videos/hero-song-poster.jpg"
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-label="A vintage reel-to-reel tape machine spinning under colored light"
                />
                <div className="screen-vignette" />
              </div>
              <div className="eq" aria-hidden>
                {Array.from({ length: 42 }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      height: `${26 + ((i * 37) % 74)}%`,
                      animationDuration: `${700 + ((i * 83) % 500)}ms`,
                      animationDelay: `${(i * 191) % 1100}ms`,
                    }}
                  />
                ))}
              </div>
              <div className="screen-caption">
                <span>now playing</span>
                <span>bounce · shubh</span>
              </div>
            </div>
          </div>
        </section>

        {/* ————— ticker ————— */}
        <div className="ticker" aria-hidden>
          <div className="ticker-track">
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
              <span key={i}>{item}</span>
            ))}
          </div>
        </div>

        {/* ————— how it works ————— */}
        <section id="how" className="section-pad">
          <div className="shell">
            <div className="section-head reveal">
              <span className="micro">How it works</span>
              <h2>A crew of five. One seat for you.</h2>
              <p>
                Behind the curtain there&apos;s an analyst, a director, a
                producer, an editor and someone whose whole job is worrying.
                You only hear from them when there&apos;s a decision worth
                making.
              </p>
            </div>

            <div className="strip-scroller reveal d1">
              <div className="filmstrip">
                <div className="sprockets" />
                <div className="frames">
                  {STAGES.map((stage) => (
                    <article className="frame" key={stage.num}>
                      <div className="frame-art">
                        <span className="frame-num">{stage.num}</span>
                        {stage.visual}
                      </div>
                      <div className="frame-body">
                        <strong>{stage.title}</strong>
                        <p>{stage.copy}</p>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="sprockets" />
              </div>
            </div>

            <p className="strip-note reveal d2">
              <b>Two decisions, total.</b> Pick a direction. Ask for one
              change. Everything in between is handled.
            </p>
          </div>
        </section>

        {/* ————— treatments ————— */}
        <section className="treatments section-pad">
          <div className="shell">
            <div className="section-head reveal">
              <span className="micro">The pitch</span>
              <h2>It never shows up with one idea.</h2>
              <p>
                For every song, three worlds arrive. Each has a name, a
                story, and its own rules about what&apos;s not allowed. Go on,
                pick one.
              </p>
            </div>

            <div className="cards">
              {TREATMENTS.map((t, i) => (
                <div className={`card-slot reveal d${i + 1}`} key={t.id}>
                  <button
                    type="button"
                    className={`card ${picked === t.id ? "selected" : ""}`}
                    onClick={() => setPicked(picked === t.id ? null : t.id)}
                    aria-pressed={picked === t.id}
                  >
                    <span className="card-art" aria-hidden>
                      <i className={t.art} />
                      <video
                        src={t.video}
                        autoPlay
                        muted
                        loop
                        playsInline
                      />
                      <span className="card-tag">{t.tag}</span>
                      <span className="card-check">✓</span>
                    </span>
                    <span className="card-body">
                      <strong>{t.title}</strong>
                      <p>{t.copy}</p>
                    </span>
                  </button>
                </div>
              ))}
            </div>

            <p className="cards-note reveal d3" aria-live="polite">
              {pickedTreatment ? (
                <>
                  <b>{pickedTreatment.title.toLowerCase()}</b> it is.{" "}
                  {pickedTreatment.quip}
                </>
              ) : (
                <>hover to look closer · click to choose</>
              )}
            </p>
          </div>
        </section>

        {/* ————— final call ————— */}
        <section id="early-access" className="final">
          <div className="shell">
            <div className="final-block reveal">
              <span className="micro">Early access</span>
              <h2>Make one with your song.</h2>
              <div className="final-row">
                <p>
                  We&apos;re letting in a few artists at a time while the crew
                  finds its rhythm. Send a track and one sentence about how it
                  should feel. You&apos;ll get a film back.
                </p>
                <a
                  className="button acid"
                  href="mailto:ankithans1947@gmail.com?subject=a%20song%20for%20afterimage"
                >
                  Send your song →
                </a>
              </div>
            </div>

            <footer>
              <span>afterimage · one song in, one visual world out</span>
              <span>
                <a href="mailto:ankithans1947@gmail.com">write to the crew</a>
                {" · "}© 2026
              </span>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
