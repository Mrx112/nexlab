/* NexLab knowledge base — tutorial konfigurasi (bahasa Indonesia).
   Format langkah: [judul, penjelasan, perangkat, perintah]  (perangkat/perintah boleh kosong) */
const GUIDE_CATS = ['Instalasi NexLab', 'Dasar', 'Switching', 'Routing', 'Layanan', 'Keamanan', 'Wireless', 'Fiber / FTTH', 'Instalasi & kabel', 'Server & script', 'Perangkat real', 'MikroTik', 'Linux', 'Troubleshooting', 'Kalkulator'];

const GUIDE_KB = [
{ id: 'install-windows', cat: 'Instalasi NexLab', lvl: 'Pemula', title: 'Menjalankan NexLab di Windows',
  kw: 'windows install instalasi pasang jalankan server exe bat python firewall autostart startup winget qemu whpx',
  intro: 'NexLab berjalan native di Windows 10/11. Semua fitur simulasi, Peta 3D, panduan dan console Perangkat Fisik tersedia. VM QEMU berjalan dengan jaringan socket (tanpa hak admin).',
  steps: [
    ['Pasang', 'Ekstrak zip, lalu klik ganda install-windows.bat. Installer mencari Python (atau menawarkan pemasangan lewat winget), membuat .venv, memasang dependensi, dan opsional memasang QEMU serta autostart saat login.', '', ''],
    ['Jalankan', 'Klik ganda start-windows.bat. Browser terbuka otomatis ke http://localhost:8080/.', 'PowerShell / CMD', 'start-windows.bat\nstart-windows.bat --port 8090'],
    ['Buka dari komputer lain', 'Klik kanan scripts\\firewall-windows.bat → Run as administrator untuk membuka port 8080, pastikan profil jaringan Private, lalu buka http://IP-komputer:8080/ dari perangkat lain.', 'CMD (admin)', 'netsh advfirewall firewall add rule name="NexLab 8080" dir=in action=allow protocol=TCP localport=8080'],
    ['Akselerasi VM (opsional)', 'Bawaan memakai emulasi TCG. Jika fitur Windows Hypervisor Platform aktif, coba akselerasi WHPX:', 'CMD', 'set NEXLAB_ACCEL=whpx\nstart-windows.bat'],
    ['Versi .exe tanpa Python (opsional)', 'Buat aplikasi mandiri yang bisa disalin ke PC lain:', 'CMD', 'py scripts\\build-app.py\nREM hasil: dist\\NexLab\\NexLab.exe'],
  ],
  tips: ['Node Linux Host dan bridge ke NIC fisik khusus server Linux. Di Windows gunakan QEMU dengan image Linux kecil (Alpine) dan node Cloud (NAT).', 'Setelah mengubah kabel VM QEMU, matikan lalu nyalakan ulang VM tersebut.', 'Image QEMU ditaruh di data\\images\\qemu\\<nama>\\file.qcow2.'] },
{ id: 'install-macos', cat: 'Instalasi NexLab', lvl: 'Pemula', title: 'Menjalankan NexLab di macOS',
  kw: 'macos mac macbook apple install instalasi pasang jalankan command homebrew brew launchagent hvf qemu gatekeeper',
  intro: 'NexLab berjalan di macOS (Intel dan Apple Silicon).',
  steps: [
    ['Pasang', 'Ekstrak zip, klik kanan install-macos.command → Open (agar Gatekeeper mengizinkan). Installer memakai Python 3 (atau menawarkan Homebrew), membuat .venv, dan opsional memasang QEMU serta LaunchAgent.', 'Terminal', 'cd ~/Downloads/nexlab\nxattr -dr com.apple.quarantine .\n./install-macos.command'],
    ['Jalankan', 'Klik ganda start-macos.command. Saat macOS bertanya "accept incoming network connections", pilih Allow agar bisa diakses dari komputer lain.', 'Terminal', './start-macos.command\n./start-macos.command --port 8090'],
    ['QEMU', 'Mac Intel memakai akselerasi HVF. Di Apple Silicon (M1/M2/M3), image x86 berjalan dengan emulasi (lebih lambat) — pilih image ringan.', 'Terminal', 'brew install qemu'],
  ],
  tips: ['Cek IP Mac: System Settings → Network, atau perintah ipconfig getifaddr en0.', 'Hapus autostart: launchctl unload ~/Library/LaunchAgents/com.nexlab.server.plist'] },
{ id: 'install-linux', cat: 'Instalasi NexLab', lvl: 'Pemula', title: 'Menjalankan NexLab di Linux (fitur paling lengkap)',
  kw: 'linux ubuntu debian install instalasi sudo systemd service bridge kvm',
  intro: 'Di Linux dengan sudo, semua fitur real aktif: bridge ke NIC fisik, Linux Host (namespace), KVM, dan kabel VM bisa diubah tanpa restart.',
  steps: [['Pasang & jalankan', '', 'Terminal', './install.sh\nsudo ./start.sh']] },
// ======================================================================= DASAR
{ id: 'cli-mode', cat: 'Dasar', lvl: 'Pemula', title: 'Mengenal mode CLI Cisco IOS',
  kw: 'cli mode dasar perintah command enable configure terminal privileged user exec bantuan tanda tanya tab singkatan do',
  intro: 'Semua router, switch, firewall dan OLT di NexLab memakai CLI ala Cisco IOS. Ada beberapa mode berjenjang; prompt menunjukkan mode yang sedang aktif.',
  steps: [
    ['Mode user (R1>)', 'Mode awal saat console dibuka. Hanya bisa ping, traceroute dan sebagian show.', 'Router', 'ping 192.168.1.1\nshow version'],
    ['Mode privileged (R1#)', 'Masuk dengan enable. Di sini semua perintah show, simpan konfigurasi, reload.', 'Router', 'enable\nshow running-config'],
    ['Mode konfigurasi global (R1(config)#)', 'Untuk mengubah pengaturan perangkat.', 'Router', 'configure terminal\nhostname R1'],
    ['Mode interface (R1(config-if)#)', 'Masuk ke interface tertentu. Gunakan singkatan seperti g0/0 atau fa0/1.', 'Router', 'interface g0/0\ndescription Ke-LAN\nexit'],
    ['Kembali dan menjalankan show dari mode config', 'exit naik satu level, end langsung ke privileged. do menjalankan perintah privileged dari mode config.', 'Router', 'do show ip interface brief\nend'],
  ],
  tips: ['Tekan ? untuk melihat pilihan perintah, misalnya "show ?" atau "sh ip ?".', 'Tekan Tab untuk melengkapi kata, misalnya "conf" + Tab menjadi "configure".', 'Singkatan diterima selama unik: "sh ip int br" = "show ip interface brief".', 'Filter output: "show run | include interface" atau "show run | section router".', 'Ctrl+Z dari mode config langsung kembali ke mode privileged.'] },

{ id: 'basic-setup', cat: 'Dasar', lvl: 'Pemula', title: 'Setting awal perangkat: hostname, password, banner',
  kw: 'awal hostname nama password sandi kata sandi enable secret console banner motd keamanan dasar setting pertama inisialisasi',
  intro: 'Konfigurasi yang biasanya dilakukan pertama kali pada router atau switch baru.',
  steps: [
    ['Nama perangkat & matikan DNS lookup', 'no ip domain-lookup mencegah router "mencari" DNS saat salah ketik perintah.', 'Router/Switch', 'enable\nconfigure terminal\nhostname R1\nno ip domain-lookup'],
    ['Password mode privileged', 'Gunakan enable secret (terenkripsi), bukan enable password.', 'Router/Switch', 'enable secret cisco123'],
    ['Password console', 'Saat console dibuka akan diminta password.', 'Router/Switch', 'line console 0\npassword konsol123\nlogin\nexit'],
    ['Enkripsi password & banner', 'service password-encryption menyamarkan password plain-text di running-config.', 'Router/Switch', 'service password-encryption\nbanner motd #Hanya untuk yang berwenang#\nend'],
    ['Simpan', 'Konfigurasi baru aktif seketika, tetapi hilang saat reload bila tidak disimpan.', 'Router/Switch', 'write memory'],
  ],
  verify: ['Router/Switch', 'show running-config | section line\nshow startup-config'],
  tips: ['Uji password console: ketik exit sampai keluar, lalu tekan Enter.', 'Lupa password di lab? Klik kanan node → Reset ke pabrik.'] },

{ id: 'ip-interface', cat: 'Dasar', lvl: 'Pemula', title: 'Memberi alamat IP pada interface router',
  kw: 'ip alamat address interface router gateway no shutdown aktifkan port setting ip router',
  intro: 'Interface router default dalam keadaan shutdown. Setiap interface router mewakili satu jaringan (subnet) berbeda.',
  steps: [
    ['Masuk interface dan beri IP', '', 'Router', 'enable\nconfigure terminal\ninterface g0/0\nip address 192.168.1.1 255.255.255.0\nno shutdown\nexit'],
    ['Interface kedua (jaringan lain)', '', 'Router', 'interface g0/1\nip address 192.168.2.1 255.255.255.0\nno shutdown\nend'],
  ],
  verify: ['Router', 'show ip interface brief\nshow ip route connected'],
  tips: ['Status "administratively down" berarti belum no shutdown.', 'Status "down/down" berarti kabel belum terpasang atau perangkat lawan mati.', 'Dua interface tidak boleh berada di subnet yang sama (muncul pesan overlaps).', 'IP router biasanya dipakai sebagai default gateway PC.'] },

{ id: 'ip-pc', cat: 'Dasar', lvl: 'Pemula', title: 'Setting IP PC / laptop (static & DHCP)',
  kw: 'ip pc komputer laptop client static statis dhcp otomatis ipconfig gateway dns alamat host end device',
  intro: 'IP PC bisa diatur lewat panel kanan (Konfigurasi IP) atau lewat Command Prompt PC.',
  steps: [
    ['Static lewat Command Prompt', 'Format: ipconfig IP MASK GATEWAY', 'PC', 'ipconfig 192.168.1.10 255.255.255.0 192.168.1.1\nip dns 192.168.1.1'],
    ['Gaya VPCS (singkat)', '', 'PC', 'ip 192.168.1.11/24 192.168.1.1'],
    ['Minta IP dari DHCP', 'Butuh DHCP server di router/server pada jaringan yang sama atau relay.', 'PC', 'ipconfig /renew'],
    ['Lihat konfigurasi', '', 'PC', 'ipconfig /all'],
  ],
  verify: ['PC', 'ping 192.168.1.1'],
  tips: ['Ping pertama kadang 1 paket hilang karena proses ARP — itu normal.', 'Gateway harus berada di subnet yang sama dengan IP PC.'] },

{ id: 'save-config', cat: 'Dasar', lvl: 'Pemula', title: 'Menyimpan, melihat & reset konfigurasi',
  kw: 'simpan save write memory copy running startup config backup reset hapus erase reload restart',
  intro: 'running-config ada di RAM (aktif sekarang). startup-config ada di NVRAM dan dipakai saat perangkat menyala ulang.',
  steps: [
    ['Simpan', 'Kedua perintah ini sama fungsinya.', 'Router/Switch', 'write memory\ncopy running-config startup-config'],
    ['Bandingkan', '', 'Router/Switch', 'show running-config\nshow startup-config'],
    ['Kembalikan ke konfigurasi tersimpan', 'reload memuat ulang dari startup-config.', 'Router/Switch', 'reload'],
    ['Hapus konfigurasi tersimpan', 'Setelah erase, lakukan reload untuk benar-benar kosong.', 'Router/Switch', 'erase startup-config\nreload'],
  ],
  tips: ['Tombol Config di panel kanan menampilkan running & startup-config dan bisa disalin.', 'Ekspor seluruh lab (topologi + config) dengan tombol Ekspor di editor.'] },

// ======================================================================= SWITCHING
{ id: 'vlan', cat: 'Switching', lvl: 'Pemula', title: 'Membuat VLAN & port access',
  kw: 'vlan virtual lan pisah segmentasi jaringan divisi access port switch switchport broadcast domain',
  intro: 'VLAN memisahkan satu switch fisik menjadi beberapa jaringan logis. Port access hanya membawa satu VLAN dan dipakai untuk PC/printer/AP.',
  steps: [
    ['Buat VLAN dan beri nama', '', 'Switch', 'enable\nconfigure terminal\nvlan 10\nname STAFF\nvlan 20\nname GUEST\nexit'],
    ['Masukkan port ke VLAN', 'interface range mengatur banyak port sekaligus.', 'Switch', 'interface range fa0/1 - 10\nswitchport mode access\nswitchport access vlan 10\nexit\ninterface range fa0/11 - 20\nswitchport mode access\nswitchport access vlan 20\nend'],
    ['Simpan', '', 'Switch', 'write memory'],
  ],
  verify: ['Switch', 'show vlan brief\nshow interfaces status'],
  tips: ['PC di VLAN berbeda tidak bisa saling ping tanpa router (inter-VLAN routing).', 'Jika VLAN belum dibuat, switchport access vlan akan otomatis membuatnya.', 'Gunakan subnet IP berbeda untuk tiap VLAN, misalnya VLAN 10 = 192.168.10.0/24.'] },

{ id: 'trunk', cat: 'Switching', lvl: 'Pemula', title: 'Trunk antar switch / ke router (allowed & native VLAN)',
  kw: 'trunk tagging 802.1q dot1q allowed native vlan uplink antar switch tag banyak vlan',
  intro: 'Trunk membawa banyak VLAN dalam satu kabel dengan tag 802.1Q. Dipakai antar switch dan dari switch ke router (router-on-a-stick).',
  steps: [
    ['Set port uplink sebagai trunk', 'Lakukan di kedua ujung kabel.', 'Switch', 'configure terminal\ninterface g0/1\nswitchport mode trunk\nswitchport trunk allowed vlan 10,20,99\nswitchport trunk native vlan 99\nend'],
    ['Menambah/mengurangi VLAN pada trunk', '', 'Switch', 'configure terminal\ninterface g0/1\nswitchport trunk allowed vlan add 30\nswitchport trunk allowed vlan remove 20\nend'],
  ],
  verify: ['Switch', 'show interfaces trunk'],
  tips: ['Native VLAN harus sama di kedua sisi trunk.', 'VLAN harus ada (dibuat) di setiap switch yang dilewati.', 'Jangan memakai VLAN 1 untuk data; sebaiknya native VLAN khusus yang tidak dipakai.'] },

{ id: 'roas', cat: 'Switching', lvl: 'Menengah', title: 'Inter-VLAN routing: router-on-a-stick',
  kw: 'inter vlan routing router on a stick subinterface sub interface dot1q encapsulation antar vlan beda vlan komunikasi',
  intro: 'Satu interface fisik router dibagi menjadi sub-interface, satu per VLAN. Switch terhubung ke router dengan trunk.',
  steps: [
    ['Switch: buat VLAN & trunk ke router', '', 'Switch', 'configure terminal\nvlan 10\nvlan 20\ninterface fa0/1\nswitchport access vlan 10\ninterface fa0/2\nswitchport access vlan 20\ninterface g0/1\nswitchport mode trunk\nend'],
    ['Router: aktifkan interface fisik', 'Interface fisik tidak diberi IP.', 'Router', 'configure terminal\ninterface g0/0\nno shutdown\nexit'],
    ['Router: sub-interface per VLAN', 'encapsulation dot1Q harus sebelum ip address.', 'Router', 'interface g0/0.10\nencapsulation dot1Q 10\nip address 192.168.10.1 255.255.255.0\nexit\ninterface g0/0.20\nencapsulation dot1Q 20\nip address 192.168.20.1 255.255.255.0\nend'],
    ['PC: gunakan IP sub-interface sebagai gateway', '', 'PC VLAN 10', 'ipconfig 192.168.10.10 255.255.255.0 192.168.10.1'],
  ],
  verify: ['Router', 'show ip interface brief\nshow ip route'],
  tips: ['Lihat lab "Demo lengkap terkonfigurasi" sebagai contoh jadi.', 'Jika ping antar VLAN gagal, cek trunk (show interfaces trunk) dan gateway PC.'] },

{ id: 'svi', cat: 'Switching', lvl: 'Menengah', title: 'Inter-VLAN routing dengan Switch L3 (SVI)',
  kw: 'switch layer 3 l3 multilayer svi interface vlan ip routing inter vlan mls 3650 routing di switch',
  intro: 'Switch L3 bisa routing antar VLAN sendiri tanpa router, memakai interface Vlan (SVI).',
  steps: [
    ['Aktifkan routing & buat VLAN', '', 'Switch L3', 'enable\nconfigure terminal\nip routing\nvlan 10\nvlan 20\nexit'],
    ['Buat SVI sebagai gateway tiap VLAN', '', 'Switch L3', 'interface vlan 10\nip address 192.168.10.1 255.255.255.0\nno shutdown\ninterface vlan 20\nip address 192.168.20.1 255.255.255.0\nno shutdown\nexit'],
    ['Masukkan port ke VLAN', 'SVI baru "up" jika ada port aktif di VLAN-nya.', 'Switch L3', 'interface g1/0/1\nswitchport access vlan 10\ninterface g1/0/2\nswitchport access vlan 20\nend'],
    ['(Opsional) port routed ke router/internet', 'no switchport menjadikan port seperti interface router.', 'Switch L3', 'configure terminal\ninterface g1/0/24\nno switchport\nip address 10.0.0.2 255.255.255.252\nexit\nip route 0.0.0.0 0.0.0.0 10.0.0.1\nend'],
  ],
  verify: ['Switch L3', 'show ip interface brief\nshow ip route'] },

{ id: 'switch-mgmt', cat: 'Switching', lvl: 'Pemula', title: 'IP manajemen switch L2 & default gateway',
  kw: 'manajemen management ip switch remote switch default gateway vlan 1 svi switch l2 telnet ke switch',
  intro: 'Switch L2 tidak melakukan routing, tetapi bisa diberi IP manajemen agar dapat di-ping, di-telnet atau di-SSH.',
  steps: [
    ['IP pada VLAN manajemen', '', 'Switch', 'configure terminal\ninterface vlan 1\nip address 192.168.1.2 255.255.255.0\nno shutdown\nexit'],
    ['Default gateway', 'Agar switch bisa dijangkau dari jaringan lain.', 'Switch', 'ip default-gateway 192.168.1.1\nend'],
  ],
  verify: ['Switch', 'show ip interface brief\nshow ip route'],
  tips: ['Praktik baik: gunakan VLAN manajemen khusus (mis. VLAN 99) bukan VLAN 1.'] },

// ======================================================================= ROUTING
{ id: 'static', cat: 'Routing', lvl: 'Pemula', title: 'Routing statis & default route',
  kw: 'routing statis static route rute jalur default route gateway of last resort ip route 0.0.0.0 internet antar router',
  intro: 'Route statis diisi manual: "untuk menuju jaringan X, lewat next-hop Y". Default route (0.0.0.0/0) dipakai untuk semua tujuan yang tidak dikenal, mis. internet.',
  steps: [
    ['Route ke jaringan di belakang router lain', 'Format: ip route NETWORK MASK NEXT-HOP', 'R1', 'configure terminal\nip route 192.168.2.0 255.255.255.0 10.0.12.2\nend'],
    ['Route balik di router lawan', 'Lalu lintas harus punya jalur pergi dan pulang!', 'R2', 'configure terminal\nip route 192.168.1.0 255.255.255.0 10.0.12.1\nend'],
    ['Default route', '', 'R1', 'configure terminal\nip route 0.0.0.0 0.0.0.0 10.0.12.2\nend'],
    ['Route cadangan (floating static)', 'Angka terakhir = administrative distance; lebih besar = cadangan.', 'R1', 'configure terminal\nip route 0.0.0.0 0.0.0.0 10.0.13.2 5\nend'],
  ],
  verify: ['R1', 'show ip route\nshow ip route static\ntraceroute 192.168.2.10'],
  tips: ['Ping gagal tapi route sudah ada? Hampir selalu route baliknya yang lupa.', 'Next-hop harus IP router tetangga yang berada di subnet yang sama.'] },

{ id: 'ospf', cat: 'Routing', lvl: 'Menengah', title: 'OSPF single area',
  kw: 'ospf dynamic routing dinamis link state area 0 network wildcard neighbor tetangga otomatis rute',
  intro: 'OSPF bertukar rute otomatis antar router. Setiap jaringan yang ingin diiklankan dimasukkan dengan network + wildcard + area.',
  steps: [
    ['Aktifkan OSPF di R1', 'Wildcard = kebalikan subnet mask (255.255.255.0 → 0.0.0.255).', 'R1', 'configure terminal\nrouter ospf 1\nrouter-id 1.1.1.1\nnetwork 192.168.1.0 0.0.0.255 area 0\nnetwork 10.0.12.0 0.0.0.3 area 0\nend'],
    ['Aktifkan OSPF di R2', '', 'R2', 'configure terminal\nrouter ospf 1\nrouter-id 2.2.2.2\nnetwork 192.168.2.0 0.0.0.255 area 0\nnetwork 10.0.12.0 0.0.0.3 area 0\nend'],
  ],
  verify: ['R1', 'show ip ospf neighbor\nshow ip route ospf\nshow ip protocols'],
  tips: ['Rute OSPF ditandai O dengan AD 110.', 'Cara cepat (lab): network 0.0.0.0 255.255.255.255 area 0 mengikutkan semua interface.', 'Kalkulator wildcard ada di kategori Kalkulator.'] },

{ id: 'ospf-adv', cat: 'Routing', lvl: 'Lanjut', title: 'OSPF: passive-interface & default-information originate',
  kw: 'ospf passive interface default information originate default route internet router id lanjut keamanan ospf',
  intro: 'passive-interface menghentikan hello OSPF ke arah LAN (jaringan tetap diiklankan). default-information originate menyebarkan default route ke semua router OSPF.',
  steps: [
    ['Passive ke LAN', '', 'R1', 'configure terminal\nrouter ospf 1\npassive-interface g0/0\nend'],
    ['Router edge mengiklankan default route', 'Router harus punya default route statis terlebih dahulu.', 'R-Edge', 'configure terminal\nip route 0.0.0.0 0.0.0.0 203.0.113.1\nrouter ospf 1\ndefault-information originate\nend'],
  ],
  verify: ['R1', 'show ip route\nshow ip protocols'],
  tips: ['Router lain akan menerima rute O*E2 0.0.0.0/0.'] },

{ id: 'rip', cat: 'Routing', lvl: 'Pemula', title: 'RIP versi 2',
  kw: 'rip routing information protocol distance vector hop dinamis versi 2 no auto summary',
  intro: 'RIP memilih jalur berdasarkan jumlah hop (maks 15). Cocok untuk belajar konsep routing dinamis.',
  steps: [
    ['Aktifkan RIPv2', 'network ditulis dengan alamat classful.', 'Router', 'configure terminal\nrouter rip\nversion 2\nno auto-summary\nnetwork 192.168.1.0\nnetwork 10.0.0.0\nend'],
  ],
  verify: ['Router', 'show ip route rip\nshow ip protocols'],
  tips: ['Jika OSPF dan RIP sama-sama memberi rute, OSPF (AD 110) menang atas RIP (AD 120).'] },

// ======================================================================= LAYANAN
{ id: 'dhcp-router', cat: 'Layanan', lvl: 'Pemula', title: 'DHCP server di router',
  kw: 'dhcp server ip otomatis pool router excluded address lease default router dns pembagian ip',
  intro: 'Router membagikan IP otomatis ke client. Kecualikan dulu alamat yang dipakai statis (gateway, server, printer).',
  steps: [
    ['Kecualikan alamat statis', '', 'Router', 'configure terminal\nip dhcp excluded-address 192.168.1.1 192.168.1.20'],
    ['Buat pool', '', 'Router', 'ip dhcp pool LAN\nnetwork 192.168.1.0 255.255.255.0\ndefault-router 192.168.1.1\ndns-server 8.8.8.8\nexit\nend'],
    ['Client meminta IP', '', 'PC', 'ipconfig /renew'],
  ],
  verify: ['Router', 'show ip dhcp binding\nshow ip dhcp pool'],
  tips: ['Interface router di jaringan tersebut harus up dan punya IP dalam network pool.'] },

{ id: 'dhcp-relay', cat: 'Layanan', lvl: 'Menengah', title: 'DHCP relay (ip helper-address)',
  kw: 'dhcp relay helper address beda jaringan server dhcp terpusat broadcast agent',
  intro: 'DHCP memakai broadcast yang tidak melewati router. ip helper-address meneruskan permintaan ke DHCP server di jaringan lain.',
  steps: [
    ['Di interface gateway client', '', 'Router', 'configure terminal\ninterface g0/0\nip helper-address 172.16.0.10\nend'],
    ['DHCP server punya pool untuk subnet client', 'Bisa router lain atau perangkat Server (panel kanan → Layanan DHCP).', 'Router DHCP', 'configure terminal\nip dhcp pool VLAN10\nnetwork 192.168.10.0 255.255.255.0\ndefault-router 192.168.10.1\nend'],
  ],
  verify: ['PC', 'ipconfig /renew'] },

{ id: 'server-services', cat: 'Layanan', lvl: 'Pemula', title: 'DHCP, DNS & web di perangkat Server',
  kw: 'server dhcp dns http web layanan service domain nama record nslookup pool server pt',
  intro: 'Perangkat Server punya layanan seperti di Packet Tracer: DHCP, DNS dan HTTP. Atur dari panel kanan saat Server dipilih.',
  steps: [
    ['IP statis server', 'Isi di panel kanan atau lewat console.', 'Server', 'ipconfig 172.16.0.10 255.255.255.0 172.16.0.1'],
    ['DHCP', 'Centang Aktifkan DHCP server, isi IP awal, jumlah, gateway, DNS. Lalu Simpan layanan.', '', ''],
    ['DNS', 'Centang Aktifkan DNS, isi record satu per baris: "web.lab.local 172.16.0.10".', '', ''],
    ['HTTP', 'Centang web server dan ubah isi index.html.', '', ''],
    ['Uji dari PC', '', 'PC', 'ip dns 172.16.0.10\nnslookup web.lab.local\nbrowser web.lab.local\ncurl http://172.16.0.10/'],
  ] },

{ id: 'dns', cat: 'Layanan', lvl: 'Pemula', title: 'DNS: menerjemahkan nama ke IP',
  kw: 'dns domain nama name server resolve nslookup record a hostname',
  intro: 'DNS membuat PC bisa memakai nama (mis. web.lab.local) alih-alih IP.',
  steps: [
    ['Set DNS server di PC', '', 'PC', 'ip dns 172.16.0.10'],
    ['Uji', '', 'PC', 'nslookup web.lab.local\nping web.lab.local'],
  ],
  tips: ['Record DNS dibuat di perangkat Server (lihat "DHCP, DNS & web di perangkat Server").'] },

{ id: 'http', cat: 'Layanan', lvl: 'Pemula', title: 'Web server & akses web dari PC',
  kw: 'web http halaman browser curl website server port 80 html',
  intro: 'Server dapat menyajikan halaman HTML yang bisa dibuka dari PC lain.',
  steps: [
    ['Aktifkan & isi halaman', 'Panel kanan Server → Layanan HTTP → isi index.html → Simpan layanan.', '', ''],
    ['Buka dari PC', 'browser menampilkan teks, curl menampilkan HTML mentah.', 'PC', 'browser 172.16.0.10\ncurl http://172.16.0.10/'],
  ],
  tips: ['ACL yang memblok tcp eq 80 akan membuat curl timeout — cara bagus untuk menguji firewall.'] },

// ======================================================================= KEAMANAN
{ id: 'acl-extended', cat: 'Keamanan', lvl: 'Menengah', title: 'Firewall dengan ACL Extended (blokir ping, web, SSH)',
  kw: 'firewall acl access list extended blokir block izinkan permit deny filter keamanan port tcp udp icmp ping web ssh telnet proteksi',
  intro: 'ACL extended memfilter berdasarkan protokol, IP sumber, IP tujuan dan port. ACL dibaca dari atas ke bawah; di akhir selalu ada "deny any" tersembunyi, jadi tambahkan permit di akhir.',
  steps: [
    ['Buat aturan', '100–199 = ACL extended bernomor.', 'Router/Firewall', 'configure terminal\naccess-list 110 deny icmp 192.168.20.0 0.0.0.255 172.16.0.0 0.0.0.255\naccess-list 110 deny tcp 192.168.20.0 0.0.0.255 host 172.16.0.10 eq 22\naccess-list 110 deny tcp 192.168.20.0 0.0.0.255 any eq 80\naccess-list 110 permit ip any any'],
    ['Pasang di interface', 'in = paket yang masuk ke router dari interface itu. Pasang extended ACL sedekat mungkin dengan sumber.', 'Router/Firewall', 'interface g0/0.20\nip access-group 110 in\nend'],
    ['Uji dari client', '', 'PC Guest', 'ping 172.16.0.10\nssh -l admin 172.16.0.10\ncurl http://172.16.0.10/'],
  ],
  verify: ['Router/Firewall', 'show access-lists\nshow running-config | include access'],
  tips: ['Hit counter "(n match(es))" di show access-lists menunjukkan aturan mana yang kena.', 'Kalau semua lalu lintas tiba-tiba putus, kemungkinan lupa "permit ip any any".', 'Hapus satu ACL: no access-list 110. Lepas dari interface: no ip access-group 110 in.', 'Nama port yang dikenal: telnet, ssh, www/http, https, domain, ftp, bootps.'] },

{ id: 'acl-standard', cat: 'Keamanan', lvl: 'Pemula', title: 'ACL Standard (filter berdasarkan IP sumber)',
  kw: 'acl standard access list standar sumber source filter blokir host jaringan 1-99',
  intro: 'ACL standard (1–99) hanya melihat IP sumber. Pasang sedekat mungkin dengan tujuan.',
  steps: [
    ['Blok satu host, izinkan sisanya', '', 'Router', 'configure terminal\naccess-list 10 deny host 192.168.1.50\naccess-list 10 permit any'],
    ['Pasang keluar ke arah tujuan', '', 'Router', 'interface g0/1\nip access-group 10 out\nend'],
  ],
  verify: ['Router', 'show access-lists'] },

{ id: 'acl-named', cat: 'Keamanan', lvl: 'Menengah', title: 'ACL bernama (named ACL)',
  kw: 'named acl ip access-list extended standard nama acl mudah dibaca',
  intro: 'Sama seperti ACL bernomor, tetapi diberi nama sehingga lebih mudah dibaca dan dirawat.',
  steps: [
    ['Buat ACL bernama', '', 'Router', 'configure terminal\nip access-list extended BLOK-GUEST\ndeny ip 192.168.20.0 0.0.0.255 192.168.10.0 0.0.0.255\npermit ip any any\nexit'],
    ['Pasang', '', 'Router', 'interface g0/0.20\nip access-group BLOK-GUEST in\nend'],
  ],
  verify: ['Router', 'show access-lists'] },

{ id: 'firewall-vlan', cat: 'Keamanan', lvl: 'Menengah', title: 'Isolasi VLAN tamu (guest) dari jaringan kantor',
  kw: 'firewall isolasi tamu guest wifi tamu pisah kantor blokir antar vlan keamanan segmentasi',
  intro: 'Tamu boleh ke internet/server publik tetapi tidak boleh masuk ke jaringan staf.',
  steps: [
    ['ACL di gateway VLAN tamu', '', 'Router', 'configure terminal\nip access-list extended GUEST-IN\ndeny ip 192.168.20.0 0.0.0.255 192.168.10.0 0.0.0.255\ndeny ip 192.168.20.0 0.0.0.255 192.168.99.0 0.0.0.255\npermit ip any any\nexit\ninterface g0/0.20\nip access-group GUEST-IN in\nend'],
  ],
  verify: ['PC Guest', 'ping 192.168.10.10\nping 172.16.0.10'] },

{ id: 'ssh', cat: 'Keamanan', lvl: 'Menengah', title: 'Remote akses aman dengan SSH',
  kw: 'ssh secure shell remote jarak jauh akses aman login username rsa crypto key vty transport input',
  intro: 'SSH mengenkripsi sesi remote. Syarat: hostname, domain-name, kunci RSA, user lokal, dan vty memakai login local.',
  steps: [
    ['Domain & kunci RSA', '', 'Router/Switch', 'configure terminal\nhostname R1\nip domain-name lab.local\ncrypto key generate rsa modulus 1024'],
    ['User lokal', 'privilege 15 langsung masuk mode #.', 'Router/Switch', 'username admin privilege 15 secret admin123\nenable secret cisco'],
    ['VTY hanya SSH', '', 'Router/Switch', 'line vty 0 4\nlogin local\ntransport input ssh\nend\nwrite memory'],
    ['Uji dari PC atau router lain', '', 'PC', 'ssh -l admin 192.168.1.1'],
  ],
  verify: ['Router/Switch', 'show running-config | section line'],
  tips: ['Pastikan PC bisa ping ke IP router terlebih dahulu.'] },

{ id: 'telnet', cat: 'Keamanan', lvl: 'Pemula', title: 'Telnet ke router/switch',
  kw: 'telnet remote vty password login akses jarak jauh tidak aman',
  intro: 'Telnet tidak terenkripsi — pakai hanya untuk belajar; di produksi gunakan SSH.',
  steps: [
    ['Password vty', '', 'Router/Switch', 'configure terminal\nline vty 0 4\npassword cisco\nlogin\nexit\nenable secret cisco\nend'],
    ['Uji', '', 'PC', 'telnet 192.168.1.1'],
  ],
  tips: ['Tanpa enable secret/password, pengguna telnet tidak bisa masuk mode # ("% No password set").'] },

{ id: 'port-security', cat: 'Keamanan', lvl: 'Menengah', title: 'Port security (untuk perangkat asli)',
  kw: 'port security mac address sticky maximum violation shutdown keamanan port switch',
  intro: 'Membatasi MAC yang boleh memakai port switch. Di NexLab perintah ini tersimpan di konfigurasi, tetapi efeknya belum disimulasikan — gunakan untuk persiapan konfigurasi perangkat asli/QEMU.',
  steps: [
    ['Konfigurasi', '', 'Switch', 'configure terminal\ninterface fa0/1\nswitchport mode access\nswitchport port-security\nswitchport port-security maximum 2\nswitchport port-security mac-address sticky\nswitchport port-security violation shutdown\nend'],
  ],
  verify: ['Switch (asli)', 'show port-security interface fa0/1'] },

{ id: 'nat', cat: 'Keamanan', lvl: 'Menengah', title: 'NAT/PAT ke internet (Cisco)',
  kw: 'nat pat overload internet berbagi koneksi masquerade ip publik inside outside translasi',
  intro: 'PAT membuat banyak IP privat keluar memakai satu IP publik. Router simulasi menyimpan "ip nat inside/outside", tetapi translasi belum disimulasikan; gunakan pada router QEMU (vIOS/CSR) atau perangkat asli.',
  steps: [
    ['Tandai interface', '', 'Router', 'configure terminal\ninterface g0/0\nip nat inside\ninterface g0/1\nip nat outside\nexit'],
    ['ACL jaringan dalam & overload', '', 'Router', 'access-list 1 permit 192.168.1.0 0.0.0.255\nip nat inside source list 1 interface g0/1 overload\nip route 0.0.0.0 0.0.0.0 203.0.113.1\nend'],
  ],
  verify: ['Router (asli)', 'show ip nat translations\nshow ip nat statistics'] },

// ======================================================================= WIRELESS
{ id: 'wifi-ap', cat: 'Wireless', lvl: 'Pemula', title: 'Access Point & WiFi (SSID, WPA2)',
  kw: 'wifi wireless nirkabel access point ap ssid password wpa2 hotspot laptop hp smartphone sambung internet rumah',
  intro: 'Access Point menjembatani klien wireless ke jaringan kabel. Klien hanya tersambung bila SSID & password sama.',
  steps: [
    ['Pasang AP', 'Seret Access Point, kabelkan port GigabitEthernet0 ke switch/router.', '', ''],
    ['Atur SSID', 'Pilih AP → panel kanan: SSID, keamanan (WPA2-PSK/WPA3/Open), password, channel.', '', ''],
    ['Kabelkan klien', 'Hubungkan port Wireless0 laptop/HP/IoT ke port Wireless0–15 pada AP (garis putus-putus).', '', ''],
    ['Sambungkan klien', 'Isi SSID & password di panel kanan klien, atau lewat console:', 'Laptop/HP', 'wifi NexLab-WiFi nexlab123\nipconfig /renew\nping 192.168.1.1'],
  ],
  tips: ['Link merah/kuning ke AP = SSID atau password belum cocok.', 'Channel 2.4 GHz yang tidak saling tumpang tindih: 1, 6, 11.', 'Letakkan AP di plafon, tengah area layanan; lihat Peta 3D untuk merencanakan posisi.'] },

{ id: 'ptp', cat: 'Wireless', lvl: 'Menengah', title: 'Link PtP antar gedung dengan antena',
  kw: 'ptp point to point antena antenna wireless backhaul gedung bangunan jarak jauh dish sektoral los line of sight fresnel radio link budget 5ghz',
  intro: 'Dua antena directional (dish/grid) saling berhadapan menghubungkan dua gedung tanpa kabel. Kunci keberhasilan: line of sight bersih, zona Fresnel minimal 60% bebas, dan link budget cukup.',
  steps: [
    ['Rencanakan di Peta 3D', 'Buka tab Peta 3D, pasang "Antena PtP" di atap/tiang kedua gedung, lalu tarik kabel jenis Wireless. Panel menampilkan jarak, RSSI estimasi, dan status LOS/Fresnel.', '', ''],
    ['Pilih frekuensi & antena', '5 GHz umum untuk PtP (lebih bersih). Antena 23–30 dBi untuk 1–10 km.', '', ''],
    ['Konfigurasi radio (umum)', 'Satu radio jadi Access Point (PtP), satunya Station. Samakan SSID, channel width, dan keamanan. Mode bridge (WDS) agar satu segmen L2.', '', ''],
    ['Alignment', 'Arahkan antena sampai RSSI maksimum (target ≥ -60 dBm). Kencangkan bracket, pasang grounding & arrester.', '', ''],
    ['Di lab topologi', 'Gunakan dua Access Point/bridge atau kabel antar switch untuk mensimulasikan jalur L2-nya.', '', ''],
  ],
  tips: ['Rumus FSPL(dB) = 20log10(jarak km) + 20log10(frekuensi MHz) + 32,44.', 'Radius Fresnel (m) = 17,32 × √(jarak km / (4 × frekuensi GHz)).', 'Kalkulator link budget ada di kategori Kalkulator.'] },

// ======================================================================= FIBER
{ id: 'ftth', cat: 'Fiber / FTTH', lvl: 'Menengah', title: 'FTTH: OLT → ODC → ODP → ONT',
  kw: 'ftth fiber optic fo serat optik olt odc odp ont modem splitter gpon pon drop cable pelanggan rumah isp indihome',
  intro: 'Arsitektur GPON: OLT di sentral, kabel feeder ke ODC (kabinet splitter), kabel distribusi ke ODP di tiang (splitter 1:8/1:16), lalu drop cable ke ONT di rumah pelanggan.',
  steps: [
    ['Topologi', 'Seret OLT, ODP dan ONT (kategori Fiber / FTTH). Kabelkan OLT GPON0/1 → ODP IN, ODP OUT1 → ONT PON, ONT LAN1 → router/PC.', '', ''],
    ['VLAN layanan di OLT', 'OLT memakai CLI switch. Pisahkan layanan internet & IPTV per VLAN.', 'OLT', 'enable\nconfigure terminal\nvlan 100\nname INTERNET\ninterface g0/1\nswitchport mode trunk\ninterface GPON0/1\nswitchport access vlan 100\nend'],
    ['Peta 3D', 'Buat tiang, ODP di tiang, rumah pelanggan, lalu tarik kabel Fiber (feeder/distribusi) dan Drop. Panel Budget menghitung daya terima tiap ONT.', '', ''],
  ],
  tips: ['Daya terima ONT ideal antara -8 dan -27 dBm (GPON kelas B+).', 'Redaman: fiber 0,35 dB/km (1310 nm), konektor 0,5 dB, sambungan 0,1 dB, splitter 1:8 ≈ 10,5 dB, 1:16 ≈ 13,8 dB.', 'Jaga radius tekukan drop cable minimal ±3 cm (bend-insensitive G.657A) dan jangan diklem terlalu kencang.'] },

{ id: 'fiber-install', cat: 'Fiber / FTTH', lvl: 'Menengah', title: 'Instalasi kabel fiber: udara, tanam & dalam gedung',
  kw: 'instalasi fiber kabel udara aerial tanam underground tiang klem closure splice sambung otdr penarikan kabel fo',
  intro: 'Panduan praktis menarik kabel fiber optik agar rapi dan awet.',
  steps: [
    ['Aerial (udara)', 'Gunakan kabel ADSS/figure-8, jarak tiang 30–50 m, sag ±1–2% panjang span, klem suspension di tiap tiang dan dead-end di belokan/ujung. Sisakan slack (gulungan) 10–20 m tiap 300–500 m.', '', ''],
    ['Tanam (underground)', 'Kedalaman minimal 60–100 cm dalam pipa HDPE/subduct, beri pita peringatan di atasnya, handhole setiap 100–300 m atau di belokan.', '', ''],
    ['Masuk gedung', 'Masuk lewat conduit dengan sleeve, terminasi di OTB/ODF di rack, gunakan patch cord ke perangkat. Jangan menekuk melebihi radius minimum (≥ 10–20× diameter kabel).', '', ''],
    ['Sambungan & uji', 'Splicing fusi di joint closure, ukur dengan OTDR dan power meter. Catat hasil ukur sebagai dokumentasi.', '', ''],
  ],
  tips: ['Warna jaket SM umumnya kuning, patch cord APC hijau, UPC biru.', 'Gunakan label di kedua ujung: asal, tujuan, nomor core.'] },

// ======================================================================= INSTALASI
{ id: 'cable-management', cat: 'Instalasi & kabel', lvl: 'Pemula', title: 'Manajemen & pemasangan kabel yang rapi',
  kw: 'kabel rapi cable management instalasi pemasangan tray conduit pipa rack patch panel label standar tia 568 utp cat6 jalur kabel rumah gedung',
  intro: 'Prinsip instalasi kabel terstruktur agar rapi, mudah dirawat dan sesuai standar (TIA/EIA-568).',
  steps: [
    ['Rencanakan jalur', 'Kabel horizontal dari rack/patch panel ke outlet tiap ruangan lewat cable tray di atas plafon atau conduit di dinding. Gunakan riser (shaft) vertikal untuk antar lantai. Di Peta 3D, jalur ini dihitung otomatis.', '', ''],
    ['Batas panjang', 'UTP maksimal 90 m permanent link + 10 m patch cord (total 100 m). Lebih jauh → fiber atau switch tambahan.', '', ''],
    ['Pisahkan dari listrik', 'Jarak minimal ±30 cm dari kabel listrik sejajar, silang tegak lurus bila harus bersilangan.', '', ''],
    ['Rack & patch panel', 'Urutan rack: patch panel → cable manager → switch. Gunakan patch cord pendek dan warna konsisten (mis. biru data, merah uplink, kuning CCTV, hijau VoIP).', '', ''],
    ['Bundling & radius', 'Gunakan velcro, bukan cable tie yang menjepit. Radius tekukan UTP ≥ 4× diameter kabel. Jangan tarik melebihi 110 N (±11 kg).', '', ''],
    ['Label & dokumentasi', 'Label kedua ujung (mis. "L1-R02-P05" = lantai 1, ruang 02, port 05). Simpan tabel kabel; tab Kabel di Peta 3D bisa jadi dasarnya.', '', ''],
    ['Uji', 'Uji tiap kabel dengan cable tester / certifier (wiremap, panjang, NEXT).', '', ''],
  ],
  tips: ['Sisakan service loop 1–2 m di rack dan 30 cm di outlet.', 'Rumah 2 lantai: letakkan rack/router kecil di lantai 1 dekat titik masuk ONT; tarik kabel ke AP plafon tiap lantai lewat pipa di sudut (riser).'] },

{ id: 'rj45', cat: 'Instalasi & kabel', lvl: 'Pemula', title: 'Urutan warna RJ45 (T568A/T568B), straight & cross',
  kw: 'rj45 crimping krimping urutan warna kabel lan t568a t568b straight cross over konektor utp',
  intro: 'Urutan pin 1 → 8 dengan klip konektor menghadap ke bawah.',
  steps: [
    ['T568B (paling umum)', '1 putih-oranye, 2 oranye, 3 putih-hijau, 4 biru, 5 putih-biru, 6 hijau, 7 putih-cokelat, 8 cokelat.', '', ''],
    ['T568A', '1 putih-hijau, 2 hijau, 3 putih-oranye, 4 biru, 5 putih-biru, 6 oranye, 7 putih-cokelat, 8 cokelat.', '', ''],
    ['Straight-through', 'Kedua ujung sama (B–B). Untuk PC–switch, router–switch.', '', ''],
    ['Crossover', 'Ujung A–B. Dulu untuk perangkat sejenis (switch–switch, PC–PC); perangkat modern sudah auto-MDIX.', '', ''],
  ] },

// ======================================================================= SERVER & SCRIPT
{ id: 'script', cat: 'Server & script', lvl: 'Pemula', title: 'Script otomatis di Server / PC',
  kw: 'script otomatis automation batch scripting server pc loop repeat if ping variabel set echo sleep jadwal monitoring',
  intro: 'Setiap PC, laptop, server dan perangkat akhir bisa menyimpan script. Jalankan dari panel kanan (Script otomatis → Jalankan) atau dari console dengan "run nama".',
  steps: [
    ['Sintaks', 'Satu perintah per baris. Semua perintah Command Prompt PC bisa dipakai (ping, tracert, ipconfig, curl, nslookup, ...).', '', '# komentar\necho teks\nset NAMA nilai        (pakai: ${NAMA})\nsleep 2\nrepeat 5 ... end      (variabel ${i} = 1..5)\nif ping 10.0.0.1 ... else ... end\nifnot ping 10.0.0.1 ... end'],
    ['Contoh: monitoring server', '', 'Server/PC', 'echo Monitoring dari ${HOST}\nset GW 192.168.1.1\nrepeat 3\n  if ping ${GW}\n    echo [${i}] gateway OK\n  else\n    echo [${i}] gateway PUTUS\n  end\n  sleep 1\nend\nbrowser 172.16.0.10'],
    ['Simpan & jalankan dari console', '', 'PC', 'script\nrun monitor'],
  ],
  tips: ['Variabel bawaan: ${HOST} (hostname) dan ${IP}.', 'Batas: 500 langkah, repeat maks 100, sleep maks 10 detik per baris.'] },

// ======================================================================= REAL
{ id: 'qemu', cat: 'Perangkat real', lvl: 'Lanjut', title: 'Menjalankan image asli dengan QEMU',
  kw: 'qemu image asli vios csr1000v mikrotik chr vyos fortigate pfsense eve pnetlab vm virtual machine kvm qcow2',
  intro: 'Node QEMU VM menjalankan sistem operasi asli sehingga semua fitur vendor (NAT, BGP, VPN, dll.) tersedia. Butuh server dijalankan sebagai root.',
  steps: [
    ['Pasang QEMU di server', '', 'Server Linux', 'sudo apt install qemu-system-x86 qemu-utils'],
    ['Taruh image', 'Satu folder per image.', 'Server Linux', 'mkdir -p data/images/qemu/mikrotik-chr\ncp chr-7.15.img data/images/qemu/mikrotik-chr/'],
    ['Buat node', 'Seret QEMU VM, pilih image, RAM (vIOS 512 MB, CSR 4096 MB, CHR 256 MB), jumlah NIC. Nyalakan lalu buka console (serial).', '', ''],
  ],
  tips: ['Cek /dev/kvm di halaman Server; tanpa KVM, VM berjalan lambat.', 'Image vendor berlisensi tidak disertakan — gunakan milik Anda.'] },

{ id: 'physical', cat: 'Perangkat real', lvl: 'Lanjut', title: 'Menyambungkan lab ke perangkat fisik',
  kw: 'perangkat fisik asli hardware nyata sungguhan bridge nic cloud pnet0 switch fisik router fisik koneksi luar',
  intro: 'Node Cloud menjembatani lab ke NIC server sehingga node QEMU/Linux Host berada di jaringan yang sama dengan perangkat sungguhan.',
  steps: [
    ['Siapkan NIC', 'Paling aman pakai NIC kedua (USB LAN pun bisa). Atau ubah NIC utama jadi bridge pnet0 (jalankan dari console lokal):', 'Server Linux', 'sudo scripts/make-bridge.sh eth0'],
    ['Cloud', 'Taruh node Cloud, pilih target NIC/bridge di panel kanan.', '', ''],
    ['Kabelkan', 'Hubungkan node QEMU VM atau Linux Host ke Cloud, nyalakan. Uji ping ke perangkat fisik.', 'Linux Host', 'ip a\nping -c 3 192.168.1.1'],
    ['Console perangkat fisik', 'Tambahkan node Perangkat Fisik, isi IP & protokol (Telnet/SSH).', '', ''],
  ] },

// ======================================================================= MIKROTIK
{ id: 'mt-basic', cat: 'MikroTik', lvl: 'Pemula', title: 'MikroTik: IP, gateway & DNS',
  kw: 'mikrotik routeros chr winbox ip address gateway dns setting dasar internet',
  intro: 'Untuk MikroTik CHR di QEMU atau router MikroTik fisik (console/SSH).',
  steps: [
    ['IP address', '', 'MikroTik', '/ip address add address=192.168.88.1/24 interface=ether2\n/ip address add address=10.10.10.2/30 interface=ether1'],
    ['Gateway & DNS', '', 'MikroTik', '/ip route add dst-address=0.0.0.0/0 gateway=10.10.10.1\n/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes'],
  ],
  verify: ['MikroTik', '/ip address print\n/ip route print\n/ping 8.8.8.8 count=3'] },

{ id: 'mt-nat', cat: 'MikroTik', lvl: 'Pemula', title: 'MikroTik: NAT masquerade (berbagi internet)',
  kw: 'mikrotik nat masquerade srcnat internet berbagi koneksi',
  intro: 'Membuat client LAN bisa keluar internet lewat IP WAN.',
  steps: [['Masquerade', '', 'MikroTik', '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade']],
  verify: ['MikroTik', '/ip firewall nat print'] },

{ id: 'mt-firewall', cat: 'MikroTik', lvl: 'Menengah', title: 'MikroTik: firewall filter dasar',
  kw: 'mikrotik firewall filter rule input forward drop accept established blokir keamanan router',
  intro: 'Aturan minimal untuk melindungi router dan jaringan.',
  steps: [
    ['Lindungi router (chain input)', '', 'MikroTik', '/ip firewall filter add chain=input connection-state=established,related action=accept\n/ip firewall filter add chain=input in-interface=ether2 action=accept\n/ip firewall filter add chain=input protocol=icmp action=accept\n/ip firewall filter add chain=input action=drop'],
    ['Lindungi LAN (chain forward)', '', 'MikroTik', '/ip firewall filter add chain=forward connection-state=established,related action=accept\n/ip firewall filter add chain=forward connection-state=invalid action=drop\n/ip firewall filter add chain=forward in-interface=ether1 connection-nat-state=!dstnat action=drop'],
    ['Blokir satu situs/IP', '', 'MikroTik', '/ip firewall filter add chain=forward dst-address=203.0.113.50 action=drop comment="blok server X"'],
  ],
  tips: ['Urutan rule penting; letakkan rule accept established di paling atas.', 'Pastikan Anda tidak mengunci diri sendiri: izinkan akses dari LAN sebelum rule drop.'] },

{ id: 'mt-dhcp', cat: 'MikroTik', lvl: 'Pemula', title: 'MikroTik: DHCP server',
  kw: 'mikrotik dhcp server pool lease network ip otomatis',
  intro: '',
  steps: [['Pool & server', '', 'MikroTik', '/ip pool add name=pool-lan ranges=192.168.88.10-192.168.88.200\n/ip dhcp-server add name=dhcp-lan interface=ether2 address-pool=pool-lan disabled=no\n/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1']],
  verify: ['MikroTik', '/ip dhcp-server lease print'] },

{ id: 'mt-queue', cat: 'MikroTik', lvl: 'Pemula', title: 'MikroTik: limit bandwidth (simple queue)',
  kw: 'mikrotik queue bandwidth limit kecepatan simple queue manajemen bandwidth',
  intro: '',
  steps: [['Batasi satu jaringan', 'max-limit=upload/download', 'MikroTik', '/queue simple add name=lan-guest target=192.168.20.0/24 max-limit=5M/10M']],
  verify: ['MikroTik', '/queue simple print stats'] },

// ======================================================================= LINUX
{ id: 'linux-net', cat: 'Linux', lvl: 'Pemula', title: 'Perintah jaringan Linux (Linux Host)',
  kw: 'linux bash ip addr route ping traceroute ss netstat nmcli namespace terminal perintah',
  intro: 'Node Linux Host memberikan shell bash dengan stack jaringan asli.',
  steps: [
    ['Alamat & rute', '', 'Linux', 'ip a\nip addr add 192.168.1.50/24 dev eth0\nip route add default via 192.168.1.1\nip route'],
    ['Uji koneksi', '', 'Linux', 'ping -c 3 192.168.1.1\ntraceroute 8.8.8.8\nss -tuln'],
  ] },

// ======================================================================= TROUBLESHOOTING
{ id: 'ts-ping', cat: 'Troubleshooting', lvl: 'Pemula', title: 'Ping gagal? Langkah troubleshooting',
  kw: 'troubleshoot troubleshooting ping gagal tidak bisa koneksi putus error request timed out unreachable masalah jaringan solusi',
  intro: 'Periksa dari lapisan bawah ke atas.',
  steps: [
    ['1. Fisik', 'Lampu di ujung kabel harus hijau. Merah = perangkat mati atau interface shutdown; kuning = ujung lain belum siap.', '', ''],
    ['2. Interface', '', 'Router', 'show ip interface brief'],
    ['3. IP & gateway PC', 'IP dan gateway harus satu subnet dengan interface router.', 'PC', 'ipconfig /all\nping 192.168.1.1'],
    ['4. VLAN & trunk', '', 'Switch', 'show vlan brief\nshow interfaces trunk'],
    ['5. Rute pergi & pulang', '"Destination host unreachable" = tidak ada rute; "Request timed out" sering = rute balik tidak ada atau diblok ACL.', 'Router', 'show ip route\ntraceroute 192.168.2.10'],
    ['6. ACL', '', 'Router', 'show access-lists'],
  ],
  tips: ['Fitur "Uji ping cepat" di panel kanan menunjukkan di perangkat mana paket berhenti dan alasannya.'] },

{ id: 'ts-ospf', cat: 'Troubleshooting', lvl: 'Menengah', title: 'OSPF tidak membentuk neighbor',
  kw: 'ospf neighbor tidak muncul troubleshooting adjacency gagal rute tidak muncul',
  intro: '',
  steps: [
    ['Cek', 'Interface antar router harus up, satu subnet & mask sama, sama-sama masuk perintah network, dan tidak passive.', 'Router', 'show ip interface brief\nshow ip protocols\nshow ip ospf neighbor'],
  ] },

// ======================================================================= KALKULATOR
{ id: 'calc-subnet', cat: 'Kalkulator', lvl: 'Alat', title: 'Kalkulator subnet & wildcard', widget: 'subnet',
  kw: 'kalkulator subnet subnetting cidr prefix mask wildcard broadcast network host range jumlah host hitung ip',
  intro: 'Masukkan IP dengan prefix, misalnya 192.168.10.37/26.' },
{ id: 'calc-fiber', cat: 'Kalkulator', lvl: 'Alat', title: 'Kalkulator power budget fiber (GPON)', widget: 'fiber',
  kw: 'kalkulator fiber power budget redaman loss dbm olt ont splitter gpon optik hitung',
  intro: 'Hitung daya terima ONT dari daya OLT, panjang kabel, splitter dan jumlah sambungan.' },
{ id: 'calc-wireless', cat: 'Kalkulator', lvl: 'Alat', title: 'Kalkulator link budget wireless PtP', widget: 'wireless',
  kw: 'kalkulator wireless link budget rssi fspl fresnel antena gain dbi jarak frekuensi ptp hitung sinyal',
  intro: 'Estimasi sinyal terima (RSSI) dan radius zona Fresnel.' },
];

/* Sinonim: kata pengguna → kata kunci di KB */
const GUIDE_SYN = {
  blokir: 'deny acl firewall', blok: 'deny acl firewall', block: 'acl firewall', keamanan: 'firewall acl ssh', aman: 'ssh firewall', proteksi: 'firewall',
  tembok: 'firewall', izin: 'permit acl', filter: 'acl', alamat: 'ip address', otomatis: 'dhcp', bagi: 'dhcp nat', pembagian: 'dhcp',
  nirkabel: 'wifi wireless', hotspot: 'wifi', wlan: 'wifi', sinyal: 'wireless antena', antena: 'antena ptp', antenna: 'antena ptp', pemancar: 'antena ptp',
  serat: 'fiber', optik: 'fiber', fo: 'fiber', kabel: 'kabel', rapi: 'cable management', jalur: 'routing kabel', rute: 'routing route', routing: 'routing',
  pisah: 'vlan', segmen: 'vlan', jarak: 'ssh telnet ptp', remote: 'ssh telnet', simpan: 'save write', backup: 'save', hapus: 'erase reset', reset: 'erase reset',
  internet: 'nat default route', nama: 'dns hostname', domain: 'dns', web: 'http', website: 'http', situs: 'http', limit: 'queue bandwidth', kecepatan: 'queue bandwidth',
  gedung: 'ptp cable management', rumah: 'ftth wifi cable management', bangunan: 'ptp cable management', lantai: 'cable management', otomatisasi: 'script', skrip: 'script',
  gagal: 'troubleshooting', error: 'troubleshooting', masalah: 'troubleshooting', putus: 'troubleshooting', hitung: 'kalkulator', subnetting: 'subnet', pelanggan: 'ftth',
  modem: 'ont ftth', splitter: 'odp ftth', tiang: 'fiber aerial', tanam: 'underground fiber', crimping: 'rj45', konektor: 'rj45', lan: 'rj45 vlan', mikrotik: 'mikrotik',
  dinamis: 'ospf rip', tetangga: 'neighbor ospf', password: 'password secret', sandi: 'password secret', nat: 'nat', pat: 'nat', gateway: 'gateway', ipv4: 'ip',
};
