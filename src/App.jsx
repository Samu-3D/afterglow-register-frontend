import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import QRCode from "qrcode";
import Cropper from "react-easy-crop";
import { Html5QrcodeScanner } from "html5-qrcode";

const API_BASE = (import.meta.env.VITE_API_URL || localStorage.getItem("afterglow_api_url") || "http://localhost:5000").replace(/\/$/, "");
const TOKEN_KEY = "afterglow_register_token";
const USER_KEY = "afterglow_register_user";

const CATS = ["VIP", "Speaker", "Guest", "Media", "Staff", "Exhibitor", "Sponsor", "Delegate"];
const ROLES = ["super_admin", "event_admin", "registration_staff", "checkin_staff", "badge_staff"];
const ROLE_LABELS = {
  super_admin: "Super Admin",
  event_admin: "Event Admin",
  registration_staff: "Registration Staff",
  checkin_staff: "Check-in Staff",
  badge_staff: "Badge Staff",
};
const DEFAULT_SETTINGS = {
  systemName: "Afterglow Register",
  logoUrl: "",
  appearance: { mode: "dark", accentColor: "#CF6B11", fontSize: "normal", compactMode: false, sidebarStyle: "default" },
  email: { enabled: false, mode: "simulation", fromName: "Afterglow Register Team" },
};
const DEFAULT_BADGE = {
  bgColor: "#1A1A19",
  backgroundUrl: "",
  size: "A6",
  fields: [
    { key: "fullName", label: "Full Name", x: 50, y: 56, size: 22, weight: "bold", color: "#F1DDC5", align: "center" },
    { key: "organization", label: "Organization", x: 50, y: 68, size: 13, weight: "normal", color: "#E8B267", align: "center" },
    { key: "jobTitle", label: "Job Title", x: 50, y: 76, size: 11, weight: "normal", color: "#BBBBBB", align: "center" },
    { key: "category", label: "Category", x: 50, y: 86, size: 10, weight: "bold", color: "#CF6B11", align: "center" },
  ],
  qrX: 50,
  qrY: 32,
  qrSize: 24,
  showPhoto: true,
  photoX: 50,
  photoY: 19,
  photoSize: 21,
};
const DEFAULT_PRINT = { paperSize: "A6", customWidthMm: 105, customHeightMm: 148, marginMm: 0, fitToPaper: true, autoPrintAfterCheckin: true };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtTime = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const safe = (v) => (v === undefined || v === null || v === "" ? "—" : String(v));

function qrPayload(delegate) {
  const eventId = typeof delegate.event === "object" ? delegate.event?._id : delegate.event;
  return JSON.stringify({ eventId, delegateId: delegate.delegateId, qrToken: delegate.qrToken });
}

function normalizeEvent(ev) {
  return {
    ...ev,
    badgeTemplate: { ...DEFAULT_BADGE, ...(ev?.badgeTemplate || {}), fields: ev?.badgeTemplate?.fields?.length ? ev.badgeTemplate.fields : DEFAULT_BADGE.fields },
    printSettings: { ...DEFAULT_PRINT, ...(ev?.printSettings || {}) },
    registrationSettings: {
      photoUploadEnabled: true,
      emailConfirmationEnabled: true,
      requiredFields: ["fullName", "email"],
      customFields: [],
      ...(ev?.registrationSettings || {}),
    },
  };
}

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const err = contentType.includes("application/json") ? await res.json() : await res.text();
      message = err?.message || err?.error || String(err) || message;
    } catch {}
    throw new Error(message);
  }
  if (contentType.includes("application/json")) return res.json();
  return res;
}

function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3800);
  }, []);
  const Toast = () =>
    toast ? (
      <div className={`toast ${toast.type}`}>
        <i className={`ti ${toast.type === "error" ? "ti-alert-circle" : "ti-circle-check"}`} /> {toast.message}
      </div>
    ) : null;
  return { showToast: show, Toast };
}

export default function App() {
  const publicEventId = new URLSearchParams(location.search).get("register");
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; }
  });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(localStorage.getItem("afterglow_selected_event") || "");
  const [delegates, setDelegates] = useState([]);
  const [view, setView] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const { showToast, Toast } = useToast();

  const selectedEvent = useMemo(() => normalizeEvent(events.find((e) => e._id === selectedEventId) || events[0] || null), [events, selectedEventId]);
  const accent = settings?.appearance?.accentColor || "#CF6B11";
  const isLight = settings?.appearance?.mode === "light";

  useEffect(() => {
    document.title = settings?.systemName || "Afterglow Register";
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--font-scale", settings?.appearance?.fontSize === "small" ? ".92" : settings?.appearance?.fontSize === "large" ? "1.08" : "1");
    document.body.className = `${isLight ? "light" : "dark"} ${settings?.appearance?.compactMode ? "compact" : ""}`;
  }, [settings, accent, isLight]);

  const refresh = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    setLoading(true);
    try {
      const [settingsRes, eventsRes] = await Promise.allSettled([api("/api/settings"), api("/api/events")]);
      if (settingsRes.status === "fulfilled") setSettings({ ...DEFAULT_SETTINGS, ...(settingsRes.value.settings || {}) });
      if (eventsRes.status === "fulfilled") {
        const evs = (eventsRes.value.events || []).map(normalizeEvent);
        setEvents(evs);
        const stored = localStorage.getItem("afterglow_selected_event");
        if (evs.length && (!stored || !evs.some((e) => e._id === stored))) {
          setSelectedEventId(evs[0]._id);
          localStorage.setItem("afterglow_selected_event", evs[0]._id);
        }
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadDelegates = useCallback(async (eventId = selectedEvent?._id) => {
    if (!eventId || !localStorage.getItem(TOKEN_KEY)) return;
    try {
      const res = await api(`/api/events/${eventId}/delegates`);
      setDelegates(res.delegates || []);
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [selectedEvent?._id, showToast]);

  useEffect(() => { if (token) refresh(); }, [token, refresh]);
  useEffect(() => { if (selectedEvent?._id) loadDelegates(selectedEvent._id); }, [selectedEvent?._id, loadDelegates]);

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setEvents([]);
    setDelegates([]);
  };

  const login = async (username, password) => {
    const res = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setToken(res.token);
    setUser(res.user);
    showToast("Logged in successfully");
  };

  if (publicEventId) return <PublicRegister eventId={publicEventId} settings={settings} showToast={showToast} Toast={Toast} />;
  if (!token || !user) return <LoginScreen onLogin={login} settings={settings} Toast={Toast} />;

  const scopedDelegates = delegates.filter(Boolean);
  const stats = { total: scopedDelegates.length, checkedIn: scopedDelegates.filter((d) => d.checkedIn).length, pending: scopedDelegates.filter((d) => !d.checkedIn).length };
  const canManageUsers = user.role === "super_admin";
  const canEditEvents = ["super_admin", "event_admin"].includes(user.role);
  const canRegister = ["super_admin", "event_admin", "registration_staff"].includes(user.role);
  const canCheckin = ["super_admin", "event_admin", "checkin_staff", "registration_staff"].includes(user.role);
  const canPrint = ["super_admin", "event_admin", "badge_staff", "checkin_staff"].includes(user.role);

  const nav = [
    ["dashboard", "ti-layout-dashboard", "Dashboard", true],
    ["events", "ti-calendar-event", "Events", canEditEvents],
    ["delegates", "ti-users", "Participants", true],
    ["register", "ti-user-plus", "Register", canRegister],
    ["checkin", "ti-qrcode", "Check-in", canCheckin],
    ["badges", "ti-id-badge", "Badges", canPrint],
    ["designer", "ti-palette", "Badge Designer", canEditEvents],
    ["reports", "ti-file-spreadsheet", "Reports", true],
    ["users", "ti-user-cog", "Users", canManageUsers],
    ["settings", "ti-settings", "Settings", user.role === "super_admin"],
  ].filter((n) => n[3]);

  const common = { selectedEvent, events, delegates: scopedDelegates, stats, user, refresh, loadDelegates, showToast, setView, settings, setSettings };

  return (
    <div className="app-shell">
      <style>{styles}</style>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">AG</div>
          <div className="brand-text">
            <b>{settings.systemName || "Afterglow Register"}</b>
            <span>Online event check-in</span>
          </div>
        </div>
        <div className="event-select-wrap">
          <label>Active event</label>
          <select
            title={selectedEvent?.name || "No event"}
            value={selectedEvent?._id || ""}
            onChange={(e) => { setSelectedEventId(e.target.value); localStorage.setItem("afterglow_selected_event", e.target.value); }}
          >
            {events.length === 0 && <option>No event yet</option>}
            {events.map((e) => <option key={e._id} value={e._id}>{e.name}</option>)}
          </select>
          <div className="active-event-name" title={selectedEvent?.name || "No event selected"}>{selectedEvent?.name || "No event selected"}</div>
        </div>
        <nav className="nav-list">
          {nav.map(([id, icon, label]) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
              <i className={`ti ${icon}`} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="user-box">
          <div className="small-muted">Logged in</div>
          <b>{user.fullName}</b>
          <span>{ROLE_LABELS[user.role] || user.role}</span>
          <button className="link-btn" onClick={logout}><i className="ti ti-logout" /> Sign out</button>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <button className="mobile-menu"><i className="ti ti-menu-2" /></button>
          <div className="top-title">
            <h1>{nav.find((n) => n[0] === view)?.[2] || "Dashboard"}</h1>
            <p>{selectedEvent?.name || "Create or select an event"}</p>
          </div>
          <div className="top-actions">
            <span className={`api-pill ${loading ? "loading" : ""}`} title={API_BASE}>API: {API_BASE.replace(/^https?:\/\//, "")}</span>
            <button className="btn ghost" onClick={() => { refresh(); if (selectedEvent?._id) loadDelegates(selectedEvent._id); }}><i className="ti ti-refresh" /> Refresh</button>
          </div>
        </header>
        <section className="content">
          {view === "dashboard" && <DashboardView {...common} />}
          {view === "events" && <EventsView {...common} canEdit={canEditEvents} />}
          {view === "delegates" && <DelegatesView {...common} canRegister={canRegister} canCheckin={canCheckin} canPrint={canPrint} />}
          {view === "register" && <RegisterView {...common} />}
          {view === "checkin" && <CheckinView {...common} />}
          {view === "badges" && <BadgesView {...common} />}
          {view === "designer" && <BadgeDesignerView {...common} />}
          {view === "reports" && <ReportsView {...common} />}
          {view === "users" && <UsersView {...common} />}
          {view === "settings" && <SettingsView {...common} />}
        </section>
      </main>
      <nav className="mobile-bottom">
        {nav.slice(0, 5).map(([id, icon, label]) => (
          <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
            <i className={`ti ${icon}`} /><span>{label.split(" ")[0]}</span>
          </button>
        ))}
      </nav>
      <Toast />
    </div>
  );
}

function LoginScreen({ onLogin, settings, Toast }) {
  const [username, setUsername] = useState("Afterglow");
  const [password, setPassword] = useState("After26");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await onLogin(username, password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-page">
      <style>{styles}</style>
      <form className="login-card" onSubmit={submit}>
        <div className="brand-logo big">AG</div>
        <h1>{settings?.systemName || "Afterglow Register"}</h1>
        <p>Connect to your MongoDB backend and manage registration, check-in, badges, and reports.</p>
        {error && <div className="alert error"><i className="ti ti-alert-circle" /> {error}</div>}
        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Afterglow" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="After26" />
        <button className="btn primary full" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        <div className="small-muted center">Backend: {API_BASE}</div>
      </form>
      <Toast />
    </div>
  );
}

function DashboardView({ stats, delegates, selectedEvent, setView }) {
  const latest = delegates.slice(0, 6);
  const byCat = CATS.map((c) => [c, delegates.filter((d) => d.category === c).length]).filter(([, n]) => n);
  return (
    <>
      <div className="cards three">
        <StatCard title="Total Participants" value={stats.total} icon="ti-users" />
        <StatCard title="Checked In" value={stats.checkedIn} icon="ti-circle-check" green />
        <StatCard title="Pending" value={stats.pending} icon="ti-clock" orange />
      </div>
      <div className="grid-two">
        <div className="panel">
          <h3>Quick actions</h3>
          <div className="quick-actions">
            <button onClick={() => setView("register")}><i className="ti ti-user-plus" /> Register participant</button>
            <button onClick={() => setView("checkin")}><i className="ti ti-qrcode" /> Open check-in</button>
            <button onClick={() => setView("badges")}><i className="ti ti-printer" /> Print badges</button>
            <button onClick={() => setView("reports")}><i className="ti ti-file-spreadsheet" /> Export report</button>
          </div>
        </div>
        <div className="panel">
          <h3>Event summary</h3>
          <div className="info-list">
            <span><b>Event</b>{selectedEvent?.name || "—"}</span>
            <span><b>Date</b>{fmtDate(selectedEvent?.date)}</span>
            <span><b>Venue</b>{selectedEvent?.venue || "—"}</span>
            <span><b>Organizer</b>{selectedEvent?.organizer || "—"}</span>
          </div>
        </div>
      </div>
      <div className="grid-two">
        <div className="panel">
          <h3>Category breakdown</h3>
          {byCat.length ? byCat.map(([c, n]) => <Progress key={c} label={c} value={n} max={stats.total} />) : <Empty text="No participants yet" />}
        </div>
        <div className="panel">
          <h3>Recent participants</h3>
          {latest.length ? latest.map((d) => <MiniDelegate key={d._id} d={d} />) : <Empty text="No registrations yet" />}
        </div>
      </div>
    </>
  );
}

function EventsView({ events, selectedEvent, refresh, showToast, canEdit }) {
  const [form, setForm] = useState(null);
  const blank = { name: "", date: "", venue: "", organizer: "Afterglow Register", description: "", status: "open", themeColor: "#CF6B11", badgeTemplate: DEFAULT_BADGE, printSettings: DEFAULT_PRINT };
  const save = async () => {
    if (!form.name || !form.date) return showToast("Event name and date are required", "error");
    const body = { ...form, date: form.date };
    if (form._id) await api(`/api/events/${form._id}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/api/events", { method: "POST", body: JSON.stringify(body) });
    setForm(null); showToast("Event saved"); refresh();
  };
  const copyLink = async (id) => {
    const url = `${location.origin}${location.pathname}?register=${id}`;
    await navigator.clipboard.writeText(url);
    showToast("Public registration link copied");
  };
  return (
    <div>
      {canEdit && <div className="toolbar"><button className="btn primary" onClick={() => setForm(blank)}><i className="ti ti-plus" /> New event</button></div>}
      <div className="event-grid">
        {events.map((e) => <div key={e._id} className="event-card">
          <div className="event-color" style={{ background: e.themeColor || "var(--accent)" }} />
          <h3 title={e.name}>{e.name}</h3>
          <p><i className="ti ti-calendar" /> {fmtDate(e.date)}</p>
          <p><i className="ti ti-map-pin" /> {e.venue || "No venue"}</p>
          <p>{e.description || "No description"}</p>
          <div className="row-actions">
            <button className="btn ghost" onClick={() => copyLink(e._id)}><i className="ti ti-link" /> Registration link</button>
            {canEdit && <button className="btn ghost" onClick={() => setForm({ ...normalizeEvent(e), date: e.date ? String(e.date).slice(0,10) : "" })}><i className="ti ti-edit" /> Edit</button>}
          </div>
        </div>)}
      </div>
      {form && <Modal title={form._id ? "Edit event" : "New event"} onClose={() => setForm(null)}>
        <div className="form-grid two">
          <Field label="Event name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Venue"><input value={form.venue || ""} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></Field>
          <Field label="Organizer"><input value={form.organizer || ""} onChange={(e) => setForm({ ...form, organizer: e.target.value })} /></Field>
          <Field label="Theme color"><input type="color" value={form.themeColor || "#CF6B11"} onChange={(e) => setForm({ ...form, themeColor: e.target.value })} /></Field>
          <Field label="Status"><select value={form.status || "open"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="open">Open</option><option value="closed">Closed</option></select></Field>
          <Field label="Description" full><textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        <div className="modal-actions"><button className="btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn primary" onClick={save}>Save event</button></div>
      </Modal>}
    </div>
  );
}

function DelegatesView({ delegates, selectedEvent, loadDelegates, showToast, canRegister, canCheckin, canPrint, setView }) {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const [status, setStatus] = useState("All");
  const [selected, setSelected] = useState(null);
  const filtered = delegates.filter((d) => {
    const q = search.toLowerCase();
    return (!q || [d.fullName, d.email, d.organization, d.jobTitle, d.delegateId].some((v) => String(v || "").toLowerCase().includes(q))) &&
      (cat === "All" || d.category === cat) && (status === "All" || (status === "checked" ? d.checkedIn : !d.checkedIn));
  });
  const checkin = async (d) => {
    try { await api(`/api/delegates/${d._id}/checkin`, { method: "POST" }); showToast(`${d.fullName} checked in`); loadDelegates(); } catch (e) { showToast(e.message, "error"); }
  };
  const remove = async (d) => {
    if (!confirm(`Delete ${d.fullName}?`)) return;
    await api(`/api/delegates/${d._id}`, { method: "DELETE" }); showToast("Participant deleted"); loadDelegates();
  };
  return (
    <div>
      <div className="toolbar wrap">
        <input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search participants..." />
        <select value={cat} onChange={(e) => setCat(e.target.value)}><option>All</option>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="All">All status</option><option value="checked">Checked in</option><option value="pending">Pending</option></select>
        {canRegister && <button className="btn primary" onClick={() => setView("register")}><i className="ti ti-user-plus" /> Add</button>}
      </div>
      <ResponsiveDelegateList delegates={filtered} onView={setSelected} onCheckin={canCheckin ? checkin : null} onDelete={remove} canPrint={canPrint} selectedEvent={selectedEvent} />
      {selected && <Modal title="Participant profile" onClose={() => setSelected(null)}>
        <div className="profile-head">
          <Avatar d={selected} />
          <div><h2>{selected.fullName}</h2><p>{selected.jobTitle || "—"} · {selected.organization || "—"}</p><CategoryBadge cat={selected.category} /></div>
          <QRCodeCanvas value={qrPayload(selected)} size={96} />
        </div>
        <div className="info-grid">
          {[ ["Delegate ID", selected.delegateId], ["Email", selected.email], ["Phone", selected.phone], ["Country", selected.country], ["Registered", fmtTime(selected.createdAt)], ["Checked in", selected.checkedIn ? fmtTime(selected.checkedInAt) : "Pending"] ].map(([k, v]) => <span key={k}><b>{k}</b>{safe(v)}</span>)}
        </div>
        <div className="modal-actions">
          {canCheckin && !selected.checkedIn && <button className="btn success" onClick={() => checkin(selected)}>Check in</button>}
          {canPrint && <button className="btn primary" onClick={() => printBadges([selected], selectedEvent)}>Print badge</button>}
        </div>
      </Modal>}
    </div>
  );
}

function RegisterView({ selectedEvent, loadDelegates, showToast }) {
  const [done, setDone] = useState(null);
  return <RegistrationForm event={selectedEvent} authMode onDone={(delegate, email) => { setDone({ delegate, email }); loadDelegates(); }} showToast={showToast} done={done} setDone={setDone} />;
}

function PublicRegister({ eventId, settings, showToast, Toast }) {
  const [done, setDone] = useState(null);
  const event = { _id: eventId, name: "Public Event", registrationSettings: { photoUploadEnabled: true, emailConfirmationEnabled: true, requiredFields: ["fullName", "email"] } };
  return (
    <div className="public-page">
      <style>{styles}</style>
      <div className="public-brand"><div className="brand-logo">AG</div><div><b>{settings?.systemName || "Afterglow Register"}</b><span>Public registration</span></div></div>
      <RegistrationForm event={event} publicMode onDone={(delegate, email) => setDone({ delegate, email })} showToast={showToast} done={done} setDone={setDone} />
      <Toast />
    </div>
  );
}

function RegistrationForm({ event, publicMode, authMode, onDone, showToast, done, setDone }) {
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", organization: "", jobTitle: "", country: "Rwanda", category: "Delegate", photoUrl: "" });
  const [cropSrc, setCropSrc] = useState(null);
  const [busy, setBusy] = useState(false);
  const register = async () => {
    if (!event?._id) return showToast("No event selected", "error");
    if (!form.fullName || !form.email) return showToast("Full name and email are required", "error");
    setBusy(true);
    try {
      const path = publicMode ? `/api/public/events/${event._id}/register` : `/api/events/${event._id}/delegates`;
      const res = await api(path, { method: "POST", body: JSON.stringify(form) });
      let email = res.email;
      if (!publicMode && res.delegate?._id) {
        try {
          const emailRes = await api(`/api/delegates/${res.delegate._id}/resend-email`, { method: "POST" });
          email = emailRes.email;
        } catch (emailError) {
          email = { status: "failed", error: emailError.message };
        }
      }
      showToast(email?.status === "sent" ? "Registration complete and email sent" : "Registration complete. Email simulation saved.");
      onDone(res.delegate, email);
    } catch (e) { showToast(e.message, "error"); } finally { setBusy(false); }
  };
  const onImage = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result);
    reader.readAsDataURL(file);
  };
  if (done) return <div className="register-done panel narrow">
    <i className="ti ti-circle-check" />
    <h2>Registration complete</h2>
    <p>Your QR code has been prepared. Present it at the event entrance.</p>
    <div className="qr-card"><QRCodeCanvas value={qrPayload(done.delegate)} size={190} /><span>{done.delegate.delegateId}</span></div>
    <div className="alert"><b>Email status:</b> {done.email?.status || "saved"}</div>
    <button className="btn primary" onClick={() => { setDone(null); setForm({ fullName: "", email: "", phone: "", organization: "", jobTitle: "", country: "Rwanda", category: "Delegate", photoUrl: "" }); }}>Register another</button>
  </div>;
  return <div className="panel register-panel">
    <h2>Participant registration</h2>
    <p className="small-muted">{event?.name || "Selected event"}</p>
    <div className="form-grid two">
      <Field label="Full name *" full><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
      <Field label="Email *"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="Organization"><input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></Field>
      <Field label="Job title"><input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></Field>
      <Field label="Country"><input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
      <Field label="Category"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Photo crop/upload" full>
        <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0])} />
        {form.photoUrl && <img src={form.photoUrl} className="photo-preview" alt="participant preview" />}
      </Field>
    </div>
    <button className="btn primary full" disabled={busy} onClick={register}>{busy ? "Saving..." : "Complete registration"}</button>
    {cropSrc && <ImageCropModal src={cropSrc} onClose={() => setCropSrc(null)} onCrop={(dataUrl) => { setForm((f) => ({ ...f, photoUrl: dataUrl })); setCropSrc(null); }} />}
  </div>;
}

function CheckinView({ selectedEvent, loadDelegates, showToast }) {
  const [manual, setManual] = useState("");
  const [result, setResult] = useState(null);
  const [scannerOn, setScannerOn] = useState(false);
  const scannerRef = useRef(null);
  const checkPayload = async (payload) => {
    try {
      const res = await api("/api/checkin/qr", { method: "POST", body: JSON.stringify({ qrPayload: payload, delegateId: payload, eventId: selectedEvent?._id }) });
      setResult({ ok: true, delegate: res.delegate, message: res.message });
      showToast(`${res.delegate.fullName} checked in`);
      loadDelegates();
      if (selectedEvent?.printSettings?.autoPrintAfterCheckin !== false) setTimeout(() => printBadges([res.delegate], selectedEvent), 400);
    } catch (e) {
      setResult({ ok: false, message: e.message });
      showToast(e.message, "error");
    }
  };
  useEffect(() => {
    if (!scannerOn) return;
    const id = "qr-reader";
    const scanner = new Html5QrcodeScanner(id, { fps: 10, qrbox: { width: 240, height: 240 } }, false);
    scannerRef.current = scanner;
    scanner.render((decoded) => { scanner.clear(); setScannerOn(false); checkPayload(decoded); }, () => {});
    return () => { try { scanner.clear(); } catch {} };
  }, [scannerOn]);
  return <div className="checkin-grid">
    <div className="panel scanner-panel">
      <h2>Check-in station</h2>
      <p className="small-muted">Scan QR code or enter delegate ID manually.</p>
      {scannerOn ? <div id="qr-reader" className="qr-reader" /> : <button className="btn primary full" onClick={() => setScannerOn(true)}><i className="ti ti-camera" /> Start camera scanner</button>}
      {scannerOn && <button className="btn ghost full" onClick={() => { try { scannerRef.current?.clear(); } catch {}; setScannerOn(false); }}>Stop camera</button>}
      <div className="manual-check">
        <input value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && checkPayload(manual)} placeholder="Delegate ID or QR payload" />
        <button className="btn primary" onClick={() => checkPayload(manual)}>Check</button>
      </div>
    </div>
    <div className="panel">
      <h3>Result</h3>
      {!result && <Empty text="No scan yet" />}
      {result && <div className={`result-card ${result.ok ? "success" : "error"}`}>
        <i className={`ti ${result.ok ? "ti-circle-check" : "ti-alert-circle"}`} />
        <b>{result.ok ? "Checked in" : "Check-in failed"}</b>
        <p>{result.message}</p>
        {result.delegate && <MiniDelegate d={result.delegate} />}
      </div>}
      <button className="btn ghost full" onClick={() => printTest(selectedEvent)}>Test print badge</button>
    </div>
  </div>;
}

function BadgesView({ delegates, selectedEvent }) {
  const [cat, setCat] = useState("All");
  const filtered = delegates.filter((d) => cat === "All" || d.category === cat);
  return <div>
    <div className="toolbar"><select value={cat} onChange={(e) => setCat(e.target.value)}><option>All</option>{CATS.map((c) => <option key={c}>{c}</option>)}</select><button className="btn primary" onClick={() => printBadges(filtered, selectedEvent)}><i className="ti ti-printer" /> Print selected/all</button></div>
    <div className="badge-grid">{filtered.map((d) => <div className="badge-tile" key={d._id}><BadgeView delegate={d} event={selectedEvent} size={190} /><b>{d.fullName}</b><button className="btn ghost" onClick={() => printBadges([d], selectedEvent)}>Print</button></div>)}</div>
  </div>;
}

function BadgeDesignerView({ selectedEvent, refresh, showToast }) {
  const [tmpl, setTmpl] = useState(selectedEvent?.badgeTemplate || DEFAULT_BADGE);
  const [print, setPrint] = useState(selectedEvent?.printSettings || DEFAULT_PRINT);
  useEffect(() => { setTmpl(selectedEvent?.badgeTemplate || DEFAULT_BADGE); setPrint(selectedEvent?.printSettings || DEFAULT_PRINT); }, [selectedEvent?._id]);
  const demo = { fullName: "Samuel Ishimwe", organization: "Afterglow", jobTitle: "Event Manager", category: "VIP", delegateId: "DEL-DEMO", qrToken: "DEMO", event: selectedEvent?._id };
  const save = async () => {
    await api(`/api/events/${selectedEvent._id}`, { method: "PUT", body: JSON.stringify({ badgeTemplate: tmpl, printSettings: print }) });
    showToast("Badge and print settings saved"); refresh();
  };
  const uploadBg = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    const res = await api("/api/uploads", { method: "POST", body: fd });
    setTmpl((t) => ({ ...t, backgroundUrl: res.url }));
  };
  if (!selectedEvent?._id) return <Empty text="Create/select an event first" />;
  return <div className="designer-grid">
    <div className="panel">
      <h2>Badge designer</h2>
      <div className="form-grid two">
        <Field label="Background color"><input type="color" value={tmpl.bgColor || "#1A1A19"} onChange={(e) => setTmpl({ ...tmpl, bgColor: e.target.value })} /></Field>
        <Field label="Upload background"><input type="file" accept="image/*,.pdf" onChange={(e) => uploadBg(e.target.files?.[0])} /></Field>
        <Field label="QR X"><input type="number" value={tmpl.qrX} onChange={(e) => setTmpl({ ...tmpl, qrX: +e.target.value })} /></Field>
        <Field label="QR Y"><input type="number" value={tmpl.qrY} onChange={(e) => setTmpl({ ...tmpl, qrY: +e.target.value })} /></Field>
        <Field label="QR Size"><input type="number" value={tmpl.qrSize} onChange={(e) => setTmpl({ ...tmpl, qrSize: +e.target.value })} /></Field>
        <Field label="Paper size"><select value={print.paperSize} onChange={(e) => setPrint({ ...print, paperSize: e.target.value })}>{["A6", "A5", "A4", "CR80", "EVENT_BADGE", "CUSTOM"].map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Auto print"><select value={String(print.autoPrintAfterCheckin)} onChange={(e) => setPrint({ ...print, autoPrintAfterCheckin: e.target.value === "true" })}><option value="true">On</option><option value="false">Off</option></select></Field>
        <Field label="Margin mm"><input type="number" value={print.marginMm} onChange={(e) => setPrint({ ...print, marginMm: +e.target.value })} /></Field>
      </div>
      <h3>Text fields</h3>
      {tmpl.fields.map((f, i) => <div key={i} className="field-row">
        <select value={f.key} onChange={(e) => setTmpl((t) => ({ ...t, fields: t.fields.map((x, j) => j === i ? { ...x, key: e.target.value } : x) }))}>{["fullName","organization","jobTitle","category","email","phone","country","delegateId"].map((k) => <option key={k}>{k}</option>)}</select>
        <input type="number" value={f.x} onChange={(e) => setTmpl((t) => ({ ...t, fields: t.fields.map((x, j) => j === i ? { ...x, x: +e.target.value } : x) }))} title="X" />
        <input type="number" value={f.y} onChange={(e) => setTmpl((t) => ({ ...t, fields: t.fields.map((x, j) => j === i ? { ...x, y: +e.target.value } : x) }))} title="Y" />
        <input type="number" value={f.size} onChange={(e) => setTmpl((t) => ({ ...t, fields: t.fields.map((x, j) => j === i ? { ...x, size: +e.target.value } : x) }))} title="Size" />
        <input type="color" value={f.color} onChange={(e) => setTmpl((t) => ({ ...t, fields: t.fields.map((x, j) => j === i ? { ...x, color: e.target.value } : x) }))} />
      </div>)}
      <div className="modal-actions"><button className="btn ghost" onClick={() => setTmpl((t) => ({ ...t, fields: [...t.fields, { key: "fullName", x: 50, y: 90, size: 12, color: "#fff", weight: "normal", align: "center" }] }))}>Add field</button><button className="btn primary" onClick={save}>Save design</button></div>
    </div>
    <div className="panel preview-panel"><h3>Preview</h3><BadgeView delegate={demo} event={{ ...selectedEvent, badgeTemplate: tmpl, printSettings: print }} size={280} /><button className="btn ghost full" onClick={() => printBadges([demo], { ...selectedEvent, badgeTemplate: tmpl, printSettings: print })}>Test print</button></div>
  </div>;
}

function ReportsView({ selectedEvent, delegates, stats, showToast }) {
  const exportReport = async (type = "all", category = "") => {
    if (!selectedEvent?._id) return;
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`${API_BASE}/api/events/${selectedEvent._id}/reports/export?type=${type}${category ? `&category=${encodeURIComponent(category)}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `afterglow-${type}-participants.xlsx`; a.click(); URL.revokeObjectURL(a.href);
      showToast("Excel file downloaded");
    } catch (e) { showToast(e.message, "error"); }
  };
  return <div>
    <div className="cards three"><StatCard title="All" value={stats.total} icon="ti-users" /><StatCard title="Checked" value={stats.checkedIn} icon="ti-circle-check" green /><StatCard title="Pending" value={stats.pending} icon="ti-clock" orange /></div>
    <div className="panel"><h2>Excel exports</h2><div className="export-grid">
      <button onClick={() => exportReport("all")}><i className="ti ti-file-spreadsheet" /> All participants</button>
      <button onClick={() => exportReport("checked")}><i className="ti ti-check" /> Checked-in participants</button>
      <button onClick={() => exportReport("pending")}><i className="ti ti-clock" /> Pending participants</button>
      {CATS.map((c) => <button key={c} onClick={() => exportReport("category", c)}>{c}</button>)}
    </div></div>
    <div className="panel"><h3>Data preview</h3><ResponsiveDelegateList delegates={delegates.slice(0, 8)} /></div>
  </div>;
}

function UsersView({ events, showToast }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(null);
  const load = async () => { const res = await api("/api/users"); setUsers(res.users || []); };
  useEffect(() => { load().catch((e) => showToast(e.message, "error")); }, []);
  const blank = { fullName: "", username: "", password: "", role: "checkin_staff", assignedEvents: [], active: true };
  const save = async () => {
    const body = { ...form };
    if (!body.password) delete body.password;
    if (form._id) await api(`/api/users/${form._id}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/api/users", { method: "POST", body: JSON.stringify(body) });
    setForm(null); showToast("User saved"); load();
  };
  return <div>
    <div className="toolbar"><button className="btn primary" onClick={() => setForm(blank)}><i className="ti ti-user-plus" /> Add user</button></div>
    <div className="user-grid">{users.map((u) => <div className="panel user-card" key={u._id}><h3>{u.fullName}</h3><p>@{u.username}</p><CategoryBadge cat={ROLE_LABELS[u.role] || u.role} /><p className="small-muted">{u.assignedEvents?.length ? u.assignedEvents.map((e) => e.name).join(", ") : "All / no specific assignment"}</p><button className="btn ghost" onClick={() => setForm({ ...u, password: "", assignedEvents: (u.assignedEvents || []).map((e) => e._id || e) })}>Edit</button></div>)}</div>
    {form && <Modal title={form._id ? "Edit user" : "Add user"} onClose={() => setForm(null)}>
      <div className="form-grid two">
        <Field label="Full name"><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
        <Field label="Username"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
        <Field label="Password"><input type="password" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={form._id ? "Leave blank to keep" : "Required"} /></Field>
        <Field label="Role"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
        <Field label="Assigned events" full><select multiple value={form.assignedEvents || []} onChange={(e) => setForm({ ...form, assignedEvents: Array.from(e.target.selectedOptions).map((o) => o.value) })}>{events.map((e) => <option key={e._id} value={e._id}>{e.name}</option>)}</select></Field>
        <Field label="Active"><select value={String(form.active)} onChange={(e) => setForm({ ...form, active: e.target.value === "true" })}><option value="true">Active</option><option value="false">Inactive</option></select></Field>
      </div><div className="modal-actions"><button className="btn primary" onClick={save}>Save user</button></div>
    </Modal>}
  </div>;
}

function SettingsView({ settings, setSettings, showToast }) {
  const [form, setForm] = useState(settings || DEFAULT_SETTINGS);
  const save = async () => { const res = await api("/api/settings", { method: "PUT", body: JSON.stringify(form) }); setSettings({ ...DEFAULT_SETTINGS, ...res.settings }); showToast("Settings saved"); };
  const exportBackup = () => {
    const data = { token: localStorage.getItem(TOKEN_KEY), selectedEvent: localStorage.getItem("afterglow_selected_event"), apiBase: API_BASE, settings: form };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = "afterglow-register-frontend-settings.json"; a.click();
  };
  return <div className="settings-grid">
    <div className="panel"><h2>Appearance</h2><div className="form-grid two">
      <Field label="System name"><input value={form.systemName || ""} onChange={(e) => setForm({ ...form, systemName: e.target.value })} /></Field>
      <Field label="Accent color"><input type="color" value={form.appearance?.accentColor || "#CF6B11"} onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, accentColor: e.target.value } })} /></Field>
      <Field label="Mode"><select value={form.appearance?.mode || "dark"} onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, mode: e.target.value } })}><option>dark</option><option>light</option><option>system</option></select></Field>
      <Field label="Font size"><select value={form.appearance?.fontSize || "normal"} onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, fontSize: e.target.value } })}><option>small</option><option>normal</option><option>large</option></select></Field>
      <Field label="Compact mode"><select value={String(form.appearance?.compactMode || false)} onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, compactMode: e.target.value === "true" } })}><option value="false">Off</option><option value="true">On</option></select></Field>
    </div><button className="btn primary" onClick={save}>Save settings</button></div>
    <div className="panel"><h2>Email and data</h2><p className="small-muted">Real email is controlled by backend .env. If ENABLE_EMAIL=false, backend saves email simulation logs.</p><button className="btn ghost full" onClick={exportBackup}>Export frontend settings JSON</button><button className="btn danger full" onClick={() => { if (confirm("This only logs out and clears frontend storage. Backend MongoDB data remains safe.")) { localStorage.clear(); location.reload(); } }}>Reset frontend storage</button></div>
  </div>;
}

function BadgeView({ delegate, event, size = 220 }) {
  const t = event?.badgeTemplate || DEFAULT_BADGE;
  const w = size, h = Math.round(size * 1.42);
  return <div className="badge-view" style={{ width: w, height: h, background: t.bgColor || "#111" }}>
    {t.backgroundUrl && <img className="badge-bg" src={t.backgroundUrl} alt="badge background" />}
    <div className="badge-event">{event?.name || "Afterglow Register"}</div>
    {t.showPhoto && delegate.photoUrl && <img src={delegate.photoUrl} className="badge-photo" style={{ left: `${t.photoX || 50}%`, top: `${t.photoY || 18}%`, width: `${t.photoSize || 20}%`, height: `${t.photoSize || 20}%` }} alt="photo" />}
    <div className="badge-qr" style={{ left: `${t.qrX || 50}%`, top: `${t.qrY || 32}%`, width: `${t.qrSize || 24}%` }}><QRCodeCanvas value={qrPayload(delegate)} size={120} style={{ width: "100%", height: "auto" }} /></div>
    {(t.fields || DEFAULT_BADGE.fields).map((f, i) => <div key={i} className="badge-field" style={{ left: `${f.x}%`, top: `${f.y}%`, fontSize: Math.round((f.size || 12) * size / 220), color: f.color, fontWeight: f.weight, textAlign: f.align || "center" }}>{safe(delegate[f.key])}</div>)}
  </div>;
}

async function printBadges(delegates, event) {
  const ev = normalizeEvent(event || {});
  const paper = paperSize(ev.printSettings);
  const htmlBadges = [];
  for (const d of delegates) {
    const qr = await QRCode.toDataURL(qrPayload(d), { width: 280, margin: 1 });
    const t = ev.badgeTemplate || DEFAULT_BADGE;
    htmlBadges.push(`<section class="print-page"><div class="print-badge" style="background:${t.bgColor || "#111"}">${t.backgroundUrl ? `<img class="print-bg" src="${t.backgroundUrl}"/>` : ""}<div class="print-event">${escapeHtml(ev.name || "Afterglow Register")}</div>${t.showPhoto && d.photoUrl ? `<img class="print-photo" src="${d.photoUrl}" style="left:${t.photoX || 50}%;top:${t.photoY || 18}%;width:${t.photoSize || 20}%;height:${t.photoSize || 20}%"/>` : ""}<img class="print-qr" src="${qr}" style="left:${t.qrX || 50}%;top:${t.qrY || 32}%;width:${t.qrSize || 24}%"/>${(t.fields || DEFAULT_BADGE.fields).map((f) => `<div class="print-field" style="left:${f.x}%;top:${f.y}%;font-size:${f.size || 12}pt;color:${f.color};font-weight:${f.weight};text-align:${f.align || "center"}">${escapeHtml(safe(d[f.key]))}</div>`).join("")}</div></section>`);
  }
  const win = window.open("", "_blank", "width=900,height=700");
  win.document.write(`<!doctype html><html><head><title>Print Badges</title><style>@page{size:${paper.w}mm ${paper.h}mm;margin:${ev.printSettings?.marginMm || 0}mm}body{margin:0;background:#eee}.print-page{width:${paper.w}mm;height:${paper.h}mm;page-break-after:always;display:flex;align-items:center;justify-content:center}.print-badge{width:100%;height:100%;position:relative;overflow:hidden;font-family:Arial,sans-serif;color:#fff}.print-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.print-event{position:absolute;top:4mm;left:0;right:0;text-align:center;color:#E8B267;font-size:8pt;text-transform:uppercase;letter-spacing:1.8px;font-weight:bold}.print-qr{position:absolute;transform:translate(-50%,-50%);background:#fff;padding:2mm;border-radius:2mm}.print-photo{position:absolute;transform:translate(-50%,-50%);object-fit:cover;border-radius:50%;border:2px solid #fff}.print-field{position:absolute;transform:translateX(-50%);width:88%;text-shadow:0 1px 2px rgba(0,0,0,.55)}@media print{body{background:#fff}}</style></head><body>${htmlBadges.join("")}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}
function printTest(event) { printBadges([{ fullName: "Test Participant", organization: "Afterglow", jobTitle: "Guest", category: "VIP", delegateId: "TEST-001", qrToken: "TEST", event: event?._id }], event); }
function paperSize(print = DEFAULT_PRINT) { const p = print.paperSize || "A6"; if (p === "A5") return { w: 148, h: 210 }; if (p === "A4") return { w: 210, h: 297 }; if (p === "CR80") return { w: 86, h: 54 }; if (p === "EVENT_BADGE") return { w: 86, h: 120 }; if (p === "CUSTOM") return { w: print.customWidthMm || 105, h: print.customHeightMm || 148 }; return { w: 105, h: 148 }; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

function ResponsiveDelegateList({ delegates, onView, onCheckin, onDelete, canPrint, selectedEvent }) {
  if (!delegates?.length) return <div className="panel"><Empty text="No participants found" /></div>;
  return <div className="table-card"><table><thead><tr><th>Name</th><th>Organization</th><th>Category</th><th>Status</th><th>Registered</th><th>Actions</th></tr></thead><tbody>{delegates.map((d) => <tr key={d._id}><td><b>{d.fullName}</b><small>{d.email}</small></td><td>{d.organization || "—"}</td><td><CategoryBadge cat={d.category} /></td><td>{d.checkedIn ? <span className="status in">Checked in</span> : <span className="status pending">Pending</span>}</td><td>{fmtDate(d.createdAt)}</td><td><div className="row-actions"><button onClick={() => onView?.(d)} className="icon-btn"><i className="ti ti-eye" /></button>{onCheckin && !d.checkedIn && <button onClick={() => onCheckin(d)} className="icon-btn"><i className="ti ti-circle-check" /></button>}{canPrint && <button onClick={() => printBadges([d], selectedEvent)} className="icon-btn"><i className="ti ti-printer" /></button>}{onDelete && <button onClick={() => onDelete(d)} className="icon-btn danger"><i className="ti ti-trash" /></button>}</div></td></tr>)}</tbody></table><div className="mobile-cards">{delegates.map((d) => <div className="mobile-delegate" key={d._id}><MiniDelegate d={d} /><div className="row-actions"><button className="btn ghost" onClick={() => onView?.(d)}>View</button>{onCheckin && !d.checkedIn && <button className="btn success" onClick={() => onCheckin(d)}>Check in</button>}</div></div>)}</div></div>;
}
function StatCard({ title, value, icon, green, orange }) { return <div className="stat-card"><div><span>{title}</span><b className={green ? "green" : orange ? "orange" : ""}>{value}</b></div><i className={`ti ${icon}`} /></div>; }
function MiniDelegate({ d }) { return <div className="mini-delegate"><Avatar d={d} /><div><b>{d.fullName}</b><span>{d.organization || d.email || "—"}</span><CategoryBadge cat={d.checkedIn ? "Checked in" : d.category} /></div></div>; }
function Avatar({ d }) { return d.photoUrl ? <img className="avatar" src={d.photoUrl} alt="avatar" /> : <div className="avatar initials">{String(d.fullName || "AG").slice(0, 2).toUpperCase()}</div>; }
function CategoryBadge({ cat }) { return <span className="cat-badge">{cat || "Delegate"}</span>; }
function Progress({ label, value, max }) { return <div className="progress-row"><div><span>{label}</span><b>{value}</b></div><em><i style={{ width: `${max ? Math.round(value / max * 100) : 0}%` }} /></em></div>; }
function Empty({ text }) { return <div className="empty"><i className="ti ti-database-off" /> {text}</div>; }
function Field({ label, children, full }) { return <label className={full ? "field full" : "field"}><span>{label}</span>{children}</label>; }
function Modal({ title, children, onClose }) { return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={onClose}><i className="ti ti-x" /></button></div>{children}</div></div>; }

function ImageCropModal({ src, onCrop, onClose }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState(null);
  return <Modal title="Crop participant photo" onClose={onClose}>
    <div className="crop-area"><Cropper image={src} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, p) => setPixels(p)} /></div>
    <Field label="Zoom"><input type="range" min="1" max="3" step="0.1" value={zoom} onChange={(e) => setZoom(+e.target.value)} /></Field>
    <div className="modal-actions"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => onCrop(await getCroppedImg(src, pixels))}>Save crop</button></div>
  </Modal>;
}
async function getCroppedImg(imageSrc, crop) {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width; canvas.height = crop.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}
function createImage(url) { return new Promise((resolve, reject) => { const img = new Image(); img.addEventListener("load", () => resolve(img)); img.addEventListener("error", reject); img.setAttribute("crossOrigin", "anonymous"); img.src = url; }); }

const styles = `
:root{--accent:#CF6B11;--bg:#0f0f0f;--panel:#151515;--panel2:#1b1b1b;--text:#f2f2f2;--muted:#8b8b8b;--line:#262626;--font-scale:1}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,Segoe UI,system-ui,sans-serif;font-size:calc(14px * var(--font-scale))}body.light{--bg:#f4f4f4;--panel:#fff;--panel2:#f8f8f8;--text:#151515;--muted:#6b7280;--line:#e5e7eb}button,input,select,textarea{font:inherit}button{cursor:pointer}input,select,textarea{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--text);padding:10px 12px;outline:none}textarea{min-height:90px}.app-shell{height:100vh;display:flex;overflow:hidden}.sidebar{width:250px;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;flex-shrink:0}.brand{padding:18px;display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--line)}.brand-logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--accent),#733709);display:flex;align-items:center;justify-content:center;font-weight:900;color:white;box-shadow:0 0 22px color-mix(in srgb,var(--accent),transparent 75%)}.brand-logo.big{width:60px;height:60px;margin:auto;font-size:22px}.brand-text{min-width:0}.brand-text b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.brand-text span,.small-muted{color:var(--muted);font-size:12px}.event-select-wrap{padding:12px 14px;border-bottom:1px solid var(--line);min-width:0}.event-select-wrap label{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}.event-select-wrap select{height:38px;font-size:12px;max-width:100%;text-overflow:ellipsis}.active-event-name{margin-top:6px;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.nav-list{padding:10px 0;overflow:auto;flex:1}.nav-list button{width:100%;display:flex;gap:10px;align-items:center;border:0;background:transparent;color:var(--muted);padding:11px 18px;text-align:left;border-left:3px solid transparent}.nav-list button.active{color:var(--accent);background:color-mix(in srgb,var(--accent),transparent 88%);border-left-color:var(--accent)}.user-box{padding:14px 18px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:4px}.user-box span{color:var(--accent);font-size:11px}.link-btn{background:transparent;border:0;color:var(--muted);text-align:left;padding:6px 0}.main-panel{min-width:0;flex:1;overflow:auto}.topbar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg),transparent 6%);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:16px 24px;display:flex;align-items:center;gap:14px;justify-content:space-between}.top-title{min-width:0}.top-title h1{margin:0;font-size:20px}.top-title p{margin:2px 0 0;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48vw}.top-actions{display:flex;gap:8px;align-items:center}.api-pill{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:7px 11px;font-size:11px;color:var(--muted);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.content{padding:24px;max-width:1480px;margin:auto}.btn{border:0;border-radius:10px;padding:10px 14px;font-weight:700;display:inline-flex;align-items:center;gap:7px;justify-content:center}.btn.primary{background:var(--accent);color:#fff}.btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}.btn.success{background:#15803d;color:#fff}.btn.danger{background:#7f1d1d;color:#fff}.btn.full{width:100%;margin-top:12px}.toolbar{display:flex;gap:10px;justify-content:flex-end;margin-bottom:16px;align-items:center}.toolbar.wrap{justify-content:flex-start;flex-wrap:wrap}.search{max-width:360px}.cards.three{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:18px}.stat-card,.panel,.event-card,.table-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.12)}.stat-card{padding:20px;display:flex;justify-content:space-between;align-items:flex-start}.stat-card span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.8px}.stat-card b{display:block;font-size:34px;color:var(--accent);margin-top:8px}.stat-card b.green{color:#22c55e}.stat-card b.orange{color:#f59e0b}.stat-card i{font-size:28px;color:var(--accent);opacity:.85}.panel{padding:20px}.panel h2,.panel h3{margin-top:0}.grid-two{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px}.quick-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.quick-actions button,.export-grid button{background:var(--panel2);border:1px solid var(--line);border-radius:12px;color:var(--text);padding:14px;text-align:left}.info-list,.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.info-list span,.info-grid span{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px;color:var(--muted)}.info-list b,.info-grid b{display:block;color:var(--text);font-size:11px;margin-bottom:3px}.progress-row{margin:11px 0}.progress-row div{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-bottom:5px}.progress-row b{color:var(--accent)}.progress-row em{display:block;height:6px;background:var(--panel2);border-radius:99px;overflow:hidden}.progress-row i{display:block;height:100%;background:var(--accent)}.mini-delegate{display:flex;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--line)}.mini-delegate:last-child{border-bottom:0}.mini-delegate b{display:block}.mini-delegate span{display:block;color:var(--muted);font-size:12px}.avatar{width:42px;height:42px;border-radius:12px;object-fit:cover}.avatar.initials{background:color-mix(in srgb,var(--accent),transparent 75%);color:var(--accent);font-weight:900;display:flex;align-items:center;justify-content:center}.cat-badge,.status{display:inline-block;padding:4px 8px;border-radius:99px;background:color-mix(in srgb,var(--accent),transparent 85%);color:var(--accent);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px}.status.in{background:#14532d;color:#86efac}.status.pending{background:#3b2a0b;color:#facc15}.event-grid,.badge-grid,.user-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}.event-card{overflow:hidden;padding:0 18px 18px}.event-color{height:5px;margin:0 -18px 14px}.event-card h3{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.event-card p{color:var(--muted);font-size:13px}.row-actions{display:flex;gap:7px;flex-wrap:wrap}.form-grid{display:grid;gap:12px}.form-grid.two{grid-template-columns:1fr 1fr}.field{display:flex;flex-direction:column;gap:6px;color:var(--muted);font-size:12px}.field.full{grid-column:1/-1}.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:50;display:flex;align-items:center;justify-content:center;padding:18px}.modal{background:var(--panel);border:1px solid var(--line);border-radius:18px;max-width:760px;width:100%;max-height:92vh;overflow:auto;padding:20px}.modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.modal-head h2{margin:0}.modal-head button{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:10px;width:36px;height:36px}.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.table-card{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:middle}th{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}td small{display:block;color:var(--muted);font-size:11px}.icon-btn{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);color:var(--accent)}.icon-btn.danger{color:#ef4444}.mobile-cards{display:none}.profile-head{display:flex;gap:16px;align-items:center;margin-bottom:18px}.profile-head h2{margin:0}.register-panel,.narrow{max-width:720px;margin:auto}.register-done{text-align:center}.register-done>i{font-size:64px;color:#22c55e}.qr-card{background:#fff;border-radius:14px;display:inline-flex;flex-direction:column;gap:8px;align-items:center;padding:16px;color:#111;margin:15px}.photo-preview{width:74px;height:74px;border-radius:14px;object-fit:cover;margin-top:8px}.public-page,.login-page{min-height:100vh;background:radial-gradient(circle at top,var(--accent)22,transparent 30%),var(--bg);display:flex;align-items:center;justify-content:center;padding:24px}.public-page{display:block}.public-brand{max-width:720px;margin:0 auto 18px;display:flex;gap:12px;align-items:center}.public-brand span{display:block;color:var(--muted);font-size:12px}.login-card{width:100%;max-width:430px;background:var(--panel);border:1px solid var(--line);border-radius:24px;padding:30px;box-shadow:0 30px 80px rgba(0,0,0,.3)}.login-card h1{text-align:center;margin:16px 0 5px}.login-card p{text-align:center;color:var(--muted)}.center{text-align:center}.alert{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px;margin:10px 0;color:var(--muted)}.alert.error{background:#3b1111;color:#fecaca;border-color:#7f1d1d}.toast{position:fixed;right:22px;bottom:22px;z-index:80;background:#14532d;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 10px 35px rgba(0,0,0,.35);font-weight:700}.toast.error{background:#7f1d1d}.checkin-grid,.designer-grid,.settings-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.qr-reader{background:#000;border-radius:14px;overflow:hidden}.manual-check{display:flex;gap:8px;margin-top:14px}.result-card{padding:18px;border-radius:14px;background:var(--panel2);display:flex;flex-direction:column;gap:8px}.result-card i{font-size:42px}.result-card.success i{color:#22c55e}.result-card.error i{color:#ef4444}.badge-tile{text-align:center}.badge-tile b{display:block;margin:8px 0;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge-view{position:relative;overflow:hidden;border-radius:13px;margin:auto;box-shadow:0 12px 35px rgba(0,0,0,.35);font-family:Arial,sans-serif}.badge-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.badge-event{position:absolute;top:8px;left:0;right:0;text-align:center;color:#E8B267;font-size:9px;text-transform:uppercase;letter-spacing:1.8px;font-weight:800;z-index:1}.badge-photo{position:absolute;transform:translate(-50%,-50%);object-fit:cover;border-radius:50%;border:2px solid white;z-index:2}.badge-qr{position:absolute;transform:translate(-50%,-50%);background:white;padding:5px;border-radius:6px;z-index:2}.badge-field{position:absolute;transform:translateX(-50%);width:88%;z-index:2;text-shadow:0 1px 3px rgba(0,0,0,.6)}.field-row{display:grid;grid-template-columns:2fr 70px 70px 80px 60px;gap:8px;margin-bottom:8px}.export-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.crop-area{height:360px;position:relative;background:#111;border-radius:14px;overflow:hidden;margin-bottom:16px}.empty{color:var(--muted);padding:25px;text-align:center}.mobile-menu{display:none}.mobile-bottom{display:none}
@media(max-width:900px){.sidebar{display:none}.app-shell{display:block;height:auto;min-height:100vh;overflow:auto}.main-panel{padding-bottom:72px}.topbar{padding:14px;align-items:flex-start}.top-actions{display:none}.top-title p{max-width:80vw}.content{padding:14px}.cards.three,.grid-two,.checkin-grid,.designer-grid,.settings-grid{grid-template-columns:1fr}.quick-actions{grid-template-columns:1fr}.form-grid.two{grid-template-columns:1fr}.field.full{grid-column:auto}.mobile-bottom{position:fixed;bottom:0;left:0;right:0;z-index:20;display:grid;grid-template-columns:repeat(5,1fr);background:var(--panel);border-top:1px solid var(--line);padding:6px 4px}.mobile-bottom button{background:transparent;border:0;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10px}.mobile-bottom button i{font-size:20px}.mobile-bottom button.active{color:var(--accent)}table{display:none}.mobile-cards{display:block}.mobile-delegate{background:var(--panel);border-bottom:1px solid var(--line);padding:10px}.table-card{overflow:hidden}.event-grid,.badge-grid,.user-grid{grid-template-columns:1fr}.manual-check{flex-direction:column}.profile-head{align-items:flex-start;flex-wrap:wrap}.info-grid,.info-list{grid-template-columns:1fr}.modal{padding:16px}.modal-actions{flex-direction:column}.modal-actions .btn{width:100%}.crop-area{height:300px}.field-row{grid-template-columns:1fr 60px 60px;}.field-row input[type=color]{grid-column:auto}.api-pill{display:none}}
@media(max-width:430px){.top-title h1{font-size:18px}.content{padding:10px}.panel,.stat-card{border-radius:13px;padding:14px}.stat-card b{font-size:28px}.login-card{padding:22px;border-radius:18px}.public-page,.login-page{padding:14px}.btn{padding:10px 12px}.badge-view{max-width:100%}.toolbar{flex-direction:column;align-items:stretch}.toolbar .btn,.toolbar select,.toolbar input{width:100%;max-width:100%}.cards.three{gap:10px}.mobile-bottom span{font-size:9px}}
`;
