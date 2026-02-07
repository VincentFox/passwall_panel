#!/bin/sh
# Place on OpenWrt: /www/cgi-bin/passwall-status and chmod +x
# Requires: /usr/libexec/passwall-traffic/stat.sh (from luci-app-passwall-traffic)
# Basic Auth via HTTP Authorization header.

USER="passwall"
PASS="change_me"

expected=$(printf "%s:%s" "$USER" "$PASS" | base64 2>/dev/null)

if [ -z "${HTTP_AUTHORIZATION:-}" ]; then
  echo "Status: 401 Unauthorized"
  echo "WWW-Authenticate: Basic realm=Passwall"
  echo "Content-Type: text/plain"
  echo
  echo "Unauthorized"
  exit 0
fi

case "$HTTP_AUTHORIZATION" in
  Basic\ *)
    token=${HTTP_AUTHORIZATION#Basic }
    ;;
  *)
    token=""
    ;;
esac

if [ "$token" != "$expected" ]; then
  echo "Status: 401 Unauthorized"
  echo "WWW-Authenticate: Basic realm=Passwall"
  echo "Content-Type: text/plain"
  echo
  echo "Unauthorized"
  exit 0
fi

if [ ! -x /usr/libexec/passwall-traffic/stat.sh ]; then
  echo "Status: 500 Internal Server Error"
  echo "Content-Type: text/plain"
  echo
  echo "stat.sh not found"
  exit 0
fi

json=$(/usr/libexec/passwall-traffic/stat.sh -j 2>/dev/null || true)
if [ -z "$json" ]; then
  echo "Status: 500 Internal Server Error"
  echo "Content-Type: text/plain"
  echo
  echo "no data"
  exit 0
fi

hostname=$(uname -n 2>/dev/null || echo router)
ipaddr=$(ip -4 addr show br-lan 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n1)
if [ -n "$ipaddr" ]; then
  json=$(printf "%s" "$json" | sed "s/}$/,\"device\":\"$hostname\",\"ip\":\"$ipaddr\"}/")
fi

echo "Content-Type: application/json"
echo
printf "%s" "$json"
