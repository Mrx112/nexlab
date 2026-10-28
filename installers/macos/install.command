#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="Mrx112/nexlab"
RELEASE_BASE="https://github.com/${REPOSITORY}/releases/latest/download"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PACKAGE="NexLab-macOS-arm64.tar.gz" ;;
  x86_64) PACKAGE="NexLab-macOS-x64.tar.gz" ;;
  *) echo "Arsitektur macOS ${ARCH} belum didukung oleh paket rilis NexLab."; exit 1 ;;
esac
CHECKSUMS="NexLab-SHA256SUMS.txt"
INSTALL_DIR="${HOME}/Applications"
APP_PATH="${INSTALL_DIR}/NexLab.app"
DATA_DIR="${HOME}/Library/Application Support/NexLab/data"
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

command -v curl >/dev/null || { echo "curl diperlukan untuk mengunduh NexLab." >&2; exit 1; }
command -v shasum >/dev/null || { echo "shasum diperlukan untuk verifikasi SHA-256." >&2; exit 1; }
mkdir -p "$INSTALL_DIR"
if pgrep -f "${APP_PATH}/Contents/Resources/runtime/NexLab" >/dev/null 2>&1; then
  echo "Tutup NexLab terlebih dahulu sebelum memasang atau memperbarui." >&2
  exit 1
fi

echo "Mengunduh paket NexLab untuk macOS ${ARCH}..."
curl --fail --location --silent --show-error --retry 2 "${RELEASE_BASE}/${PACKAGE}" --output "${WORK_DIR}/${PACKAGE}"
curl --fail --location --silent --show-error --retry 2 "${RELEASE_BASE}/${CHECKSUMS}" --output "${WORK_DIR}/${CHECKSUMS}"
EXPECTED="$(awk -v package="$PACKAGE" '$2 == package || $2 == "*" package {print $1; exit}' "${WORK_DIR}/${CHECKSUMS}")"
if [[ ! "$EXPECTED" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "SHA-256 untuk ${PACKAGE} tidak tersedia. Paket tidak akan dipasang." >&2
  exit 1
fi
ACTUAL="$(shasum -a 256 "${WORK_DIR}/${PACKAGE}" | awk '{print $1}')"
if [[ "$(printf '%s' "$ACTUAL" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$EXPECTED" | tr '[:upper:]' '[:lower:]')" ]]; then
  echo "Verifikasi SHA-256 gagal. Paket tidak aman untuk dipasang." >&2
  exit 1
fi

mkdir "${WORK_DIR}/extracted"
tar -xzf "${WORK_DIR}/${PACKAGE}" -C "${WORK_DIR}/extracted"
NEW_APP="${WORK_DIR}/extracted/NexLab.app"
if [[ ! -x "${NEW_APP}/Contents/MacOS/nexlab-launcher" || ! -x "${NEW_APP}/Contents/Resources/runtime/NexLab" ]]; then
  echo "Paket terverifikasi tidak berisi aplikasi NexLab yang lengkap." >&2
  exit 1
fi

BACKUP="${WORK_DIR}/previous-NexLab.app"
if [[ -e "$APP_PATH" ]]; then
  mv "$APP_PATH" "$BACKUP"
fi
if ! mv "$NEW_APP" "$APP_PATH"; then
  [[ ! -e "$BACKUP" ]] || mv "$BACKUP" "$APP_PATH"
  echo "Aplikasi baru gagal dipasang; instalasi lama dipulihkan." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
if [[ -d "${HOME}/Desktop" && ! -e "${HOME}/Desktop/NexLab" ]]; then
  osascript - "$APP_PATH" "${HOME}/Desktop/NexLab" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set appPath to POSIX file (item 1 of argv) as alias
  set desktopPath to POSIX file (item 2 of argv) as alias
  tell application "Finder"
    make new alias at desktopPath to appPath with properties {name:"NexLab"}
  end tell
end run
APPLESCRIPT
fi

INSTALLED=1
echo "NexLab berhasil dipasang di ${APP_PATH}"
echo "Data lab tersimpan dan tetap dipertahankan di ${DATA_DIR}"
open "$APP_PATH"
