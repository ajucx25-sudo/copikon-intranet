#!/usr/bin/env python3
"""
api_server.py — Servidor de persistencia para Copikon Intranet
Corre en puerto 8001. Persiste proyectos y tareas en SQLite.
"""
import sqlite3
import json
import time
import random
import string
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Any

DB_PATH = "copikon_projects.db"

def get_db():
    db = sqlite3.connect(DB_PATH, check_same_thread=False)
    db.row_factory = sqlite3.Row
    return db

def next_id():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))

def init_db():
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    """)
    db.commit()
    db.close()

@asynccontextmanager
async def lifespan(app):
    init_db()
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Helpers ──────────────────────────────────────────────────────────

def load_all_projects():
    db = get_db()
    rows = db.execute("SELECT data FROM projects ORDER BY created_at").fetchall()
    db.close()
    return [json.loads(r["data"]) for r in rows]

def save_project(proj: dict):
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO projects (id, data, created_at) VALUES (?, ?, ?)",
        [proj["id"], json.dumps(proj), proj.get("createdAt", int(time.time() * 1000))]
    )
    db.commit()
    db.close()

def delete_project_by_id(proj_id: str):
    db = get_db()
    db.execute("DELETE FROM projects WHERE id = ?", [proj_id])
    db.commit()
    db.close()

def get_project(proj_id: str):
    db = get_db()
    row = db.execute("SELECT data FROM projects WHERE id = ?", [proj_id]).fetchone()
    db.close()
    return json.loads(row["data"]) if row else None

# ── Rutas de proyectos ────────────────────────────────────────────────

@app.get("/api/intranet/projects")
def list_projects():
    return load_all_projects()

@app.post("/api/intranet/projects")
def create_project(req: Request, body: dict):
    proj = {
        "id": next_id(),
        "name": body.get("name", "").strip(),
        "desc": body.get("desc", ""),
        "color": body.get("color", "#00b8b0"),
        "owner": body.get("owner", ""),
        "members": body.get("members", []),
        "tasks": [],
        "createdAt": int(time.time() * 1000),
    }
    if not proj["name"]:
        raise HTTPException(400, "Nombre requerido")
    save_project(proj)
    return proj

@app.put("/api/intranet/projects/{proj_id}")
def update_project(proj_id: str, body: dict):
    proj = get_project(proj_id)
    if not proj:
        raise HTTPException(404, "No encontrado")
    proj.update({k: v for k, v in body.items() if k != "id"})
    save_project(proj)
    return proj

@app.delete("/api/intranet/projects/{proj_id}")
def delete_project(proj_id: str):
    delete_project_by_id(proj_id)
    return {"ok": True}

# ── Rutas de tareas ───────────────────────────────────────────────────

@app.post("/api/intranet/projects/{proj_id}/tasks")
def create_task(proj_id: str, body: dict):
    proj = get_project(proj_id)
    if not proj:
        raise HTTPException(404, "Proyecto no encontrado")
    title = body.get("title", "").strip()
    if not title:
        raise HTTPException(400, "Título requerido")
    task = {
        "id": next_id(),
        "title": title,
        "desc": body.get("desc", ""),
        "assignee": body.get("assignee") or None,
        "priority": body.get("priority", "media"),
        "startDate": body.get("startDate") or None,
        "dueDate": body.get("dueDate") or None,
        "duration": body.get("duration") or None,
        "status": body.get("status", "pendiente"),
        "percent": body.get("percent", 0),
        "hoursEstimated": body.get("hoursEstimated") or None,
        "hoursActual": body.get("hoursActual", 0),
        "labels": body.get("labels", []),
        "checklist": body.get("checklist", []),
        "subtasks": body.get("subtasks", []),
        "comments": [],
        "createdAt": int(time.time() * 1000),
    }
    proj.setdefault("tasks", []).append(task)
    save_project(proj)
    return task

@app.put("/api/intranet/projects/{proj_id}/tasks/{task_id}")
def update_task(proj_id: str, task_id: str, body: dict):
    proj = get_project(proj_id)
    if not proj:
        raise HTTPException(404, "Proyecto no encontrado")
    tasks = proj.get("tasks", [])
    ti = next((i for i, t in enumerate(tasks) if t["id"] == task_id), -1)
    if ti == -1:
        raise HTTPException(404, "Tarea no encontrada")
    tasks[ti].update({k: v for k, v in body.items() if k != "id"})
    proj["tasks"] = tasks
    save_project(proj)
    return tasks[ti]

@app.delete("/api/intranet/projects/{proj_id}/tasks/{task_id}")
def delete_task(proj_id: str, task_id: str):
    proj = get_project(proj_id)
    if not proj:
        raise HTTPException(404, "No encontrado")
    proj["tasks"] = [t for t in proj.get("tasks", []) if t["id"] != task_id]
    save_project(proj)
    return {"ok": True}

@app.post("/api/intranet/projects/{proj_id}/tasks/{task_id}/comments")
def add_comment(proj_id: str, task_id: str, body: dict):
    proj = get_project(proj_id)
    if not proj:
        raise HTTPException(404, "No encontrado")
    text = body.get("text", "").strip()
    if not text:
        raise HTTPException(400, "Texto requerido")
    tasks = proj.get("tasks", [])
    ti = next((i for i, t in enumerate(tasks) if t["id"] == task_id), -1)
    if ti == -1:
        raise HTTPException(404, "Tarea no encontrada")
    comment = {
        "id": next_id(),
        "from": body.get("from", ""),
        "text": text,
        "ts": int(time.time() * 1000),
    }
    tasks[ti].setdefault("comments", []).append(comment)
    proj["tasks"] = tasks
    save_project(proj)
    return comment

@app.get("/health")
def health():
    return {"ok": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
