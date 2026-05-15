const API = "/api";

const stages = [
  { key: "used_wins", number: 1, title: "Policy Usage Wins", description: "Segments used by policies take priority. Remove the overlapping range from the not-used segment side." },
  { key: "ownership", number: 2, title: "Ownership Decisions", description: "NOT USED segments overlap each other. Pick which one owns the range, or keep the overlap as-is." },
  { key: "live_decision", number: 3, title: "Admin or Policy Owner Decision", description: "USED segments overlap and live endpoints exist. Default is no cleanup until admin chooses an owner." },
  { key: "lower_review", number: 4, title: "Lower Priority Review", description: "USED segments overlap but no live endpoint evidence exists. Optional owner selection can clean the duplicate range." },
  { key: "zero_ranges", number: 5, title: "Zero-Range Segment Report", description: "Live list of segments that currently have zero ranges after cleanup." },
];

const state = {
  status: null,
  analysis: null,
  documents: [],
  activePage: localStorage.getItem("activePage") || "workflow",
  activeStage: "used_wins",
  visualizationLens: localStorage.getItem("visualizationLens") || "ranges",
  selectedRange: localStorage.getItem("selectedRange") || "",
  selectedSegment: localStorage.getItem("selectedSegment") || "",
  selectedIp: localStorage.getItem("selectedIp") || "",
  visualizationFilters: {
    ranges: localStorage.getItem("vizFilter:ranges") || "",
    segments: localStorage.getItem("vizFilter:segments") || "",
    ips: localStorage.getItem("vizFilter:ips") || "",
  },
  decisions: {},
  recentApplied: [],
  loading: "",
  showArtifactDetails: false,
  hostIpSource: localStorage.getItem("hostIpSource") || "web",
  apiStatus: {},
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  document.getElementById("refreshBtn").addEventListener("click", refreshAll);
  await refreshAll();
}

async function refreshAll() {
  try {
    const [status, analysis, documents] = await Promise.all([apiGet("/state"), apiGet("/analysis"), apiGet("/documents")]);
    state.status = status;
    state.analysis = analysis;
    state.documents = documents.documents || [];
    render();
  } catch (error) {
    toast(error.message);
  }
}

function render() {
  renderTopbarKpis();
  const app = document.getElementById("app");
  app.innerHTML = `
    ${renderSetup()}
    ${renderSummary()}
    ${renderPageNav()}
    ${renderActivePage()}
  `;
  wireEvents(app);
}

function renderTopbarKpis() {
  const element = document.getElementById("topbarKpis");
  if (!element) return;
  const summary = state.analysis?.summary || {};
  element.innerHTML = `
    <span class="fact-chip">${formatNumber(summary.conflicts || 0)} conflicts detected</span>
    <span class="fact-chip">${formatNumber(summary.host_ips || 0)} live host IPs</span>
    <span class="fact-chip">${formatNumber(summary.zero_ranges || 0)} zero-range segments</span>
  `;
}

function renderSetup() {
  const artifacts = state.status?.artifacts || {};
  const web = state.status?.config?.web || {};
  const admin = state.status?.config?.admin || {};
  const protection = state.status?.protection || {};
  const project = state.status?.project || {};
  const artifactItems = [
    { key: "policies", label: "Policies XML", meta: artifacts.policies, required: true },
    { key: "segments", label: "Segments XML", meta: artifacts.segments, required: true },
    { key: "hosts", label: "Host IPs", meta: artifacts.hosts, required: false },
    { key: "admin_segments", label: "Segments", meta: artifacts.admin_segments, required: false },
  ];
  const readyCount = artifactItems.filter((item) => item.meta?.exists).length;
  const modeLabel = protection.live_edit_enabled ? "Live editing enabled" : "Read-only instructions";
  return `
    <section class="panel artifact-panel">
      <div class="artifact-bar">
        <div class="artifact-title-block">
          <span class="eyebrow">Artifacts and operating mode</span>
          <h2>Inputs</h2>
          <div class="muted">${readyCount} of ${artifactItems.length} artifacts loaded</div>
        </div>
        <div class="artifact-status-line">
          ${artifactItems.map((item) => artifactPill(item.label, item.meta, item.required)).join("")}
          <span class="mode-badge ${protection.live_edit_enabled ? "live" : "readonly"}">${escapeHtml(modeLabel)}</span>
        </div>
        <div class="project-control">
          <label for="projectNameInput">Project</label>
          <input id="projectNameInput" type="text" data-project-name value="${escapeAttr(project.name || "Segment Conflict Workspace")}" />
          <button class="button secondary small" type="button" data-save-project>Update</button>
        </div>
        <div class="artifact-actions">
          <button class="button secondary small" type="button" data-save-workspace>Save</button>
          <label class="button secondary small file-button">
            Upload
            <input type="file" data-import-workspace accept=".zip,application/zip" />
          </label>
          <button class="button secondary small" type="button" data-toggle-artifacts>
            ${state.showArtifactDetails ? "Hide details" : "Show details"}
          </button>
          <button class="button danger small" type="button" data-clear-data>Clear loaded data</button>
        </div>
      </div>
      ${
        state.showArtifactDetails
          ? `<div class="artifact-details">
              ${renderOperationsStrip(protection)}
              <div class="artifact-input-grid">
                ${renderXmlInputsColumn(artifacts)}
                <div class="api-input-stack">
                  ${state.hostIpSource === "offline" ? uploadCard("hosts", "Offline host IP collection", artifacts.hosts, ".json,.csv,.txt,text/plain,application/json,text/csv", false) : apiCard("web", "Web API host IPs", web)}
                  ${apiCard("admin", "Admin API segments", admin)}
                </div>
              </div>
            </div>`
          : ""
      }
    </section>
  `;
}

function artifactPill(label, meta = {}, required = false) {
  const ready = Boolean(meta?.exists);
  return `
    <span class="artifact-pill ${ready ? "ready" : required ? "required" : "optional"}">
      <span class="status-dot ${ready ? "good" : "warn"}"></span>
      <strong>${escapeHtml(label)}</strong>
      <span>${ready ? "loaded" : required ? "required" : "optional"}</span>
    </span>
  `;
}

function renderOperationsStrip(protection = {}) {
  const liveEdit = Boolean(protection.live_edit_enabled);
  return `
    <div class="operations-strip">
      <div class="operation-control ${liveEdit ? "live" : "readonly"}">
        <div>
          <span class="eyebrow">Protection</span>
          <strong>${liveEdit ? "Live changes allowed" : "Read-only mode"}</strong>
          <span>${liveEdit ? "Range removals can be sent to Admin API." : "Actions generate instructions only."}</span>
        </div>
        <div class="protection-toggle" role="group" aria-label="Protection mode">
          <button class="mode-button ${!liveEdit ? "active" : ""}" type="button" data-live-edit="false">READ ONLY</button>
          <button class="mode-button danger ${liveEdit ? "active" : ""}" type="button" data-live-edit="true">LIVE EDITING</button>
        </div>
      </div>
      <div class="operation-control">
        <div>
          <span class="eyebrow">Host IP evidence</span>
          <strong>${state.hostIpSource === "offline" ? "Offline import" : "Live Web API collection"}</strong>
          <span>Optional evidence source for live overlap detection.</span>
        </div>
        <div class="protection-toggle" role="group" aria-label="Host IP evidence source">
          <button class="mode-button ${state.hostIpSource === "web" ? "active" : ""}" type="button" data-host-source="web">WEB API</button>
          <button class="mode-button ${state.hostIpSource === "offline" ? "active" : ""}" type="button" data-host-source="offline">OFFLINE IMPORT</button>
        </div>
      </div>
    </div>
  `;
}

function renderXmlInputsColumn(artifacts = {}) {
  return `
    <div class="card xml-stack-card">
      <div class="card-title-row">
        <h3>XML inputs</h3>
        <span class="pill ${artifacts.policies?.exists && artifacts.segments?.exists ? "good" : "warn"}">${artifacts.policies?.exists && artifacts.segments?.exists ? "Ready" : "Required"}</span>
      </div>
      <div class="xml-stack">
        ${xmlUploadRow("policies", "Policies XML", artifacts.policies, true)}
        ${xmlUploadRow("segments", "Segments XML", artifacts.segments, true)}
      </div>
    </div>
  `;
}

function xmlUploadRow(kind, title, meta = {}, required = true) {
  const ready = Boolean(meta?.exists);
  return `
    <div class="xml-upload-row ${ready ? "good" : "warn"}">
      <div class="xml-upload-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${ready ? `${formatBytes(meta.size)} uploaded` : required ? "Required XML export" : "Optional"}</span>
      </div>
      <span class="pill ${ready ? "good" : required ? "warn" : ""}">${ready ? "Loaded" : required ? "Required" : "Optional"}</span>
      <input type="file" data-upload="${kind}" accept=".xml,text/xml" />
    </div>
  `;
}

function renderProtectionCard(protection = {}) {
  const liveEdit = Boolean(protection.live_edit_enabled);
  return `
    <div class="protection-card ${liveEdit ? "live" : "readonly"}">
      <div>
        <span class="eyebrow">Protection</span>
        <h3>${liveEdit ? "Live editing mode" : "Read-only mode"}</h3>
        <div class="muted">
          ${liveEdit ? "Range updates will be sent through Admin API." : "Actions generate manual instructions instead of changing the admin platform."}
        </div>
      </div>
      <div class="protection-toggle" role="group" aria-label="Protection mode">
        <button class="mode-button ${!liveEdit ? "active" : ""}" type="button" data-live-edit="false">READ ONLY</button>
        <button class="mode-button danger ${liveEdit ? "active" : ""}" type="button" data-live-edit="true">LIVE EDITING</button>
      </div>
    </div>
  `;
}

function renderHostSourceSelector() {
  return `
    <div class="source-card">
      <div>
        <span class="eyebrow">Host IP evidence source</span>
        <h3>${state.hostIpSource === "offline" ? "Offline host IP import" : "Live Web API collection"}</h3>
        <div class="muted">Host IP evidence is optional, but when used select one source: offline collector output or online Web API collection.</div>
      </div>
      <div class="protection-toggle" role="group" aria-label="Host IP evidence source">
        <button class="mode-button ${state.hostIpSource === "web" ? "active" : ""}" type="button" data-host-source="web">WEB API</button>
        <button class="mode-button ${state.hostIpSource === "offline" ? "active" : ""}" type="button" data-host-source="offline">OFFLINE IMPORT</button>
      </div>
    </div>
  `;
}

function renderInstructionPanel() {
  const instructions = state.status?.instructions || {};
  const steps = instructions.steps || [];
  if (!steps.length) return "";
  return `
    <div class="instructions-panel">
      <div>
        <span class="eyebrow">Read-only output</span>
        <strong>${formatNumber(steps.length)} manual range change instruction${steps.length === 1 ? "" : "s"} generated</strong>
      </div>
      <a class="button secondary small" href="/api/export/manual-instructions.csv">Download instructions CSV</a>
    </div>
  `;
}

function renderInstructionOutput() {
  const instructions = state.status?.instructions || {};
  const steps = instructions.steps || [];
  if (!steps.length) return "";
  return `
    <section class="panel instruction-output">
      <div class="panel-head instruction-output-head">
        <div>
          <span class="eyebrow">Generated read-only instructions</span>
          <h3>${formatNumber(steps.length)} manual range change instruction${steps.length === 1 ? "" : "s"} ready</h3>
          <div class="muted">${instructions.generated_at ? `Generated ${escapeHtml(formatDate(instructions.generated_at))}. ` : ""}Download this CSV and hand it to the platform admin for manual execution.</div>
        </div>
        <a class="button secondary" href="/api/export/manual-instructions.csv">Download instructions CSV</a>
      </div>
    </section>
  `;
}

function uploadCard(kind, title, meta = {}, accept = ".xml,text/xml", required = true) {
  const ready = Boolean(meta.exists);
  const status = ready ? "Loaded" : required ? "Required" : "Optional";
  return `
    <div class="card upload-card ${ready ? "good" : "warn"}">
      <div class="card-title-row">
        <h3>${escapeHtml(title)}</h3>
        <span class="pill ${ready ? "good" : required ? "warn" : ""}">${status}</span>
      </div>
      <div class="muted">${ready ? `${formatBytes(meta.size)} uploaded` : kind === "hosts" ? "Import collector output or a CSV/list of host IPs" : "Upload an XML export"}</div>
      <input type="file" data-upload="${kind}" accept="${escapeAttr(accept)}" />
      ${kind === "hosts" ? `<a class="button secondary small" href="/api/download/scrm-offline-host-ip-collector.py">Download collector script</a>` : ""}
    </div>
  `;
}

function apiCard(kind, title, cfg = {}) {
  const ready = Boolean(cfg.base_url && cfg.username && cfg.password_saved);
  const passwordText = cfg.password_saved ? "********" : "Password";
  const apiStatus = state.apiStatus[kind];
  return `
    <div class="card api-card ${ready ? "good" : "warn"}">
      <div class="card-title-row">
        <h3>${escapeHtml(title)}</h3>
        <span class="pill ${ready ? "good" : "warn"}">${ready ? "Configured" : "Optional until collect"}</span>
      </div>
      <div class="api-form-grid">
        <label>URL<input type="text" value="${escapeAttr(cfg.base_url || "")}" data-${kind}-url placeholder="https://platform.example.local" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
        <label>User<input type="text" value="${escapeAttr(cfg.username || "")}" data-${kind}-user autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
        <label>Password<input type="password" value="" data-${kind}-password placeholder="${escapeAttr(passwordText)}" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false" /></label>
        <label class="tls-inline">
          <span>Verify TLS</span>
          <input type="checkbox" data-${kind}-tls ${cfg.verify_tls ? "checked" : ""} />
        </label>
      </div>
      <div class="range-chip-list">
        <button class="button secondary small" data-test-config="${kind}" type="button">Test</button>
        ${
          kind === "web"
            ? `<button class="button small" data-collect-hosts type="button">Collect host IPs</button>`
            : `<button class="button small" data-collect-admin type="button">Collect segments</button>`
        }
      </div>
      <div class="api-inline-status ${apiStatus?.type || ""}" data-api-status="${kind}" ${apiStatus ? "" : "hidden"}>
        ${apiStatus ? escapeHtml(apiStatus.message) : ""}
      </div>
    </div>
  `;
}

function renderSummary() {
  const summary = state.analysis?.summary || {};
  return `
    <section class="metrics-grid">
      ${metric("Policies", summary.policies || 0, "parsed from policies XML")}
      ${metric("XML Segments", summary.xml_segments || 0, "imported segment records")}
      ${metric("Segments", summary.segments || summary.live_segments || 0, "Admin API when available, otherwise XML")}
      ${metric("Host IPs", summary.host_ips || 0, "active IP evidence")}
      ${metric("Conflicts", summary.conflicts || 0, "range decisions pending")}
      ${metric("Zero-Range", summary.zero_ranges || 0, "manual review output")}
    </section>
  `;
}

function metric(label, value, caption) {
  return `
    <div class="card metric-card">
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong class="metric-value">${formatNumber(value)}</strong>
      <span class="metric-caption">${escapeHtml(caption)}</span>
    </div>
  `;
}

function renderTabs() {
  return `
    <nav class="stage-tabs">
      ${stages
        .map((stage) => {
          const count = stage.key === "zero_ranges"
            ? state.analysis?.stages?.zero_ranges?.length || 0
            : state.analysis?.stages?.[stage.key]?.length || 0;
          return `
            <button class="stage-tab ${state.activeStage === stage.key ? "active" : ""}" data-stage="${stage.key}" type="button">
              <span class="stage-number">${stage.number}</span>
              <span class="stage-tab-copy">
                <strong>${escapeHtml(stage.title)}</strong>
                <small>${formatNumber(count)} item${count === 1 ? "" : "s"}</small>
              </span>
            </button>
          `;
        })
        .join("")}
    </nav>
  `;
}

function renderPageNav() {
  const rangeCount = rangeGroups().length;
  const documentCount = state.documents?.length || 0;
  const pages = [
    ["workflow", "Workflow", stages.reduce((sum, stage) => sum + (state.analysis?.stages?.[stage.key]?.length || 0), 0)],
    ["ranges", "Conflict Investigation", rangeCount],
    ["documents", "Documents", documentCount],
  ];
  return `
    <nav class="page-tabs">
      ${pages
        .map(
          ([key, label, count]) => `
            <button class="page-tab ${state.activePage === key ? "active" : ""}" type="button" data-page="${key}">
              <strong>${escapeHtml(label)}</strong>
              <span>${formatNumber(count)}</span>
            </button>
          `
        )
        .join("")}
    </nav>
  `;
}

function renderActivePage() {
  if (state.activePage === "ranges") return renderRangeInvestigationPage();
  if (state.activePage === "documents") return renderDocumentsPage();
  return `
    ${renderTabs()}
    ${renderStage()}
  `;
}

function renderRangeInvestigationPage() {
  const groups = rangeGroups();
  const segments = segmentGroups(groups);
  const ips = ipGroups(groups);
  if (!groups.length) {
    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Conflict Visualization</h2>
            <div class="muted">Focused range, segment, and live IP views appear here when overlapping ranges are detected.</div>
          </div>
        </div>
        <div class="panel-body"><div class="empty">No conflicting ranges are currently detected.</div></div>
      </section>
    `;
  }
  const lens = ["ranges", "segments", "ips"].includes(state.visualizationLens) ? state.visualizationLens : "ranges";
  const lensTabs = [
    ["ranges", "Ranges", groups.length],
    ["segments", "Segments", segments.length],
    ["ips", "Live IPs", ips.length],
  ];
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Conflict Visualization</h2>
          <div class="muted">Investigate overlap decisions by range, by segment, or by live endpoint IP. Category labels map to workflow stages 1-4 only.</div>
        </div>
      </div>
      <div class="visualization-toolbar">
        ${lensTabs
          .map(
            ([key, label, count]) => `
              <button class="viz-tab ${lens === key ? "active" : ""}" type="button" data-viz-lens="${key}">
                <strong>${escapeHtml(label)}</strong>
                <span>${formatNumber(count)}</span>
              </button>
            `
          )
          .join("")}
      </div>
      ${lens === "segments" ? renderSegmentLens(segments) : lens === "ips" ? renderIpLens(ips) : renderRangeLens(groups)}
    </section>
  `;
}

function renderRangeLens(groups) {
  const filteredGroups = filterRangeGroups(groups);
  const selectedRange = filteredGroups.some((group) => group.range === state.selectedRange) ? state.selectedRange : filteredGroups[0]?.range;
  const selected = filteredGroups.find((group) => group.range === selectedRange) || filteredGroups[0];
  if (!selected) return renderLensNoMatches("ranges", groups.length);
  const actions = rangeActions(selected);
  const liveEdit = Boolean(state.status?.protection?.live_edit_enabled);
  return `
      <div class="panel-head sub-panel-head">
        <div>
          <h2>Range Investigation</h2>
          <div class="muted">Select one conflicting range to see every segment attached to it, policy usage, live host evidence, and the current cleanup plan.</div>
        </div>
        <div class="sub-panel-actions">
          <button class="button secondary" type="button" data-download-range-png="${escapeAttr(selected.range)}">Download PNG</button>
          <button class="button ${liveEdit ? "" : "secondary"}" type="button" data-apply-range="${escapeAttr(selected.range)}" ${actions.length ? "" : "disabled"}>
            ${state.loading === `range:${selected.range}` ? (liveEdit ? "Applying..." : "Generating...") : `${liveEdit ? "Apply range changes" : "Generate range instructions"} (${formatNumber(actions.length)})`}
          </button>
        </div>
      </div>
      <div class="range-investigation-grid">
        <aside class="range-list">
          ${renderVisualizationFilter("ranges", "Filter ranges", "Search by range, stage, or segment", rangeFilterOptions(groups), filteredGroups.length, groups.length)}
          <div class="range-list-head">
            <strong>Conflicting ranges</strong>
            <span class="pill">${formatNumber(filteredGroups.length)} of ${formatNumber(groups.length)}</span>
          </div>
          ${filteredGroups.map((group) => rangeChoiceButton(group, group.range === selected.range)).join("")}
        </aside>
        <div class="range-detail">
          ${renderRangeVisualization(selected, actions, liveEdit)}
          ${renderRangeRows(selected)}
        </div>
      </div>
  `;
}

function renderSegmentLens(segments) {
  if (!segments.length) return `<div class="panel-body"><div class="empty">No conflicting segments are currently detected.</div></div>`;
  const filteredSegments = filterSegmentGroups(segments);
  const selectedKey = filteredSegments.some((segment) => segment.key === state.selectedSegment) ? state.selectedSegment : filteredSegments[0]?.key;
  const selected = filteredSegments.find((segment) => segment.key === selectedKey) || filteredSegments[0];
  if (!selected) return renderLensNoMatches("segments", segments.length);
  const actions = segmentActions(selected);
  const liveEdit = Boolean(state.status?.protection?.live_edit_enabled);
  return `
    <div class="panel-head sub-panel-head">
      <div>
        <h2>Segment Investigation</h2>
        <div class="muted">Select a segment to see its parent hierarchy, policy references, live endpoints, conflicting ranges, and the other segment owners involved.</div>
      </div>
      <button class="button ${liveEdit ? "" : "secondary"}" type="button" data-apply-segment="${escapeAttr(selected.key)}" ${actions.length ? "" : "disabled"}>
        ${state.loading === `segment:${selected.key}` ? (liveEdit ? "Applying..." : "Generating...") : `${liveEdit ? "Apply segment changes" : "Generate segment instructions"} (${formatNumber(actions.length)})`}
      </button>
    </div>
    <div class="range-investigation-grid segment-lens-grid">
      <aside class="range-list">
        ${renderVisualizationFilter("segments", "Filter segments", "Search by segment, parent, range, policy, or IP", segmentFilterOptions(segments), filteredSegments.length, segments.length)}
        <div class="range-list-head">
          <strong>Conflicting segments</strong>
          <span class="pill">${formatNumber(filteredSegments.length)} of ${formatNumber(segments.length)}</span>
        </div>
        ${filteredSegments.map((segment) => segmentChoiceButton(segment, segment.key === selected.key)).join("")}
      </aside>
      <div class="range-detail">
        ${renderSegmentVisualization(selected, actions, liveEdit)}
      </div>
    </div>
  `;
}

function renderIpLens(ips) {
  if (!ips.length) return `<div class="panel-body"><div class="empty">No live IPs are present inside conflicting ranges. Add Web API or offline host IP evidence to populate this lens.</div></div>`;
  const filteredIps = filterIpGroups(ips);
  const selectedIp = filteredIps.some((ip) => ip.ip === state.selectedIp) ? state.selectedIp : filteredIps[0]?.ip;
  const selected = filteredIps.find((ip) => ip.ip === selectedIp) || filteredIps[0];
  if (!selected) return renderLensNoMatches("ips", ips.length);
  const actions = ipActions(selected);
  const liveEdit = Boolean(state.status?.protection?.live_edit_enabled);
  return `
    <div class="panel-head sub-panel-head">
      <div>
        <h2>Live IP Investigation</h2>
        <div class="muted">Select a live endpoint IP to see every conflicting range and segment that currently matches that address.</div>
      </div>
      <button class="button ${liveEdit ? "" : "secondary"}" type="button" data-apply-ip="${escapeAttr(selected.ip)}" ${actions.length ? "" : "disabled"}>
        ${state.loading === `ip:${selected.ip}` ? (liveEdit ? "Applying..." : "Generating...") : `${liveEdit ? "Apply IP changes" : "Generate IP instructions"} (${formatNumber(actions.length)})`}
      </button>
    </div>
    <div class="range-investigation-grid ip-lens-grid">
      <aside class="range-list">
        ${renderVisualizationFilter("ips", "Filter live IPs", "Search by IP, range, or segment", ipFilterOptions(ips), filteredIps.length, ips.length)}
        <div class="range-list-head">
          <strong>Live IPs in conflicts</strong>
          <span class="pill">${formatNumber(filteredIps.length)} of ${formatNumber(ips.length)}</span>
        </div>
        ${filteredIps.map((item) => ipChoiceButton(item, item.ip === selected.ip)).join("")}
      </aside>
      <div class="range-detail">
        ${renderIpVisualization(selected, actions, liveEdit)}
      </div>
    </div>
  `;
}

function renderVisualizationFilter(lens, label, placeholder, options, shownCount, totalCount) {
  const value = state.visualizationFilters?.[lens] || "";
  const listId = `viz-filter-${lens}-options`;
  return `
    <div class="viz-filter-card">
      <label>
        <span>${escapeHtml(label)}</span>
        <input type="search" value="${escapeAttr(value)}" data-viz-filter="${escapeAttr(lens)}" list="${escapeAttr(listId)}" placeholder="${escapeAttr(placeholder)}" autocomplete="off" />
      </label>
      <datalist id="${escapeAttr(listId)}">
        ${options.slice(0, 250).map((option) => `<option value="${escapeAttr(option)}"></option>`).join("")}
      </datalist>
      <div class="viz-filter-meta">
        <span>${formatNumber(shownCount)} of ${formatNumber(totalCount)} shown</span>
        ${value ? `<button class="link-button" type="button" data-clear-viz-filter="${escapeAttr(lens)}">Clear</button>` : ""}
      </div>
    </div>
  `;
}

function renderLensNoMatches(lens, totalCount) {
  const labels = { ranges: "ranges", segments: "segments", ips: "live IPs" };
  const options =
    lens === "segments"
      ? segmentFilterOptions(segmentGroups())
      : lens === "ips"
        ? ipFilterOptions(ipGroups())
        : rangeFilterOptions(rangeGroups());
  return `
    <div class="range-investigation-grid">
      <aside class="range-list">
        ${renderVisualizationFilter(lens, `Filter ${labels[lens] || "items"}`, "Type to search current conflict data", options, 0, totalCount)}
      </aside>
      <div class="range-detail">
        <div class="empty">No ${escapeHtml(labels[lens] || "items")} match this filter.</div>
      </div>
    </div>
  `;
}

function filterRangeGroups(groups) {
  const query = normalizedSearch(state.visualizationFilters.ranges);
  if (!query) return groups;
  return groups.filter((group) => normalizedSearch(rangeSearchText(group)).includes(query));
}

function filterSegmentGroups(segments) {
  const query = normalizedSearch(state.visualizationFilters.segments);
  if (!query) return segments;
  return segments.filter((segment) => normalizedSearch(segmentSearchText(segment)).includes(query));
}

function filterIpGroups(ips) {
  const query = normalizedSearch(state.visualizationFilters.ips);
  if (!query) return ips;
  return ips.filter((item) => normalizedSearch(ipSearchText(item)).includes(query));
}

function rangeSearchText(group = {}) {
  return [
    group.range,
    ...(group.stageLabels || []),
    ...(group.segments || []).flatMap((segment) => [segment.name, segment.path, ...(segment.allRanges || []), ...(segment.ranges || [])]),
  ]
    .filter(Boolean)
    .join(" ");
}

function segmentSearchText(segment = {}) {
  return [
    segment.name,
    segment.path,
    ...(segment.allRanges || []),
    ...(segment.conflictRanges || []),
    ...(segment.liveIps || []),
    ...(segment.policyReferences || []).flatMap((ref) => [ref.policy, ref.source]),
    ...(segment.otherSegments || []).flatMap((other) => [other.name, other.path, ...(other.conflictRanges || [])]),
  ]
    .filter(Boolean)
    .join(" ");
}

function ipSearchText(item = {}) {
  return [
    item.ip,
    ...(item.ranges || []),
    ...(item.segments || []).flatMap((segment) => [segment.name, segment.path, ...(segment.ranges || [])]),
    ...(item.rows || []).flatMap((row) => [row.overlap_range, row.left?.name, row.left?.path, row.right?.name, row.right?.path]),
  ]
    .filter(Boolean)
    .join(" ");
}

function rangeFilterOptions(groups) {
  return uniqueSorted(groups.map((group) => group.range));
}

function segmentFilterOptions(segments) {
  return uniqueSorted(segments.flatMap((segment) => [segment.name, segment.path].filter(Boolean)));
}

function ipFilterOptions(ips) {
  return uniqueSorted(ips.map((item) => item.ip));
}

function rangeChoiceButton(group, active) {
  return `
    <button class="range-choice ${active ? "active" : ""}" type="button" data-range-select="${escapeAttr(group.range)}">
      <strong>${escapeHtml(group.range)}</strong>
      <span>${formatNumber(group.segments.length)} segments, ${formatNumber(group.rows.length)} conflicts</span>
      <span class="${group.liveHostCount ? "danger-text" : "muted"}">${formatNumber(group.liveHostCount)} live hosts</span>
      <span class="category-strip">${categoryPills(group).join("")}</span>
    </button>
  `;
}

function segmentChoiceButton(segment, active) {
  return `
    <button class="range-choice ${active ? "active" : ""}" type="button" data-segment-select="${escapeAttr(segment.key)}">
      <strong>${escapeHtml(segment.name || "Unnamed segment")}</strong>
      <span>${escapeHtml(segmentParent(segment.path) || "No parent")}</span>
      <span>${formatNumber(segment.conflictRanges.length)} ranges, ${formatNumber(segment.liveIps.length)} live IPs</span>
      <span class="category-strip">${categoryPills(segment).join("")}</span>
    </button>
  `;
}

function ipChoiceButton(item, active) {
  return `
    <button class="range-choice ${active ? "active" : ""}" type="button" data-ip-select="${escapeAttr(item.ip)}">
      <strong>${escapeHtml(item.ip)}</strong>
      <span>${formatNumber(item.ranges.length)} conflicting range${item.ranges.length === 1 ? "" : "s"}</span>
      <span>${formatNumber(item.segments.length)} segment${item.segments.length === 1 ? "" : "s"}</span>
      <span class="category-strip">${categoryPills(item).join("")}</span>
    </button>
  `;
}

function rangeLink(range, label = range, className = "range-chip") {
  if (!range) return `<span class="${escapeAttr(className)}">No range</span>`;
  return `
    <button class="${escapeAttr(className)} clickable-range" type="button" data-open-range="${escapeAttr(range)}" title="Open range visualization">
      <strong>${escapeHtml(label)}</strong>
    </button>
  `;
}

function renderRangeVisualization(group, actions, liveEdit) {
  return `
    ${renderRangeDiagramSvg(group)}
    <div class="range-visual">
      <div class="range-node ${group.liveHostCount ? "live" : ""}">
        <span class="eyebrow">Selected range</span>
        <strong>${escapeHtml(group.range)}</strong>
        <div class="range-chip-list">
          <span class="pill">${formatNumber(group.ipCount)} IPs</span>
          <span class="pill ${group.liveHostCount ? "danger" : "good"}">${formatNumber(group.liveHostCount)} live hosts</span>
          <span class="pill">${group.stageLabels.map(escapeHtml).join(", ")}</span>
        </div>
        <div class="muted">${liveEdit ? "Live editing is enabled. Applying updates will change ranges through Admin API." : "Read-only mode is enabled. Applying updates generates downloadable admin instructions."}</div>
      </div>
      <div class="segment-visual-grid">
        ${group.segments.map((segment) => rangeSegmentCard(segment, group.liveHostCount)).join("")}
      </div>
    </div>
    <div class="stage-summary">
      <strong>${formatNumber(actions.length)} range action${actions.length === 1 ? "" : "s"} ready for this selected range.</strong>
      <span>Green segments are used by policy directly or by a policy-used parent. Red segments are not policy-used. Live-host evidence is highlighted at the selected range level.</span>
    </div>
  `;
}

function renderRangeDiagramSvg(group) {
  const segments = group.segments || [];
  const rowHeight = 96;
  const width = 1400;
  const height = Math.max(360, 150 + segments.length * rowHeight);
  const rangeX = 56;
  const rangeY = Math.round(height / 2 - 52);
  const rangeW = 350;
  const rangeH = 104;
  const segmentX = 760;
  const segmentW = 560;
  const segmentH = 72;
  const segmentStartY = Math.max(118, Math.round((height - segments.length * rowHeight) / 2));
  const rangeCenterX = rangeX + rangeW;
  const rangeCenterY = rangeY + rangeH / 2;
  const rows = segments
    .map((segment, index) => {
      const y = segmentStartY + index * rowHeight;
      const centerY = y + segmentH / 2;
      const color = segment.used ? "#15803d" : "#b42318";
      const fill = segment.used ? "#f0fdf4" : "#fff1f2";
      const liveFill = group.liveHostCount ? "#fee2e2" : "#ecfdf3";
      const categories = categoryPillsText(segment);
      return `
        <path d="M ${rangeCenterX} ${rangeCenterY} C ${rangeCenterX + 150} ${rangeCenterY}, ${segmentX - 150} ${centerY}, ${segmentX} ${centerY}" fill="none" stroke="${color}" stroke-width="${group.liveHostCount ? 4 : 3}" stroke-linecap="round" opacity="0.72" />
        <g class="diagram-node-clickable" data-open-segment="${escapeAttr(segment.key)}">
          <rect x="${segmentX}" y="${y}" width="${segmentW}" height="${segmentH}" rx="14" fill="${fill}" stroke="${color}" stroke-width="2" />
          <rect x="${segmentX}" y="${y}" width="9" height="${segmentH}" rx="4" fill="${color}" />
          ${svgFitText(segment.name || "Unnamed segment", segmentX + 24, y + 26, segmentW - 170, { fontSize: 20, minFontSize: 13, weight: 800, fill: "#111827" })}
          ${svgFitText(segmentParent(segment.path) || segment.path || "No parent", segmentX + 24, y + 49, segmentW - 190, { fontSize: 15, minFontSize: 11, weight: 700, fill: "#64748b" })}
          ${svgFitText(segment.used ? "USED" : "NOT USED", segmentX + segmentW - 24, y + 28, 118, { fontSize: 13, minFontSize: 10, weight: 800, fill: color, anchor: "end" })}
          ${svgFitText(categories, segmentX + segmentW - 24, y + 51, 150, { fontSize: 13, minFontSize: 10, weight: 800, fill: "#64748b", anchor: "end" })}
        </g>
        ${group.liveHostCount ? `<circle cx="${segmentX - 16}" cy="${centerY}" r="7" fill="${liveFill}" stroke="#b42318" stroke-width="2" />` : ""}
      `;
    })
    .join("");
  return `
    <div class="range-diagram-card">
      <div class="diagram-head">
        <div>
          <span class="eyebrow">Range diagram</span>
          <strong>${escapeHtml(group.range)}</strong>
        </div>
        <span class="muted">${formatNumber(segments.length)} segments, ${formatNumber(group.liveHostCount || 0)} live hosts</span>
      </div>
      <div class="range-diagram-scroll">
        <svg class="range-diagram-svg" data-range-diagram="${escapeAttr(group.range)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Range relationship diagram">
          <rect width="${width}" height="${height}" fill="#ffffff" />
          <text x="56" y="42" font-size="18" font-weight="800" fill="#64748b">CONFLICTING RANGE</text>
          <text x="${segmentX}" y="42" font-size="18" font-weight="800" fill="#64748b">ATTACHED SEGMENTS</text>
          <g class="diagram-node-clickable" data-open-range="${escapeAttr(group.range)}">
            <rect x="${rangeX}" y="${rangeY}" width="${rangeW}" height="${rangeH}" rx="16" fill="${group.liveHostCount ? "#fff1f2" : "#eff6ff"}" stroke="${group.liveHostCount ? "#b42318" : "#2563eb"}" stroke-width="3" />
            ${svgFitText(group.range, rangeX + 24, rangeY + 36, rangeW - 48, { fontSize: 26, minFontSize: 14, weight: 900, fill: "#111827" })}
            ${svgFitText(`${formatNumber(group.ipCount || 0)} IPs in range`, rangeX + 24, rangeY + 65, rangeW - 48, { fontSize: 17, minFontSize: 11, weight: 800, fill: "#64748b" })}
            ${svgFitText(`${formatNumber(group.liveHostCount || 0)} live hosts`, rangeX + 24, rangeY + 89, rangeW - 48, { fontSize: 17, minFontSize: 11, weight: 800, fill: group.liveHostCount ? "#b42318" : "#15803d" })}
          </g>
          ${rows}
        </svg>
      </div>
    </div>
  `;
}

function renderSegmentVisualization(segment, actions, liveEdit) {
  const refs = segment.policyReferences || [];
  const endpoints = segment.liveIps || [];
  const pathParts = pathSegments(segment.path);
  return `
    ${renderSegmentDiagramSvg(segment)}
    <div class="investigation-hero ${segment.used ? "used" : "unused"}">
      <div>
        <span class="eyebrow">Selected segment</span>
        <strong>${escapeHtml(segment.name || "Unnamed segment")}</strong>
        <div class="muted">${escapeHtml(segment.path || "No hierarchy")}</div>
      </div>
      <div class="range-chip-list">
        <span class="pill ${segment.used ? "good" : "danger"}">${segment.used ? "Used in policy" : "Not used in policy"}</span>
        <span class="pill">${formatNumber(segment.policyReferenceCount || 0)} policy refs</span>
        <span class="pill">${formatNumber(segment.conflictRanges.length)} conflict ranges</span>
        <span class="pill ${endpoints.length ? "danger" : "good"}">${formatNumber(endpoints.length)} live endpoints</span>
        ${categoryPills(segment).join("")}
      </div>
      <div class="muted">${liveEdit ? "Live editing is enabled. Segment-level actions update ranges through Admin API." : "Read-only mode is enabled. Segment-level actions generate downloadable admin instructions."}</div>
    </div>
    <div class="segment-insight-grid">
      <div class="card insight-card">
        <h3>Parents</h3>
        <div class="hierarchy-chain">
          ${pathParts.length ? pathParts.map((part, index) => `<span class="${index === pathParts.length - 1 ? "current" : ""}">${escapeHtml(part)}</span>`).join("") : `<span>No hierarchy</span>`}
        </div>
      </div>
      <div class="card insight-card">
        <h3>Policy assignments</h3>
        ${
          refs.length
            ? `<div class="policy-ref-list">${refs.slice(0, 10).map((ref) => `<span>${escapeHtml(ref.policy || "Unnamed policy")} <em>${escapeHtml(ref.source || "")}</em></span>`).join("")}${refs.length > 10 ? `<span class="muted">+${formatNumber(refs.length - 10)} more references</span>` : ""}</div>`
            : `<div class="muted">${segment.usedReason ? escapeHtml(segment.usedReason) : "No direct policy references recorded for this segment."}</div>`
        }
      </div>
      <div class="card insight-card">
        <h3>Live endpoints</h3>
        ${
          endpoints.length
            ? `<div class="range-chip-list">${endpoints.slice(0, 24).map((ip) => `<button class="ip-chip" type="button" data-ip-select="${escapeAttr(ip)}">${escapeHtml(ip)}</button>`).join("")}${endpoints.length > 24 ? `<span class="pill">+${formatNumber(endpoints.length - 24)} more</span>` : ""}</div>`
            : `<div class="muted">No live endpoint evidence is attached to this segment's conflicting ranges.</div>`
        }
      </div>
      <div class="card insight-card">
        <h3>Segment ranges</h3>
        <div class="range-chip-list">
          ${(segment.allRanges?.length ? segment.allRanges : segment.ranges).map((range) => rangeLink(range, range, `pill ${segment.ranges.includes(range) ? "danger" : ""}`)).join("") || `<span class="muted">No ranges recorded.</span>`}
        </div>
      </div>
    </div>
    <div class="range-row-list">
      <h3>Conflicting ranges and related segments</h3>
      ${segment.rows.map((row) => renderSegmentConflictRow(segment, row)).join("")}
    </div>
  `;
}

function renderSegmentDiagramSvg(segment) {
  const rows = segmentDiagramRows(segment);
  const rowHeight = 112;
  const width = 1560;
  const height = Math.max(420, 160 + rows.reduce((sum, row) => sum + Math.max(1, row.others.length) * rowHeight, 0));
  const segmentX = 56;
  const segmentW = 360;
  const segmentH = 124;
  const segmentY = Math.round(height / 2 - segmentH / 2);
  const rangeX = 560;
  const rangeW = 330;
  const rangeH = 74;
  const otherX = 1060;
  const otherW = 430;
  const otherH = 70;
  const selectedColor = segment.used ? "#15803d" : "#b42318";
  const selectedFill = segment.used ? "#f0fdf4" : "#fff1f2";
  let cursorY = 112;
  const diagramRows = rows
    .map((row) => {
      const laneCount = Math.max(1, row.others.length);
      const rowBlockHeight = laneCount * rowHeight;
      const rangeY = cursorY + Math.round(rowBlockHeight / 2 - rangeH / 2);
      const rangeCenterY = rangeY + rangeH / 2;
      const liveColor = row.liveHostCount ? "#b42318" : "#2563eb";
      const otherRows = (row.others.length ? row.others : [{ name: "No paired segment", path: "", used: false, policyReferenceCount: 0, categories: [] }])
        .map((other, index) => {
          const y = cursorY + index * rowHeight + Math.round((rowHeight - otherH) / 2);
          const centerY = y + otherH / 2;
          const otherColor = other.used ? "#15803d" : "#b42318";
          const otherFill = other.used ? "#f0fdf4" : "#fff1f2";
          return `
            <path d="M ${rangeX + rangeW} ${rangeCenterY} C ${rangeX + rangeW + 120} ${rangeCenterY}, ${otherX - 120} ${centerY}, ${otherX} ${centerY}" fill="none" stroke="${otherColor}" stroke-width="3" stroke-linecap="round" opacity="0.7" />
            <g class="diagram-node-clickable" data-open-segment="${escapeAttr(other.key || "")}">
              <rect x="${otherX}" y="${y}" width="${otherW}" height="${otherH}" rx="14" fill="${otherFill}" stroke="${otherColor}" stroke-width="2" />
              <rect x="${otherX}" y="${y}" width="9" height="${otherH}" rx="4" fill="${otherColor}" />
              ${svgFitText(other.name || "Unnamed segment", otherX + 24, y + 25, otherW - 160, { fontSize: 18, minFontSize: 11, weight: 850, fill: "#111827" })}
              ${svgFitText(segmentParent(other.path) || other.path || "No parent", otherX + 24, y + 47, otherW - 170, { fontSize: 13, minFontSize: 10, weight: 750, fill: "#64748b" })}
              ${svgFitText(other.used ? "USED" : "NOT USED", otherX + otherW - 22, y + 26, 110, { fontSize: 12, minFontSize: 9, weight: 850, fill: otherColor, anchor: "end" })}
              ${svgFitText(`${formatNumber(other.policyReferenceCount || 0)} refs`, otherX + otherW - 22, y + 48, 110, { fontSize: 12, minFontSize: 9, weight: 800, fill: "#64748b", anchor: "end" })}
            </g>
          `;
        })
        .join("");
      const rowSvg = `
        <path d="M ${segmentX + segmentW} ${segmentY + segmentH / 2} C ${segmentX + segmentW + 120} ${segmentY + segmentH / 2}, ${rangeX - 120} ${rangeCenterY}, ${rangeX} ${rangeCenterY}" fill="none" stroke="${liveColor}" stroke-width="${row.liveHostCount ? 4 : 3}" stroke-linecap="round" opacity="0.68" />
        <g class="diagram-node-clickable" data-open-range="${escapeAttr(row.range)}">
          <rect x="${rangeX}" y="${rangeY}" width="${rangeW}" height="${rangeH}" rx="14" fill="${row.liveHostCount ? "#fff1f2" : "#eff6ff"}" stroke="${liveColor}" stroke-width="2" />
          ${svgFitText(row.range, rangeX + 18, rangeY + 28, rangeW - 36, { fontSize: 18, minFontSize: 11, weight: 900, fill: "#111827" })}
          ${svgFitText(`${formatNumber(row.ipCount || 0)} IPs, ${formatNumber(row.liveHostCount || 0)} live hosts`, rangeX + 18, rangeY + 51, rangeW - 140, { fontSize: 13, minFontSize: 9, weight: 800, fill: "#64748b" })}
          ${svgFitText(categoryPillsText(row), rangeX + rangeW - 18, rangeY + 50, 120, { fontSize: 12, minFontSize: 9, weight: 850, fill: "#64748b", anchor: "end" })}
        </g>
        ${otherRows}
      `;
      cursorY += rowBlockHeight;
      return rowSvg;
    })
    .join("");
  return `
    <div class="range-diagram-card">
      <div class="diagram-head">
        <div>
          <span class="eyebrow">Segment diagram</span>
          <strong>${escapeHtml(segment.name || "Unnamed segment")}</strong>
        </div>
        <span class="muted">${formatNumber(rows.length)} conflict ranges, ${formatNumber(segment.otherSegments?.length || 0)} related segments</span>
      </div>
      <div class="range-diagram-scroll">
        <svg class="range-diagram-svg segment-diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Segment relationship diagram">
          <rect width="${width}" height="${height}" fill="#ffffff" />
          <text x="${segmentX}" y="42" font-size="18" font-weight="800" fill="#64748b">SELECTED SEGMENT</text>
          <text x="${rangeX}" y="42" font-size="18" font-weight="800" fill="#64748b">CONFLICTING RANGES</text>
          <text x="${otherX}" y="42" font-size="18" font-weight="800" fill="#64748b">OTHER SEGMENTS</text>
          <g class="diagram-node-clickable" data-open-segment="${escapeAttr(segment.key)}">
            <rect x="${segmentX}" y="${segmentY}" width="${segmentW}" height="${segmentH}" rx="18" fill="${selectedFill}" stroke="${selectedColor}" stroke-width="3" />
            <rect x="${segmentX}" y="${segmentY}" width="11" height="${segmentH}" rx="5" fill="${selectedColor}" />
            ${svgFitText(segment.name || "Unnamed segment", segmentX + 26, segmentY + 38, segmentW - 52, { fontSize: 24, minFontSize: 13, weight: 900, fill: "#111827" })}
            ${svgFitText(segmentParent(segment.path) || segment.path || "No parent", segmentX + 26, segmentY + 68, segmentW - 52, { fontSize: 15, minFontSize: 10, weight: 800, fill: "#64748b" })}
            ${svgFitText(segment.used ? "USED in policy" : "NOT USED in policy", segmentX + 26, segmentY + 95, segmentW - 170, { fontSize: 15, minFontSize: 10, weight: 850, fill: selectedColor })}
            ${svgFitText(`${formatNumber(segment.liveIps?.length || 0)} live IPs`, segmentX + segmentW - 24, segmentY + 95, 130, { fontSize: 15, minFontSize: 10, weight: 850, fill: "#64748b", anchor: "end" })}
          </g>
          ${diagramRows}
        </svg>
      </div>
    </div>
  `;
}

function segmentDiagramRows(segment) {
  const rows = new Map();
  (segment.rows || []).forEach((row) => {
    const range = row.overlap_range || "Unknown range";
    if (!rows.has(range)) {
      rows.set(range, {
        range,
        ipCount: Number(row.ip_count || 0),
        liveHostCount: Number(row.live_host_count || 0),
        categories: new Map(),
        others: new Map(),
      });
    }
    const item = rows.get(range);
    item.ipCount = Math.max(item.ipCount, Number(row.ip_count || 0));
    item.liveHostCount = Math.max(item.liveHostCount, Number(row.live_host_count || 0));
    addCategory(item.categories, row.stageKey);
    const other = sameSegment(row.left, segment) ? row.right : row.left;
    const key = other?.key || `${other?.path || ""}::${other?.name || ""}::${other?.range || ""}`;
    if (!item.others.has(key)) {
      item.others.set(key, {
        key,
        name: other?.name || "Unnamed segment",
        path: other?.path || "",
        used: Boolean(other?.used),
        policyReferenceCount: Number(other?.policy_reference_count || 0),
        categories: new Map(),
      });
    }
    const stored = item.others.get(key);
    stored.used = stored.used || Boolean(other?.used);
    stored.policyReferenceCount = Math.max(stored.policyReferenceCount, Number(other?.policy_reference_count || 0));
    addCategory(stored.categories, row.stageKey);
  });
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      categories: sortedCategories(row.categories),
      others: Array.from(row.others.values())
        .map((other) => ({ ...other, categories: sortedCategories(other.categories) }))
        .sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.liveHostCount - a.liveHostCount || a.range.localeCompare(b.range));
}

function renderSegmentConflictRow(segment, row) {
  const own = sameSegment(row.left, segment) ? row.left : row.right;
  const other = sameSegment(row.left, segment) ? row.right : row.left;
  return `
    <article class="range-row-card conflict-visual-row">
      <div class="range-row-stage">
        <span class="stage-category-pill">${stageCategoryLabel(row.stageKey)}</span>
        ${rangeLink(row.overlap_range, row.overlap_range, "range-chip")}
        <span class="pill ${row.live_host_count ? "danger" : "good"}">${formatNumber(row.live_host_count || 0)} live hosts</span>
        <span class="pill">${formatNumber(row.ip_count || 0)} IPs</span>
      </div>
      <div class="visual-conflict-pair">
        ${segmentMiniCard("This segment", own)}
        ${segmentMiniCard("Conflicts with", other)}
      </div>
      ${row.live_ips?.length ? `<div class="range-chip-list">${row.live_ips.slice(0, 18).map((ip) => `<button class="ip-chip" type="button" data-ip-select="${escapeAttr(ip)}">${escapeHtml(ip)}</button>`).join("")}${row.live_ips.length > 18 ? `<span class="pill">+${formatNumber(row.live_ips.length - 18)} more IPs</span>` : ""}</div>` : ""}
    </article>
  `;
}

function renderIpVisualization(item, actions, liveEdit) {
  return `
    ${renderIpDiagramSvg(item)}
    <div class="investigation-hero live">
      <div>
        <span class="eyebrow">Selected live IP</span>
        <strong>${escapeHtml(item.ip)}</strong>
        <div class="muted">This endpoint IP sits inside ${formatNumber(item.ranges.length)} conflicting range${item.ranges.length === 1 ? "" : "s"}.</div>
      </div>
      <div class="range-chip-list">
        <span class="pill danger">${formatNumber(item.rows.length)} conflict rows</span>
        <span class="pill">${formatNumber(item.segments.length)} matching segments</span>
        ${categoryPills(item).join("")}
      </div>
      <div class="muted">${liveEdit ? "Live editing is enabled. IP-level actions update ranges through Admin API." : "Read-only mode is enabled. IP-level actions generate downloadable admin instructions."}</div>
    </div>
    <div class="range-row-list">
      <h3>Ranges and matching segments for ${escapeHtml(item.ip)}</h3>
      ${item.rows.map((row) => renderIpConflictRow(row)).join("")}
    </div>
  `;
}

function renderIpDiagramSvg(item) {
  const rows = ipDiagramRows(item);
  const rowHeight = 112;
  const width = 1560;
  const height = Math.max(420, 160 + rows.reduce((sum, row) => sum + Math.max(1, row.segments.length) * rowHeight, 0));
  const ipX = 56;
  const ipW = 320;
  const ipH = 112;
  const ipY = Math.round(height / 2 - ipH / 2);
  const rangeX = 540;
  const rangeW = 330;
  const rangeH = 74;
  const segmentX = 1040;
  const segmentW = 450;
  const segmentH = 70;
  let cursorY = 112;
  const diagramRows = rows
    .map((row) => {
      const laneCount = Math.max(1, row.segments.length);
      const rowBlockHeight = laneCount * rowHeight;
      const rangeY = cursorY + Math.round(rowBlockHeight / 2 - rangeH / 2);
      const rangeCenterY = rangeY + rangeH / 2;
      const liveColor = "#b42318";
      const segmentRows = row.segments
        .map((segment, index) => {
          const y = cursorY + index * rowHeight + Math.round((rowHeight - segmentH) / 2);
          const centerY = y + segmentH / 2;
          const color = segment.used ? "#15803d" : "#b42318";
          const fill = segment.used ? "#f0fdf4" : "#fff1f2";
          return `
            <path d="M ${rangeX + rangeW} ${rangeCenterY} C ${rangeX + rangeW + 120} ${rangeCenterY}, ${segmentX - 120} ${centerY}, ${segmentX} ${centerY}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="0.72" />
            <g class="diagram-node-clickable" data-open-segment="${escapeAttr(segment.key || "")}">
              <rect x="${segmentX}" y="${y}" width="${segmentW}" height="${segmentH}" rx="14" fill="${fill}" stroke="${color}" stroke-width="2" />
              <rect x="${segmentX}" y="${y}" width="9" height="${segmentH}" rx="4" fill="${color}" />
              ${svgFitText(segment.name || "Unnamed segment", segmentX + 24, y + 25, segmentW - 160, { fontSize: 18, minFontSize: 11, weight: 850, fill: "#111827" })}
              ${svgFitText(segmentParent(segment.path) || segment.path || "No parent", segmentX + 24, y + 47, segmentW - 170, { fontSize: 13, minFontSize: 10, weight: 750, fill: "#64748b" })}
              ${svgFitText(segment.used ? "USED" : "NOT USED", segmentX + segmentW - 22, y + 26, 110, { fontSize: 12, minFontSize: 9, weight: 850, fill: color, anchor: "end" })}
            </g>
          `;
        })
        .join("");
      const rowSvg = `
        <path d="M ${ipX + ipW} ${ipY + ipH / 2} C ${ipX + ipW + 120} ${ipY + ipH / 2}, ${rangeX - 120} ${rangeCenterY}, ${rangeX} ${rangeCenterY}" fill="none" stroke="${liveColor}" stroke-width="4" stroke-linecap="round" opacity="0.7" />
        <g class="diagram-node-clickable" data-open-range="${escapeAttr(row.range)}">
          <rect x="${rangeX}" y="${rangeY}" width="${rangeW}" height="${rangeH}" rx="14" fill="#fff1f2" stroke="${liveColor}" stroke-width="2" />
          ${svgFitText(row.range, rangeX + 18, rangeY + 28, rangeW - 36, { fontSize: 18, minFontSize: 11, weight: 900, fill: "#111827" })}
          ${svgFitText(`${formatNumber(row.ipCount || 0)} IPs in overlap`, rangeX + 18, rangeY + 51, rangeW - 140, { fontSize: 13, minFontSize: 9, weight: 800, fill: "#64748b" })}
          ${svgFitText(categoryPillsText(row), rangeX + rangeW - 18, rangeY + 50, 120, { fontSize: 12, minFontSize: 9, weight: 850, fill: "#64748b", anchor: "end" })}
        </g>
        ${segmentRows}
      `;
      cursorY += rowBlockHeight;
      return rowSvg;
    })
    .join("");
  return `
    <div class="range-diagram-card">
      <div class="diagram-head">
        <div>
          <span class="eyebrow">Live IP diagram</span>
          <strong>${escapeHtml(item.ip)}</strong>
        </div>
        <span class="muted">${formatNumber(rows.length)} matching ranges, ${formatNumber(item.segments?.length || 0)} matching segments</span>
      </div>
      <div class="range-diagram-scroll">
        <svg class="range-diagram-svg ip-diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Live IP relationship diagram">
          <rect width="${width}" height="${height}" fill="#ffffff" />
          <text x="${ipX}" y="42" font-size="18" font-weight="800" fill="#64748b">SELECTED LIVE IP</text>
          <text x="${rangeX}" y="42" font-size="18" font-weight="800" fill="#64748b">MATCHING RANGES</text>
          <text x="${segmentX}" y="42" font-size="18" font-weight="800" fill="#64748b">MATCHING SEGMENTS</text>
          <g class="diagram-node-clickable" data-open-ip="${escapeAttr(item.ip)}">
            <rect x="${ipX}" y="${ipY}" width="${ipW}" height="${ipH}" rx="18" fill="#fff1f2" stroke="#b42318" stroke-width="3" />
            ${svgFitText(item.ip, ipX + 26, ipY + 41, ipW - 52, { fontSize: 28, minFontSize: 14, weight: 900, fill: "#111827" })}
            ${svgFitText("LIVE ENDPOINT", ipX + 26, ipY + 72, ipW - 52, { fontSize: 16, minFontSize: 10, weight: 850, fill: "#b42318" })}
            ${svgFitText(`${formatNumber(item.rows.length)} conflict rows`, ipX + 26, ipY + 96, ipW - 52, { fontSize: 14, minFontSize: 10, weight: 800, fill: "#64748b" })}
          </g>
          ${diagramRows}
        </svg>
      </div>
    </div>
  `;
}

function ipDiagramRows(item) {
  const rows = new Map();
  (item.rows || []).forEach((row) => {
    const range = row.overlap_range || "Unknown range";
    if (!rows.has(range)) {
      rows.set(range, {
        range,
        ipCount: Number(row.ip_count || 0),
        categories: new Map(),
        segments: new Map(),
      });
    }
    const target = rows.get(range);
    target.ipCount = Math.max(target.ipCount, Number(row.ip_count || 0));
    addCategory(target.categories, row.stageKey);
    [row.left, row.right].forEach((segment) => {
      const key = segment.key || `${segment.path || ""}::${segment.name || ""}`;
      if (!target.segments.has(key)) {
        target.segments.set(key, {
          key,
          name: segment.name || "Unnamed segment",
          path: segment.path || "",
          used: Boolean(segment.used),
          categories: new Map(),
        });
      }
      const stored = target.segments.get(key);
      stored.used = stored.used || Boolean(segment.used);
      addCategory(stored.categories, row.stageKey);
    });
  });
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      categories: sortedCategories(row.categories),
      segments: Array.from(row.segments.values())
        .map((segment) => ({ ...segment, categories: sortedCategories(segment.categories) }))
        .sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.range.localeCompare(b.range));
}

function renderIpConflictRow(row) {
  return `
    <article class="range-row-card conflict-visual-row">
      <div class="range-row-stage">
        <span class="stage-category-pill">${stageCategoryLabel(row.stageKey)}</span>
        ${rangeLink(row.overlap_range, row.overlap_range, "range-chip")}
        <span class="pill">${formatNumber(row.ip_count || 0)} IPs in overlap</span>
      </div>
      <div class="visual-conflict-pair">
        ${segmentMiniCard("Matching segment", row.left)}
        ${segmentMiniCard("Matching segment", row.right)}
      </div>
    </article>
  `;
}

function segmentMiniCard(label, segment = {}) {
  return `
    <div class="segment-mini-card clickable-card ${segment.used ? "used" : "unused"}" data-open-segment="${escapeAttr(segment.key || "")}">
      <span class="eyebrow">${escapeHtml(label)}</span>
      <strong>${escapeHtml(segment.name || "Unnamed segment")}</strong>
      <div class="muted">${escapeHtml(segmentParent(segment.path) || segment.path || "No parent")}</div>
      <div class="range-chip-list">
        <span class="pill ${segment.used ? "good" : "danger"}">${segment.used ? "USED" : "NOT USED"}</span>
        <span class="pill">${formatNumber(segment.policy_reference_count || 0)} policy refs</span>
        ${segment.range ? rangeLink(segment.range, segment.range, "pill") : `<span class="pill">No source range</span>`}
      </div>
    </div>
  `;
}

function rangeSegmentCard(segment, liveHostCount) {
  return `
    <div class="range-segment-card clickable-card ${segment.used ? "used" : "unused"} ${liveHostCount ? "has-live" : ""}" data-open-segment="${escapeAttr(segment.key || "")}">
      <div class="segment-title">${escapeHtml(segment.name || "Unnamed segment")}</div>
      <div class="muted">${escapeHtml(segment.path || "No hierarchy")}</div>
      <div class="range-chip-list">
        ${categoryPills(segment).join("")}
        <span class="pill ${segment.used ? "good" : "danger"}">${segment.used ? "Used in policy" : "Not used in policy"}</span>
        <span class="pill">${formatNumber(segment.policyReferenceCount || 0)} policy refs</span>
        ${liveHostCount ? `<span class="pill danger">${formatNumber(liveHostCount)} live hosts in overlap</span>` : ""}
      </div>
      <div class="range-chip-list">${segment.ranges.map((range) => rangeLink(range, range, "pill")).join("") || `<span class="muted">No conflict ranges recorded.</span>`}</div>
    </div>
  `;
}

function renderRangeRows(group) {
  return `
    <div class="range-row-list">
      <h3>Conflict decisions for this range</h3>
      ${group.rows
        .map(
          (row) => `
            <article class="range-row-card">
              <div class="range-row-stage">
                <span class="pill">${escapeHtml(stageTitle(row.stageKey))}</span>
                <span class="pill ${row.live_host_count ? "danger" : "good"}">${formatNumber(row.live_host_count || 0)} live hosts</span>
              </div>
              <div class="stage-main">
                ${segmentBox(displaySegmentsForRow(row.stageKey, row).left)}
                ${segmentBox(displaySegmentsForRow(row.stageKey, row).right)}
                <div class="card">${renderDecision(row.stageKey, row)}</div>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderDocumentsPage() {
  const documents = state.documents || [];
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Documents</h2>
          <div class="muted">Generated DOCX recommendation files and applied-resolution evidence are kept here until deleted.</div>
        </div>
        <span class="pill">${formatNumber(documents.length)} documents</span>
      </div>
      <div class="panel-body">
        ${
          documents.length
            ? `<table class="documents-table"><thead><tr><th>Document</th><th>Generated</th><th>Scope</th><th>Size</th><th class="actions-cell">Actions</th></tr></thead><tbody>${documents
                .map(
                  (doc) => `<tr>
                    <td><strong>${escapeHtml(doc.filename)}</strong><div class="muted">${escapeHtml(doc.project_name || state.status?.project?.name || "Segment Conflict Workspace")} - ${escapeHtml(doc.summary || "Range change recommendations")}</div></td>
                    <td>${escapeHtml(formatDate(doc.created_at))}</td>
                    <td>${escapeHtml(doc.scope || `${formatNumber(doc.step_count || 0)} steps`)}<div class="muted">${formatNumber(doc.step_count || 0)} steps${doc.stages?.length ? `, ${doc.stages.map(escapeHtml).join(", ")}` : ""}</div></td>
                    <td>${formatBytes(doc.size || 0)}</td>
                    <td class="actions-cell"><div class="document-actions"><a class="button secondary small" href="/api/documents/${encodeURIComponent(doc.id)}">Download</a><button class="button danger small" type="button" data-delete-document="${escapeAttr(doc.id)}">Delete</button></div></td>
                  </tr>`
                )
                .join("")}</tbody></table>`
            : `<div class="empty">No generated recommendation documents yet. Generate instructions or apply a resolution to create one.</div>`
        }
      </div>
    </section>
  `;
}

function renderStage() {
  const stage = stages.find((item) => item.key === state.activeStage) || stages[0];
  const rows = state.analysis?.stages?.[stage.key] || [];
  if (stage.key === "zero_ranges") return renderZeroRanges(stage, rows);
  const actions = stageActions(stage.key, rows);
  const liveEdit = Boolean(state.status?.protection?.live_edit_enabled);
  const actionText = liveEdit ? "Apply page changes" : "Generate page instructions";
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>${stage.number}. ${escapeHtml(stage.title)}</h2>
          <div class="muted">${escapeHtml(stage.description)}</div>
        </div>
        <button class="button ${liveEdit ? "" : "secondary"}" type="button" data-apply-stage="${stage.key}" ${actions.length ? "" : "disabled"}>
          ${state.loading === `stage:${stage.key}` ? (liveEdit ? "Applying..." : "Generating...") : `${actionText} (${formatNumber(actions.length)})`}
        </button>
      </div>
      ${renderStageSummary(stage, rows, actions, liveEdit)}
      ${
        rows.length
          ? rows.map((row) => renderConflictCard(stage.key, row)).join("")
          : `<div class="panel-body"><div class="empty">No conflicts in this stage.</div></div>`
      }
    </section>
  `;
}

function renderStageSummary(stage, rows, actions, liveEdit) {
  const modeCopy = liveEdit
    ? "Live editing is enabled. The page action sends the selected range removals to the Admin API."
    : "Read-only mode is enabled. The page action generates manual admin instructions and a downloadable CSV; it does not change the admin platform.";
  const stageCopy =
    stage.key === "used_wins"
      ? "Policy-used segments are treated as authoritative over segments that are not referenced by policy configuration."
      : stage.key === "ownership"
        ? "Choose the owner only where the default duplicate-owner decision is not acceptable, then generate or apply the page."
        : stage.key === "live_decision"
          ? "These overlaps include live endpoints and need an explicit admin or policy owner decision before any range is removed."
          : "These overlaps have no live endpoint evidence. They can be reviewed gradually by selecting an owner when appropriate.";
  return `
    <div class="stage-summary">
      <strong>${formatNumber(rows.length)} conflict${rows.length === 1 ? "" : "s"} shown, ${formatNumber(actions.length)} selected range action${actions.length === 1 ? "" : "s"} ready.</strong>
      <span>${escapeHtml(stageCopy)} ${escapeHtml(modeCopy)}</span>
    </div>
  `;
}

function renderConflictCard(stageKey, row) {
  const action = actionForRow(stageKey, row);
  const liveEdit = Boolean(state.status?.protection?.live_edit_enabled);
  const showLiveRemove = stageKey === "used_wins" && liveEdit && action;
  const display = displaySegmentsForRow(stageKey, row);
  return `
    <article class="stage-card">
      <div class="range-chip-list">
        ${rangeLink(row.overlap_range, row.overlap_range, `range-chip ${action && appliedAction(action) ? "applied" : ""}`)}
        <span class="pill ${row.live_host_count ? "danger" : "good"}">${formatNumber(row.live_host_count)} live hosts</span>
        <span class="pill">${formatNumber(row.ip_count)} IPs</span>
      </div>
      <div class="stage-main">
        ${segmentBox(display.left)}
        ${segmentBox(display.right)}
        <div class="card">
          ${renderDecision(stageKey, row)}
          ${
            showLiveRemove
              ? `<button class="button danger small" type="button" data-remove-row="${escapeAttr(row.id)}">
                  ${state.loading === `row:${row.id}` ? "Removing..." : "Remove"}
                </button>`
              : ""
          }
        </div>
      </div>
      ${row.live_ips?.length ? `<div class="muted">Live IP samples: ${row.live_ips.slice(0, 20).map(escapeHtml).join(", ")}${row.live_ips.length > 20 ? `, +${formatNumber(row.live_ips.length - 20)} more` : ""}</div>` : ""}
    </article>
  `;
}

function displaySegmentsForRow(stageKey, row) {
  if (stageKey !== "used_wins") return { left: row.left, right: row.right };
  if (!row.left?.used && row.right?.used) return { left: row.right, right: row.left };
  return { left: row.left, right: row.right };
}

function segmentBox(segment) {
  return `
    <div class="segment-box clickable-card ${segment.used ? "used" : "unused"}" data-open-segment="${escapeAttr(segment.key || "")}">
      <div class="segment-title">${escapeHtml(segment.name || "Unnamed segment")}</div>
      <div class="muted">${escapeHtml(segment.path || "No hierarchy")}</div>
      <div class="range-chip-list">
        <span class="pill ${segment.used ? "good" : "danger"}">${segment.used ? "USED" : "NOT USED"}</span>
        <span class="pill">${formatNumber(segment.policy_reference_count || 0)} direct policy refs</span>
      </div>
      <div class="range-chip-list">${segment.range ? rangeLink(segment.range, segment.range, "pill") : `<span class="muted">No source range</span>`}</div>
    </div>
  `;
}

function renderDecision(stageKey, row) {
  if (stageKey === "used_wins") {
    const target = row.default_update?.name || "";
    return `<h4>Automatic target</h4><div class="muted">Remove from ${escapeHtml(target)}</div>`;
  }
  const value = decisionValue(stageKey, row);
  const none = stageKey === "ownership" || stageKey === "live_decision" || stageKey === "lower_review";
  return `
    <h4>Choose owner</h4>
    <div class="decision-grid">
      ${none ? decisionOption(row.id, "", "Keep as is", value === "") : ""}
      ${decisionOption(row.id, "left", `Keep ${row.left.name}`, value === "left")}
      ${decisionOption(row.id, "right", `Keep ${row.right.name}`, value === "right")}
    </div>
  `;
}

function decisionOption(id, value, label, checked) {
  return `
    <label>
      <input type="radio" name="decision-${escapeAttr(id)}" data-decision="${escapeAttr(id)}" value="${escapeAttr(value)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderZeroRanges(stage, rows) {
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>${stage.number}. ${escapeHtml(stage.title)}</h2>
          <div class="muted">${escapeHtml(stage.description)}</div>
        </div>
        <a class="button secondary" href="/api/export/zero-ranges.csv">Download CSV</a>
      </div>
      <div class="panel-body">
        ${
          rows.length
            ? `<table><thead><tr><th>Name</th><th>Hierarchy</th><th>Usage</th><th>Children</th></tr></thead><tbody>${rows
                .map(
                  (row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.path)}</td><td>${row.used ? "USED - review manually" : "NOT USED"}</td><td>${formatNumber(row.child_count || 0)}</td></tr>`
                )
                .join("")}</tbody></table>`
            : `<div class="empty">No live zero-range segments are currently present.</div>`
        }
      </div>
    </section>
  `;
}

function wireEvents(root) {
  root.querySelectorAll("[data-toggle-artifacts]").forEach((button) => {
    button.addEventListener("click", () => {
      state.showArtifactDetails = !state.showArtifactDetails;
      render();
    });
  });
  root.querySelectorAll("[data-clear-data]").forEach((button) => button.addEventListener("click", clearData));
  root.querySelectorAll("[data-save-project]").forEach((button) => button.addEventListener("click", () => saveProject(button)));
  root.querySelectorAll("[data-project-name]").forEach((input) =>
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") saveProject(input);
    })
  );
  root.querySelectorAll("[data-live-edit]").forEach((button) =>
    button.addEventListener("click", () => setProtection(button.dataset.liveEdit === "true"))
  );
  root.querySelectorAll("[data-host-source]").forEach((button) =>
    button.addEventListener("click", () => {
      state.hostIpSource = button.dataset.hostSource || "web";
      localStorage.setItem("hostIpSource", state.hostIpSource);
      render();
    })
  );
  root.querySelectorAll("[data-stage]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeStage = button.dataset.stage;
      render();
    });
  });
  root.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePage = button.dataset.page || "workflow";
      localStorage.setItem("activePage", state.activePage);
      render();
    });
  });
  root.querySelectorAll("[data-viz-lens]").forEach((button) => {
    button.addEventListener("click", () => {
      state.visualizationLens = button.dataset.vizLens || "ranges";
      localStorage.setItem("visualizationLens", state.visualizationLens);
      render();
    });
  });
  root.querySelectorAll("[data-range-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRange = button.dataset.rangeSelect || "";
      localStorage.setItem("selectedRange", state.selectedRange);
      render();
    });
  });
  root.querySelectorAll("[data-open-range]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openRangeVisualization(button.dataset.openRange || "");
    });
  });
  root.querySelectorAll("[data-open-segment]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openSegmentVisualization(button.dataset.openSegment || "");
    });
  });
  root.querySelectorAll("[data-open-ip]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openIpVisualization(button.dataset.openIp || "");
    });
  });
  root.querySelectorAll("[data-download-range-png]").forEach((button) => {
    button.addEventListener("click", () => downloadRangePng(button.dataset.downloadRangePng || ""));
  });
  root.querySelectorAll("[data-segment-select]").forEach((button) => {
    button.addEventListener("click", () => {
      openSegmentVisualization(button.dataset.segmentSelect || "");
    });
  });
  root.querySelectorAll("[data-ip-select]").forEach((button) => {
    button.addEventListener("click", () => {
      openIpVisualization(button.dataset.ipSelect || "");
    });
  });
  root.querySelectorAll("[data-viz-filter]").forEach((input) => {
    input.addEventListener("input", () => updateVisualizationFilter(input.dataset.vizFilter, input.value));
  });
  root.querySelectorAll("[data-clear-viz-filter]").forEach((button) => {
    button.addEventListener("click", () => updateVisualizationFilter(button.dataset.clearVizFilter, ""));
  });
  root.querySelectorAll("[data-import-workspace]").forEach((input) => input.addEventListener("change", () => importWorkspace(input)));
  root.querySelectorAll("[data-save-workspace]").forEach((button) => button.addEventListener("click", () => saveWorkspace(button)));
  root.querySelectorAll("[data-upload]").forEach((input) => input.addEventListener("change", () => upload(input)));
  root.querySelectorAll("[data-test-config]").forEach((button) => button.addEventListener("click", () => testConfig(button.dataset.testConfig, button)));
  root.querySelectorAll("[data-collect-hosts]").forEach((button) => button.addEventListener("click", () => collectHosts(button)));
  root.querySelectorAll("[data-collect-admin]").forEach((button) => button.addEventListener("click", () => collectAdminSegments(button)));
  root.querySelectorAll("[data-decision]").forEach((input) =>
    input.addEventListener("change", () => {
      state.decisions[input.dataset.decision] = input.value;
      render();
    })
  );
  root.querySelectorAll("[data-apply-stage]").forEach((button) => button.addEventListener("click", () => applyStage(button.dataset.applyStage)));
  root.querySelectorAll("[data-apply-range]").forEach((button) => button.addEventListener("click", () => applyRange(button.dataset.applyRange)));
  root.querySelectorAll("[data-apply-segment]").forEach((button) => button.addEventListener("click", () => applySegment(button.dataset.applySegment)));
  root.querySelectorAll("[data-apply-ip]").forEach((button) => button.addEventListener("click", () => applyIp(button.dataset.applyIp)));
  root.querySelectorAll("[data-remove-row]").forEach((button) => button.addEventListener("click", () => removePolicyUsageRange(button.dataset.removeRow)));
  root.querySelectorAll("[data-delete-document]").forEach((button) => button.addEventListener("click", () => deleteDocument(button.dataset.deleteDocument)));
}

async function upload(input) {
  if (!input.files.length) return;
  const form = new FormData();
  form.append("file", input.files[0]);
  await apiSend(`/upload/${input.dataset.upload}`, { method: "POST", body: form });
  toast(`${input.dataset.upload} uploaded.`);
  await refreshAll();
}

async function importWorkspace(input) {
  if (!input.files.length) return;
  const confirmed = await modalConfirm({
    title: "Restore workspace bundle?",
    message: "Current loaded artifacts, snapshots, generated documents, and API metadata will be replaced. Passwords are never restored from bundles.",
    confirmText: "Restore",
    tone: "danger",
  });
  if (!confirmed) {
    input.value = "";
    return;
  }
  const form = new FormData();
  form.append("file", input.files[0]);
  try {
    const result = await apiSend("/import/workspace", { method: "POST", body: form });
    state.decisions = {};
    state.recentApplied = [];
    toast(`Restored ${formatNumber(result.imported?.length || 0)} workspace file${(result.imported?.length || 0) === 1 ? "" : "s"}${result.project?.name ? ` for ${result.project.name}` : ""}.`);
    await refreshAll();
  } catch (error) {
    toast(`Workspace import failed: ${error.message}`);
  } finally {
    input.value = "";
  }
}

async function saveProject(button) {
  const input = document.querySelector("[data-project-name]");
  const name = input?.value || "";
  if (!name.trim()) return toast("Project name is required.");
  await withButtonLoading(button, "Updating...", async () => {
    const result = await apiSend("/project", { method: "POST", body: JSON.stringify({ name }) });
    state.status = state.status || {};
    state.status.project = result.project;
    toast(`Project updated to ${result.project.name}.`);
    await refreshAll();
  }).catch((error) => toast(`Project update failed: ${error.message}`));
}

async function saveWorkspace(button) {
  const activeProjectName = document.querySelector("[data-project-name]")?.value || state.status?.project?.name || defaultWorkspaceName();
  const requestedName = await modalPrompt({
    title: "Save workspace",
    message: "Enter the project name to store in this workspace bundle. The filename will be normalized and saved as a .zip bundle.",
    label: "Project name",
    defaultValue: activeProjectName,
    confirmText: "Save",
  });
  if (requestedName === null) return;
  const filename = normalizeZipFilename(requestedName);
  if (!filename) return toast("Workspace name is required.");
  await withButtonLoading(button, "Saving...", async () => {
    const response = await fetch(`${API}/export/workspace.zip?project_name=${encodeURIComponent(requestedName)}`);
    if (!response.ok) {
      let detail = `Request failed with ${response.status}`;
      try {
        const payload = await response.json();
        detail = payload.detail || detail;
      } catch (_) {}
      throw new Error(Array.isArray(detail) ? detail.map((item) => item.msg).join(", ") : detail);
    }
    const blob = await response.blob();
    downloadBlob(blob, filename);
    toast(`Saved ${filename}.`);
  }).catch((error) => toast(`Workspace save failed: ${error.message}`));
}

function defaultWorkspaceName() {
  return state.status?.project?.name || "Segment Conflict Workspace";
}

function normalizeZipFilename(value) {
  const base = String(value || "")
    .trim()
    .replace(/\.zip$/i, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_ .-]+|[_ .-]+$/g, "");
  return base ? `${base}.zip` : "";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function configPayload(kind) {
  return {
    base_url: document.querySelector(`[data-${kind}-url]`)?.value || "",
    username: document.querySelector(`[data-${kind}-user]`)?.value || "",
    password: document.querySelector(`[data-${kind}-password]`)?.value || "",
    verify_tls: document.querySelector(`[data-${kind}-tls]`)?.checked || false,
  };
}

async function testConfig(kind, button) {
  const payload = configPayload(kind);
  const validation = validateApiPayload(kind, payload);
  if (validation) {
    setApiStatus(kind, "error", validation);
    return toast(validation);
  }
  setApiStatus(kind, "info", `Testing ${kind === "web" ? "Web API" : "Admin API"} connection...`);
  try {
    await withButtonLoading(button, "Testing...", async () => {
      const result = await apiSend(`/test/${kind}`, { method: "POST", body: JSON.stringify(payload) });
      await persistConfig(kind, payload);
      setApiStatus(kind, "success", `Test ok: ${result.base_url}`);
      toast(`${kind} API test ok: ${result.base_url}`);
      await refreshAll();
    });
  } catch (error) {
    setApiStatus(kind, "error", error.message);
    toast(`${kind} API test failed: ${error.message}`);
  }
}

async function collectHosts(button) {
  const payload = configPayload("web");
  const validation = validateApiPayload("web", payload);
  if (validation) {
    setApiStatus("web", "error", validation);
    return toast(validation);
  }
  setApiStatus("web", "info", "Collecting active host IPs from Web API...");
  try {
    await withButtonLoading(button, "Collecting...", async () => {
      const result = await apiSend("/collect/hosts", { method: "POST", body: JSON.stringify(payload) });
      await persistConfig("web", payload);
      setApiStatus("web", "success", `Collected ${formatNumber(result.count)} active host IPs.`);
      toast(`Collected ${formatNumber(result.count)} active host IPs.`);
      await refreshAll();
    });
  } catch (error) {
    setApiStatus("web", "error", error.message);
    toast(`Web API host collection failed: ${error.message}`);
  }
}

async function collectAdminSegments(button) {
  const payload = configPayload("admin");
  const validation = validateApiPayload("admin", payload);
  if (validation) {
    setApiStatus("admin", "error", validation);
    return toast(validation);
  }
  setApiStatus("admin", "info", "Collecting segments from Admin API...");
  try {
    await withButtonLoading(button, "Collecting...", async () => {
      const result = await apiSend("/collect/admin-segments", { method: "POST", body: JSON.stringify(payload) });
      await persistConfig("admin", payload);
      setApiStatus("admin", "success", `Collected ${formatNumber(result.count)} segments.`);
      toast(`Collected ${formatNumber(result.count)} segments.`);
      await refreshAll();
    });
  } catch (error) {
    setApiStatus("admin", "error", error.message);
    toast(`Admin API segment collection failed: ${error.message}`);
  }
}

async function persistConfig(kind, payload) {
  await apiSend(`/config/${kind}`, { method: "POST", body: JSON.stringify(payload) });
}

function validateApiPayload(kind, payload) {
  const saved = state.status?.config?.[kind] || {};
  if (!payload.base_url.trim()) return `${kind === "web" ? "Web API" : "Admin API"} URL is required.`;
  if (!payload.username.trim()) return `${kind === "web" ? "Web API" : "Admin API"} username is required.`;
  if (!payload.password && !saved.password_saved) return `${kind === "web" ? "Web API" : "Admin API"} password is required.`;
  return "";
}

async function withButtonLoading(button, label, work) {
  const previous = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = label;
  }
  try {
    return await work();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previous;
    }
  }
}

function setApiStatus(kind, type, message) {
  state.apiStatus[kind] = { type, message };
  const element = document.querySelector(`[data-api-status="${kind}"]`);
  if (!element) return;
  element.hidden = false;
  element.className = `api-inline-status ${type}`;
  element.textContent = message;
}

function openRangeVisualization(range) {
  const group = resolveRangeGroup(range);
  if (!group) {
    toast(`No conflict visualization was found for range ${range}.`);
    return;
  }
  state.selectedRange = group.range;
  state.visualizationLens = "ranges";
  state.activePage = "ranges";
  localStorage.setItem("selectedRange", state.selectedRange);
  localStorage.setItem("visualizationLens", state.visualizationLens);
  localStorage.setItem("activePage", state.activePage);
  render();
  requestAnimationFrame(() => {
    document.querySelector("[data-range-diagram]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function openSegmentVisualization(segmentKey) {
  const segment = resolveSegmentGroup(segmentKey);
  if (!segment) {
    toast("No segment visualization was found for this segment.");
    return;
  }
  state.selectedSegment = segment.key;
  state.visualizationLens = "segments";
  state.activePage = "ranges";
  localStorage.setItem("selectedSegment", state.selectedSegment);
  localStorage.setItem("visualizationLens", state.visualizationLens);
  localStorage.setItem("activePage", state.activePage);
  render();
  requestAnimationFrame(() => {
    document.querySelector(".segment-diagram-svg")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function openIpVisualization(ip) {
  const item = resolveIpGroup(ip);
  if (!item) {
    toast(`No live IP visualization was found for ${ip}.`);
    return;
  }
  state.selectedIp = item.ip;
  state.visualizationLens = "ips";
  state.activePage = "ranges";
  localStorage.setItem("selectedIp", state.selectedIp);
  localStorage.setItem("visualizationLens", state.visualizationLens);
  localStorage.setItem("activePage", state.activePage);
  render();
  requestAnimationFrame(() => {
    document.querySelector(".ip-diagram-svg")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function resolveRangeGroup(range) {
  const value = String(range || "").trim();
  if (!value) return null;
  const groups = rangeGroups();
  return (
    groups.find((group) => group.range === value) ||
    groups.find((group) => group.segments.some((segment) => (segment.ranges || []).includes(value) || (segment.allRanges || []).includes(value))) ||
    groups.find((group) =>
      group.rows.some((row) => [row.left?.range, row.right?.range, row.left?.ranges, row.right?.ranges].flat().filter(Boolean).includes(value))
    ) ||
    null
  );
}

function resolveSegmentGroup(segmentKey) {
  const value = String(segmentKey || "").trim();
  if (!value) return null;
  const segments = segmentGroups();
  return (
    segments.find((segment) => segment.key === value) ||
    segments.find((segment) => `${segment.path || ""}::${segment.name || ""}` === value) ||
    segments.find((segment) => segment.name === value) ||
    null
  );
}

function resolveIpGroup(ip) {
  const value = String(ip || "").trim();
  if (!value) return null;
  return ipGroups().find((item) => item.ip === value) || null;
}

async function downloadRangePng(range) {
  const svg = document.querySelector("[data-range-diagram]");
  if (!svg) return toast("No range diagram is available to download.");
  const selected = state.selectedRange || range || "range";
  const source = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const scale = 2;
    const viewBox = svg.viewBox?.baseVal;
    const width = viewBox?.width || svg.clientWidth || 1400;
    const height = viewBox?.height || svg.clientHeight || 600;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pngUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = `${slugify(`range-${selected}`)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    toast(`Unable to export range diagram: ${error.message}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The diagram image could not be rendered."));
    image.src = url;
  });
}

async function setProtection(liveEdit) {
  const payload = { live_edit_enabled: Boolean(liveEdit) };
  const result = await apiSend("/protection", { method: "POST", body: JSON.stringify(payload) });
  toast(result.live_edit_enabled ? "Live editing enabled. Range updates can modify Admin API segments." : "Read-only mode enabled. Actions will generate manual instructions.");
  await refreshAll();
}

async function clearData() {
  const confirmed = await modalConfirm({
    title: "Clear loaded data?",
    message: "This removes loaded XML files, snapshots, generated documents, API URLs, usernames, saved passwords, and mode settings.",
    confirmText: "Clear loaded data",
    tone: "danger",
  });
  if (!confirmed) return;
  const result = await apiSend("/clear-data", { method: "POST" });
  resetLocalWorkspaceState();
  state.decisions = {};
  state.recentApplied = [];
  state.apiStatus = {};
  state.hostIpSource = "web";
  toast(`Cleared ${formatNumber(result.removed?.length || 0)} loaded item${(result.removed?.length || 0) === 1 ? "" : "s"}.`);
  await refreshAll();
}

function resetLocalWorkspaceState() {
  [
    "selectedRange",
    "selectedSegment",
    "selectedIp",
    "visualizationLens",
    "hostIpSource",
    "vizFilter:ranges",
    "vizFilter:segments",
    "vizFilter:ips",
  ].forEach((key) => localStorage.removeItem(key));
  state.selectedRange = "";
  state.selectedSegment = "";
  state.selectedIp = "";
  state.visualizationLens = "ranges";
  state.visualizationFilters = { ranges: "", segments: "", ips: "" };
}

function stageActions(stageKey, rows) {
  return rows.map((row) => actionForRow(stageKey, row)).filter(Boolean);
}

function rangeGroups() {
  const groups = new Map();
  const stageEntries = stages.filter((stage) => stage.key !== "zero_ranges");
  stageEntries.forEach((stage) => {
    const rows = state.analysis?.stages?.[stage.key] || [];
    rows.forEach((row) => {
      const range = row.overlap_range || "Unknown range";
      if (!groups.has(range)) {
        groups.set(range, {
          range,
          rows: [],
          segmentsByKey: new Map(),
          segments: [],
          stageLabels: [],
          stageKeys: new Set(),
          categories: new Map(),
          liveHostCount: 0,
          ipCount: 0,
        });
      }
      const group = groups.get(range);
      const withStage = { ...row, stageKey: stage.key };
      group.rows.push(withStage);
      group.liveHostCount = Math.max(group.liveHostCount, Number(row.live_host_count || 0));
      group.ipCount = Math.max(group.ipCount, Number(row.ip_count || 0));
      if (!group.stageKeys.has(stage.key)) {
        group.stageKeys.add(stage.key);
        group.stageLabels.push(stage.title);
      }
      addCategory(group.categories, stage.key);
      [row.left, row.right].forEach((segment) => addRangeSegment(group, segment, stage.key));
    });
  });
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      categories: sortedCategories(group.categories),
      segments: Array.from(group.segmentsByKey.values())
        .map((segment) => ({
          ...segment,
          ranges: Array.from(segment.ranges || []),
          allRanges: Array.from(segment.allRanges || []),
          categories: sortedCategories(segment.categories),
        }))
        .sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.liveHostCount - a.liveHostCount || b.rows.length - a.rows.length || a.range.localeCompare(b.range));
}

function addRangeSegment(group, segment = {}, stageKey = "") {
  const key = segment.key || `${segment.path || ""}::${segment.name || ""}::${segment.range || ""}`;
  if (!group.segmentsByKey.has(key)) {
    group.segmentsByKey.set(key, {
      key,
      name: segment.name || "Unnamed segment",
      path: segment.path || "",
      used: Boolean(segment.used),
      policyReferenceCount: Number(segment.policy_reference_count || 0),
      policyReferences: segment.policy_references || [],
      directUsed: Boolean(segment.direct_used),
      usedReason: segment.used_reason || "",
      ranges: new Set(),
      allRanges: new Set(segment.ranges || []),
      categories: new Map(),
    });
  }
  const existing = group.segmentsByKey.get(key);
  existing.used = existing.used || Boolean(segment.used);
  existing.policyReferenceCount = Math.max(existing.policyReferenceCount, Number(segment.policy_reference_count || 0));
  existing.policyReferences = mergePolicyReferences(existing.policyReferences, segment.policy_references || []);
  existing.directUsed = existing.directUsed || Boolean(segment.direct_used);
  existing.usedReason = existing.usedReason || segment.used_reason || "";
  if (segment.range) existing.ranges.add(segment.range);
  (segment.ranges || []).forEach((range) => existing.allRanges.add(range));
  addCategory(existing.categories, stageKey);
  existing.ranges = existing.ranges instanceof Set ? existing.ranges : new Set(existing.ranges || []);
  existing.allRanges = existing.allRanges instanceof Set ? existing.allRanges : new Set(existing.allRanges || []);
}

function segmentGroups(groups = rangeGroups()) {
  const segments = new Map();
  groups.forEach((group) => {
    group.rows.forEach((row) => {
      [
        [row.left, row.right],
        [row.right, row.left],
      ].forEach(([segment, other]) => addSegmentGroupRow(segments, segment, other, row));
    });
  });
  return Array.from(segments.values())
    .map((segment) => ({
      ...segment,
      categories: sortedCategories(segment.categories),
      ranges: Array.from(segment.ranges || []),
      allRanges: Array.from(segment.allRanges || []),
      conflictRanges: Array.from(segment.conflictRanges || []),
      liveIps: sortIps(Array.from(segment.liveIps || [])),
      otherSegments: Array.from(segment.otherSegments.values())
        .map((other) => ({
          ...other,
          categories: sortedCategories(other.categories),
          ranges: Array.from(other.ranges || []),
          conflictRanges: Array.from(other.conflictRanges || []),
        }))
        .sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.liveIps.length - a.liveIps.length || b.conflictRanges.length - a.conflictRanges.length || Number(b.used) - Number(a.used) || a.name.localeCompare(b.name));
}

function addSegmentGroupRow(segments, segment = {}, other = {}, row = {}) {
  const key = segment.key || `${segment.path || ""}::${segment.name || ""}::${segment.range || ""}`;
  if (!segments.has(key)) {
    segments.set(key, {
      key,
      name: segment.name || "Unnamed segment",
      path: segment.path || "",
      used: Boolean(segment.used),
      directUsed: Boolean(segment.direct_used),
      usedReason: segment.used_reason || "",
      policyReferenceCount: Number(segment.policy_reference_count || 0),
      policyReferences: segment.policy_references || [],
      ranges: new Set(),
      allRanges: new Set(segment.ranges || []),
      conflictRanges: new Set(),
      liveIps: new Set(),
      categories: new Map(),
      rows: [],
      otherSegments: new Map(),
    });
  }
  const existing = segments.get(key);
  existing.used = existing.used || Boolean(segment.used);
  existing.directUsed = existing.directUsed || Boolean(segment.direct_used);
  existing.usedReason = existing.usedReason || segment.used_reason || "";
  existing.policyReferenceCount = Math.max(existing.policyReferenceCount, Number(segment.policy_reference_count || 0));
  existing.policyReferences = mergePolicyReferences(existing.policyReferences, segment.policy_references || []);
  if (segment.range) existing.ranges.add(segment.range);
  (segment.ranges || []).forEach((range) => existing.allRanges.add(range));
  if (row.overlap_range) existing.conflictRanges.add(row.overlap_range);
  (row.live_ips || []).forEach((ip) => existing.liveIps.add(ip));
  addCategory(existing.categories, row.stageKey);
  existing.rows.push(row);
  addOtherSegment(existing, other, row);
}

function addOtherSegment(existing, other = {}, row = {}) {
  const key = other.key || `${other.path || ""}::${other.name || ""}::${other.range || ""}`;
  if (!existing.otherSegments.has(key)) {
    existing.otherSegments.set(key, {
      key,
      name: other.name || "Unnamed segment",
      path: other.path || "",
      used: Boolean(other.used),
      policyReferenceCount: Number(other.policy_reference_count || 0),
      ranges: new Set(),
      conflictRanges: new Set(),
      categories: new Map(),
    });
  }
  const stored = existing.otherSegments.get(key);
  stored.used = stored.used || Boolean(other.used);
  stored.policyReferenceCount = Math.max(stored.policyReferenceCount, Number(other.policy_reference_count || 0));
  if (other.range) stored.ranges.add(other.range);
  if (row.overlap_range) stored.conflictRanges.add(row.overlap_range);
  addCategory(stored.categories, row.stageKey);
}

function ipGroups(groups = rangeGroups()) {
  const ips = new Map();
  groups.forEach((group) => {
    group.rows.forEach((row) => {
      (row.live_ips || []).forEach((ip) => {
        if (!ips.has(ip)) {
          ips.set(ip, {
            ip,
            rows: [],
            ranges: new Set(),
            segmentsByKey: new Map(),
            categories: new Map(),
          });
        }
        const item = ips.get(ip);
        item.rows.push(row);
        if (row.overlap_range) item.ranges.add(row.overlap_range);
        addCategory(item.categories, row.stageKey);
        [row.left, row.right].forEach((segment) => {
          const key = segment.key || `${segment.path || ""}::${segment.name || ""}`;
          if (!item.segmentsByKey.has(key)) {
            item.segmentsByKey.set(key, {
              key,
              name: segment.name || "Unnamed segment",
              path: segment.path || "",
              used: Boolean(segment.used),
              policyReferenceCount: Number(segment.policy_reference_count || 0),
              ranges: new Set(),
            });
          }
          const stored = item.segmentsByKey.get(key);
          stored.used = stored.used || Boolean(segment.used);
          stored.policyReferenceCount = Math.max(stored.policyReferenceCount, Number(segment.policy_reference_count || 0));
          if (segment.range) stored.ranges.add(segment.range);
        });
      });
    });
  });
  return Array.from(ips.values())
    .map((item) => ({
      ...item,
      categories: sortedCategories(item.categories),
      ranges: Array.from(item.ranges || []).sort(),
      segments: Array.from(item.segmentsByKey.values())
        .map((segment) => ({ ...segment, ranges: Array.from(segment.ranges || []) }))
        .sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip));
}

function rangeActions(group) {
  return (group?.rows || []).map((row) => actionForRow(row.stageKey, row)).filter(Boolean);
}

function segmentActions(segment) {
  return actionsForRows(segment?.rows || []);
}

function ipActions(item) {
  return actionsForRows(item?.rows || []);
}

function actionsForRows(rows) {
  const seen = new Set();
  const actions = [];
  rows.forEach((row) => {
    const action = actionForRow(row.stageKey, row);
    if (!action) return;
    const id = actionId(action);
    if (seen.has(id)) return;
    seen.add(id);
    actions.push(action);
  });
  return actions;
}

function actionForRow(stageKey, row) {
  if (stageKey === "used_wins") return row.default_update || null;
  const choice = decisionValue(stageKey, row);
  if (!choice) return null;
  const target = choice === "left" ? row.right : row.left;
  return {
    segment_key: target.key,
    name: target.name,
    path: target.path,
    source_range: target.range,
    remove_range: row.overlap_range,
    reason: stageKey === "ownership" ? "NOT USED ownership cleanup" : stageKey === "live_decision" ? "Admin-selected live USED overlap decision" : "Admin-selected lower priority review",
    stage: stageKey,
  };
}

function decisionValue(stageKey, row) {
  if (Object.prototype.hasOwnProperty.call(state.decisions, row.id)) {
    return state.decisions[row.id];
  }
  return stageKey === "ownership" ? row.default_keep : "";
}

async function applyStage(stageKey) {
  const rows = state.analysis?.stages?.[stageKey] || [];
  const updates = stageActions(stageKey, rows);
  if (!updates.length) return toast("No selected range updates to apply.");
  const liveEdit = Boolean(state.status?.protection?.live_edit_enabled);
  const requestedMode = liveEdit ? "live_edit" : "read_only";
  if (liveEdit && !(await confirmLiveRangeUpdate(`${formatNumber(updates.length)} range update${updates.length === 1 ? "" : "s"} will be sent through Admin API for this page.`))) return;
  state.loading = `stage:${stageKey}`;
  render();
  await applyUpdates(updates, `${stageTitle(stageKey)} page`, requestedMode);
}

async function applyRange(range) {
  const group = rangeGroups().find((item) => item.range === range);
  const updates = rangeActions(group);
  if (!updates.length) return toast("No selected range updates to apply for this range.");
  const liveEdit = Boolean(state.status?.protection?.live_edit_enabled);
  const requestedMode = liveEdit ? "live_edit" : "read_only";
  if (liveEdit && !(await confirmLiveRangeUpdate(`${formatNumber(updates.length)} range update${updates.length === 1 ? "" : "s"} will be sent through Admin API for ${range}.`))) return;
  state.loading = `range:${range}`;
  render();
  await applyUpdates(updates, `Conflict range ${range}`, requestedMode);
}

async function applySegment(segmentKey) {
  const segment = segmentGroups().find((item) => item.key === segmentKey);
  const updates = segmentActions(segment);
  if (!updates.length) return toast("No selected range updates to apply for this segment.");
  const liveEdit = Boolean(state.status?.protection?.live_edit_enabled);
  const requestedMode = liveEdit ? "live_edit" : "read_only";
  if (liveEdit && !(await confirmLiveRangeUpdate(`${formatNumber(updates.length)} range update${updates.length === 1 ? "" : "s"} will be sent through Admin API for ${segment?.name || "this segment"}.`))) return;
  state.loading = `segment:${segmentKey}`;
  render();
  await applyUpdates(updates, `Segment ${segment?.name || segmentKey}`, requestedMode);
}

async function applyIp(ip) {
  const item = ipGroups().find((entry) => entry.ip === ip);
  const updates = ipActions(item);
  if (!updates.length) return toast("No selected range updates to apply for this live IP.");
  const liveEdit = Boolean(state.status?.protection?.live_edit_enabled);
  const requestedMode = liveEdit ? "live_edit" : "read_only";
  if (liveEdit && !(await confirmLiveRangeUpdate(`${formatNumber(updates.length)} range update${updates.length === 1 ? "" : "s"} will be sent through Admin API for conflicts matching ${ip}.`))) return;
  state.loading = `ip:${ip}`;
  render();
  await applyUpdates(updates, `Live IP ${ip}`, requestedMode);
}

function confirmLiveRangeUpdate(message) {
  return modalConfirm({
    title: "Apply live Admin API change?",
    message,
    confirmText: "Apply live change",
    tone: "danger",
  });
}

async function removePolicyUsageRange(rowId) {
  if (!state.status?.protection?.live_edit_enabled) return toast("Enable live editing before removing a range through Admin API.");
  const rows = state.analysis?.stages?.used_wins || [];
  const row = rows.find((item) => item.id === rowId);
  const action = row ? actionForRow("used_wins", row) : null;
  if (!action) return toast("No removable range was found for this row.");
  const confirmed = await modalConfirm({
    title: "Remove range through Admin API?",
    message: `${action.remove_range} will be removed from ${action.name}. This changes live segment ranges.`,
    confirmText: "Remove range",
    tone: "danger",
  });
  if (!confirmed) return;
  state.loading = `row:${rowId}`;
  render();
  await applyUpdates([action], `Single range removal for ${action.name}`, "live_edit");
}

async function applyUpdates(updates, scope = "", requestedMode = "read_only") {
  try {
    const payload = await buildApplyPayload(updates, scope, requestedMode);
    const result = await apiSend("/apply-ranges", { method: "POST", body: JSON.stringify(payload) });
    if (result.mode === "read_only") {
      toast(`Generated ${formatNumber(result.instruction_count || updates.length)} manual instruction${(result.instruction_count || updates.length) === 1 ? "" : "s"} and DOCX recommendation.`);
    } else {
      state.recentApplied = [...updates.map(actionId), ...state.recentApplied].slice(0, 100);
      toast(`Applied ${updates.length} range update${updates.length === 1 ? "" : "s"} and saved DOCX evidence.`);
    }
    await refreshAll();
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = "";
    render();
  }
}

async function buildApplyPayload(updates, scope, requestedMode = "read_only") {
  return {
    updates,
    scope,
    requested_mode: requestedMode === "live_edit" ? "live_edit" : "read_only",
    visualizations: await visualizationsForUpdates(updates),
  };
}

async function visualizationsForUpdates(updates) {
  const byRange = new Map(rangeGroups().map((group) => [group.range, group]));
  const ranges = Array.from(new Set((updates || []).map((update) => update.remove_range).filter(Boolean)));
  const visualizations = [];
  for (const range of ranges) {
    const group = byRange.get(range);
    if (!group) continue;
    try {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderRangeDiagramSvg(group);
      const svg = wrapper.querySelector("svg");
      if (!svg) continue;
      visualizations.push({
        range,
        title: `Range conflict visualization: ${range}`,
        png_data_url: await svgMarkupToPngDataUrl(svg.outerHTML),
      });
    } catch (error) {
      console.warn(`Unable to prepare DOCX visualization for ${range}`, error);
    }
  }
  return visualizations;
}

async function svgMarkupToPngDataUrl(svgMarkup) {
  const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const parsed = new DOMParser().parseFromString(svgMarkup, "image/svg+xml").documentElement;
    const viewBox = (parsed.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    const width = viewBox.length === 4 ? viewBox[2] : image.width || 1400;
    const height = viewBox.length === 4 ? viewBox[3] : image.height || 700;
    const scale = 1.6;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function deleteDocument(documentId) {
  if (!documentId) return;
  const confirmed = await modalConfirm({
    title: "Delete document?",
    message: `Delete generated recommendation document: ${documentId}`,
    confirmText: "Delete",
    tone: "danger",
  });
  if (!confirmed) return;
  const result = await apiSend(`/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" });
  state.documents = result.documents || [];
  toast("Document deleted.");
  await refreshAll();
}

function appliedAction(action) {
  return state.recentApplied.includes(actionId(action));
}

function actionId(action) {
  return [action.segment_key, action.source_range, action.remove_range, action.reason].join("::");
}

function stageTitle(stageKey) {
  return stages.find((stage) => stage.key === stageKey)?.title || stageKey || "Unknown stage";
}

function stageMeta(stageKey) {
  return stages.find((stage) => stage.key === stageKey && stage.key !== "zero_ranges") || null;
}

function stageCategoryLabel(stageKey) {
  const stage = stageMeta(stageKey);
  return stage ? `${stage.number}. ${stage.title}` : "Uncategorized";
}

function addCategory(target, stageKey) {
  const stage = stageMeta(stageKey);
  if (!stage || !target) return;
  target.set(stage.key, { key: stage.key, number: stage.number, title: stage.title });
}

function sortedCategories(value) {
  const rows = value instanceof Map ? Array.from(value.values()) : Array.isArray(value) ? value : [];
  return rows.sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
}

function categoryPills(item) {
  return sortedCategories(item?.categories)
    .map((category) => `<span class="stage-category-pill" title="${escapeAttr(category.title)}">${formatNumber(category.number)}</span>`);
}

function categoryPillsText(item) {
  return sortedCategories(item?.categories)
    .map((category) => `Stage ${category.number}`)
    .join(", ");
}

function mergePolicyReferences(existing = [], incoming = []) {
  const seen = new Set();
  const output = [];
  [...existing, ...incoming].forEach((ref) => {
    const id = `${ref.policy || ""}::${ref.source || ""}`;
    if (seen.has(id)) return;
    seen.add(id);
    output.push(ref);
  });
  return output;
}

function sameSegment(left = {}, right = {}) {
  return (left.key && right.key && left.key === right.key) || (left.path && right.path && left.path === right.path && left.name === right.name);
}

function updateVisualizationFilter(lens, value) {
  if (!["ranges", "segments", "ips"].includes(lens)) return;
  state.visualizationFilters[lens] = value || "";
  localStorage.setItem(`vizFilter:${lens}`, state.visualizationFilters[lens]);
  render();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-viz-filter="${CSS.escape(lens)}"]`);
    if (!input) return;
    input.focus();
    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
  });
}

function normalizedSearch(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueSorted(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function pathSegments(path = "") {
  return String(path || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function segmentParent(path = "") {
  const parts = pathSegments(path);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(" / ");
}

function sortIps(values) {
  return values.sort((a, b) => ipToNumber(a) - ipToNumber(b));
}

function ipToNumber(ip) {
  return String(ip || "")
    .split(".")
    .reduce((sum, part) => (sum * 256) + Number(part || 0), 0);
}

async function apiGet(path) {
  return apiSend(path, { method: "GET" });
}

async function apiSend(path, options = {}) {
  const headers = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!response.ok) {
    let detail = `Request failed with ${response.status}`;
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch (_) {}
    throw new Error(Array.isArray(detail) ? detail.map((item) => item.msg).join(", ") : detail);
  }
  return response.json();
}

function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.hidden = true;
  }, 5000);
}

function modalConfirm({ title, message, confirmText = "Confirm", cancelText = "Cancel", tone = "default" } = {}) {
  return openModal({ title, message, confirmText, cancelText, tone, kind: "confirm" });
}

function modalPrompt({ title, message, label = "Value", defaultValue = "", confirmText = "Save", cancelText = "Cancel", tone = "default" } = {}) {
  return openModal({ title, message, label, defaultValue, confirmText, cancelText, tone, kind: "prompt" });
}

function openModal(options = {}) {
  return new Promise((resolve) => {
    const isPrompt = options.kind === "prompt";
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-window ${options.tone === "danger" ? "danger" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <h2 id="modal-title">${escapeHtml(options.title || "Confirm action")}</h2>
          <button class="modal-close" type="button" data-modal-cancel aria-label="Close">×</button>
        </div>
        ${options.message ? `<div class="modal-message">${escapeHtml(options.message)}</div>` : ""}
        ${
          isPrompt
            ? `<label class="modal-field"><span>${escapeHtml(options.label || "Value")}</span><input type="text" data-modal-input value="${escapeAttr(options.defaultValue || "")}" autocomplete="off" /></label>`
            : ""
        }
        <div class="modal-actions">
          <button class="button secondary" type="button" data-modal-cancel>${escapeHtml(options.cancelText || "Cancel")}</button>
          <button class="button ${options.tone === "danger" ? "danger" : ""}" type="button" data-modal-confirm>${escapeHtml(options.confirmText || "Confirm")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("[data-modal-input]");
    const confirmButton = overlay.querySelector("[data-modal-confirm]");
    const cancelButtons = overlay.querySelectorAll("[data-modal-cancel]");
    const close = (value) => {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") close(isPrompt ? null : false);
      if (event.key === "Enter" && isPrompt && document.activeElement === input) close(input.value);
    };
    confirmButton.addEventListener("click", () => close(isPrompt ? input.value : true));
    cancelButtons.forEach((button) => button.addEventListener("click", () => close(isPrompt ? null : false)));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(isPrompt ? null : false);
    });
    document.addEventListener("keydown", onKeydown);
    requestAnimationFrame(() => {
      if (input) {
        input.focus();
        input.select();
      } else {
        confirmButton.focus();
      }
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeSvg(value) {
  return escapeHtml(value);
}

function svgFitText(value, x, y, maxWidth, options = {}) {
  const fullText = String(value ?? "");
  const fontSize = Number(options.fontSize || 14);
  const minFontSize = Number(options.minFontSize || 10);
  const weight = options.weight || 800;
  const fill = options.fill || "#111827";
  const anchor = options.anchor || "start";
  const display = fitSvgTextValue(fullText, maxWidth, fontSize, minFontSize);
  const fittedSize = fitSvgFontSize(display, maxWidth, fontSize, minFontSize);
  const title = fullText && fullText !== display ? `<title>${escapeSvg(fullText)}</title>` : "";
  const anchorAttr = anchor === "end" ? ` text-anchor="end"` : "";
  return `<text x="${x}" y="${y}" font-size="${fittedSize}" font-weight="${weight}" fill="${fill}"${anchorAttr}>${title}${escapeSvg(display)}</text>`;
}

function fitSvgTextValue(value, maxWidth, fontSize, minFontSize) {
  const text = String(value ?? "");
  if (estimatedSvgTextWidth(text, fontSize) <= maxWidth) return text;
  if (estimatedSvgTextWidth(text, minFontSize) <= maxWidth) return text;
  const charBudget = Math.max(4, Math.floor(maxWidth / (minFontSize * 0.62)) - 1);
  return truncateText(text, charBudget);
}

function fitSvgFontSize(value, maxWidth, fontSize, minFontSize) {
  let size = fontSize;
  while (size > minFontSize && estimatedSvgTextWidth(value, size) > maxWidth) {
    size -= 1;
  }
  return size;
}

function estimatedSvgTextWidth(value, fontSize) {
  return String(value ?? "").split("").reduce((width, char) => {
    if (char === " ") return width + fontSize * 0.32;
    if ("ilI.,:;|!".includes(char)) return width + fontSize * 0.32;
    if ("MW@#%&".includes(char)) return width + fontSize * 0.82;
    if ("0123456789./:-".includes(char)) return width + fontSize * 0.6;
    return width + fontSize * 0.56;
  }, 0);
}

function truncateText(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function slugify(value) {
  return String(value || "download")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "download";
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatBytes(value) {
  const size = Number(value || 0);
  const compact = (number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(number);
  if (size < 1024) return `${formatNumber(size)}B`;
  if (size < 1024 * 1024) return `${compact(size / 1024)}KB`;
  return `${compact(size / (1024 * 1024))}MB`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return date.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
