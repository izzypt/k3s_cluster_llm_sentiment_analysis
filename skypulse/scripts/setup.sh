#!/usr/bin/env bash
# Checks that the tools SkyPulse needs are installed and working, and installs the missing ones.
#
#   ./scripts/setup.sh           check, then offer to install anything missing
#   ./scripts/setup.sh --check   only check (exit 1 if something is missing); used by `make check-tools`
#   ./scripts/setup.sh --yes     install without asking
#
# Supports Linux (apt, dnf, pacman, zypper), macOS (Homebrew) and WSL2.
#
# kubectl, k3d and uv are installed per user into ~/.local/bin (no sudo). make and Docker come
# from the system package manager, so those may ask for your sudo password.
set -euo pipefail

TOOLS=(make docker kubectl k3d uv)
MIN_DOCKER_MEM_GB=12 # the default model; LLM_MODEL=gemma3:1b gets by with ~6
BIN_DIR="$HOME/.local/bin"
ORIG_PATH=$PATH
export PATH="$BIN_DIR:$PATH"

mode=ask
case "${1:-}" in
  "") ;;
  --check) mode=check ;;
  --yes | -y) mode=yes ;;
  -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
  *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
esac

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

case "$(uname -s)" in
  Darwin) platform=macos ;;
  Linux) if grep -qi microsoft /proc/version 2>/dev/null; then platform=wsl; else platform=linux; fi ;;
  *) platform=unknown ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) arch=unknown ;;
esac
SUDO=sudo
[[ $(id -u) -eq 0 ]] && SUDO=""

# ---------------------------------------------------------------- check

version_of() {
  case $1 in
    make) make --version | head -1 ;;
    docker) docker --version ;;
    kubectl) kubectl version --client | head -1 ;;
    k3d) k3d version | head -1 ;;
    uv) uv --version ;;
  esac 2>/dev/null
}

# The builds pull from Docker Hub. Resolve the first image they need (no download), with the same
# saved credentials `docker build` uses: a stale login there makes every pull fail with 401.
check_docker_hub() {
  local out
  if docker buildx version >/dev/null 2>&1; then
    out=$(docker buildx imagetools inspect docker/dockerfile:1 2>&1 >/dev/null) && hub_ok=1 || hub_ok=0
  else
    out=$(docker pull -q hello-world 2>&1 >/dev/null) && hub_ok=1 || hub_ok=0
  fi
  if (( hub_ok )); then
    green "  [ok]      Docker Hub reachable"
  elif grep -qiE 'unauthorized|401' <<<"$out"; then
    docker_state=hub-auth
    red "  [error]   Docker Hub rejects the login saved in Docker (401 Unauthorized); public images need none."
    red "            Fix: docker logout   (with Docker Desktop, also sign out or sign in again in the app)"
  else
    docker_state=hub-down
    red "  [error]   cannot reach Docker Hub: $(head -1 <<<"$out")"
    red "            Check your internet connection, proxy or VPN."
  fi
}

# Sets $missing (tools not installed), $off_path (installed in ~/.local/bin, but that is not on the
# caller's PATH) and $docker_state (ok | missing | stopped | denied | hub-auth | hub-down).
check() {
  missing=()
  off_path=()
  for tool in "${TOOLS[@]}"; do
    if command -v "$tool" >/dev/null 2>&1; then
      if (PATH=$ORIG_PATH; hash -r; command -v "$tool") >/dev/null 2>&1; then
        green "  [ok]      $tool  $(version_of "$tool" || true)"
      else
        yellow "  [path]    $tool is installed in $BIN_DIR, but that directory is not on your PATH"
        off_path+=("$tool")
      fi
    else
      red "  [missing] $tool"
      missing+=("$tool")
    fi
  done

  docker_state=missing
  command -v docker >/dev/null 2>&1 || return 0
  local out
  if out=$(docker info 2>&1); then
    docker_state=ok
    local gb=$(( ($(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0) + 500000000) / 1000000000 ))
    if (( gb >= MIN_DOCKER_MEM_GB )); then
      green "  [ok]      docker daemon running, ${gb} GB memory"
    else
      yellow "  [warn]    docker has only ${gb} GB memory; the default model needs >= ${MIN_DOCKER_MEM_GB} GB."
      yellow "            Give Docker more memory, or build with: make build LLM_MODEL=gemma3:1b"
    fi
    check_docker_hub
  elif grep -qi 'permission denied' <<<"$out"; then
    docker_state=denied
    red "  [error]   docker is installed but your user may not use it (not in the 'docker' group)"
  else
    docker_state=stopped
    red "  [error]   docker is installed but the daemon is not running"
  fi
}

# ---------------------------------------------------------------- install

pkg_install() {
  if command -v apt-get >/dev/null; then $SUDO apt-get update -qq && $SUDO apt-get install -y "$@"
  elif command -v dnf >/dev/null; then $SUDO dnf install -y "$@"
  elif command -v pacman >/dev/null; then $SUDO pacman -S --noconfirm --needed "$@"
  elif command -v zypper >/dev/null; then $SUDO zypper install -y "$@"
  else red "No supported package manager found; install '$*' yourself."; return 1
  fi
}

install_make() {
  if [[ $platform == macos ]]; then
    xcode-select --install || true
    yellow "Finish the Command Line Tools installer that just opened (it provides make)."
    return 1
  fi
  pkg_install make
}

install_docker() {
  case $platform in
    macos) brew install --cask docker-desktop ;;
    linux)
      curl -fsSL https://get.docker.com | $SUDO sh
      $SUDO systemctl enable --now docker
      [[ -z $SUDO ]] || $SUDO usermod -aG docker "$USER"
      ;;
    wsl)
      yellow "In WSL2, use Docker Desktop for Windows: install it (https://docs.docker.com/desktop/setup/install/windows-install/),"
      yellow "then enable Settings > Resources > WSL integration for this distro, and run this script again."
      return 1
      ;;
  esac
}

install_kubectl() {
  if [[ $platform == macos ]]; then brew install kubectl; return; fi
  local version
  version=$(curl -fsSL https://dl.k8s.io/release/stable.txt)
  mkdir -p "$BIN_DIR"
  curl -fsSLo "$BIN_DIR/kubectl" "https://dl.k8s.io/release/$version/bin/linux/$arch/kubectl"
  chmod +x "$BIN_DIR/kubectl"
}

install_k3d() {
  if [[ $platform == macos ]]; then brew install k3d; return; fi
  mkdir -p "$BIN_DIR"
  curl -fsSL https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | USE_SUDO=false K3D_INSTALL_DIR="$BIN_DIR" bash
}

install_uv() {
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$BIN_DIR" sh
}

# Puts ~/.local/bin on PATH for future shells. (Ubuntu's ~/.profile only adds it if the directory
# already existed at login, so a fresh install stays invisible until you log in again.)
ensure_path() {
  local rc
  case "${SHELL##*/}" in
    zsh) rc=$HOME/.zshrc ;;
    bash) rc=$HOME/.bashrc ;;
    *) rc=$HOME/.profile ;;
  esac
  if ! grep -qs 'skypulse setup: ~/.local/bin' "$rc"; then
    printf '\n# skypulse setup: ~/.local/bin (kubectl, k3d, uv)\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc"
    yellow "Added $BIN_DIR to PATH in $rc."
  fi
  yellow "Open a new terminal, or run this in the current one:  source $rc"
}

start_docker() {
  case $platform in
    macos) open -a Docker ;;
    linux) $SUDO systemctl start docker ;;
    wsl) yellow "Start Docker Desktop on Windows (and enable WSL integration for this distro)." ;;
  esac
  echo "Waiting for the Docker daemon..."
  for _ in $(seq 60); do
    docker info >/dev/null 2>&1 && return 0
    sleep 2
  done
  red "Docker did not come up within 2 minutes."
  return 1
}

# ---------------------------------------------------------------- main

echo "Checking SkyPulse prerequisites ($platform/$arch)..."
check
if (( ${#missing[@]} == 0 )) && [[ $docker_state == ok ]]; then
  if (( ${#off_path[@]} == 0 )); then
    green "All prerequisites present."
    exit 0
  fi
  if [[ $mode == check ]]; then
    echo "Run ./scripts/setup.sh to fix it, or add to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
    exit 1
  fi
  ensure_path
  exit 0
fi
if [[ $mode == check ]]; then
  echo "Run ./scripts/setup.sh to install what is missing (see README.md > Prerequisites)."
  exit 1
fi
if [[ $docker_state == hub-down ]] && (( ${#missing[@]} == 0 )); then
  exit 1  # nothing this script can install fixes the network
fi
if [[ $platform == unknown || $arch == unknown ]]; then
  red "Unsupported platform $(uname -sm); install the tools by hand (README.md > Prerequisites)."
  exit 1
fi
if [[ $platform == macos ]] && ! command -v brew >/dev/null; then
  red "Homebrew is needed to install the tools on macOS: https://brew.sh"
  exit 1
fi

if [[ $mode == ask ]]; then
  todo="${missing[*]:-}"
  [[ $docker_state == stopped ]] && todo+=" (start docker)"
  [[ $docker_state == denied ]] && todo+=" (docker group)"
  [[ $docker_state == hub-auth ]] && todo+=" (docker logout)"
  read -rp "Install / fix:$todo? [Y/n] " answer || answer=n
  [[ $answer =~ ^[Nn] ]] && exit 1
fi

if [[ $platform != macos ]] && ! command -v curl >/dev/null; then
  pkg_install curl ca-certificates
fi

failed=()
for tool in ${missing[@]+"${missing[@]}"}; do
  echo ""
  echo "==> Installing $tool"
  "install_$tool" || failed+=("$tool")
done

echo ""
if command -v docker >/dev/null && ! docker info >/dev/null 2>&1; then
  if docker info 2>&1 | grep -qi 'permission denied'; then
    [[ -z $SUDO ]] || $SUDO usermod -aG docker "$USER"
    yellow "You were added to the 'docker' group. Log out and back in (or run 'newgrp docker'), then run this script again."
    exit 1
  fi
  start_docker || failed+=("docker daemon")
fi
if [[ $docker_state == hub-auth ]]; then
  echo "==> Removing the rejected Docker Hub login"
  docker logout
fi

echo ""
echo "Re-checking..."
check
(( ${#off_path[@]} == 0 )) || ensure_path
if (( ${#missing[@]} == 0 )) && [[ $docker_state == ok ]]; then
  green "All prerequisites present. Next: make build && make start"
else
  red "Still missing or broken: ${missing[*]:-} ${failed[*]:-} (see the messages above)"
  exit 1
fi
