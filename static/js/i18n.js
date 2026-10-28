(() => {
  const dictionary = {
    "Daftar": "Register",
    "Nama lengkap": "Full name",
    "Password": "Password",
    "Ulangi password": "Confirm password",
    "Ingat saya 30 hari": "Remember me for 30 days",
    "Buat akun": "Create account",
    "Belum ada akun. Akun pertama yang didaftarkan menjadi administrator.": "No account exists yet. The first registered account becomes the administrator.",
    "Registrasi ditutup oleh administrator.": "Registration is closed by the administrator.",
    "NexLab — lab jaringan di browser: router, switch, firewall, PC, QEMU & perangkat fisik.": "NexLab — a network lab in your browser: routers, switches, firewalls, PCs, QEMU, and physical devices.",
    "Status sistem": "System status",
    "Manajemen user": "User management",
    "Panduan": "Guide",
    "Akun": "Account",
    "Masuk": "Login",
    "Gagal masuk": "Login failed",
    "Server tidak dapat dihubungi": "Could not reach the server",
    "Memuat…": "Loading…",
    "Refresh": "Refresh",
    "Komputer (Linux, Windows atau macOS) yang menjalankan NexLab dan cara mengaksesnya dari perangkat lain.": "The computer (Linux, Windows, or macOS) running NexLab and how to access it from other devices.",
    "Alamat akses": "Access addresses",
    "Buka salah satu alamat ini dari komputer Windows atau HP di jaringan yang sama:": "Open one of these addresses from a computer or phone on the same network:",
    "Untuk akses dari internet, teruskan port": "For internet access, forward port",
    "di router ke IP server ini (port forwarding), atau gunakan IP publik server. Lihat Panduan bagian akses online.": "on your router to this server IP (port forwarding), or use the server's public IP. See the online access section in the Guide.",
    "Sumber daya": "Resources",
    "Kemampuan mode real": "Real-mode capabilities",
    "Sistem operasi": "Operating system",
    "Admin / root": "Admin / root",
    "Akselerasi VM": "VM acceleration",
    "Jaringan VM": "VM networking",
    "Linux Host (netns)": "Linux Host (netns)",
    "Antarmuka jaringan server": "Server network interfaces",
    "Nama": "Name",
    "Jenis": "Type",
    "Image QEMU": "QEMU images",
    "Belum ada. Taruh image di": "None yet. Place images in",
    "contoh": "example",
    "Integrasi Claude CLI": "Claude CLI integration",
    "Status tidak terbaca": "Status unavailable",
    "Terpasang": "Installed",
    "Login": "Login",
    "ya": "yes",
    "tidak": "no",
    "belum": "not yet",
    "Izinkan pengguna non-admin memakai Claude (memakai kuota akun CLI ini)": "Allow non-admin users to use Claude (uses this CLI account's quota)",
    "NexLab menjalankan": "NexLab runs",
    "sebagai user OS yang menjalankan server, jadi login CLI harus dilakukan oleh user itu. Jika server dijalankan dengan": "as the OS user running the server, so that user must log in to the CLI. If the server is run with",
    "login juga sebagai root.": "log in as root as well.",
    "Lab yang sedang berjalan": "Running labs",
    "Lab": "Lab",
    "Pemilik": "Owner",
    "Node menyala": "Running nodes",
    "Stop": "Stop",
    "Join": "Join",
    "Tidak ada lab yang sedang berjalan.": "No labs are currently running.",
    "Matikan semua node di lab ini?": "Stop all nodes in this lab?",
    "Kelola siapa saja yang boleh masuk ke lab ini.": "Manage who can access this lab.",
    "Izinkan registrasi": "Allow registration",
    "Pengaturan Claude disimpan": "Claude settings saved",
    "Akun": "Account",
    "Buat lab": "Create lab",
    "Lab baru": "New lab",
    "Nama lab": "Lab name",
    "Deskripsi (opsional)": "Description (optional)",
    "Mulai dari": "Start from",
    "Batal": "Cancel",
    "Buat dengan Claude": "Create with Claude",
    "Claude CLI tidak ditemukan di server.": "Claude CLI was not found on the server.",
    "Pasang di komputer server:": "Install on the server computer:",
    "lalu login dengan": "then log in with",
    "Terpasang tetapi belum login.": "Installed but not logged in.",
    "NexLab memakai akun yang login di CLI pada komputer server.": "NexLab uses the account logged in to the CLI on the server computer.",
    "Login Claude CLI": "Log in to Claude CLI",
    "Minta admin untuk login.": "Ask the administrator to log in.",
    "Fitur Claude hanya untuk admin.": "Claude is available to administrators only.",
    "Admin dapat mengizinkan semua pengguna di halaman Status sistem.": "An administrator can allow all users on the System status page.",
    "Claude CLI": "Claude CLI",
    "Pemakaian dihitung ke akun ini.": "Usage is charged to this account.",
    "Claude membuat topologi, kabel, konfigurasi IOS, IP perangkat akhir, dan workbook penilaian.": "Claude creates the topology, links, IOS configurations, endpoint IPs, and an assessment workbook.",
    "Claude sedang merancang topologi & konfigurasi": "Claude is designing the topology and configuration",
    "Claude tidak menjawab dalam 7 menit.": "Claude did not respond within 7 minutes.",
    "Claude CLI belum login.": "Claude CLI is not logged in.",
    "Jaringan": "Network",
    "Dashboard": "Dashboard",
    "Simpan": "Save",
    "Simpan perubahan": "Save changes",
    "Hapus": "Delete",
    "Edit": "Edit",
    "Tambah": "Add",
    "Cari": "Search",
    "Urutkan": "Sort",
    "Paling baru": "Newest",
    "Paling lama": "Oldest",
    "Harga terendah": "Lowest price",
    "Harga tertinggi": "Highest price",
    "Pengguna": "Users",
    "Username": "Username",
    "Peran": "Role",
    "Status": "Status",
    "Aksi": "Actions",
    "Aktif": "Active",
    "Nonaktif": "Inactive",
    "Admin": "Admin",
    "User": "User",
    "Pengaturan": "Settings",
    "Keluar": "Log out",
    "Nama perangkat": "Device name",
    "Konfigurasi": "Configuration",
    "Topologi": "Topology",
    "Perangkat": "Devices",
    "Kabel": "Links",
    "Console": "Console",
    "Buka console": "Open console",
    "Buat lab baru": "Create a new lab",
    "Hapus lab ini?": "Delete this lab?",
    "Simpan lab": "Save lab",
    "Ekspor": "Export",
    "Impor": "Import",
    "Ya": "Yes",
    "Tidak": "No",
    "Tutup": "Close",
    "Berhasil": "Success",
    "Gagal": "Failed",
    "Peringatan": "Warning",
    "Informasi": "Information",
    "Filter": "Filter",
    "Kembali": "Back",
    "Lanjut": "Next",
    "Muat ulang": "Reload",
    "Bersihkan": "Clear",
    "Semua": "All",
    "Baru": "New",
    "Pilih": "Select",
    "Otomatis": "Automatic",
    "Deskripsi": "Description",
    "Pengguna non-admin": "Non-admin users",
    "Tidak ada": "None",
    "Beranda": "Home",
    "Language": "Language",
    "NexLab — Lab Jaringan Pribadi": "NexLab — Personal Network Lab",
    "Lab Emulator Jaringan": "Network Emulator Lab",
    "Utama": "Main",
    "Pengelola file": "File manager",
    "Pilih semua": "Select all",
    "Update aplikasi": "Application update",
    "Periksa GitHub Releases untuk versi NexLab yang lebih baru.": "Check GitHub Releases for a newer version of NexLab.",
    "Scan update": "Scan for updates",
    "Memeriksa rilis terbaru…": "Checking for the latest release…",
    "Pemeriksaan update gagal. Periksa koneksi internet dan coba lagi.": "Update check failed. Check your internet connection and try again.",
    "NexLab ": "NexLab ",
    " sudah versi terbaru.": " is up to date.",
    "Versi ": "Version ",
    " tersedia. Unduh installer, tutup NexLab, lalu jalankan installer untuk memperbarui. ": " is available. Download the installer, close NexLab, and run the installer to update. ",
    "Tautan update dari GitHub tidak valid.": "The GitHub update link is invalid.",
    "Download update": "Download update",
    "Memori": "Memory",
    "beban ": "load ",
    "Versi": "Version",
    " jam ": " hours ",
    "menit": "minutes",
    "node menyala": "nodes running",
    "tcg (emulasi, lebih lambat)": "tcg (emulation, slower)",
    "Socket UDP + NAT (tanpa admin)": "UDP socket + NAT (no administrator privileges)",
    "SSH ke perangkat (asyncssh)": "SSH to devices (asyncssh)",
    "Simulasi, Peta 3D, panduan dan console Perangkat Fisik berjalan penuh.": "Simulation, 3D maps, guides, and Physical Device consoles are fully available.",
    "VM QEMU berjalan dengan jaringan socket; Linux Host dan bridge NIC khusus server Linux.": "QEMU VMs use socket networking; Linux Host and NIC bridging require a Linux server.",
    "tidak terbaca": "unavailable",
    "Belum ada lab": "No labs yet",
    "Mulai dari lab demo yang sudah terkonfigurasi untuk melihat cara kerjanya, atau buat lab kosong.": "Start with a preconfigured demo lab to see how it works, or create an empty lab.",
    "Buat lab demo": "Create demo lab",
    "Pratinjau lab": "Lab preview",
    "Pilih lab untuk melihat pratinjau.": "Select a lab to preview.",
    "Klik ganda untuk membuka.": "Double-click to open.",
    "Semua pengguna": "All users",
    "Cari lab…": "Search labs…",
    "Cari lab": "Search labs",
    "Diubah": "Updated",
    "mati": "stopped",
    " menyala": " running",
    "Nama": "Name",
    "Node": "Nodes",
    "Kabel": "Links",
    "Buka lab": "Open lab",
    "Pilih lab terlebih dahulu": "Select a lab first",
    "Reset password": "Reset password",
    "aktif": "active",
    "Izinkan pendaftaran akun baru": "Allow new account registration",
    "Hal-hal yang paling sering dibutuhkan saat ngelab.": "Commonly needed information for working in the lab.",
    "objek": "object",
    "Koneksi": "Connections",
    "Workbook / tugas": "Workbook / assignment",
    "Peta 3D": "3D map",
    "Aksi lainnya": "More actions",
    "Mode simulasi": "Simulation mode",
    "Refresh topologi": "Refresh topology",
    "Pas layar": "Fit to screen",
    "Detail lab": "Lab details",
    "Mode gelap": "Dark mode",
    "Alat": "Tools",
    "Persegi": "Rectangle",
    "Elips": "Ellipse",
    "Garis": "Line",
    "Gambar": "Image",
    "PDU sederhana": "Simple PDU",
    "PDU kompleks": "Complex PDU",
    "Simulasi": "Simulation",
    "Teks / note (N)": "Text / note (N)",
    "Kanvas topologi": "Topology canvas",
    "Coba di PC-Staff:": "Try on PC-Staff:",
    "Coba di PC-Guest:": "Try on PC-Guest:",
    "Tarik ke node lain untuk membuat koneksi": "Drag to another node to create a connection",
    "2× klik node = console · klik kanan = menu": "Double-click a node = console · right-click = menu",
    " kabel": " links",
    "Server Windows": "Windows server",
    "VM siap (socket)": "VM ready (socket)",
    "Menyala": "Running",
    "simulasi & real": "simulation & real mode",
    "siap": "ready",
    "belum tersedia": "not available",
    "Kabel VM berubah: matikan & nyalakan ulang": "VM links changed: power off and restart",
    "belum (QEMU tidak ada)": "unavailable (QEMU is not installed)",
    "Waktu aktif": "Uptime",
    "Pengguna OS server": "User OS server"
  };
  const storageKey = "nexlab-language";
  const language = () => localStorage.getItem(storageKey) === "id" ? "id" : "en";
  const reverseCandidates = new Map();
  for (const [source, target] of Object.entries(dictionary)) {
    if (source === target) continue;
    reverseCandidates.set(target, reverseCandidates.has(target) ? null : source);
  }
  const reverseDictionary = Object.fromEntries(
    [...reverseCandidates].filter(([, source]) => source !== null)
  );
  const dictionaries = {
    en: dictionary,
    id: reverseDictionary
  };
  const keys = Object.fromEntries(Object.entries(dictionaries).map(([locale, table]) => [
    locale,
    Object.keys(table).sort((a, b) => b.length - a.length)
  ]));

  function translateText(value) {
    const locale = language();
    const table = dictionaries[locale];
    const leading = value.match(/^\s*/)[0];
    const trailing = value.match(/\s*$/)[0];
    const content = value.trim();
    if (!content) return value;
    if (table[content]) return `${leading}${table[content]}${trailing}`;
    let translated = content;
    for (const source of keys[locale]) {
      if (source.length < 5 || !translated.includes(source)) continue;
      translated = translated.split(source).join(table[source]);
    }
    return `${leading}${translated}${trailing}`;
  }

  function translate(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest('script,style,pre,code,.mono,[translate="no"]')) continue;
      node.nodeValue = translateText(node.nodeValue);
    }
    const elements = root instanceof Element ? [root, ...root.querySelectorAll("*")] : [];
    for (const element of elements) {
      if (element.matches('script,style,pre,code,.mono,[translate="no"]')) continue;
      for (const attr of ["placeholder", "aria-label", "title"]) {
        const value = element.getAttribute(attr);
        if (value) element.setAttribute(attr, translateText(value));
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const selects = [...document.querySelectorAll("[data-language-select]")];
    const saved = language();
    document.documentElement.lang = saved;
    translate(document.head);
    selects.forEach(select => {
      select.value = saved;
      select.addEventListener("change", () => {
        localStorage.setItem(storageKey, select.value === "id" ? "id" : "en");
        location.reload();
      });
    });
    translate(document.body);
    new MutationObserver(records => records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) translate(node);
        else if (node.nodeType === Node.TEXT_NODE) node.nodeValue = translateText(node.nodeValue);
      });
    })).observe(document.body, { childList: true, subtree: true });
  });
})();
