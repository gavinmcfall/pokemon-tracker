# Deploying to home-ops

These manifests are the Flux-ready deployment for the `livingdex` namespace,
written to slot into a standard home-ops repo layout
(`kubernetes/apps/livingdex/…`). Copy them across and adjust the marked
placeholders to your repo's conventions:

| Placeholder | Where | What to set |
|---|---|---|
| `storageClass: ceph-block` | `pg-cluster.yaml`, `helmrelease.yaml` | your Rook-Ceph block storage class name |
| `chartRef` | `helmrelease.yaml` | your shared bjw-s `app-template` OCIRepository name/namespace |
| `parentRefs` | `httproute.yaml` | your Envoy Gateway `Gateway` name + namespace (internal vs external decides LAN-only vs tunnel) |
| `hostnames` | `httproute.yaml` | e.g. `livingdex.${SECRET_DOMAIN}` if you use Flux post-build substitution |
| image tags | `helmrelease.yaml`, `seed-job.yaml` | pin to the sha tags CI publishes (`ghcr.io/gavinmcfall/livingdex-api`, `…-web`) |

Order of operations on first install:

1. Reconcile the kustomization (namespace, CNPG cluster, HelmRelease, HTTPRoute).
   CNPG creates the `livingdex-pg-app` secret; the api runs migrations on boot.
2. Apply `seed-job.yaml` once (`kubectl apply -f seed-job.yaml`) for the
   initial catalogue load (~3k PokéAPI requests, a few minutes). The weekly
   CronJob (inside the HelmRelease) keeps it fresh afterwards; both share the
   `livingdex-seed-cache` PVC so re-runs mostly hit the disk cache.
3. Open the HTTPRoute hostname. Import your existing sheet as CSV via the UI.

Notes:

- No External Secrets / 1Password needed: the only secret is the CNPG-generated
  app credential. (That changes only if sprite mirroring to R2/MinIO is added.)
- `web` proxies `/api` → `livingdex-api:8080` (see `API_UPSTREAM`), so the app
  is a single origin and needs no CORS.
- Postgres backups: hook `livingdex-pg` into whatever CNPG backup scheme the
  cluster already uses (barman objectstore / volume snapshots). The `status`
  table is the only data that can't be regenerated — export CSV is a cheap
  extra safety net.
