import { useState, useRef, useEffect } from "react";

const API_BASE = "http://localhost:8000";

const EXT_EMOJI = {
  pdf: "📄", doc: "📝", docx: "📝",
  xls: "📊", xlsx: "📊", csv: "📊",
  ppt: "📑", pptx: "📑", txt: "📃",
  html: "🌐", htm: "🌐",
  png: "🖼️", jpg: "🖼️", jpeg: "🖼️",
  tiff: "🖼️", bmp: "🖼️", webp: "🖼️",
};

const ACCEPTED = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.html,.htm,.png,.jpg,.jpeg,.tiff,.bmp,.webp";

function fileEmoji(name) {
  const ext = name.split(".").pop().toLowerCase();
  return EXT_EMOJI[ext] ?? "📎";
}

export default function RAGChatbot() {
  const [docs, setDocs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  // ── Upload handler — accepts FileList ──
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setUploading(true);

    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));

    try {
      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();

      const newDocs = data.files.map((r) => ({
        name: r.filename,
        status: r.status,
        chunks: r.chunks_indexed ?? 0,
        message: r.message,
      }));
      setDocs((prev) => [...prev, ...newDocs]);

      const failed = data.files.filter((r) => r.status === "error");
      if (failed.length) {
        alert(`${failed.length} file(s) failed:\n` + failed.map((f) => `• ${f.filename}: ${f.message}`).join("\n"));
      }
    } catch (e) {
      alert("Upload failed. Make sure the backend is running on port 8000.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q || thinking) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    setThinking(true);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "bot", text: data.answer }]);
    } catch {
      setMessages((m) => [...m, { role: "bot", text: "⚠️ Could not reach the backend. Make sure it's running on port 8000." }]);
    } finally {
      setThinking(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

    const removeDoc = (index) => {
    setDocs((prev) => prev.filter((_, i) => i !== index));
  };

  const autoResize = (e) => {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
    setInput(el.value);
  };

  const fmtSize = (b) =>
    b == null ? "" : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

  const SUGGESTIONS = ["Summarize the key findings", "What are the main topics?", "List all action items"];
  const indexedCount = docs.filter((d) => d.status === "success").length;

  return (
    <div style={styles.shell} >
   {/* ── Sidebar ── */}
      <aside style={styles.sidebar}>
        <span style={styles.sidebarLabel}>Documents</span>

        <div
          style={styles.dropZone}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
          <span style={{ fontSize: 28 }}>📂</span>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5, textAlign: "center" }}>
            Drop files here or click to browse
          </p>
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", textAlign: "center" }}>
            PDF · XLSX · CSV · PPT · TXT ·
          </span>
        </div>

        <button
          style={{ ...styles.uploadBtn, opacity: uploading ? 0.6 : 1 }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "⏳ Uploading…" : "↑ Upload Files"}
        </button>

        {docs.length > 0 && (
          <>
            <span style={{ ...styles.sidebarLabel, marginTop: 8 }}>
              Indexed ({indexedCount}/{docs.length})
            </span>
            <div style={styles.docList}>
              {docs.map((d, i) => (
                <div key={i} style={styles.docItem} title={d.message}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{fileEmoji(d.name)}</span>
                  <span style={styles.docName}>{d.name}</span>
                  <span
                    style={{
                      ...styles.statusDot,
                      background: d.status === "success" ? "#639922" : "#c0392b",
                    }}
                    title={d.status === "success" ? "Indexed" : "Failed"}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); removeDoc(i); }}
                    title="Remove"
                    style={styles.removeBtn}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {docs.length === 0 && (
          <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "center", marginTop: 8 }}>
            No documents yet
          </p>
        )}
      </aside>

      {/* ── Chat ── */}
      <div style={styles.chatArea} className="bg-zinc-800">
        <header style={styles.chatHeader}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>Document Chat</p>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {indexedCount === 0
                ? "Upload files to get started"
                : `${indexedCount} file${indexedCount > 1 ? "s" : ""} indexed`}
            </p>
          </div>
          {messages.length > 0 && (
            <button style={styles.clearBtn} onClick={() => setMessages([])}>🗑 Clear</button>
          )}
        </header>

        <div style={styles.messages} className="bg-zinc-950">
          {messages.length === 0 && !thinking && (
            <div style={styles.emptyState}>
              <span style={{ fontSize: 36 }}>💬</span>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center", maxWidth: 220, lineHeight: 1.6 }}>
                Ask anything about your uploaded documents
              </p>
              {indexedCount > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      style={styles.suggestion}
                      onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: m.role === "user" ? "row-reverse" : "row",
                gap: 10,
                maxWidth: "85%",
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div style={{ ...styles.avatar, ...(m.role === "user" ? styles.avatarUser : styles.avatarBot) }}>
                {m.role === "user" ? "U" : "AI"}
              </div>
              <div style={{ ...styles.bubble, ...(m.role === "user" ? styles.bubbleUser  : styles.bubbleBot) }}>
                {m.text}
              </div>
            </div>
          ))}

          {thinking && (
            <div style={{ display: "flex", gap: 10, alignSelf: "flex-start" }}>
              <div style={{ ...styles.avatar, ...styles.avatarBot }}>AI</div>
              <div style={{ ...styles.bubble, ...styles.bubbleBot, display: "flex", alignItems: "center", gap: 5 }}>
                {[0, 1, 2].map((n) => (
                  <span key={n} style={{ ...styles.statusDot, animation: `bounce 1.1s ${n * 0.15}s infinite` }} />
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div style={styles.inputArea}>
          <div style={styles.inputWrap}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={autoResize}
              onKeyDown={handleKey}
              placeholder={indexedCount === 0 ? "Upload a file first…" : "Ask a question about your documents…"}
              rows={1}
              style={styles.textarea}
              disabled={indexedCount === 0}
            />
            <button
              style={{ ...styles.sendBtn, opacity: !input.trim() || thinking ? 0.35 : 1 }}
              onClick={handleSend}
              disabled={!input.trim() || thinking}
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%,60%,100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  shell: {
    display: "grid",
    gridTemplateColumns: "260px 1fr",
    height: 600,
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    overflow: "hidden",
    background: "var(--color-background-primary)",
    fontFamily: "var(--font-sans)",
  },
  sidebar: {
    background: "var(--color-background-secondary)",
    borderRight: "0.5px solid var(--color-border-tertiary)",
    display: "flex",
    flexDirection: "column",
    padding: 16,
    gap: 12,
    overflowY: "auto",
  },
  sidebarLabel: {
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.08em",
    color: "var(--color-text-tertiary)",
    textTransform: "uppercase",
  },
  dropZone: {
    border: "1px dashed var(--color-border-secondary)",
    borderRadius: "var(--border-radius-md)",
    padding: "18px 12px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
  },
  uploadBtn: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    fontSize: 13,
    color: "var(--color-text-primary)",
    cursor: "pointer",
  },
  docList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflowY: "auto",
    flex: 1,
  },
  docItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-tertiary)",
    background: "var(--color-background-primary)",
  },
  docName: {
    fontSize: 12,
    color: "var(--color-text-primary)",
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
   removeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 15,
    lineHeight: 1,
    color: "var(--color-text-tertiary)",
    padding: "0 2px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
    display: "inline-block",
  },
  chatArea: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  chatHeader: {
    padding: "14px 20px",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  clearBtn: {
    padding: "5px 10px",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: "var(--border-radius-md)",
    background: "transparent",
    fontSize: 12,
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    minHeight: 300,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 500,
    flexShrink: 0,
  },
  avatarBot: {
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    color: "var(--color-text-secondary)",
  },
  avatarUser: {
    background: "var(--color-background-info)",
    color: "var(--color-text-info)",
  },
  bubble: {
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  bubbleBot: {
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    color: "var(--color-text-primary)",
    borderTopLeftRadius: 4,
  },
  bubbleUser: {
    background: "var(--color-background-info)",
    color: "var(--color-text-info)",
    borderTopRightRadius: 4,
  },
  suggestion: {
    fontSize: 12,
    padding: "5px 10px",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: 99,
    background: "var(--color-background-primary)",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  },
  inputArea: {
    padding: "12px 16px",
    borderTop: "0.5px solid var(--color-border-tertiary)",
  },
  inputWrap: {
    display: "flex",
    alignItems: "flex-end",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: 10,
    background: "var(--color-background-secondary)",
    padding: "2px 4px 2px 12px",
    gap: 4,
  },
  textarea: {
    flex: 1,
    border: "none",
    background: "transparent",
    fontSize: 13,
    color: "var(--color-text-primary)",
    resize: "none",
    outline: "none",
    padding: "8px 0",
    maxHeight: 120,
    lineHeight: 1.5,
    fontFamily: "inherit",
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "none",
    background: "var(--color-text-primary)",
    color: "var(--color-background-primary)",
    cursor: "pointer",
    fontSize: 16,
    flexShrink: 0,
    marginBottom: 3,
  },
};