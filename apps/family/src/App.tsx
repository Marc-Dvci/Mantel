import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Alert, Guidance, Moment, PlanItem, Topic, TruthPolicy } from "../../../packages/core/src";
import { Api, ApiError, mediaUrl, savedToken, saveToken, type Drafted, type Overview } from "./api";

type Tab = "home" | "plan" | "answers" | "moments" | "messages" | "digest" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "plan", label: "Plan" },
  { id: "answers", label: "Answers" },
  { id: "moments", label: "Moments" },
  { id: "messages", label: "Messages" },
  { id: "digest", label: "Digest" },
  { id: "settings", label: "Settings" },
];

const DEMO_MEMBERS = [
  { token: "demo-sarah", name: "Sarah", role: "Daughter, primary caregiver" },
  { token: "demo-tom", name: "Tom", role: "Grandson" },
  { token: "demo-anna", name: "Anna", role: "Home aide" },
];

export function App() {
  const [token, setToken] = useState(savedToken());
  if (!token) return <SignIn onToken={(t) => (saveToken(t), setToken(t))} />;
  return <Signed api={new Api(token)} onSignOut={() => (saveToken(undefined), setToken(undefined))} />;
}

function SignIn({ onToken }: { onToken: (t: string) => void }) {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { demo?: boolean }) => setDemo(Boolean(h.demo)))
      .catch(() => undefined);
  }, []);
  return (
    <main className="signin">
      <h1>Mantel</h1>
      <p className="lede">The living-room TV that answers, in your family's words.</p>
      {demo ? (
        <>
          <p className="muted">Demo household. Sign in as:</p>
          {DEMO_MEMBERS.map((m) => (
            <button key={m.token} className="member" onClick={() => onToken(m.token)}>
              <strong>{m.name}</strong>
              <span>{m.role}</span>
            </button>
          ))}
        </>
      ) : (
        <p className="muted">Open the sign-in link your family sent you.</p>
      )}
    </main>
  );
}

function useOverview(api: Api) {
  const [o, setO] = useState<Overview>();
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    try {
      setO(await api.overview());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    let stop = false;
    void (async () => {
      await refresh();
      let since = -1;
      while (!stop) {
        try {
          const { version } = await api.wait(since);
          if (version !== since) {
            since = version;
            await refresh();
          }
        } catch {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [api, refresh]);
  return { o, error, refresh };
}

function Signed({ api, onSignOut }: { api: Api; onSignOut: () => void }) {
  const { o, error, refresh } = useOverview(api);
  const [tab, setTab] = useState<Tab>((location.hash.slice(1) as Tab) || "home");
  useEffect(() => {
    location.hash = tab;
    window.scrollTo(0, 0);
  }, [tab]);
  if (error && !o) {
    return (
      <main className="signin">
        <p>{error}</p>
        <button className="primary" onClick={onSignOut}>
          Sign in again
        </button>
      </main>
    );
  }
  if (!o) return <main className="loading">Loading…</main>;
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Something went wrong");
    }
    await refresh();
  };
  const props = { o, api, act, go: setTab };
  const pendingCount = o.pending.topics.length + o.pending.moments.length + o.pending.messages.length;
  const openAlerts = o.alerts.filter((a) => !a.acknowledgedAt && a.urgency !== "info").length;
  return (
    <div className="app">
      <header className="top">
        <div>
          <div className="brand">Mantel</div>
          <div className="who">{o.household.name}</div>
        </div>
        <div className="me">{o.me.name}</div>
      </header>
      <main className="content">
        {tab === "home" && <Home {...props} />}
        {tab === "plan" && <Plan {...props} />}
        {tab === "answers" && <Answers {...props} />}
        {tab === "moments" && <Moments {...props} />}
        {tab === "messages" && <Messages {...props} />}
        {tab === "digest" && <DigestView {...props} />}
        {tab === "settings" && <SettingsView {...props} onSignOut={onSignOut} />}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "home" && openAlerts + (o.me.role === "primary" ? pendingCount : 0) > 0 && <span className="badge">{openAlerts + (o.me.role === "primary" ? pendingCount : 0)}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

type Props = { o: Overview; api: Api; act: (fn: () => Promise<unknown>) => Promise<void>; go: (t: Tab) => void };

function clock(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function dayLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

function Card({ title, children, tone }: { title?: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <section className={`card ${tone ?? ""}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ Home

function Home({ o, api, act, go }: Props) {
  const tz = o.household.settings.timezone;
  const person = o.household.person.name;
  const primary = o.me.role === "primary";
  const open = o.alerts.filter((a) => !a.acknowledgedAt);
  return (
    <>
      <Card>
        <div className="status-line">
          <span className={`presence ${o.presence?.present ? "here" : ""}`} />
          {o.presence
            ? o.presence.present
              ? `${person} is in the living room (since ${clock(o.presence.at, tz)})`
              : `${person} was last in the living room at ${clock(o.presence.at, tz)}`
            : `The TV has not seen ${person} yet today`}
        </div>
        <div className="tv-says">
          The TV says: <strong>{o.today.headline}</strong>
          {o.today.next ? <> · {o.today.next.line}</> : null}
        </div>
      </Card>

      {open.length > 0 && (
        <Card title="Alerts">
          {open.map((a) => (
            <AlertRow key={a.id} a={a} o={o} onAck={() => act(() => api.ack(a.id))} />
          ))}
        </Card>
      )}

      {primary && o.pending.topics.length + o.pending.moments.length + o.pending.messages.length > 0 && (
        <Card title="Waiting for your approval" tone="warm">
          <p className="muted">Nothing reaches the TV until you approve it.</p>
          {o.pending.topics.map((t) => (
            <Pending key={t.id} what="Answer" text={`${t.label}: “${t.answer}”`} by={t.author} o={o} onApprove={() => act(() => api.approve("topics", t.id))} onRemove={() => act(() => api.remove("topics", t.id))} />
          ))}
          {o.pending.moments.map((m) => (
            <Pending key={m.id} what="Photo" text={m.caption} by={m.uploadedBy} o={o} img={mediaUrl(o, m.photo)} onApprove={() => act(() => api.approve("moments", m.id))} onRemove={() => act(() => api.remove("moments", m.id))} />
          ))}
          {o.pending.messages.map((m) => (
            <Pending key={m.id} what="Message" text={m.text} by={m.from} o={o} onApprove={() => act(() => api.approve("messages", m.id))} onRemove={() => act(() => api.remove("messages", m.id))} />
          ))}
        </Card>
      )}

      {o.unanswered.length > 0 && (
        <Card title={`Questions ${person} asked that have no answer yet`}>
          {o.unanswered.slice(0, 6).map((u) => (
            <div key={u.text} className="row">
              <div>
                <div>“{u.text}”</div>
                <div className="muted small">
                  {u.count} time{u.count === 1 ? "" : "s"} this week, last {dayLabel(u.last, tz)} {clock(u.last, tz)}
                </div>
              </div>
              <button onClick={() => go("answers")}>Add an answer</button>
            </div>
          ))}
        </Card>
      )}

      <Card title="Today">
        <PlanList items={o.household.plan.filter((p) => p.date === o.today.date)} o={o} act={act} api={api} />
      </Card>

      {o.alerts.filter((a) => a.acknowledgedAt).length > 0 && (
        <Card title="Earlier">
          {o.alerts
            .filter((a) => a.acknowledgedAt)
            .slice(0, 5)
            .map((a) => (
              <AlertRow key={a.id} a={a} o={o} />
            ))}
        </Card>
      )}
    </>
  );
}

function AlertRow({ a, o, onAck }: { a: Alert; o: Overview; onAck?: () => void }) {
  const tz = o.household.settings.timezone;
  const snap = mediaUrl(o, a.snapshot);
  return (
    <div className={`alert ${a.urgency}`}>
      {snap && <img src={snap} alt="Doorbell snapshot" />}
      <div className="alert-text">
        <div className="alert-title">{a.title}</div>
        <div className="alert-body">{a.body}</div>
        <div className="muted small">
          {dayLabel(a.at, tz)} {clock(a.at, tz)}
          {a.acknowledgedAt ? " · seen" : ""}
        </div>
        {a.kind.startsWith("door") && !a.acknowledgedAt && <div className="small muted">Open the Ring app to see the camera and talk to the visitor.</div>}
      </div>
      {onAck && (
        <button className="ghost" onClick={onAck}>
          Seen
        </button>
      )}
    </div>
  );
}

function Pending({ what, text, by, o, img, onApprove, onRemove }: { what: string; text: string; by: string; o: Overview; img?: string | undefined; onApprove: () => void; onRemove: () => void }) {
  const who = o.household.members.find((m) => m.id === by)?.name ?? by;
  return (
    <div className="row pending">
      {img && <img className="thumb" src={img} alt="" />}
      <div className="grow">
        <div className="small muted">
          {what} from {who}
        </div>
        <div>{text}</div>
      </div>
      <div className="buttons">
        <button className="primary" onClick={onApprove}>
          Approve
        </button>
        <button className="ghost" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Plan

const KIND_LABEL: Record<PlanItem["kind"], string> = {
  visit: "Visit",
  meal: "Meal",
  pills: "Pills",
  outing: "Outing",
  call: "Call",
  delivery: "Delivery",
  other: "Other",
};

function PlanList({ items, o, act, api }: { items: PlanItem[]; o: Overview; act: Props["act"]; api: Api }) {
  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time));
  if (!sorted.length) return <p className="muted">Nothing planned.</p>;
  return (
    <ul className="plan">
      {sorted.map((p) => (
        <li key={p.id} className={p.doneAt ? "done" : ""}>
          <span className="time">{p.time}</span>
          <span className="grow">
            {p.title}
            <span className="chip">{KIND_LABEL[p.kind]}</span>
          </span>
          <button className="ghost" onClick={() => act(() => api.markDone(p.id, !p.doneAt))}>
            {p.doneAt ? `Done ${clock(p.doneAt, o.household.settings.timezone)}` : "Mark done"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Plan({ o, api, act }: Props) {
  const tz = o.household.settings.timezone;
  const dates = [...new Set(o.household.plan.map((p) => p.date))].filter((d) => d >= o.today.date).sort().slice(0, 7);
  const [form, setForm] = useState({ date: o.today.date, time: "15:00", kind: "visit" as PlanItem["kind"], title: "", who: "" });
  const unusual = o.household.unusualDays.includes(o.today.date);
  return (
    <>
      <Card title="Add to the plan">
        <p className="muted small">The TV shows what comes next, and the doorbell uses visits and deliveries to know who is expected.</p>
        <div className="form-grid">
          <label>
            Day
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label>
            Time
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </label>
          <label>
            Kind
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PlanItem["kind"] })}>
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {form.kind === "visit" && (
            <label>
              Who
              <select value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value, title: form.title || `${o.household.members.find((m) => m.id === e.target.value)?.name ?? ""} is coming` })}>
                <option value="">Someone else</option>
                {o.household.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="wide">
            What the TV says
            <input value={form.title} placeholder="Sarah is coming" onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
        </div>
        <button
          className="primary"
          disabled={!form.title.trim()}
          onClick={() =>
            act(async () => {
              await api.addPlan({ date: form.date, time: form.time, kind: form.kind, title: form.title.trim(), ...(form.who ? { who: form.who } : {}) });
              setForm({ ...form, title: "" });
            })
          }
        >
          Add
        </button>
      </Card>
      {dates.map((d) => (
        <Card key={d} title={dayLabel(`${d}T12:00:00Z`, "UTC")}>
          <PlanList items={o.household.plan.filter((p) => p.date === d)} o={o} act={act} api={api} />
        </Card>
      ))}
      <Card title="An unusual day">
        <p className="muted small">Mark a day unusual (a hospital stay, a family holiday) and the change alerts leave it out.</p>
        <label className="check">
          <input type="checkbox" checked={unusual} onChange={(e) => act(() => api.setUnusual(o.today.date, e.target.checked))} /> Today is unusual
        </label>
        <span className="muted small"> ({tz})</span>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Answers

const POLICY_LABEL: Record<TruthPolicy, string> = { tell: "Tell", redirect: "Redirect", comfort: "Comfort" };

function Answers({ o, api, act }: Props) {
  const [editing, setEditing] = useState<Partial<Topic> | undefined>();
  const [guidance, setGuidance] = useState<Guidance[]>([]);
  useEffect(() => void api.guidance().then(setGuidance), [api]);
  const family = o.household.topics.filter((t) => !t.builtin);
  const builtins = o.household.topics.filter((t) => t.builtin);
  if (editing) return <TopicEditor o={o} api={api} act={act} topic={editing} guidance={guidance} onDone={() => setEditing(undefined)} />;
  return (
    <>
      <Card>
        <p>
          When {o.household.person.name} asks a question out loud, the TV answers with the words written here, the same way every time. Questions it has no answer for come back to you on the Home screen.
        </p>
        <button className="primary" onClick={() => setEditing({ policy: "tell", phrasings: [""], answer: "" })}>
          Write a new answer
        </button>
      </Card>
      <Card title="Your family's answers">
        {family.map((t) => (
          <TopicRow key={t.id} t={t} o={o} onEdit={() => setEditing(t)} />
        ))}
      </Card>
      <Card title="Answered from the plan and the clock">
        <p className="muted small">These answer from today's plan. You write what the TV says when the plan has nothing.</p>
        {builtins.map((t) => (
          <TopicRow key={t.id} t={t} o={o} onEdit={() => setEditing(t)} />
        ))}
      </Card>
    </>
  );
}

function TopicRow({ t, o, onEdit }: { t: Topic; o: Overview; onEdit: () => void }) {
  const author = o.household.members.find((m) => m.id === t.author)?.name;
  return (
    <button className="topic" onClick={onEdit}>
      <div className="topic-head">
        <strong>{t.label}</strong>
        <span className={`chip ${t.policy}`}>{POLICY_LABEL[t.policy]}</span>
        {t.audio && <span className="chip rec">Recorded</span>}
        {!t.approvedBy && <span className="chip pending">Waiting for approval</span>}
      </div>
      <div className="topic-q">“{t.phrasings[0]}”</div>
      <div className="topic-a">{t.builtin ? t.fallback || "From the plan" : t.answer}</div>
      <div className="muted small">{author ? `Written by ${author}` : ""}</div>
    </button>
  );
}

function TopicEditor({ o, api, act, topic, guidance, onDone }: { o: Overview; api: Api; act: Props["act"]; topic: Partial<Topic>; guidance: Guidance[]; onDone: () => void }) {
  const [t, setT] = useState<Partial<Topic>>({ ...topic });
  const [draft, setDraft] = useState<Drafted>();
  const [busy, setBusy] = useState(false);
  const isNew = !topic.id;
  const builtin = Boolean(topic.builtin);
  const set = (patch: Partial<Topic>) => setT((x) => ({ ...x, ...patch }));
  const save = () =>
    act(async () => {
      const phrasings = (t.phrasings ?? []).map((p) => p.trim()).filter(Boolean);
      const body: Partial<Topic> = {
        label: t.label?.trim() || phrasings[0] || "Answer",
        phrasings,
        policy: t.policy ?? "tell",
        answer: builtin ? t.answer ?? "" : (t.answer ?? "").trim(),
        fallback: (t.fallback ?? t.answer ?? "").trim(),
        ...(t.audio ? { audio: t.audio } : {}),
        ...(t.statements !== undefined ? { statements: t.statements } : {}),
      };
      if (isNew) await api.createTopic(body);
      else await api.updateTopic(topic.id!, body);
      onDone();
    });
  return (
    <>
      <Card title={isNew ? "A new answer" : t.label}>
        {isNew && guidance.length > 0 && (
          <details className="guidance">
            <summary>Start from a question families find hard</summary>
            {guidance.map((g) => (
              <div key={g.key} className="guide">
                <strong>{g.title}</strong>
                <p className="small">{g.why}</p>
                {g.options.map((opt) => (
                  <button
                    key={opt.policy}
                    className="ghost left"
                    onClick={() => set({ label: g.title.split(" ").slice(0, 4).join(" "), phrasings: [g.example.toLowerCase().replace(/[?.]/g, "")], policy: opt.policy, answer: opt.example, statements: true })}
                  >
                    <span className={`chip ${opt.policy}`}>{POLICY_LABEL[opt.policy]}</span> {opt.example}
                  </button>
                ))}
                <a className="small" href={g.source} target="_blank" rel="noreferrer">
                  Source
                </a>
              </div>
            ))}
          </details>
        )}
        {!builtin && (
          <label>
            Short name
            <input value={t.label ?? ""} placeholder="Robert" onChange={(e) => set({ label: e.target.value })} />
          </label>
        )}
        <label>
          How {o.household.person.name} asks it
          {(t.phrasings ?? [""]).map((p, i) => (
            <input
              key={i}
              value={p}
              placeholder="where is robert"
              onChange={(e) => {
                const next = [...(t.phrasings ?? [])];
                next[i] = e.target.value;
                set({ phrasings: next });
              }}
            />
          ))}
          <button className="ghost small-btn" onClick={() => set({ phrasings: [...(t.phrasings ?? []), ""] })}>
            + another way of asking
          </button>
        </label>
        {!builtin && (
          <>
            <div className="policy">
              {(["tell", "redirect", "comfort"] as TruthPolicy[]).map((p) => (
                <button key={p} className={t.policy === p ? "on" : ""} onClick={() => set({ policy: p })}>
                  {POLICY_LABEL[p]}
                </button>
              ))}
            </div>
            <p className="muted small">The family decides whether this answer tells, redirects or comforts. Mantel never chooses for you.</p>
            <label>
              What the TV says
              <textarea rows={3} value={t.answer ?? ""} onChange={(e) => (set({ answer: e.target.value }), setDraft(undefined))} />
            </label>
            {o.drafts && (
              <button
                className="ghost"
                disabled={busy || !(t.answer ?? "").trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setDraft(await api.draftAnswer(t.answer!, t.policy ?? "tell"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Thinking…" : "Suggest a calmer wording"}
              </button>
            )}
            {draft && (
              <div className="draft">
                {draft.source === "model" ? (
                  <>
                    <div className="small muted">Suggestion. It adds no names or facts; use it only if it sounds like you.</div>
                    <div className="draft-text">{draft.text}</div>
                    <button className="primary" onClick={() => (set({ answer: draft.text }), setDraft(undefined))}>
                      Use this
                    </button>
                  </>
                ) : (
                  <div className="small muted">No suggestion this time: {draft.problems.join(", ") || "keep your own words"}.</div>
                )}
              </div>
            )}
            <Recorder api={api} label="Record it in your own voice" value={t.audio} onChange={(audio) => set({ audio })} o={o} />
          </>
        )}
        <label>
          {builtin ? "When the plan has nothing, the TV says" : "If this answer expires, the TV says"}
          <input value={t.fallback ?? ""} onChange={(e) => set({ fallback: e.target.value })} />
        </label>
        <div className="buttons">
          <button className="primary" onClick={save}>
            {o.me.role === "primary" ? "Save" : "Send to Sarah for approval"}
          </button>
          <button className="ghost" onClick={onDone}>
            Cancel
          </button>
          {!isNew && !builtin && (
            <button className="ghost danger" onClick={() => act(async () => (await api.removeTopic(topic.id!), onDone()))}>
              Delete
            </button>
          )}
        </div>
      </Card>
    </>
  );
}

function Recorder({ api, label, value, onChange, o, video = false }: { api: Api; label: string; value?: string | undefined; onChange: (id: string | undefined) => void; o: Overview; video?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const rec = useRef<MediaRecorder>();
  const chunks = useRef<Blob[]>([]);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(video ? { audio: true, video: true } : { audio: true });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("saving");
        const blob = new Blob(chunks.current, { type: r.mimeType || (video ? "video/webm" : "audio/webm") });
        const { id } = await api.upload(blob);
        onChange(id);
        setState("idle");
      };
      r.start();
      rec.current = r;
      setState("recording");
    } catch {
      alert("The microphone is not available in this browser.");
    }
  };
  return (
    <div className="recorder">
      <div className="small muted">{label}</div>
      <div className="buttons">
        {state === "recording" ? (
          <button className="primary rec-on" onClick={() => rec.current?.stop()}>
            Stop
          </button>
        ) : (
          <button className="ghost" disabled={state === "saving"} onClick={start}>
            {state === "saving" ? "Saving…" : value ? "Record again" : "Record"}
          </button>
        )}
        {value && <audio controls src={mediaUrl(o, value)} />}
        {value && (
          <button className="ghost" onClick={() => onChange(undefined)}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Moments

function Moments({ o, api, act }: Props) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Card>
        <p>Photos rotate slowly on the TV while {o.household.person.name} is in the room. A story recorded in your voice plays when the OK button is pressed.</p>
        <button className="primary" onClick={() => setAdding(true)}>
          Add a photo
        </button>
      </Card>
      {adding && <MomentEditor o={o} api={api} act={act} onDone={() => setAdding(false)} />}
      <div className="grid">
        {o.household.moments.map((m) => (
          <MomentTile key={m.id} m={m} o={o} />
        ))}
      </div>
    </>
  );
}

function MomentTile({ m, o }: { m: Moment; o: Overview }) {
  return (
    <figure className="tile">
      <img src={mediaUrl(o, m.photo)} alt="" />
      <figcaption>
        {m.caption}
        {m.story && <span className="chip rec">Story</span>}
        {!m.approvedBy && <span className="chip pending">Waiting</span>}
      </figcaption>
    </figure>
  );
}

function MomentEditor({ o, api, act, onDone }: { o: Overview; api: Api; act: Props["act"]; onDone: () => void }) {
  const [photo, setPhoto] = useState<string>();
  const [people, setPeople] = useState("");
  const [place, setPlace] = useState("");
  const [year, setYear] = useState("");
  const [caption, setCaption] = useState("");
  const [captionSource, setCaptionSource] = useState<string>();
  const [story, setStory] = useState("");
  const [storyAudio, setStoryAudio] = useState<string>();
  return (
    <Card title="A new photo">
      <label>
        Photo
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setPhoto((await api.upload(f)).id);
          }}
        />
      </label>
      {photo && <img className="preview" src={mediaUrl(o, photo)} alt="" />}
      <div className="form-grid">
        <label>
          Who is in it
          <input value={people} placeholder="Robert" onChange={(e) => setPeople(e.target.value)} />
        </label>
        <label>
          Where
          <input value={place} placeholder="Lake Tahoe" onChange={(e) => setPlace(e.target.value)} />
        </label>
        <label>
          Year
          <input value={year} placeholder="1968" onChange={(e) => setYear(e.target.value)} />
        </label>
      </div>
      <button
        className="ghost"
        onClick={async () => {
          const d = await api.draftCaption({ people: people.split(/,| and /).map((s) => s.trim()).filter(Boolean), ...(place ? { place } : {}), ...(year ? { year } : {}) });
          setCaption(d.text);
          setCaptionSource(d.source === "model" ? "Suggested. Change anything that isn't right." : "Written from what you typed.");
        }}
      >
        Suggest a caption
      </button>
      <label>
        Caption on the TV
        <input value={caption} onChange={(e) => setCaption(e.target.value)} />
      </label>
      {captionSource && <div className="small muted">{captionSource}</div>}
      <label>
        The story (optional)
        <textarea rows={3} value={story} onChange={(e) => setStory(e.target.value)} placeholder="You wouldn't get out of the water all afternoon…" />
      </label>
      <Recorder api={api} label="Tell the story in your own voice" value={storyAudio} onChange={setStoryAudio} o={o} />
      <div className="buttons">
        <button
          className="primary"
          disabled={!photo || !caption.trim()}
          onClick={() =>
            act(async () => {
              await api.createMoment({
                photo: photo!,
                caption: caption.trim(),
                ...(year ? { year } : {}),
                people: people.split(/,| and /).map((s) => s.trim()).filter(Boolean),
                calm: true,
                ...(story.trim() ? { story: { text: story.trim(), ...(storyAudio ? { audio: storyAudio } : {}) } } : {}),
              });
              onDone();
            })
          }
        >
          {o.me.role === "primary" ? "Add to the TV" : "Send to Sarah for approval"}
        </button>
        <button className="ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Messages

function Messages({ o, api, act }: Props) {
  const [media, setMedia] = useState<string>();
  const [text, setText] = useState("");
  const [when, setWhen] = useState<"first-seen-after" | "at" | "evening-end">("first-seen-after");
  const [time, setTime] = useState("08:00");
  const [date, setDate] = useState(o.today.date);
  const person = o.household.person.name;
  return (
    <>
      <Card title={`Send ${person} a message`}>
        <p className="muted small">It plays once, only when {person} is in the room, never at night.</p>
        <Recorder api={api} label="Record your message" value={media} onChange={setMedia} o={o} />
        <label>
          What you say (shown as a caption)
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Day
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            When
            <select value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
              <option value="first-seen-after">When {person} is first in the room after</option>
              <option value="at">At a time</option>
              <option value="evening-end">At the end of the evening</option>
            </select>
          </label>
          {when !== "evening-end" && (
            <label>
              Time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          )}
        </div>
        <button
          className="primary"
          disabled={!media || !text.trim()}
          onClick={() =>
            act(async () => {
              await api.createMessage({
                media: media!,
                mediaKind: "audio",
                text: text.trim(),
                schedule: when === "evening-end" ? { kind: "evening-end", date } : { kind: when, date, time },
              });
              setMedia(undefined);
              setText("");
            })
          }
        >
          {o.me.role === "primary" ? "Schedule" : "Send to Sarah for approval"}
        </button>
      </Card>
      <Card title="Scheduled and played">
        {[...o.household.messages].reverse().map((m) => (
          <div key={m.id} className="row">
            <div className="grow">
              <div>{m.text}</div>
              <div className="muted small">
                {o.household.members.find((x) => x.id === m.from)?.name} · {m.schedule.date} · {m.playedAt ? `played ${clock(m.playedAt, o.household.settings.timezone)}` : m.approvedBy ? "scheduled" : "waiting for approval"}
              </div>
            </div>
            {m.media && <audio controls src={mediaUrl(o, m.media)} />}
          </div>
        ))}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Digest

function DigestView({ o, api }: Props) {
  const dates = [...new Set([o.today.date, ...o.digests])].sort().reverse();
  const [date, setDate] = useState(dates[1] ?? dates[0]!);
  const [d, setD] = useState<Awaited<ReturnType<Api["digest"]>>>();
  useEffect(() => {
    setD(undefined);
    void api.digest(date).then(setD);
  }, [api, date]);
  const change = o.alerts.filter((a) => a.kind === "change");
  return (
    <>
      <div className="date-pills">
        {dates.map((x) => (
          <button key={x} className={x === date ? "on" : ""} onClick={() => setDate(x)}>
            {x === o.today.date ? "Today so far" : dayLabel(`${x}T12:00:00Z`, "UTC")}
          </button>
        ))}
      </div>
      {change.length > 0 && (
        <Card title="A sudden change" tone="attention">
          {change.map((a) => (
            <p key={a.id}>{a.body}</p>
          ))}
          <p className="muted small">Compared with {o.household.person.name}'s own last four weeks. Slow change over months does not raise this.</p>
        </Card>
      )}
      <Card title="The day">
        {!d ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <p className="prose">{d.prose}</p>
            <div className="muted small">Written from the counts below.</div>
            <table className="facts">
              <tbody>
                <tr>
                  <td>First seen</td>
                  <td>{d.facts.firstSeen ?? "not seen"}</td>
                </tr>
                <tr>
                  <td>Last seen</td>
                  <td>{d.facts.lastSeen ?? "not seen"}</td>
                </tr>
                <tr>
                  <td>Questions</td>
                  <td>
                    {d.facts.questions}
                    {d.facts.questionsUsual !== undefined ? ` (usually about ${d.facts.questionsUsual})` : ""}
                  </td>
                </tr>
                {d.facts.topics.slice(0, 5).map((t) => (
                  <tr key={t.label}>
                    <td className="indent">{t.label}</td>
                    <td>{t.count}</td>
                  </tr>
                ))}
                <tr>
                  <td>Photos shown</td>
                  <td>{d.facts.momentsShown}</td>
                </tr>
                <tr>
                  <td>Doorbell</td>
                  <td>{d.facts.door.length ? d.facts.door.map((x) => `${x.at} ${x.kind.replace("-", " ")}`).join(", ") : "none"}</td>
                </tr>
                <tr>
                  <td>Night</td>
                  <td>
                    {d.facts.nightMinutes} min up{d.facts.nightDoorOpens ? `, door opened ${d.facts.nightDoorOpens}×` : ""}
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Settings

function SettingsView({ o, api, act, onSignOut }: Props & { onSignOut: () => void }) {
  const s = o.household.settings;
  const primary = o.me.role === "primary";
  const [pair, setPair] = useState<{ code: string; expiresAt: string }>();
  const [privacy, setPrivacy] = useState<Awaited<ReturnType<Api["privacy"]>>>();
  useEffect(() => void api.privacy().then(setPrivacy), [api]);
  const field = (label: string, value: string, key: "wake" | "bedtime") => (
    <label>
      {label}
      <input type="time" disabled={!primary} defaultValue={value} onBlur={(e) => e.target.value !== value && act(() => api.settings({ [key]: e.target.value }))} />
    </label>
  );
  return (
    <>
      <Card title="Hours">
        <div className="form-grid">
          {field("Usually up at", s.wake, "wake")}
          {field("Bedtime", s.bedtime, "bedtime")}
          <label>
            Calm evening from
            <input type="time" disabled={!primary} defaultValue={s.evening.start} onBlur={(e) => act(() => api.settings({ evening: { ...s.evening, start: e.target.value } }))} />
          </label>
          <label>
            until
            <input type="time" disabled={!primary} defaultValue={s.evening.end} onBlur={(e) => act(() => api.settings({ evening: { ...s.evening, end: e.target.value } }))} />
          </label>
        </div>
      </Card>
      <Card title="Listening">
        <div className="policy">
          {(
            [
              ["questions", "Questions"],
              ["name", "Only after “Mantel”"],
              ["off", "Off"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} disabled={!primary} className={s.listening === k ? "on" : ""} onClick={() => act(() => api.settings({ listening: k }))}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted small">Speech is recognised on the TV. Only questions meant for Mantel, and which answer was shown, leave the house.</p>
      </Card>
      <Card title="Night">
        <label className="check">
          <input type="checkbox" disabled={!primary} checked={s.nightAlerts.doorOpen} onChange={(e) => act(() => api.settings({ nightAlerts: { ...s.nightAlerts, doorOpen: e.target.checked } }))} /> Tell me if an outside door opens at night
        </label>
        <label className="check">
          <input type="checkbox" disabled={!primary} checked={s.nightAlerts.presence} onChange={(e) => act(() => api.settings({ nightAlerts: { ...s.nightAlerts, presence: e.target.checked } }))} /> Tell me when {o.household.person.name} is up at night (for a carer in the house)
        </label>
      </Card>
      {primary && (
        <Card title="Connect a TV">
          <p className="muted small">Open Mantel on the Fire TV, press Menu, and enter this code.</p>
          {pair ? <div className="pair-code">{pair.code}</div> : <button className="primary" onClick={async () => setPair(await api.pairCode())}>Show a code</button>}
        </Card>
      )}
      <Card title="Privacy">
        <p className="small">Never leaves the TV: {privacy?.neverLeavesTheTv.join("; ")}.</p>
        <p className="small">Leaves the TV: {privacy?.leavesTheTv.join("; ")}.</p>
        <p className="small muted">
          Stored: {privacy?.stored.events ?? 0} events{privacy?.stored.oldest ? ` since ${privacy.stored.oldest.slice(0, 10)}` : ""}.
        </p>
        {primary && (
          <button className="ghost danger" onClick={() =>
              confirm("Erase every stored event? Answers, photos and the plan stay.") &&
              act(async () => {
                await api.erase();
                setPrivacy(await api.privacy());
              })
            }
          >
            Erase all events
          </button>
        )}
      </Card>
      <Card>
        <button className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </Card>
    </>
  );
}
