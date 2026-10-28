#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
PY=.venv/bin/python
[ -x "$PY" ] || PY=python3
"$PY" run.py --open "$@" || { echo; echo " NexLab berhenti. Sudah menjalankan install-macos.command?"; read -r -p " Enter untuk menutup"; }
