"""Local account and research-workspace API for LoTUS-BF."""

import json
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from functools import wraps
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash


workspace_bp = Blueprint("workspace_api", __name__)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def _db():
    conn = sqlite3.connect(current_app.config["WORKSPACE_DB_PATH"], timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_workspace_storage(app):
    configured_path = os.environ.get("LOTUS_APP_DB_PATH")
    app_dir = Path(app.root_path)
    db_path = Path(configured_path) if configured_path else app_dir / "instance" / "lotus_workspace.sqlite3"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    app.config["WORKSPACE_DB_PATH"] = str(db_path)

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_workspace_state (
                user_id INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
                state_json TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS literature_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, name)
            );
            CREATE TABLE IF NOT EXISTS user_papers (
                user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                paper_key TEXT NOT NULL,
                study_id TEXT,
                title TEXT NOT NULL DEFAULT '',
                year TEXT NOT NULL DEFAULT '',
                authors TEXT NOT NULL DEFAULT '',
                journal TEXT NOT NULL DEFAULT '',
                pmid TEXT NOT NULL DEFAULT '',
                doi TEXT NOT NULL DEFAULT '',
                paper_note TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY(user_id, paper_key)
            );
            CREATE TABLE IF NOT EXISTS group_papers (
                group_id INTEGER NOT NULL REFERENCES literature_groups(id) ON DELETE CASCADE,
                paper_key TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                added_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(group_id, paper_key)
            );
            CREATE INDEX IF NOT EXISTS idx_literature_groups_user ON literature_groups(user_id);
            CREATE INDEX IF NOT EXISTS idx_group_papers_group ON group_papers(group_id);
        """)
        paper_columns = {row[1] for row in conn.execute("PRAGMA table_info(user_papers)")}
        if "paper_note" not in paper_columns:
            conn.execute("ALTER TABLE user_papers ADD COLUMN paper_note TEXT NOT NULL DEFAULT ''")
        if "keywords_json" in paper_columns:
            legacy_rows = conn.execute(
                "SELECT user_id, paper_key, keywords_json FROM user_papers WHERE paper_note = ''"
            ).fetchall()
            for row in legacy_rows:
                try:
                    legacy_note = "; ".join(str(item).strip() for item in json.loads(row["keywords_json"] or "[]") if str(item).strip())
                except (TypeError, ValueError):
                    legacy_note = ""
                if legacy_note:
                    conn.execute(
                        "UPDATE user_papers SET paper_note = ? WHERE user_id = ? AND paper_key = ?",
                        (legacy_note, row["user_id"], row["paper_key"]),
                    )
        if not os.environ.get("LOTUS_SECRET_KEY"):
            existing = conn.execute("SELECT value FROM app_settings WHERE key = 'secret_key'").fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO app_settings(key, value) VALUES('secret_key', ?)",
                    (secrets.token_urlsafe(48),),
                )
            app.secret_key = conn.execute(
                "SELECT value FROM app_settings WHERE key = 'secret_key'"
            ).fetchone()[0]
        else:
            app.secret_key = os.environ["LOTUS_SECRET_KEY"]

    try:
        os.chmod(db_path, 0o600)
    except OSError:
        pass

    app.permanent_session_lifetime = timedelta(days=30)
    secure_cookie = os.environ.get("LOTUS_COOKIE_SECURE", "0").lower() in {"1", "true", "yes"}
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=secure_cookie,
    )


def _user_id():
    return session.get("user_id")


def _require_login(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not _user_id():
            return jsonify({"error": "Please sign in to use this feature."}), 401
        return fn(*args, **kwargs)
    return wrapped


def _paper_payload(paper):
    if not isinstance(paper, dict):
        paper = {}
    def value(*keys, limit=8000):
        for key in keys:
            found = paper.get(key)
            if found is not None:
                if isinstance(found, list):
                    found = "; ".join(str(item) for item in found)
                return str(found).strip()[:limit]
        return ""
    return {
        "study_id": value("study_id", limit=128),
        "title": value("title", limit=2000),
        "year": value("year", limit=20),
        "authors": value("authors", "author", limit=2000),
        "journal": value("journal", limit=500),
        "pmid": value("pmid", "PMID", "pubmed_id", limit=100),
        "doi": value("doi", "DOI", limit=300),
    }


def _upsert_user_paper(conn, user_id, paper_key, paper, paper_note=None):
    data = _paper_payload(paper)
    if not data["title"]:
        data["title"] = f"Study {data['study_id'] or paper_key}"
    if paper_note is None:
        existing = conn.execute(
            "SELECT paper_note FROM user_papers WHERE user_id = ? AND paper_key = ?",
            (user_id, paper_key),
        ).fetchone()
        paper_note = existing[0] if existing else ""
    paper_note = str(paper_note or "")[:12000]
    conn.execute("""
        INSERT INTO user_papers(
            user_id, paper_key, study_id, title, year, authors, journal,
            pmid, doi, paper_note, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, paper_key) DO UPDATE SET
            study_id = excluded.study_id,
            title = excluded.title,
            year = excluded.year,
            authors = excluded.authors,
            journal = excluded.journal,
            pmid = excluded.pmid,
            doi = excluded.doi,
            paper_note = excluded.paper_note,
            updated_at = excluded.updated_at
    """, (
        user_id, paper_key, data["study_id"], data["title"], data["year"], data["authors"],
        data["journal"], data["pmid"], data["doi"],
        paper_note, _now(),
    ))


def _groups_payload(conn, user_id):
    groups = conn.execute("""
        SELECT g.id, g.name, g.created_at, COUNT(gp.paper_key) AS paper_count
        FROM literature_groups g
        LEFT JOIN group_papers gp ON gp.group_id = g.id
        WHERE g.user_id = ?
        GROUP BY g.id
        ORDER BY g.created_at, g.id
    """, (user_id,)).fetchall()
    payload = []
    for group in groups:
        papers = conn.execute("""
            SELECT p.paper_key, p.study_id, p.title, p.year, p.authors, p.journal,
                   p.pmid, p.doi, p.paper_note,
                   gp.note AS group_note, gp.added_at, gp.updated_at
            FROM group_papers gp
            JOIN user_papers p ON p.user_id = ? AND p.paper_key = gp.paper_key
            WHERE gp.group_id = ?
            ORDER BY gp.added_at DESC
        """, (user_id, group["id"])).fetchall()
        payload.append({
            "id": group["id"], "name": group["name"],
            "created_at": group["created_at"], "paper_count": group["paper_count"],
            "papers": [{
                **{key: paper[key] for key in (
                    "paper_key", "study_id", "title", "year", "authors", "journal",
                    "pmid", "doi", "paper_note", "group_note", "added_at", "updated_at"
                )},
                "note": paper["group_note"],
            } for paper in papers],
        })
    return payload


@workspace_bp.post("/auth/register")
def register():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", username):
        return jsonify({"error": "Username must be 3–32 characters: letters, numbers, dot, underscore, or hyphen."}), 400
    if len(password) < 10 or len(password) > 256:
        return jsonify({"error": "Password must be 10–256 characters."}), 400
    try:
        with _db() as conn:
            cursor = conn.execute(
                "INSERT INTO app_users(username, password_hash, created_at) VALUES(?, ?, ?)",
                (username, generate_password_hash(password, method="scrypt"), _now()),
            )
            user_id = cursor.lastrowid
            conn.execute(
                "INSERT INTO user_workspace_state(user_id, state_json, updated_at) VALUES(?, '{}', ?)",
                (user_id, _now()),
            )
    except sqlite3.IntegrityError:
        return jsonify({"error": "That username is already taken."}), 409
    session.clear()
    session["user_id"] = user_id
    session.permanent = True
    return jsonify({"user": {"id": user_id, "username": username}}), 201


@workspace_bp.post("/auth/login")
def login():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    with _db() as conn:
        user = conn.execute(
            "SELECT id, username, password_hash FROM app_users WHERE username = ? COLLATE NOCASE",
            (username,),
        ).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Username or password is incorrect."}), 401
    session.clear()
    session["user_id"] = user["id"]
    session.permanent = True
    return jsonify({"user": {"id": user["id"], "username": user["username"]}}), 200


@workspace_bp.post("/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True}), 200


@workspace_bp.get("/auth/me")
def auth_me():
    user_id = _user_id()
    if not user_id:
        return jsonify({"user": None}), 200
    with _db() as conn:
        user = conn.execute("SELECT id, username FROM app_users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        session.clear()
        return jsonify({"user": None}), 200
    return jsonify({"user": dict(user)}), 200


@workspace_bp.route("/workspace/state", methods=["GET", "PUT"])
@_require_login
def workspace_state():
    user_id = _user_id()
    with _db() as conn:
        if request.method == "GET":
            row = conn.execute(
                "SELECT state_json FROM user_workspace_state WHERE user_id = ?", (user_id,)
            ).fetchone()
            return jsonify({"state": json.loads(row[0]) if row else {}}), 200
        state = request.get_json(silent=True) or {}
        if not isinstance(state, dict) or len(json.dumps(state, ensure_ascii=False)) > 20000:
            return jsonify({"error": "Workspace state is invalid or too large."}), 400
        if "query" in state:
            state["query"] = str(state["query"] or "")[:4000]
        conn.execute("""
            INSERT INTO user_workspace_state(user_id, state_json, updated_at) VALUES(?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
        """, (user_id, json.dumps(state, ensure_ascii=False), _now()))
    return jsonify({"state": state}), 200


@workspace_bp.get("/workspace/groups")
@_require_login
def list_groups():
    with _db() as conn:
        return jsonify({"groups": _groups_payload(conn, _user_id())}), 200


@workspace_bp.post("/workspace/groups")
@_require_login
def create_group():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name or len(name) > 80:
        return jsonify({"error": "Group name must be 1–80 characters."}), 400
    try:
        with _db() as conn:
            conn.execute(
                "INSERT INTO literature_groups(user_id, name, created_at) VALUES(?, ?, ?)",
                (_user_id(), name, _now()),
            )
            groups = _groups_payload(conn, _user_id())
    except sqlite3.IntegrityError:
        return jsonify({"error": "A group with that name already exists."}), 409
    return jsonify({"groups": groups}), 201


@workspace_bp.delete("/workspace/groups/<int:group_id>")
@_require_login
def delete_group(group_id):
    with _db() as conn:
        result = conn.execute(
            "DELETE FROM literature_groups WHERE id = ? AND user_id = ?",
            (group_id, _user_id()),
        )
        if result.rowcount == 0:
            return jsonify({"error": "Group not found."}), 404
        groups = _groups_payload(conn, _user_id())
    return jsonify({"groups": groups}), 200


@workspace_bp.route("/workspace/papers", methods=["GET", "PUT"])
@_require_login
def user_papers():
    user_id = _user_id()
    if request.method == "GET":
        with _db() as conn:
            rows = conn.execute(
                "SELECT * FROM user_papers WHERE user_id = ? ORDER BY updated_at DESC", (user_id,)
            ).fetchall()
        return jsonify({"papers": [{
            "paper_key": row["paper_key"], "study_id": row["study_id"], "title": row["title"],
            "year": row["year"], "authors": row["authors"], "journal": row["journal"],
            "pmid": row["pmid"], "doi": row["doi"],
            "paper_note": row["paper_note"] or "",
        } for row in rows]}), 200

    body = request.get_json(silent=True) or {}
    paper_key = str(body.get("paper_key", "")).strip()[:256]
    if not paper_key:
        return jsonify({"error": "A paper key is required."}), 400
    paper_note = str(body.get("paper_note", ""))[:12000]
    with _db() as conn:
        _upsert_user_paper(conn, user_id, paper_key, body.get("paper"), paper_note)
    return jsonify({"ok": True, "paper_note": paper_note}), 200


@workspace_bp.post("/workspace/groups/<int:group_id>/papers")
@_require_login
def add_paper_to_group(group_id):
    body = request.get_json(silent=True) or {}
    paper_key = str(body.get("paper_key", "")).strip()[:256]
    if not paper_key:
        return jsonify({"error": "A paper key is required."}), 400
    note = str(body.get("note", ""))[:12000]
    paper_note = str(body.get("paper_note", ""))[:12000] if "paper_note" in body else None
    with _db() as conn:
        group = conn.execute(
            "SELECT id FROM literature_groups WHERE id = ? AND user_id = ?",
            (group_id, _user_id()),
        ).fetchone()
        if not group:
            return jsonify({"error": "Group not found."}), 404
        _upsert_user_paper(conn, _user_id(), paper_key, body.get("paper"), paper_note)
        conn.execute("""
            INSERT INTO group_papers(group_id, paper_key, note, added_at, updated_at)
            VALUES(?, ?, ?, ?, ?)
            ON CONFLICT(group_id, paper_key) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
        """, (group_id, paper_key, note, _now(), _now()))
        groups = _groups_payload(conn, _user_id())
    return jsonify({"groups": groups}), 200


@workspace_bp.put("/workspace/groups/<int:group_id>/papers/<path:paper_key>")
@_require_login
def update_group_paper(group_id, paper_key):
    body = request.get_json(silent=True) or {}
    note = str(body.get("note", ""))[:12000]
    with _db() as conn:
        result = conn.execute("""
            UPDATE group_papers SET note = ?, updated_at = ?
            WHERE group_id = ? AND paper_key = ? AND group_id IN (
                SELECT id FROM literature_groups WHERE user_id = ?
            )
        """, (note, _now(), group_id, paper_key, _user_id()))
        if result.rowcount == 0:
            return jsonify({"error": "This paper is not in that group."}), 404
        groups = _groups_payload(conn, _user_id())
    return jsonify({"groups": groups}), 200


@workspace_bp.delete("/workspace/groups/<int:group_id>/papers/<path:paper_key>")
@_require_login
def remove_paper_from_group(group_id, paper_key):
    with _db() as conn:
        result = conn.execute("""
            DELETE FROM group_papers WHERE group_id = ? AND paper_key = ? AND group_id IN (
                SELECT id FROM literature_groups WHERE user_id = ?
            )
        """, (group_id, paper_key, _user_id()))
        if result.rowcount == 0:
            return jsonify({"error": "This paper is not in that group."}), 404
        groups = _groups_payload(conn, _user_id())
    return jsonify({"groups": groups}), 200
