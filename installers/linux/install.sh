#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="Mrx112/nexlab"
RELEASE_BASE="https://github.com/${REPOSITORY}/releases/latest/download"
ARCHIVE="NexLab-Linux-x64.tar.gz"
CHECKSUMS="NexLab-SHA256SUMS.txt"
ARCH="$(uname -m)"
if [[ "$ARCH" != "x86_64" ]]; then
  echo "Paket Linux saat ini mendukung x86_64; arsitektur terdeteksi: ${ARCH}." >&2
  exit 1
fi

DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
INSTALL_DIR="${HOME}/.local/opt/nexlab"
DATA_DIR="${DATA_HOME}/nexlab"
BIN_DIR="${HOME}/.local/bin"
APPLICATIONS_DIR="${HOME}/.local/share/applications"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nexlab-install.XXXXXX")"
INSTALLED=0

cleanup() {
  local status=$?
  if [[ "$INSTALLED" == 1 ]]; then
    rm -rf -- "$WORK_DIR"
  else
    echo "Instalasi gagal. Berkas untuk diagnosis disimpan di: $WORK_DIR" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

for command_name in curl tar pgrep; do
  command -v "$command_name" >/dev/null || { echo "${command_name} diperlukan untuk instalasi." >&2; exit 1; }
done
if pgrep -x NexLab >/dev/null 2>&1; then
  echo "Tutup NexLab terlebih dahulu sebelum memasang atau memperbarui." >&2
  exit 1
fi

echo "Mengunduh NexLab untuk Linux x86_64..."
curl --fail --location --silent --show-error --retry 2 "${RELEASE_BASE}/${ARCHIVE}" --output "${WORK_DIR}/${ARCHIVE}"
curl --fail --location --silent --show-error --retry 2 "${RELEASE_BASE}/${CHECKSUMS}" --output "${WORK_DIR}/${CHECKSUMS}"
EXPECTED="$(awk -v package="$ARCHIVE" '$2 == package || $2 == "*" package {print $1; exit}' "${WORK_DIR}/${CHECKSUMS}")"
if [[ ! "$EXPECTED" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "SHA-256 untuk ${ARCHIVE} tidak tersedia. Paket tidak akan dipasang." >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "${WORK_DIR}/${ARCHIVE}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "${WORK_DIR}/${ARCHIVE}" | awk '{print $1}')"
else
  echo "sha256sum atau shasum diperlukan untuk verifikasi integritas." >&2
  exit 1
fi
if [[ "$(printf '%s' "$ACTUAL" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$EXPECTED" | tr '[:upper:]' '[:lower:]')" ]]; then
  echo "Verifikasi SHA-256 gagal. Paket tidak aman untuk dipasang." >&2
  exit 1
fi

mkdir "${WORK_DIR}/extracted"
tar -xzf "${WORK_DIR}/${ARCHIVE}" -C "${WORK_DIR}/extracted"
if [[ ! -x "${WORK_DIR}/extracted/NexLab/NexLab" ]]; then
  echo "Paket terverifikasi tidak berisi aplikasi NexLab yang lengkap." >&2
  exit 1
fi

mkdir -p "$(dirname "$INSTALL_DIR")" "$DATA_DIR" "$BIN_DIR" "$APPLICATIONS_DIR"
BACKUP="${WORK_DIR}/previous-install"
if [[ -e "$INSTALL_DIR" ]]; then
  mv "$INSTALL_DIR" "$BACKUP"
fi
if ! mv "${WORK_DIR}/extracted/NexLab" "$INSTALL_DIR"; then
  [[ ! -e "$BACKUP" ]] || mv "$BACKUP" "$INSTALL_DIR"
  echo "Aplikasi baru gagal dipasang; instalasi lama dipulihkan." >&2
  exit 1
fi

LAUNCHER="${BIN_DIR}/nexlab"
cat >"$LAUNCHER" <<'LAUNCHER_SCRIPT'
#!/usr/bin/env bash
set -e
INSTALL_DIR="${HOME}/.local/opt/nexlab"
DATA_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/nexlab"
cd "$INSTALL_DIR"
exec "$INSTALL_DIR/NexLab" --open --data "$DATA_DIR" "$@"
LAUNCHER_SCRIPT
chmod 755 "$LAUNCHER"

EXEC_PATH="$(printf '%s' "$LAUNCHER" | sed 's/\\/\\\\/g; s/"/\\"/g; s/ /\\s/g; s/	/\\t/g')"
cat >"${APPLICATIONS_DIR}/nexlab.desktop" <<DESKTOP_ENTRY
[Desktop Entry]
Type=Application
Name=NexLab
Comment=Network Emulator Lab
Exec=${EXEC_PATH}
Path=${INSTALL_DIR}
Terminal=true
Categories=Development;Education;Network;
DESKTOP_ENTRY
chmod 644 "${APPLICATIONS_DIR}/nexlab.desktop"

if [[ -d "${HOME}/Desktop" ]]; then
  if [[ ! -e "${HOME}/Desktop/nexlab.desktop" ]]; then
    cp "${APPLICATIONS_DIR}/nexlab.desktop" "${HOME}/Desktop/nexlab.desktop"
    chmod 755 "${HOME}/Desktop/nexlab.desktop"
  fi
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

INSTALLED=1
echo "NexLab berhasil dipasang. Buka dari menu aplikasi atau shortcut Desktop."
echo "Data lab tersimpan dan tetap dipertahankan di ${DATA_DIR}"
nohup "$LAUNCHER" >>"${DATA_DIR}/nexlab.log" 2>&1 </dev/null &
echo "NexLab berjalan di background; log startup: ${DATA_DIR}/nexlab.log"
