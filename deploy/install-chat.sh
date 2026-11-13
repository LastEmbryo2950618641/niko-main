#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then exec sudo -n bash "$0" "$@"; fi
root="$(cd "$(dirname "$0")/.." && pwd)"
origin="${1:?Usage: install-chat.sh https://your-site.example}"
node_bin="$(command -v node)"
service_user="$(stat -c %U "$root/index.html")"
test "$service_user" != root
test -f "$root/server/chat-server.mjs"
"$node_bin" --check "$root/server/chat-server.mjs"
case "$origin" in http://*|https://*) ;; *) echo 'Invalid public origin' >&2; exit 1;; esac
case "$origin" in *' '*|*'"'*|*'%'*|*'$'*|*'`'*) echo 'Invalid public origin' >&2; exit 1;; esac
cat > /etc/systemd/system/niko-home-chat.service <<EOF
[Unit]
Description=Niko homepage stateless chat relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$service_user
WorkingDirectory=$root
Environment=CHAT_PUBLIC_ORIGIN=$origin
Environment=CHAT_PORT=4181
ExecStart=$node_bin $root/server/chat-server.mjs
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
MemoryMax=256M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable niko-home-chat.service
systemctl restart niko-home-chat.service
healthy=0
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4181/chat-api/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 0.3
done
test "$healthy" -eq 1
# Remove only the obsolete homepage vault files after the stateless relay is healthy.
# Never copy old user credentials into a deployment backup.
if test -d /var/lib/niko-home-chat; then
  find /var/lib/niko-home-chat -regextype posix-extended -maxdepth 1 -type f -regex '/var/lib/niko-home-chat/(master\.key|[0-9a-f]{64}\.vault(\.[0-9a-f]{12}\.tmp)?)' -delete
  rmdir /var/lib/niko-home-chat 2>/dev/null || true
fi
nginx_conf=/etc/nginx/sites-available/worldseed
backup="${nginx_conf}.before-home-chat-$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "$nginx_conf" "$backup"
python3 - "$nginx_conf" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
if '# BEGIN homepage chat' in text:
    print('Homepage chat Nginx routes already installed.')
    raise SystemExit(0)
marker = '    location = /nikowenku-archive {'
if marker not in text:
    raise SystemExit('Could not locate the homepage server block; Nginx was not changed.')
block = '''    # BEGIN homepage chat
    location ^~ /chat-api/ {
        proxy_pass http://127.0.0.1:4181;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Origin $http_origin;
        proxy_buffering off;
        proxy_cache off;
        client_max_body_size 256k;
        proxy_read_timeout 320s;
    }
    location ^~ /server/ { return 404; }
    location ^~ /test/ { return 404; }
    location ^~ /deploy/ { return 404; }
    # END homepage chat

'''
path.write_text(text.replace(marker, block + marker, 1))
PY
if ! nginx -t; then cp -a "$backup" "$nginx_conf"; exit 1; fi
systemctl reload nginx
healthy=0
for _ in $(seq 1 20); do
  if curl -fsS "$origin/chat-api/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 0.3
done
test "$healthy" -eq 1
echo 'Public chat health: OK'
echo 'Homepage chat deployed; existing book and writing services were not restarted.'
