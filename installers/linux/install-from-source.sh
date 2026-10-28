#!/usr/bin/env bash
# NexLab installer untuk Debian/Ubuntu/Mint (apt) dan Fedora/RHEL (dnf)
set -e
cd "$(dirname "$0")/../.."
echo "==> Memasang paket sistem (python3, venv, iproute2)…"
if command -v apt-get >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y python3 python3-venv python3-pip iproute2 bridge-utils iputils-ping
elif command -v dnf >/dev/null; then
  sudo dnf install -y python3 python3-pip iproute iputils
fi
echo "==> Membuat virtualenv .venv dan memasang dependensi Python…"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install -r requirements.txt
mkdir -p data/images/qemu
read -r -p "Pasang QEMU untuk node VM image asli (vIOS, CSR, MikroTik, dll)? [y/N] " q
if [[ "$q" =~ ^[Yy] ]]; then
  if command -v apt-get >/dev/null; then sudo apt-get install -y qemu-system-x86 qemu-utils; else sudo dnf install -y qemu-kvm qemu-img; fi
fi
read -r -p "Jalankan NexLab otomatis saat boot (systemd service)? [y/N] " s
if [[ "$s" =~ ^[Yy] ]]; then
  read -r -p "Port web [8080]: " port; port=${port:-8080}
  sudo tee /etc/systemd/system/nexlab.service >/dev/null <<UNIT
[Unit]
Description=NexLab network lab
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/.venv/bin/python $(pwd)/run.py --port $port
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now nexlab
  echo "==> Service aktif. Cek: sudo systemctl status nexlab"
fi
echo
echo "Selesai. Jalankan:  sudo ./start.sh        (atau ./start.sh tanpa sudo untuk mode simulasi saja)"
