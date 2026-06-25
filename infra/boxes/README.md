# MagicBox fleet — infrastructure as code

Versioned, identical (iso) configuration for every VMOS box. A box runs:

- **cloudflared** — exposes the box behind a Cloudflare Tunnel with two routes:
  `box-N.attila.army` → the HTTP proxy, and `ssh-box-N.attila.army` → SSH,
  both protected by Cloudflare Access (service-token policy "MagicBox SSH").
- **magicbox-proxy** — the Node reverse proxy (code lives in
  [`../magicbox-proxy`](../magicbox-proxy)) on `127.0.0.1:8080`.

Everything is identical across boxes except two values, captured in
[`manifest.tsv`](manifest.tsv): the **box number** (hostnames) and the
**tunnel id**. The LAN IP for the VMOS API is auto-detected by the proxy
(`config.js`), so the systemd units are byte-for-byte iso.

## Layout

| Path | Role |
|---|---|
| `manifest.tsv` | Source of truth: box number → tunnel id |
| `templates/cloudflared.config.yml.tmpl` | Rendered per box → `/etc/cloudflared/config.yml` |
| `files/cloudflared.service` | iso → `/etc/systemd/system/cloudflared.service` |
| `files/magicbox-proxy.service` | iso → `/etc/systemd/system/magicbox-proxy.service` |
| `scripts/deploy.sh` | Converge a box to this state (idempotent) |

Secrets are **never** in the repo: the tunnel credentials JSON stays on the
box; the SSH password and CF Access service token are read from env / a
gitignored `.env` (see `.env.example`).

## Deploy

```bash
cp .env.example .env   # fill BOX_SSH_PASSWORD (CF_ACCESS_* fall back to app .env.local)
./scripts/deploy.sh 3 4          # converge specific boxes
./scripts/deploy.sh              # converge all boxes in the manifest
./scripts/deploy.sh --proxy-only 3 4   # fast path: only sync the proxy code
```

The script renders the cloudflared config, pushes the units + proxy code,
validates the ingress, restarts the services and health-checks each box.

## One-time bootstrap (SSH not yet reachable)

`deploy.sh` reaches a box over SSH-through-Access, which needs three things in
place first: the DNS record `ssh-box-N.attila.army`, a Cloudflare Access app
for it, and the `ssh://localhost:22` ingress rule in the box's
`/etc/cloudflared/config.yml`.

DNS + Access are managed centrally (Cloudflare API) and already exist for
boxes 1–4. The ingress rule lives in a **local** file on the box, so a brand
new box (or one that never had SSH) needs this added **once, with physical /
console access**, before `deploy.sh` can take over:

```bash
# on the box, as root — add the SSH route as the FIRST ingress rule:
#   - hostname: ssh-box-N.attila.army
#     service: ssh://localhost:22
# (keep the existing box-N http rule and the trailing http_status:404)
systemctl restart cloudflared
```

After that one edit, `deploy.sh` keeps the box fully iso (it ships the exact
same `config.yml`, so the manual edit is immediately superseded by the
versioned template).
