#!/bin/sh
# Setup push mode on OpenWrt for Passwall Traffic panel.
# Usage:
#   sh openwrt-push-setup.sh \
#     -u http://PANEL:8080/api/ingest \
#     -U passwall -P change_me \
#     -d ARS2 -i 192.168.1.1 \
#     -n 60

set -eu

URL=""
USER=""
PASS=""
DEVICE=""
IPADDR=""
INTERVAL=60

while [ $# -gt 0 ]; do
  case "$1" in
    -u|--url) URL="$2"; shift 2;;
    -U|--user) USER="$2"; shift 2;;
    -P|--pass) PASS="$2"; shift 2;;
    -d|--device) DEVICE="$2"; shift 2;;
    -i|--ip) IPADDR="$2"; shift 2;;
    -n|--interval) INTERVAL="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
 done

if [ -z "$URL" ] || [ -z "$USER" ] || [ -z "$PASS" ]; then
  echo "Missing required args. Need -u URL -U USER -P PASS" >&2
  exit 1
fi

if [ -z "$DEVICE" ]; then
  DEVICE=$(uname -n 2>/dev/null || echo router)
fi

if [ -z "$IPADDR" ]; then
  IPADDR=$(ip -4 addr show br-lan 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n1 || true)
fi

if [ ! -x /usr/libexec/passwall-traffic/stat.sh ]; then
  echo "Missing /usr/libexec/passwall-traffic/stat.sh" >&2
  exit 1
fi

cat > /usr/bin/passwall-push.sh <<'SCRIPT'
#!/bin/sh
set -eu

URL="__URL__"
USER="__USER__"
PASS="__PASS__"
DEVICE="__DEVICE__"
IPADDR="__IPADDR__"

json=$(/usr/libexec/passwall-traffic/stat.sh -j 2>/dev/null || true)
[ -z "$json" ] && exit 0

if [ -n "$DEVICE" ] || [ -n "$IPADDR" ]; then
  json=$(printf "%s" "$json" | sed "s/}$/,\"device\":\"$DEVICE\",\"ip\":\"$IPADDR\"}/")
fi

curl -u "$USER:$PASS" -H 'Content-Type: application/json' -d "$json" "$URL" >/dev/null 2>&1 || true
SCRIPT

sed -i \
  -e "s#__URL__#$URL#g" \
  -e "s#__USER__#$USER#g" \
  -e "s#__PASS__#$PASS#g" \
  -e "s#__DEVICE__#$DEVICE#g" \
  -e "s#__IPADDR__#$IPADDR#g" \
  /usr/bin/passwall-push.sh

chmod +x /usr/bin/passwall-push.sh

# Install cron job
CRON_LINE="*/$INTERVAL * * * * /usr/bin/passwall-push.sh"

(crontab -l 2>/dev/null | grep -v "passwall-push.sh" || true; echo "$CRON_LINE") | crontab -

/etc/init.d/cron restart >/dev/null 2>&1 || true

echo "Installed: /usr/bin/passwall-push.sh"
echo "Cron: $CRON_LINE"
