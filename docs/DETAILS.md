# Segment Conflict Resolution Management Details

Author: Hassan Karhani.

## Purpose

Segment Conflict Resolution Management helps implementation and operations teams analyze network segment policy and segment exports, identify overlapping segment ranges, review live endpoint evidence when available, and produce controlled cleanup recommendations or Admin API range updates.

## Supported Modes

- Offline analysis: `Policies.xml` + `Segments.xml`
- Offline analysis with imported host evidence: `Policies.xml` + `Segments.xml` + offline host IP collection
- Live host evidence: `Policies.xml` + `Segments.xml` + Web API host IP collection
- Controlled live segment range updates: `Policies.xml` + `Segments.xml` + Web API + Admin API

## Safety Model

The app starts in read-only mode. Read-only actions generate downloadable instructions and recommendation documents only.

Live editing must be explicitly enabled in the UI before the app can send Admin API range updates. The app only updates segment range lists. It does not create, rename, move, or delete segments.

## Runtime Data

The app writes local runtime files under `./SCR`:

- `SCR/uploads`: uploaded XML artifacts and parsed summaries
- `SCR/snapshots`: collected host IPs, Admin API segment snapshots, and instruction state
- `SCR/Documents`: generated DOCX and CSV recommendation documents
- `SCR/config.json`: local project name, API metadata, and optional saved credentials

`SCR/` is ignored by Git and should not be committed.

## Network Exposure

The default Compose deployment binds the web UI to `127.0.0.1:8088`. This keeps the app reachable only from the machine running the container.

For Docker Hub or manual container runs, use the same loopback binding:

```bash
docker run --rm -p 127.0.0.1:8088:8080 -v "$PWD/SCR:/app/SCR" hkarhani/scrm:latest
```

## Credentials

API credentials are stored only in the local `SCR/config.json` file when entered through the UI. Passwords are locally obfuscated for convenience, not strongly encrypted.

Workspace bundle exports intentionally exclude passwords.

## Workflow

1. Upload `Policies.xml`.
2. Upload `Segments.xml`.
3. Optionally collect host IP evidence using Web API, or download and run the offline host collector script.
4. Optionally collect live segment structure using Admin API.
5. Review conflict stages:
   - Policy Usage Wins
   - Ownership Decisions
   - Admin or Policy Owner Decision
   - Lower Priority Review
   - Zero-Range Segment Report
6. In read-only mode, generate recommendation documents and instructions.
7. If live editing is enabled, apply selected range removals through Admin API.
8. Use the Documents page to download or delete generated outputs.

## Offline Host Collection

The app can generate a standalone host IP collector script from:

```text
/api/download/scrm-offline-host-ip-collector.py
```

Example without TLS verification:

```bash
python3 scrm_offline_host_ip_collector.py --url https://platform.example.local --username <user> --output hosts.json
```

Example with TLS verification:

```bash
python3 scrm_offline_host_ip_collector.py --url https://platform.example.local --username <user> --verify-tls --output hosts.json
```

The script prompts for the password securely at runtime.

## Workspace Bundles

The UI can save and restore a project workspace as a zip bundle. The bundle includes loaded artifacts, snapshots, generated documents, and sanitized API metadata.

Passwords are intentionally excluded from exported workspace bundles.

## Development Checks

```bash
python3 -m compileall app/server.py
node --check app/static/app.js
```

Rebuild after code changes:

```bash
docker compose up --build -d
```

## Repository Hygiene

The repository excludes runtime and sensitive files:

- `SCR/`
- `data/`
- `.env`
- `.env.*`
- logs
- Python caches
- generated build/cache folders

Before publishing a fork or release, verify:

```bash
find . -maxdepth 3 -type f | sort
```

and scan for environment-specific values:

```bash
rg -n "password|secret|token|api_key|Authorization|Bearer|10\\.0\\.|192\\.168\\." .
```
