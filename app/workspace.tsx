"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ErrorAlert, Spinner, useAlerts } from "./alerts";
import { usePathname } from "next/navigation";
import { MessagesWorkspace, type Message, type Recipient } from "./messages-workspace";
import {
  Activity, AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, FilePlus2, FileText, Filter,
  Headphones, LayoutDashboard, ListFilter, LockKeyhole, LogOut, Menu, Pencil, PlayCircle,
  Plus, Search, Settings2, Shield, ShieldCheck, Ticket, UserCog, UserPlus,
  Users, Video, Wifi, X, Laptop, Mail, Cloud, MonitorCog, MoreHorizontal, CircleCheck,
} from "lucide-react";
import { CATEGORIES, PRIORITIES, REQUEST_OPTIONS, STATUSES } from "@/lib/constants";
import { Reports } from "@/app/reports";
import { KnowledgeBaseWorkspace } from "@/app/knowledge-base";

type Role = "staff" | "admin" | "superadmin";
type User = { id: number; name: string; email: string; role: Role; department: string | null; jobTitle: string | null; location: string | null; active: boolean; isSuperAdmin: boolean };
type TicketRecord = { id: number; ticketCode: string; userId: number | null; fullName: string; workEmail: string; department: string; jobTitle: string; location: string; requestType: string; requestSubtype: string; category: string; priority: string; subject: string; description: string; attachmentPath: string | null; attachmentName: string | null; resolution: string; status: string; createdAt: string; resolvedAt: string | null; updatedAt: string };
type Account = { id: number; name: string; email: string; role: string; department: string | null; jobTitle: string | null; location: string | null; active: boolean | number; isSuperAdmin: boolean | number; createdAt: string; ticketCount?: number };
type Event = { id: number; actorId: number | null; actorName: string; actorEmail: string; actorRole: Role; action: string; entityType: string; entityId: string | null; details: string; createdAt: string };
type Notice = { id: number; title: string; message: string; createdAt: string; readAt: string | null };
type KnowledgeEntry = { id: number; title: string; description: string; contentType: "text" | "pdf" | "video" | "youtube"; createdAt: string; updatedAt: string; createdBy: string };
type Section = "overview" | "tickets" | "knowledge-base" | "users" | "activity" | "reports" | "messages";

const statusClass = (status: string) => status.toLowerCase().replaceAll(" ", "-");
const dateLabel = (date: string) => new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const timeLabel = (date: string) => new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const pathname = usePathname();
  const [workspaceSection, setWorkspaceSection] = useState<Section>("overview");
  const section = pathname === "/messages" ? "messages" : workspaceSection;
  function setSection(next: Section) {
    if (next !== "messages") setWorkspaceSection(next);
    const path = next === "messages" ? "/messages" : "/";
    if (pathname !== path) window.history.pushState(null, "", path);
    setNoticeOpen(false);
  }
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [unread, setUnread] = useState(0);
  const [query, setQuery] = useState("");
  const [ticketFilter, setTicketFilter] = useState("All tickets");
  const [ticketDialog, setTicketDialog] = useState<TicketRecord | "new" | null>(null);
  const [userDialog, setUserDialog] = useState(false);
  const [messagingError, setMessagingError] = useState("");
  const [editUser, setEditUser] = useState<Account | null>(null);
  const { show: notify, confirm } = useAlerts();
  const [accountBusy, setAccountBusy] = useState<number | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const loadData = useCallback(async (currentUser: User) => {
    setLoadingData(true);
    try {
      const requests: Promise<Response>[] = [fetch("/api/tickets"), fetch("/api/notifications"), fetch("/api/messages")];
      if (currentUser.role !== "staff") requests.push(fetch("/api/admin/users"), fetch("/api/admin/activity"));
      const responses = await Promise.all(requests);
      const [ticketData, noticeData, messageData] = await Promise.all([responses[0].json(), responses[1].json(), responses[2].json()]);
      setTickets(ticketData.tickets || []);
      setNotices(noticeData.notifications || []);
      setMessagingError(responses[2].ok ? "" : "Messages could not be loaded. Retrying automatically…");
      setMessages(messageData.messages || []);
      setRecipients(messageData.recipients || []);
      setUnread(noticeData.unread || 0);
      if (currentUser.role !== "staff" && responses[3] && responses[4]) {
        const [userData, eventData] = await Promise.all([responses[3].json(), responses[4].json()]);
        setAccounts(userData.users || []);
        setEvents(eventData.events || []);
      }
    } catch {
      notify("Some dashboard data could not be loaded. Refresh to retry.", "warning");
    } finally {
      setLoadingData(false);
    }
  }, [notify]);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      try {
        const response = await fetch("/api/auth/me");
        const data = await response.json();
        if (data.user) {
          setUser(data.user);
          await loadData(data.user);
        }
      } catch {
        // Keep the sign-in screen visible when the session service is unavailable.
      } finally {
        setBooting(false);
      }
    });
  }, [loadData]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function updateMessages() {
      try {
        const response = await fetch("/api/messages", { cache: "no-store" });
        if (!response.ok) throw new Error("Messaging unavailable");
        const data = await response.json();
        if (!cancelled) { setMessages(data.messages); setRecipients(data.recipients); setMessagingError(""); }
      } catch { if (!cancelled) setMessagingError("Messages could not be refreshed. Retrying automatically…"); }
    }
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void updateMessages(); }, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [user]);

  const markMessagesRead = useCallback((ids: number[], readAt: string) => {
    setMessages((rows) => rows.map((message) => ids.includes(message.id) ? { ...message, readAt } : message));
  }, []);

  const unreadMessages = messages.filter((message) => message.recipientId === user?.id && !message.readAt).length;
  const filteredTickets = useMemo(() => tickets.filter((ticket) => {
    const matchesQuery = `${ticket.ticketCode} ${ticket.subject} ${ticket.fullName} ${ticket.workEmail} ${ticket.category}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = ticketFilter === "All tickets" || ticket.status === ticketFilter;
    return matchesQuery && matchesStatus;
  }), [tickets, query, ticketFilter]);
  const openCount = tickets.filter((ticket) => !["Resolved", "Closed"].includes(ticket.status)).length;
  const resolvedCount = tickets.filter((ticket) => ["Resolved", "Closed"].includes(ticket.status)).length;
  const activeStaffCount = accounts.filter((account) => Number(account.active) === 1 && !Number(account.isSuperAdmin)).length;
  const isAdmin = user?.role !== "staff";

  async function updateAccount(account: Account, changes: Record<string, unknown>, success: string) {
    if (accountBusy !== null) return;
    setAccountBusy(account.id);
    try {
      const response = await fetch(`/api/admin/users/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update account.");
      setAccounts((rows) => rows.map((item) => item.id === account.id ? result.user : item));
      notify(success);
      void refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not update account.", "error"); }
    finally { setAccountBusy(null); }
  }

  async function deleteAccount(account: Account) {
    if (accountBusy !== null || !user?.isSuperAdmin) return;
    if (!await confirm(`Delete ${account.name} (${account.email}) permanently? Their messages and notifications will be removed. Tickets, guides, and audit history will be kept.`)) return;
    setAccountBusy(account.id);
    try {
      const response = await fetch(`/api/admin/users/${account.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete account.");
      setAccounts((rows) => rows.filter((item) => item.id !== account.id));
      notify(`${account.name}'s account was deleted.`);
      if (account.id === user.id) await signOut(); else await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not delete account.", "error"); }
    finally { setAccountBusy(null); }
  }

  async function handleLogin(nextUser: User) {
    setUser(nextUser);
    await loadData(nextUser);
  }
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null); setTickets([]); setAccounts([]); setEvents([]); setSection("overview");
  }
  async function readNotifications() {
    if (unread) await fetch("/api/notifications", { method: "PATCH" });
    setUnread(0);
  }
  async function refresh() {
    if (user) {
      const response = await fetch("/api/auth/me");
      const data = await response.json();
      if (!data.user) { await signOut(); return; }
      setUser(data.user);
      await loadData(data.user);
    }
  }
  async function openReportedTicket(id: number) {
    try {
      const response = await fetch(`/api/tickets/${id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open this ticket.");
      setTicketDialog(result.ticket);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not open this ticket.", "error"); }
  }


  if (booting) return <main className="boot-screen"><Image src="/lumeo-symbol.svg" width={47} height={47} priority alt=""/><span>Preparing your workspace</span></main>;
  if (!user) return <LoginScreen onLogin={handleLogin}/>;

  return <main className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="sidebar-brand"><Image src="/lumeo-symbol.svg" width={30} height={30} alt="LUMEO"/><div><b>LUMEO</b><small>INTERNAL SUPPORT</small></div><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <div className="workspace-pill"><span className="workspace-status"/> Company workspace <ChevronDown size={14}/></div>
      <p className="nav-label">WORKSPACE</p>
      <nav className="side-nav">
        <SideItem active={section === "overview"} icon={<LayoutDashboard size={17}/>} label="Overview" onClick={() => { setSection("overview"); setMobileNav(false); }}/>
        <SideItem active={section === "tickets"} icon={<Ticket size={17}/>} label={isAdmin ? "Ticket queue" : "My requests"} count={isAdmin ? openCount : tickets.length} onClick={() => { setSection("tickets"); setMobileNav(false); }}/>
        <SideItem active={section === "knowledge-base"} icon={<BookOpen size={17}/>} label="Knowledge base" onClick={() => { setSection("knowledge-base"); setMobileNav(false); }}/>
        <SideItem active={section === "messages"} icon={<Mail size={18}/>} label="Messages" count={unreadMessages} onClick={() => { setSection("messages"); setMobileNav(false); }}/>
      </nav>
      {user.role !== "staff" && <><p className="nav-label nav-gap">ADMINISTRATION</p><nav className="side-nav"><SideItem active={section === "reports"} icon={<Activity size={17}/>} label="Reports & analytics" onClick={() => { setSection("reports"); setMobileNav(false); }}/><SideItem active={section === "users"} icon={<Users size={17}/>} label="People & access" onClick={() => { setSection("users"); setMobileNav(false); }}/>{user.isSuperAdmin && <SideItem active={section === "activity"} icon={<Activity size={17}/>} label="Activity log" onClick={() => { setSection("activity"); setMobileNav(false); }}/>}</nav></>}
      <div className="sidebar-bottom"><div className="help-card"><span className="help-card-icon"><Headphones size={18}/></span><b>Need a hand?</b><p>Submit a request and our IT team will get back to you.</p><button onClick={() => setTicketDialog("new")}>Create a ticket <ArrowRight size={14}/></button></div><div className="sidebar-user"><span className={`user-avatar ${user.isSuperAdmin ? "avatar-orange" : ""}`}>{initials(user.name)}</span><div><b>{user.name}</b><small>{user.isSuperAdmin ? "Super administrator" : user.role === "admin" ? "IT administrator" : user.department || "Staff member"}</small></div><button aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={16}/></button></div></div>
    </aside>
    {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}

    <section className="main-area">
      <header className="app-topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20}/></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14}/><b>{sectionTitle(section, isAdmin)}</b></div><div className="topbar-right"><div className="global-search"><Search size={16}/><input value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value) setSection("tickets"); }} placeholder="Search tickets..."/><kbd>⌘ K</kbd></div><div className="notification-anchor"><button className="top-icon" aria-label="Notifications" onClick={() => { setNoticeOpen(!noticeOpen); void readNotifications(); }}><Bell size={18}/>{unread > 0 && <i/>}</button>{noticeOpen && <div className="notification-panel"><div className="notification-title">Notifications <span>{notices.length}</span></div>{notices.length ? notices.slice(0, 6).map((notice) => <div key={notice.id} className="notification-entry"><b>{notice.title}</b><p>{notice.message}</p><small>{timeLabel(notice.createdAt)}</small></div>) : <div className="notification-empty">You&apos;re all caught up.</div>}</div>}</div><button className={`messages-trigger ${section === "messages" ? "messages-trigger-active" : ""}`} aria-label={`Messages${unreadMessages ? `, ${unreadMessages} unread` : ""}`} onClick={() => setSection("messages")}><Mail size={20}/><span>Messages</span>{unreadMessages > 0 && <b>{unreadMessages}</b>}</button><span className="topbar-divider"/><div className="top-user"><span className={`user-avatar small-avatar ${user.isSuperAdmin ? "avatar-orange" : ""}`}>{initials(user.name)}</span><div><b>{user.name.split(" ")[0]}</b><small>{user.role === "staff" ? "Staff" : user.isSuperAdmin ? "Super admin" : "IT admin"}</small></div><ChevronDown size={14}/></div></div></header>

      <div className="dashboard-content">
        <div className="page-heading"><div><div className="date-kicker">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</div><h1>{heading(section, user)}</h1><p>{subheading(section, user)}</p></div><div className="heading-actions">{section === "tickets" && <button className="button button-secondary" onClick={() => void refresh()} disabled={loadingData} aria-busy={loadingData}>{loadingData ? <Spinner/> : <Settings2 size={16}/>} {loadingData ? "Refreshing…" : "Refresh"}</button>}{section !== "messages" && section !== "users" && section !== "activity" && section !== "reports" && <button className="button button-primary" onClick={() => setTicketDialog("new")}><Plus size={17}/>{user.role === "staff" ? "New support request" : "Create ticket"}</button>}{user.role !== "staff" && section === "users" && <button className="button button-primary" onClick={() => setUserDialog(true)}><UserPlus size={17}/> Add a user</button>}</div></div>

        {section === "messages" && <MessagesWorkspace user={user} messages={messages} recipients={recipients} loadError={messagingError} onSent={(message) => setMessages((rows) => [message, ...rows])} onRead={markMessagesRead}/>}
        {section === "overview" && <Overview user={user} tickets={tickets} openCount={openCount} resolvedCount={resolvedCount} activeStaffCount={activeStaffCount} loading={loadingData} onViewTickets={() => setSection("tickets")} onCreate={() => setTicketDialog("new")} onOpenKnowledgeBase={() => setSection("knowledge-base")} onSelectTicket={setTicketDialog}/>}
        {section === "tickets" && <TicketQueue tickets={filteredTickets} query={query} setQuery={setQuery} filter={ticketFilter} setFilter={setTicketFilter} admin={isAdmin} onSelect={setTicketDialog} loading={loadingData}/>}
        {section === "knowledge-base" && <KnowledgeBaseWorkspace isAdmin={isAdmin} />}
        {section === "reports" && user.role !== "staff" && <Reports onSelectTicket={openReportedTicket}/>}
        {section === "users" && user.role !== "staff" && <UserManagement users={accounts} loading={loadingData} busyId={accountBusy} isSuperAdmin={user.isSuperAdmin} onToggle={async (account) => {
          if (!user.isSuperAdmin) { notify("Only the super administrator can change account access.", "error"); return; }
          const nextActive = Number(account.active) !== 1;
          if (!await confirm(`${nextActive ? "Restore" : "Deactivate"} sign-in access for ${account.name}? Their support history will be kept.`)) return;
          await updateAccount(account, { active: nextActive }, `${account.name}'s access ${nextActive ? "restored" : "removed"}.`);
        }} onRoleChange={async (account, role) => {
          if (!user.isSuperAdmin) { notify("Only the super administrator can change roles.", "error"); return; }
          if (!await confirm(`Change ${account.name}'s role to ${role === "admin" ? "IT administrator" : "staff member"}?`)) return;
          await updateAccount(account, { role }, `Updated ${account.name}'s access role.`);
        }} onEdit={setEditUser} onDelete={deleteAccount}/>}
        {section === "activity" && user.isSuperAdmin && <ActivityFeed events={events} loading={loadingData}/>}
        {editUser && (user.isSuperAdmin || user.role === "admin") && <EditUserModal canManageAccess={user.isSuperAdmin} user={editUser} onClose={() => setEditUser(null)} onSaved={(updated) => { setAccounts((rows) => rows.map((item) => item.id === updated.id ? updated : item)); setEditUser(null); notify(`${updated.name}'s account was updated.`); void refresh(); }}/>}
      </div>
      <footer className="app-footer"><span><span className="footer-live-dot"/> LUMEO internal support</span><span>Private company workspace <span className="footer-lock"><LockKeyhole size={12}/></span></span></footer>
    </section>
    {ticketDialog && <TicketModal user={user} ticket={ticketDialog === "new" ? null : ticketDialog} onClose={() => setTicketDialog(null)} onCreated={(ticket) => { setTickets((rows) => [ticket, ...rows]); setTicketDialog(null); notify(`${ticket.ticketCode} has been submitted.`); void refresh(); }} onUpdated={(updated) => { setTickets((rows) => rows.map((ticket) => ticket.id === updated.id ? updated : ticket)); setTicketDialog(updated); notify(`${updated.ticketCode} was updated.`); void refresh(); }}/>}
    {userDialog && <AddUserModal isSuperAdmin={user.isSuperAdmin} onClose={() => setUserDialog(false)} onCreated={(account) => { setAccounts((rows) => [account, ...rows]); setUserDialog(false); notify(`${account.name} can now sign in.`); void refresh(); }}/ >}
  </main>;
}

function sectionTitle(section: Section, admin: boolean) {
  if (section === "messages") return "Messages";
  if (section === "tickets") return admin ? "Ticket queue" : "My requests";
  if (section === "knowledge-base") return "Knowledge base";
  if (section === "users") return "People & access";
  if (section === "activity") return "Activity log";
  if (section === "reports") return "Reports & analytics";
  return "Overview";
}
function heading(section: Section, user: User) {
  if (section === "messages") return "Messages";
  if (section === "tickets") return user.role === "staff" ? "My support requests" : "Support ticket queue";
  if (section === "knowledge-base") return "Knowledge base";
  if (section === "users") return "People & access";
  if (section === "activity") return "Workspace activity";
  if (section === "reports") return "Support performance reports";
  return `Welcome back, ${user.name}`;
}
function subheading(section: Section, user: User) {
  if (section === "messages") return "Talk to your team. Every conversation and reply, in one place.";
  if (section === "tickets") return user.role === "staff" ? "Track your requests and see the latest updates from IT." : "Review, assign and resolve requests from across the team.";
  if (section === "knowledge-base") return "Find guides, files, and videos created by your IT administrators.";
  if (section === "users") return "Create staff and administrator accounts and manage workspace access.";
  if (section === "activity") return "A persistent audit trail of account and ticket activity across the workspace.";
  if (section === "reports") return "Resolution times, workload, status trends, and the underlying ticket and activity records.";
  return user.role === "staff" ? "Your internal IT helpdesk, in one place." : "Here is the current state of your IT support workspace.";
}

function SideItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={`side-item ${active ? "side-item-active" : ""}`} onClick={onClick}><span className="side-item-icon">{icon}</span><span>{label}</span>{count !== undefined && count > 0 && <span className="side-count">{count}</span>}</button>;
}

function LoginScreen({ onLogin }: { onLogin: (user: User) => Promise<void> }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [showPassword, setShowPassword] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
      const result = await response.json();
      if (!response.ok) setError(result.error || "Sign-in failed. Check your details and try again.");
      else await onLogin(result.user);
    } catch { setError("The workspace could not be reached. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="login-screen"><div className="login-art"><div className="art-grid"/><div className="art-brand"><Image src="/lumeo-symbol.svg" width={36} height={36} alt=""/><span>LUMEO</span></div><div className="art-content"><span className="art-overline"><span/> INTERNAL IT WORKSPACE</span><h1>Support that<br/>keeps work<br/><em>moving.</em></h1><p>Your team&apos;s secure home for IT help, service requests, and account support.</p><div className="art-bottom"><div className="art-icon-row"><span><ShieldCheck size={16}/></span><span><Ticket size={16}/></span><span><Users size={16}/></span></div><small>One workspace. Better support.</small></div></div><div className="art-glow art-glow-one"/><div className="art-glow art-glow-two"/></div><div className="login-panel"><div className="login-mobile-brand"><Image src="/lumeo-symbol.svg" width={30} height={30} alt=""/><b>LUMEO</b><span>SUPPORT</span></div><div className="login-card"><div className="login-badge"><LockKeyhole size={18}/></div><div className="login-eyebrow">EMPLOYEE SIGN IN</div><h2>Welcome back</h2><p className="login-intro">Sign in to access your IT support workspace.</p><form onSubmit={submit} className="login-form"><label>Work email<span className="login-input"><Mail size={16}/><input autoComplete="username" name="email" type="email" placeholder="you@company.com" required/></span></label><label>Password<span className="login-input"><LockKeyhole size={16}/><input autoComplete="current-password" name="password" type={showPassword ? "text" : "password"} placeholder="Enter your password" required/><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></span></label><ErrorAlert message={error} onClose={() => setError("")}/><button className="login-submit" disabled={busy} aria-busy={busy}>{busy && <Spinner/>}{busy ? "Signing in…" : "Sign in to workspace"}{!busy && <ArrowRight size={17}/>}</button></form><div className="login-help"><span>Access managed by your IT administrator</span><a href="mailto:support@lumeo.local">Need help? <ArrowUpRight size={13}/></a></div></div><div className="login-legal">© 2026 LUMEO <span>·</span> Internal use only <span className="login-secure"><Shield size={12}/> Secure connection</span></div></div></main>;
}

function Overview({ user, tickets, openCount, resolvedCount, activeStaffCount, loading, onViewTickets, onCreate, onOpenKnowledgeBase, onSelectTicket }: { user: User; tickets: TicketRecord[]; openCount: number; resolvedCount: number; activeStaffCount: number; loading: boolean; onViewTickets: () => void; onCreate: () => void; onOpenKnowledgeBase: () => void; onSelectTicket: (ticket: TicketRecord) => void }) {
  const latest = tickets.slice(0, 5);
  return <div className="overview-grid"><div className="overview-main"><div className="welcome-card"><div className="welcome-text"><span className="welcome-chip"><span/>YOUR SUPPORT SPACE</span><h2>{user.role === "staff" ? "How can we help today?" : "IT support, at a glance."}</h2><p>{user.role === "staff" ? "Open a request with our team or follow up on something already in progress." : "See what is active, keep your team moving, and close the loop on requests."}</p><button className="welcome-action" onClick={onCreate}><FilePlus2 size={16}/>{user.role === "staff" ? "Submit a support request" : "Create a ticket"}<ArrowRight size={15}/></button></div><div className="welcome-orb"><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/><div className="orb-center"><Headphones size={33}/></div><span className="orb-bubble bubble-top"><Check size={13}/></span><span className="orb-bubble bubble-side"><Ticket size={13}/></span></div><span className="welcome-mark">L.</span></div>
      <div className="metric-row"><MetricCard icon={<Ticket size={18}/>} label={user.role === "staff" ? "My open requests" : "Open requests"} value={openCount} tone="orange" caption="Need attention"/><MetricCard icon={<CircleCheck size={18}/>} label="Resolved" value={resolvedCount} tone="green" caption="Successfully closed"/><MetricCard icon={<Clock3 size={18}/>} label="Awaiting response" value={tickets.filter((ticket) => ["Pending", "Awaiting User"].includes(ticket.status)).length} tone="blue" caption="In the queue"/>{user.isSuperAdmin && <MetricCard icon={<Users size={18}/>} label="Active accounts" value={activeStaffCount} tone="violet" caption="Staff and IT admins"/>}</div>
      <KnowledgeBasePreview onOpen={onOpenKnowledgeBase} />
      <section className="content-card recent-card"><div className="card-heading"><div><h3>{user.role === "staff" ? "Your recent requests" : "Latest tickets"}</h3><p>{user.role === "staff" ? "Updates from your IT support team." : "The newest requests in your workspace."}</p></div><button className="card-link" onClick={onViewTickets}>View all <ArrowRight size={14}/></button></div>{loading && !tickets.length ? <div className="table-loading">Loading requests…</div> : latest.length ? <TicketTable tickets={latest} admin={user.role !== "staff"} onSelect={onSelectTicket}/> : <div className="empty-dashboard"><span><Ticket size={20}/></span><b>Nothing in the queue yet</b><p>Your submitted requests will appear here.</p><button onClick={onCreate}>Create your first request <ArrowRight size={14}/></button></div>}</section>
      </div><aside className="overview-aside"><section className="side-stat-card"><div className="side-stat-heading"><span className="side-stat-symbol"><Activity size={17}/></span><span>WORKSPACE HEALTH</span><i/></div><h3>All systems operational</h3><p>Everything is running as expected. Your IT team is ready to help.</p><div className="health-line"><span/><b>Service desk</b><em>Operational</em></div><div className="health-line"><span/><b>Accounts &amp; access</b><em>Operational</em></div><div className="health-line"><span/><b>Network services</b><em>Operational</em></div></section><section className="content-card help-panel"><span className="help-panel-icon"><CircleHelp size={19}/></span><span className="mini-label">NEED HELP?</span><h3>We&apos;re here for you.</h3><p>Tell us what is happening and our support team will take it from there.</p><button className="outline-action" onClick={onCreate}>Open a support ticket <ArrowRight size={14}/></button></section><section className="response-note"><span><Clock3 size={16}/></span><div><b>Our usual response</b><p>We aim to respond to requests within one business day.</p></div></section></aside></div>;
}
function KnowledgeBasePreview({ onOpen }: { onOpen: () => void }) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/knowledge-base", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load knowledge base.");
        if (!cancelled) setEntries((result.entries || []).slice(0, 3));
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return <section className="content-card knowledge-preview"><div className="card-heading"><div><h3>Latest knowledge base</h3><p>Helpful guides and resources for your team.</p></div><button className="card-link" onClick={onOpen}>Open all <ArrowRight size={14}/></button></div>{loading ? <div className="table-loading">Loading knowledge base…</div> : entries.length ? <div className="knowledge-preview-list">{entries.map((entry) => <button key={entry.id} className="knowledge-preview-item" onClick={onOpen}><span className="knowledge-preview-icon"><EntryIcon type={entry.contentType} /></span><span><b>{entry.title}</b><small>{entry.contentType === "text" ? "Guide" : entry.contentType === "video" ? "Video" : entry.contentType === "youtube" ? "YouTube" : "PDF"}</small></span><ChevronRight size={15}/></button>)}</div> : <div className="empty-dashboard"><span><BookOpen size={20}/></span><b>No knowledge base entries yet</b><p>New guides will appear here.</p></div>}</section>;
}
function EntryIcon({ type }: { type: KnowledgeEntry["contentType"] }) {
  const icons = { text: <BookOpen size={16}/>, pdf: <FileText size={16}/>, video: <Video size={16}/>, youtube: <PlayCircle size={16}/> };
  return icons[type];
}
function MetricCard({ icon, label, value, tone, caption }: { icon: React.ReactNode; label: string; value: number; tone: string; caption: string }) {
  return <article className="metric-card"><div className={`metric-icon metric-${tone}`}>{icon}</div><div className="metric-label">{label}</div><div className="metric-value">{value}<span className={`metric-trend trend-${tone}`}><ArrowUpRight size={13}/></span></div><div className="metric-caption">{caption}</div></article>;
}

function TicketQueue({ tickets, query, setQuery, filter, setFilter, admin, onSelect, loading }: { tickets: TicketRecord[]; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; admin: boolean; onSelect: (ticket: TicketRecord) => void; loading: boolean }) {
  const [category, setCategory] = useState("All categories"); const [priority, setPriority] = useState("All priorities"); const [kind, setKind] = useState("All types"); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [page, setPage] = useState(1); const pageSize = 10;
  const filtered = tickets.filter((ticket) => (category === "All categories" || ticket.category === category) && (priority === "All priorities" || ticket.priority === priority) && (kind === "All types" || ticket.requestType === kind) && (!from || ticket.createdAt.slice(0, 10) >= from) && (!to || ticket.createdAt.slice(0, 10) <= to));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  function changeFilter(setter: (value: string) => void, value: string) { setter(value); setPage(1); }
  return <section className="content-card queue-card"><div className="queue-summary"><div><span className="queue-summary-icon"><ListFilter size={18}/></span><span><b>{filtered.length}</b><small>{admin ? "requests match your filters" : "requests match your filters"}</small></span></div><div className="queue-filter-area"><label className="queue-search"><Search size={16}/><input placeholder="Search ID, subject, requester..." value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }}/><kbd>/</kbd></label><label className="filter-select"><Filter size={15}/><select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option>All tickets</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select><ChevronDown size={14}/></label></div></div><div className="advanced-filters"><label>Category<select value={category} onChange={(event) => changeFilter(setCategory,event.target.value)}><option>All categories</option>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label><label>Priority<select value={priority} onChange={(event) => changeFilter(setPriority,event.target.value)}><option>All priorities</option>{PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></label><label>Request type<select value={kind} onChange={(event) => changeFilter(setKind,event.target.value)}><option>All types</option>{Object.keys(REQUEST_OPTIONS).map((value) => <option key={value}>{value}</option>)}</select></label><label>Created from<input type="date" value={from} onChange={(event) => changeFilter(setFrom,event.target.value)}/></label><label>Through<input type="date" value={to} onChange={(event) => changeFilter(setTo,event.target.value)}/></label><button onClick={() => { setCategory("All categories"); setPriority("All priorities"); setKind("All types"); setFrom(""); setTo(""); setFilter("All tickets"); setQuery(""); setPage(1); }}>Clear filters</button></div>{loading && !tickets.length ? <div className="table-loading">Loading requests…</div> : visible.length ? <><TicketTable tickets={visible} admin={admin} onSelect={onSelect}/><Pagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onChange={setPage}/></> : <div className="empty-dashboard"><span><Search size={20}/></span><b>No requests match your search</b><p>Try a different keyword or status filter.</p></div>}</section>;
}

function TicketTable({ tickets, admin, onSelect }: { tickets: TicketRecord[]; admin: boolean; onSelect: (ticket: TicketRecord) => void }) {
  return <div className="ticket-table-scroll"><table className="dashboard-ticket-table"><thead><tr><th>Ticket</th>{admin && <th>Requester</th>}<th>Subject</th><th>Priority</th><th>Status</th><th>Updated</th><th/></tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id} onClick={() => onSelect(ticket)}><td><b className="ticket-id">{ticket.ticketCode}</b><small>{ticket.category}</small></td>{admin && <td><span className="requester-cell"><span className="mini-avatar">{initials(ticket.fullName)}</span><span><b>{ticket.fullName}</b><small>{ticket.department}</small></span></span></td>}<td className="subject-cell"><b>{ticket.subject}</b><small>{ticket.requestType} · {ticket.requestSubtype}</small></td><td><span className={`priority-label priority-${ticket.priority.toLowerCase()}`}><i/>{ticket.priority}</span></td><td><span className={`status-label status-${statusClass(ticket.status)}`}><i/>{ticket.status}</span></td><td className="updated-cell">{dateLabel(ticket.updatedAt || ticket.createdAt)}</td><td><ChevronRight size={16}/></td></tr>)}</tbody></table></div>;
}

function Pagination({ page, pageCount, total, pageSize, onChange }: { page: number; pageCount: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  const first = total ? (page - 1) * pageSize + 1 : 0; const last = Math.min(page * pageSize, total);
  return <div className="pagination"><span>Showing <b>{first}–{last}</b> of <b>{total}</b></span><div><button disabled={page <= 1} onClick={() => onChange(Math.max(1,page - 1))} aria-label="Previous page"><ChevronLeft size={15}/></button><span>Page <b>{page}</b> of {pageCount}</span><button disabled={page >= pageCount} onClick={() => onChange(Math.min(pageCount,page + 1))} aria-label="Next page"><ChevronRight size={15}/></button></div></div>;
}

function UserManagement({ users, loading, busyId, isSuperAdmin, onToggle, onRoleChange, onEdit, onDelete }: { users: Account[]; loading: boolean; busyId: number | null; isSuperAdmin: boolean; onToggle: (user: Account) => void; onRoleChange: (user: Account, role: string) => void; onEdit: (user: Account) => void; onDelete: (user: Account) => void }) {
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("All users");
  const [page, setPage] = useState(1); const pageSize = 10;
  const filtered = users.filter((person) => `${person.name} ${person.email} ${person.department || ""}`.toLowerCase().includes(search.toLowerCase()) && (filter === "All users" || (filter === "Active" ? Number(person.active) === 1 : Number(person.active) !== 1)));
  const pageCount = Math.max(1,Math.ceil(filtered.length/pageSize)); const visible = filtered.slice((page-1)*pageSize,page*pageSize);
  return <div className="users-layout"><div className="user-note"><span className="user-note-icon"><ShieldCheck size={18}/></span><div><b>Super administrator controls</b><p>Super administrators can edit all account details, reset passwords, change access, and delete any account, including other super administrators.</p></div></div><section className="content-card users-card"><div className="users-toolbar"><div><h3>Workspace members <span>{users.length}</span></h3><p>Manage staff and IT administrator access.</p></div><div className="user-controls"><label className="queue-search"><Search size={15}/><input placeholder="Find a person" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/></label><label className="filter-select"><select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option>All users</option><option>Active</option><option>Inactive</option></select><ChevronDown size={14}/></label></div></div><div className="ticket-table-scroll"><table className="dashboard-ticket-table user-table"><thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Tickets</th><th>Account status</th><th>Access</th></tr></thead><tbody>{visible.map((person) => <tr key={person.id}><td><span className="person-cell"><span className={`mini-avatar ${Number(person.active) ? "" : "avatar-muted"}`}>{initials(person.name)}</span><span><b>{person.name}{Number(person.isSuperAdmin) ? <em className="owner-tag">OWNER</em> : null}</b><small>{person.email}</small></span></span></td><td>{Number(person.isSuperAdmin) ? <span className="role-chip role-owner">Super admin</span> : <select className="role-select" disabled={!isSuperAdmin || busyId !== null} aria-busy={busyId === person.id} value={person.role} onChange={(event) => onRoleChange(person, event.target.value)}><option value="staff">Staff</option><option value="admin">IT admin</option></select>}</td><td className="subtle-cell">{person.department || "—"}</td><td className="ticket-count-cell">{person.ticketCount ?? 0}</td><td><span className={`account-status ${Number(person.active) ? "account-active" : "account-inactive"}`}><i/>{Number(person.active) ? "Active" : "Deactivated"}</span></td><td><div className="account-actions">{(isSuperAdmin || (!Number(person.isSuperAdmin) && person.email.toLowerCase() !== "godwin@lumeomarketing.com")) && <button className="access-action" disabled={busyId !== null} onClick={() => onEdit(person)}>Edit</button>}{isSuperAdmin && <><button className={`access-action ${Number(person.active) ? "access-disable" : "access-enable"}`} disabled={busyId !== null} onClick={() => onToggle(person)}>{Number(person.active) ? "Deactivate" : "Reactivate"}</button><button className="access-action access-disable" disabled={busyId !== null} onClick={() => onDelete(person)}>Delete</button></>}</div></td></tr>)}</tbody></table>{!loading && !visible.length && <div className="table-empty">No matching accounts.</div>}{loading && <div className="table-loading">Loading accounts…</div>}</div><Pagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onChange={setPage}/><div className="table-footnote"><LockKeyhole size={13}/> Account changes are recorded in the activity log. Tickets, guides, and audit history are retained when an account is deleted.</div></section></div>;
}

function ActivityFeed({ events, loading }: { events: Event[]; loading: boolean }) {
  const [search, setSearch] = useState(""); const [page, setPage] = useState(1); const pageSize = 10;
  const filtered = events.filter((event) => `${event.actorName} ${event.actorEmail} ${event.action} ${event.details}`.toLowerCase().includes(search.toLowerCase()));
  const pageCount = Math.max(1,Math.ceil(filtered.length/pageSize)); const visible = filtered.slice((page-1)*pageSize,page*pageSize);
  return <section className="content-card activity-card"><div className="activity-toolbar"><div><h3>Audit trail <span className="audit-protected"><ShieldCheck size={13}/> Protected</span></h3><p>Recent account, sign-in, and support ticket events.</p></div><label className="queue-search"><Search size={15}/><input placeholder="Search activity" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/></label></div>{loading && !events.length ? <div className="table-loading">Loading activity…</div> : visible.length ? <div className="activity-list">{visible.map((event) => <article className="activity-row" key={event.id}><span className={`activity-icon activity-${event.entityType}`}><EventIcon event={event}/></span><div className="activity-copy"><div><b>{event.actorName}</b><span className="role-tag">{event.actorRole === "superadmin" ? "SUPER ADMIN" : event.actorRole === "admin" ? "IT ADMIN" : "STAFF"}</span><span>{event.action}</span>{event.entityType === "ticket" && <b className="activity-target">{event.entityId ? `#${event.entityId}` : "ticket"}</b>}</div><p>{event.details || event.entityType}</p><small>{event.actorEmail}</small></div><time>{timeLabel(event.createdAt)}</time></article>)}</div> : <div className="empty-dashboard"><span><Activity size={20}/></span><b>No activity found</b><p>Account and ticket events will show up here.</p></div>}<Pagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onChange={setPage}/><div className="table-footnote"><LockKeyhole size={13}/> Loaded {events.length} events from the audit log. Filter to find a specific action.</div></section>;
}
function EventIcon({ event }: { event: Event }) {
  if (event.action.includes("ticket") || event.entityType === "ticket") return <Ticket size={17}/>;
  if (event.action.includes("sign")) return <LogOut size={17}/>;
  if (event.action.includes("account") || event.entityType === "user") return <UserCog size={17}/>;
  return <Activity size={17}/>;
}

function TicketModal({ user, ticket, onClose, onCreated, onUpdated }: { user: User; ticket: TicketRecord | null; onClose: () => void; onCreated: (ticket: TicketRecord) => void; onUpdated: (ticket: TicketRecord) => void }) {
  const [requestType, setRequestType] = useState(ticket?.requestType || "Incident");
  const [requestSubtype, setRequestSubtype] = useState(ticket?.requestSubtype || REQUEST_OPTIONS.Incident[0]);
  const [status, setStatus] = useState(ticket?.status || "Open"); const [resolution, setResolution] = useState(ticket?.resolution || "");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      if (ticket) {
        const response = await fetch(`/api/tickets/${ticket.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, resolution }) });
        const result = await response.json(); if (!response.ok) setError(result.error || "Could not update the ticket."); else onUpdated(result.ticket);
      } else {
        const form = new FormData(event.currentTarget); const response = await fetch("/api/tickets", { method: "POST", body: form }); const result = await response.json();
        if (!response.ok) setError(result.error || "Could not submit the request."); else onCreated(result.ticket);
      }
    } catch { setError("The support service could not be reached."); }
    finally { setBusy(false); }
  }
  return <Dialog onClose={onClose} wide><div className="dialog-heading"><div><span className="dialog-kicker">{ticket ? ticket.ticketCode : "NEW SUPPORT REQUEST"}</span><h2>{ticket ? ticket.subject : "Tell us what you need."}</h2><p>{ticket ? `${ticket.requestType} · ${ticket.category} · opened ${dateLabel(ticket.createdAt)}` : "The IT team will review your request and follow up with you."}</p></div><button className="dialog-x" onClick={onClose}><X size={18}/></button></div>{ticket ? <div className="ticket-detail-body"><div className="detail-info-grid"><div><small>Requester</small><b>{ticket.fullName}</b><span>{ticket.workEmail}</span></div><div><small>Team / location</small><b>{ticket.department}</b><span>{ticket.location}</span></div><div><small>Priority</small><b className={`priority-label priority-${ticket.priority.toLowerCase()}`}><i/>{ticket.priority}</b><span>{ticket.requestSubtype}</span></div><div><small>Created</small><b>{dateLabel(ticket.createdAt)}</b><span>Ticket ID · {ticket.ticketCode}</span></div></div><div className="ticket-description"><small>REQUEST DETAILS</small><p>{ticket.description}</p>{ticket.attachmentName && <a href={`/api/tickets/${ticket.id}/attachment`}>Download {ticket.attachmentName}</a>}</div>{ticket.resolution && <div className="existing-resolution"><small>LAST IT UPDATE</small><p>{ticket.resolution}</p>{ticket.resolvedAt && <span>Resolved {dateLabel(ticket.resolvedAt)}</span>}</div>}{user.role !== "staff" ? <form onSubmit={submit} className="resolve-form"><div className="dialog-section-title"><b>IT resolution</b><span>Staff receives an in-app notification when saved.</span></div><div className="resolve-fields"><label>Ticket status<select value={status} onChange={(event) => setStatus(event.target.value)}>{STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label><label className="resolution-input">Resolution notes<textarea value={resolution} onChange={(event) => setResolution(event.target.value)} rows={3} placeholder="Add troubleshooting, next steps, or resolution..."/></label></div><ErrorAlert message={error} onClose={() => setError("")}/><div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button><button className="button button-primary" disabled={busy} aria-busy={busy}>{busy && <Spinner/>}{busy ? "Saving…" : "Save ticket update"}{!busy && <Check size={15}/>}</button></div></form> : <div className="staff-resolution"><small>IT TEAM RESPONSE</small><p>{ticket.resolution || "Your ticket is with the support team. Updates will appear here."}</p></div>}</div> : <form onSubmit={submit} className="new-ticket-form"><div className="form-section-name"><span>01</span> Your details <small>Confirm where IT can reach you</small></div><div className="request-grid"><label>Full name<input name="fullName" defaultValue={user.name} required/></label><label>Work email<input name="workEmail" type="email" defaultValue={user.email} required/></label><label>Department<input name="department" defaultValue={user.department || ""} required/></label><label>Job title<input name="jobTitle" defaultValue={user.jobTitle || ""} required/></label><label>Location<input name="location" defaultValue={user.location || ""} required/></label></div><div className="form-section-name"><span>02</span> Request details <small>Tell us what is going on</small></div><div className="request-grid"><label>Request type<select name="requestType" value={requestType} onChange={(event) => { const next = event.target.value; setRequestType(next); setRequestSubtype(REQUEST_OPTIONS[next][0]); }}>{Object.keys(REQUEST_OPTIONS).map((value) => <option key={value}>{value}</option>)}</select></label><label>Request category<select name="requestSubtype" value={requestSubtype} onChange={(event) => setRequestSubtype(event.target.value)}>{REQUEST_OPTIONS[requestType].map((value) => <option key={value}>{value}</option>)}</select></label><label>Issue category<select name="category">{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label><label>Priority<select name="priority" defaultValue="Medium">{PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></label><label className="request-wide">Subject<input name="subject" placeholder="A short summary of the issue" maxLength={160} required/></label><label className="request-wide">Description<textarea name="description" rows={4} placeholder="What happened? What were you trying to do? Include any error messages." maxLength={6000} required/></label><label className="request-wide attachment-field">Screenshot or attachment<input type="file" name="attachment" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"/><small>PNG, JPG, WEBP, PDF or TXT · Max 8 MB</small></label></div><ErrorAlert message={error} onClose={() => setError("")}/><div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy} aria-busy={busy}>{busy && <Spinner/>}{busy ? "Submitting…" : "Submit support request"}{!busy && <ArrowRight size={15}/>}</button></div></form>}</Dialog>;
}

function AddUserModal({ isSuperAdmin, onClose, onCreated }: { isSuperAdmin: boolean; onClose: () => void; onCreated: (user: Account) => void }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [showPassword, setShowPassword] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try { const response = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) setError(result.error || "Could not create account."); else onCreated(result.user); }
    catch { setError("The account service could not be reached."); }
    finally { setBusy(false); }
  }
  return <Dialog onClose={onClose}><div className="dialog-heading"><div><span className="dialog-kicker">WORKSPACE ACCESS</span><h2>Add a teammate</h2><p>{isSuperAdmin ? "Create a staff, IT administrator, or super administrator account." : "Create a staff or IT administrator account."}</p></div><button className="dialog-x" onClick={onClose}><X size={18}/></button></div><form className="add-user-form" onSubmit={submit}><label>Full name<input name="name" placeholder="Jamie Rivera" required minLength={2}/></label><label>Work email<input name="email" placeholder="jamie@company.com" type="email" required/></label><label>Account role<select name="role">{isSuperAdmin && <option value="admin">IT administrator</option>}<option value="staff">Staff member</option>{isSuperAdmin && <option value="superadmin">Super administrator</option>}</select><small>{isSuperAdmin ? "Super administrators can manage protected account controls." : "Administrators can view and resolve every support ticket."}</small></label><div className="request-grid"><label>Department<input name="department" placeholder="Operations"/></label><label>Job title<input name="jobTitle" placeholder="Team member"/></label></div><label>Location<input name="location" placeholder="Main office"/></label><label>Temporary password<span className="password-control"><input name="password" type={showPassword ? "text" : "password"} minLength={10} placeholder="At least 10 characters" required/><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></span><small>Share this securely and ask the user to change it after sign-in.</small></label><ErrorAlert message={error} onClose={() => setError("")}/><div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy} aria-busy={busy}>{busy && <Spinner/>}{busy ? "Creating…" : "Create account"}{!busy && <UserPlus size={15}/>}</button></div></form></Dialog>;
}

function EditUserModal({ user, canManageAccess, onClose, onSaved }: { user: Account; canManageAccess: boolean; onClose: () => void; onSaved: (user: Account) => void }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(Number(user.isSuperAdmin) ? "superadmin" : String(user.role));
  const [department, setDepartment] = useState(user.department || "");
  const [jobTitle, setJobTitle] = useState(user.jobTitle || "");
  const [location, setLocation] = useState(user.location || "");
  const [active, setActive] = useState(Number(user.active) === 1);
  const [password, setPassword] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const payload: Record<string, string | boolean> = { name, email, department, jobTitle, location };
      if (canManageAccess) { payload.role = role; payload.active = active; };
      if (password) payload.password = password;
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) setError(result.error || "Could not update account."); else onSaved(result.user);
    } catch { setError("The account service could not be reached."); }
    finally { setBusy(false); }
  }
  return <Dialog onClose={onClose}><div className="dialog-heading"><div><span className="dialog-kicker">ACCOUNT DETAILS</span><h2>Edit teammate</h2><p>Update the account and optionally assign a new password.</p></div><button className="dialog-x" onClick={onClose}><X size={18}/></button></div><form className="add-user-form" onSubmit={submit}><label>Full name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jamie Rivera" required minLength={2}/></label><label>Work email<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="jamie@company.com" type="email" required/></label><label>Account role<select disabled={!canManageAccess} value={role} onChange={(event) => setRole(event.target.value)}><option value="staff">Staff member</option><option value="admin">IT administrator</option>{canManageAccess && <option value="superadmin">Super administrator</option>}</select><small>Administrators can view and resolve every support ticket.</small></label><div className="request-grid"><label>Department<input value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="Operations"/></label><label>Job title<input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Team member"/></label></div><label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Main office"/></label><label>Account status<select disabled={!canManageAccess} value={active ? "active" : "inactive"} onChange={(event) => setActive(event.target.value === "active")}><option value="active">Active</option><option value="inactive">Inactive</option></select><small>Inactive accounts cannot sign in.</small></label><label>New password (optional)<span className="password-control"><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} minLength={10} placeholder="At least 10 characters"/><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></span><small>Leave blank to keep the current password.</small></label><ErrorAlert message={error} onClose={() => setError("")}/><div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy} aria-busy={busy}>{busy && <Spinner/>}{busy ? "Saving…" : "Save changes"}{!busy && <UserPlus size={15}/>}</button></div></form></Dialog>;
}

function Dialog({ children, onClose, wide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", handler); const old = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.removeEventListener("keydown", handler); document.body.style.overflow = old; }; }, [onClose]);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`dialog-card ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true">{children}</section></div>;
}
