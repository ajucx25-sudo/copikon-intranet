import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";

// ── Helpers JSON ──────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd());

function readJSON(file: string, def: any = {}) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8")); }
  catch { return def; }
}
function writeJSON(file: string, data: any) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), "utf-8");
}

// Init data files
const FILES = {
  users:    "portal-users.json",
  messages: "intranet-messages.json",
  channels: "intranet-channels.json",
  projects: "intranet-projects.json",
};
if (!fs.existsSync(path.join(DATA_DIR, FILES.messages)))  writeJSON(FILES.messages,  []);
if (!fs.existsSync(path.join(DATA_DIR, FILES.channels)))  writeJSON(FILES.channels,  []);
if (!fs.existsSync(path.join(DATA_DIR, FILES.projects)))  writeJSON(FILES.projects,  []);

// ── SSE clients map ────────────────────────────────────────────────
const sseClients: Map<string, any[]> = new Map();

function sseNotify(userId: string, event: string, data: any) {
  const clients = sseClients.get(userId) || [];
  const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
  clients.forEach(res => { try { res.write(payload); } catch {} });
}

function sseBroadcast(userIds: string[], event: string, data: any) {
  userIds.forEach(uid => sseNotify(uid, event, data));
}

// ── ID generator ───────────────────────────────────────────────────
let _seq = Date.now();
function nextId() { return (++_seq).toString(36); }

export function registerRoutes(server: Server, app: Express): Server {

  // ══════════════════════════════════════════════
  // AUTH — reutiliza portal-users.json
  // ══════════════════════════════════════════════

  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body;
    const users = readJSON(FILES.users, {});
    const user = users[username];
    if (!user || user.password !== password)
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    const { password: _, ...safe } = user;
    res.json(safe);
  });

  app.get("/api/auth/users", (_req, res) => {
    const users = readJSON(FILES.users, {});
    const list = Object.values(users).map(({ password: _, ...u }: any) => u);
    res.json(list);
  });

  // ══════════════════════════════════════════════
  // CHAT — mensajes 1a1
  // ══════════════════════════════════════════════

  app.get("/api/chat/messages/:a/:b", (req, res) => {
    const { a, b } = req.params;
    const convId = [a, b].sort().join("__");
    const msgs: any[] = readJSON(FILES.messages, []);
    res.json(msgs.filter(m => m.convId === convId));
  });

  app.post("/api/chat/messages", (req, res) => {
    const { from, to, text } = req.body;
    if (!from || !to || !text?.trim()) return res.status(400).json({ error: "Faltan campos" });
    const convId = [from, to].sort().join("__");
    const msg = { id: nextId(), convId, from, to, text: text.trim(), ts: Date.now(), read: false };
    const msgs: any[] = readJSON(FILES.messages, []);
    msgs.push(msg);
    writeJSON(FILES.messages, msgs);
    sseNotify(to,   "new_message", msg);
    sseNotify(from, "new_message", msg);
    res.json(msg);
  });

  app.post("/api/chat/read", (req, res) => {
    const { convId, userId } = req.body;
    const msgs: any[] = readJSON(FILES.messages, []);
    msgs.forEach(m => { if (m.convId === convId && m.to === userId) m.read = true; });
    writeJSON(FILES.messages, msgs);
    res.json({ ok: true });
  });

  app.get("/api/chat/unread/:userId", (req, res) => {
    const { userId } = req.params;
    const msgs: any[] = readJSON(FILES.messages, []);
    const counts: Record<string, number> = {};
    msgs.filter(m => m.to === userId && !m.read).forEach(m => {
      counts[m.from] = (counts[m.from] || 0) + 1;
    });
    res.json(counts);
  });

  // ══════════════════════════════════════════════
  // CANALES — por gerencia
  // ══════════════════════════════════════════════

  const GER_COLORS: Record<string, string> = {
    root: "#1a3a6b", comercializacion: "#4a7fd4", operaciones: "#e8a020",
    finanzas: "#3cb371", retail: "#a06ad4", it: "#5b8ff9",
    proyectos: "#dd6874", compras: "#f0a050", staff: "#6b7a99", general: "#2bbfae"
  };

  // Inicializar canales por defecto si no existen
  function ensureDefaultChannels() {
    const channels: any[] = readJSON(FILES.channels, []);
    if (channels.length) return channels;
    const defaults = [
      { id: "general", name: "General", gerencia: "general", desc: "Canal para toda la empresa", isDefault: true },
      { id: "comercializacion", name: "Comercialización", gerencia: "comercializacion", desc: "Equipo comercial", isDefault: true },
      { id: "operaciones", name: "Operaciones", gerencia: "operaciones", desc: "Equipo de operaciones", isDefault: true },
      { id: "finanzas", name: "Finanzas", gerencia: "finanzas", desc: "Equipo financiero", isDefault: true },
      { id: "compras", name: "Compras", gerencia: "compras", desc: "Equipo de compras", isDefault: true },
      { id: "retail", name: "Retail", gerencia: "retail", desc: "Tiendas Retail Copikon", isDefault: true },
      { id: "it", name: "IT", gerencia: "it", desc: "Equipo de tecnología", isDefault: true },
      { id: "proyectos", name: "Proyectos", gerencia: "proyectos", desc: "Gerencia técnica de proyectos", isDefault: true },
    ];
    writeJSON(FILES.channels, defaults);
    return defaults;
  }

  app.get("/api/channels", (_req, res) => {
    res.json(ensureDefaultChannels().map(c => ({ ...c, color: GER_COLORS[c.gerencia] || "#888" })));
  });

  app.get("/api/channels/:channelId/messages", (req, res) => {
    const msgs: any[] = readJSON(FILES.messages, []);
    res.json(msgs.filter(m => m.channelId === req.params.channelId).slice(-200));
  });

  app.post("/api/channels/:channelId/messages", (req, res) => {
    const { from, text } = req.body;
    const { channelId } = req.params;
    if (!from || !text?.trim()) return res.status(400).json({ error: "Faltan campos" });
    const msg = { id: nextId(), channelId, from, text: text.trim(), ts: Date.now() };
    const msgs: any[] = readJSON(FILES.messages, []);
    msgs.push(msg);
    writeJSON(FILES.messages, msgs);
    // Broadcast a todos los usuarios conectados
    const users = readJSON(FILES.users, {});
    sseBroadcast(Object.keys(users), "channel_message", msg);
    res.json(msg);
  });

  // ══════════════════════════════════════════════
  // SSE — tiempo real
  // ══════════════════════════════════════════════

  app.get("/api/sse/:userId", (req, res) => {
    const { userId } = req.params;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ event: "connected", data: { userId } })}\n\n`);
    const clients = sseClients.get(userId) || [];
    clients.push(res);
    sseClients.set(userId, clients);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
    req.on("close", () => {
      clearInterval(ping);
      const remaining = (sseClients.get(userId) || []).filter(r => r !== res);
      sseClients.set(userId, remaining);
    });
  });

  // ══════════════════════════════════════════════
  // PROJECT MANAGER
  // ══════════════════════════════════════════════

  // Proyectos — registra rutas con y sin prefijo /intranet/ para compatibilidad
  const projectPrefixes = ["/api", "/api/intranet"];

  projectPrefixes.forEach(pfx => {

  app.get(`${pfx}/projects`, (_req, res) => {
    res.json(readJSON(FILES.projects, []));
  });

  app.post(`${pfx}/projects`, (req, res) => {
    const { name, desc, color, owner, members } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Nombre requerido" });
    const projects: any[] = readJSON(FILES.projects, []);
    const proj = {
      id: nextId(), name: name.trim(), desc: desc || "",
      color: color || "#4a7fd4", owner, members: members || [],
      createdAt: Date.now(), tasks: []
    };
    projects.push(proj);
    writeJSON(FILES.projects, projects);
    res.json(proj);
  });

  app.put(`${pfx}/projects/:id`, (req, res) => {
    const projects: any[] = readJSON(FILES.projects, []);
    const idx = projects.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "No encontrado" });
    projects[idx] = { ...projects[idx], ...req.body, id: req.params.id };
    writeJSON(FILES.projects, projects);
    res.json(projects[idx]);
  });

  app.delete(`${pfx}/projects/:id`, (req, res) => {
    let projects: any[] = readJSON(FILES.projects, []);
    projects = projects.filter(p => p.id !== req.params.id);
    writeJSON(FILES.projects, projects);
    res.json({ ok: true });
  });

  // Tareas dentro de un proyecto
  app.get(`${pfx}/projects/:id/tasks`, (req, res) => {
    const projects: any[] = readJSON(FILES.projects, []);
    const proj = projects.find(p => p.id === req.params.id);
    if (!proj) return res.status(404).json({ error: "No encontrado" });
    res.json(proj.tasks || []);
  });

  app.post(`${pfx}/projects/:id/tasks`, (req, res) => {
    const { title, desc, assignee, priority, dueDate, status } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "Título requerido" });
    const projects: any[] = readJSON(FILES.projects, []);
    const proj = projects.find(p => p.id === req.params.id);
    if (!proj) return res.status(404).json({ error: "No encontrado" });
    const task = {
      id: nextId(), title: title.trim(), desc: desc || "",
      assignee: assignee || null, priority: priority || "media",
      dueDate: dueDate || null, status: status || "pendiente",
      createdAt: Date.now(), comments: []
    };
    proj.tasks = [...(proj.tasks || []), task];
    writeJSON(FILES.projects, projects);
    // Notificar al asignado
    if (assignee) sseNotify(assignee, "task_assigned", { task, projectId: req.params.id, projectName: proj.name });
    res.json(task);
  });

  app.put(`${pfx}/projects/:projId/tasks/:taskId`, (req, res) => {
    const projects: any[] = readJSON(FILES.projects, []);
    const proj = projects.find(p => p.id === req.params.projId);
    if (!proj) return res.status(404).json({ error: "Proyecto no encontrado" });
    const ti = (proj.tasks || []).findIndex((t: any) => t.id === req.params.taskId);
    if (ti === -1) return res.status(404).json({ error: "Tarea no encontrada" });
    proj.tasks[ti] = { ...proj.tasks[ti], ...req.body, id: req.params.taskId };
    writeJSON(FILES.projects, projects);
    // Notificar si cambió el estado
    if (req.body.status && proj.tasks[ti].assignee) {
      sseNotify(proj.tasks[ti].assignee, "task_updated", { task: proj.tasks[ti], projectId: proj.id });
    }
    res.json(proj.tasks[ti]);
  });

  app.delete(`${pfx}/projects/:projId/tasks/:taskId`, (req, res) => {
    const projects: any[] = readJSON(FILES.projects, []);
    const proj = projects.find(p => p.id === req.params.projId);
    if (!proj) return res.status(404).json({ error: "No encontrado" });
    proj.tasks = (proj.tasks || []).filter((t: any) => t.id !== req.params.taskId);
    writeJSON(FILES.projects, projects);
    res.json({ ok: true });
  });

  }); // fin forEach prefijos

  // Comentarios en tarea
  ["/api", "/api/intranet"].forEach(pfx => {
  app.post(`${pfx}/projects/:projId/tasks/:taskId/comments`, (req, res) => {
    const { from, text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "Texto requerido" });
    const projects: any[] = readJSON(FILES.projects, []);
    const proj = projects.find(p => p.id === req.params.projId);
    if (!proj) return res.status(404).json({ error: "No encontrado" });
    const task = (proj.tasks || []).find((t: any) => t.id === req.params.taskId);
    if (!task) return res.status(404).json({ error: "No encontrado" });
    const comment = { id: nextId(), from, text: text.trim(), ts: Date.now() };
    task.comments = [...(task.comments || []), comment];
    writeJSON(FILES.projects, projects);
    res.json(comment);
  });
  }); // fin forEach comentarios

  return server;
}
