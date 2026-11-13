#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then exec sudo -n bash "$0" "$@"; fi
public_ip="${1:?Usage: enable-https.sh public-ipv4}"
python3 - "$public_ip" <<'PY'
import ipaddress,sys
address=ipaddress.ip_address(sys.argv[1])
assert address.version==4 and address.is_global, 'A public IPv4 address is required'
PY
certbot_root=/opt/niko-certbot/packages
if ! test -x "$certbot_root/bin/certbot"; then
  python3 -m pip install --index-url https://pypi.org/simple --target "$certbot_root" 'certbot==5.10.0' 'acme==5.10.0'
fi
export PYTHONPATH="$certbot_root"
certbot_bin="$certbot_root/bin/certbot"
conf=/etc/nginx/sites-available/worldseed
backup="/var/backups/niko-homepage-before-https-$(date -u +%Y%m%dT%H%M%SZ).conf"
cp -a "$conf" "$backup"
override=/etc/systemd/system/niko-home-chat.service.d/https.conf
had_override=0
if test -f "$override"; then cp -a "$override" "$backup.origin"; had_override=1; fi
service_changed=0
rollback(){
  trap - ERR
  cp -a "$backup" "$conf"
  nginx -t && systemctl reload nginx
  if test "$service_changed" -eq 1; then
    if test "$had_override" -eq 1; then cp -a "$backup.origin" "$override"; else rm -f -- "$override"; fi
    systemctl daemon-reload
    systemctl restart niko-home-chat.service
  fi
}
trap rollback ERR
install -d -m 755 /var/lib/niko-acme/.well-known/acme-challenge
python3 - "$conf" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1]);text=path.read_text()
if '# BEGIN homepage ACME' not in text:
    marker='    location ~ /\\. {'
    assert text.count(marker)==1, 'Could not locate the expected homepage block'
    block='''    # BEGIN homepage ACME
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/niko-acme;
        default_type text/plain;
        try_files $uri =404;
    }
    # END homepage ACME

'''
    path.write_text(text.replace(marker,block+marker,1))
PY
nginx -t
systemctl reload nginx
"$certbot_bin" certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --webroot -w /var/lib/niko-acme --ip-address "$public_ip" \
  --preferred-profile shortlived --cert-name niko-home-ip --keep-until-expiring
python3 - "$conf" "$public_ip" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1]);text=path.read_text();ip=sys.argv[2]
if '# BEGIN homepage library origin bridge' not in text:
    # The existing library backend pins its HTTP public origin. Translate only the
    # exact validated HTTPS origin; preserve every other Origin so CSRF checks stay effective.
    bridge='''# BEGIN homepage library origin bridge
map "$scheme|$http_origin" $niko_library_origin {
    default $http_origin;
    "https|https://'''+ip+'''" "http://'''+ip+'''";
}
# END homepage library origin bridge

'''
    for marker in ['    location /nikowenku-archive/api/ {','    location /api/ {']:
        assert text.count(marker)==1, 'Could not locate the existing library proxy'
        text=text.replace(marker,marker+'\n        proxy_set_header Origin $niko_library_origin;',1)
    text=bridge+text
if '# BEGIN homepage TLS' not in text:
    marker='    listen [::]:80 default_server;'
    assert text.count(marker)==1, 'Could not locate the expected listener'
    tls='''
    # BEGIN homepage TLS
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    ssl_certificate /etc/letsencrypt/live/niko-home-ip/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/niko-home-ip/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    # END homepage TLS'''
    text=text.replace(marker,marker+tls,1)
    marker='    location ^~ /chat-api/ {'
    assert text.count(marker)==1
    text=text.replace(marker,marker+'\n        if ($scheme = http) { return 426; }',1)
    marker='    location / {\n        try_files $uri $uri/ =404;'
    assert text.count(marker)==1
    text=text.replace(marker,'    location / {\n        if ($scheme = http) { return 308 https://'+ip+'$request_uri; }\n        try_files $uri $uri/ =404;',1)
path.write_text(text)
PY
nginx -t
systemctl reload nginx
# Pin the relay to the HTTPS origin; never persist user API keys on the server.
install -d -m 755 /etc/systemd/system/niko-home-chat.service.d
service_changed=1
cat > "$override" <<EOF
[Service]
Environment=CHAT_PUBLIC_ORIGIN=https://$public_ip
EOF
systemctl daemon-reload
systemctl restart niko-home-chat.service
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/niko-reload-nginx <<'EOF'
#!/bin/sh
set -eu
nginx -t
systemctl reload nginx
EOF
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/niko-reload-nginx
cat > /etc/systemd/system/niko-certbot-renew.service <<EOF
[Unit]
Description=Renew homepage IP TLS certificate
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
Environment=PYTHONPATH=$certbot_root
ExecStart=$certbot_bin renew --quiet --cert-name niko-home-ip
EOF
cat > /etc/systemd/system/niko-certbot-renew.timer <<'EOF'
[Unit]
Description=Check short-lived homepage TLS certificate every six hours

[Timer]
OnBootSec=15min
OnUnitActiveSec=6h
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now niko-certbot-renew.timer
curl --fail --silent --show-error --resolve "$public_ip:443:127.0.0.1" "https://$public_ip/chat-api/health"
trap - ERR
echo 'Homepage HTTPS and automatic certificate renewal configured.'
