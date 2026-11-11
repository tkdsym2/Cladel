#!/usr/bin/env bash
# Build llama.cpp's `llama-server` as a self-contained (statically linked)
# binary and install it as a Tauri sidecar:
#
#   src-tauri/binaries/llama-server-<target-triple>
#
# Usage:
#   scripts/build-llama.sh                 # host triple, pinned tag
#   LLAMA_TAG=b12300 scripts/build-llama.sh
#   scripts/build-llama.sh aarch64-apple-darwin
#
# Requirements (macOS): Xcode Command Line Tools, cmake (`brew install cmake`), git.
# Metal shaders are embedded into the binary (GGML_METAL_EMBED_LIBRARY), so the
# full Xcode `metal` compiler is not needed.
#
# HTTPS is compiled out (LLAMA_OPENSSL=OFF): the server cannot fetch a model
# from Hugging Face (`-hf`); it only loads the local GGUF it is given. The
# bundled web UI is always embedded by llama.cpp's build (its assets are fetched
# once at build time) but the app starts the server with `--no-webui`.
set -euo pipefail

# PLaMo 3 needs a recent llama.cpp (PLaMo-3 tokenizer: ggml-org/llama.cpp#30045).
LLAMA_TAG="${LLAMA_TAG:-b12283}"
LLAMA_REPO="${LLAMA_REPO:-https://github.com/ggml-org/llama.cpp.git}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/src-tauri/target/llama.cpp"          # already git-ignored (src-tauri/target/)
SRC="$WORK/src-$LLAMA_TAG"
BIN_DIR="$ROOT/src-tauri/binaries"

if [[ $# -ge 1 ]]; then
  TRIPLE="$1"
else
  TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
fi

case "$TRIPLE" in
  aarch64-apple-darwin) ARCH=arm64;  METAL=ON  ;;
  x86_64-apple-darwin)  ARCH=x86_64; METAL=OFF ;;
  *) echo "error: unsupported target triple '$TRIPLE' (macOS only for now)" >&2; exit 1 ;;
esac

command -v cmake >/dev/null || { echo "error: cmake not found (brew install cmake)" >&2; exit 1; }

echo "==> llama.cpp $LLAMA_TAG for $TRIPLE (arch=$ARCH, metal=$METAL)"

mkdir -p "$WORK"
if [[ ! -d "$SRC/.git" ]]; then
  git clone --depth 1 --branch "$LLAMA_TAG" "$LLAMA_REPO" "$SRC"
fi

BUILD="$SRC/build-$TRIPLE"
cmake -S "$SRC" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.3 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL="$METAL" \
  -DGGML_METAL_EMBED_LIBRARY="$METAL" \
  -DLLAMA_OPENSSL=OFF \
  -DGGML_CCACHE=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_TOOLS=ON \
  -DLLAMA_BUILD_SERVER=ON

cmake --build "$BUILD" --config Release --target llama-server -j "$(sysctl -n hw.ncpu)"

OUT="$BUILD/bin/llama-server"
[[ -x "$OUT" ]] || { echo "error: $OUT was not produced" >&2; exit 1; }

# Static-link guard: only system libraries/frameworks may be dynamic.
if otool -L "$OUT" | tail -n +2 | grep -Ev '^\s*/(usr/lib|System/Library)/' ; then
  echo "error: llama-server links a non-system dynamic library (see above)" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
DEST="$BIN_DIR/llama-server-$TRIPLE"
cp "$OUT" "$DEST"
strip -x "$DEST"
echo "$LLAMA_TAG" > "$BIN_DIR/llama-server.version"

echo "==> installed $DEST ($(du -h "$DEST" | cut -f1))"
"$DEST" --version 2>&1 | head -n 2 || true
