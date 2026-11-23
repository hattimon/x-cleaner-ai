# Raspberry Pi with Ubuntu Server

Use a 64-bit Ubuntu Server installation. `uname -m` should report `aarch64`. Install Docker Engine and the Compose plugin using the official Ubuntu instructions. [Docker Engine for Ubuntu](https://docs.docker.com/engine/install/ubuntu/)

From a checkout of this repository, initialize secrets and start the stack. The Node image runs only the initialization script and can replace a host Node installation.

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:22-bookworm-slim node scripts/init.mjs
docker compose up -d --build --wait
docker compose ps
docker compose logs --no-color backend | grep initial_credentials
```

For published container images, use the registry override. It keeps the same PostgreSQL volume and settings for the same Compose project.

```bash
docker compose -f compose.yaml -f compose.registry.yaml pull
docker compose -f compose.yaml -f compose.registry.yaml up -d --no-build --wait
```

The stack uses `restart: unless-stopped`. The Docker daemon must start with Ubuntu. You can enable it on the Raspberry Pi with `sudo systemctl enable --now docker`. A stack deliberately stopped by its owner stays stopped. [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/)

The default listener binds to the Pi's loopback. From a client computer with authorized SSH access, forward a local port.

```bash
ssh -N -L 3180:127.0.0.1:3180 user@your-pi
```

Visit [http://localhost:3180](http://localhost:3180) on the client. If a Windows copy already uses 3180, use another local forwarded port and set the Pi's `PUBLIC_ORIGIN` and `SIWC_CALLBACK_ORIGIN` to that browser-facing port. Keep the right-hand port in the SSH command equal to the Pi's `APP_PORT`. For direct LAN access, terminate HTTPS on a private reverse proxy, configure `PUBLIC_ORIGIN` to that origin, retain the browser's Host header and restrict access at the network boundary. Official ChatGPT plan authorization in this release requires the matching HTTP loopback route.

Alternatively, install the standalone image from the DCC App Store. It runs PostgreSQL, the backend and the dashboard inside one container. [DCC installation](DCC-INSTALL.md)
