#!/bin/sh
# /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
# Run by certbot after it renews a certificate (and only then): nginx keeps serving the old one from memory until it is
# reloaded. A reload swaps it in without dropping a single connection (playing songs, Jam streams carry on).
nginx -t -q && systemctl reload nginx
