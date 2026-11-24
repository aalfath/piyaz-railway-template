#!/bin/bash
# Railway start script for Piyaz: validate settings, bootstrap the database,
# create the owner on a loopback-only instance, then serve on $PORT.
set -euo pipefail
log() { echo "[piyaz-start] $*"; }
die() { echo "[piyaz-start] ERROR: $*" >&2; exit 1; }

cd /app
export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
export TRUSTED_PROXY_HEADER="${TRUSTED_PROXY_HEADER:-x-real-ip}"
export PORT="${PORT:-3000}"

# Public origin: use BETTER_AUTH_URL when it is a full https URL, otherwise
# fall back to the Railway domain (the reference can resolve to "https://"
# when the domain didn't exist yet).
url="${BETTER_AUTH_URL:-}"
if ! [[ "$url" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; then
  if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    url="https://${RAILWAY_PUBLIC_DOMAIN}"
  else
    die "BETTER_AUTH_URL is empty and the service has no public domain. Generate a domain in Settings > Networking, then redeploy."
  fi
fi
export BETTER_AUTH_URL="${url%/}"
log "public URL: ${BETTER_AUTH_URL}"

[ "${#BETTER_AUTH_SECRET}" -ge 32 ] || die "BETTER_AUTH_SECRET must be at least 32 characters."
[ -n "${PIYAZ_DATABASE_ADMIN_URL:-}" ] || die "PIYAZ_DATABASE_ADMIN_URL is empty (expected \${{Postgres.DATABASE_URL}})."

# Size the JS heap and libuv pool to the service's memory/CPU limits.
mem_max=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo max)
if [ "$mem_max" != "max" ] && [ "$mem_max" -gt 0 ] 2>/dev/null; then
  mem_mb=$((mem_max / 1024 / 1024))
else
  mem_mb=2048
fi
cpus=1
if read -r quota period < /sys/fs/cgroup/cpu.max 2>/dev/null && [ "$quota" != "max" ]; then
  cpus=$(( (quota + period - 1) / period ))
fi
[ "$cpus" -ge 1 ] || cpus=1
[ "$cpus" -le 8 ] || cpus=8
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-$cpus}"
export GOMAXPROCS="$cpus"
log "limits: ${mem_mb} MB memory, ${cpus} CPU(s)"

export PIYAZ_ENV_FILE=/tmp/piyaz-db.env
bun /opt/piyaz/bootstrap.js db || die "database bootstrap failed"
# shellcheck disable=SC1091
. "$PIYAZ_ENV_FILE"

app_pid=""
stopping=0
on_term() {
  stopping=1
  [ -n "$app_pid" ] && kill -TERM "$app_pid" 2>/dev/null || true
}
trap on_term TERM INT

wait_ready() { # port pid
  for _ in $(seq 1 180); do
    kill -0 "$2" 2>/dev/null || return 1
    if bun -e "const r=await fetch('http://127.0.0.1:$1/api/auth/jwks').catch(()=>null);process.exit(r&&r.ok?0:1)" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if [ "${PIYAZ_USER_COUNT:-0}" -eq 0 ]; then
  [ -n "${PIYAZ_ADMIN_EMAIL:-}" ] || die "PIYAZ_ADMIN_EMAIL is required to create the owner account on first boot."
  log "no accounts yet: creating the owner on a loopback-only instance"
  PIYAZ_BOOTSTRAP_TOKEN=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  export PIYAZ_BOOTSTRAP_TOKEN PIYAZ_BOOTSTRAP_PORT=3999
  HOSTNAME=127.0.0.1 PORT=3999 bun server.js &
  app_pid=$!
  wait_ready 3999 "$app_pid" || { kill "$app_pid" 2>/dev/null || true; die "loopback instance did not become ready"; }
  if ! bun /opt/piyaz/bootstrap.js owner; then
    kill "$app_pid" 2>/dev/null || true
    die "owner account could not be created; refusing to open the public port"
  fi
  kill -TERM "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  app_pid=""
  unset PIYAZ_BOOTSTRAP_TOKEN PIYAZ_BOOTSTRAP_PORT
fi
unset PIYAZ_ADMIN_PASSWORD PIYAZ_DATABASE_ADMIN_URL

log "starting Piyaz on 0.0.0.0:${PORT}"
HOSTNAME=0.0.0.0 bun server.js &
app_pid=$!
set +e
wait "$app_pid"
code=$?
# wait returns early when a trapped signal arrives; collect the real status
while [ "$stopping" -eq 1 ] && kill -0 "$app_pid" 2>/dev/null; do wait "$app_pid"; code=$?; done
set -e
if [ "$stopping" -eq 1 ]; then
  log "stopped on request"
  exit 0
fi
log "Piyaz exited unexpectedly (status ${code})"
[ "$code" -ne 0 ] || code=1
exit "$code"
