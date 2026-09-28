#!/usr/bin/env bash
# Turn the ctxmeter menu bar app on and off.
#
#   scripts/ctxmeter-bar.sh on        start it (no-op if already running)
#   scripts/ctxmeter-bar.sh off       quit it
#   scripts/ctxmeter-bar.sh toggle    on if off, off if on
#   scripts/ctxmeter-bar.sh restart   off, then on
#   scripts/ctxmeter-bar.sh status    print whether it is running
#   scripts/ctxmeter-bar.sh install   build and copy to /Applications (replaces an older copy)
set -euo pipefail

APP_NAME="CtxmeterBar"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLED="/Applications/$APP_NAME.app"
BUILT="$REPO/menubar/.build/release/$APP_NAME.app"
STOP_WAIT_TENTHS=30

is_running() { pgrep -x "$APP_NAME" >/dev/null; }

# The installed copy wins; a local build is the fallback so `on` works before
# anyone has run `install`.
app_path() {
  if [ -d "$INSTALLED" ]; then echo "$INSTALLED"; return; fi
  if [ -d "$BUILT" ]; then echo "$BUILT"; return; fi
  echo "ctxmeter-bar: app not found. Run: $0 install" >&2
  exit 1
}

start() {
  if is_running; then echo "ctxmeter-bar: already running"; return; fi
  local app
  app="$(app_path)"
  open "$app"
  echo "ctxmeter-bar: started ($app)"
}

stop() {
  if ! is_running; then echo "ctxmeter-bar: not running"; return; fi
  # SIGTERM; the app holds no unsaved state, so this is the same as Quit.
  pkill -x "$APP_NAME"
  for _ in $(seq "$STOP_WAIT_TENTHS"); do
    is_running || { echo "ctxmeter-bar: stopped"; return; }
    sleep 0.1
  done
  echo "ctxmeter-bar: still running after 3s; try: pkill -9 -x $APP_NAME" >&2
  exit 1
}

case "${1:-}" in
  on|start) start ;;
  off|stop) stop ;;
  toggle) if is_running; then stop; else start; fi ;;
  restart) stop; start ;;
  status)
    if is_running; then echo "ctxmeter-bar: running (pid $(pgrep -x "$APP_NAME" | tr '\n' ' '| sed 's/ $//'))"
    else echo "ctxmeter-bar: not running"; fi ;;
  install)
    was_running=false
    if is_running; then was_running=true; stop; fi
    make -C "$REPO/menubar" install
    if [ "$was_running" = true ]; then start; fi ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 2 ;;
esac
