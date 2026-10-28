#!/usr/bin/env bash
# Membuat bridge (default pnet0) dari NIC fisik agar node Cloud bisa memakai NIC utama
# tanpa memutus jaringan server. IP & gateway NIC dipindah ke bridge.
#   sudo scripts/make-bridge.sh eth0          -> buat pnet0
#   sudo scripts/make-bridge.sh eth0 pnet0 undo
# PERINGATAN: jalankan dari console lokal / jangan lewat SSH di NIC yang sama.
# Tidak permanen setelah reboot (untuk permanen, atur di netplan / NetworkManager).
set -e
NIC=${1:?pakai: make-bridge.sh <nic> [bridge] [undo]}
BR=${2:-pnet0}
if [ "$3" = "undo" ]; then
  IPS=$(ip -4 -o addr show dev "$BR" | awk '{print $4}')
  GW=$(ip route show default dev "$BR" | awk '{print $3}' | head -1)
  ip link set "$NIC" nomaster
  for a in $IPS; do ip addr del "$a" dev "$BR"; ip addr add "$a" dev "$NIC"; done
  ip link del "$BR"
  [ -n "$GW" ] && ip route add default via "$GW" dev "$NIC" || true
  echo "Bridge $BR dihapus, IP dikembalikan ke $NIC"; exit 0
fi
IPS=$(ip -4 -o addr show dev "$NIC" | awk '{print $4}')
GW=$(ip route show default dev "$NIC" | awk '{print $3}' | head -1)
ip link add name "$BR" type bridge
ip link set "$BR" type bridge stp_state 0 group_fwd_mask 65528 2>/dev/null || true
ip link set "$BR" up
ip link set "$NIC" master "$BR"
for a in $IPS; do ip addr del "$a" dev "$NIC"; ip addr add "$a" dev "$BR"; done
[ -n "$GW" ] && ip route replace default via "$GW" dev "$BR"
echo "Bridge $BR siap (berisi $NIC, IP: ${IPS:-tidak ada}). Pilih '$BR' sebagai target node Cloud."
