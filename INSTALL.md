# Panduan Instalasi NexLab

Panduan lengkap untuk menginstal dan mengonfigurasi NexLab di Windows, macOS, dan Linux, termasuk menghubungkan lab simulasi ke jaringan fisik.

## Persyaratan

| Komponen | Minimal |
|---|---|
| Python | 3.9+ |
| RAM | 60 MB (simulasi), 2 GB (node real/QEMU) |
| OS | Linux, Windows 10/11, macOS 12+ |
| Root/sudo | Diperlukan untuk bridge NIC fisik (Linux/macOS) |

## Instalasi Desktop (GUI installer)

Unduh installer terbaru dari [GitHub Releases](https://github.com/Mrx112/nexlab/releases):

- **Windows**: `NexLab-Setup-Windows.cmd` → klik ganda untuk menjalankan otomatis.
- **macOS** (Intel & Apple Silicon): `NexLab-Setup-macOS.command` → jalankan `bash ~/Downloads/NexLab-Setup-macOS.command`.
- **Linux x86_64**: `NexLab-Setup-Linux.sh` → jalankan `bash ~/Downloads/NexLab-Setup-Linux.sh`.

Installer melakukan hal berikut:
1. Mengunduh paket rilis dan verifikasi SHA-256.
2. Memasang aplikasi beserta shortcut (Desktop/Start Menu/menu aplikasi).
3. Membuka NexLab di browser secara otomatis.

Data pengguna disimpan di:
- **Windows**: `%LOCALAPPDATA%\NexLab\data`
- **macOS**: `~/Library/Application Support/NexLab/data`
- **Linux**: `${XDG_DATA_HOME:-~/.local/share}/nexlab`

## Instalasi dari Source (developer/server)

```bash
git clone https://github.com/Mrx112/nexlab.git
cd nexlab
pip install -r requirements.txt
python run.py --open
```

Opsi `run.py`:
- `--host 0.0.0.0` — listen di semua antarmuka (default).
- `--port 8080` — port HTTP.
- `--data <path>` — lokasi folder data.
- `--cert <fullchain.pem> --key <privkey.pem>` — mengaktifkan HTTPS.
- `--open` — membuka browser otomatis.

## Menghubungkan ke Perangkat Fisik

NexLab mendukung dua alur koneksi ke perangkat fisik:

### 1. Kelola perangkat dari browser (console)

Komputer server NexLab harus dapat menjangkau IP manajemen switch/router. Di editor:

1. Tambahkan node **Perangkat Fisik**.
2. Isi **IP manajemen**, pilih **SSH** atau **Telnet**.
3. Tekan **Uji ping dari server**.
4. Buka **Console** dan masukkan kredensial perangkat.

Console ini menjalankan sesi CLI langsung dari browser ke perangkat melalui komputer server. Pastikan SSH/Telnet diaktifkan di perangkat dan akun Anda memiliki hak konfigurasi. Perangkat dapat memblokir ICMP — kegagalan ping tidak selalu berarti SSH/Telnet tidak dapat diakses.

### 2. Bridge Layer 2 ke jaringan fisik (Linux + root)

Ini memungkinkan VM QEMU atau Linux Host di lab berbagi segmen jaringan yang sama dengan perangkat fisik di LAN.

#### Persiapan NIC

**Menggunakan NIC kedua (disarankan):**
- Colokkan NIC kedua (USB LAN adapter juga bisa) ke switch/router fisik.

**Menggunakan NIC utama (lebih lanjut):**
- Jalankan `sudo scripts/make-bridge.sh eth0` untuk membuat bridge `pnet0`.
- Script ini memindahkan IP dan gateway dari NIC ke bridge, sehingga koneksi jaringan tetap berfungsi.

```bash
sudo scripts/make-bridge.sh eth0          # buat bridge pnet0 dari eth0
sudo scripts/make-bridge.sh eth0 pnet0 undo  # kembalikan (hapus bridge, kembalikan IP)
```

> **Peringatan**: Jangan jalankan dari sesi SSH yang sama dengan NIC yang di-bridge. Gunakan console lokal atau IPMI.

#### Konfigurasi di Editor

1. Tambahkan node **Cloud** ke topologi.
2. Pada properti Cloud, pilih **target** = `pnet0` atau NIC kedua.
3. Sambungkan node **QEMU VM** atau **Linux Host** ke node Cloud.

Setiap kabel antar node real akan otomatis dibuat sebagai **Linux bridge** dengan properti:
- STP dinonaktifkan (`stp_state 0`) — buat konfigurasi lab.
- `group_fwd_mask 65535` — meneruskan semua Ethernet frame termasuk LLDP/CDP/ARP.
- Promiscuous mode aktif otomatis lewat TAP/bridge.

## Firewall & Routing

### Windows Firewall — izinkan akses ke NexLab

Jalankan sebagai Administrator (atau gunakan script otomatis `scripts/firewall-windows.bat`):

```bat
netsh advfirewall firewall add rule name="NexLab 8080" dir=in action=allow protocol=TCP localport=8080 profile=private,domain
```

Jika komputer terhubung ke jaringan "Public", ubah profil jaringan ke **Private** di *Settings → Network & Internet*.

### Firewall ICMP (Linux)

```bash
sudo iptables -A INPUT -p icmp --icmp-type echo-request -j ACCEPT
sudo iptables -A INPUT -p icmp --icmp-type echo-reply -j ACCEPT
```

### Static Route (opsional)

Jika lab berada di subnet berbeda dan Anda ingin mengaksesnya dari jaringan LAN:

```bash
# Tambahkan route statis di router LAN:
# ip route 192.168.1.0/24 via <IP_NexLab>
```

Atau gunakan route di host itu sendiri:
```bash
sudo ip route add 192.168.137.0/24 dev pnet0
```

### Spanning Tree PortFast

Port yang menghubungkan ke perangkat fisik akan otomatis di-setup **PortFast** (bypass STP listening/learning delay) agar koneksi layer 2 langsung aktif:

```
interface GigabitEthernet0/1
 spanning-tree portfast
 spanning-tree bpduguard enable
```

Di NexLab simulation engine, port switch yang baru terhubung akan melewati simulasi STP sebagai berikut:

| State | Durasi | Deskripsi |
|---|---|---|
| LISTENING | 15 detik | Port mendengarkan BPDU, belum memForward frame |
| LEARNING | 15 detik | Port mempelajari MAC address |
| FORWARDING | permanen | Port siap meneruskan frame |

Selama LISTENING dan LEARNING, `show ip interface brief` akan menampilkan protokol **down**. Port akan otomatis berubah ke **FORWARDING** setelah ~30 detik. Port yang sudah berada di forwarding tidak perlu menunggu lagi pada restart selanjutnya.

## Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| Ping ke perangkat fisik gagal | Firewall memblokir ICMP | Izinkan ICMP di firewall |
| Node QEMU tidak dapat IP DHCP | Bridge tidak meneruskan broadcast | Pastikan `group_fwd_mask` benar |
| Console kosong setelah start VM | TAP device tidak terhubung | Cek `ip link show` dan log QEMU |
| Lab tidak bisa diakses dari jaringan lain | Firewall atau routing tidak benar | Buka port di firewall, tambahkan static route |

## Selanjutnya

- Lihat [README.md](../README.md) untuk ikhtisar fitur dan panduan aplikasi.
- Buka `WebSite/document.html` untuk panduan penggunaan lengkap.
