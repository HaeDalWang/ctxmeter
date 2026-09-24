#!/usr/bin/env bash
#
# Records docs/demo.tape and encodes docs/demo.gif.
#
# VHS 0.12.0 cannot write a video itself: it hands an already-canceled context to
# its render step, so ffmpeg never starts and VHS still exits 0.
# See https://github.com/charmbracelet/vhs/issues/787
# Frame capture is unaffected, so the tape emits PNG frames and this script does
# the encode. Once #787 ships a fix, the tape can go back to `Output docs/demo.gif`
# and this script reduces to a single vhs call.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRAMES="$ROOT/.demo-frames"
BIN="$ROOT/.vhs-bin"
GIF="$ROOT/docs/demo.gif"
FPS="${DEMO_FPS:-20}"

for tool in vhs ffmpeg ttyd; do
  command -v "$tool" >/dev/null || { echo "build-demo: $tool is not on PATH" >&2; exit 1; }
done

# npm installs src/cli.js as a `ctxmeter` symlink on PATH. Reproducing that here
# keeps the recording an honest run of the real entry point.
mkdir -p "$BIN"
ln -sf ../src/cli.js "$BIN/ctxmeter"
chmod +x "$ROOT/src/cli.js"

# VHS writes no frames when the output directory already exists, so remove it and
# let VHS create it.
rm -rf "$FRAMES"

echo "build-demo: recording frames"
( cd "$ROOT" && PATH="$BIN:$PATH" DEMO_FRAMES="$FRAMES" vhs docs/demo.tape )

shopt -s nullglob
frames=("$FRAMES"/frame-text-*.png)
(( ${#frames[@]} > 0 )) || { echo "build-demo: vhs produced no frames" >&2; exit 1; }
echo "build-demo: captured ${#frames[@]} frames"

echo "build-demo: encoding $GIF at ${FPS}fps"
ffmpeg -y -loglevel error \
  -r 50 -start_number 1 -i "$FRAMES/frame-text-%05d.png" \
  -r 50 -start_number 1 -i "$FRAMES/frame-cursor-%05d.png" \
  -filter_complex "[0][1]overlay[merged];[merged]fps=$FPS,split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
  "$GIF"

[[ -s "$GIF" ]] || { echo "build-demo: encode produced no file" >&2; exit 1; }
rm -rf "$FRAMES"

echo "build-demo: wrote $GIF ($(du -h "$GIF" | cut -f1))"
