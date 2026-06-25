# infra/

Standalone infrastructure that lives **outside** the Next app (excluded from
the Next build) and runs on the VMOS boxes.

| Dir | What |
|---|---|
| [`boxes/`](boxes) | Fleet IaC: cloudflared config, systemd units, and the convergent deploy script. Source of truth for box state. |
| [`magicbox-proxy/`](magicbox-proxy) | The Node reverse proxy deployed to `/opt/magicbox-proxy` on each box (HTTP API + device streams + `/stream-ready` + `/proxy-test`). |

To deploy a box, use [`boxes/scripts/deploy.sh`](boxes/scripts/deploy.sh) — it
ships both the proxy code and the box config in one idempotent pass. See
[`boxes/README.md`](boxes/README.md).
