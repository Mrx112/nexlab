#!/usr/bin/env bash
# NexLab - instalasi untuk macOS (klik ganda di Finder)
cd "$(dirname "$0")/../.." || exit 1
echo
echo " ===== NexLab : instalasi untuk macOS ====="
echo
PY=""
for c in python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys;sys.exit(0 if sys.version_info>=(3,9) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo " Python 3.9+ belum ada."
  if command -v brew >/dev/null 2>&1; then
    read -r -p " Pasang lewat Homebrew (brew install python)? [Y/n] " a
    [[ ! "$a" =~ ^[Nn] ]] && brew install python && PY=python3
  fi
  if [ -z "$PY" ]; then
    echo " Pasang Python dari https://www.python.org/downloads/macos/ atau jalankan: xcode-select --install"
    read -r -p " Tekan Enter untuk keluar"; exit 1
  fi
fi
echo " [1/4] Python: $($PY --version)"
echo " [2/4] Membuat virtualenv .venv ..."
"$PY" -m venv .venv || { echo " Gagal membuat venv"; read -r; exit 1; }
.venv/bin/python -m pip install --upgrade pip >/dev/null
echo " [3/4] Memasang dependensi ..."
.venv/bin/python -m pip install -r requirements.txt || { echo " Gagal pip install"; read -r; exit 1; }
mkdir -p data/images/qemu
chmod +x start-macos.command install-macos.command start.sh 2>/dev/null
xattr -dr com.apple.quarantine . 2>/dev/null
echo " [4/4] Opsi tambahan"
if ! command -v qemu-system-x86_64 >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
  read -r -p " Pasang QEMU untuk node VM image asli (brew install qemu)? [y/N] " q
  [[ "$q" =~ ^[Yy] ]] && brew install qemu
fi
read -r -p " Jalankan NexLab otomatis saat login (LaunchAgent)? [y/N] " s
if [[ "$s" =~ ^[Yy] ]]; then
  P="$HOME/Library/LaunchAgents/com.nexlab.server.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$P" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.nexlab.server</string>
  <key>ProgramArguments</key><array><string>$(pwd)/.venv/bin/python</string><string>$(pwd)/run.py</string></array>
  <key>WorkingDirectory</key><string>$(pwd)</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(pwd)/data/nexlab.log</string>
  <key>StandardErrorPath</key><string>$(pwd)/data/nexlab.log</string>
</dict></plist>
PLIST
  launchctl unload "$P" 2>/dev/null; launchctl load "$P" && echo " LaunchAgent aktif (log: data/nexlab.log). Hapus: launchctl unload $P"
fi
echo
echo " Selesai. Jalankan NexLab: klik ganda start-macos.command"
echo " (Saat pertama kali macOS bertanya 'accept incoming network connections', pilih Allow.)"
read -r -p " Tekan Enter untuk menutup"
