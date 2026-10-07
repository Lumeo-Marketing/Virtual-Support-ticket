"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DismissibleErrorAlert, ErrorAlert, Spinner, useAlerts } from "./alerts";
import { Mail, Search, Send, ArrowLeft, Plus } from "lucide-react";

export type Message = { id: number; senderId: number; recipientId: number; content: string; createdAt: string; senderName: string; senderEmail: string; senderRole: string; senderIsSuperAdmin?: boolean; senderActive?: boolean; recipientName: string; recipientEmail: string; recipientRole?: string; recipientIsSuperAdmin?: boolean; recipientActive?: boolean; readAt: string | null };
export type Recipient = { id: number; name: string; email: string; role: string; active: boolean; isSuperAdmin: boolean };
type Props = { user: { id: number; name: string; email: string; role: string; isSuperAdmin: boolean }; messages: Message[]; recipients: Recipient[]; loadError: string; onSent: (message: Message) => void; onRead: (ids: number[], readAt: string) => void };
const roleLabel = (person: Recipient) => person.isSuperAdmin || person.role === "superadmin" ? "Super administrator" : person.role === "admin" ? "IT administrator" : "Staff member";
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const stamp = (date: string) => new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function MessagesWorkspace({ user, messages, recipients, loadError, onSent, onRead }: Props) {
  const { show } = useAlerts();
  const [selectedId, setSelectedId] = useState(0);
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readRetry, setReadRetry] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLSelectElement>(null);
  const people = useMemo(() => {
    const map = new Map<number, Recipient>(recipients.map((person) => [person.id, person]));
    for (const message of messages) {
      const incoming = message.recipientId === user.id;
      const id = incoming ? message.senderId : message.recipientId;
      if (!map.has(id)) map.set(id, { id, name: incoming ? message.senderName : message.recipientName, email: incoming ? message.senderEmail : message.recipientEmail, role: incoming ? message.senderRole : message.recipientRole || "staff", isSuperAdmin: Boolean(incoming ? message.senderIsSuperAdmin : message.recipientIsSuperAdmin), active: Boolean(incoming ? message.senderActive : message.recipientActive) });
    }
    return [...map.values()];
  }, [recipients, messages, user.id]);
  const conversations = people.map((person) => {
    const history = messages.filter((message) => message.senderId === person.id || message.recipientId === person.id);
    return { person, last: history[0], unread: history.filter((message) => message.recipientId === user.id && !message.readAt).length };
  }).filter(({ last, person }) => (last || person.id === selectedId) && `${person.name} ${person.email} ${roleLabel(person)}`.toLowerCase().includes(search.toLowerCase()))
    .filter(({ unread }) => !unreadOnly || unread > 0)
    .sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0));
  const selected = people.find((person) => person.id === selectedId);
  const thread = messages.filter((message) => message.senderId === selectedId || message.recipientId === selectedId).sort((a, b) => a.id - b.id);
  const unreadIds = thread.filter((message) => message.recipientId === user.id && !message.readAt).map((message) => message.id);
  const throughId = Math.max(0, ...unreadIds);
  const content = drafts[selectedId] || "";
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [selectedId, thread.length]);
  useEffect(() => {
    if (!selectedId || !throughId) return;
    let cancelled = false;
    async function markRead() {
      try {
        const response = await fetch("/api/messages", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senderId: selectedId, throughId }) });
        if (!response.ok) throw new Error("Read update failed");
        const result = await response.json();
        if (!cancelled && result.readAt) onRead(result.ids, result.readAt);
      } catch { /* Retry on the next interval without hiding the conversation. */ }
    }
    void markRead();
    const retry = window.setInterval(() => setReadRetry((value) => value + 1), 15000);
    return () => { cancelled = true; window.clearInterval(retry); };
  }, [selectedId, throughId, readRetry, onRead]);
  function select(id: number) { setSelectedId(id); setError(""); }
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !content.trim() || !selected?.active) return;
    const recipient = selected;
    const text = content.trim();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientId: recipient.id, content: text }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send your message.");
      onSent({ ...result.message, content: text, senderName: user.name, senderEmail: user.email, senderRole: user.role, senderIsSuperAdmin: user.isSuperAdmin, recipientName: recipient.name, recipientEmail: recipient.email, recipientRole: recipient.role, recipientIsSuperAdmin: recipient.isSuperAdmin, readAt: null });
      show("Your message was sent.");
      setDrafts((values) => ({ ...values, [recipient.id]: "" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send your message. Try again."); }
    finally { setBusy(false); }
  }
  return <>
    <DismissibleErrorAlert message={loadError}/>
    <section className={`messaging-workspace ${selected ? "has-conversation" : ""}`} aria-label="Team messages">
      <aside className="conversation-sidebar">
        <div className="conversation-title"><h2>Conversations</h2><button className="button button-secondary" title="Start a conversation" onClick={() => picker.current?.focus()}><Plus size={16}/> New</button></div>
        <label className="recipient-picker">Start a conversation<select ref={picker} value={selectedId && recipients.some((person) => person.id === selectedId) ? selectedId : ""} onChange={(event) => select(Number(event.target.value))}><option value="" disabled>Choose a team member…</option>{recipients.map((person) => <option key={person.id} value={person.id}>{person.name} · {roleLabel(person)}</option>)}</select></label>
        <label className="conversation-search"><Search size={18}/><input aria-label="Search conversations" placeholder="Search name or email" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
        <div className="conversation-filters"><button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All messages</button><button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread</button></div>
        <div className="conversation-list">{conversations.map(({ person, last, unread }) => <button key={person.id} className={`conversation-item ${selectedId === person.id ? "selected" : ""}`} aria-pressed={selectedId === person.id} onClick={() => select(person.id)}><span className={`conversation-avatar ${person.isSuperAdmin ? "admin-avatar" : ""}`}>{initials(person.name)}</span><span className="conversation-summary"><b>{person.name}</b><small>{roleLabel(person)}{!person.active ? " · Inactive" : ""}</small><span>{last ? `${last.senderId === user.id ? "You: " : ""}${last.content}` : "Start your conversation"}</span>{last && <time dateTime={last.createdAt}>{stamp(last.createdAt)}</time>}</span>{unread > 0 && <span className="message-unread-count" aria-label={`${unread} unread messages`}>{unread}</span>}</button>)}{!conversations.length && <div className="messaging-empty"><Mail size={28}/><b>{search || unreadOnly ? "No matching conversations" : "Your inbox is ready"}</b><p>Choose a team member above to send a message.</p></div>}</div>
      </aside>
      <div className="conversation-panel">{selected ? <>
        <header className="conversation-header"><button className="conversation-back" aria-label="Back to conversations" onClick={() => select(0)}><ArrowLeft size={20}/></button><span className="conversation-avatar">{initials(selected.name)}</span><div><h2>{selected.name}</h2><p>{roleLabel(selected)} · {selected.email}</p></div></header>
        <div className="conversation-history" role="log" aria-label={`Conversation with ${selected.name}`} aria-live="polite">{thread.length ? thread.map((message, index) => <div key={message.id}>{(index === 0 || new Date(thread[index - 1].createdAt).toDateString() !== new Date(message.createdAt).toDateString()) && <div className="conversation-date">{new Date(message.createdAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</div>}<article className={`message-bubble ${message.senderId === user.id ? "outgoing" : "incoming"}`}><b>{message.senderId === user.id ? "You" : message.senderName}</b><p>{message.content}</p><small><time dateTime={message.createdAt}>{stamp(message.createdAt)}</time>{message.senderId === user.id && <span> · {message.readAt ? "Read" : "Sent"}</span>}</small></article></div>) : <div className="messaging-empty"><Mail size={32}/><b>Say hello to {selected.name.split(" ")[0]}</b><p>Your messages and replies will appear here.</p></div>}<div ref={bottom}/></div>
        <form className="conversation-compose" onSubmit={send}><label htmlFor="message-content">{selected.active ? `Message ${selected.name.split(" ")[0]}` : "This account is inactive. Conversation history is still available."}</label><textarea id="message-content" rows={3} maxLength={5000} placeholder="Write your message…" value={content} disabled={!selected.active || busy} onChange={(event) => setDrafts((values) => ({ ...values, [selectedId]: event.target.value }))}/><ErrorAlert message={error} onClose={() => setError("")}/><div><small>{content.length.toLocaleString()} / 5,000</small><button className="button button-primary" disabled={busy || !content.trim() || !selected.active} aria-busy={busy}>{busy ? <Spinner/> : <Send size={16}/>} {busy ? "Sending…" : "Send message"}</button></div></form>
      </> : <div className="messaging-empty messaging-welcome"><span><Mail size={36}/></span><h2>Your team, one conversation away</h2><p>Select a conversation to read and reply, or choose a team member to start a new one.</p><button className="button button-primary" onClick={() => picker.current?.focus()}><Plus size={17}/> New conversation</button></div>}</div>
    </section>
  </>;
}
