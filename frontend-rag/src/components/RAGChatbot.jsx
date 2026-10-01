import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FiPaperclip, FiSend, FiPlus, FiMenu, FiX, FiCopy, FiCheck, FiSliders, FiTrash2, FiChevronDown, FiLoader } from "react-icons/fi";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
// A random private id for this browser, so your documents are not shared with other visitors.
const SID = (() => {
  try {
    let s = localStorage.getItem("docuchat-sid");
    if (!s) { s = crypto.randomUUID(); localStorage.setItem("docuchat-sid", s); }
    return s;
  } catch { return "public"; }
})();
const SID_HEADER = { "x-session-id": SID };
const ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.html,.htm,.png,.jpg,.jpeg,.tiff,.bmp,.webp";

// Used only if the backend /models list cannot be loaded.
const FALLBACK = [
  { provider: "groq", id: "openai/gpt-oss-120b", name: "gpt-oss-120b" },
  { provider: "groq", id: "openai/gpt-oss-20b", name: "gpt-oss-20b" },
];
const PROVIDERS = [["groq", "Groq"], ["openrouter", "OpenRouter (free)"]];

const MODES = {
  ask: { label: "Ask", note: "Get an answer", styles: ["Direct answer", "Step by step", "Quote the document"] },
  summarize: { label: "Summarize", note: "Shorten it", styles: ["Short summary", "Detailed summary", "Bullet points"] },
  facts: { label: "Key facts", note: "Pull out details", styles: ["Dates and numbers", "Names and places", "Action items"] },
  explain: { label: "Explain", note: "Make it clear", styles: ["Simple words", "Like a teacher", "With examples"] },
  review: { label: "Review", note: "Improve it", styles: ["Find mistakes", "Suggest changes", "Give a score"] },
};
const LENGTHS = [["small", "Small", "Short and to the point"], ["medium", "Medium", "Balanced detail"], ["high", "High", "In-depth and detailed"]];
const STARTERS = [
  ["summarize", "Summarize my document in 5 points"],
  ["facts", "List every date and number I should know"],
  ["explain", "Explain the main idea in simple words"],
  ["review", "Find mistakes and suggest changes"],
];

const primary = "bg-gold text-[#1a1305] font-semibold rounded-xl px-5 py-2.5 transition hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed";
const chipCls = (on) => `flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2 text-left transition hover:-translate-y-0.5 active:scale-95 ${on ? "border-gold bg-gold/10" : "border-line hover:border-mute"}`;
const trashCls = "text-mute transition hover:scale-125 hover:text-red-400 active:scale-90";

const loadChats = () => { try { return JSON.parse(localStorage.getItem("docuchat-chats")) || []; } catch { return []; } };

function DocIcon({ size = 64, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="12" y="6" width="40" height="52" rx="5" fill="#f3efe4" />
      <rect x="20" y="18" width="24" height="5" rx="2" fill="#2b313c" />
      <rect x="20" y="28" width="24" height="7" rx="2" fill="#f0b64a" />
      <rect x="20" y="40" width="16" height="4" rx="2" fill="#2b313c" />
      <rect x="20" y="48" width="20" height="3" rx="1.5" fill="#9aa1ad" />
    </svg>
  );
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="mt-1 flex items-center gap-1 text-xs text-mute transition hover:text-white"
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? <FiCheck /> : <FiCopy />} {done ? "Copied" : "Copy"}
    </button>
  );
}

// Model list like the Gemini picture: opens above the message box.
function ModelPicker({ models, value, onChange, errors = {} }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const cur = models.find((m) => m.provider === value.provider && m.id === value.id);
  const filtered = models.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex max-w-[170px] items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10 active:scale-95">
        <span className="truncate">{cur ? cur.name : value.id}</span><FiChevronDown className={`flex-none transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-40 mb-3 w-[min(340px,85vw)] animate-pop rounded-2xl border border-line bg-panel p-2 shadow-2xl">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models..."
              className="mb-2 w-full rounded-lg bg-black/30 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-gold" />
            <div className="max-h-72 overflow-y-auto">
              {errors.backend && <div className="px-3 py-2 text-xs text-red-300">{errors.backend}</div>}
              {PROVIDERS.map(([p, label]) => {
                const list = filtered.filter((m) => m.provider === p);
                if (!list.length) return errors[p] ? <div key={p} className="px-3 py-2 text-xs text-red-300">{label} could not load: {errors[p]}</div> : null;
                return (
                  <div key={p}>
                    <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-mute">{label}</div>
                    {list.map((m) => {
                      const on = m.provider === value.provider && m.id === value.id;
                      return (
                        <button key={p + m.id} onClick={() => { onChange(m); setOpen(false); }}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/10">
                          <span className="w-4 text-gold">{on && <FiCheck />}</span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm">{m.name}</span><span className="block truncate text-xs text-mute">{m.id}</span></span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {!filtered.length && <div className="px-3 py-4 text-sm text-mute">No model found</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function RAGChatbot() {
  const [started, setStarted] = useState(false);
  const [chats, setChats] = useState(loadChats);
  const [activeId, setActiveId] = useState(null);
  const [docs, setDocs] = useState([]);
  const [pending, setPending] = useState([]);
  const [gone, setGone] = useState([]);
  const [models, setModels] = useState(FALLBACK);
  const [modelErr, setModelErr] = useState({});
  const [model, setModel] = useState({ provider: "groq", id: "openai/gpt-oss-120b" });
  const [mode, setMode] = useState("ask");
  const [style, setStyle] = useState(MODES.ask.styles[0]);
  const [length, setLength] = useState("medium");
  const [panel, setPanel] = useState(false);
  const [menu, setMenu] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef(null);
  const fileRef = useRef(null);

  const chat = chats.find((c) => c.id === activeId);
  const messages = chat ? chat.messages : [];
  const okDocs = docs.filter((d) => d.status === "success");
  const ready = okDocs.length > 0;
  const curModel = models.find((m) => m.provider === model.provider && m.id === model.id);

  useEffect(() => {
    fetch(`${API}/models`).then((r) => r.json()).then((d) => { if (d.models?.length) { setModels(d.models); setModelErr(d.errors || {}); } else setModelErr({ backend: "The backend did not send a model list. Replace main.py and restart the backend." }); }).catch(() => setModelErr({ backend: "Cannot reach the backend (/models). Is it running?" }));
    fetch(`${API}/documents`, { headers: SID_HEADER }).then((r) => r.json()).then((l) => Array.isArray(l) && setDocs(l.map((f, i) => ({ id: `old-${i}`, name: f.filename, status: f.status, note: f.note })))).catch(() => {});
  }, []);
  useEffect(() => { try { localStorage.setItem("docuchat-chats", JSON.stringify(chats)); } catch { /* ignore */ } }, [chats]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, thinking]);

  const pickMode = (m) => { setMode(m); setStyle(MODES[m].styles[0]); };
  // Play the fade-out animation first, then really delete.
  const removeAnimated = (key, fn) => {
    setGone((g) => [...g, key]);
    setTimeout(() => { fn(); setGone((g) => g.filter((x) => x !== key)); }, 250);
  };

  const upload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    setPending((p) => [...p, ...files.map((f) => f.name)]);
    try {
      const res = await fetch(`${API}/upload`, { method: "POST", headers: SID_HEADER, body: form });
      const data = await res.json();
      setDocs((d) => [...d, ...data.files.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.filename, status: f.status, note: f.message }))]);
    } catch {
      setDocs((d) => [...d, ...files.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, status: "error", note: "Upload failed. Is the backend running?" }))]);
    } finally { setPending((p) => p.filter((n) => !files.some((f) => f.name === n))); }
  };

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || thinking) return;
    const history = messages.filter((m) => !m.error).slice(-8).map((m) => ({ role: m.role === "bot" ? "assistant" : "user", content: m.text }));
    let id = activeId;
    if (!id) {
      id = Date.now();
      setChats((cs) => [{ id, title: q.slice(0, 40), messages: [] }, ...cs]);
      setActiveId(id);
    }
    const add = (msg) => setChats((cs) => cs.map((c) => (c.id === id ? { ...c, messages: [...c.messages, msg] } : c)));
    add({ role: "user", text: q });
    setInput("");
    setThinking(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(`${API}/chat`, {
        signal: ctrl.signal,
        method: "POST",
        headers: { "Content-Type": "application/json", ...SID_HEADER },
        body: JSON.stringify({ question: q, mode, style, length, provider: model.provider, model: model.id, use_docs: ready, history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) add({ role: "bot", error: true, text: data.detail || "Something went wrong. Please try again." });
      else add({ role: "bot", text: data.answer, sources: data.sources });
    } catch (err) {
      add({ role: "bot", error: true, text: err.name === "AbortError" ? "This is taking too long. The model may be busy. Try again or choose another model." : "Cannot reach the backend. Start it with `uv run uvicorn main:app --reload` in the app folder." });
    } finally { clearTimeout(timer); setThinking(false); }
  };

  if (!started) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-5 px-6 text-center">
        <DocIcon size={88} className="animate-float" />
        <h1 className="animate-rise font-display text-5xl font-semibold">DocuChat AI</h1>
        <p className="animate-rise max-w-md leading-relaxed text-mute [animation-delay:120ms]">
          Chat like normal, or add your files and ask questions, get summaries and pull out key facts from your own documents.
        </p>
        <button className={`${primary} animate-rise [animation-delay:240ms]`} onClick={() => setStarted(true)}>Start chatting</button>
        <small className="animate-rise text-mute [animation-delay:360ms]">PDF, Word, PowerPoint, Excel, CSV, text and images</small>
      </main>
    );
  }

  return (
    <div className="flex h-full">
      <aside className={`fixed inset-y-0 left-0 z-20 flex w-[280px] flex-none flex-col gap-2 overflow-y-auto border-r border-line bg-panel p-4 transition-transform duration-300 md:static md:translate-x-0 ${menu ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-1 flex items-center gap-2.5 font-display text-lg font-semibold"><DocIcon size={28} /> DocuChat AI
          <button className="ml-auto text-mute md:hidden" onClick={() => setMenu(false)} aria-label="Close menu"><FiX /></button>
        </div>
        <button className={`${primary} flex items-center justify-center gap-2`} onClick={() => { setActiveId(null); setMenu(false); }}><FiPlus /> New chat</button>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-mute">Documents</h3>
        <div className="cursor-pointer rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-mute transition hover:scale-[1.02] hover:border-gold hover:text-white"
          onClick={() => fileRef.current.click()} onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
          Drop files here or click to add
          <small className="mt-1 block text-xs">You can choose many files at once</small>
        </div>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        <ul className="flex flex-col gap-0.5 text-sm">
          {docs.map((d) => (
            <li key={d.id} title={d.note} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white/5 ${gone.includes(d.id) ? "animate-out" : "animate-rise"}`}>
              <span className={`h-2 w-2 flex-none rounded-full ${d.status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
              <div className="min-w-0 flex-1"><div className="truncate">{d.name}</div>{d.status !== "success" && <div className="text-xs text-red-300">{d.note}</div>}</div>
              <button className={trashCls} onClick={() => removeAnimated(d.id, () => { if (d.status === "success") fetch(`${API}/documents/${encodeURIComponent(d.name)}`, { method: "DELETE", headers: SID_HEADER }).catch(() => {}); setDocs((x) => x.filter((y) => y.id !== d.id)); })} aria-label={`Delete ${d.name}`}><FiTrash2 /></button>
            </li>
          ))}
          {pending.map((n, i) => (
            <li key={n + i} className="flex animate-pulse items-center gap-2 px-2 py-1.5 text-mute"><FiLoader className="animate-spin" /><span className="truncate">Reading {n}...</span></li>
          ))}
          {!docs.length && !pending.length && <li className="px-2 py-1.5 text-mute">No documents yet</li>}
        </ul>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-mute">Recent chats</h3>
        <ul className="flex flex-col gap-0.5 text-sm">
          {chats.map((c) => (
            <li key={c.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white/5 ${gone.includes(c.id) ? "animate-out" : "animate-rise"} ${c.id === activeId ? "bg-white/10" : ""}`}>
              <button className="flex-1 truncate text-left" onClick={() => { setActiveId(c.id); setMenu(false); }}>{c.title}</button>
              <button className={trashCls} onClick={() => removeAnimated(c.id, () => { setChats((cs) => cs.filter((x) => x.id !== c.id)); if (c.id === activeId) setActiveId(null); })} aria-label={`Delete chat ${c.title}`}><FiTrash2 /></button>
            </li>
          ))}
          {!chats.length && <li className="px-2 py-1.5 text-mute">No chats yet</li>}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:px-6">
          <button className="text-xl text-mute md:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><FiMenu /></button>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{ready ? `Chatting with ${okDocs.length} document(s)` : "Simple chat"}</div>
            <div className="truncate text-xs text-mute">{curModel ? curModel.name : model.id} · {MODES[mode].label} · {style} · {LENGTHS.find((l) => l[0] === length)[1]}</div>
          </div>
          <button className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm transition hover:border-gold active:scale-95" onClick={() => setPanel(!panel)}>
            <FiSliders className={`transition-transform ${panel ? "rotate-90" : ""}`} /> {panel ? "Close" : "Options"}
          </button>
        </header>

        {panel && (
          <div className="flex animate-pop flex-col gap-3 border-b border-line bg-panel px-4 py-4 md:px-6">
            <div className="flex flex-wrap gap-2">
              {Object.entries(MODES).map(([k, m]) => (<button key={k} className={chipCls(k === mode)} onClick={() => pickMode(k)}>{m.label}<small className="text-mute">{m.note}</small></button>))}
            </div>
            <div className="flex flex-wrap gap-2">
              {MODES[mode].styles.map((s) => (<button key={s} className={chipCls(s === style)} onClick={() => setStyle(s)}>{s}</button>))}
            </div>
            <div className="flex flex-wrap gap-2">
              {LENGTHS.map(([k, n, d]) => (<button key={k} className={chipCls(k === length)} onClick={() => setLength(k)}>{n}<small className="text-mute">{d}</small></button>))}
            </div>
          </div>
        )}

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-6 md:px-6">
          {!messages.length && (
            <div className="mx-auto mt-[6vh] flex w-full max-w-3xl animate-rise flex-col items-center gap-2 text-center">
              <DocIcon size={56} className="animate-float" />
              <h2 className="mt-2 font-display text-3xl font-semibold">{ready ? "What do you want to know?" : "Say hello or add a document"}</h2>
              <p className="mb-3 text-mute">{ready ? "Pick an idea or type your own question." : "You can chat normally, or use the paper clip to add files."}</p>
              <div className="grid w-full gap-2.5 sm:grid-cols-2">
                {STARTERS.map(([m, t], i) => (
                  <button key={t} disabled={!ready} onClick={() => { pickMode(m); send(t); }} style={{ animationDelay: `${i * 80}ms` }}
                    className="flex animate-rise flex-col gap-1.5 rounded-2xl border border-line p-4 text-left leading-snug transition hover:-translate-y-1 hover:border-gold hover:bg-white/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0">
                    <small className="text-mute">{MODES[m].label}</small>{t}
                  </button>
                ))}
              </div>
              {!ready && <small className="mt-1 text-mute">Idea cards turn on after you add a document.</small>}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`mx-auto flex w-full max-w-3xl animate-rise flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              {m.role === "user" ? (
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-[#232b37] px-4 py-2.5">{m.text}</div>
              ) : (
                <div className={`max-w-full break-words ${m.error ? "border-l-2 border-red-400 pl-3 text-red-200" : ""}`}>
                  <div className="prose prose-invert max-w-none prose-headings:font-display prose-headings:font-semibold prose-a:text-gold prose-blockquote:border-gold prose-code:before:content-none prose-code:after:content-none prose-pre:bg-black/40">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: (p) => <div className="overflow-x-auto"><table {...p} /></div> }}>{m.text}</ReactMarkdown>
                  </div>
                  {!m.error && <CopyBtn text={m.text} />}
                  {m.sources?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{m.sources.map((x) => <span key={x} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-mute">{x}</span>)}</div>}
                </div>
              )}
            </div>
          ))}
          {thinking && (
            <div className="mx-auto flex w-full max-w-3xl gap-1.5 py-2">
              {[0, 150, 300].map((d) => <i key={d} style={{ animationDelay: `${d}ms` }} className="h-2 w-2 animate-bounce rounded-full bg-gold" />)}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <footer className="flex flex-col items-center gap-2 px-4 pb-4 pt-2 md:px-6">
          <div className="flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-line bg-panel p-2 pl-3 transition focus-within:border-gold focus-within:shadow-[0_0_0_3px_rgba(240,182,74,0.12)]">
            <button className="p-2.5 text-xl text-mute transition hover:rotate-12 hover:text-gold active:scale-90" onClick={() => fileRef.current.click()} aria-label="Add files"><FiPaperclip /></button>
            <textarea rows={1} value={input} placeholder={ready ? "Ask about your documents..." : "Message DocuChat..."}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="max-h-36 flex-1 resize-none bg-transparent py-2.5 leading-normal outline-none" />
            <ModelPicker models={models} errors={modelErr} value={model} onChange={(m) => setModel({ provider: m.provider, id: m.id })} />
            <button className={`${primary} group flex items-center gap-2`} disabled={!input.trim() || thinking} onClick={() => send()}>
              <FiSend className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /> Send
            </button>
          </div>
          <small className="text-xs text-mute">Answers can be wrong. Check important facts.</small>
        </footer>
      </section>
    </div>
  );
}
