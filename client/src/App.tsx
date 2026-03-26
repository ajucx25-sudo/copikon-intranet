import { useState, useEffect, useRef, useCallback } from "react";
// API_BASE: detecta si estamos en el proxy de Perplexity (sites.pplx.app)
function detectApiBase(): string {
  const qs = new URLSearchParams(window.location.search);
  const fromParam = qs.get("apibase");
  if (fromParam && fromParam.length > 0) return fromParam;
  const fromWindow = (window as any).__INTRANET_API__ ?? "";
  if (fromWindow && !fromWindow.startsWith("__")) return fromWindow;
  if (window.location.hostname === "sites.pplx.app") return "/port/5000";
  return "";
}
const API_BASE: string = detectApiBase();

// ── Proyectos inyectados en el HTML al momento del build ────────
function lsLoadProjects(): Project[] {
  // Usar proyectos inyectados en el build como fallback
  const injected = (window as any).__INTRANET_PROJECTS__;
  if (Array.isArray(injected) && injected.length > 0) return injected;
  return [];
}
function lsSaveProjects(_projects: Project[]) {
  // No-op: proyectos se persisten vía servidor Express
  // Se re-inyectan en el HTML en cada deploy/build
}
function lsNextId() { return "ls_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

// Usuario pre-autenticado desde el organigrama (pasado por ?user=)
function getAutoLoginUser(): any | null {
  try {
    const qs = new URLSearchParams(window.location.search);
    const raw = qs.get("user");
    if (!raw) return null;
    const u = JSON.parse(decodeURIComponent(raw));
    if (u && u.username) return u;
  } catch {}
  return null;
}

import { apiRequest } from "./lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────
interface User { username: string; nombre: string; cargo: string; gerencia: string; role: string; cargoId: string; }
interface Message { id: string; from: string; to?: string; channelId?: string; convId?: string; text: string; ts: number; read?: boolean; }
interface Channel { id: string; name: string; gerencia: string; color: string; desc: string; }
interface CheckItem { id: string; text: string; done: boolean; }
interface SubTask { id: string; title: string; status: string; assignee: string|null; }
interface Task {
  id: string; title: string; desc: string;
  assignee: string|null; priority: string;
  startDate: string|null; dueDate: string|null; duration: number|null;
  status: string; percent: number;
  hoursEstimated: number|null; hoursActual: number;
  labels: string[];
  checklist: CheckItem[];
  subtasks: SubTask[];
  createdAt: number; comments: Comment[];
}
interface Project { id: string; name: string; desc: string; color: string; owner: string; members: string[]; tasks: Task[]; createdAt: number; }
interface Comment { id: string; from: string; text: string; ts: number; }

// ── Constants ──────────────────────────────────────────────────────
const GER_COLORS: Record<string, string> = {
  root:"#1a3a6b", comercializacion:"#4a7fd4", operaciones:"#e8a020",
  finanzas:"#3cb371", retail:"#a06ad4", it:"#5b8ff9",
  proyectos:"#dd6874", compras:"#f0a050", staff:"#6b7a99", general:"#2bbfae"
};
const GER_NAMES: Record<string, string> = {
  root:"Dirección General", comercializacion:"Comercialización", operaciones:"Operaciones",
  finanzas:"Finanzas", retail:"Retail", it:"IT", proyectos:"Proyectos",
  compras:"Compras", staff:"Staff", general:"General"
};
const PRIORITY_CFG: Record<string, {label:string;color:string}> = {
  alta:   { label:"Alta",   color:"#ef4444" },
  media:  { label:"Media",  color:"#f59e0b" },
  baja:   { label:"Baja",   color:"#22c55e" },
};
const STATUS_COLS = [
  { id:"pendiente",   label:"Por hacer",    color:"#6b7a99" },
  { id:"en_progreso", label:"En progreso",  color:"#4a7fd4" },
  { id:"revision",    label:"En revisión",  color:"#f59e0b" },
  { id:"completado",  label:"Completado",   color:"#22c55e" },
];

function fmtTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-VE", { day:"2-digit", month:"short" });
}
function initials(nombre: string) { return nombre.split(" ").map(w=>w[0]||"").join("").toUpperCase().slice(0,2) || "?"; }
function Avatar({ user, size=32 }: { user: User|undefined; size?: number }) {
  const g = user?.gerencia || "general";
  const bg = GER_COLORS[g] || "#888";
  const nm = user?.nombre || user?.username || "?";
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:bg, display:"flex",
      alignItems:"center", justifyContent:"center", color:"#fff", fontSize:size*0.36,
      fontWeight:700, flexShrink:0, userSelect:"none" }}>
      {initials(nm)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ══════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }: { onLogin: (u: User) => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    const uname = user.trim();
    try {
      const res = await fetch(`${API_BASE}/api/intranet/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: uname, password: pass })
      });
      if (res.ok) { onLogin(await res.json()); return; }
      // Si el servidor falla, intentar validar con datos embebidos en el HTML
      const localUsers: Record<string, any> = (window as any).__PORTAL_USERS__ || {};
      const localUser = localUsers[uname];
      if (localUser && localUser.password === pass) {
        const { password: _, ...safe } = localUser;
        onLogin(safe); return;
      }
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Usuario o contraseña incorrectos");
    } catch {
      // Sin conexión al servidor — intentar offline
      const localUsers: Record<string, any> = (window as any).__PORTAL_USERS__ || {};
      const localUser = localUsers[uname];
      if (localUser && localUser.password === pass) {
        const { password: _, ...safe } = localUser;
        onLogin(safe); return;
      }
      setError("Usuario o contraseña incorrectos");
    }
    finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0f2044 0%,#1a3a6b 60%,#2a5298 100%)",
      display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
      <div style={{ background:"rgba(255,255,255,0.97)", borderRadius:20, padding:"32px 30px 28px",
        width:"100%", maxWidth:360, boxShadow:"0 20px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <img src="./copikon-logo.jpg" style={{ height:40, marginBottom:12 }} alt="Copikon" />
          <div style={{ fontSize:17, fontWeight:800, color:"#1a3a6b" }}>Intranet Copikon</div>
          <div style={{ fontSize:12, color:"#6b7a99", marginTop:4 }}>Chat · Proyectos · Colaboración</div>
        </div>
        <form onSubmit={handleLogin}>
          <label style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:".06em", color:"#6b7a99", display:"block", marginBottom:5 }}>Usuario</label>
          <input value={user} onChange={e=>setUser(e.target.value)} placeholder="tu.usuario"
            style={{ width:"100%", padding:"10px 13px", borderRadius:9, border:"1.5px solid #dde3f0",
              background:"#f8faff", fontSize:13.5, boxSizing:"border-box", fontFamily:"inherit",
              marginBottom:12, outline:"none" }} autoFocus />
          <label style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:".06em", color:"#6b7a99", display:"block", marginBottom:5 }}>Contraseña</label>
          <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••"
            style={{ width:"100%", padding:"10px 13px", borderRadius:9, border:"1.5px solid #dde3f0",
              background:"#f8faff", fontSize:13.5, boxSizing:"border-box", fontFamily:"inherit",
              marginBottom:16, outline:"none" }} />
          {error && <div style={{ fontSize:12, color:"#ef4444", textAlign:"center", marginBottom:12 }}>{error}</div>}
          <button type="submit" disabled={loading}
            style={{ width:"100%", padding:11, borderRadius:10, border:"none",
              background:"linear-gradient(90deg,#1a3a6b,#2a5298)", color:"#fff",
              fontSize:14, fontWeight:800, cursor:"pointer", opacity:loading?.6:1, fontFamily:"inherit" }}>
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:11, marginTop:18 }}>
        Usa las mismas credenciales del Portal del Empleado
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// CHAT PANEL
// ══════════════════════════════════════════════════════════════════
function ChatPanel({ me, users, tab }: { me: User; users: User[]; tab: "direct"|"channels" }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<string|null>(null); // userId or channelId
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [unread, setUnread] = useState<Record<string,number>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isChannel = tab === "channels";

  // Cargar canales
  useEffect(() => {
    fetch(`${API_BASE}/api/intranet/channels`).then(r=>r.json()).then(setChannels).catch(()=>{});
  }, []);

  // SSE
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/intranet/sse/${me.username}`);
    es.onmessage = (e) => {
      const { event, data } = JSON.parse(e.data);
      if (event === "new_message") {
        const convId = [data.from, data.to].sort().join("__");
        const convKey = data.from === me.username ? data.to : data.from;
        setMessages(prev => {
          const isActive = isChannel ? data.channelId === selected : ([data.from,data.to].sort().join("__") === [me.username, selected].sort().join("__"));
          if (isActive) {
            const updated = [...prev, data];
            msgStore.current[convKey] = (msgStore.current[convKey] || []).concat(data).slice(-200);
            return updated;
          }
          return prev;
        });
        // Guardar en memoria aunque no esté en la conversación activa
        const storedDirect = msgStore.current[convKey] || [];
        if (!storedDirect.find(m => m.id === data.id)) {
          msgStore.current[convKey] = [...storedDirect, data].slice(-200);
        }
        if (!isChannel && data.to === me.username && data.from !== selected)
          setUnread(u => ({ ...u, [data.from]: (u[data.from]||0)+1 }));
      }
      if (event === "channel_message") {
        setMessages(prev => {
          if (data.channelId === selected) {
            const updated = [...prev, data];
            msgStore.current[data.channelId] = (msgStore.current[data.channelId] || []).concat(data).slice(-200);
            return updated;
          }
          return prev;
        });
        // Guardar canal en memoria
        const storedCh = msgStore.current[data.channelId] || [];
        if (!storedCh.find((m: Message) => m.id === data.id)) {
          msgStore.current[data.channelId] = [...storedCh, data].slice(-200);
        }
      }
    };
    return () => es.close();
  }, [me.username, selected, isChannel]);

  // ── Store en memoria (persiste mientras dure la sesión) ───────────
  const msgStore = useRef<Record<string, Message[]>>({});
  function lsLoad(id: string): Message[] { return msgStore.current[id] || []; }
  function lsSave(id: string, msgs: Message[]) { msgStore.current[id] = msgs.slice(-200); }

  // Cargar mensajes al seleccionar
  useEffect(() => {
    if (!selected) return;
    // Cargar desde memoria de sesión primero (instantáneo)
    const cached = lsLoad(selected);
    setMessages(cached);
    if (cached.length > 0) scrollToBottom();
    // Luego intentar sincronizar desde el servidor
    const url = isChannel
      ? `${API_BASE}/api/intranet/channels/${selected}/messages`
      : `${API_BASE}/api/intranet/chat/messages/${me.username}/${selected}`;
    fetch(url).then(r=>r.ok ? r.json() : Promise.reject()).then(msgs => {
      if (msgs && msgs.length > 0) {
        // Fusionar server + local, evitar duplicados por id
        const merged = [...msgs];
        const serverIds = new Set(msgs.map((m: Message) => m.id));
        cached.forEach(m => { if (!serverIds.has(m.id)) merged.push(m); });
        merged.sort((a,b) => a.ts - b.ts);
        setMessages(merged);
        lsSave(selected, merged);
        scrollToBottom();
      }
    }).catch(()=>{});
    if (!isChannel) {
      fetch(`${API_BASE}/api/intranet/chat/read`, { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ convId:[me.username,selected].sort().join("__"), userId:me.username }) }).catch(()=>{});
      setUnread(u => { const n={...u}; delete n[selected]; return n; });
    }
  }, [selected, isChannel, me.username]);

  // Cargar no leídos
  useEffect(() => {
    fetch(`${API_BASE}/api/intranet/chat/unread/${me.username}`).then(r=>r.json()).then(setUnread).catch(()=>{});
  }, [me.username]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior:"smooth" }), 80);
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  async function sendMessage() {
    if (!text.trim() || !selected) return;
    const body = isChannel
      ? { from: me.username, text }
      : { from: me.username, to: selected, text };
    const url = isChannel ? `${API_BASE}/api/intranet/channels/${selected}/messages` : `${API_BASE}/api/intranet/chat/messages`;
    const localMsg: Message = { id: Date.now().toString(), from: me.username, to: selected||undefined, channelId: isChannel ? selected||undefined : undefined, text: text.trim(), ts: Date.now() };
    // Mostrar inmediatamente
    setMessages(prev => {
      const updated = [...prev, localMsg];
      lsSave(selected, updated);
      return updated;
    });
    setText("");
    scrollToBottom();
    // Enviar al servidor en background
    fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) }).catch(()=>{});
  }

  const [contactSearch, setContactSearch] = useState("");
  const otherUsers = users.filter(u => u.username !== me.username);
  const selUser = users.find(u => u.username === selected);
  const selChannel = channels.find(c => c.id === selected);
  const selColor = isChannel ? (selChannel?.color || "#2bbfae") : (GER_COLORS[selUser?.gerencia||""] || "#888");

  // Filtrar y agrupar contactos por gerencia
  const filteredContacts = otherUsers.filter(u => {
    if (!contactSearch.trim()) return true;
    const q = contactSearch.toLowerCase();
    return (u.nombre||"").toLowerCase().includes(q) || (u.cargo||"").toLowerCase().includes(q) || (GER_NAMES[u.gerencia]||"").toLowerCase().includes(q);
  });
  const contactGroups: Record<string, any[]> = {};
  const gerOrder = ["root","comercializacion","operaciones","finanzas","compras","retail","it","proyectos","staff"];
  filteredContacts.forEach(u => {
    const g = u.gerencia || "otros";
    if (!contactGroups[g]) contactGroups[g] = [];
    contactGroups[g].push(u);
  });

  return (
    <div style={{ display:"flex", height:"100%", overflow:"hidden" }}>
      {/* Sidebar lista */}
      <div className="list-sidebar" style={{ width:260, display:"flex", flexDirection:"column", flexShrink:0 }}>
        {/* Búsqueda */}
        {!isChannel && (
          <div style={{ padding:"10px 10px 6px" }}>
            <input value={contactSearch} onChange={e=>setContactSearch(e.target.value)}
              placeholder="Buscar contacto..." className="chat-input"
              style={{ width:"100%", fontSize:12, padding:"7px 12px", borderRadius:20, border:"1.5px solid #e0e7ef", background:"#fff", fontFamily:"inherit", outline:"none", boxSizing:"border-box" as any }} />
          </div>
        )}
        <div style={{ padding: isChannel ? "12px 14px 8px" : "4px 14px 6px", fontSize:11, fontWeight:700, textTransform:"uppercase" as any, letterSpacing:".06em", color:"var(--muted-foreground)" }}>
          {isChannel ? "Canales" : `Contactos (${filteredContacts.length})`}
        </div>
        <div style={{ overflowY:"auto", flex:1 }}>
        {isChannel ? channels.map((item: any) => {
          const id = item.id;
          const color = item.color;
          return (
            <div key={id} onClick={() => setSelected(id)}
              className={selected===id ? 'list-item list-item-active' : 'list-item'}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 14px", cursor:"pointer", borderRadius:10, margin:"2px 8px" }}>
              <div style={{ width:32, height:32, borderRadius:8, background:color, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:14, fontWeight:700, flexShrink:0 }}>#</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:selected===id?700:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.name}</div>
                <div style={{ fontSize:11, color:"var(--muted-foreground)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.desc}</div>
              </div>
            </div>
          );
        }) : (
          // Contactos agrupados por gerencia
          (contactSearch.trim() ? ["sin_grupo"] : gerOrder).map(gKey => {
            const groupUsers = contactSearch.trim() ? filteredContacts : (contactGroups[gKey] || []);
            if (!groupUsers.length) return null;
            const gColor = GER_COLORS[gKey] || "#888";
            const gName = GER_NAMES[gKey] || gKey;
            return (
              <div key={gKey}>
                {!contactSearch.trim() && (
                  <div style={{ padding:"8px 14px 3px", fontSize:10, fontWeight:800, textTransform:"uppercase" as any, letterSpacing:".07em", color:gColor, display:"flex", alignItems:"center", gap:5 }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", background:gColor, flexShrink:0 }} />
                    {gName}
                  </div>
                )}
                {groupUsers.map((u: any) => {
                  const id = u.username;
                  const name = u.nombre || u.cargo || id;
                  const unreadCount = unread[id]||0;
                  return (
                    <div key={id} onClick={() => setSelected(id)}
                      className={selected===id ? 'list-item list-item-active' : 'list-item'}
                      style={{ display:"flex", alignItems:"center", gap:9, padding:"7px 14px", cursor:"pointer", borderRadius:10, margin:"1px 8px" }}>
                      <Avatar user={u} size={30} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12.5, fontWeight:selected===id?700:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          {name || <span style={{color:"var(--muted-foreground)",fontStyle:"italic"}}>Sin nombre</span>}
                        </div>
                        <div style={{ fontSize:10.5, color:"var(--muted-foreground)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{u.cargo}</div>
                      </div>
                      {unreadCount > 0 && <div style={{ background:"#ef4444", color:"#fff", borderRadius:10, padding:"1px 6px", fontSize:10, fontWeight:700, flexShrink:0 }}>{unreadCount}</div>}
                      {!(u as any).hasAccount && <div style={{ width:6, height:6, borderRadius:"50%", background:"#dde3f0", flexShrink:0 }} title="Sin cuenta de acceso" />}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
        </div>
      </div>

      {/* Área de mensajes */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
        {selected ? (<>
          {/* Header */}
          <div style={{ padding:"10px 16px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:10, background:"var(--card)" }}>
            {isChannel
              ? <div style={{ width:36, height:36, borderRadius:10, background:selColor, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:16, fontWeight:700 }}>#</div>
              : <Avatar user={selUser} size={36} />}
            <div>
              <div style={{ fontWeight:700, fontSize:14 }}>{isChannel ? selChannel?.name : (selUser?.nombre||selected)}</div>
              <div style={{ fontSize:11, color:"var(--muted-foreground)" }}>{isChannel ? selChannel?.desc : selUser?.cargo}</div>
            </div>
          </div>
          {/* Mensajes */}
          <div style={{ flex:1, overflowY:"auto", padding:"12px 16px", display:"flex", flexDirection:"column", gap:2 }}>
            {messages.map(m => {
              const isMe = m.from === me.username;
              const sender = users.find(u=>u.username===m.from);
              return (
                <div key={m.id} style={{ display:"flex", flexDirection: isMe?"row-reverse":"row", gap:8, alignItems:"flex-end", margin:"2px 0" }}>
                  {!isMe && !isChannel && <Avatar user={sender} size={26} />}
                  {isChannel && !isMe && <Avatar user={sender} size={26} />}
                  <div style={{ maxWidth:"68%" }}>
                    {isChannel && !isMe && <div style={{ fontSize:10, fontWeight:700, color:GER_COLORS[sender?.gerencia||""]||"#888", marginBottom:2, marginLeft:4 }}>{sender?.nombre||m.from}</div>}
                    <div className={isMe ? 'msg-me' : 'msg-other'}
                      style={{ padding:"8px 12px", borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                      fontSize:13.5, lineHeight:1.45 }}>
                      {m.text}
                    </div>
                    <div style={{ fontSize:10, color:"var(--muted-foreground)", textAlign: isMe?"right":"left", marginTop:2, paddingInline:4 }}>{fmtTime(m.ts)}</div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          {/* Input */}
          <div className="chat-input-wrap" style={{ padding:"12px 16px", display:"flex", gap:8 }}>
            <input value={text} onChange={e=>setText(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();} }}
              placeholder={`Mensaje${isChannel?" en #"+selChannel?.name:""}`}
              className="chat-input"
              style={{ flex:1, padding:"10px 18px", borderRadius:24, border:"1.5px solid #e0e7ef",
                background:"#f7f9fc", fontSize:13.5, fontFamily:"inherit", outline:"none" }} />
            <button onClick={sendMessage}
              style={{ padding:"9px 18px", borderRadius:22, border:"none", background:selColor,
                color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>Enviar</button>
          </div>
        </>) : (
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:8, color:"var(--muted-foreground)" }}>
            <div style={{ fontSize:32 }}>{isChannel?"#":"💬"}</div>
            <div style={{ fontSize:14 }}>Selecciona un {isChannel?"canal":"contacto"}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// PROJECT MANAGER — rediseño estilo ProjectManager.com
// ══════════════════════════════════════════════════════════════════

/* ── Estilos PM inyectados ── */
const PM_STYLES = `
.pm-root { display:flex; height:100%; overflow:hidden; background:#f4f5f7; font-family:inherit; }

/* Sidebar de proyectos */
.pm-sidebar { width:230px; background:#1c2b36; display:flex; flex-direction:column; overflow-y:auto; flex-shrink:0; }
.pm-sidebar-logo { padding:16px 16px 10px; display:flex; align-items:center; gap:9px; border-bottom:1px solid rgba(255,255,255,.08); }
.pm-sidebar-logo-icon { width:32px; height:32px; border-radius:50%; background:#00b8b0; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:13px; color:#fff; flex-shrink:0; }
.pm-sidebar-logo-text { color:#fff; font-weight:700; font-size:13px; }
.pm-sidebar-section { padding:16px 14px 6px; font-size:10px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:rgba(255,255,255,.4); }
.pm-sidebar-item { display:flex; align-items:center; gap:10px; padding:8px 14px; cursor:pointer; color:rgba(255,255,255,.75); font-size:13px; border-radius:0; transition:background .12s; }
.pm-sidebar-item:hover { background:rgba(255,255,255,.07); }
.pm-sidebar-item.active { background:rgba(0,184,176,.18); color:#00b8b0; font-weight:600; border-left:3px solid #00b8b0; }
.pm-sidebar-item-icon { width:20px; text-align:center; font-size:14px; flex-shrink:0; }
.pm-sidebar-item-badge { margin-left:auto; background:rgba(255,255,255,.15); border-radius:10px; padding:1px 7px; font-size:10px; color:rgba(255,255,255,.6); }
.pm-sidebar-proj-dot { width:10px; height:10px; border-radius:3px; flex-shrink:0; }
.pm-sidebar-footer { margin-top:auto; padding:12px 14px; border-top:1px solid rgba(255,255,255,.08); display:flex; align-items:center; gap:9px; color:rgba(255,255,255,.65); font-size:12px; }

/* Área principal */
.pm-main { flex:1; display:flex; flex-direction:column; overflow:hidden; }

/* Header del proyecto */
.pm-header { background:#fff; border-bottom:1px solid #e2e5ea; padding:0 20px; display:flex; align-items:center; gap:0; flex-shrink:0; height:48px; }
.pm-header-title { font-weight:700; font-size:15px; color:#1c2b36; margin-right:12px; }
.pm-header-avatar { width:28px; height:28px; border-radius:50%; background:#00b8b0; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; color:#fff; margin-right:12px; flex-shrink:0; }
.pm-view-tabs { display:flex; gap:0; }
.pm-view-tab { padding:0 14px; height:48px; display:flex; align-items:center; font-size:12px; color:#6b7a99; cursor:pointer; border-bottom:2px solid transparent; white-space:nowrap; transition:color .12s; }
.pm-view-tab:hover { color:#1c2b36; }
.pm-view-tab.active { color:#00b8b0; border-bottom-color:#00b8b0; font-weight:600; }
.pm-header-actions { margin-left:auto; display:flex; align-items:center; gap:8px; }
.pm-btn-primary { padding:6px 14px; border-radius:6px; border:none; background:#00b8b0; color:#fff; font-weight:600; font-size:12px; cursor:pointer; transition:background .12s; white-space:nowrap; }
.pm-btn-primary:hover { background:#009990; }
.pm-btn-ghost { padding:6px 10px; border-radius:6px; border:1.5px solid #e2e5ea; background:transparent; color:#6b7a99; font-size:12px; cursor:pointer; }
.pm-btn-ghost:hover { background:#f4f5f7; }
.pm-btn-danger { padding:6px 10px; border-radius:6px; border:1.5px solid #ef4444; background:transparent; color:#ef4444; font-size:12px; cursor:pointer; }

/* Vista lista */
.pm-list-wrap { flex:1; overflow-y:auto; background:#fff; }
.pm-list-table { width:100%; border-collapse:collapse; }
.pm-list-th { padding:10px 14px; text-align:left; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#9aa3ae; border-bottom:1.5px solid #e2e5ea; background:#fff; position:sticky; top:0; white-space:nowrap; }
.pm-list-tr { border-bottom:1px solid #f0f1f3; transition:background .1s; cursor:pointer; }
.pm-list-tr:hover { background:#f8f9fb; }
.pm-list-td { padding:10px 14px; font-size:13px; color:#2d3748; vertical-align:middle; }
.pm-list-check { width:18px; height:18px; border:1.5px solid #c8cfd8; border-radius:4px; cursor:pointer; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; }
.pm-list-check.done { background:#00b8b0; border-color:#00b8b0; color:#fff; font-size:11px; }
.pm-list-task-name { font-size:13px; color:#1c2b36; font-weight:500; }
.pm-list-task-name.done { text-decoration:line-through; color:#9aa3ae; }
.pm-add-row td { padding:8px 14px; }
.pm-add-input { border:none; outline:none; font-size:13px; color:#9aa3ae; width:100%; background:transparent; font-family:inherit; }
.pm-add-input::placeholder { color:#b0b8c4; }
.pm-status-pill { display:inline-block; padding:3px 9px; border-radius:4px; font-size:11px; font-weight:600; }
.pm-priority-flag { display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; }

/* Vista kanban */
.pm-kanban-wrap { flex:1; overflow-x:auto; overflow-y:hidden; padding:16px; display:flex; gap:14px; align-items:flex-start; background:#f4f5f7; }
.pm-kanban-col { width:260px; flex-shrink:0; display:flex; flex-direction:column; }
.pm-kanban-col-header { display:flex; align-items:center; gap:8px; padding:8px 4px; margin-bottom:8px; }
.pm-kanban-col-title { font-size:13px; font-weight:700; color:#1c2b36; }
.pm-kanban-col-count { background:#e2e5ea; border-radius:10px; padding:1px 8px; font-size:11px; color:#6b7a99; font-weight:600; }
.pm-kanban-col-menu { margin-left:auto; color:#b0b8c4; cursor:pointer; font-size:16px; }
.pm-kanban-cards { flex:1; overflow-y:auto; min-height:60px; }
.pm-kanban-card { background:#fff; border-radius:8px; padding:12px 13px; margin-bottom:8px; cursor:pointer; border:1px solid #e8ecf0; transition:box-shadow .15s, transform .1s; }
.pm-kanban-card:hover { box-shadow:0 3px 12px rgba(0,0,0,.09); transform:translateY(-1px); }
.pm-kanban-card-title { font-size:13px; font-weight:500; color:#1c2b36; margin-bottom:8px; line-height:1.4; }
.pm-kanban-card-footer { display:flex; align-items:center; justify-content:space-between; }
.pm-kanban-add { display:flex; align-items:center; gap:6px; padding:8px 4px; color:#9aa3ae; font-size:12.5px; cursor:pointer; border-radius:6px; transition:color .12s; }
.pm-kanban-add:hover { color:#00b8b0; }

/* Panel de detalle de tarea */
.pm-detail-overlay { position:absolute; inset:0; z-index:500; display:flex; }
.pm-detail-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.18); }
.pm-detail-panel { position:absolute; right:0; top:0; bottom:0; width:560px; max-width:90%; background:#fff; display:flex; flex-direction:column; box-shadow:-4px 0 24px rgba(0,0,0,.12); z-index:1; }
.pm-detail-header { padding:14px 18px; border-bottom:1px solid #e8ecf0; display:flex; align-items:center; gap:10px; flex-shrink:0; }
.pm-detail-breadcrumb { font-size:11px; color:#9aa3ae; }
.pm-detail-header-actions { margin-left:auto; display:flex; align-items:center; gap:8px; }
.pm-detail-body { display:flex; flex:1; overflow:hidden; }
.pm-detail-main { flex:1; overflow-y:auto; padding:18px 20px; }
.pm-detail-title { font-size:18px; font-weight:700; color:#1c2b36; margin-bottom:14px; line-height:1.3; }
.pm-detail-meta { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px; }
.pm-detail-chip { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:20px; font-size:11.5px; background:#f4f5f7; color:#4a5568; border:1px solid #e2e5ea; cursor:pointer; }
.pm-detail-chip:hover { background:#edf2f7; }
.pm-detail-section-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:#9aa3ae; margin-bottom:8px; }
.pm-detail-desc { font-size:13px; color:#4a5568; line-height:1.6; }
.pm-detail-comments { width:200px; flex-shrink:0; background:#f8f9fb; border-left:1px solid #e8ecf0; display:flex; flex-direction:column; padding:14px 14px 10px; }
.pm-detail-comment-list { flex:1; overflow-y:auto; }
.pm-detail-comment-item { margin-bottom:12px; }
.pm-detail-comment-meta { font-size:10.5px; font-weight:600; color:#4a5568; margin-bottom:2px; }
.pm-detail-comment-text { font-size:12px; color:#2d3748; line-height:1.45; }
.pm-detail-comment-input { display:flex; gap:6px; margin-top:8px; border-top:1px solid #e8ecf0; padding-top:10px; }
.pm-detail-input { flex:1; border:1.5px solid #e2e5ea; border-radius:6px; padding:6px 9px; font-size:12px; outline:none; font-family:inherit; resize:none; background:#fff; }
.pm-detail-input:focus { border-color:#00b8b0; }

/* Modal nuevo proyecto/tarea */
.pm-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9000; display:flex; align-items:center; justify-content:center; }
.pm-modal { background:#fff; border-radius:12px; padding:24px; width:100%; max-width:440px; max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,.25); }
.pm-modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
.pm-modal-title { font-size:16px; font-weight:700; color:#1c2b36; }
.pm-modal-close { background:none; border:none; font-size:22px; cursor:pointer; color:#9aa3ae; line-height:1; }
.pm-field { margin-bottom:14px; }
.pm-field label { display:block; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#9aa3ae; margin-bottom:5px; }
.pm-inp { width:100%; padding:8px 11px; border-radius:7px; border:1.5px solid #e2e5ea; font-size:13px; font-family:inherit; outline:none; box-sizing:border-box; background:#fff; color:#1c2b36; }
.pm-inp:focus { border-color:#00b8b0; }

/* Mis tareas */
.pm-mytasks { flex:1; overflow-y:auto; padding:24px; background:#f4f5f7; }
.pm-mytask-row { background:#fff; border:1px solid #e8ecf0; border-radius:9px; padding:12px 16px; margin-bottom:8px; cursor:pointer; display:flex; align-items:center; gap:12px; transition:box-shadow .12s; }
.pm-mytask-row:hover { box-shadow:0 2px 10px rgba(0,0,0,.07); }

/* Lista de proyectos (portada) */
.pm-projlist { flex:1; overflow-y:auto; padding:24px; background:#f4f5f7; }
.pm-projlist-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
.pm-projlist-title { font-size:18px; font-weight:700; color:#1c2b36; }
.pm-projlist-table { background:#fff; border-radius:10px; overflow:hidden; border:1px solid #e2e5ea; }
.pm-projlist-th { padding:11px 18px; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#9aa3ae; background:#fafbfc; border-bottom:1.5px solid #e2e5ea; }
.pm-projlist-tr { border-bottom:1px solid #f0f2f4; cursor:pointer; transition:background .1s; }
.pm-projlist-tr:hover { background:#f8f9fb; }
.pm-projlist-tr:last-child { border-bottom:none; }
.pm-projlist-td { padding:13px 18px; font-size:13px; color:#2d3748; vertical-align:middle; }
.pm-progress-bar { height:6px; border-radius:3px; background:#e8ecf0; overflow:hidden; width:120px; }
.pm-progress-fill { height:100%; border-radius:3px; background:#00b8b0; transition:width .3s; }
`;

function PMStyles() {
  return <style>{PM_STYLES}</style>;
}

function PMStatusPill({ status }: { status: string }) {
  const cfg = STATUS_COLS.find(s => s.id === status);
  const bg = (cfg?.color || "#888") + "20";
  return (
    <span className="pm-status-pill" style={{ background: bg, color: cfg?.color || "#888" }}>
      {cfg?.label || status}
    </span>
  );
}

function PMPriorityFlag({ priority }: { priority: string }) {
  const cfg = PRIORITY_CFG[priority];
  if (!priority || priority === "ninguno") return <span style={{ fontSize: 11, color: "#b0b8c4" }}>—</span>;
  return (
    <span className="pm-priority-flag" style={{ color: cfg?.color || "#888" }}>
      <span style={{ fontSize: 13 }}>⚑</span> {cfg?.label || priority}
    </span>
  );
}

function PMAvatar({ user, size = 28 }: { user: User | undefined; size?: number }) {
  const g = user?.gerencia || "general";
  const bg = GER_COLORS[g] || "#00b8b0";
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
      {initials(user?.nombre || user?.username || "?")}
    </div>
  );
}

function ProjectManager({ me, users }: { me: User; users: User[] }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProj, setSelectedProj] = useState<Project | null>(null);
  const [view, setView] = useState<"list" | "board">("list");
  const [showNewProj, setShowNewProj] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [section, setSection] = useState<"projects" | "mytasks">("projects");
  const [dragTask, setDragTask] = useState<{ task: Task; projId: string } | null>(null);
  const [inlineTask, setInlineTask] = useState("");

  // New project form
  const [npName, setNpName] = useState(""); const [npDesc, setNpDesc] = useState(""); const [npColor, setNpColor] = useState("#00b8b0");
  // New task form
  const [ntTitle, setNtTitle] = useState(""); const [ntDesc, setNtDesc] = useState("");
  const [ntAssignee, setNtAssignee] = useState(""); const [ntPriority, setNtPriority] = useState("media");
  const [ntDue, setNtDue] = useState(""); const [ntStatus, setNtStatus] = useState("pendiente");

  function localId() { return "local_" + Date.now().toString(36); }

  // ── Helper: actualiza estado + localStorage + intenta sync con servidor ──
  function updateProjects(updater: (prev: Project[]) => Project[]) {
    setProjects(prev => {
      const next = updater(prev);
      lsSaveProjects(next);
      return next;
    });
  }

  const loadProjects = useCallback(async () => {
    // 1. Cargar desde localStorage inmediatamente
    const local = lsLoadProjects();
    if (local.length > 0) {
      setProjects(local);
      if (selectedProj) setSelectedProj(local.find((p: Project) => p.id === selectedProj.id) || null);
    }
    // 2. Intentar sincronizar con servidor en background
    try {
      const data = await fetch(`${API_BASE}/api/intranet/projects`).then(r => r.ok ? r.json() : Promise.reject()).catch(() => null);
      if (data && Array.isArray(data) && data.length > 0) {
        // Merge: servidor gana sobre localStorage si tiene datos
        setProjects(data);
        lsSaveProjects(data);
        if (selectedProj) setSelectedProj(data.find((p: Project) => p.id === selectedProj.id) || null);
      } else if (local.length > 0) {
        // Si servidor está vacío pero localStorage tiene datos, empujar al servidor
        for (const proj of local) {
          fetch(`${API_BASE}/api/intranet/projects`, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: proj.name, desc: proj.desc, color: proj.color, owner: proj.owner, members: proj.members }) }).catch(() => {});
        }
      }
    } catch {}
  }, [selectedProj]);

  useEffect(() => { loadProjects(); }, []);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/intranet/sse/${me.username}`);
    es.onmessage = (e) => {
      try { const { event } = JSON.parse(e.data); if (["task_assigned", "task_updated"].includes(event)) loadProjects(); } catch {}
    };
    return () => es.close();
  }, [me.username, loadProjects]);

  async function createProject() {
    if (!npName.trim()) return;
    const newProj: Project = { id: lsNextId(), name: npName.trim(), desc: npDesc, color: npColor, owner: me.username, members: [], tasks: [], createdAt: Date.now() };
    updateProjects(prev => [...prev, newProj]);
    setNpName(""); setNpDesc(""); setNpColor("#00b8b0"); setShowNewProj(false);
    // Sync servidor en background
    fetch(`${API_BASE}/api/intranet/projects`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProj.name, desc: newProj.desc, color: newProj.color, owner: me.username, members: [] }) }).catch(() => {});
  }

  async function createTask() {
    if (!ntTitle.trim() || !selectedProj) return;
    const newTask: Task = { id: lsNextId(), title: ntTitle.trim(), desc: ntDesc, assignee: ntAssignee || null, priority: ntPriority, startDate: null, dueDate: ntDue || null, duration: null, status: ntStatus, percent: 0, hoursEstimated: null, hoursActual: 0, labels: [], checklist: [], subtasks: [], createdAt: Date.now(), comments: [] };
    updateProjects(prev => prev.map(p => p.id === selectedProj.id ? { ...p, tasks: [...(p.tasks || []), newTask] } : p));
    setSelectedProj(prev => prev ? { ...prev, tasks: [...(prev.tasks || []), newTask] } : prev);
    setNtTitle(""); setNtDesc(""); setNtAssignee(""); setNtPriority("media"); setNtDue(""); setNtStatus("pendiente"); setShowNewTask(false);
    fetch(`${API_BASE}/api/intranet/projects/${selectedProj.id}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTask.title, desc: newTask.desc, assignee: newTask.assignee, priority: newTask.priority, startDate: newTask.startDate, dueDate: newTask.dueDate, duration: newTask.duration, status: newTask.status, percent: newTask.percent, hoursEstimated: newTask.hoursEstimated, labels: newTask.labels, checklist: newTask.checklist, subtasks: newTask.subtasks }) }).catch(() => {});
  }

  async function createInlineTask(status: string) {
    if (!inlineTask.trim() || !selectedProj) return;
    const title = inlineTask.trim();
    setInlineTask("");
    const newTask: Task = { id: lsNextId(), title, desc: "", assignee: null, priority: "media", startDate: null, dueDate: null, duration: null, status, percent: 0, hoursEstimated: null, hoursActual: 0, labels: [], checklist: [], subtasks: [], createdAt: Date.now(), comments: [] };
    updateProjects(prev => prev.map(p => p.id === selectedProj.id ? { ...p, tasks: [...(p.tasks || []), newTask] } : p));
    setSelectedProj(prev => prev ? { ...prev, tasks: [...(prev.tasks || []), newTask] } : prev);
    fetch(`${API_BASE}/api/intranet/projects/${selectedProj.id}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, status }) }).catch(() => {});
  }

  async function moveTask(taskId: string, projId: string, newStatus: string) {
    updateProjects(prev => prev.map(p => p.id === projId ? { ...p, tasks: (p.tasks || []).map(t => t.id === taskId ? { ...t, status: newStatus } : t) } : p));
    if (selectedProj?.id === projId) setSelectedProj(prev => prev ? { ...prev, tasks: (prev.tasks || []).map(t => t.id === taskId ? { ...t, status: newStatus } : t) } : prev);
    fetch(`${API_BASE}/api/intranet/projects/${projId}/tasks/${taskId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) }).catch(() => {});
  }

  async function toggleDone(taskId: string, projId: string, current: string) {
    const newStatus = current === "completado" ? "pendiente" : "completado";
    moveTask(taskId, projId, newStatus);
  }

  async function deleteTask(taskId: string, projId: string) {
    if (!confirm("¿Eliminar esta tarea?")) return;
    updateProjects(prev => prev.map(p => p.id === projId ? { ...p, tasks: (p.tasks || []).filter(t => t.id !== taskId) } : p));
    if (selectedProj?.id === projId) setSelectedProj(prev => prev ? { ...prev, tasks: (prev.tasks || []).filter(t => t.id !== taskId) } : prev);
    setSelectedTask(null);
    fetch(`${API_BASE}/api/intranet/projects/${projId}/tasks/${taskId}`, { method: "DELETE" }).catch(() => {});
  }

  async function deleteProject(projId: string) {
    if (!confirm("¿Eliminar este proyecto y todas sus tareas?")) return;
    updateProjects(prev => prev.filter(p => p.id !== projId));
    setSelectedProj(null); setSection("projects");
    fetch(`${API_BASE}/api/intranet/projects/${projId}`, { method: "DELETE" }).catch(() => {});
  }

  const proj = selectedProj;
  const tasks = proj?.tasks || [];
  const myTasks = projects.flatMap(p => (p.tasks || []).filter(t => t.assignee === me.username).map(t => ({ ...t, projName: p.name, projColor: p.color, projId: p.id })));
  const totalDone = tasks.filter(t => t.status === "completado").length;
  const progress = tasks.length ? Math.round((totalDone / tasks.length) * 100) : 0;

  return (
    <div className="pm-root">
      <PMStyles />

      {/* ── Sidebar ── */}
      <div className="pm-sidebar">
        <div className="pm-sidebar-logo">
          <div className="pm-sidebar-logo-icon">PM</div>
          <span className="pm-sidebar-logo-text">Proyectos</span>
        </div>

        <div className="pm-sidebar-section">Principal</div>
        <div className={`pm-sidebar-item ${section === "mytasks" && !selectedProj ? "active" : ""}`}
          onClick={() => { setSection("mytasks"); setSelectedProj(null); }}>
          <span className="pm-sidebar-item-icon">☑️</span>
          <span>Mis tareas</span>
          {myTasks.filter(t => t.status !== "completado").length > 0 &&
            <span className="pm-sidebar-item-badge">{myTasks.filter(t => t.status !== "completado").length}</span>}
        </div>

        <div className="pm-sidebar-section" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: 10 }}>
          <span>Portafolio</span>
          {(me.role === "admin" || me.role === "editor") &&
            <span onClick={() => setShowNewProj(true)} style={{ cursor: "pointer", color: "rgba(255,255,255,.5)", fontSize: 16, fontWeight: 300, lineHeight: 1 }}>+</span>}
        </div>

        {projects.map(p => {
          const pDone = (p.tasks || []).filter(t => t.status === "completado").length;
          const pTotal = (p.tasks || []).length;
          return (
            <div key={p.id} className={`pm-sidebar-item ${selectedProj?.id === p.id ? "active" : ""}`}
              onClick={() => { setSelectedProj(p); setSection("projects"); }}>
              <div className="pm-sidebar-proj-dot" style={{ background: p.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }}>{p.name}</div>
              </div>
              <span className="pm-sidebar-item-badge">{pTotal}</span>
            </div>
          );
        })}

        {projects.length === 0 && (
          <div style={{ padding: "12px 16px", fontSize: 11.5, color: "rgba(255,255,255,.3)", lineHeight: 1.5 }}>
            Sin proyectos aún.{(me.role === "admin" || me.role === "editor") && <><br />Usa + para crear uno.</>}
          </div>
        )}

        <div className="pm-sidebar-footer">
          <PMAvatar user={users.find(u => u.username === me.username) || { username: me.username, nombre: me.username, cargo: "", gerencia: "general", role: me.role, cargoId: "" }} size={28} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me.username}</span>
        </div>
      </div>

      {/* ── Área principal ── */}
      <div className="pm-main" style={{ position: "relative" }}>

        {/* Vista mis tareas */}
        {section === "mytasks" && !selectedProj && (
          <>
            <div className="pm-header">
              <span className="pm-header-title">☑️ Mis tareas</span>
            </div>
            <div className="pm-mytasks">
              {myTasks.length === 0
                ? <div style={{ color: "#9aa3ae", fontSize: 13, textAlign: "center", marginTop: 60 }}>No tienes tareas asignadas.</div>
                : myTasks.map(t => {
                  const done = t.status === "completado";
                  return (
                    <div key={t.id} className="pm-mytask-row"
                      onClick={() => { setSelectedProj(projects.find(p => p.id === t.projId) || null); setSelectedTask(t); setSection("projects"); }}>
                      <div style={{ width: 4, height: 36, borderRadius: 2, background: (t as any).projColor, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, color: done ? "#9aa3ae" : "#1c2b36", textDecoration: done ? "line-through" : "none" }}>{t.title}</div>
                        <div style={{ fontSize: 11, color: "#9aa3ae" }}>{(t as any).projName}</div>
                      </div>
                      <PMStatusPill status={t.status} />
                      <PMPriorityFlag priority={t.priority} />
                    </div>
                  );
                })}
            </div>
          </>
        )}

        {/* Vista lista de todos los proyectos */}
        {section === "projects" && !selectedProj && (
          <>
            <div className="pm-header">
              <span className="pm-header-title">📁 Todos los proyectos</span>
              <div className="pm-header-actions">
                {(me.role === "admin" || me.role === "editor") &&
                  <button className="pm-btn-primary" onClick={() => setShowNewProj(true)}>+ Nuevo proyecto</button>}
              </div>
            </div>
            <div className="pm-projlist">
              {projects.length === 0
                ? <div style={{ color: "#9aa3ae", fontSize: 13, textAlign: "center", marginTop: 60 }}>
                    Sin proyectos.{(me.role === "admin" || me.role === "editor") && " Crea el primero con el botón de arriba."}
                  </div>
                : <div className="pm-projlist-table">
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th className="pm-projlist-th">Nombre</th>
                          <th className="pm-projlist-th">Progreso</th>
                          <th className="pm-projlist-th">Gerente</th>
                          <th className="pm-projlist-th">Tareas</th>
                          <th className="pm-projlist-th">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map(p => {
                          const pDone = (p.tasks || []).filter(t => t.status === "completado").length;
                          const pTotal = (p.tasks || []).length;
                          const pProgress = pTotal ? Math.round((pDone / pTotal) * 100) : 0;
                          const owner = users.find(u => u.username === p.owner);
                          return (
                            <tr key={p.id} className="pm-projlist-tr" onClick={() => { setSelectedProj(p); setView("list"); }}>
                              <td className="pm-projlist-td">
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                                </div>
                              </td>
                              <td className="pm-projlist-td">
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div className="pm-progress-bar"><div className="pm-progress-fill" style={{ width: pProgress + "%" }} /></div>
                                  <span style={{ fontSize: 11, color: "#9aa3ae" }}>{pProgress}%</span>
                                </div>
                              </td>
                              <td className="pm-projlist-td">
                                {owner ? <div style={{ display: "flex", alignItems: "center", gap: 7 }}><PMAvatar user={owner} size={24} /><span style={{ fontSize: 12 }}>{owner.nombre || owner.username}</span></div>
                                  : <span style={{ color: "#9aa3ae", fontSize: 12 }}>—</span>}
                              </td>
                              <td className="pm-projlist-td"><span style={{ fontSize: 12 }}>{pDone}/{pTotal}</span></td>
                              <td className="pm-projlist-td">
                                <span style={{ fontSize: 11, color: pProgress === 100 ? "#22c55e" : pProgress > 0 ? "#4a7fd4" : "#9aa3ae", fontWeight: 600 }}>
                                  {pProgress === 100 ? "Completado" : pProgress > 0 ? "En progreso" : "Por iniciar"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>}
            </div>
          </>
        )}

        {/* Vista de proyecto seleccionado */}
        {selectedProj && (
          <>
            {/* Header */}
            <div className="pm-header">
              <div className="pm-header-avatar" style={{ background: proj!.color }}>
                {proj!.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="pm-header-title">{proj!.name}</span>
              <div className="pm-view-tabs">
                <div className={`pm-view-tab ${view === "list" ? "active" : ""}`} onClick={() => setView("list")}>≡ Lista</div>
                <div className={`pm-view-tab ${view === "board" ? "active" : ""}`} onClick={() => setView("board")}>⊞ Tablero</div>
              </div>
              <div className="pm-header-actions">
                {/* Barra de progreso compacta */}
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div className="pm-progress-bar" style={{ width: 80 }}><div className="pm-progress-fill" style={{ width: progress + "%" }} /></div>
                  <span style={{ fontSize: 11, color: "#9aa3ae" }}>{progress}%</span>
                </div>
                {(me.role === "admin" || me.role === "editor") && <>
                  <button className="pm-btn-primary" onClick={() => setShowNewTask(true)}>+ Tarea</button>
                  <button className="pm-btn-danger" onClick={() => deleteProject(proj!.id)}>🗑</button>
                </>}
              </div>
            </div>

            {/* Vista Lista */}
            {view === "list" && (
              <div className="pm-list-wrap">
                <table className="pm-list-table">
                  <thead>
                    <tr>
                      <th className="pm-list-th" style={{ width: 36 }}></th>
                      <th className="pm-list-th">Nombre de la tarea</th>
                      <th className="pm-list-th">Encargado</th>
                      <th className="pm-list-th">Estado</th>
                      <th className="pm-list-th">Prioridad</th>
                      <th className="pm-list-th">Pendiente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(t => {
                      const assignee = users.find(u => u.username === t.assignee);
                      const done = t.status === "completado";
                      return (
                        <tr key={t.id} className="pm-list-tr" onClick={() => setSelectedTask(t)}>
                          <td className="pm-list-td" onClick={e => { e.stopPropagation(); toggleDone(t.id, proj!.id, t.status); }}>
                            <div className={`pm-list-check ${done ? "done" : ""}`}>{done ? "✓" : ""}</div>
                          </td>
                          <td className="pm-list-td">
                            <span className={`pm-list-task-name ${done ? "done" : ""}`}>{t.title}</span>
                          </td>
                          <td className="pm-list-td">
                            {assignee
                              ? <div style={{ display: "flex", alignItems: "center", gap: 7 }}><PMAvatar user={assignee} size={24} /><span style={{ fontSize: 12 }}>{assignee.nombre || assignee.username}</span></div>
                              : <span style={{ color: "#b0b8c4", fontSize: 12 }}>—</span>}
                          </td>
                          <td className="pm-list-td"><PMStatusPill status={t.status} /></td>
                          <td className="pm-list-td"><PMPriorityFlag priority={t.priority} /></td>
                          <td className="pm-list-td"><span style={{ fontSize: 12, color: t.dueDate ? "#4a5568" : "#b0b8c4" }}>{t.dueDate || "—"}</span></td>
                        </tr>
                      );
                    })}
                    {tasks.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: "30px 14px", textAlign: "center", color: "#b0b8c4", fontSize: 13 }}>Sin tareas. Agrega la primera con "+ Tarea".</td></tr>
                    )}
                    {/* Fila inline add */}
                    {(me.role === "admin" || me.role === "editor") && (
                      <tr className="pm-add-row">
                        <td><div className="pm-list-check" /></td>
                        <td colSpan={5}>
                          <input className="pm-add-input" placeholder="Introduzca un nuevo nombre de tarea"
                            value={inlineTask} onChange={e => setInlineTask(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") createInlineTask("pendiente"); }} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Vista Kanban */}
            {view === "board" && (
              <div className="pm-kanban-wrap">
                {STATUS_COLS.map(col => {
                  const colTasks = tasks.filter(t => t.status === col.id);
                  return (
                    <div key={col.id} className="pm-kanban-col"
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => { if (dragTask) moveTask(dragTask.task.id, dragTask.projId, col.id); setDragTask(null); }}>
                      <div className="pm-kanban-col-header">
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: col.color, flexShrink: 0 }} />
                        <span className="pm-kanban-col-title">{col.label}</span>
                        <span className="pm-kanban-col-count">{colTasks.length}</span>
                        <span className="pm-kanban-col-menu">···</span>
                      </div>
                      <div className="pm-kanban-cards">
                        {colTasks.map(t => {
                          const assignee = users.find(u => u.username === t.assignee);
                          return (
                            <div key={t.id} className="pm-kanban-card" draggable
                              onDragStart={() => setDragTask({ task: t, projId: proj!.id })}
                              onClick={() => setSelectedTask(t)}>
                              <div className="pm-kanban-card-title">{t.title}</div>
                              <div className="pm-kanban-card-footer">
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  {assignee && <PMAvatar user={assignee} size={22} />}
                                  <PMPriorityFlag priority={t.priority} />
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  {t.dueDate && <span style={{ fontSize: 10.5, color: "#9aa3ae" }}>{t.dueDate}</span>}
                                  {(t.comments?.length || 0) > 0 && <span style={{ fontSize: 10.5, color: "#9aa3ae" }}>💬 {t.comments.length}</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {(me.role === "admin" || me.role === "editor") && (
                        <div className="pm-kanban-add" onClick={() => { setNtStatus(col.id); setShowNewTask(true); }}>
                          <span style={{ fontSize: 16, fontWeight: 300 }}>+</span> Agregar una tarea
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Panel de detalle de tarea */}
            {selectedTask && proj && (
              <PMTaskDetail
                task={selectedTask} proj={proj} users={users} me={me}
                onClose={() => setSelectedTask(null)}
                onMove={(s) => { moveTask(selectedTask.id, proj.id, s); setSelectedTask({ ...selectedTask, status: s }); }}
                onDelete={() => deleteTask(selectedTask.id, proj.id)}
                onReload={loadProjects}
              />
            )}
          </>
        )}
      </div>

      {/* Modal nuevo proyecto */}
      {showNewProj && (
        <div className="pm-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowNewProj(false); }}>
          <div className="pm-modal">
            <div className="pm-modal-header">
              <span className="pm-modal-title">Nuevo proyecto</span>
              <button className="pm-modal-close" onClick={() => setShowNewProj(false)}>×</button>
            </div>
            <div className="pm-field"><label>Nombre</label><input className="pm-inp" value={npName} onChange={e => setNpName(e.target.value)} placeholder="Nombre del proyecto" /></div>
            <div className="pm-field"><label>Descripción</label><input className="pm-inp" value={npDesc} onChange={e => setNpDesc(e.target.value)} placeholder="Descripción opcional" /></div>
            <div className="pm-field">
              <label>Color</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["#00b8b0", "#4a7fd4", "#3cb371", "#e8a020", "#dd6874", "#a06ad4", "#5b8ff9", "#f0a050"].map(c => (
                  <div key={c} onClick={() => setNpColor(c)} style={{ width: 28, height: 28, borderRadius: 7, background: c, cursor: "pointer", outline: npColor === c ? "3px solid #1c2b36" : "none", outlineOffset: 2 }} />
                ))}
              </div>
            </div>
            <button className="pm-btn-primary" style={{ width: "100%", marginTop: 4, padding: "10px", fontSize: 13, borderRadius: 8, background: npColor }} onClick={createProject}>Crear proyecto</button>
          </div>
        </div>
      )}

      {/* Modal nueva tarea */}
      {showNewTask && (
        <div className="pm-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowNewTask(false); }}>
          <div className="pm-modal">
            <div className="pm-modal-header">
              <span className="pm-modal-title">Nueva tarea</span>
              <button className="pm-modal-close" onClick={() => setShowNewTask(false)}>×</button>
            </div>
            <div className="pm-field"><label>Título</label><input className="pm-inp" value={ntTitle} onChange={e => setNtTitle(e.target.value)} placeholder="Título de la tarea" /></div>
            <div className="pm-field"><label>Descripción</label><textarea className="pm-inp" value={ntDesc} onChange={e => setNtDesc(e.target.value)} rows={2} placeholder="Descripción opcional" style={{ resize: "vertical" }} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="pm-field"><label>Asignar a</label>
                <select className="pm-inp" value={ntAssignee} onChange={e => setNtAssignee(e.target.value)}>
                  <option value="">Sin asignar</option>
                  {users.map(u => <option key={u.username} value={u.username}>{u.nombre || u.username}</option>)}
                </select>
              </div>
              <div className="pm-field"><label>Prioridad</label>
                <select className="pm-inp" value={ntPriority} onChange={e => setNtPriority(e.target.value)}>
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                </select>
              </div>
              <div className="pm-field"><label>Estado inicial</label>
                <select className="pm-inp" value={ntStatus} onChange={e => setNtStatus(e.target.value)}>
                  {STATUS_COLS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="pm-field"><label>Fecha límite</label><input type="date" className="pm-inp" value={ntDue} onChange={e => setNtDue(e.target.value)} /></div>
            </div>
            <button className="pm-btn-primary" style={{ width: "100%", marginTop: 4, padding: "10px", fontSize: 13, borderRadius: 8 }} onClick={createTask}>Crear tarea</button>
          </div>
        </div>
      )}
    </div>
  );
}


function PMTaskDetail({ task, proj, users, me, onClose, onMove, onDelete, onReload }: any) {
  const [comment, setComment] = useState("");
  const [localTask, setLocalTask] = useState<Task>({
    startDate: null, duration: null, percent: 0,
    hoursEstimated: null, hoursActual: 0,
    labels: [], checklist: [], subtasks: [],
    ...task
  });
  const [newCheckItem, setNewCheckItem] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(localTask.desc || "");
  const assignee = users.find((u: User) => u.username === localTask.assignee);

  // Guardar campo en servidor
  async function saveField(patch: Partial<Task>) {
    const updated = { ...localTask, ...patch };
    setLocalTask(updated);
    // Guardar en localStorage inmediatamente
    const projects = lsLoadProjects();
    const pi = projects.findIndex((p: Project) => p.id === proj.id);
    if (pi !== -1) {
      const ti = (projects[pi].tasks || []).findIndex((t: Task) => t.id === localTask.id);
      if (ti !== -1) {
        projects[pi].tasks[ti] = { ...projects[pi].tasks[ti], ...patch };
        lsSaveProjects(projects);
      }
    }
    // Sync servidor en background
    fetch(`${API_BASE}/api/intranet/projects/${proj.id}/tasks/${localTask.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }).catch(() => {});
    onReload();
  }

  async function addComment() {
    if (!comment.trim()) return;
    await fetch(`${API_BASE}/api/intranet/projects/${proj.id}/tasks/${localTask.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: me.username, text: comment })
    });
    setComment(""); onReload();
    const projs = await fetch(`${API_BASE}/api/intranet/projects`).then(r => r.json()).catch(() => []);
    const p = projs.find((p: Project) => p.id === proj.id);
    const t = p?.tasks?.find((t: Task) => t.id === localTask.id);
    if (t) setLocalTask({ startDate: null, duration: null, percent: 0, hoursEstimated: null, hoursActual: 0, labels: [], checklist: [], subtasks: [], ...t });
  }

  function addCheckItem() {
    if (!newCheckItem.trim()) return;
    const item: CheckItem = { id: "ci_" + Date.now().toString(36), text: newCheckItem.trim(), done: false };
    const updated = [...(localTask.checklist || []), item];
    setNewCheckItem("");
    saveField({ checklist: updated });
  }

  function toggleCheckItem(id: string) {
    const updated = (localTask.checklist || []).map((c: CheckItem) => c.id === id ? { ...c, done: !c.done } : c);
    saveField({ checklist: updated });
  }

  function removeCheckItem(id: string) {
    const updated = (localTask.checklist || []).filter((c: CheckItem) => c.id !== id);
    saveField({ checklist: updated });
  }

  function addSubtask() {
    if (!newSubtask.trim()) return;
    const sub: SubTask = { id: "st_" + Date.now().toString(36), title: newSubtask.trim(), status: "pendiente", assignee: null };
    const updated = [...(localTask.subtasks || []), sub];
    setNewSubtask("");
    saveField({ subtasks: updated });
  }

  function toggleSubtask(id: string) {
    const updated = (localTask.subtasks || []).map((s: SubTask) => s.id === id ? { ...s, status: s.status === "completado" ? "pendiente" : "completado" } : s);
    saveField({ subtasks: updated });
  }

  function removeSubtask(id: string) {
    const updated = (localTask.subtasks || []).filter((s: SubTask) => s.id !== id);
    saveField({ subtasks: updated });
  }

  function addLabel() {
    if (!newLabel.trim()) return;
    const updated = [...new Set([...(localTask.labels || []), newLabel.trim()])];
    setNewLabel("");
    saveField({ labels: updated });
  }

  function removeLabel(lbl: string) {
    saveField({ labels: (localTask.labels || []).filter((l: string) => l !== lbl) });
  }

  const checkDone = (localTask.checklist || []).filter((c: CheckItem) => c.done).length;
  const checkTotal = (localTask.checklist || []).length;
  const subDone = (localTask.subtasks || []).filter((s: SubTask) => s.status === "completado").length;
  const subTotal = (localTask.subtasks || []).length;

  const LABEL_COLORS: Record<string, string> = {
    urgente: "#ef4444", revisión: "#f59e0b", diseño: "#a06ad4",
    desarrollo: "#4a7fd4", cliente: "#3cb371", interno: "#6b7a99"
  };

  return (
    <div className="pm-detail-overlay">
      <div className="pm-detail-backdrop" onClick={onClose} />
      <div className="pm-detail-panel" style={{ width: 680 }}>

        {/* Header */}
        <div className="pm-detail-header">
          <div style={{ width: 10, height: 10, borderRadius: 3, background: proj.color, flexShrink: 0 }} />
          <span className="pm-detail-breadcrumb">{proj.name}</span>
          <div className="pm-detail-header-actions">
            {(me.role === "admin" || me.role === "editor") &&
              <button className="pm-btn-danger" style={{ fontSize: 11 }} onClick={onDelete}>Eliminar</button>}
            <button style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9aa3ae", lineHeight: 1 }} onClick={onClose}>×</button>
          </div>
        </div>

        <div className="pm-detail-body" style={{ overflow: "hidden" }}>
          {/* Main scrollable */}
          <div className="pm-detail-main" style={{ flex: 1, overflowY: "auto" }}>

            {/* Título */}
            <div className="pm-detail-title">{localTask.title}</div>

            {/* Chips de metadatos — fila 1 */}
            <div className="pm-detail-meta" style={{ marginBottom: 10 }}>
              {/* % Avance */}
              <div className="pm-detail-chip" style={{ gap: 6, minWidth: 80 }}>
                <span style={{ fontSize: 10 }}>⊙</span>
                <input
                  type="number" min={0} max={100}
                  value={localTask.percent || 0}
                  onChange={e => saveField({ percent: Math.min(100, Math.max(0, Number(e.target.value))) })}
                  style={{ width: 38, border: "none", background: "transparent", fontSize: 11.5, outline: "none", fontFamily: "inherit", color: "#4a5568" }}
                />
                <span style={{ fontSize: 10.5, color: "#9aa3ae" }}>%</span>
              </div>

              {/* Horas */}
              <div className="pm-detail-chip" style={{ gap: 5 }}>
                <span style={{ fontSize: 10, color: "#22c55e" }}>●</span>
                <input
                  type="number" min={0}
                  value={localTask.hoursActual || 0}
                  onChange={e => saveField({ hoursActual: Number(e.target.value) })}
                  style={{ width: 28, border: "none", background: "transparent", fontSize: 11.5, outline: "none", fontFamily: "inherit", color: "#4a5568" }}
                />
                <span style={{ fontSize: 10.5, color: "#9aa3ae" }}>/</span>
                <input
                  type="number" min={0}
                  value={localTask.hoursEstimated || 0}
                  onChange={e => saveField({ hoursEstimated: Number(e.target.value) })}
                  style={{ width: 28, border: "none", background: "transparent", fontSize: 11.5, outline: "none", fontFamily: "inherit", color: "#4a5568" }}
                />
                <span style={{ fontSize: 10.5, color: "#9aa3ae" }}>h</span>
              </div>

              {/* Fecha límite */}
              <div className="pm-detail-chip">
                <span style={{ fontSize: 10.5 }}>📅</span>
                <input type="date"
                  value={localTask.dueDate || ""}
                  onChange={e => saveField({ dueDate: e.target.value || null })}
                  style={{ border: "none", background: "transparent", fontSize: 11.5, outline: "none", fontFamily: "inherit", color: localTask.dueDate ? "#4a5568" : "#b0b8c4", cursor: "pointer" }}
                />
              </div>

              {/* Duración */}
              <div className="pm-detail-chip" style={{ gap: 5 }}>
                <span style={{ fontSize: 10.5 }}>⏱</span>
                <input
                  type="number" min={0}
                  value={localTask.duration || ""}
                  placeholder="días"
                  onChange={e => saveField({ duration: e.target.value ? Number(e.target.value) : null })}
                  style={{ width: 36, border: "none", background: "transparent", fontSize: 11.5, outline: "none", fontFamily: "inherit", color: "#4a5568" }}
                />
                <span style={{ fontSize: 10.5, color: "#9aa3ae" }}>días</span>
              </div>

              {/* Prioridad */}
              <div className="pm-detail-chip" style={{ padding: "4px 6px" }}>
                <select value={localTask.priority}
                  onChange={e => saveField({ priority: e.target.value })}
                  style={{ border: "none", background: "transparent", fontSize: 11.5, outline: "none", fontFamily: "inherit", color: PRIORITY_CFG[localTask.priority]?.color || "#9aa3ae", cursor: "pointer", fontWeight: 600 }}>
                  <option value="baja">⚑ Baja</option>
                  <option value="media">⚑ Media</option>
                  <option value="alta">⚑ Alta</option>
                </select>
              </div>

              {/* Estado */}
              <div className="pm-detail-chip" style={{ padding: "4px 6px" }}>
                <select value={localTask.status}
                  onChange={e => { saveField({ status: e.target.value }); onMove(e.target.value); }}
                  style={{ border: "none", background: "transparent", fontSize: 11.5, outline: "none", fontFamily: "inherit", color: STATUS_COLS.find(s => s.id === localTask.status)?.color || "#9aa3ae", cursor: "pointer", fontWeight: 600 }}>
                  {STATUS_COLS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {/* Barra de progreso */}
            <div style={{ marginBottom: 18 }}>
              <div className="pm-progress-bar" style={{ width: "100%", height: 8 }}>
                <div className="pm-progress-fill" style={{ width: (localTask.percent || 0) + "%", transition: "width .3s" }} />
              </div>
            </div>

            {/* Fechas inicio / fin */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 18 }}>
              <div>
                <div className="pm-detail-section-label">Inicio planificado</div>
                <input type="date" className="pm-inp" style={{ fontSize: 12 }}
                  value={localTask.startDate || ""}
                  onChange={e => saveField({ startDate: e.target.value || null })} />
              </div>
              <div>
                <div className="pm-detail-section-label">Fecha límite</div>
                <input type="date" className="pm-inp" style={{ fontSize: 12 }}
                  value={localTask.dueDate || ""}
                  onChange={e => saveField({ dueDate: e.target.value || null })} />
              </div>
              <div>
                <div className="pm-detail-section-label">Encargado</div>
                <select className="pm-inp" style={{ fontSize: 12 }}
                  value={localTask.assignee || ""}
                  onChange={e => saveField({ assignee: e.target.value || null })}>
                  <option value="">Sin asignar</option>
                  {users.map((u: User) => <option key={u.username} value={u.username}>{u.nombre || u.username}</option>)}
                </select>
              </div>
            </div>

            {/* Descripción */}
            <div style={{ marginBottom: 18 }}>
              <div className="pm-detail-section-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Descripción</span>
                {!editingDesc && <span style={{ fontSize: 10, color: "#00b8b0", cursor: "pointer", fontWeight: 600 }} onClick={() => { setEditingDesc(true); setDescDraft(localTask.desc || ""); }}>Editar</span>}
              </div>
              {editingDesc ? (
                <div>
                  <textarea className="pm-inp" rows={3} value={descDraft} onChange={e => setDescDraft(e.target.value)}
                    style={{ resize: "vertical", fontSize: 13 }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button className="pm-btn-primary" style={{ fontSize: 11, padding: "5px 12px" }} onClick={() => { saveField({ desc: descDraft }); setEditingDesc(false); }}>Guardar</button>
                    <button className="pm-btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={() => setEditingDesc(false)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="pm-detail-desc" onClick={() => { setEditingDesc(true); setDescDraft(localTask.desc || ""); }}
                  style={{ cursor: "text", minHeight: 36, padding: "8px 10px", borderRadius: 7, border: "1.5px dashed #e2e5ea" }}>
                  {localTask.desc || <span style={{ color: "#b0b8c4" }}>Agregar descripción...</span>}
                </div>
              )}
            </div>

            {/* Etiquetas */}
            <div style={{ marginBottom: 18 }}>
              <div className="pm-detail-section-label">Etiquetas</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {(localTask.labels || []).map((lbl: string) => (
                  <span key={lbl} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: (LABEL_COLORS[lbl] || "#6b7a99") + "20", color: LABEL_COLORS[lbl] || "#6b7a99", border: "1px solid " + (LABEL_COLORS[lbl] || "#6b7a99") + "40" }}>
                    {lbl}
                    <span style={{ cursor: "pointer", fontSize: 13, lineHeight: 1, opacity: .7 }} onClick={() => removeLabel(lbl)}>×</span>
                  </span>
                ))}
                <div style={{ display: "flex", gap: 5 }}>
                  <input className="pm-inp" style={{ width: 110, fontSize: 11, padding: "3px 8px", height: 26 }}
                    value={newLabel} onChange={e => setNewLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addLabel(); }}
                    placeholder="+ Etiqueta" />
                  {newLabel && <button className="pm-btn-primary" style={{ fontSize: 11, padding: "3px 10px" }} onClick={addLabel}>+</button>}
                </div>
              </div>
            </div>

            {/* Checklist */}
            <div style={{ marginBottom: 18 }}>
              <div className="pm-detail-section-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Lista de tareas</span>
                {checkTotal > 0 && <span style={{ fontSize: 10, color: "#9aa3ae" }}>{checkDone}/{checkTotal}</span>}
              </div>
              {checkTotal > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div className="pm-progress-bar" style={{ height: 5, marginBottom: 8 }}>
                    <div className="pm-progress-fill" style={{ width: (checkTotal ? Math.round(checkDone / checkTotal * 100) : 0) + "%" }} />
                  </div>
                </div>
              )}
              {(localTask.checklist || []).map((item: CheckItem) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", borderBottom: "1px solid #f0f2f4" }}>
                  <div className={`pm-list-check ${item.done ? "done" : ""}`} style={{ cursor: "pointer" }} onClick={() => toggleCheckItem(item.id)}>
                    {item.done ? "✓" : ""}
                  </div>
                  <span style={{ flex: 1, fontSize: 13, color: item.done ? "#9aa3ae" : "#2d3748", textDecoration: item.done ? "line-through" : "none" }}>{item.text}</span>
                  <span style={{ cursor: "pointer", color: "#b0b8c4", fontSize: 15 }} onClick={() => removeCheckItem(item.id)}>×</span>
                </div>
              ))}
              <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                <input className="pm-inp" style={{ fontSize: 12 }} placeholder="Agregar tarea pendiente..."
                  value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addCheckItem(); }} />
                {newCheckItem && <button className="pm-btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={addCheckItem}>+</button>}
              </div>
            </div>

            {/* Subtareas */}
            <div style={{ marginBottom: 18 }}>
              <div className="pm-detail-section-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Subtareas</span>
                {subTotal > 0 && <span style={{ fontSize: 10, color: "#9aa3ae" }}>{subDone}/{subTotal}</span>}
              </div>
              {(localTask.subtasks || []).map((sub: SubTask) => {
                const done = sub.status === "completado";
                return (
                  <div key={sub.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", borderBottom: "1px solid #f0f2f4" }}>
                    <div className={`pm-list-check ${done ? "done" : ""}`} style={{ cursor: "pointer" }} onClick={() => toggleSubtask(sub.id)}>
                      {done ? "✓" : ""}
                    </div>
                    <span style={{ flex: 1, fontSize: 13, color: done ? "#9aa3ae" : "#2d3748", textDecoration: done ? "line-through" : "none" }}>{sub.title}</span>
                    <PMStatusPill status={sub.status} />
                    <span style={{ cursor: "pointer", color: "#b0b8c4", fontSize: 15 }} onClick={() => removeSubtask(sub.id)}>×</span>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                <input className="pm-inp" style={{ fontSize: 12 }} placeholder="Agregar subtarea..."
                  value={newSubtask} onChange={e => setNewSubtask(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addSubtask(); }} />
                {newSubtask && <button className="pm-btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={addSubtask}>+</button>}
              </div>
            </div>

          </div>

          {/* Panel comentarios */}
          <div className="pm-detail-comments" style={{ width: 220 }}>
            <div style={{ fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#9aa3ae", marginBottom: 12 }}>Comentarios</div>
            <div className="pm-detail-comment-list">
              {(localTask.comments || []).length === 0
                ? <div style={{ fontSize: 11.5, color: "#b0b8c4", textAlign: "center", marginTop: 20 }}>Sin comentarios</div>
                : (localTask.comments || []).map((c: Comment) => {
                  const cu = users.find((u: User) => u.username === c.from);
                  return (
                    <div key={c.id} className="pm-detail-comment-item">
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <PMAvatar user={cu} size={20} />
                        <div>
                          <div className="pm-detail-comment-meta">{cu?.nombre || c.from}</div>
                          <div style={{ fontSize: 9.5, color: "#b0b8c4" }}>{fmtTime(c.ts)}</div>
                        </div>
                      </div>
                      <div className="pm-detail-comment-text">{c.text}</div>
                    </div>
                  );
                })}
            </div>
            <div className="pm-detail-comment-input">
              <textarea className="pm-detail-input" rows={2} value={comment} onChange={e => setComment(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addComment(); } }}
                placeholder="Comentario..." />
            </div>
            <button className="pm-btn-primary" style={{ width: "100%", marginTop: 6, fontSize: 12, padding: "7px" }} onClick={addComment}>Enviar</button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════
// MAIN APP SHELL
// ══════════════════════════════════════════════════════════════════
export default function App() {
  const [me, setMe] = useState<User|null>(() => getAutoLoginUser());
  const [users, setUsers] = useState<User[]>([]);
  const [section, setSection] = useState<"direct"|"channels"|"projects">("direct");
  const [totalUnread, setTotalUnread] = useState(0);
  const [unreadChannels, setUnreadChannels] = useState<Record<string,number>>({});
  const [toast, setToast] = useState<{msg:string; from:string; color:string; section:string}|null>(null);

  useEffect(() => {
    if (!me) return;
    fetch(`${API_BASE}/api/intranet/auth/users`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setUsers)
      .catch(() => {
        // Fallback: construir lista desde datos inyectados en el HTML
        const portalUsers: Record<string,any> = (window as any).__PORTAL_USERS__ || {};
        const orgEmps: Record<string,any> = (window as any).__ORG_EMPLOYEES__ || {};
        const result: User[] = [];
        const seen = new Set<string>();
        // Mapa de employees para fusión de nombre
        const empMap: Record<string,any> = {};
        Object.values(orgEmps).forEach((e: any) => { empMap[e.id] = e; });
        // Primero usuarios con cuenta — nombre de employees tiene prioridad
        Object.values(portalUsers).forEach((u: any) => {
          if (u.username === me?.username) return;
          const { password: _, ...safe } = u;
          const empData = empMap[u.cargoId] || {};
          const nombre = (empData.nombre && empData.nombre.trim()) ? empData.nombre : (u.nombre || '');
          result.push({ ...safe, nombre, hasAccount: true } as any);
          seen.add(u.username);
          if (u.cargoId) seen.add(u.cargoId);
        });
        // Luego todos los empleados del organigrama
        Object.values(orgEmps).forEach((e: any) => {
          if (seen.has(e.id)) return;
          result.push({ username: e.id, nombre: e.nombre||'', cargo: e.cargo||'', cargoId: e.id, gerencia: e.gerencia||'', role: 'empleado', hasAccount: false } as any);
          seen.add(e.id);
        });
        setUsers(result);
      });
    // SSE global para notificaciones
    const es = new EventSource(`${API_BASE}/api/intranet/sse/${me.username}`);
    es.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        if (event === "new_message" && data.to === me.username) {
          setTotalUnread(n => n + 1);
          // Toast de notificación
          const sender = data.from;
          setToast({ msg: data.text?.slice(0,60) || "Nuevo mensaje", from: sender, color: "#1a3a6b", section: "direct" });
          setTimeout(() => setToast(null), 4000);
          // Título del navegador
          document.title = `💬 Nuevo mensaje — Intranet Copikon`;
          setTimeout(() => { document.title = "Intranet Copikon"; }, 5000);
        }
        if (event === "channel_message" && data.from !== me.username) {
          setUnreadChannels(u => ({ ...u, [data.channelId]: (u[data.channelId]||0)+1 }));
          setToast({ msg: data.text?.slice(0,60) || "Nuevo mensaje", from: `#${data.channelId}`, color: "#2bbfae", section: "channels" });
          setTimeout(() => setToast(null), 4000);
          document.title = `💬 Mensaje en canal — Intranet Copikon`;
          setTimeout(() => { document.title = "Intranet Copikon"; }, 5000);
        }
        if (event === "task_assigned") {
          setToast({ msg: `Nueva tarea: ${data.task?.title?.slice(0,40)}`, from: data.projectName || "Proyectos", color: "#dd6874", section: "projects" });
          setTimeout(() => setToast(null), 5000);
        }
      } catch {}
    };
    // Poll unread count
    const poll = setInterval(() => {
      fetch(`${API_BASE}/api/intranet/chat/unread/${me.username}`).then(r=>r.json()).then((u:Record<string,number>) => {
        setTotalUnread(Object.values(u).reduce((a,b)=>a+b,0));
      }).catch(()=>{});
    }, 8000);
    return () => { es.close(); clearInterval(poll); };
  }, [me]);

  if (!me) return <LoginScreen onLogin={(u)=>setMe(u)} />;

  const gerColor = GER_COLORS[me.gerencia] || "#888";

  const totalUnreadChannels = Object.values(unreadChannels).reduce((a,b)=>a+b,0);
  const NAV = [
    { id:"direct",   icon:"💬", label:"Mensajes",  badge: totalUnread },
    { id:"channels", icon:"#",  label:"Canales",   badge: totalUnreadChannels },
    { id:"projects", icon:"📋", label:"Proyectos", badge: 0 },
  ];
  // Limpiar unread del canal al entrar
  const handleSetSection = (s: string) => {
    setSection(s as any);
    if (s === "channels") setUnreadChannels({});
    if (s === "direct") setTotalUnread(0);
  };

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", fontFamily:"system-ui,sans-serif", background:"var(--background)", color:"var(--foreground)" }}>
      {/* Sidebar izquierdo nav */}
      <div className="app-sidebar" style={{ width:64, display:"flex", flexDirection:"column", alignItems:"center", padding:"14px 0", gap:4, flexShrink:0 }}>
        {/* Logo */}
        <div style={{ marginBottom:12 }}>
          <img src="./copikon-logo.jpg" style={{ width:36, height:36, borderRadius:8, objectFit:"cover" }} alt="Copikon" />
        </div>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>handleSetSection(n.id)} title={n.label}
            className={section===n.id ? 'nav-btn nav-btn-active' : 'nav-btn'}
            style={{ position:"relative", width:44, height:44, borderRadius:12, border:"none", cursor:"pointer",
              background: section===n.id ? "rgba(255,255,255,0.15)" : "transparent",
              color: section===n.id ? "#fff" : "rgba(255,255,255,0.7)",
              fontSize: n.id==="channels" ? 16 : 20, fontWeight:800,
              display:"flex", alignItems:"center", justifyContent:"center", transition:"all .15s" }}>
            {n.icon}
            {n.badge>0 && <div style={{ position:"absolute", top:4, right:4, width:16, height:16, borderRadius:"50%", background:"#ef4444", color:"#fff", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>{n.badge>9?"9+":n.badge}</div>}
          </button>
        ))}
        {/* Spacer + avatar usuario */}
        <div style={{ flex:1 }} />
        <div title={`${me.nombre||me.username}\n${me.cargo}`} style={{ cursor:"default" }}>
          <Avatar user={me} size={36} />
        </div>
        <button onClick={()=>setMe(null)} title="Cerrar sesión"
          style={{ width:44,height:44,borderRadius:12,border:"none",cursor:"pointer",background:"transparent",color:"rgba(255,255,255,0.6)",fontSize:18, display:"flex",alignItems:"center",justifyContent:"center" }}>
          ↩
        </button>
      </div>

      {/* Contenido principal */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* Top bar */}
        <div className="app-topbar" style={{ padding:"10px 20px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <div style={{ fontWeight:800, fontSize:15 }}>
            {section==="direct" && "Mensajes directos"}
            {section==="channels" && "Canales"}
            {section==="projects" && "Project Manager"}
          </div>
          <div style={{ flex:1 }} />
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <Avatar user={me} size={28} />
            <div>
              <div style={{ fontSize:12.5,fontWeight:700,lineHeight:1.2 }}>{me.nombre||me.username}</div>
              <div style={{ fontSize:10,color:"var(--muted-foreground)" }}>{me.cargo}</div>
            </div>
          </div>
        </div>

        {/* Secciones */}
        <div style={{ flex:1, overflow:"hidden" }}>
          {(section==="direct"||section==="channels") && <ChatPanel me={me} users={users} tab={section} />}
          {section==="projects" && <ProjectManager me={me} users={users} />}
        </div>
      </div>

      {/* Toast de notificación */}
      {toast && (
        <div onClick={()=>{ handleSetSection(toast.section); setToast(null); }}
          style={{ position:"fixed", bottom:20, right:20, zIndex:9999,
            background:"#1a2238", color:"#fff", borderRadius:14, padding:"12px 16px",
            maxWidth:320, boxShadow:"0 8px 30px rgba(0,0,0,0.4)", cursor:"pointer",
            display:"flex", alignItems:"flex-start", gap:10, animation:"slideIn .25s ease" }}>
          <div style={{ width:36, height:36, borderRadius:10, background:toast.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>
            {toast.section==="direct"?"💬":toast.section==="channels"?"#":"📋"}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.6)", marginBottom:2 }}>{toast.from}</div>
            <div style={{ fontSize:13, lineHeight:1.4, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" as any }}>{toast.msg}</div>
          </div>
          <button onClick={e=>{e.stopPropagation();setToast(null);}} style={{ background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:16,lineHeight:1,padding:0,flexShrink:0 }}>&times;</button>
        </div>
      )}

      {/* CSS helpers */}
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }

        /* Sidebar oscuro */
        .app-sidebar {
          background: linear-gradient(180deg, #0d1b35 0%, #1a3a6b 100%) !important;
          box-shadow: 2px 0 20px rgba(0,0,0,0.3) !important;
          border-right: none !important;
        }
        .nav-btn { transition: all .15s !important; }
        .nav-btn-active { background: rgba(255,255,255,0.15) !important; }
        .nav-btn:hover { background: rgba(255,255,255,0.1) !important; }

        /* Topbar */
        .app-topbar {
          background: #fff !important;
          border-bottom: 1px solid #e8edf5 !important;
          box-shadow: 0 1px 6px rgba(0,0,0,0.06) !important;
        }

        /* Sidebar de lista (contactos/canales) */
        .list-sidebar {
          background: #f7f9fc !important;
          border-right: 1px solid #e8edf5 !important;
        }
        .list-item { border-radius: 10px !important; margin: 2px 8px !important; transition: background .15s; }
        .list-item:hover { background: #eef2fa !important; }
        .list-item-active { background: #dce8ff !important; }

        /* Chat */
        .msg-me {
          background: linear-gradient(135deg, #1a3a6b, #2a5298) !important;
          color: #fff !important;
          box-shadow: 0 2px 8px rgba(26,58,107,0.3) !important;
        }
        .msg-other {
          background: #f0f4ff !important;
          color: #1a2238 !important;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06) !important;
        }
        .chat-input-wrap {
          background: #fff !important;
          border-top: 1px solid #e8edf5 !important;
          padding: 12px 16px !important;
        }
        .chat-input {
          background: #f7f9fc !important;
          border: 1.5px solid #e0e7ef !important;
          border-radius: 24px !important;
          padding: 10px 18px !important;
          transition: border-color .15s;
        }
        .chat-input:focus { border-color: #4a7fd4 !important; }

        /* Kanban */
        .kanban-col {
          background: #f4f7fb !important;
          border: 1px solid #e4eaf4 !important;
          border-radius: 14px !important;
        }
        .kanban-col-header { font-size: 11.5px !important; font-weight: 800 !important; letter-spacing: .05em !important; }
        .task-card {
          background: #fff !important;
          border: 1px solid #e8edf5 !important;
          border-radius: 12px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05) !important;
          transition: box-shadow .15s, transform .1s !important;
        }
        .task-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.1) !important; transform: translateY(-1px) !important; }

        /* Project sidebar */
        .proj-sidebar {
          background: #f7f9fc !important;
          border-right: 1px solid #e8edf5 !important;
        }

        /* General inputs */
        .inp {
          width:100%; padding:8px 12px; font-size:13px; font-family:inherit;
          outline:none; box-sizing:border-box;
          background: #f7f9fc !important;
          border: 1.5px solid #dde3f0 !important;
          border-radius: 9px !important;
          color: #1a2238 !important;
        }
        .inp:focus { border-color: #4a7fd4 !important; outline: none !important; }
        select.inp { cursor:pointer; }
        textarea.inp { resize:vertical; }

        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-thumb { background:#d0d8e8; border-radius:4px; }
        ::-webkit-scrollbar-thumb:hover { background:#b8c4d8; }
      `}</style>
    </div>
  );
}
