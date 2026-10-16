#!/usr/bin/env bash
# Virtual test printer (D25): CUPS' ippeveprinter on this Mac, port 8631, keeps every received job (-k) in
# artifacts/vprinter/spool. iOS Simulator finds it via Bonjour (AirPrint: _universal subtype, PDF/PWG/URF);
# the Android emulator finds "MakerPrint Android" (see start). Printers: never a real one.
# Usage: scripts/vprinter.sh start|stop|status|media|jobs
# Stops only the PID it started (artifacts/vprinter.pid) — never by name (V1_PLAN rule 3).
set -euo pipefail
cd "$(dirname "$0")/.."
pidfile=artifacts/vprinter.pid
spool=artifacts/vprinter/spool/$(date +%Y%m%d-%H%M%S) # one folder per start: job numbers restart at 1
port=${VPRINTER_PORT:-8631}
# VPRINTER_FORMATS=image/pwg-raster,image/urf: a printer WITHOUT PDF, like most home printers: the print services must
# rasterise (Android BIPS StartJobTask / iOS URF) — the case D12's fit-to-page rules are about.
formats=${VPRINTER_FORMATS:-application/pdf,image/pwg-raster,image/urf}
running() { [[ -f $pidfile ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; }

case "${1:?Usage: vprinter.sh start|stop|status|jobs}" in
  start)
    if running; then echo "running (PID $(cat "$pidfile"))"; exit 0; fi
    mkdir -p "$spool"
    # VPRINTER_HOST (optional) = ippeveprinter -n: binds to and advertises that host name only (e.g. localhost). Default:
    # all interfaces, advertised with this Mac's name. The macOS firewall blocks LAN access to ippeveprinter unless the
    # owner clicks "Allow"; the Simulator (loopback) and the emulator (10.0.2.2 = this Mac's loopback) do not need it.
    nohup /usr/bin/ippeveprinter -k -d "$spool" -p "$port" ${VPRINTER_HOST:+-n "$VPRINTER_HOST"} -r _universal \
      -f "$formats" -M "MakerPrint" -m "Test" "MakerPrint Test" \
      >artifacts/vprinter/ippeveprinter.log 2>&1 &
    echo $! >"$pidfile"
    sleep 1
    running || { echo "ippeveprinter did not start, see artifacts/vprinter/ippeveprinter.log" >&2; exit 1; }
    echo "started (PID $(cat "$pidfile"), port $port, spool $spool)"
    # Android emulator path: the emulator cannot reach this Mac's LAN address (and the firewall blocks ippeveprinter),
    # so a second Bonjour record "MakerPrint Android" points at 10.0.2.2:8633 (= this Mac's loopback seen from the
    # emulator), served by a loopback proxy that gives the printer a different printer-uuid (scripts/vprinter/uuid-proxy.mjs).
    nohup node scripts/vprinter/uuid-proxy.mjs 8633 "$port" 127.0.0.1 >artifacts/vprinter/uuid-proxy.log 2>&1 &
    echo $! >artifacts/vprinter-proxy.pid
    nohup dns-sd -P "MakerPrint Android" _ipp._tcp,_universal local 8633 makerprint-android.local 10.0.2.2 rp=ipp/print \
      "ty=MakerPrint Android" "pdl=$formats" Color=F Duplex=F UUID=a0a0a0a0-0000-4000-8000-000000008633 \
      URF=CP1,IS1-4-5-19,MT1-2-3-4-5-6,RS600,V1.4,W8 txtvers=1 qtotal=1 >artifacts/vprinter/dnssd.log 2>&1 &
    echo $! >artifacts/vprinter-dnssd.pid
    echo "Android: \"MakerPrint Android\" (10.0.2.2:8633, proxy PID $(cat artifacts/vprinter-proxy.pid), dns-sd PID $(cat artifacts/vprinter-dnssd.pid))"
    ;;
  stop)
    if running; then kill "$(cat "$pidfile")"; echo "stopped PID $(cat "$pidfile")"; else echo "not running"; fi
    for f in artifacts/vprinter-proxy.pid artifacts/vprinter-dnssd.pid; do
      if [[ -f $f ]] && kill -0 "$(cat "$f")" 2>/dev/null; then kill "$(cat "$f")"; echo "stopped PID $(cat "$f") ($f)"; fi
    done
    ;;
  status)
    if running; then echo "running (PID $(cat "$pidfile"))"; else echo "not running"; exit 1; fi
    ;;
  media)
    # Loaded papers (media-ready) via ippeveprinter's own web form: main tray A4, by-pass tray Letter, so the iOS
    # dialog (which lists loaded papers only) offers both. Default ippeveprinter: Letter + #10 envelope.
    node -e 'fetch(`http://localhost:${process.argv[1]}/media?size1=iso_a4_210x297mm&type1=stationery&level1=250&size3=na_letter_8.5x11in&type3=stationery&level3=250`).then((r) => { console.log("media:", r.status); process.exit(r.ok ? 0 : 1); })' "$port"
    ;;
  jobs)
    ls -lt "$(ls -d artifacts/vprinter/spool/*/ | tail -1)" 2>/dev/null | head -20
    ;;
  *)
    echo "Usage: vprinter.sh start|stop|status|jobs" >&2
    exit 1
    ;;
esac
