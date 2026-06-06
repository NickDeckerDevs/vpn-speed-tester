#!/bin/bash
# lib.sh — Shared constants and helpers for NAS management scripts.
# Source this file (do not execute it directly).
#
# Provides: NAS, NAS_DIR, SSH, RSYNC_SSH, get_env_var()
# Requires: $HOME set (standard); $ENV_FILE set by the calling script before
#           calling get_env_var().

NAS="sysop@10.1.10.254"
NAS_DIR="/volume1/Docker/vpn-speed-tester"
SSH="ssh -i $HOME/.ssh/id_nas -p 8322 $NAS"
RSYNC_SSH="ssh -i $HOME/.ssh/id_nas -p 8322"

# Usage: get_env_var KEY
# Reads a key's value from $ENV_FILE. Strips surrounding quotes.
get_env_var() {
  grep "^$1=" "$ENV_FILE" | cut -d'=' -f2- | tr -d "'\""
}
