#!/usr/bin/env bash
#
# Runs this checkout's `pnpm dev` in the background. `pnpm dev` allocates the web
# and MongoDB ports and records them in .tmp/dev-stack/stack.json. `up` starts it
# under setsid so `down` can signal the whole process group (pnpm, tsx, next and
# mongod) instead of a wrapper that would leave children holding the ports.
#
# Only this checkout's stack.json with a live pid counts as "up". A listening port
# alone is never adopted, and `down` never stops anything it did not start.
#
# Usage: scripts/dev-stack.sh up [--fresh] | down | status | ports

set -euo pipefail

cd "$(dirname "$0")/.."

command -v jq >/dev/null 2>&1 || {
	echo "dev-stack: jq is required" >&2
	exit 2
}

STATE=".tmp/dev-stack"
STACK="$STATE/stack.json"

port_open() { timeout 1 bash -c "</dev/tcp/127.0.0.1/$1" 2>/dev/null; }

live() { [ -f "$STACK" ] && kill -0 "$(jq -r .pid "$STACK")" 2>/dev/null; }

web_url() { echo "http://localhost:$(jq -r .web "$STACK")"; }

cmd_up() {
	local fresh=0
	for arg in "$@"; do
		case "$arg" in
		--fresh) fresh=1 ;;
		*)
			echo "dev-stack: unknown option $arg" >&2
			exit 2
			;;
		esac
	done

	if live; then
		echo "web: already up (ours)"
	else
		mkdir -p "$STATE"
		rm -f "$STACK"
		setsid pnpm dev </dev/null >"$STATE/dev.log" 2>&1 &
		echo $! >"$STATE/dev.pid"
		local timeout=${DEV_STACK_WEB_TIMEOUT:-180}
		local deadline=$((SECONDS + timeout))
		until live && curl -s -o /dev/null -m 10 "$(web_url)"; do
			if [ "$SECONDS" -ge "$deadline" ] || ! kill -0 "$(cat "$STATE/dev.pid")" 2>/dev/null; then
				echo "dev-stack: web did not answer within ${timeout}s; last lines of $STATE/dev.log:" >&2
				tail -n 20 "$STATE/dev.log" >&2
				exit 1
			fi
			sleep 1
		done
	fi

	[ "$fresh" = 0 ] || pnpm seed
	echo "WEB_URL=$(web_url)"
}

cmd_down() {
	if [ ! -f "$STATE/dev.pid" ] && [ ! -f "$STACK" ]; then
		echo "dev-stack: nothing running"
		return 0
	fi

	local ports=""
	if [ -f "$STACK" ]; then ports=$(jq -r '.web, .mongo // empty' "$STACK"); fi

	if [ -f "$STATE/dev.pid" ]; then
		local pgid
		pgid=$(cat "$STATE/dev.pid")
		kill -TERM -"$pgid" 2>/dev/null || true
		for _ in $(seq 10); do
			kill -0 -"$pgid" 2>/dev/null || break
			sleep 1
		done
		kill -KILL -"$pgid" 2>/dev/null || true
		rm -f "$STATE/dev.pid"
		echo "dev-stack: stopped"
	fi
	rm -f "$STACK"

	local busy=() port
	for port in $ports; do
		if port_open "$port"; then busy+=("$port"); fi
	done
	if [ ${#busy[@]} -gt 0 ]; then
		echo "dev-stack: still listening (not started by us): ${busy[*]}"
	elif [ -n "$ports" ]; then
		echo "dev-stack: all ports clear"
	fi
}

cmd_status() {
	if [ ! -f "$STACK" ]; then
		echo "dev-stack: nothing running"
		return 0
	fi
	local owner=external svc port state
	if live; then owner=ours; fi
	for svc in web mongo; do
		port=$(jq -r ".$svc // empty" "$STACK")
		[ -n "$port" ] || continue
		state=free
		if port_open "$port"; then state=listening; fi
		echo "$port  $state  ($owner)  $svc"
	done
}

cmd_ports() {
	if live; then
		jq -r .web "$STACK"
	else
		exit 1
	fi
}

case "${1:-}" in
up)
	shift
	cmd_up "$@"
	;;
down) cmd_down ;;
status) cmd_status ;;
ports) cmd_ports ;;
*)
	echo "usage: scripts/dev-stack.sh up [--fresh] | down | status | ports" >&2
	exit 2
	;;
esac
