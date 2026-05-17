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
3. Optionally collect host IPs from Web API or import offline host IP evidence.
4. Optionally collect live segments from Admin API.
5. Keep read-only mode for generated instructions, or explicitly enable live editing before Admin API range updates.

Detailed workflow and safety notes are in [docs/DETAILS.md](docs/DETAILS.md).

## Docker Image

When using a published image, keep the same localhost-only binding:

```bash
docker run --rm -p 127.0.0.1:8088:8080 -v "$PWD/SCR:/app/SCR" hkarhani/scrm:latest
```

The container runs as a non-root user.

## Docker Hub Publishing

The GitHub workflow publishes `hkarhani/scrm:latest` with SBOM and provenance attestations when these repository secrets exist:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Use a Docker Hub access token with write access. If either secret is missing, the workflow fails intentionally so Docker Hub is not left with an unattested `latest` image.

To publish manually with the same attestations, use Docker Buildx:

```bash
docker login
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --sbom=true \
  --provenance=mode=max \
  --tag hkarhani/scrm:latest \
  --push .
```

If Docker Hub automated builds are also enabled for the same repository, make sure they do not overwrite an attested `latest` image unless the automated build is configured to attach equivalent attestations.
