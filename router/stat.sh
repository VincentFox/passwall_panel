#!/bin/sh
set -eu

MODE="text"
[ "${1:-}" = "-j" ] && MODE="json"

now_utc() {
  date -u "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S%z"
}

sum_iptables() {
  local total_pkts=0 total_bytes=0 local_pkts=0 local_bytes=0 lan_pkts=0 lan_bytes=0 found=0
  local result tpk tby lpk lby lnp lnb fnd

  if ! command -v iptables >/dev/null 2>&1; then
    printf "0 0 0 0 0 0 0\n"
    return 0
  fi

  result=$(
    for table in nat mangle; do
      for chain in PSW PSW_OUTPUT; do
        iptables -t "$table" -L "$chain" -v -n 2>/dev/null || true
      done
    done | awk 'BEGIN{chain=""; table=""}
      /^Chain / {chain=$2; next;}
      /^[ \t]*[0-9]/ {
        pkts=$1; bytes=$2; target=$3;
        # convert human-readable bytes
        if (bytes ~ /[KMGTP]$/) {
          unit=substr(bytes,length(bytes),1);
          val=substr(bytes,1,length(bytes)-1)+0;
          if (unit=="K") bytes=val*1024;
          else if (unit=="M") bytes=val*1024*1024;
          else if (unit=="G") bytes=val*1024*1024*1024;
          else if (unit=="T") bytes=val*1024*1024*1024*1024;
          else if (unit=="P") bytes=val*1024*1024*1024*1024*1024;
        }
        is_proxy = (target ~ /^(REDIRECT|TPROXY|PSW_RULE)$/);
        if (!is_proxy) next;
        total_pkts+=pkts; total_bytes+=bytes; found++;
        if (chain ~ /PSW_OUTPUT/) { local_pkts+=pkts; local_bytes+=bytes; }
        else if (chain ~ /PSW/) { lan_pkts+=pkts; lan_bytes+=bytes; }
      }
      END{printf "%d %d %d %d %d %d %d\n", total_pkts, total_bytes, local_pkts, local_bytes, lan_pkts, lan_bytes, found;}
    '
  )

  set -- $result
  tpk=${1:-0}; tby=${2:-0}; lpk=${3:-0}; lby=${4:-0}; lnp=${5:-0}; lnb=${6:-0}; fnd=${7:-0}
  total_pkts=$((total_pkts + tpk))
  total_bytes=$((total_bytes + tby))
  local_pkts=$((local_pkts + lpk))
  local_bytes=$((local_bytes + lby))
  lan_pkts=$((lan_pkts + lnp))
  lan_bytes=$((lan_bytes + lnb))
  found=$((found + fnd))

  printf "%d %d %d %d %d %d %d\n" "$total_pkts" "$total_bytes" "$local_pkts" "$local_bytes" "$lan_pkts" "$lan_bytes" "$found"
}

ipt_result=$(sum_iptables)
set -- $ipt_result
ipt_total_pkts=$1
ipt_total_bytes=$2
ipt_local_pkts=$3
ipt_local_bytes=$4
ipt_lan_pkts=$5
ipt_lan_bytes=$6
ipt_found=$7

backend=""
if [ "$ipt_found" -gt 0 ]; then
  backend="iptables"
  total_pkts=$ipt_total_pkts
  total_bytes=$ipt_total_bytes
  local_pkts=$ipt_local_pkts
  local_bytes=$ipt_local_bytes
  lan_pkts=$ipt_lan_pkts
  lan_bytes=$ipt_lan_bytes
else
  backend="unknown"
  total_pkts=0
  total_bytes=0
  local_pkts=0
  local_bytes=0
  lan_pkts=0
  lan_bytes=0
fi

stamp=$(now_utc)

if [ "$MODE" = "json" ]; then
  printf '{"backend":"%s","total_packets":%s,"total_bytes":%s,"local_packets":%s,"local_bytes":%s,"lan_packets":%s,"lan_bytes":%s,"rules":%s,"ts":"%s"}\n' \
    "$backend" "$total_pkts" "$total_bytes" "$local_pkts" "$local_bytes" "$lan_pkts" "$lan_bytes" "$ipt_found" "$stamp"
else
  echo "Passwall traffic (local=router output, lan=PREROUTING/FORWARD)"
  echo "backend: $backend"
  echo "total_packets: $total_pkts"
  echo "total_bytes: $total_bytes"
  echo "local_packets: $local_pkts"
  echo "local_bytes: $local_bytes"
  echo "lan_packets: $lan_pkts"
  echo "lan_bytes: $lan_bytes"
  echo "rules: $ipt_found"
  echo "ts: $stamp"
  if [ "$backend" = "unknown" ]; then
    echo "note: no passwall proxy rules found. try: iptables-save -c | grep -i passwall"
  fi
fi



