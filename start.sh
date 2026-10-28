#!/usr/bin/env bash
# Menjalankan NexLab. Tambahkan argumen, mis: ./start.sh --port 80
cd "$(dirname "$0")"
PY=python3
[ -x .venv/bin/python ] && PY=.venv/bin/python
exec "$PY" run.py "$@"
