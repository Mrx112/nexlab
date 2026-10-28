"""SQLite storage + password hashing."""
import hashlib
import hmac
import os
import secrets
import sqlite3
import threading
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  fullname TEXT DEFAULT '',
  pw TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  active INTEGER NOT NULL DEFAULT 1,
  created REAL, last_login REAL);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER, created REAL, expires REAL, ip TEXT);
CREATE TABLE IF NOT EXISTS labs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER, name TEXT, description TEXT,
  data TEXT, created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
"""


def hash_pw(pw, iterations=200_000):
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt), iterations).hex()
    return f'pbkdf2${iterations}${salt}${h}'


def check_pw(pw, stored):
    try:
        _, it, salt, h = stored.split('$')
        calc = hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt), int(it)).hex()
        return hmac.compare_digest(calc, h)
    except Exception:
        return False


class DB:
    def __init__(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('PRAGMA journal_mode=WAL')
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def q(self, sql, args=(), one=False):
        with self.lock:
            rows = self.conn.execute(sql, args).fetchall()
        rows = [dict(r) for r in rows]
        return (rows[0] if rows else None) if one else rows

    def x(self, sql, args=()):
        with self.lock:
            cur = self.conn.execute(sql, args)
            self.conn.commit()
            return cur.lastrowid

    def setting(self, key, default=None):
        r = self.q('SELECT value FROM settings WHERE key=?', (key,), one=True)
        return r['value'] if r else default

    def set_setting(self, key, value):
        self.x('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
               (key, str(value)))

    def new_session(self, uid, ip, days=7):
        tok = secrets.token_urlsafe(32)
        now = time.time()
        self.x('INSERT INTO sessions VALUES(?,?,?,?,?)', (tok, uid, now, now + days * 86400, ip))
        self.x('DELETE FROM sessions WHERE expires<?', (now,))
        return tok

    def session_user(self, tok):
        if not tok:
            return None
        r = self.q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1',
                   (tok, time.time()), one=True)
        return r
