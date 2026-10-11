#!/usr/bin/env bash
#
# Runs this checkout's `pnpm dev` in the background. `pnpm dev` allocates the web
# and MongoDB ports and records them in .tmp/dev-stack/stack.json. `up` starts it
# under setsid so `down` can signal the whole process group (pnpm, tsx, next and
# mongod) instead of a wrapper that would leave children holding the ports.
#
# Only this checkout's stack.json with a live pid counts as "up", and only when
# every listener on its web port and its pid belong to the process group `up`
# launched. A listening port alone is never adopted, and `down` never stops
# anything it did not start.
# A pid only counts when its /proc start time matches the one recorded with it,
# so a reused pid is never trusted. A dead group leader with a live group is
# still ours: Linux does not reuse a pid while its process group exists.
# up and down hold a per-checkout flock; the launched stack closes that fd.
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

proc_field() {
	local field=$2 stat
	stat=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
	# shellcheck disable=SC2086
	set -- ${stat##*) }
	echo "${!field}"
}

proc_start() { proc_field "$1" 20; }

owner_alive() {
	[ -f "$STACK" ] || return 1
	local pid
	pid=$(jq -r .pid "$STACK")
	kill -0 "$pid" 2>/dev/null && [ "$(proc_start "$pid")" = "$(jq -r '.start // empty' "$STACK")" ]
}

web_pids() { ss -ltnpH "sport = :$(jq -r .web "$STACK")" | { grep -o 'pid=[0-9]*' || true; } | cut -d= -f2 | sort -u; }

web_foreign() {
	local pgid pid pids
	pids=$(web_pids)
	if [ -z "$pids" ]; then
		port_open "$(jq -r .web "$STACK")"
		return
	fi
	read -r pgid _ <"$STATE/dev.pid" 2>/dev/null || return 0
	for pid in $pids $(jq -r .pid "$STACK"); do
		[ "$(proc_field "$pid" 3)" = "$pgid" ] || return 0
	done
	return 1
}

live() { owner_alive && launch_alive && [ -n "$(web_pids)" ] && ! web_foreign; }

refuse_foreign() {
	echo "dev-stack: web port $(jq -r .web "$STACK") is held by a process outside this checkout's launch (pids: $(web_pids | xargs echo)); not adopting it" >&2
	exit 1
}

launch_alive() {
	[ -f "$STATE/dev.pid" ] || return 1
	local pgid start now
	read -r pgid start <"$STATE/dev.pid"
	kill -0 -"$pgid" 2>/dev/null || return 1
	now=$(proc_start "$pgid") || return 0
	[ "$now" = "$start" ]
}

lock() {
	mkdir -p "$STATE"
	exec 9>"$STATE/lock"
	flock 9
}

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
	elif owner_alive && web_foreign; then
		refuse_foreign
	else
		if launch_alive; then
			echo "dev-stack: joining launch in progress (pgid $(cut -d' ' -f1 "$STATE/dev.pid"))"
		else
			rm -f "$STACK"
			setsid pnpm dev </dev/null >"$STATE/dev.log" 2>&1 9>&- &
			echo "$! $(proc_start $!)" >"$STATE/dev.pid"
		fi
		local timeout=${DEV_STACK_WEB_TIMEOUT:-180}
		local deadline=$((SECONDS + timeout))
		until live && curl -s -o /dev/null -m 10 "$(web_url)"; do
			if [ -f "$STACK" ] && web_foreign; then refuse_foreign; fi
			if [ "$SECONDS" -ge "$deadline" ] || ! launch_alive; then
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

	if launch_alive; then
		local pgid
		pgid=$(cut -d' ' -f1 "$STATE/dev.pid")
		kill -TERM -"$pgid" 2>/dev/null || true
		for _ in $(seq 10); do
			kill -0 -"$pgid" 2>/dev/null || break
			sleep 1
		done
		kill -KILL -"$pgid" 2>/dev/null || true
		echo "dev-stack: stopped"
	elif [ -f "$STATE/dev.pid" ]; then
		echo "dev-stack: launch in dev.pid is gone or no longer ours; nothing signalled"
	fi
	rm -f "$STATE/dev.pid"
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
	lock
	cmd_up "$@"
	;;
down)
	lock
	cmd_down
	;;
status) cmd_status ;;
ports) cmd_ports ;;
*)
	echo "usage: scripts/dev-stack.sh up [--fresh] | down | status | ports" >&2
	exit 2
	;;
esac
