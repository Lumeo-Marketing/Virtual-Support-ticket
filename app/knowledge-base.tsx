"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, FileText, FileUp, LoaderCircle, PencilLine, Plus, Search, ShieldCheck, Trash2, Video, X } from "lucide-react";

type KnowledgeEntry = {
  id: number;
  title: string;
  description: string;
  contentType: "text" | "pdf" | "video" | "youtube";
  steps: string;
  youtubeUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

type EntryForm = {
  title: string;
  description: string;
  steps: string;
  contentType: "text" | "pdf" | "video" | "youtube";
  youtubeUrl: string;
  file: File | null;
};

const emptyForm: EntryForm = {
  title: "",
  description: "",
  steps: "",
  contentType: "text",
  youtubeUrl: "",
  file: null,
};

function getYoutubeId(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.slice(1);
    if (url.hostname.includes("youtube.com")) return url.searchParams.get("v") || url.pathname.split("/").filter(Boolean)[0] || null;
  } catch {
    // Invalid URLs are rejected server-side.
  }
  return null;
}

function formatBytes(value: number | null) {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeBaseWorkspace({ isAdmin }: { isAdmin: boolean }) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<KnowledgeEntry | null>(null);
  const [form, setForm] = useState<EntryForm>(emptyForm);

  async function loadEntries() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/knowledge-base", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load the knowledge base.");
      setEntries(result.entries || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the knowledge base.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/knowledge-base", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load the knowledge base.");
        if (!cancelled) setEntries(result.entries || []);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the knowledge base.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");

    const data = new FormData();
    data.set("title", form.title);
    data.set("description", form.description);
    data.set("steps", form.steps);
    data.set("contentType", form.contentType);
    if (form.youtubeUrl) data.set("youtubeUrl", form.youtubeUrl);
    if (form.file) data.set("file", form.file);

    try {
      const response = await fetch("/api/knowledge-base", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the knowledge-base entry.");
      setEntries((current) => [result.entry, ...current]);
      setForm(emptyForm);
      setCreating(false);
      setSelected(result.entry);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the knowledge-base entry.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(id: number) {
    if (!window.confirm("Delete this knowledge-base entry?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/knowledge-base/${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete the entry.");
      setEntries((current) => current.filter((entry) => entry.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the entry.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => entries.filter((entry) => `${entry.title} ${entry.description} ${entry.steps}`.toLowerCase().includes(search.toLowerCase())), [entries, search]);

  return (
    <div className="knowledge-base-page">
      <section className="knowledge-hero content-card">
        <div>
          <span className="knowledge-kicker"><BookOpen size={14}/> KNOWLEDGE BASE</span>
          <h2>Everything your team needs, in one place.</h2>
          <p>Find guides, instructions, PDFs, videos, and recorded walkthroughs whenever you need them.</p>
        </div>
        {isAdmin && <button className="button button-primary" onClick={() => setCreating(true)}><Plus size={17}/> Add an entry</button>}
      </section>

      <section className="knowledge-toolbar content-card">
        <label className="queue-search knowledge-search">
          <Search size={16}/>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search knowledge base..." />
        </label>
        <div className="knowledge-meta"><span>{entries.length} total</span><span>{filtered.length} matching</span></div>
      </section>

      {error && <div className="knowledge-alert" role="alert"><ShieldCheck size={15}/><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}

      {loading ? <div className="knowledge-loading"><LoaderCircle size={20} className="spinner"/> Loading knowledge base…</div> : (
        <div className="knowledge-layout">
          <aside className="knowledge-list content-card">
            {filtered.length ? filtered.map((entry) => (
              <button key={entry.id} className={`knowledge-entry ${selected?.id === entry.id ? "knowledge-entry-active" : ""}`} onClick={() => setSelected(entry)}>
                <span className="knowledge-entry-icon"><EntryIcon type={entry.contentType} /></span>
                <span>
                  <b>{entry.title}</b>
                  <small>{entry.contentType === "text" ? "Guide" : entry.contentType === "youtube" ? "YouTube video" : entry.contentType === "video" ? "Video" : "PDF document"}</small>
                </span>
                <span className="knowledge-entry-arrow">›</span>
              </button>
            )) : <div className="empty-dashboard"><span><BookOpen size={20}/></span><b>No entries found</b><p>Try another search term or add a new article.</p></div>}
          </aside>

          <article className="knowledge-detail content-card">
            {selected ? (
              <>
                <div className="knowledge-heading-row">
                  <div>
                    <span className="knowledge-type">{selected.contentType.toUpperCase()}</span>
                    <h3>{selected.title}</h3>
                    <p>Created {new Date(selected.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · by {selected.createdBy}</p>
                  </div>
                  {isAdmin && <button className="icon-button danger" aria-label="Delete entry" onClick={() => removeEntry(selected.id)} disabled={busy}><Trash2 size={16}/></button>}
                </div>

                {selected.description && <div className="knowledge-description"><b>Overview</b><p>{selected.description}</p></div>}

                {selected.contentType === "text" && selected.steps && <div className="knowledge-steps"><b>How to do it</b><ol>{selected.steps.split(/\r?\n+/).filter(Boolean).map((step, index) => <li key={index}>{step}</li>)}</ol></div>}

                {selected.contentType === "pdf" && selected.fileName && <iframe title={selected.title} className="knowledge-media" src={`/api/knowledge-base/${selected.id}/file`} />}
                {selected.contentType === "video" && selected.fileName && <video className="knowledge-media" controls preload="metadata"><source src={`/api/knowledge-base/${selected.id}/file`} type="video/mp4" />Your browser does not support video playback.</video>}
                {selected.contentType === "youtube" && selected.youtubeUrl && (() => {
                  const youtubeId = getYoutubeId(selected.youtubeUrl);
                  return youtubeId ? <div className="knowledge-youtube"><iframe title={selected.title} src={`https://www.youtube.com/embed/${youtubeId}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div> : null;
                })()}

                {selected.fileName && <div className="knowledge-file"><FileText size={16}/><div><b>{selected.fileName}</b><small>{formatBytes(selected.fileSize)}</small></div><a href={`/api/knowledge-base/${selected.id}/file`} target="_blank" rel="noreferrer">Open <ExternalLink size={13}/></a></div>}

                {selected.contentType === "youtube" && selected.youtubeUrl && <a className="knowledge-link" href={selected.youtubeUrl} target="_blank" rel="noreferrer">Watch on YouTube <ExternalLink size={13}/></a>}
              </>
            ) : <div className="empty-detail"><PencilLine size={28}/><b>Select a knowledge-base entry</b><p>Choose one from the list to read it or watch the attached media.</p></div>}
          </article>
        </div>
      )}

      {creating && <div className="dialog-backdrop" onClick={() => setCreating(false)}><div className="dialog-card dialog-wide" onClick={(event) => event.stopPropagation()}><div className="dialog-heading"><div><span className="dialog-kicker">NEW ENTRY</span><h2>Add knowledge-base content</h2><p>Choose how the information should be presented to every user.</p></div><button className="dialog-x" onClick={() => setCreating(false)} aria-label="Close form"><X size={18}/></button></div><form className="knowledge-form" onSubmit={submit}><div className="request-grid"><label>Entry title<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="For example: Laptop password reset" required/></label><label>Content type<select value={form.contentType} onChange={(event) => setForm((current) => ({ ...current, contentType: event.target.value as EntryForm["contentType"], file: null }))}><option value="text">Text guide</option><option value="pdf">PDF document</option><option value="video">Video</option><option value="youtube">YouTube link</option></select></label></div>

            <label className="form-textarea">Overview or description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={4} placeholder="Explain what this is for and when staff should use it." /></label>

            {form.contentType === "text" && <label className="form-textarea">How-to steps<textarea value={form.steps} onChange={(event) => setForm((current) => ({ ...current, steps: event.target.value }))} rows={7} placeholder="Write one step per line. For example:&#10;1. Open Settings&#10;2. Select Accounts..." required /></label>}
            {form.contentType === "youtube" && <label>YouTube video URL<input type="url" value={form.youtubeUrl} onChange={(event) => setForm((current) => ({ ...current, youtubeUrl: event.target.value }))} placeholder="https://www.youtube.com/watch?v=..." required /></label>}
            {(form.contentType === "pdf" || form.contentType === "video") && <label className="knowledge-upload"><FileUp size={17}/><span><b>{form.file ? form.file.name : "Choose a file"}</b><small>{form.contentType === "pdf" ? "PDF up to 20 MB" : "Video up to 50 MB"}</small></span><input type="file" accept={form.contentType === "pdf" ? ".pdf,application/pdf" : "video/*"} onChange={(event) => setForm((current) => ({ ...current, file: event.target.files?.[0] || null }))} required /></label>}

            {form.contentType === "text" && !form.description && !form.steps && <p className="form-note">Add a description or step-by-step instructions for this guide.</p>}
            <ErrorAlert message={error} onClose={() => setError("")} />
            <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="spinner"/> : <Plus size={16}/>} {busy ? "Saving..." : "Save entry"}</button></div>
          </form></div></div>}
    </div>
  );
}

function EntryIcon({ type }: { type: KnowledgeEntry["contentType"] }) {
  if (type === "pdf") return <FileText size={16}/>;
  if (type === "video") return <Video size={16}/>;
  if (type === "youtube") return <ExternalLink size={16}/>;
  return <BookOpen size={16}/>;
}

function ErrorAlert({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;
  return <div className="alert alert-error" role="alert"><span>{message}</span><button onClick={onClose} aria-label="Dismiss alert">×</button></div>;
}
