if [ "$RUN_TEST" = true ]; then
  # ── Step 3: Query AirVPN API, pick initial server ──────────────────────────
  echo "Picking initial server from AirVPN API..."
  INITIAL_SERVER=$(curl -sf 'https://airvpn.org/api/status' | \
    jq -r '[.servers[] | select(.country_code == "us" and .health == "ok")] | sort_by(.currentload) | .[0].public_name // "Aladfar"' 2>/dev/null || echo "Aladfar")
  INITIAL_SERVER="${INITIAL_SERVER:-Aladfar}"
  echo "Initial server: $INITIAL_SERVER"

  # ── Step 4: Write SERVER_NAMES into NAS .env ───────────────────────────────
  echo "Updating SERVER_NAMES on NAS..."
  $SSH "$SUDO sh -c 'grep -v \"^SERVER_NAMES=\" $NAS_DIR/.env > /tmp/.env.tmp && echo \"SERVER_NAMES=$INITIAL_SERVER\" >> /tmp/.env.tmp && mv /tmp/.env.tmp $NAS_DIR/.env'"

  # ── Step 5: Build stack ────────────────────────────────────────────────────
  echo "Building stack on NAS..."
  $SSH "$SUDO sh -c 'cd $NAS_DIR && docker compose build'"

  # ── Step 6: Start stack ────────────────────────────────────────────────────
  echo "Starting stack on NAS..."
  $SSH "$SUDO sh -c 'cd $NAS_DIR && docker compose up -d'"

  # ── Step 7: Poll gluetun until tunnel is running ───────────────────────────
  echo "Waiting for gluetun tunnel to be running..."
  WAITED=0
  MAX_WAIT=120
  while true; do
    VPN_RESPONSE=$($SSH "$SUDO docker exec gluetun-speedtest wget -qO- http://localhost:8000/v1/vpn/status" 2>/dev/null || echo "{}")
    if echo "$VPN_RESPONSE" | grep -q '"status":"running"'; then
      echo "Tunnel running."
      break
    fi
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
      echo "ERROR: tunnel did not come up after ${MAX_WAIT}s (last response: $VPN_RESPONSE)"
      exit 1
    fi
    echo "  Not ready (${WAITED}s elapsed) — retrying in 5s..."
    sleep 5
    WAITED=$((WAITED + 5))
  done

  # ── Step 8: Run test ───────────────────────────────────────────────────────
  echo "Running test:single — streaming logs from NAS..."
  $SSH "$SUDO docker exec orchestrator npm run test:single"

  # ── Step 9: Tear down ──────────────────────────────────────────────────────
  echo "Test complete — taking stack down..."
  $SSH "$SUDO sh -c 'cd $NAS_DIR && docker compose down'"

else
  echo "You should now run your test"
  # ── Base path (no flags): build + start only ─────────────────────────────
  # echo "Rebuilding and starting stack on NAS..."
  # $SSH "$SUDO sh -c 'cd $NAS_DIR && docker compose up -d --build'"

  # echo "Waiting for containers to settle..."
  # sleep 8

  # echo "Container status:"
  # $SSH "$SUDO docker ps --filter 'name=gluetun-speedtest' --filter 'name=speedtest-runner' --filter 'name=orchestrator' --format 'table {{.Names}}\t{{.Status}}'"
fi