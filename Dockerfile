FROM python:3.12-alpine

ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION="0.1.0"

LABEL org.opencontainers.image.title="Segment Conflict Resolution Management" \
      org.opencontainers.image.description="Portable network segment conflict analysis and controlled range cleanup workflow." \
      org.opencontainers.image.source="https://github.com/hkarhani/SCRM" \
      org.opencontainers.image.authors="Hassan Karhani" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SCRM_DATA_DIR=/app/SCR

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --root-user-action=ignore --upgrade pip==26.1.1 \
    && pip install --no-cache-dir --root-user-action=ignore -r /app/requirements.txt

COPY app /app/app

RUN addgroup -S scrm \
    && adduser -S -D -H -u 10001 -G scrm scrm \
    && mkdir -p /app/SCR/uploads /app/SCR/snapshots /app/SCR/Documents \
    && chown -R scrm:scrm /app

VOLUME ["/app/SCR"]

EXPOSE 8080

USER scrm

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import json, urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3)); raise SystemExit(0 if data.get('ok') else 1)"

CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8080"]
