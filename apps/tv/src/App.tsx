import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Matcher,
  UNKNOWN_RESPONSE,
  addressed,
  computeToday,
  isQuestion,
  memberById,
  nextMessage,
  resolveAnswer,
  type Answer,
  type DoorCard,
  type Household,
  type Message,
  type Moment,
  type TodayBoard,
} from "../../../packages/core/src";
import { emit, native, onNative } from "./bridge";
import { Connection, resolveSettings, type TvState } from "./connection";
import { playMedia, say, stopVoice } from "./voice";

type Overlay =
  | { kind: "answer"; answer: Answer; heard: string }
  | { kind: "unknown"; heard: string }
  | { kind: "door"; card: DoorCard }
  | { kind: "message"; message: Message }
  | { kind: "story"; moment: Moment };

const REST_AFTER_MS = 5 * 60_000;
const MOMENT_EVERY_MS = 45_000;
const DEV = new URLSearchParams(location.search).has("dev");

export function App() {
  const settings = useMemo(resolveSettings, []);
  if (!settings) return <Unpaired />;
  return <Screen settings={settings} />;
}

function Unpaired() {
  return (
    <div className="screen day unpaired">
      <div className="unpaired-box">
        <div className="brand">Mantel</div>
        <p>This TV is not connected to a family yet.</p>
        <p className="small">Press the Menu button on the remote to enter the six-digit code from the family app.</p>
      </div>
    </div>
  );
}

function Screen({ settings }: { settings: NonNullable<ReturnType<typeof resolveSettings>> }) {
  const [state, setState] = useState<TvState>();
  const [online, setOnline] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const [present, setPresent] = useState(!native.available);
  const [absentSince, setAbsentSince] = useState<number | undefined>();
  const [overlay, setOverlay] = useState<Overlay | undefined>();
  const [momentIndex, setMomentIndex] = useState(0);
  const [camera, setCamera] = useState(false);
  const dismissedDoor = useRef<string | undefined>(undefined);
  const lastShown = useRef(new Map<string, number>());
  const overlayTimer = useRef<number | undefined>(undefined);

  const conn = useMemo(
    () =>
      new Connection(
        settings,
        (s) => {
          setState(s);
          setNowMs(Date.now());
        },
        setOnline,
      ),
    [settings],
  );

  useEffect(() => {
    void conn.start();
    native.setKeepScreenOn(true);
    return () => conn.stop();
  }, [conn]);

  const now = conn.now();
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const h = state?.household;
  const board = useMemo(() => (h ? computeToday(h, now) : undefined), [h, Math.floor(now / 60_000)]);
  const matcher = useMemo(() => (h ? new Matcher(h, h.topics) : undefined), [h]);
  const moments = useMemo(() => {
    const all = h?.moments ?? [];
    return board?.mode === "evening" ? all.filter((m) => m.calm) : all;
  }, [h, board?.mode]);
  const moment = moments.length ? moments[momentIndex % moments.length] : undefined;

  useEffect(() => {
    if (h) native.setListening(h.settings.listening);
  }, [h?.settings.listening]);

  const closeOverlay = useCallback(() => {
    window.clearTimeout(overlayTimer.current);
    setOverlay((o) => {
      if (o?.kind === "door") dismissedDoor.current = o.card.id;
      return undefined;
    });
    stopVoice();
  }, []);

  const showFor = useCallback((o: Overlay, seconds: number) => {
    window.clearTimeout(overlayTimer.current);
    setOverlay(o);
    overlayTimer.current = window.setTimeout(() => setOverlay((cur) => (cur === o ? undefined : cur)), seconds * 1000);
  }, []);

  // A spoken question: match it, answer with the family's words, and record it.
  const onHeard = useCallback(
    (text: string) => {
      if (!h || !matcher || !board) return;
      if (!addressed(text, h.settings.listening)) return;
      if (overlay?.kind === "door" || overlay?.kind === "message") return;
      const m = matcher.match(text);
      if (m.kind === "answer") {
        const answer = resolveAnswer(h, m.topic, conn.now());
        conn.send("question", { text, topicId: m.topic.id, score: Number(m.score.toFixed(3)) });
        showFor({ kind: "answer", answer, heard: text }, h.settings.answerSeconds);
        void say(conn, { text: answer.speech, audio: answer.audio });
      } else if (m.reason !== "not-a-question" && m.reason !== "empty") {
        conn.send("question", { text, topicId: null, score: Number((m.best?.score ?? 0).toFixed(3)) });
        showFor({ kind: "unknown", heard: text }, Math.max(12, h.settings.answerSeconds - 5));
        void say(conn, { text: `${UNKNOWN_RESPONSE.speech} ${board.speech}${board.next ? ` ${board.next.speech}.` : ""}` });
      }
    },
    [h, matcher, board, overlay, conn, showFor],
  );

  // Native events: presence, speech, the Back key.
  useEffect(
    () =>
      onNative((e) => {
        if (e.type === "presence") {
          setPresent((was) => {
            if (was !== e.present) conn.send(e.present ? "presence.start" : "presence.end", e.confidence !== undefined ? { confidence: e.confidence } : undefined);
            return e.present;
          });
          setAbsentSince(e.present ? undefined : Date.now());
        } else if (e.type === "speech" && e.final) {
          onHeard(e.text);
        } else if (e.type === "key" && e.key === "back") {
          closeOverlay();
        } else if (e.type === "camera") {
          setCamera(e.active);
        }
      }),
    [conn, onHeard, closeOverlay],
  );

  // The doorbell: a new card interrupts everything, once.
  const card = state?.doorCard;
  useEffect(() => {
    if (!card || dismissedDoor.current === card.id) return;
    const remaining = Date.parse(card.expiresAt) - conn.now();
    if (remaining <= 0) return;
    setOverlay((o) => (o?.kind === "door" && o.card.id === card.id ? { kind: "door", card } : o?.kind === "door" ? o : { kind: "door", card }));
    window.clearTimeout(overlayTimer.current);
    overlayTimer.current = window.setTimeout(() => {
      dismissedDoor.current = card.id;
      setOverlay((o) => (o?.kind === "door" ? undefined : o));
    }, remaining);
  }, [card?.id, card?.snapshot]);
  useEffect(() => {
    if (card && dismissedDoor.current !== card.id) void say(conn, { text: card.speech });
  }, [card?.id]);

  // Family messages play when the person is in the room.
  useEffect(() => {
    if (!h || overlay || !present) return;
    const m = nextMessage(h, conn.now(), present);
    if (!m) return;
    setOverlay({ kind: "message", message: m });
    void playMedia(conn.mediaUrl(m.media)).then(() => {
      conn.send("message.played", { id: m.id, from: m.from });
      setTimeout(() => setOverlay((o) => (o?.kind === "message" && o.message.id === m.id ? undefined : o)), 4000);
    });
  }, [h, present, Math.floor(nowMs / 30_000), overlay?.kind]);

  // Moments rotate slowly while the person is here and nothing else is on screen.
  useEffect(() => {
    if (!present || overlay || moments.length < 2) return;
    const t = setInterval(() => setMomentIndex((i) => i + 1), MOMENT_EVERY_MS);
    return () => clearInterval(t);
  }, [present, overlay, moments.length]);
  useEffect(() => {
    if (!moment || !present || overlay) return;
    const last = lastShown.current.get(moment.id) ?? 0;
    if (Date.now() - last > 10 * 60_000) {
      lastShown.current.set(moment.id, Date.now());
      conn.send("moment.shown", { id: moment.id });
    }
  }, [moment?.id, present, overlay]);

  // Remote control: any key wakes the screen; OK plays a story or reads the day; Left/Right browse.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!h || !board) return;
      if (!present && native.available) setAbsentSince(undefined);
      if (ev.key === "Escape" || ev.key === "Backspace" || ev.key === "GoBack" || ev.key === "BrowserBack") {
        ev.preventDefault();
        closeOverlay();
        return;
      }
      if (overlay) {
        if (ev.key === "Enter") closeOverlay();
        return;
      }
      if (ev.key === "ArrowRight") setMomentIndex((i) => i + 1);
      else if (ev.key === "ArrowLeft") setMomentIndex((i) => i - 1 + Math.max(1, moments.length));
      else if (ev.key === "Enter") {
        if (moment?.story && !board.next?.soon) {
          showFor({ kind: "story", moment }, 40);
          conn.send("story.played", { id: moment.id });
          void say(conn, { text: moment.story.text, audio: moment.story.audio });
        } else {
          void say(conn, { text: `${board.speech}${board.next ? ` ${board.next.speech}.` : ""}` });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [h, board, overlay, moment, moments.length, present, closeOverlay, showFor, conn]);

  const resting = !present && absentSince !== undefined && Date.now() - absentSince > REST_AFTER_MS;
  const mode = board?.mode ?? "day";
  useEffect(() => {
    native.setDim(mode === "night" ? (present ? 0.25 : 0.05) : resting ? 0.3 : -1);
  }, [mode, present, resting]);

  if (!h || !board) {
    return (
      <div className="screen day">
        <div className="loading">Mantel</div>
      </div>
    );
  }

  const photo = (id?: string) => conn.mediaUrl(id);
  let body: JSX.Element;
  if (overlay?.kind === "door") body = <DoorScreen card={overlay.card} h={h} photo={photo} />;
  else if (overlay?.kind === "message") body = <MessageScreen message={overlay.message} h={h} photo={photo} />;
  else if (mode === "night") body = <NightScreen board={board} present={present} />;
  else if (overlay?.kind === "answer") body = <AnswerScreen answer={overlay.answer} heard={asWritten(overlay.heard, h)} photo={photo} />;
  else if (overlay?.kind === "story") body = <StoryScreen moment={overlay.moment} photo={photo} h={h} />;
  else if (resting) body = <RestScreen board={board} />;
  else body = <TodayScreen board={board} h={h} moment={moment} photo={photo} highlight={overlay?.kind === "unknown"} />;

  return (
    <div className={`screen ${mode}${resting ? " resting" : ""}`} style={skyStyle(now, h)}>
      {body}
      <div className="status">
        {camera && <span className="dot" title="Camera on" />}
        {!online && <span className="offline">offline</span>}
      </div>
      {DEV && <DevPanel present={present} />}
    </div>
  );
}

/** What was heard, as a person would write it: a capital first letter, capitals on the household's names, a question mark. */
function asWritten(heard: string, h: Household): string {
  const names = [...h.members.flatMap((m) => [m.name, ...(m.aliases ?? [])]), ...h.person.others.flatMap((o) => [o.name, ...(o.aliases ?? [])])];
  let s = heard.trim();
  for (const n of names) s = s.replace(new RegExp(`\\b${n.toLowerCase()}\\b`, "g"), n.charAt(0).toUpperCase() + n.slice(1));
  s = s.replace(/^./, (c) => c.toUpperCase());
  return /[?.!]$/.test(s) || !isQuestion(s) ? s : `${s}?`;
}

/** A sky band that follows the real time of day. */
function skyStyle(now: number, h: Household): React.CSSProperties {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: h.settings.timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(now));
  const hour = Number(p.find((x) => x.type === "hour")?.value ?? 12) + Number(p.find((x) => x.type === "minute")?.value ?? 0) / 60;
  const stops: [number, string][] = [
    [0, "#0b1020"], [5, "#1b2240"], [6.5, "#e8a86b"], [8, "#9cc3e6"], [12, "#7fb2e0"],
    [16, "#8fb4d8"], [18, "#e59a6a"], [19.5, "#7a4a6e"], [21, "#1c1b33"], [24, "#0b1020"],
  ];
  let sky = stops[0]![1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]!;
    const [b, cb] = stops[i + 1]!;
    if (hour >= a && hour < b) sky = mix(ca, cb, (hour - a) / (b - a));
  }
  return { ["--sky" as string]: sky };
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t)).join(",")})`;
}

type PhotoFn = (id?: string) => string | undefined;

function Portrait({ src, size = "md" }: { src?: string | undefined; size?: "sm" | "md" | "lg" }) {
  return src ? <img className={`portrait ${size}`} src={src} alt="" /> : null;
}

function TodayScreen({ board, h, moment, photo, highlight }: { board: TodayBoard; h: Household; moment?: Moment | undefined; photo: PhotoFn; highlight: boolean }) {
  const greeting = board.partOfDay === "night" ? "Good evening" : `Good ${board.partOfDay}`;
  const showMoment = moment && !(board.next?.soon);
  return (
    <div className={`today${highlight ? " highlight" : ""}`}>
      <section className="when">
        <div className="greeting">
          {greeting}, {h.person.name}
        </div>
        <div className="dayname">{board.dayName}</div>
        <div className="part">{board.partOfDay}</div>
        <div className="date">{board.dateLine}</div>
        <div className="clock">{board.clock}</div>
      </section>
      <section className="side">
        {board.next && (
          <div className={`next${board.next.soon ? " soon" : ""}`}>
            <div className="label">{board.next.soon ? "Soon" : "Next"}</div>
            <div className="next-row">
              <Portrait src={photo(board.next.photo)} size={board.next.soon ? "lg" : "md"} />
              <div className="next-line">{board.next.line}</div>
            </div>
            {board.later.length > 0 && !board.next.soon && <div className="later">Later: {board.later.join(". ")}</div>}
          </div>
        )}
        {!board.next && <div className="next quiet"><div className="next-line">A quiet day at home.</div></div>}
        {showMoment && (
          <figure className="moment" key={moment.id}>
            <img src={photo(moment.photo)} alt="" />
            <figcaption>
              {moment.caption}
              {moment.story && <span className="hint"> Press OK to hear the story.</span>}
            </figcaption>
          </figure>
        )}
      </section>
      {board.done.length > 0 && <footer className="done">{board.done.join("  ·  ")}</footer>}
    </div>
  );
}

function AnswerScreen({ answer, heard, photo }: { answer: Answer; heard: string; photo: PhotoFn }) {
  const src = photo(answer.photo);
  return (
    <div className="answer">
      <div className="heard">“{heard}”</div>
      <div className="answer-body">
        {src && <img className="answer-photo" src={src} alt="" />}
        <div className="answer-text">{answer.text}</div>
      </div>
      <div className="attribution">{answer.attribution}</div>
    </div>
  );
}

function DoorScreen({ card, h, photo }: { card: DoorCard; h: Household; photo: PhotoFn }) {
  const visitor = memberById(h, card.visitor);
  const snap = photo(card.snapshot);
  return (
    <div className={`door ${card.kind}`}>
      <div className="door-label">At the door</div>
      <div className="door-body">
        <div className="door-snapshot">{snap ? <img src={snap} alt="" /> : <div className="door-waiting" />}</div>
        <div className="door-lines">
          {visitor && <Portrait src={photo(visitor.photo)} size="lg" />}
          {card.lines.map((l, i) => (
            <div key={i} className={i === 0 ? "door-first" : "door-line"}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageScreen({ message, h, photo }: { message: Message; h: Household; photo: PhotoFn }) {
  const from = memberById(h, message.from);
  return (
    <div className="message">
      <div className="message-label">A message from {from?.name ?? "your family"}</div>
      <div className="message-body">
        <Portrait src={photo(from?.photo)} size="lg" />
        <div className="message-text">{message.text}</div>
      </div>
    </div>
  );
}

function StoryScreen({ moment, photo, h }: { moment: Moment; photo: PhotoFn; h: Household }) {
  const by = memberById(h, moment.story?.by);
  return (
    <div className="story">
      <img src={photo(moment.photo)} alt="" />
      <div className="story-text">
        <div className="story-caption">{moment.caption}</div>
        <div className="story-words">{moment.story?.text}</div>
        {by && <div className="attribution">Told by {by.name}</div>}
      </div>
    </div>
  );
}

function NightScreen({ board, present }: { board: TodayBoard; present: boolean }) {
  if (!present) return <div className="night-empty"><div className="night-clock-small">{board.clock}</div></div>;
  return (
    <div className="night">
      <div className="night-first">{board.nightLines[0]}</div>
      <div className="night-clock">{board.clock}</div>
      {board.nightLines.slice(1).map((l, i) => (
        <div key={i} className="night-line">
          {l}
        </div>
      ))}
    </div>
  );
}

function RestScreen({ board }: { board: TodayBoard }) {
  // Drifts a little every minute so nothing is burnt into the panel.
  const m = Number(board.clock.split(":")[1] ?? 0);
  const x = ((m * 37) % 20) - 10;
  const y = ((m * 23) % 14) - 7;
  return (
    <div className="rest" style={{ transform: `translate(${x}vw, ${y}vh)` }}>
      <div className="rest-day">{board.headline}</div>
      <div className="rest-clock">{board.clock}</div>
    </div>
  );
}

/** Browser development only: stand in for the camera and the microphone. */
function DevPanel({ present }: { present: boolean }) {
  const [text, setText] = useState("");
  return (
    <div className="dev" onKeyDown={(e) => e.stopPropagation()}>
      <button onClick={() => emit({ type: "presence", present: !present })}>{present ? "Leave the room" : "Enter the room"}</button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) emit({ type: "speech", text, final: true });
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something to Mantel" />
      </form>
    </div>
  );
}
