Start nginx without the app upstream during the TLS bootstrap

`nginx/init-letsencrypt.sh` aborted the TLS bootstrap with "nginx failed to start — check nginx.conf for syntax errors", but the config was valid: started with `--no-deps`, nginx couldn't resolve `upstream app { server app:3000; }` and died with `[emerg] host not found in upstream "app:3000"`, and `nginx -t >/dev/null 2>&1` hid that.

- During the bootstrap nginx runs a new port-80-only config, `nginx.bootstrap.conf`: the ACME webroot and a 404 for everything else, with no `upstream{}` and no TLS server, so it starts without `app` or certs
- The swap happens under an `EXIT` trap that always restores `nginx.conf`, and nginx starts with `--force-recreate` so a container left by a failed run picks up the swapped config
- When `nginx -t` fails, the script prints its output and the last 50 nginx log lines instead of the old message
- Once the cert is issued the script restores `nginx.conf` and stops and removes the bootstrap nginx (not `docker compose down`, which would take the whole stack), so the operator's `docker compose up -d` starts nginx with `app`
- The TLS setup doc describes the swap and the common failures, and `.gitignore` covers the transient `nginx/.nginx.conf.bootstrap-backup`

The production `nginx.conf` is unchanged: resolving `app` at runtime would cost the `keepalive` upstream pool.

Not tested: run `init-letsencrypt.sh` on a fresh host and check the certificate is issued and `nginx.conf` is restored afterwards.
