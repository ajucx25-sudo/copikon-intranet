import { useState, useEffect, useRef, useCallback } from "react";
// API_BASE: detecta si estamos en el proxy de Perplexity (sites.pplx.app)
// En ese caso, usa "port/5000" como prefijo que el proxy entiende
// En desarrollo local, usa "" (rutas relativas)
function detectApiBase(): string {
  // Desde query param (pasado por organigrama)
  const qs = new URLSearchParams(window.location.search);
  const fromParam = qs.get("apibase");
  if (fromParam && fromParam.length > 0) return fromParam;
  // Desde window.__INTRANET_API__ (inyectado en index.html)
  const fromWindow = (window as any).__INTRANET_API__ ?? "";
  if (fromWindow && !fromWindow.startsWith("__")) return fromWindow;
  // Detectar automáticamente si estamos en el proxy de Perplexity
  if (window.location.hostname === "sites.pplx.app") return "/port/5000";
  return "";
}
const API_BASE: string = detectApiBase();

import { apiRequest } from "./lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────
interface User { username: string; nombre: string; cargo: string; gerencia: string; role: string; cargoId: string; }
interface Message { id: string; from: string; to?: string; channelId?: string; convId?: string; text: string; ts: number; read?: boolean; }
interface Channel { id: string; name: string; gerencia: string; color: string; desc: string; }
interface Task { id: string; title: string; desc: string; assignee: string|null; priority: string; dueDate: string|null; status: string; createdAt: number; comments: Comment[]; }
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
        setMessages(prev => {
          if (isChannel ? data.channelId === selected : ([data.from,data.to].sort().join("__") === [me.username, selected].sort().join("__")))
            return [...prev, data];
          return prev;
        });
        if (!isChannel && data.to === me.username && data.from !== selected)
          setUnread(u => ({ ...u, [data.from]: (u[data.from]||0)+1 }));
      }
      if (event === "channel_message") {
        setMessages(prev => data.channelId === selected ? [...prev, data] : prev);
      }
    };
    return () => es.close();
  }, [me.username, selected, isChannel]);

  // Cargar mensajes al seleccionar
  useEffect(() => {
    if (!selected) return;
    setMessages([]);
    const url = isChannel
      ? `/api/intranet/channels/${selected}/messages`
      : `/api/intranet/chat/messages/${me.username}/${selected}`;
    fetch(url).then(r=>r.json()).then(msgs => { setMessages(msgs); scrollToBottom(); }).catch(()=>{});
    if (!isChannel) {
      fetch(`${API_BASE}/api/intranet/chat/read`, { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ convId:[me.username,selected].sort().join("__"), userId:me.username }) });
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
    const url = isChannel ? `/api/intranet/channels/${selected}/messages` : "/api/intranet/chat/messages";
    await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
    setText("");
  }

  const otherUsers = users.filter(u => u.username !== me.username);
  const selUser = users.find(u => u.username === selected);
  const selChannel = channels.find(c => c.id === selected);
  const selColor = isChannel ? (selChannel?.color || "#2bbfae") : (GER_COLORS[selUser?.gerencia||""] || "#888");

  return (
    <div style={{ display:"flex", height:"100%", overflow:"hidden" }}>
      {/* Sidebar lista */}
      <div className="list-sidebar" style={{ width:240, display:"flex", flexDirection:"column", flexShrink:0, overflowY:"auto" }}>
        <div style={{ padding:"12px 14px 8px", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:".06em", color:"var(--muted-foreground)" }}>
          {isChannel ? "Canales" : "Mensajes directos"}
        </div>
        {(isChannel ? channels : otherUsers).map((item: any) => {
          const id = isChannel ? item.id : item.username;
          const name = isChannel ? item.name : (item.nombre || item.username);
          const sub = isChannel ? item.desc : item.cargo;
          const color = isChannel ? item.color : (GER_COLORS[item.gerencia]||"#888");
          const unreadCount = !isChannel ? (unread[id]||0) : 0;
          return (
            <div key={id} onClick={() => setSelected(id)}
              className={selected===id ? 'list-item list-item-active' : 'list-item'}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 14px", cursor:"pointer",
                background: selected===id ? "#dce8ff" : "transparent",
                borderRadius:10, margin:"2px 8px" }}>
              {isChannel
                ? <div style={{ width:32, height:32, borderRadius:8, background:color, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:14, fontWeight:700, flexShrink:0 }}>#</div>
                : <Avatar user={item} size={32} />}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:selected===id?700:500, color:"var(--foreground)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{name}</div>
                <div style={{ fontSize:11, color:"var(--muted-foreground)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{sub}</div>
              </div>
              {unreadCount > 0 && <div style={{ background:"#ef4444", color:"#fff", borderRadius:10, padding:"1px 6px", fontSize:10, fontWeight:700, flexShrink:0 }}>{unreadCount}</div>}
            </div>
          );
        })}
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
// PROJECT MANAGER
// ══════════════════════════════════════════════════════════════════
function ProjectManager({ me, users }: { me: User; users: User[] }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProj, setSelectedProj] = useState<Project|null>(null);
  const [showNewProj, setShowNewProj] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task|null>(null);
  const [view, setView] = useState<"board"|"list">("board");
  const [dragTask, setDragTask] = useState<{task:Task;projId:string}|null>(null);

  // New project form
  const [npName, setNpName] = useState(""); const [npDesc, setNpDesc] = useState(""); const [npColor, setNpColor] = useState("#4a7fd4");
  // New task form
  const [ntTitle, setNtTitle] = useState(""); const [ntDesc, setNtDesc] = useState("");
  const [ntAssignee, setNtAssignee] = useState(""); const [ntPriority, setNtPriority] = useState("media");
  const [ntDue, setNtDue] = useState(""); const [ntStatus, setNtStatus] = useState("pendiente");

  const loadProjects = useCallback(async () => {
    const data = await fetch(`${API_BASE}/api/intranet/projects`).then(r=>r.json()).catch(()=>[]);
    setProjects(data);
    if (selectedProj) setSelectedProj(data.find((p:Project)=>p.id===selectedProj.id)||null);
  }, [selectedProj]);

  useEffect(() => { loadProjects(); }, []);

  // SSE para updates en tiempo real
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/intranet/sse/${me.username}`);
    es.onmessage = (e) => {
      const { event } = JSON.parse(e.data);
      if (["task_assigned","task_updated"].includes(event)) loadProjects();
    };
    return () => es.close();
  }, [me.username, loadProjects]);

  async function createProject() {
    if (!npName.trim()) return;
    await fetch(`${API_BASE}/api/intranet/projects`, { method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ name:npName, desc:npDesc, color:npColor, owner:me.username, members:[] }) });
    setNpName(""); setNpDesc(""); setNpColor("#4a7fd4"); setShowNewProj(false);
    loadProjects();
  }

  async function createTask() {
    if (!ntTitle.trim() || !selectedProj) return;
    await fetch(`${API_BASE}/api/intranet/projects/${selectedProj.id}/tasks`, { method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ title:ntTitle, desc:ntDesc, assignee:ntAssignee||null, priority:ntPriority, dueDate:ntDue||null, status:ntStatus }) });
    setNtTitle(""); setNtDesc(""); setNtAssignee(""); setNtPriority("media"); setNtDue(""); setNtStatus("pendiente");
    setShowNewTask(false); loadProjects();
  }

  async function moveTask(taskId: string, projId: string, newStatus: string) {
    await fetch(`${API_BASE}/api/intranet/projects/${projId}/tasks/${taskId}`, { method:"PUT", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ status:newStatus }) });
    loadProjects();
  }

  async function deleteTask(taskId: string, projId: string) {
    if (!confirm("¿Eliminar esta tarea?")) return;
    await fetch(`${API_BASE}/api/intranet/projects/${projId}/tasks/${taskId}`, { method:"DELETE" });
    setSelectedTask(null); loadProjects();
  }

  async function deleteProject(projId: string) {
    if (!confirm("¿Eliminar este proyecto y todas sus tareas?")) return;
    await fetch(`${API_BASE}/api/intranet/projects/${projId}`, { method:"DELETE" });
    setSelectedProj(null); loadProjects();
  }

  const proj = selectedProj;
  const tasks = proj?.tasks || [];
  const myTasks = projects.flatMap(p => (p.tasks||[]).filter(t=>t.assignee===me.username).map(t=>({...t,projName:p.name,projColor:p.color,projId:p.id})));

  return (
    <div style={{ display:"flex", height:"100%", overflow:"hidden" }}>
      {/* Sidebar proyectos */}
      <div className="proj-sidebar" style={{ width:220, display:"flex", flexDirection:"column", overflowY:"auto", flexShrink:0 }}>
        <div style={{ padding:"12px 14px 4px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:".06em", color:"var(--muted-foreground)" }}>Proyectos</span>
          {(me.role==="admin"||me.role==="editor") && (
            <button onClick={()=>setShowNewProj(true)} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted-foreground)", fontSize:18, lineHeight:1, padding:2 }}>+</button>
          )}
        </div>

        {/* Mis tareas */}
        <div onClick={()=>setSelectedProj(null)}
          style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", cursor:"pointer",
            background:!selectedProj?"var(--accent)":"transparent", borderRadius:8, margin:"2px 6px" }}>
          <div style={{ width:28, height:28, borderRadius:8, background:"#6b7a99", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>📋</div>
          <div>
            <div style={{ fontSize:12.5, fontWeight:600 }}>Mis tareas</div>
            <div style={{ fontSize:10, color:"var(--muted-foreground)" }}>{myTasks.filter(t=>t.status!=="completado").length} pendientes</div>
          </div>
        </div>

        <div style={{ padding:"6px 14px 4px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".06em", color:"var(--muted-foreground)", marginTop:4 }}>Todos los proyectos</div>
        {projects.map(p => (
          <div key={p.id} onClick={()=>setSelectedProj(p)}
            style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", cursor:"pointer",
              background:selectedProj?.id===p.id?"var(--accent)":"transparent", borderRadius:8, margin:"2px 6px" }}>
            <div style={{ width:28, height:28, borderRadius:8, background:p.color, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700, flexShrink:0 }}>
              {p.name.slice(0,2).toUpperCase()}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12.5, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.name}</div>
              <div style={{ fontSize:10, color:"var(--muted-foreground)" }}>{(p.tasks||[]).length} tareas</div>
            </div>
          </div>
        ))}
      </div>

      {/* Contenido principal */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {!selectedProj ? (
          // Vista "Mis tareas"
          <div style={{ flex:1, overflow:"auto", padding:20 }}>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:16 }}>Mis tareas asignadas</div>
            {myTasks.length === 0
              ? <div style={{ color:"var(--muted-foreground)", fontSize:13 }}>No tienes tareas asignadas.</div>
              : myTasks.map(t => (
                <div key={t.id} onClick={()=>{setSelectedProj(projects.find(p=>p.id===t.projId)||null); setSelectedTask(t);}}
                  style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, padding:"12px 14px", marginBottom:8,
                    cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:4, height:36, borderRadius:2, background:(t as any).projColor, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize:13 }}>{t.title}</div>
                    <div style={{ fontSize:11, color:"var(--muted-foreground)" }}>{(t as any).projName}</div>
                  </div>
                  <StatusBadge status={t.status} />
                  <PriorityDot priority={t.priority} />
                </div>
              ))}
          </div>
        ) : (<>
          {/* Header proyecto */}
          <div style={{ padding:"12px 20px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:12, background:"var(--card)", flexShrink:0 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:proj?.color, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:14 }}>
              {proj?.name.slice(0,2).toUpperCase()}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:16 }}>{proj?.name}</div>
              {proj?.desc && <div style={{ fontSize:12, color:"var(--muted-foreground)" }}>{proj.desc}</div>}
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={()=>setView("board")} style={{ padding:"5px 12px", borderRadius:8, border:"1.5px solid var(--border)", background:view==="board"?"var(--primary)":"transparent", color:view==="board"?"var(--primary-foreground)":"var(--foreground)", cursor:"pointer", fontSize:12, fontWeight:600 }}>Kanban</button>
              <button onClick={()=>setView("list")} style={{ padding:"5px 12px", borderRadius:8, border:"1.5px solid var(--border)", background:view==="list"?"var(--primary)":"transparent", color:view==="list"?"var(--primary-foreground)":"var(--foreground)", cursor:"pointer", fontSize:12, fontWeight:600 }}>Lista</button>
              {(me.role==="admin"||me.role==="editor") && <>
                <button onClick={()=>setShowNewTask(true)} style={{ padding:"5px 14px", borderRadius:8, border:"none", background:proj?.color||"#4a7fd4", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700 }}>+ Tarea</button>
                <button onClick={()=>deleteProject(proj!.id)} style={{ padding:"5px 10px", borderRadius:8, border:"1.5px solid #ef4444", background:"transparent", color:"#ef4444", cursor:"pointer", fontSize:12 }}>🗑</button>
              </>}
            </div>
          </div>

          {/* Kanban / Lista */}
          <div style={{ flex:1, overflow:"auto", padding:16 }}>
            {view==="board" ? (
              <div style={{ display:"flex", gap:14, height:"100%", alignItems:"flex-start" }}>
                {STATUS_COLS.map(col => {
                  const colTasks = tasks.filter(t=>t.status===col.id);
                  return (
                    <div key={col.id}
                      className="kanban-col"
                      style={{ width:240, flexShrink:0, borderRadius:14, padding:10, minHeight:120 }}
                      onDragOver={e=>e.preventDefault()}
                      onDrop={()=>{ if(dragTask) moveTask(dragTask.task.id, dragTask.projId, col.id); setDragTask(null); }}>
                      <div className="kanban-col-header" style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:col.color }} />
                        <span style={{ fontWeight:800, fontSize:11.5, letterSpacing:".05em" }}>{col.label}</span>
                        <span style={{ marginLeft:"auto", background:"var(--border)", borderRadius:10, padding:"1px 7px", fontSize:11, color:"var(--muted-foreground)" }}>{colTasks.length}</span>
                      </div>
                      {colTasks.map(t => (
                        <TaskCard key={t.id} task={t} projId={proj!.id} users={users} me={me}
                          onClick={()=>setSelectedTask(t)}
                          onDragStart={()=>setDragTask({task:t,projId:proj!.id})}
                          onMove={(newStatus)=>moveTask(t.id,proj!.id,newStatus)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>
                {STATUS_COLS.map(col => {
                  const colTasks = tasks.filter(t=>t.status===col.id);
                  if (!colTasks.length) return null;
                  return (
                    <div key={col.id} style={{ marginBottom:20 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                        <div style={{ width:8,height:8,borderRadius:"50%",background:col.color }} />
                        <span style={{ fontWeight:700, fontSize:12 }}>{col.label} ({colTasks.length})</span>
                      </div>
                      {colTasks.map(t=>(
                        <TaskRow key={t.id} task={t} users={users} onClick={()=>setSelectedTask(t)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>)}
      </div>

      {/* Modal nueva tarea */}
      {showNewTask && (
        <Modal onClose={()=>setShowNewTask(false)} title="Nueva tarea">
          <Field label="Título"><input value={ntTitle} onChange={e=>setNtTitle(e.target.value)} className="inp" placeholder="Título de la tarea" /></Field>
          <Field label="Descripción"><textarea value={ntDesc} onChange={e=>setNtDesc(e.target.value)} className="inp" rows={2} placeholder="Descripción opcional" style={{ resize:"vertical" }} /></Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <Field label="Asignar a">
              <select value={ntAssignee} onChange={e=>setNtAssignee(e.target.value)} className="inp">
                <option value="">Sin asignar</option>
                {users.map(u=><option key={u.username} value={u.username}>{u.nombre||u.username} — {u.cargo}</option>)}
              </select>
            </Field>
            <Field label="Prioridad">
              <select value={ntPriority} onChange={e=>setNtPriority(e.target.value)} className="inp">
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
              </select>
            </Field>
            <Field label="Estado inicial">
              <select value={ntStatus} onChange={e=>setNtStatus(e.target.value)} className="inp">
                {STATUS_COLS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Fecha límite"><input type="date" value={ntDue} onChange={e=>setNtDue(e.target.value)} className="inp" /></Field>
          </div>
          <button onClick={createTask} style={{ width:"100%", marginTop:14, padding:"10px", borderRadius:9, border:"none", background:"var(--primary)", color:"var(--primary-foreground)", fontWeight:700, cursor:"pointer", fontSize:13 }}>Crear tarea</button>
        </Modal>
      )}

      {/* Modal nuevo proyecto */}
      {showNewProj && (
        <Modal onClose={()=>setShowNewProj(false)} title="Nuevo proyecto">
          <Field label="Nombre"><input value={npName} onChange={e=>setNpName(e.target.value)} className="inp" placeholder="Nombre del proyecto" /></Field>
          <Field label="Descripción"><input value={npDesc} onChange={e=>setNpDesc(e.target.value)} className="inp" placeholder="Descripción opcional" /></Field>
          <Field label="Color">
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {["#4a7fd4","#3cb371","#e8a020","#dd6874","#a06ad4","#5b8ff9","#f0a050","#1a3a6b"].map(c=>(
                <div key={c} onClick={()=>setNpColor(c)} style={{ width:28,height:28,borderRadius:8,background:c,cursor:"pointer", outline: npColor===c?"3px solid var(--foreground)":"none", outlineOffset:2 }} />
              ))}
            </div>
          </Field>
          <button onClick={createProject} style={{ width:"100%", marginTop:14, padding:"10px", borderRadius:9, border:"none", background:npColor, color:"#fff", fontWeight:700, cursor:"pointer", fontSize:13 }}>Crear proyecto</button>
        </Modal>
      )}

      {/* Task detail modal */}
      {selectedTask && proj && (
        <TaskDetailModal task={selectedTask} proj={proj} users={users} me={me}
          onClose={()=>setSelectedTask(null)}
          onMove={(s)=>{moveTask(selectedTask.id,proj.id,s); setSelectedTask({...selectedTask,status:s});}}
          onDelete={()=>deleteTask(selectedTask.id,proj.id)}
          onReload={loadProjects} />
      )}
    </div>
  );
}

// ── Small components ───────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_COLS.find(s=>s.id===status);
  return <span style={{ padding:"2px 8px", borderRadius:10, fontSize:10, fontWeight:700, background:cfg?.color+"22", color:cfg?.color }}>{cfg?.label||status}</span>;
}
function PriorityDot({ priority }: { priority: string }) {
  const cfg = PRIORITY_CFG[priority];
  return <div style={{ width:8,height:8,borderRadius:"50%",background:cfg?.color||"#888",flexShrink:0 }} title={cfg?.label} />;
}
function Field({ label, children }: { label:string; children:React.ReactNode }) {
  return <div style={{ marginBottom:10 }}>
    <label style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--muted-foreground)",display:"block",marginBottom:4 }}>{label}</label>
    {children}
  </div>;
}
function Modal({ onClose, title, children }: { onClose:()=>void; title:string; children:React.ReactNode }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center" }} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{ background:"var(--card)",borderRadius:16,padding:24,width:"100%",maxWidth:440,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.3)" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18 }}>
          <div style={{ fontWeight:800,fontSize:16 }}>{title}</div>
          <button onClick={onClose} style={{ background:"none",border:"none",fontSize:22,cursor:"pointer",color:"var(--muted-foreground)",lineHeight:1 }}>&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TaskCard({ task, projId, users, me, onClick, onDragStart, onMove }: any) {
  const assignee = users.find((u:User)=>u.username===task.assignee);
  return (
    <div draggable onDragStart={onDragStart} onClick={onClick}
      className="task-card"
      style={{ padding:"10px 12px",marginBottom:8,
        cursor:"pointer" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6,marginBottom:6 }}>
        <div style={{ fontWeight:600,fontSize:13,lineHeight:1.35 }}>{task.title}</div>
        <PriorityDot priority={task.priority} />
      </div>
      {task.desc && <div style={{ fontSize:11,color:"var(--muted-foreground)",marginBottom:6,lineHeight:1.4,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical" }}>{task.desc}</div>}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:4 }}>
        {assignee ? <Avatar user={assignee} size={22} /> : <div />}
        {task.dueDate && <div style={{ fontSize:10,color:"var(--muted-foreground)" }}>📅 {task.dueDate}</div>}
        {task.comments?.length>0 && <div style={{ fontSize:10,color:"var(--muted-foreground)" }}>💬 {task.comments.length}</div>}
      </div>
    </div>
  );
}

function TaskRow({ task, users, onClick }: { task:Task; users:User[]; onClick:()=>void }) {
  const assignee = users.find(u=>u.username===task.assignee);
  return (
    <div onClick={onClick} style={{ display:"flex",alignItems:"center",gap:12,padding:"9px 12px",background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,marginBottom:6,cursor:"pointer" }}>
      <PriorityDot priority={task.priority} />
      <div style={{ flex:1,fontWeight:500,fontSize:13 }}>{task.title}</div>
      {assignee && <div style={{ display:"flex",alignItems:"center",gap:5 }}><Avatar user={assignee} size={22} /><span style={{ fontSize:11,color:"var(--muted-foreground)" }}>{assignee.nombre||assignee.username}</span></div>}
      {task.dueDate && <div style={{ fontSize:11,color:"var(--muted-foreground)" }}>📅 {task.dueDate}</div>}
      <StatusBadge status={task.status} />
    </div>
  );
}

function TaskDetailModal({ task, proj, users, me, onClose, onMove, onDelete, onReload }: any) {
  const [comment, setComment] = useState("");
  const [localTask, setLocalTask] = useState<Task>(task);
  const assignee = users.find((u:User)=>u.username===localTask.assignee);

  async function addComment() {
    if (!comment.trim()) return;
    await fetch(`${API_BASE}/api/intranet/projects/${proj.id}/tasks/${localTask.id}/comments`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ from:me.username, text:comment })
    });
    setComment(""); onReload();
    // Reload task
    const projs = await fetch(`${API_BASE}/api/intranet/projects`).then(r=>r.json());
    const p = projs.find((p:Project)=>p.id===proj.id);
    const t = p?.tasks?.find((t:Task)=>t.id===localTask.id);
    if (t) setLocalTask(t);
  }

  async function changeStatus(newStatus: string) {
    onMove(newStatus); setLocalTask({...localTask,status:newStatus});
  }

  return (
    <Modal onClose={onClose} title="">
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
        <div style={{ width:10,height:10,borderRadius:"50%",background:proj.color,flexShrink:0 }} />
        <span style={{ fontSize:11,color:"var(--muted-foreground)" }}>{proj.name}</span>
        <PriorityDot priority={localTask.priority} />
        <span style={{ fontSize:11,color:PRIORITY_CFG[localTask.priority]?.color }}>{PRIORITY_CFG[localTask.priority]?.label}</span>
      </div>
      <div style={{ fontWeight:800,fontSize:17,marginBottom:8 }}>{localTask.title}</div>
      {localTask.desc && <div style={{ fontSize:13,color:"var(--muted-foreground)",marginBottom:14,lineHeight:1.5 }}>{localTask.desc}</div>}

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14 }}>
        <Field label="Estado">
          <select value={localTask.status} onChange={e=>changeStatus(e.target.value)} className="inp">
            {STATUS_COLS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Asignado a">
          <div style={{ display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--background)" }}>
            {assignee ? <><Avatar user={assignee} size={20} /><span style={{ fontSize:12 }}>{assignee.nombre||assignee.username}</span></> : <span style={{ fontSize:12,color:"var(--muted-foreground)" }}>Sin asignar</span>}
          </div>
        </Field>
      </div>
      {localTask.dueDate && <div style={{ fontSize:12,color:"var(--muted-foreground)",marginBottom:14 }}>📅 Fecha límite: <b>{localTask.dueDate}</b></div>}

      {/* Comentarios */}
      <div style={{ borderTop:"1px solid var(--border)",paddingTop:14,marginTop:4 }}>
        <div style={{ fontWeight:700,fontSize:12,marginBottom:10 }}>Comentarios ({(localTask.comments||[]).length})</div>
        <div style={{ maxHeight:180,overflowY:"auto",marginBottom:10 }}>
          {(localTask.comments||[]).map((c:Comment) => {
            const cu = users.find((u:User)=>u.username===c.from);
            return (
              <div key={c.id} style={{ display:"flex",gap:8,marginBottom:10 }}>
                <Avatar user={cu} size={26} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11,fontWeight:700 }}>{cu?.nombre||c.from} <span style={{ fontWeight:400,color:"var(--muted-foreground)"}}>{fmtTime(c.ts)}</span></div>
                  <div style={{ fontSize:12.5,marginTop:2,lineHeight:1.4 }}>{c.text}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <input value={comment} onChange={e=>setComment(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")addComment();}}
            placeholder="Escribe un comentario..."
            style={{ flex:1,padding:"8px 12px",borderRadius:9,border:"1.5px solid var(--border)",background:"var(--background)",fontSize:12.5,fontFamily:"inherit",outline:"none" }} />
          <button onClick={addComment} style={{ padding:"8px 14px",borderRadius:9,border:"none",background:"var(--primary)",color:"var(--primary-foreground)",cursor:"pointer",fontSize:12,fontWeight:700 }}>→</button>
        </div>
      </div>
      {(me.role==="admin"||me.role==="editor") && (
        <button onClick={onDelete} style={{ marginTop:14,width:"100%",padding:"8px",borderRadius:9,border:"1.5px solid #ef4444",background:"transparent",color:"#ef4444",cursor:"pointer",fontSize:12 }}>Eliminar tarea</button>
      )}
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════
// MAIN APP SHELL
// ══════════════════════════════════════════════════════════════════
export default function App() {
  const [me, setMe] = useState<User|null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [section, setSection] = useState<"direct"|"channels"|"projects">("direct");
  const [totalUnread, setTotalUnread] = useState(0);

  useEffect(() => {
    if (!me) return;
    fetch(`${API_BASE}/api/intranet/auth/users`).then(r=>r.json()).then(setUsers).catch(()=>{});
    // Poll unread count
    const poll = setInterval(() => {
      fetch(`${API_BASE}/api/intranet/chat/unread/${me.username}`).then(r=>r.json()).then((u:Record<string,number>) => {
        setTotalUnread(Object.values(u).reduce((a,b)=>a+b,0));
      }).catch(()=>{});
    }, 8000);
    return ()=>clearInterval(poll);
  }, [me]);

  if (!me) return <LoginScreen onLogin={(u)=>setMe(u)} />;

  const gerColor = GER_COLORS[me.gerencia] || "#888";

  const NAV = [
    { id:"direct",   icon:"💬", label:"Mensajes",  badge: totalUnread },
    { id:"channels", icon:"#",  label:"Canales",   badge: 0 },
    { id:"projects", icon:"📋", label:"Proyectos", badge: 0 },
  ];

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", fontFamily:"system-ui,sans-serif", background:"var(--background)", color:"var(--foreground)" }}>
      {/* Sidebar izquierdo nav */}
      <div className="app-sidebar" style={{ width:64, display:"flex", flexDirection:"column", alignItems:"center", padding:"14px 0", gap:4, flexShrink:0 }}>
        {/* Logo */}
        <div style={{ marginBottom:12 }}>
          <img src="./copikon-logo.jpg" style={{ width:36, height:36, borderRadius:8, objectFit:"cover" }} alt="Copikon" />
        </div>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setSection(n.id as any)} title={n.label}
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
