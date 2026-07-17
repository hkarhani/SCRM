# Segment Conflict Resolution Management

Portable single-container app for network segment conflict analysis and controlled range cleanup.

Created by Hassan Karhani.

## Requirements

- Docker
- Docker Compose
- A browser

No MongoDB, nginx, or external database is required.

## Run

```bash
git clone https://github.com/hkarhani/SCRM.git
cd SCRM

# Linux bind-mount permission setup.
# The container runs as non-root UID 10001 and writes runtime files under ./SCR.
mkdir -p SCR/uploads SCR/snapshots SCR/Documents
sudo chown -R 10001:10001 SCR
sudo chmod -R u+rwX SCR

docker compose up --build -d
```

Open:

```text
http://localhost:8088
```

The default Compose file binds the app to `127.0.0.1` only, so it is accessible only from the machine running the container.

## Stop

```bash
docker compose down
```

## Runtime Files

Runtime data is stored locally under:

```text
./SCR
```

This folder is ignored by Git and contains uploaded XML files, snapshots, generated documents, and local API metadata.

To reset the workspace:

```bash
docker compose down
rm -rf SCR
```

## Basic Use

1. Upload `Policies.xml`.
2. Upload `Segments.xml`.
3. Optionally collect host IPs from Web API, import offline collector output, or upload a hosts CSV with an `IPv4 Address` column.
4. Optionally collect live segments from Admin API.
5. Keep read-only mode for generated instructions, or explicitly enable live editing before Admin API range updates.

Detailed workflow and safety notes are in [docs/DETAILS.md](docs/DETAILS.md).

## Docker Image

When using a published image, keep the same localhost-only binding:

```bash
docker run --rm -p 127.0.0.1:8088:8080 -v "$PWD/SCR:/app/SCR" hkarhani/scrm:latest
```

The container runs as a non-root user.

When using a host-mounted `SCR` folder on Linux, create and assign it to the
container user before starting the image:

```bash
mkdir -p SCR/uploads SCR/snapshots SCR/Documents
sudo chown -R 10001:10001 SCR
sudo chmod -R u+rwX SCR
```

If the container repeatedly restarts and logs show:

```text
PermissionError: [Errno 13] Permission denied: '/app/SCR/uploads'
```

the host `SCR` folder is not writable by the container's non-root user. Run the
permission commands above, then restart:

```bash
docker compose down
docker compose up -d --build
```

## Docker Hub Publishing

Docker Hub automated builds are supported through the repository `hooks/` scripts.

- `hooks/build` bootstraps a Buildx `docker-container` builder, then runs `docker buildx build` with `--sbom=true` and `--provenance=mode=max`, then pushes the attested image.
- `hooks/push` skips the default push because the attested image was already pushed during the build hook.

Keep Docker Hub automated builds enabled, but make sure this repository is configured as the build source so Docker Hub uses the checked-in hooks.

To publish manually with equivalent attestations, use Docker Buildx:

```bash
docker login
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --sbom=true \
  --provenance=mode=max \
  --tag hkarhani/scrm:latest \
  --push .
```

The GitHub workflow validates the image build only. Docker Hub automated builds own the published `latest` image.
