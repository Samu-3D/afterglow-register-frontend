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
  logoUrl: "/afterglow-logo.png",
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
  photoShape: "circle",
  photoBorderColor: "#ffffff",
  photoBorderWidth: 2,
  photoFit: "cover",
  showPhotoPlaceholder: true,
  showEventTitle: true,
  eventTitleX: 50,
  eventTitleY: 5,
  eventTitleSize: 9,
  eventTitleColor: "#E8B267",
  eventTitleWeight: "bold",
  eventTitleUppercase: true,
  showQR: true,
  qrBackground: true,
  qrPadding: 5,
  qrRadius: 6,
  backgroundFit: "cover",
};
const DEFAULT_PRINT = { paperSize: "A6", customWidthMm: 105, customHeightMm: 148, marginMm: 0, fitToPaper: true, autoPrintAfterCheckin: true };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtTime = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const safe = (v) => (v === undefined || v === null || v === "" ? "—" : String(v));
const formatBytes = (bytes = 0) => {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function loadBrowserImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
async function imageFileToDataUrl(file, { maxWidth = 1600, maxHeight = 1200, quality = 0.88 } = {}) {
  const original = await readFileAsDataUrl(file);
  if (!file.type.startsWith("image/")) return original;
  if (file.size <= 900 * 1024) return original;
  const img = await loadBrowserImage(original);
  const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}
async function fileToStoredAsset(file, kind = "file") {
  if (!file) return null;
  if (kind === "document" && file.size > 5 * 1024 * 1024) throw new Error("Agenda file is too large. Use a file below 5 MB.");
  if (kind !== "document" && file.size > 6 * 1024 * 1024) throw new Error("Image is too large. Use a file below 6 MB.");
  const dataUrl = file.type.startsWith("image/") ? await imageFileToDataUrl(file) : await readFileAsDataUrl(file);
  return { name: file.name, type: file.type || "application/octet-stream", size: file.size, dataUrl, uploadedAt: new Date().toISOString() };
}

function qrPayload(delegate) {
  const eventId = typeof delegate.event === "object" ? delegate.event?._id : delegate.event;
  return JSON.stringify({ eventId, delegateId: delegate.delegateId, qrToken: delegate.qrToken });
}

function normalizeEvent(ev) {
  return {
    ...ev,
    bannerUrl: ev?.bannerUrl || "",
    bannerName: ev?.bannerName || "",
    eventFiles: Array.isArray(ev?.eventFiles) ? ev.eventFiles : [],
    badgeTemplate: { ...DEFAULT_BADGE, ...(ev?.badgeTemplate || {}), fields: ev?.badgeTemplate?.fields?.length ? ev.badgeTemplate.fields : DEFAULT_BADGE.fields },
    printSettings: { ...DEFAULT_PRINT, ...(ev?.printSettings || {}) },
    registrationSettings: {
      photoUploadEnabled: true,
      emailConfirmationEnabled: true,
      requiredFields: ["fullName", "email"],
      fieldModes: { fullName: "required", email: "required", phone: "optional", organization: "optional", jobTitle: "optional", country: "optional", category: "optional", photoUrl: "optional" },
      customFields: [],
      categories: CATS,
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
          <img className="brand-img" src={settings.logoUrl || "/afterglow-logo.png"} alt="Afterglow logo" />
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
        <img className="brand-img big" src={settings?.logoUrl || "/afterglow-logo.png"} alt="Afterglow logo" />
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
  const defaultFieldModes = { fullName: "required", email: "required", phone: "optional", organization: "optional", jobTitle: "optional", country: "optional", category: "optional", photoUrl: "optional" };
  const blank = {
    name: "",
    date: "",
    venue: "",
    organizer: "Afterglow Register",
    description: "",
    status: "open",
    themeColor: "#CF6B11",
    logoUrl: "/afterglow-logo.png",
    bannerUrl: "",
    bannerName: "",
    eventFiles: [],
    badgeTemplate: DEFAULT_BADGE,
    printSettings: DEFAULT_PRINT,
    registrationSettings: {
      photoUploadEnabled: true,
      emailConfirmationEnabled: true,
      fieldModes: defaultFieldModes,
      requiredFields: ["fullName", "email"],
      customFields: [],
      categories: CATS,
    },
  };
  const participantFields = [
    ["fullName", "Full Name", "Basic identity"],
    ["email", "Email", "For QR confirmation"],
    ["phone", "Phone", "WhatsApp/contact"],
    ["organization", "Organization", "Company / institution"],
    ["jobTitle", "Job Title", "Position / role"],
    ["country", "Country", "Participant country"],
    ["category", "Category", "VIP, Delegate, Media..."],
    ["photoUrl", "Participant Photo", "Used on badge"],
  ];
  const getFieldMode = (key) => {
    const modes = form?.registrationSettings?.fieldModes || {};
    if (modes[key]) return modes[key];
    return (form?.registrationSettings?.requiredFields || []).includes(key) ? "required" : "optional";
  };
  const updateRegistrationSetting = (key, value) => {
    setForm((f) => ({ ...f, registrationSettings: { ...(f.registrationSettings || {}), [key]: value } }));
  };
  const setFieldMode = (key, value) => {
    setForm((f) => {
      const modes = { ...(f.registrationSettings?.fieldModes || defaultFieldModes), [key]: value };
      const requiredFields = Object.entries(modes).filter(([, mode]) => mode === "required").map(([k]) => k);
      return { ...f, registrationSettings: { ...(f.registrationSettings || {}), fieldModes: modes, requiredFields } };
    });
  };
  const addCustomField = () => {
    const fields = form?.registrationSettings?.customFields || [];
    updateRegistrationSetting("customFields", [...fields, { label: "New field", key: `custom_${Date.now()}`, type: "text", required: false }]);
  };
  const updateCustomField = (i, key, value) => {
    const fields = [...(form?.registrationSettings?.customFields || [])];
    fields[i] = { ...fields[i], [key]: value };
    if (key === "label") fields[i].key = String(value || "custom_field").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    updateRegistrationSetting("customFields", fields);
  };
  const removeCustomField = (i) => updateRegistrationSetting("customFields", (form?.registrationSettings?.customFields || []).filter((_, idx) => idx !== i));
  const uploadBanner = async (file) => {
    if (!file) return;
    try {
      const asset = await fileToStoredAsset(file, "banner");
      setForm((f) => ({ ...f, bannerUrl: asset.dataUrl, bannerName: asset.name }));
      showToast("Banner added. Save the event to keep it.");
    } catch (e) { showToast(e.message, "error"); }
  };
  const addEventFile = async (file) => {
    if (!file) return;
    try {
      const asset = await fileToStoredAsset(file, "document");
      setForm((f) => ({ ...f, eventFiles: [...(f.eventFiles || []), asset] }));
      showToast("Event file added. Save the event to keep it.");
    } catch (e) { showToast(e.message, "error"); }
  };
  const removeEventFile = (index) => setForm((f) => ({ ...f, eventFiles: (f.eventFiles || []).filter((_, i) => i !== index) }));
  const save = async () => {
    if (!form.name || !form.date) return showToast("Event name and date are required", "error");
    const categories = String(form.registrationSettings?.categoriesText || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const body = {
      ...form,
      date: form.date,
      registrationSettings: {
        ...(form.registrationSettings || {}),
        categories: categories.length ? categories : CATS,
      },
    };
    delete body.registrationSettings.categoriesText;
    if (form._id) await api(`/api/events/${form._id}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/api/events", { method: "POST", body: JSON.stringify(body) });
    setForm(null); showToast("Event saved"); refresh();
  };
  const copyLink = async (id) => {
    const url = `${location.origin}${location.pathname}?register=${id}`;
    await navigator.clipboard.writeText(url);
    showToast("Public registration link copied");
  };
  const openForm = (event) => {
    const ev = event ? normalizeEvent(event) : blank;
    const categories = ev.registrationSettings?.categories?.length ? ev.registrationSettings.categories : CATS;
    setForm({ ...ev, date: ev.date ? String(ev.date).slice(0,10) : "", registrationSettings: { ...ev.registrationSettings, fieldModes: { ...defaultFieldModes, ...(ev.registrationSettings?.fieldModes || {}) }, categoriesText: categories.join(", ") } });
  };
  return (
    <div>
      {canEdit && <div className="toolbar"><button className="btn primary" onClick={() => openForm(null)}><i className="ti ti-plus" /> New event</button></div>}
      <div className="event-grid">
        {events.map((e) => <div key={e._id} className="event-card">
          <div className="event-color" style={{ background: e.themeColor || "var(--accent)" }} />
          <h3 title={e.name}>{e.name}</h3>
          <p><i className="ti ti-calendar" /> {fmtDate(e.date)}</p>
          <p><i className="ti ti-map-pin" /> {e.venue || "No venue"}</p>
          <p>{e.description || "No description"}</p>
          <div className="row-actions">
            <button className="btn ghost" onClick={() => copyLink(e._id)}><i className="ti ti-link" /> Registration link</button>
            {canEdit && <button className="btn ghost" onClick={() => openForm(e)}><i className="ti ti-edit" /> Edit</button>}
          </div>
        </div>)}
      </div>
      {form && <Modal title={form._id ? "Edit event" : "New event"} onClose={() => setForm(null)}>
        <div className="form-grid two">
          <div className="form-section full"><h3>Event basics</h3><p className="small-muted">Information shown in the dashboard, public form, badge and reports.</p></div>
          <Field label="Event name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Venue"><input value={form.venue || ""} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></Field>
          <Field label="Organizer"><input value={form.organizer || ""} onChange={(e) => setForm({ ...form, organizer: e.target.value })} /></Field>
          <Field label="Theme color"><input type="color" value={form.themeColor || "#CF6B11"} onChange={(e) => setForm({ ...form, themeColor: e.target.value })} /></Field>
          <Field label="Registration status"><select value={form.status || "open"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="open">Open</option><option value="closed">Closed</option></select></Field>
          <Field label="Event logo URL"><input value={form.logoUrl || ""} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="/afterglow-logo.png" /></Field>
          <Field label="Participant categories" full><textarea value={form.registrationSettings?.categoriesText || ""} onChange={(e) => updateRegistrationSetting("categoriesText", e.target.value)} placeholder="VIP, Speaker, Delegate, Media" /></Field>
          <Field label="Description" full><textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="form-section full">
            <h3>Public registration media</h3>
            <p className="small-muted">Add a banner image and agenda/programme files. They appear on the public registration link.</p>
            <Field label="Event banner image" full>
              <input type="file" accept="image/*" onChange={(e) => uploadBanner(e.target.files?.[0])} />
              {form.bannerUrl && <div className="event-banner-preview"><img src={form.bannerUrl} alt="Event banner preview" /><button type="button" className="btn ghost" onClick={() => setForm({ ...form, bannerUrl: "", bannerName: "" })}>Remove banner</button></div>}
            </Field>
            <Field label="Agenda / programme files" full>
              <input type="file" accept="application/pdf,image/*" onChange={(e) => addEventFile(e.target.files?.[0])} />
              <div className="file-list">
                {(form.eventFiles || []).map((file, index) => <div className="event-file-row" key={`${file.name}-${index}`}><span><b>{file.name}</b><small>{file.type || "file"} · {formatBytes(file.size)}</small></span><a className="btn ghost" href={file.dataUrl} download={file.name}>Open</a><button type="button" className="icon-btn danger" onClick={() => removeEventFile(index)}><i className="ti ti-trash" /></button></div>)}
              </div>
            </Field>
          </div>
          <div className="form-section full">
            <h3>Participant form settings</h3>
            <p className="small-muted">Choose whether each field is required, optional, or hidden for this event.</p>
            <div className="field-mode-grid">
              {participantFields.map(([key, label, hint]) => <div key={key} className="field-mode-card">
                <div><b>{label}</b><span>{hint}</span></div>
                <select value={getFieldMode(key)} onChange={(e) => setFieldMode(key, e.target.value)}>
                  <option value="required">Required</option>
                  <option value="optional">Optional</option>
                  <option value="hidden">Hidden</option>
                </select>
              </div>)}
            </div>
            <div className="check-grid compact-checks">
              <label className="check-row"><input type="checkbox" checked={form.registrationSettings?.photoUploadEnabled !== false} onChange={(e) => updateRegistrationSetting("photoUploadEnabled", e.target.checked)} /> Allow participant photo upload</label>
              <label className="check-row"><input type="checkbox" checked={form.registrationSettings?.emailConfirmationEnabled !== false} onChange={(e) => updateRegistrationSetting("emailConfirmationEnabled", e.target.checked)} /> Send confirmation email / simulation</label>
            </div>
            <h4>Custom fields</h4>
            {(form.registrationSettings?.customFields || []).map((cf, i) => <div key={i} className="custom-field-row">
              <input value={cf.label || ""} onChange={(e) => updateCustomField(i, "label", e.target.value)} placeholder="Field label" />
              <select value={cf.type || "text"} onChange={(e) => updateCustomField(i, "type", e.target.value)}><option value="text">Text</option><option value="email">Email</option><option value="number">Number</option><option value="date">Date</option></select>
              <label className="check-row"><input type="checkbox" checked={!!cf.required} onChange={(e) => updateCustomField(i, "required", e.target.checked)} /> Required</label>
              <button type="button" className="icon-btn danger" onClick={() => removeCustomField(i)}><i className="ti ti-trash" /></button>
            </div>)}
            <button type="button" className="btn ghost" onClick={addCustomField}><i className="ti ti-plus" /> Add custom field</button>
          </div>
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
  const [event, setEvent] = useState(null);
  const [loadingEvent, setLoadingEvent] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoadingEvent(true);
    api(`/api/public/events/${eventId}`)
      .then((res) => { if (alive) setEvent(normalizeEvent(res.event)); })
      .catch((e) => { showToast(e.message, "error"); if (alive) setEvent({ _id: eventId, name: "Public Event", registrationSettings: { photoUploadEnabled: true, emailConfirmationEnabled: true, requiredFields: ["fullName", "email"] } }); })
      .finally(() => alive && setLoadingEvent(false));
    return () => { alive = false; };
  }, [eventId]);
  return (
    <div className="public-page">
      <style>{styles}</style>
      <div className="public-brand"><img className="brand-img" src={settings?.logoUrl || "/afterglow-logo.png"} alt="Afterglow logo" /><div><b>{settings?.systemName || "Afterglow Register"}</b><span>Public registration</span></div></div>
      {loadingEvent ? <div className="panel register-panel"><Empty text="Loading event form..." /></div> : <>
        <PublicEventHeader event={event} />
        <RegistrationForm event={event} publicMode onDone={(delegate, email) => setDone({ delegate, email })} showToast={showToast} done={done} setDone={setDone} />
      </>}
      <Toast />
    </div>
  );
}

function PublicEventHeader({ event }) {
  if (!event) return null;
  const files = Array.isArray(event.eventFiles) ? event.eventFiles : [];
  return <div className="public-event-header">
    {event.bannerUrl && <img className="public-event-banner" src={event.bannerUrl} alt={`${event.name || "Event"} banner`} />}
    <div className="public-event-info panel">
      <h1>{event.name || "Event registration"}</h1>
      <div className="public-event-meta"><span><i className="ti ti-calendar" /> {fmtDate(event.date)}</span><span><i className="ti ti-map-pin" /> {event.venue || "Venue to be confirmed"}</span><span><i className="ti ti-building" /> {event.organizer || "Afterglow Register"}</span></div>
      {event.description && <p>{event.description}</p>}
      {files.length > 0 && <div className="public-file-list"><h3>Event agenda / files</h3>{files.map((file, index) => <a key={`${file.name}-${index}`} href={file.dataUrl} download={file.name} target="_blank" rel="noreferrer"><i className="ti ti-file-download" /><span>{file.name}</span><small>{formatBytes(file.size)}</small></a>)}</div>}
    </div>
  </div>;
}

function RegistrationForm({ event, publicMode, authMode, onDone, showToast, done, setDone }) {
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", organization: "", jobTitle: "", country: "Rwanda", category: "Delegate", photoUrl: "", customFields: {} });
  const [cropSrc, setCropSrc] = useState(null);
  const [busy, setBusy] = useState(false);
  const registrationSettings = event?.registrationSettings || {};
  const legacyRequiredFields = registrationSettings.requiredFields || ["fullName", "email"];
  const fieldModes = registrationSettings.fieldModes || {};
  const getMode = (key) => fieldModes[key] || (legacyRequiredFields.includes(key) ? "required" : "optional");
  const isHidden = (key) => getMode(key) === "hidden";
  const isRequired = (key) => getMode(key) === "required";
  const fieldLabel = (key, label) => `${label}${isRequired(key) ? " *" : ""}`;
  const showPhotoUpload = registrationSettings.photoUploadEnabled !== false && !isHidden("photoUrl");
  const categories = registrationSettings.categories?.length ? registrationSettings.categories : CATS;
  const setCustomField = (key, value) => setForm((f) => ({ ...f, customFields: { ...(f.customFields || {}), [key]: value } }));
  const register = async () => {
    if (!event?._id) return showToast("No event selected", "error");
    const labels = { fullName: "Full name", email: "Email", phone: "Phone", organization: "Organization", jobTitle: "Job title", country: "Country", category: "Category", photoUrl: "Participant photo" };
    for (const key of Object.keys(labels)) {
      if (isRequired(key) && !isHidden(key) && !(key === "photoUrl" && !showPhotoUpload) && !form[key]) return showToast(`${labels[key]} is required`, "error");
    }
    for (const cf of registrationSettings.customFields || []) {
      if (cf.required && !form.customFields?.[cf.key]) return showToast(`${cf.label || cf.key} is required`, "error");
    }
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
      const msg = email?.status === "sent" ? "Registration complete and email sent" : email?.status === "failed" ? `Registration saved, but email failed: ${email.error || "check backend SMTP settings"}` : "Registration complete. Email simulation saved.";
      showToast(msg, email?.status === "failed" ? "error" : "success");
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
    <div className={`alert ${done.email?.status === "failed" ? "error" : ""}`}><b>Email status:</b> {done.email?.status || "saved"}{done.email?.error ? <><br/><small>{done.email.error}</small></> : null}</div>
    <button className="btn primary" onClick={() => { setDone(null); setForm({ fullName: "", email: "", phone: "", organization: "", jobTitle: "", country: "Rwanda", category: "Delegate", photoUrl: "", customFields: {} }); }}>Register another</button>
  </div>;
  return <div className="panel register-panel">
    <h2>Participant registration</h2>
    <p className="small-muted">{event?.name || "Selected event"}</p>
    <div className="form-grid two">
      {!isHidden("fullName") && <Field label={fieldLabel("fullName", "Full name")} full><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>}
      {!isHidden("email") && <Field label={fieldLabel("email", "Email")}><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>}
      {!isHidden("phone") && <Field label={fieldLabel("phone", "Phone")}><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>}
      {!isHidden("organization") && <Field label={fieldLabel("organization", "Organization")}><input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></Field>}
      {!isHidden("jobTitle") && <Field label={fieldLabel("jobTitle", "Job title")}><input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></Field>}
      {!isHidden("country") && <Field label={fieldLabel("country", "Country")}><input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>}
      {!isHidden("category") && <Field label={fieldLabel("category", "Category")}><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field>}
      {(registrationSettings.customFields || []).map((cf) => <Field key={cf.key} label={`${cf.label || cf.key}${cf.required ? " *" : ""}`}>
        <input type={cf.type || "text"} value={form.customFields?.[cf.key] || ""} onChange={(e) => setCustomField(cf.key, e.target.value)} />
      </Field>)}
      {showPhotoUpload && <Field label={fieldLabel("photoUrl", "Photo crop/upload")} full>
        <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0])} />
        {form.photoUrl && <img src={form.photoUrl} className="photo-preview" alt="participant preview" />}
      </Field>}
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
  useEffect(() => { setTmpl({ ...DEFAULT_BADGE, ...(selectedEvent?.badgeTemplate || {}) }); setPrint(selectedEvent?.printSettings || DEFAULT_PRINT); }, [selectedEvent?._id]);
  const demo = { fullName: "Samuel Ishimwe", organization: "Afterglow", jobTitle: "Event Manager", category: "VIP", email: "samuel@example.com", phone: "+250 788 000 000", country: "Rwanda", delegateId: "DEL-DEMO", qrToken: "DEMO", event: selectedEvent?._id, photoUrl: "/afterglow-logo-192.png", customFields: { table: "A1", hotel: "Kigali" } };
  const allTextKeys = ["fullName","organization","jobTitle","category","email","phone","country","delegateId","eventName", ...((selectedEvent?.registrationSettings?.customFields || []).map((f) => `customFields.${f.key}`))];
  const save = async () => {
    await api(`/api/events/${selectedEvent._id}`, { method: "PUT", body: JSON.stringify({ badgeTemplate: tmpl, printSettings: print }) });
    showToast("Badge and print settings saved"); refresh();
  };
  const uploadBg = async (file) => {
    if (!file) return;
    if (file.type === "application/pdf") showToast("PDF backgrounds may not preview in browsers. PNG/JPG is recommended for exact badge output.", "error");
    const fd = new FormData(); fd.append("file", file);
    const res = await api("/api/uploads", { method: "POST", body: fd });
    setTmpl((t) => ({ ...t, backgroundUrl: res.url }));
  };
  const updateField = (i, key, value) => setTmpl((t) => ({ ...t, fields: (t.fields || DEFAULT_BADGE.fields).map((x, j) => j === i ? { ...x, [key]: value } : x) }));
  const removeField = (i) => setTmpl((t) => ({ ...t, fields: (t.fields || DEFAULT_BADGE.fields).filter((_, j) => j !== i) }));
  if (!selectedEvent?._id) return <Empty text="Create/select an event first" />;
  return <div className="designer-grid pro-designer">
    <div className="panel">
      <h2>Badge designer</h2>
      <p className="small-muted">Use percentages for X/Y/size so the badge scales correctly on A6, A5, CR80, and custom paper.</p>
      <div className="designer-section"><h3>Background</h3><div className="form-grid two">
        <Field label="Background color"><input type="color" value={tmpl.bgColor || "#1A1A19"} onChange={(e) => setTmpl({ ...tmpl, bgColor: e.target.value })} /></Field>
        <Field label="Background fit"><select value={tmpl.backgroundFit || "cover"} onChange={(e) => setTmpl({ ...tmpl, backgroundFit: e.target.value })}><option value="cover">Cover</option><option value="contain">Contain</option><option value="stretch">Stretch</option></select></Field>
        <Field label="Upload background" full><input type="file" accept="image/*,.pdf" onChange={(e) => uploadBg(e.target.files?.[0])} />{tmpl.backgroundUrl && <small className="small-muted">Current: {tmpl.backgroundUrl}</small>}</Field>
      </div></div>
      <div className="designer-section"><h3>Event title</h3><div className="form-grid two">
        <Field label="Show event name"><select value={String(tmpl.showEventTitle !== false)} onChange={(e) => setTmpl({ ...tmpl, showEventTitle: e.target.value === "true" })}><option value="true">Show</option><option value="false">Hide</option></select></Field>
        <Field label="Uppercase"><select value={String(tmpl.eventTitleUppercase !== false)} onChange={(e) => setTmpl({ ...tmpl, eventTitleUppercase: e.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></Field>
        <Field label="Title X"><input type="number" value={tmpl.eventTitleX || 50} onChange={(e) => setTmpl({ ...tmpl, eventTitleX: +e.target.value })} /></Field>
        <Field label="Title Y"><input type="number" value={tmpl.eventTitleY || 5} onChange={(e) => setTmpl({ ...tmpl, eventTitleY: +e.target.value })} /></Field>
        <Field label="Title size"><input type="number" value={tmpl.eventTitleSize || 9} onChange={(e) => setTmpl({ ...tmpl, eventTitleSize: +e.target.value })} /></Field>
        <Field label="Title color"><input type="color" value={tmpl.eventTitleColor || "#E8B267"} onChange={(e) => setTmpl({ ...tmpl, eventTitleColor: e.target.value })} /></Field>
      </div></div>
      <div className="designer-section"><h3>Participant photo</h3><div className="form-grid two">
        <Field label="Photo on badge"><select value={String(tmpl.showPhoto !== false)} onChange={(e) => setTmpl({ ...tmpl, showPhoto: e.target.value === "true" })}><option value="true">Show</option><option value="false">Hide</option></select></Field>
        <Field label="Show placeholder"><select value={String(tmpl.showPhotoPlaceholder !== false)} onChange={(e) => setTmpl({ ...tmpl, showPhotoPlaceholder: e.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></Field>
        <Field label="Photo X"><input type="number" value={tmpl.photoX || 50} onChange={(e) => setTmpl({ ...tmpl, photoX: +e.target.value })} /></Field>
        <Field label="Photo Y"><input type="number" value={tmpl.photoY || 19} onChange={(e) => setTmpl({ ...tmpl, photoY: +e.target.value })} /></Field>
        <Field label="Photo size"><input type="number" value={tmpl.photoSize || 21} onChange={(e) => setTmpl({ ...tmpl, photoSize: +e.target.value })} /></Field>
        <Field label="Photo shape"><select value={tmpl.photoShape || "circle"} onChange={(e) => setTmpl({ ...tmpl, photoShape: e.target.value })}><option value="circle">Circle</option><option value="rounded">Rounded</option><option value="square">Square</option></select></Field>
        <Field label="Photo fit"><select value={tmpl.photoFit || "cover"} onChange={(e) => setTmpl({ ...tmpl, photoFit: e.target.value })}><option value="cover">Cover</option><option value="contain">Contain</option></select></Field>
        <Field label="Border color"><input type="color" value={tmpl.photoBorderColor || "#ffffff"} onChange={(e) => setTmpl({ ...tmpl, photoBorderColor: e.target.value })} /></Field>
        <Field label="Border width"><input type="number" value={tmpl.photoBorderWidth ?? 2} onChange={(e) => setTmpl({ ...tmpl, photoBorderWidth: +e.target.value })} /></Field>
      </div></div>
      <div className="designer-section"><h3>QR code</h3><div className="form-grid two">
        <Field label="Show QR"><select value={String(tmpl.showQR !== false)} onChange={(e) => setTmpl({ ...tmpl, showQR: e.target.value === "true" })}><option value="true">Show</option><option value="false">Hide</option></select></Field>
        <Field label="QR background"><select value={String(tmpl.qrBackground !== false)} onChange={(e) => setTmpl({ ...tmpl, qrBackground: e.target.value === "true" })}><option value="true">White box</option><option value="false">Transparent</option></select></Field>
        <Field label="QR X"><input type="number" value={tmpl.qrX || 50} onChange={(e) => setTmpl({ ...tmpl, qrX: +e.target.value })} /></Field>
        <Field label="QR Y"><input type="number" value={tmpl.qrY || 32} onChange={(e) => setTmpl({ ...tmpl, qrY: +e.target.value })} /></Field>
        <Field label="QR size"><input type="number" value={tmpl.qrSize || 24} onChange={(e) => setTmpl({ ...tmpl, qrSize: +e.target.value })} /></Field>
        <Field label="QR padding"><input type="number" value={tmpl.qrPadding ?? 5} onChange={(e) => setTmpl({ ...tmpl, qrPadding: +e.target.value })} /></Field>
      </div></div>
      <div className="designer-section"><h3>Print setup</h3><div className="form-grid two">
        <Field label="Paper size"><select value={print.paperSize} onChange={(e) => setPrint({ ...print, paperSize: e.target.value })}>{["A6", "A5", "A4", "CR80", "EVENT_BADGE", "CUSTOM"].map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Auto print"><select value={String(print.autoPrintAfterCheckin)} onChange={(e) => setPrint({ ...print, autoPrintAfterCheckin: e.target.value === "true" })}><option value="true">On</option><option value="false">Off</option></select></Field>
        <Field label="Margin mm"><input type="number" value={print.marginMm} onChange={(e) => setPrint({ ...print, marginMm: +e.target.value })} /></Field>
        <Field label="Custom width mm"><input type="number" value={print.customWidthMm || 105} onChange={(e) => setPrint({ ...print, customWidthMm: +e.target.value })} /></Field>
        <Field label="Custom height mm"><input type="number" value={print.customHeightMm || 148} onChange={(e) => setPrint({ ...print, customHeightMm: +e.target.value })} /></Field>
      </div></div>
      <div className="designer-section"><h3>Text fields</h3>
        {(tmpl.fields || DEFAULT_BADGE.fields).map((f, i) => <div key={i} className="field-row enhanced-field-row">
          <select value={f.key} onChange={(e) => updateField(i, "key", e.target.value)}>{allTextKeys.map((k) => <option key={k}>{k}</option>)}</select>
          <input value={f.label || f.key} onChange={(e) => updateField(i, "label", e.target.value)} placeholder="Label" />
          <input type="number" value={f.x} onChange={(e) => updateField(i, "x", +e.target.value)} title="X" />
          <input type="number" value={f.y} onChange={(e) => updateField(i, "y", +e.target.value)} title="Y" />
          <input type="number" value={f.size} onChange={(e) => updateField(i, "size", +e.target.value)} title="Size" />
          <select value={f.weight || "normal"} onChange={(e) => updateField(i, "weight", e.target.value)}><option>normal</option><option>bold</option><option>800</option></select>
          <select value={f.align || "center"} onChange={(e) => updateField(i, "align", e.target.value)}><option>center</option><option>left</option><option>right</option></select>
          <input type="color" value={f.color || "#ffffff"} onChange={(e) => updateField(i, "color", e.target.value)} />
          <button className="icon-btn danger" onClick={() => removeField(i)}><i className="ti ti-trash" /></button>
        </div>)}
        <div className="modal-actions"><button className="btn ghost" onClick={() => setTmpl((t) => ({ ...t, fields: [...(t.fields || []), { key: "fullName", label: "Full Name", x: 50, y: 90, size: 12, color: "#fff", weight: "normal", align: "center" }] }))}>Add text field</button><button className="btn primary" onClick={save}>Save design</button></div>
      </div>
    </div>
    <div className="panel preview-panel"><h3>Live preview</h3><BadgeView delegate={demo} event={{ ...selectedEvent, badgeTemplate: tmpl, printSettings: print }} size={300} /><button className="btn ghost full" onClick={() => printBadges([demo], { ...selectedEvent, badgeTemplate: tmpl, printSettings: print })}>Test print</button></div>
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
      <Field label="Logo URL"><input value={form.logoUrl || "/afterglow-logo.png"} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="/afterglow-logo.png" /></Field>
      <Field label="Accent color"><input type="color" value={form.appearance?.accentColor || "#CF6B11"} onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, accentColor: e.target.value } })} /></Field>
      <Field label="Mode"><select value={form.appearance?.mode || "dark"} onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, mode: e.target.value } })}><option>dark</option><option>light</option><option>system</option></select></Field>
      <Field label="Font size"><select value={form.appearance?.fontSize || "normal"} onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, fontSize: e.target.value } })}><option>small</option><option>normal</option><option>large</option></select></Field>
      <Field label="Compact mode"><select value={String(form.appearance?.compactMode || false)} onChange={(e) => setForm({ ...form, appearance: { ...form.appearance, compactMode: e.target.value === "true" } })}><option value="false">Off</option><option value="true">On</option></select></Field>
    </div><button className="btn primary" onClick={save}>Save settings</button></div>
    <div className="panel"><h2>Email and data</h2><p className="small-muted">Real email is controlled by backend .env. If ENABLE_EMAIL=false, backend saves email simulation logs.</p><button className="btn ghost full" onClick={exportBackup}>Export frontend settings JSON</button><button className="btn danger full" onClick={() => { if (confirm("This only logs out and clears frontend storage. Backend MongoDB data remains safe.")) { localStorage.clear(); location.reload(); } }}>Reset frontend storage</button></div>
  </div>;
}

function badgeRadius(shape) {
  if (shape === "square") return "0";
  if (shape === "rounded") return "14%";
  return "50%";
}
function bgFit(fit) {
  if (fit === "contain") return "contain";
  if (fit === "stretch") return "fill";
  return "cover";
}
function delegateValue(delegate, key, event) {
  if (key === "eventName") return event?.name || "Afterglow Register";
  if (key?.startsWith("customFields.")) return delegate?.customFields?.[key.replace("customFields.", "")];
  return delegate?.[key];
}
function photoStyle(t) {
  return {
    left: `${t.photoX || 50}%`,
    top: `${t.photoY || 18}%`,
    width: `${t.photoSize || 20}%`,
    height: `${t.photoSize || 20}%`,
    borderRadius: badgeRadius(t.photoShape),
    border: `${t.photoBorderWidth ?? 2}px solid ${t.photoBorderColor || "#fff"}`,
    objectFit: t.photoFit || "cover",
  };
}
function BadgeView({ delegate, event, size = 220 }) {
  const t = { ...DEFAULT_BADGE, ...(event?.badgeTemplate || {}) };
  const w = size, h = Math.round(size * 1.42);
  const photoSrc = delegate.photoUrl || (t.showPhotoPlaceholder !== false ? "/afterglow-logo-192.png" : "");
  const titleText = t.eventTitleUppercase === false ? (event?.name || "Afterglow Register") : String(event?.name || "Afterglow Register").toUpperCase();
  return <div className="badge-view" style={{ width: w, height: h, background: t.bgColor || "#111" }}>
    {t.backgroundUrl && <img className="badge-bg" src={t.backgroundUrl} style={{ objectFit: bgFit(t.backgroundFit) }} alt="badge background" />}
    {t.showEventTitle !== false && <div className="badge-event" style={{ left: `${t.eventTitleX || 50}%`, top: `${t.eventTitleY || 5}%`, fontSize: Math.round((t.eventTitleSize || 9) * size / 220), color: t.eventTitleColor || "#E8B267", fontWeight: t.eventTitleWeight || "bold" }}>{titleText}</div>}
    {t.showPhoto !== false && photoSrc && <img src={photoSrc} className="badge-photo" style={photoStyle(t)} alt="photo" />}
    {t.showQR !== false && <div className="badge-qr" style={{ left: `${t.qrX || 50}%`, top: `${t.qrY || 32}%`, width: `${t.qrSize || 24}%`, background: t.qrBackground === false ? "transparent" : "white", padding: t.qrBackground === false ? 0 : (t.qrPadding ?? 5), borderRadius: t.qrRadius ?? 6 }}><QRCodeCanvas value={qrPayload(delegate)} size={120} style={{ width: "100%", height: "auto" }} /></div>}
    {(t.fields || DEFAULT_BADGE.fields).map((f, i) => <div key={i} className="badge-field" style={{ left: `${f.x}%`, top: `${f.y}%`, fontSize: Math.round((f.size || 12) * size / 220), color: f.color, fontWeight: f.weight, textAlign: f.align || "center" }}>{safe(delegateValue(delegate, f.key, event))}</div>)}
  </div>;
}

async function printBadges(delegates, event) {
  const ev = normalizeEvent(event || {});
  const paper = paperSize(ev.printSettings);
  const htmlBadges = [];
  for (const d of delegates) {
    const qr = await QRCode.toDataURL(qrPayload(d), { width: 280, margin: 1 });
    const t = { ...DEFAULT_BADGE, ...(ev.badgeTemplate || {}) };
    const photoSrc = d.photoUrl || (t.showPhotoPlaceholder !== false ? "/afterglow-logo-192.png" : "");
    const titleText = t.eventTitleUppercase === false ? (ev.name || "Afterglow Register") : String(ev.name || "Afterglow Register").toUpperCase();
    const eventTitle = t.showEventTitle !== false ? `<div class="print-event" style="left:${t.eventTitleX || 50}%;top:${t.eventTitleY || 5}%;font-size:${t.eventTitleSize || 9}pt;color:${t.eventTitleColor || "#E8B267"};font-weight:${t.eventTitleWeight || "bold"}">${escapeHtml(titleText)}</div>` : "";
    const photo = t.showPhoto !== false && photoSrc ? `<img class="print-photo" src="${photoSrc}" style="left:${t.photoX || 50}%;top:${t.photoY || 18}%;width:${t.photoSize || 20}%;height:${t.photoSize || 20}%;border-radius:${badgeRadius(t.photoShape)};border:${t.photoBorderWidth ?? 2}px solid ${t.photoBorderColor || "#fff"};object-fit:${t.photoFit || "cover"}"/>` : "";
    const qrBox = t.showQR !== false ? `<img class="print-qr" src="${qr}" style="left:${t.qrX || 50}%;top:${t.qrY || 32}%;width:${t.qrSize || 24}%;background:${t.qrBackground === false ? "transparent" : "#fff"};padding:${t.qrBackground === false ? 0 : (t.qrPadding ?? 5)}px;border-radius:${t.qrRadius ?? 6}px"/>` : "";
    const fields = (t.fields || DEFAULT_BADGE.fields).map((f) => `<div class="print-field" style="left:${f.x}%;top:${f.y}%;font-size:${f.size || 12}pt;color:${f.color};font-weight:${f.weight};text-align:${f.align || "center"}">${escapeHtml(safe(delegateValue(d, f.key, ev)))}</div>`).join("");
    htmlBadges.push(`<section class="print-page"><div class="print-badge" style="background:${t.bgColor || "#111"}">${t.backgroundUrl ? `<img class="print-bg" src="${t.backgroundUrl}" style="object-fit:${bgFit(t.backgroundFit)}"/>` : ""}${eventTitle}${photo}${qrBox}${fields}</div></section>`);
  }
  const win = window.open("", "_blank", "width=900,height=700");
  win.document.write(`<!doctype html><html><head><title>Print Badges</title><style>@page{size:${paper.w}mm ${paper.h}mm;margin:${ev.printSettings?.marginMm || 0}mm}body{margin:0;background:#eee}.print-page{width:${paper.w}mm;height:${paper.h}mm;page-break-after:always;display:flex;align-items:center;justify-content:center}.print-badge{width:100%;height:100%;position:relative;overflow:hidden;font-family:Arial,sans-serif;color:#fff}.print-bg{position:absolute;inset:0;width:100%;height:100%}.print-event{position:absolute;transform:translateX(-50%);text-align:center;text-transform:uppercase;letter-spacing:1.8px;z-index:1;width:90%}.print-qr{position:absolute;transform:translate(-50%,-50%);box-sizing:content-box}.print-photo{position:absolute;transform:translate(-50%,-50%);box-sizing:border-box}.print-field{position:absolute;transform:translateX(-50%);width:88%;text-shadow:0 1px 2px rgba(0,0,0,.55);z-index:2}@media print{body{background:#fff}}</style></head><body>${htmlBadges.join("")}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}
function printTest(event) { printBadges([{ fullName: "Test Participant", organization: "Afterglow", jobTitle: "Guest", category: "VIP", delegateId: "TEST-001", qrToken: "TEST", event: event?._id, photoUrl: "/afterglow-logo-192.png" }], event); }
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
:root{--accent:#CF6B11;--bg:#0f0f0f;--panel:#151515;--panel2:#1b1b1b;--text:#f2f2f2;--muted:#8b8b8b;--line:#262626;--font-scale:1}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,Segoe UI,system-ui,sans-serif;font-size:calc(14px * var(--font-scale))}body.light{--bg:#f4f4f4;--panel:#fff;--panel2:#f8f8f8;--text:#151515;--muted:#6b7280;--line:#e5e7eb}button,input,select,textarea{font:inherit}button{cursor:pointer}input,select,textarea{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--text);padding:10px 12px;outline:none}textarea{min-height:90px}.app-shell{height:100vh;display:flex;overflow:hidden}.sidebar{width:250px;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;flex-shrink:0}.brand{padding:18px;display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--line)}.brand-logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--accent),#733709);display:flex;align-items:center;justify-content:center;font-weight:900;color:white;box-shadow:0 0 22px color-mix(in srgb,var(--accent),transparent 75%)}.brand-logo.big{width:60px;height:60px;margin:auto;font-size:22px}.brand-img{width:42px;height:42px;object-fit:contain;flex-shrink:0;filter:drop-shadow(0 0 14px color-mix(in srgb,var(--accent),transparent 55%))}.brand-img.big{width:86px;height:86px;margin:0 auto 10px;display:block}.brand-text{min-width:0}.brand-text b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.brand-text span,.small-muted{color:var(--muted);font-size:12px}.event-select-wrap{padding:12px 14px;border-bottom:1px solid var(--line);min-width:0}.event-select-wrap label{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}.event-select-wrap select{height:38px;font-size:12px;max-width:100%;text-overflow:ellipsis}.active-event-name{margin-top:6px;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.nav-list{padding:10px 0;overflow:auto;flex:1}.nav-list button{width:100%;display:flex;gap:10px;align-items:center;border:0;background:transparent;color:var(--muted);padding:11px 18px;text-align:left;border-left:3px solid transparent}.nav-list button.active{color:var(--accent);background:color-mix(in srgb,var(--accent),transparent 88%);border-left-color:var(--accent)}.user-box{padding:14px 18px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:4px}.user-box span{color:var(--accent);font-size:11px}.link-btn{background:transparent;border:0;color:var(--muted);text-align:left;padding:6px 0}.main-panel{min-width:0;flex:1;overflow:auto}.topbar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg),transparent 6%);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:16px 24px;display:flex;align-items:center;gap:14px;justify-content:space-between}.top-title{min-width:0}.top-title h1{margin:0;font-size:20px}.top-title p{margin:2px 0 0;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48vw}.top-actions{display:flex;gap:8px;align-items:center}.api-pill{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:7px 11px;font-size:11px;color:var(--muted);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.content{padding:24px;max-width:1480px;margin:auto}.btn{border:0;border-radius:10px;padding:10px 14px;font-weight:700;display:inline-flex;align-items:center;gap:7px;justify-content:center}.btn.primary{background:var(--accent);color:#fff}.btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}.btn.success{background:#15803d;color:#fff}.btn.danger{background:#7f1d1d;color:#fff}.btn.full{width:100%;margin-top:12px}.toolbar{display:flex;gap:10px;justify-content:flex-end;margin-bottom:16px;align-items:center}.toolbar.wrap{justify-content:flex-start;flex-wrap:wrap}.search{max-width:360px}.cards.three{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:18px}.stat-card,.panel,.event-card,.table-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.12)}.stat-card{padding:20px;display:flex;justify-content:space-between;align-items:flex-start}.stat-card span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.8px}.stat-card b{display:block;font-size:34px;color:var(--accent);margin-top:8px}.stat-card b.green{color:#22c55e}.stat-card b.orange{color:#f59e0b}.stat-card i{font-size:28px;color:var(--accent);opacity:.85}.panel{padding:20px}.panel h2,.panel h3{margin-top:0}.grid-two{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px}.quick-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.quick-actions button,.export-grid button{background:var(--panel2);border:1px solid var(--line);border-radius:12px;color:var(--text);padding:14px;text-align:left}.info-list,.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.info-list span,.info-grid span{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px;color:var(--muted)}.info-list b,.info-grid b{display:block;color:var(--text);font-size:11px;margin-bottom:3px}.progress-row{margin:11px 0}.progress-row div{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-bottom:5px}.progress-row b{color:var(--accent)}.progress-row em{display:block;height:6px;background:var(--panel2);border-radius:99px;overflow:hidden}.progress-row i{display:block;height:100%;background:var(--accent)}.mini-delegate{display:flex;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--line)}.mini-delegate:last-child{border-bottom:0}.mini-delegate b{display:block}.mini-delegate span{display:block;color:var(--muted);font-size:12px}.avatar{width:42px;height:42px;border-radius:12px;object-fit:cover}.avatar.initials{background:color-mix(in srgb,var(--accent),transparent 75%);color:var(--accent);font-weight:900;display:flex;align-items:center;justify-content:center}.cat-badge,.status{display:inline-block;padding:4px 8px;border-radius:99px;background:color-mix(in srgb,var(--accent),transparent 85%);color:var(--accent);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px}.status.in{background:#14532d;color:#86efac}.status.pending{background:#3b2a0b;color:#facc15}.event-grid,.badge-grid,.user-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}.event-card{overflow:hidden;padding:0 18px 18px}.event-color{height:5px;margin:0 -18px 14px}.event-card h3{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.event-card p{color:var(--muted);font-size:13px}.row-actions{display:flex;gap:7px;flex-wrap:wrap}.form-grid{display:grid;gap:12px}.form-grid.two{grid-template-columns:1fr 1fr}.field{display:flex;flex-direction:column;gap:6px;color:var(--muted);font-size:12px}.field.full{grid-column:1/-1}.form-section{background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:14px;margin-top:4px}.form-section h3,.form-section h4{margin:0 0 8px}.check-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin:10px 0}.check-row{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.check-row input{width:auto}.custom-field-row{display:grid;grid-template-columns:1.5fr 110px 110px 38px;gap:8px;align-items:center;margin-bottom:8px}.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:50;display:flex;align-items:center;justify-content:center;padding:18px}.modal{background:var(--panel);border:1px solid var(--line);border-radius:18px;max-width:760px;width:100%;max-height:92vh;overflow:auto;padding:20px}.modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.modal-head h2{margin:0}.modal-head button{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:10px;width:36px;height:36px}.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.table-card{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:middle}th{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}td small{display:block;color:var(--muted);font-size:11px}.icon-btn{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);color:var(--accent)}.icon-btn.danger{color:#ef4444}.mobile-cards{display:none}.profile-head{display:flex;gap:16px;align-items:center;margin-bottom:18px}.profile-head h2{margin:0}.register-panel,.narrow{max-width:720px;margin:auto}.register-done{text-align:center}.register-done>i{font-size:64px;color:#22c55e}.qr-card{background:#fff;border-radius:14px;display:inline-flex;flex-direction:column;gap:8px;align-items:center;padding:16px;color:#111;margin:15px}.photo-preview{width:74px;height:74px;border-radius:14px;object-fit:cover;margin-top:8px}.public-page,.login-page{min-height:100vh;background:radial-gradient(circle at top,var(--accent)22,transparent 30%),var(--bg);display:flex;align-items:center;justify-content:center;padding:24px}.public-page{display:block}.public-brand{max-width:720px;margin:0 auto 18px;display:flex;gap:12px;align-items:center}.public-brand span{display:block;color:var(--muted);font-size:12px}.login-card{width:100%;max-width:430px;background:var(--panel);border:1px solid var(--line);border-radius:24px;padding:30px;box-shadow:0 30px 80px rgba(0,0,0,.3)}.login-card h1{text-align:center;margin:16px 0 5px}.login-card p{text-align:center;color:var(--muted)}.center{text-align:center}.alert{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px;margin:10px 0;color:var(--muted)}.alert.error{background:#3b1111;color:#fecaca;border-color:#7f1d1d}.toast{position:fixed;right:22px;bottom:22px;z-index:80;background:#14532d;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 10px 35px rgba(0,0,0,.35);font-weight:700}.toast.error{background:#7f1d1d}.checkin-grid,.designer-grid,.settings-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.qr-reader{background:#000;border-radius:14px;overflow:hidden}.manual-check{display:flex;gap:8px;margin-top:14px}.result-card{padding:18px;border-radius:14px;background:var(--panel2);display:flex;flex-direction:column;gap:8px}.result-card i{font-size:42px}.result-card.success i{color:#22c55e}.result-card.error i{color:#ef4444}.badge-tile{text-align:center}.badge-tile b{display:block;margin:8px 0;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge-view{position:relative;overflow:hidden;border-radius:13px;margin:auto;box-shadow:0 12px 35px rgba(0,0,0,.35);font-family:Arial,sans-serif}.badge-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.badge-event{position:absolute;top:8px;left:0;right:0;text-align:center;color:#E8B267;font-size:9px;text-transform:uppercase;letter-spacing:1.8px;font-weight:800;z-index:1}.badge-photo{position:absolute;transform:translate(-50%,-50%);object-fit:cover;border-radius:50%;border:2px solid white;z-index:2}.badge-qr{position:absolute;transform:translate(-50%,-50%);background:white;padding:5px;border-radius:6px;z-index:2}.badge-field{position:absolute;transform:translateX(-50%);width:88%;z-index:2;text-shadow:0 1px 3px rgba(0,0,0,.6)}.field-row{display:grid;grid-template-columns:2fr 70px 70px 80px 60px;gap:8px;margin-bottom:8px}.export-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.crop-area{height:360px;position:relative;background:#111;border-radius:14px;overflow:hidden;margin-bottom:16px}.empty{color:var(--muted);padding:25px;text-align:center}.mobile-menu{display:none}.mobile-bottom{display:none}
.field-mode-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin:12px 0}.field-mode-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px;display:grid;grid-template-columns:1fr 120px;gap:10px;align-items:center}.field-mode-card b{display:block;color:var(--text)}.field-mode-card span{display:block;color:var(--muted);font-size:11px}.designer-section{border:1px solid var(--line);background:var(--panel2);border-radius:14px;padding:14px;margin:14px 0}.designer-section h3{margin:0 0 10px}.enhanced-field-row{grid-template-columns:1.4fr 1.2fr 65px 65px 65px 90px 90px 52px 38px}.badge-event{position:absolute;transform:translateX(-50%);right:auto;width:90%;letter-spacing:1.8px;text-align:center;text-transform:uppercase}.badge-bg{object-position:center}.badge-photo{box-sizing:border-box;background:#fff}.badge-qr{box-sizing:content-box}.preview-panel{position:sticky;top:92px;align-self:start}.pro-designer{grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr)}
.event-banner-preview{margin-top:10px;background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:10px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.event-banner-preview img{width:100%;max-height:180px;object-fit:cover;border-radius:10px}.file-list{display:flex;flex-direction:column;gap:8px;margin-top:10px}.event-file-row{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px}.event-file-row span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.event-file-row small{display:block;color:var(--muted)}.public-event-header{max-width:900px;margin:0 auto 18px}.public-event-banner{width:100%;max-height:280px;object-fit:cover;border-radius:18px;margin-bottom:14px;border:1px solid var(--line);background:#111}.public-event-info h1{margin:0 0 8px;font-size:26px}.public-event-meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin-bottom:8px}.public-file-list{margin-top:16px;display:flex;flex-direction:column;gap:8px}.public-file-list h3{margin:0 0 4px}.public-file-list a{display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:10px;background:var(--panel2);border:1px solid var(--line);color:var(--text);text-decoration:none}.public-file-list a span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.public-file-list a small{color:var(--muted)}
@media(max-width:900px){.sidebar{display:none}.app-shell{display:block;height:auto;min-height:100vh;overflow:auto}.main-panel{padding-bottom:72px}.topbar{padding:14px;align-items:flex-start}.top-actions{display:none}.top-title p{max-width:80vw}.content{padding:14px}.cards.three,.grid-two,.checkin-grid,.designer-grid,.settings-grid{grid-template-columns:1fr}.quick-actions{grid-template-columns:1fr}.form-grid.two{grid-template-columns:1fr}.field.full{grid-column:auto}.mobile-bottom{position:fixed;bottom:0;left:0;right:0;z-index:20;display:grid;grid-template-columns:repeat(5,1fr);background:var(--panel);border-top:1px solid var(--line);padding:6px 4px}.mobile-bottom button{background:transparent;border:0;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10px}.mobile-bottom button i{font-size:20px}.mobile-bottom button.active{color:var(--accent)}table{display:none}.mobile-cards{display:block}.mobile-delegate{background:var(--panel);border-bottom:1px solid var(--line);padding:10px}.table-card{overflow:hidden}.event-grid,.badge-grid,.user-grid{grid-template-columns:1fr}.manual-check{flex-direction:column}.profile-head{align-items:flex-start;flex-wrap:wrap}.info-grid,.info-list{grid-template-columns:1fr}.modal{padding:16px}.modal-actions{flex-direction:column}.modal-actions .btn{width:100%}.crop-area{height:300px}.field-row,.enhanced-field-row{grid-template-columns:1fr 60px 60px;}.field-row input[type=color]{grid-column:auto}.api-pill{display:none}}
@media(max-width:430px){.top-title h1{font-size:18px}.content{padding:10px}.panel,.stat-card{border-radius:13px;padding:14px}.stat-card b{font-size:28px}.login-card{padding:22px;border-radius:18px}.public-page,.login-page{padding:14px}.btn{padding:10px 12px}.badge-view{max-width:100%}.toolbar{flex-direction:column;align-items:stretch}.toolbar .btn,.toolbar select,.toolbar input{width:100%;max-width:100%}.cards.three{gap:10px}.mobile-bottom span{font-size:9px}}
`;
