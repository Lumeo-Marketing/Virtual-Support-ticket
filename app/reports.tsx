"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { CATEGORIES, PRIORITIES, STATUSES } from "@/lib/constants";

type ReportTicket = {
  id: number; ticketCode: string; requesterName: string; requesterEmail: string; department: string;
  requestType: string; requestSubtype: string; category: string; priority: string; subject: string;
  status: string; createdAt: string; updatedAt: string; resolvedAt: string | null; resolution: string;
  resolverName: string | null; resolverEmail: string | null; resolutionHours: number | null;
};
type ReportEvent = { id: number; actorName: string; actorEmail: string; actorRole: string; action: string; entityType: string; entityId: string | null; details: string; createdAt: string };
type Agent = { agentId: number | null; agent: string; assigned: number; resolved: number; averageResolutionHours: number | null };
type Bundle = {
  summary: { total: number; open: number; resolved: number; urgent: number; over24Hours: number; averageResolutionHours: number | null };
  tickets: ReportTicket[]; ticketPage: PageMeta; statusBreakdown: { label: string; value: number }[];
  monthly: { month: string; opened: number; resolved: number }[]; agents: Agent[]; owners: { id: number; name: string; email: string }[];
  activity: ReportEvent[]; activityPage: PageMeta;
};
type PageMeta = { page: number; pageSize: number; total: number; pageCount: number };

const dateLabel = (date: string) => new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const timeLabel = (date: string) => new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const tone = (value: string) => value.toLowerCase().replaceAll(" ", "-");

export function Reports({ onSelectTicket }: { onSelectTicket: (id: number) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [agentPage, setAgentPage] = useState(1);
  const [data, setData] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = useMemo(() => new URLSearchParams({ q: search, status, category, priority, assignee, from, to, page: String(page), activityPage: String(activityPage), pageSize: "10" }).toString(), [search, status, category, priority, assignee, from, to, page, activityPage]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void fetch(`/api/admin/reports?${query}`).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load report data.");
        if (active) setData(result as Bundle);
      }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load report data.");
      }).finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  function applyFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
    setActivityPage(1);
    setAgentPage(1);
  }
  async function exportCsv(kind: "csv" | "activity-csv") {
    try {
      const response = await fetch(`/api/admin/reports?${query}&export=${kind}`);
      if (!response.ok) throw new Error("Export request failed");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = kind === "csv" ? "lumeo-support-report.csv" : "lumeo-activity-report.csv";
      link.click();
      URL.revokeObjectURL(href);
    } catch {
      setError("Could not export this report. Please try again.");
    }
  }
  const maxMonth = Math.max(1, ...(data?.monthly || []).map((item) => item.opened));

  return <div className="reports-page">
    <div className="report-toolbar">
      <label className="report-filter-search"><Search size={16}/><input placeholder="Search ticket, requester, resolution, or IT owner" value={search} onChange={(event) => applyFilter(setSearch, event.target.value)}/></label>
      <label><span>Status</span><select value={status} onChange={(event) => applyFilter(setStatus, event.target.value)}><option value="">All statuses</option>{STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Category</span><select value={category} onChange={(event) => applyFilter(setCategory, event.target.value)}><option value="">All categories</option>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Priority</span><select value={priority} onChange={(event) => applyFilter(setPriority, event.target.value)}><option value="">All priorities</option>{PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>IT owner</span><select value={assignee} onChange={(event) => applyFilter(setAssignee, event.target.value)}><option value="">All IT owners</option>{(data?.owners || []).map((owner) => <option key={owner.id} value={owner.id}>{owner.name} · {owner.email}</option>)}</select></label>
      <label><span>From</span><input type="date" value={from} onChange={(event) => applyFilter(setFrom, event.target.value)}/></label>
      <label><span>To</span><input type="date" value={to} onChange={(event) => applyFilter(setTo, event.target.value)}/></label>
      <button className="filter-reset" onClick={() => { setSearch(""); setStatus(""); setCategory(""); setPriority(""); setAssignee(""); setFrom(""); setTo(""); setPage(1); setActivityPage(1); setAgentPage(1); }}>Reset</button>
    </div>
    <div className="report-export-row"><span><CalendarDays size={15}/>{from || to ? `${from || "Beginning"} — ${to || "Today"}` : "All recorded support history"}{loading && <i>Refreshing…</i>}</span><div><button className="button button-secondary" onClick={() => void exportCsv("activity-csv")}><Download size={15}/> Export activity CSV</button><button className="button button-primary" onClick={() => void exportCsv("csv")}><Download size={15}/> Export ticket report</button></div></div>
    {error && <div className="report-error"><AlertCircle size={16}/>{error}</div>}
    {!data && loading ? <div className="content-card table-loading">Loading reporting data…</div> : data && <>
      <div className="report-kpis">
        <ReportKpi label="Matching requests" value={data.summary.total} detail="Tickets in selected view" tone="orange"/>
        <ReportKpi label="Resolved / closed" value={data.summary.resolved} detail={`${data.summary.total ? Math.round(data.summary.resolved / data.summary.total * 100) : 0}% of matching tickets`} tone="green"/>
        <ReportKpi label="Average resolution" value={data.summary.averageResolutionHours === null ? "—" : `${data.summary.averageResolutionHours}h`} detail="Created to resolved / closed" tone="blue"/>
        <ReportKpi label="Over 24 hours" value={data.summary.over24Hours} detail="Resolved after one day" tone="red"/>
        <ReportKpi label="Urgent and open" value={data.summary.urgent} detail="Critical or high priority" tone="violet"/>
      </div>
      <div className="report-chart-grid">
        <section className="content-card report-chart-card"><div className="report-card-head"><div><h3>Request volume</h3><p>Monthly opened and resolved tickets.</p></div><span className="chart-legend"><i className="legend-open"/> Opened <i className="legend-resolved"/> Resolved</span></div>{data.monthly.length ? <div className="monthly-bars">{data.monthly.map((item) => <div className="month-column" key={item.month}><div className="month-bar-area"><div className="month-bar-stack" title={`${item.opened} opened · ${item.resolved} resolved`}><i className="opened-bar" style={{ height: `${Math.max(4, item.opened / maxMonth * 100)}%` }}/><i className="resolved-bar" style={{ height: `${item.opened ? Math.max(3, item.resolved / item.opened * 100) : 0}%` }}/></div></div><small>{new Date(`${item.month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" })}</small></div>)}</div> : <div className="report-no-chart">No ticket volume found for this selection.</div>}</section>
        <section className="content-card report-chart-card status-chart"><div className="report-card-head"><div><h3>Queue by status</h3><p>Current status in the filtered set.</p></div></div>{data.statusBreakdown.length ? <div className="status-chart-list">{data.statusBreakdown.map((item) => <div className="status-chart-row" key={item.label}><span>{item.label}</span><div><i className={`status-fill status-${tone(item.label)}`} style={{ width: `${data.summary.total ? item.value / data.summary.total * 100 : 0}%` }}/></div><b>{item.value}</b></div>)}</div> : <div className="report-no-chart">No status data.</div>}</section>
      </div>
      <section className="content-card report-data-card"><div className="report-section-head"><div><h3>Request details</h3><p>Find historical requests by filter; select a row for full details.</p></div><span>{data.ticketPage.total} records</span></div><div className="ticket-table-scroll"><table className="dashboard-ticket-table report-ticket-table"><thead><tr><th>Ticket / requester</th><th>Subject</th><th>Priority</th><th>Status</th><th>Created</th><th>Resolved</th><th>Resolution time</th><th>IT owner</th></tr></thead><tbody>{data.tickets.map((ticket) => <tr key={ticket.id} onClick={() => onSelectTicket(ticket.id)}><td><b className="ticket-id">{ticket.ticketCode}</b><small>{ticket.requesterName} · {ticket.department}</small></td><td className="subject-cell"><b>{ticket.subject}</b><small>{ticket.category} · {ticket.requestType}</small></td><td><span className={`priority-label priority-${ticket.priority.toLowerCase()}`}><i/>{ticket.priority}</span></td><td><span className={`status-label status-${tone(ticket.status)}`}><i/>{ticket.status}</span></td><td>{dateLabel(ticket.createdAt)}</td><td>{ticket.resolvedAt ? dateLabel(ticket.resolvedAt) : "—"}</td><td>{ticket.resolutionHours === null ? "In progress" : `${ticket.resolutionHours}h`}</td><td>{ticket.resolverName || "Unassigned"}</td></tr>)}</tbody></table>{!data.tickets.length && <div className="table-empty">No tickets match these report filters.</div>}</div><ReportPagination page={data.ticketPage.page} pageCount={data.ticketPage.pageCount} total={data.ticketPage.total} pageSize={data.ticketPage.pageSize} onChange={setPage}/></section>
      <div className="report-bottom-grid">
        <section className="content-card report-data-card"><div className="report-section-head"><div><h3>IT workload &amp; resolution</h3><p>Assigned requests and average time to resolve.</p></div></div><div className="ticket-table-scroll"><table className="dashboard-ticket-table"><thead><tr><th>IT owner</th><th>Assigned</th><th>Resolved</th><th>Resolution rate</th><th>Avg. resolution</th></tr></thead><tbody>{data.agents.slice((agentPage - 1) * 10, agentPage * 10).map((agent, index) => <tr key={agent.agentId || `unassigned-${index}`}><td><b>{agent.agent}</b></td><td>{agent.assigned}</td><td>{agent.resolved}</td><td>{agent.assigned ? `${Math.round(agent.resolved / agent.assigned * 100)}%` : "—"}</td><td>{agent.averageResolutionHours === null ? "—" : `${agent.averageResolutionHours}h`}</td></tr>)}</tbody></table>{!data.agents.length && <div className="table-empty">No assigned ticket data.</div>}</div><ReportPagination page={agentPage} pageCount={Math.max(1, Math.ceil(data.agents.length / 10))} total={data.agents.length} pageSize={10} onChange={setAgentPage}/></section>
        <section className="content-card report-data-card"><div className="report-section-head"><div><h3>Recent activity</h3><p>Sign-ins, access changes, ticket updates, and resolutions.</p></div><span>{data.activityPage.total} events</span></div><div className="report-activity-list">{data.activity.map((event) => <div className="report-activity-row" key={event.id}><span className={`activity-icon activity-${event.entityType}`}><Activity size={16}/></span><div><b>{event.actorName}</b><span>{event.action}</span><small>{event.details || event.entityType}</small></div><time>{timeLabel(event.createdAt)}</time></div>)}</div><ReportPagination page={data.activityPage.page} pageCount={data.activityPage.pageCount} total={data.activityPage.total} pageSize={data.activityPage.pageSize} onChange={setActivityPage}/></section>
      </div>
    </>}
  </div>;
}

function ReportKpi({ label, value, detail, tone: color }: { label: string; value: string | number; detail: string; tone: string }) {
  return <article className="report-kpi"><span className={`report-kpi-dot kpi-${color}`}/><span>{label}</span><b>{value}</b><small>{detail}</small></article>;
}
function ReportPagination({ page, pageCount, total, pageSize, onChange }: { page: number; pageCount: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return <div className="pagination"><span>Showing <b>{first}–{last}</b> of <b>{total}</b></span><div><button disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))} aria-label="Previous page"><ChevronLeft size={15}/></button><span>Page <b>{page}</b> of {pageCount}</span><button disabled={page >= pageCount} onClick={() => onChange(Math.min(pageCount, page + 1))} aria-label="Next page"><ChevronRight size={15}/></button></div></div>;
}
