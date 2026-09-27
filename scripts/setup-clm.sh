#!/usr/bin/env bash
# CARROTCAP CLI — CLM-8B System One server (task-025). Run on a Linux / WSL2 machine with an
# NVIDIA GPU. Commands are the ones in https://github.com/Contrastive-LM/CLM (README).
#   bash scripts/setup-clm.sh install   # venv + pip install contrastive-lm vllm (downloads several GB)
#   bash scripts/setup-clm.sh serve     # Qwen3-8B encoder on :8090 (vLLM) + CLM API on :8700
# First `serve` downloads Qwen/Qwen3-8B from Hugging Face (~16 GB in bf16).
# The app's CLM button / scripts/system-one.js use http://127.0.0.1:8700 by default
# (settings.json systemOne.clmUrl). WSL2 forwards localhost to Windows.
set -euo pipefail

VENV="${CLM_VENV:-$HOME/.clm-venv}"
MIN_VRAM_MIB=16000

check_gpu() {
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    echo "[clm] nvidia-smi not found — vLLM needs an NVIDIA GPU (CPU mode is not what this script sets up)." >&2
    exit 1
  fi
  local vram
  vram="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n1 | tr -d ' ')"
  if [ "${vram:-0}" -lt "$MIN_VRAM_MIB" ]; then
    echo "[clm] GPU has ${vram} MiB; Qwen3-8B in bf16 needs about 16 GB. Use a bigger GPU or a remote server" >&2
    echo "      (then set settings.json systemOne.clmUrl to its https URL)." >&2
    [ "${CLM_FORCE:-0}" = "1" ] || exit 1
  fi
}

case "${1:-}" in
  install)
    check_gpu
    python3 -m venv "$VENV"
    # shellcheck disable=SC1091
    . "$VENV/bin/activate"
    pip install -U pip
    pip install -U contrastive-lm vllm
    echo "[clm] installed into $VENV — next: bash scripts/setup-clm.sh serve"
    ;;
  serve)
    check_gpu
    # shellcheck disable=SC1091
    . "$VENV/bin/activate"
    vllm serve Qwen/Qwen3-8B --served-model-name qwen3-8b --runner pooling \
      --max-model-len 2048 --port 8090 &
    ENCODER_PID=$!
    trap 'kill "$ENCODER_PID" 2>/dev/null || true' EXIT INT TERM
    # clm-serve talks to the encoder; wait until it answers before starting the API
    ready=0
    for _ in $(seq 1 180); do
      if curl -fsS http://127.0.0.1:8090/v1/models >/dev/null 2>&1; then ready=1; break; fi
      if ! kill -0 "$ENCODER_PID" 2>/dev/null; then echo "[clm] the encoder stopped — see the vLLM output above" >&2; exit 1; fi
      sleep 5
    done
    if [ "$ready" != "1" ]; then
      echo "[clm] the encoder did not answer on :8090 within 15 minutes — not starting clm-serve" >&2
      exit 1
    fi
    echo "[clm] encoder up on :8090 — starting clm-serve on :8700"
    clm-serve
    ;;
  *)
    echo "usage: bash scripts/setup-clm.sh install|serve" >&2
    exit 2
    ;;
esac
