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
  visualizationLens: localStorage.getItem("visualizationLens") || "mapping",
  selectedRange: localStorage.getItem("selectedRange") || "",
  selectedSegment: localStorage.getItem("selectedSegment") || "",
  selectedIp: localStorage.getItem("selectedIp") || "",
  selectedMappingSegment: localStorage.getItem("selectedMappingSegment") || "",
  selectedMappingPolicy: localStorage.getItem("selectedMappingPolicy") || "",
  mappingSegmentScope: localStorage.getItem("mappingSegmentScope") || "all",
  hideUnmappedMappingPolicies: localStorage.getItem("hideUnmappedMappingPolicies") === "true",
  selectedPolicyConflictSegment: localStorage.getItem("selectedPolicyConflictSegment") || "",
  selectedPolicyConflictPolicy: localStorage.getItem("selectedPolicyConflictPolicy") || "",
  collapsedPolicySegments: readJsonStorage("collapsedPolicySegments", {}),
  collapsedPolicyRanges: readJsonStorage("collapsedPolicyRanges", {}),
  hiddenPolicyNonConflictRanges: readJsonStorage("hiddenPolicyNonConflictRanges", {}),
  hiddenMappingSegmentLinks: readJsonStorage("hiddenMappingSegmentLinks", {}),
  visualizationFilters: {
    mapping: localStorage.getItem("vizFilter:mapping") || "",
    ranges: localStorage.getItem("vizFilter:ranges") || "",
    segments: localStorage.getItem("vizFilter:segments") || "",
    ips: localStorage.getItem("vizFilter:ips") || "",
    policies: localStorage.getItem("vizFilter:policies") || "",
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
  const mapping = segmentPolicyMapping();
  const groups = rangeGroups();
  const segments = segmentGroups(groups);
  const ips = ipGroups(groups);
  const policyGroups = rangePolicyGroups(groups);
  if (!groups.length && !mapping.segments.length) {
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
  const lens = ["mapping", "ranges", "segments", "ips", "policies"].includes(state.visualizationLens) ? state.visualizationLens : "mapping";
  const lensTabs = [
    ["mapping", "Segments-Policies Map", mapping.segments.length],
    ["ranges", "Ranges", groups.length],
    ["segments", "Segments", segments.length],
    ["ips", "Live IPs", ips.length],
    ["policies", "Conflict Policies", policyGroups.length],
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
      ${lens === "mapping" ? renderSegmentPolicyMappingLens(mapping) : lens === "segments" ? renderSegmentLens(segments) : lens === "ips" ? renderIpLens(ips) : lens === "policies" ? renderPolicyConflictLens(policyGroups) : renderRangeLens(groups)}
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

function renderSegmentPolicyMappingLens(mapping) {
  const scopedSegments = scopeMappingSegments(mapping.segments || []);
  const filteredSegments = filterSegmentPolicyMappingSegments(scopedSegments, mapping);
  const selectedPolicy = findMappingPolicy(mapping, state.selectedMappingPolicy);
  const selectedSegment = findMappingSegment(mapping, state.selectedMappingSegment);
  const view = segmentPolicyMappingView(mapping, filteredSegments, selectedSegment, selectedPolicy);
  if (!view.segments.length && !view.policies.length) return renderLensNoMatches("mapping", scopedSegments.length);
  return `
    <div class="panel-head sub-panel-head">
      <div>
        <h2>Main Segments-Policies Mapping Tree</h2>
        <div class="muted">Whole segment hierarchy mapped to policy references. Red segments have conflicting ranges; green segments have no detected range conflict.</div>
      </div>
      ${view.focusLabel ? `<button class="button secondary" type="button" data-clear-mapping-focus>Clear focus</button>` : ""}
    </div>
    <div class="mapping-scope-bar">
      <span class="scope-label">Segments</span>
      ${[
        ["all", "All", mapping.summary?.segments || mapping.segments.length],
        ["conflicting", "Conflicting Segments", mapping.summary?.conflicting_segments || 0],
        ["clean", "Non-conflicting Segments", mapping.summary?.clean_segments || 0],
      ]
        .map(
          ([key, label, count]) => `
            <button class="scope-toggle ${state.mappingSegmentScope === key ? "active" : ""}" type="button" data-mapping-scope="${escapeAttr(key)}">
              ${escapeHtml(label)}
              <span>${formatNumber(count)}</span>
            </button>
          `
        )
        .join("")}
      <span class="scope-separator"></span>
      <span class="scope-label">Policies</span>
      <button class="scope-toggle ${state.hideUnmappedMappingPolicies ? "active warning" : ""}" type="button" data-toggle-unmapped-policies>
        ${state.hideUnmappedMappingPolicies ? "Show policies without segments" : "Hide policies without segments"}
        <span>${formatNumber(mapping.summary?.policies_without_segments || 0)}</span>
      </button>
    </div>
    <div class="range-investigation-grid mapping-lens-grid">
      <aside class="range-list">
        ${renderVisualizationFilter("mapping", "Filter segments or policies", "Search segment, hierarchy, policy, source, or range", mappingFilterOptions(mapping), filteredSegments.length, scopedSegments.length)}
        <div class="range-list-head">
          <strong>Segments</strong>
          <span class="pill">${formatNumber(filteredSegments.length)} of ${formatNumber(scopedSegments.length)}</span>
        </div>
        ${filteredSegments.slice(0, 80).map((segment) => mappingSegmentChoice(segment, selectedSegment?.key === segment.key)).join("")}
        ${filteredSegments.length > 80 ? `<div class="muted list-footnote">${formatNumber(filteredSegments.length - 80)} more segments hidden by the side list. They remain available in the graph and filter.</div>` : ""}
        <div class="range-list-head">
          <strong>Policies</strong>
          <span class="pill">${formatNumber(view.policies.length)}</span>
        </div>
        ${view.policies.slice(0, 60).map((policy) => mappingPolicyChoice(policy, selectedPolicy?.policy === policy.policy)).join("")}
        ${view.policies.length > 60 ? `<div class="muted list-footnote">${formatNumber(view.policies.length - 60)} more policies hidden by the side list. Use the filter to narrow the graph.</div>` : ""}
      </aside>
      <div class="range-detail">
        ${renderSegmentPolicyMappingDiagram(view)}
        ${renderSegmentPolicyMappingDetails(view)}
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

function renderPolicyConflictLens(groups) {
  if (!groups.length) return `<div class="panel-body"><div class="empty">No policy-backed range conflicts are currently detected.</div></div>`;
  const filteredGroups = filterPolicyRangeGroups(groups);
  const selectedRange = filteredGroups.some((group) => group.range === state.selectedRange) ? state.selectedRange : filteredGroups[0]?.range;
  const selected = filteredGroups.find((group) => group.range === selectedRange) || filteredGroups[0];
  if (!selected) return renderLensNoMatches("policies", groups.length);
  const view = policyConflictView(selected, groups);
  return `
    <div class="panel-head sub-panel-head">
      <div>
        <h2>Conflict Policies</h2>
        <div class="muted">Select a conflicting range, then click a segment to show policies using it or click a policy to show every segment it uses in this conflict.</div>
      </div>
      <button class="button secondary" type="button" data-download-range-png="${escapeAttr(selected.range)}">Download PNG</button>
    </div>
    <div class="range-investigation-grid policy-lens-grid">
      <aside class="range-list">
        ${renderVisualizationFilter("policies", "Filter conflict policies", "Search by range, segment, policy, or source", policyRangeFilterOptions(groups), filteredGroups.length, groups.length)}
        <div class="range-list-head">
          <strong>Ranges with policies</strong>
          <span class="pill">${formatNumber(filteredGroups.length)} of ${formatNumber(groups.length)}</span>
        </div>
        ${filteredGroups.map((group) => policyRangeChoiceButton(group, group.range === selected.range)).join("")}
      </aside>
      <div class="range-detail">
        ${renderPolicyConflictScopeBar(selected, view)}
        ${renderPolicyConflictVisualization(selected, view)}
        ${renderPolicyConflictDetails(selected, view)}
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
  const labels = { mapping: "segment-policy mappings", ranges: "ranges", segments: "segments", ips: "live IPs", policies: "policy-backed conflicts" };
  const options =
    lens === "mapping"
      ? mappingFilterOptions(segmentPolicyMapping())
      : lens === "segments"
      ? segmentFilterOptions(segmentGroups())
      : lens === "ips"
        ? ipFilterOptions(ipGroups())
        : lens === "policies"
          ? policyRangeFilterOptions(rangePolicyGroups())
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

function segmentPolicyMappingView(mapping, filteredSegments, selectedSegment, selectedPolicy) {
  const fullSegmentsByKey = new Map((mapping.segments || []).map((segment) => [segment.key, segment]));
  if (selectedPolicy) {
    const segments = (selectedPolicy.segments || []).map((segment) => fullSegmentsByKey.get(segment.key) || segment).filter(Boolean);
    return {
      focusType: "policy",
      focusLabel: `Policy selected: ${selectedPolicy.policy}`,
      segments: sortMappingSegments(segments),
      policies: [selectedPolicy],
      selectedSegment: null,
      selectedPolicy,
    };
  }
  if (selectedSegment) {
    const rootPath = normalizedPathText(selectedSegment.path);
    const segments = sortMappingSegments(
      (mapping.segments || []).filter((segment) => segment.key === selectedSegment.key || normalizedPathText(segment.path).startsWith(`${rootPath} /`))
    );
    return {
      focusType: "segment",
      focusLabel: `Segment selected: ${selectedSegment.name || "Unnamed segment"}`,
      segments,
      policies: policiesForMappingSegments(mapping, segments),
      selectedSegment,
      selectedPolicy: null,
    };
  }
  const segments = sortMappingSegments(filteredSegments);
  return {
    focusType: "",
    focusLabel: "",
    segments,
    policies: policiesForMappingSegments(mapping, segments, { includeUnmapped: state.mappingSegmentScope === "all" && !state.hideUnmappedMappingPolicies }),
    selectedSegment: null,
    selectedPolicy: null,
  };
}

function scopeMappingSegments(segments) {
  const scope = state.mappingSegmentScope || "all";
  if (scope === "conflicting") return segments.filter((segment) => segment.has_conflicts || segment.hasConflicts);
  if (scope === "clean") return segments.filter((segment) => !(segment.has_conflicts || segment.hasConflicts));
  return segments;
}

function filterSegmentPolicyMappingSegments(segments, mapping) {
  const query = normalizedSearch(state.visualizationFilters.mapping);
  if (!query) return segments;
  const policiesBySegment = mappingPoliciesBySegment(mapping);
  return segments.filter((segment) => normalizedSearch(mappingSegmentSearchText(segment, policiesBySegment.get(segment.key) || [])).includes(query));
}

function policiesForMappingSegments(mapping, segments, options = {}) {
  const keys = new Set(segments.map((segment) => segment.key));
  return (mapping.policies || [])
    .map((policy) => ({
      ...policy,
      segments: (policy.segments || []).filter((segment) => keys.has(segment.key)),
    }))
    .filter((policy) => policy.segments.length || (options.includeUnmapped && !Number(policy.segment_count || policy.segments?.length || 0)))
    .sort((a, b) => sortMappingPolicyRows(a, b));
}

function mappingPoliciesBySegment(mapping) {
  const output = new Map();
  (mapping.policies || []).forEach((policy) => {
    (policy.segments || []).forEach((segment) => {
      if (!output.has(segment.key)) output.set(segment.key, []);
      output.get(segment.key).push(policy);
    });
  });
  return output;
}

function mappingSegmentSearchText(segment = {}, policies = []) {
  return [
    segment.name,
    segment.path,
    ...(segment.ranges || []),
    ...(segment.conflicting_ranges || []),
    ...(segment.policy_references || []).flatMap((ref) => [ref.policy, ref.source]),
    ...policies.flatMap((policy) => [policy.policy, policy.folder, ...(policy.sources || [])]),
  ]
    .filter(Boolean)
    .join(" ");
}

function mappingFilterOptions(mapping) {
  return uniqueSorted([
    ...(mapping.segments || []).flatMap((segment) => [segment.name, segment.path, ...(segment.ranges || []), ...(segment.conflicting_ranges || [])]),
    ...(mapping.policies || []).flatMap((policy) => [policy.policy, policy.folder, ...(policy.sources || [])]),
  ]);
}

function mappingSegmentChoice(segment, active) {
  const conflict = segment.has_conflicts || segment.hasConflicts;
  return `
    <button class="range-choice mapping-choice ${active ? "active" : ""} ${conflict ? "conflict" : "clean"}" type="button" data-mapping-segment="${escapeAttr(segment.key)}">
      <strong>${escapeHtml(segment.name || "Unnamed segment")}</strong>
      <span>${escapeHtml(segment.path || "No hierarchy")}</span>
      <span>${formatNumber(segment.policy_reference_count || 0)} policies, ${formatNumber(segment.ranges?.length || 0)} ranges</span>
      <span class="${conflict ? "danger-text" : "good-text"}">${conflict ? `${formatNumber(segment.conflict_range_count || 0)} conflicting ranges` : "No range conflicts"}</span>
    </button>
  `;
}

function mappingPolicyChoice(policy, active) {
  const palette = mappingPolicyPalette(policy);
  return `
    <button class="range-choice mapping-choice policy-${escapeAttr(palette.state)} ${active ? "active" : ""}" type="button" data-mapping-policy="${escapeAttr(policy.policy || "Unnamed policy")}">
      <strong>${escapeHtml(policy.policy || "Unnamed policy")}</strong>
      <span>${escapeHtml(policyFolderDisplayLabel(policy))}</span>
      <span>${escapeHtml(palette.label)}</span>
    </button>
  `;
}

function areMappingSegmentLinksHidden(segmentKey) {
  return Boolean(segmentKey && state.hiddenMappingSegmentLinks?.[segmentKey]);
}

function renderSegmentPolicyMappingDiagram(view) {
  const segments = sortMappingSegments(view.segments || []);
  const policies = sortMappingPoliciesForDiagram(view.policies || []);
  const segmentCount = Math.max(1, segments.length);
  const policyCount = Math.max(1, policies.length);
  const rowHeight = 72;
  const width = 2080;
  const height = Math.max(520, 150 + Math.max(segmentCount, policyCount) * rowHeight);
  const segmentX = 40;
  const segmentW = 620;
  const segmentH = 54;
  const policyX = 1180;
  const policyW = 650;
  const policyH = 58;
  const policyMaxIndent = 168;
  const segmentStartY = Math.max(110, Math.round((height - segmentCount * rowHeight) / 2));
  const policyStartY = Math.max(110, Math.round((height - policyCount * rowHeight) / 2));
  const segmentPositions = new Map();
  const policyPositions = new Map();
  const segmentLayout = segments.map((segment, index) => ({
    item: segment,
    index,
    y: segmentStartY + index * rowHeight,
    indent: Math.min(160, Math.max(0, Number(segment.depth || 0) * 24)),
    group: topSegmentGroupLabel(segment),
  }));
  const policyLayout = policies.map((policy, index) => ({
    item: policy,
    index,
    y: policyStartY + index * rowHeight,
    indent: policyFolderIndent(policy, policyMaxIndent),
    group: policyTopFolderGroupLabel(policy),
  }));

  const segmentRows = segmentLayout
    .map(({ item: segment, y, indent }) => {
      const centerY = y + segmentH / 2;
      const conflict = Boolean(segment.has_conflicts || segment.hasConflicts);
      const color = conflict ? "#b42318" : "#15803d";
      const fill = conflict ? "#fff1f2" : "#f0fdf4";
      const active = view.selectedSegment?.key === segment.key;
      const linksHidden = areMappingSegmentLinksHidden(segment.key);
      segmentPositions.set(segment.key, { x: segmentX + indent + segmentW, y: centerY, color });
      return `
        <g class="diagram-node-clickable" data-mapping-segment="${escapeAttr(segment.key)}">
          <rect x="${segmentX + indent}" y="${y}" width="${segmentW}" height="${segmentH}" rx="12" fill="${fill}" stroke="${active ? "#2563eb" : color}" stroke-width="${active ? 4 : 2}" />
          <rect x="${segmentX + indent}" y="${y}" width="8" height="${segmentH}" rx="4" fill="${color}" />
          ${svgFitText(segment.name || "Unnamed segment", segmentX + indent + 22, y + 22, segmentW - 285, { fontSize: 16, minFontSize: 10, weight: 850, fill: "#111827" })}
          ${svgFitText(segment.path || "No hierarchy", segmentX + indent + 22, y + 43, segmentW - 285, { fontSize: 11, minFontSize: 8, weight: 700, fill: "#64748b" })}
          ${svgFitText(`${conflict ? "CONFLICTING" : "CLEAN"} - ${formatNumber(segment.policy_reference_count || 0)} policies`, segmentX + indent + segmentW - 74, y + 23, 172, { fontSize: 11, minFontSize: 8, weight: 850, fill: linksHidden ? "#64748b" : color, anchor: "end" })}
          ${svgFitText(linksHidden ? "links hidden" : `${formatNumber(segment.ranges?.length || 0)} ranges`, segmentX + indent + segmentW - 74, y + 43, 172, { fontSize: 10, minFontSize: 8, weight: 750, fill: linksHidden ? "#b45309" : "#64748b", anchor: "end" })}
          <g class="diagram-node-clickable" data-toggle-mapping-segment-links="${escapeAttr(segment.key)}">
            <rect x="${segmentX + indent + segmentW - 56}" y="${y + 14}" width="38" height="27" rx="13.5" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.7" />
            <text x="${segmentX + indent + segmentW - 37}" y="${y + 34}" text-anchor="middle" font-size="16" font-weight="950" fill="#1e3a8a">${linksHidden ? "+" : "-"}</text>
          </g>
        </g>
      `;
    })
    .join("");

  const policyRows = policyLayout
    .map(({ item: policy, y, indent }) => {
      const centerY = y + policyH / 2;
      const active = view.selectedPolicy?.policy === policy.policy;
      const x = policyX + indent;
      const palette = mappingPolicyPalette(policy);
      policyPositions.set(policy.policy, { x, y: centerY });
      return `
        <g class="diagram-node-clickable" data-mapping-policy="${escapeAttr(policy.policy || "Unnamed policy")}">
          <rect x="${x}" y="${y}" width="${policyW}" height="${policyH}" rx="12" fill="${palette.fill}" stroke="${active ? "#1d4ed8" : palette.stroke}" stroke-width="${active ? 4 : 2}" />
          <rect x="${x}" y="${y}" width="8" height="${policyH}" rx="4" fill="${palette.stroke}" />
          ${svgFitText(policy.policy || "Unnamed policy", x + 22, y + 24, policyW - 210, { fontSize: 16, minFontSize: 10, weight: 850, fill: "#111827" })}
          ${svgFitText(policyFolderDisplayLabel(policy), x + 22, y + 45, policyW - 210, { fontSize: 11, minFontSize: 8, weight: 700, fill: "#64748b" })}
          ${svgFitText(palette.shortLabel, x + policyW - 18, y + 24, 160, { fontSize: 11, minFontSize: 8, weight: 850, fill: palette.stroke, anchor: "end" })}
          ${svgFitText(`${formatNumber(policy.segments?.length || 0)} segments`, x + policyW - 18, y + 45, 160, { fontSize: 10, minFontSize: 8, weight: 750, fill: "#64748b", anchor: "end" })}
        </g>
      `;
    })
    .join("");

  const links = policies
    .flatMap((policy) =>
      (policy.segments || []).map((segment) => {
        if (areMappingSegmentLinksHidden(segment.key)) return "";
        const start = segmentPositions.get(segment.key);
        const end = policyPositions.get(policy.policy);
        if (!start || !end) return "";
        const highlighted = view.selectedSegment?.key === segment.key || view.selectedPolicy?.policy === policy.policy;
        return `<path d="M ${start.x} ${start.y} C ${start.x + 160} ${start.y}, ${end.x - 160} ${end.y}, ${end.x} ${end.y}" fill="none" stroke="${start.color}" stroke-width="${highlighted ? 3.8 : 1.6}" stroke-linecap="round" opacity="${highlighted ? 0.8 : 0.26}" />`;
      })
    )
    .join("");
  const segmentQuadrants = renderMappingQuadrants(segmentLayout, {
    x: segmentX - 18,
    width: segmentW + 214,
    rowHeight,
    nodeHeight: segmentH,
    fill: "#f8fafc",
    stroke: "#94a3b8",
    labelX: segmentX,
  });
  const policyQuadrants = renderMappingQuadrants(policyLayout, {
    x: policyX - 18,
    width: policyW + policyMaxIndent + 36,
    rowHeight,
    nodeHeight: policyH,
    fill: "#f8fafc",
    stroke: "#94a3b8",
    labelX: policyX,
  });

  return `
    <div class="range-diagram-card segment-policy-map-card">
      <div class="diagram-head">
        <div>
          <span class="eyebrow">Segments to policies hierarchy map</span>
          <strong>${escapeHtml(view.focusLabel || "All mapped segments")}</strong>
        </div>
        <div class="diagram-actions">
          <span class="muted">${formatNumber(segments.length)} segments, ${formatNumber(policies.length)} policies</span>
          <button class="icon-button" type="button" data-download-mapping-png title="Download mapping graph as PNG" aria-label="Download mapping graph as PNG">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
              <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
            </svg>
          </button>
        </div>
      </div>
      <div class="range-diagram-scroll">
        <svg class="range-diagram-svg segment-policy-map-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Full segment policy mapping tree">
          <rect width="${width}" height="${height}" fill="#ffffff" />
          <text x="${segmentX}" y="42" font-size="18" font-weight="850" fill="#64748b">SEGMENT HIERARCHY</text>
          <text x="${policyX}" y="42" font-size="18" font-weight="850" fill="#64748b">LINKED POLICIES</text>
          <text x="${segmentX}" y="72" font-size="13" font-weight="750" fill="#15803d">green = no conflicting ranges</text>
          <text x="${segmentX + 235}" y="72" font-size="13" font-weight="750" fill="#b42318">red = has conflicting ranges</text>
          ${segmentQuadrants}
          ${policyQuadrants}
          ${links}
          ${segmentRows || `<text x="${segmentX}" y="${Math.round(height / 2)}" font-size="18" font-weight="800" fill="#64748b">No segments match this view.</text>`}
          ${policyRows || `<text x="${policyX}" y="${Math.round(height / 2)}" font-size="18" font-weight="800" fill="#64748b">No linked policies for the displayed segments.</text>`}
        </svg>
      </div>
    </div>
  `;
}

function sortMappingPoliciesForDiagram(policies) {
  return [...(policies || [])].sort((a, b) => sortMappingPolicyRows(a, b));
}

function sortMappingPolicyRows(a, b) {
  return (
    policyTopFolderGroupLabel(a).localeCompare(policyTopFolderGroupLabel(b), undefined, { numeric: true, sensitivity: "base" }) ||
    policyFolderGroupLabel(a).localeCompare(policyFolderGroupLabel(b), undefined, { numeric: true, sensitivity: "base" }) ||
    mappingPolicySortWeight(a) - mappingPolicySortWeight(b) ||
    String(a.policy || "").localeCompare(String(b.policy || ""), undefined, { numeric: true, sensitivity: "base" })
  );
}

function mappingPolicySortWeight(policy = {}) {
  const stateName = mappingPolicyPalette(policy).state;
  if (stateName === "conflicting") return 0;
  if (stateName === "clean") return 1;
  return 2;
}

function topSegmentGroupLabel(segment = {}) {
  const parts = pathSegments(segment.path || "").filter(Boolean);
  return parts[1] || parts[0] || "Segments";
}

function policyFolderGroupLabel(policy = {}) {
  const parts = pathSegments(policy.folder || "").filter(Boolean);
  if (parts.length <= 1) return parts[0] || "Policy Folders";
  return parts.slice(1).join(" / ");
}

function policyFolderDisplayLabel(policy = {}) {
  const parts = pathSegments(policy.folder || "").filter(Boolean);
  if (!parts.length) return "No policy folder";
  return parts[0] === "Policy Folders" && parts.length > 1 ? parts.slice(1).join(" / ") : parts.join(" / ");
}

function policyTopFolderGroupLabel(policy = {}) {
  const parts = pathSegments(policy.folder || "").filter(Boolean);
  return parts[1] || parts[0] || "Policy Folders";
}

function policyFolderIndent(policy = {}, maxIndent = 168) {
  const parts = pathSegments(policy.folder || "").filter(Boolean);
  const depthBelowTopFolder = Math.max(0, parts.length - 2);
  return Math.min(maxIndent, depthBelowTopFolder * 28);
}

function mappingPolicyPalette(policy = {}) {
  const segmentCount = Number(policy.segment_count ?? policy.segments?.length ?? 0);
  const conflictingCount = Number(policy.conflicting_segment_count || 0);
  if (!segmentCount) {
    return {
      state: "unmapped",
      fill: "#fff7ed",
      stroke: "#ea580c",
      label: "No segment mapping",
      shortLabel: "No segments",
    };
  }
  if (conflictingCount) {
    return {
      state: "conflicting",
      fill: "#fff1f2",
      stroke: "#b42318",
      label: `${formatNumber(conflictingCount)} overlapping segment${conflictingCount === 1 ? "" : "s"}`,
      shortLabel: "Overlaps",
    };
  }
  return {
    state: "clean",
    fill: "#eff6ff",
    stroke: "#2563eb",
    label: `${formatNumber(segmentCount)} mapped segment${segmentCount === 1 ? "" : "s"}`,
    shortLabel: "Mapped",
  };
}

function renderMappingQuadrants(layout, options) {
  const groups = [];
  let current = null;
  layout.forEach((row) => {
    if (!current || current.label !== row.group) {
      current = { label: row.group || "Unfiled", startY: row.y, endY: row.y };
      groups.push(current);
    }
    current.endY = row.y;
  });
  return groups
    .map((group) => {
      const y = Math.max(80, group.startY - 34);
      const height = group.endY - group.startY + options.nodeHeight + 50;
      return `
        <g class="mapping-quadrant">
          <rect x="${options.x}" y="${y}" width="${options.width}" height="${height}" rx="18" fill="${options.fill}" stroke="${options.stroke}" stroke-width="1.4" stroke-dasharray="4 7" opacity="0.78" />
          ${svgFitText(group.label, options.labelX, y + 20, options.width - 40, { fontSize: 13, minFontSize: 9, weight: 850, fill: "#64748b" })}
        </g>
      `;
    })
    .join("");
}

function renderSegmentPolicyMappingDetails(view) {
  const focus = view.selectedSegment || view.selectedPolicy;
  if (!focus) {
    return `
      <div class="stage-summary">
        <strong>Use the map to focus the investigation.</strong>
        <span>Click a segment to keep its hierarchy branch and mapped policies, or click a policy to show the segments it uses.</span>
      </div>
    `;
  }
  if (view.selectedSegment) {
    return `
      <div class="range-row-list">
        <h3>Selected segment mapping</h3>
        <article class="range-row-card ${view.selectedSegment.has_conflicts ? "danger" : "good"}">
          <h4>${escapeHtml(view.selectedSegment.name || "Unnamed segment")}</h4>
          <p>${escapeHtml(view.selectedSegment.path || "No hierarchy")}</p>
          <div class="range-chip-list">
            <span class="pill ${view.selectedSegment.has_conflicts ? "danger" : "good"}">${view.selectedSegment.has_conflicts ? `${formatNumber(view.selectedSegment.conflict_range_count || 0)} conflicting ranges` : "No conflicting ranges"}</span>
            <span class="pill">${formatNumber(view.selectedSegment.policy_reference_count || 0)} policy references</span>
            <span class="pill">${formatNumber(view.selectedSegment.ranges?.length || 0)} configured ranges</span>
          </div>
        </article>
      </div>
    `;
  }
  return `
    <div class="range-row-list">
      <h3>Selected policy mapping</h3>
      <article class="range-row-card selected">
        <h4>${escapeHtml(view.selectedPolicy.policy || "Unnamed policy")}</h4>
        <p>${escapeHtml(view.selectedPolicy.folder || "No policy folder")}</p>
        <div class="range-chip-list">
          <span class="pill">${formatNumber(view.selectedPolicy.segments?.length || 0)} mapped segments</span>
          <span class="pill danger">${formatNumber(view.selectedPolicy.conflicting_segment_count || 0)} conflicting segments</span>
        </div>
      </article>
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

function filterPolicyRangeGroups(groups) {
  const query = normalizedSearch(state.visualizationFilters.policies);
  if (!query) return groups;
  return groups.filter((group) => normalizedSearch(policyRangeSearchText(group)).includes(query));
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

function policyRangeSearchText(group = {}) {
  return [
    group.range,
    ...(group.stageLabels || []),
    ...(group.segments || []).flatMap((segment) => [segment.name, segment.path]),
    ...(group.policies || []).flatMap((policy) => [policy.policy, ...(policy.sources || []), ...(policy.segments || []).flatMap((segment) => [segment.name, segment.path])]),
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

function policyRangeFilterOptions(groups) {
  return uniqueSorted(groups.flatMap((group) => [group.range, ...(group.policies || []).map((policy) => policy.policy), ...(group.segments || []).map((segment) => segment.name)]));
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

function policyRangeChoiceButton(group, active) {
  return `
    <button class="range-choice ${active ? "active" : ""}" type="button" data-range-select="${escapeAttr(group.range)}">
      <strong>${escapeHtml(group.range)}</strong>
      <span>${formatNumber(group.segments.length)} segments, ${formatNumber(group.policies.length)} consolidated policies</span>
      <span class="${group.liveHostCount ? "danger-text" : "muted"}">${formatNumber(group.liveHostCount)} live hosts</span>
      <span class="category-strip">${categoryPills(group).join("")}</span>
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

function renderPolicyConflictScopeBar(group, view) {
  if (!view.scopeLabel) return "";
  return `
    <div class="stage-summary policy-scope-summary">
      <strong>${escapeHtml(view.scopeLabel)}</strong>
      <span>${escapeHtml(view.scopeDescription)}</span>
      <button class="link-button" type="button" data-clear-policy-conflict-scope>Clear selection</button>
    </div>
  `;
}

function policyConflictView(group, groups = rangePolicyGroups()) {
  const selectedPolicy = findPolicyAcrossGroups(state.selectedPolicyConflictPolicy, groups);
  if (selectedPolicy) {
    return {
      scopeType: "policy",
      scopePolicy: selectedPolicy.policy,
      scopeLabel: `Policy selected: ${selectedPolicy.policy}`,
      scopeDescription: `${formatNumber(selectedPolicy.segments.length)} segment${selectedPolicy.segments.length === 1 ? "" : "s"} assigned to this policy across ${formatNumber(selectedPolicy.ranges.length)} conflicting range${selectedPolicy.ranges.length === 1 ? "" : "s"}.`,
      segments: selectedPolicy.segments || [],
      policies: [selectedPolicy],
      ranges: selectedPolicy.ranges || [],
    };
  }

  const selectedSegmentView = buildPolicySegmentScope(state.selectedPolicyConflictSegment, groups);
  if (selectedSegmentView) {
    return selectedSegmentView;
  }

  return {
    scopeType: "",
    scopeLabel: "",
    scopeDescription: "",
    segments: group.segments || [],
    policies: visiblePoliciesForRange(group),
    ranges: [group],
  };
}

function visiblePoliciesForRange(group) {
  return (group.policies || [])
    .map((policy) => ({
      ...policy,
      segments: (policy.segments || []).filter((segment) => !isPolicySegmentCollapsed(segment.key)),
    }))
    .filter((policy) => policy.segments.length);
}

function isPolicySegmentCollapsed(segmentKey) {
  return Boolean(segmentKey && state.collapsedPolicySegments?.[segmentKey]);
}

function isPolicyRangeCollapsed(range) {
  return Boolean(range && state.collapsedPolicyRanges?.[range]);
}

function arePolicyNonConflictRangesHidden(segmentKey) {
  return Boolean(segmentKey && state.hiddenPolicyNonConflictRanges?.[segmentKey]);
}

function findPolicyAcrossGroups(policyName, groups) {
  if (!policyName) return null;
  const sources = new Set();
  const segmentsByKey = new Map();
  const ranges = [];
  groups.forEach((group) => {
    const policy = (group.policies || []).find((item) => item.policy === policyName);
    if (!policy) return;
    ranges.push({
      range: group.range,
      liveHostCount: group.liveHostCount || 0,
      ipCount: group.ipCount || 0,
      stageLabels: group.stageLabels || [],
      categories: group.categories || [],
      policy,
    });
    (policy.sources || []).forEach((source) => sources.add(source));
    (policy.segments || []).forEach((segment) => {
      if (!segmentsByKey.has(segment.key)) {
        segmentsByKey.set(segment.key, { ...segment, ranges: new Set(), conflictRanges: new Set(), policyReferences: [] });
      }
      const stored = segmentsByKey.get(segment.key);
      (segment.ranges || []).forEach((range) => stored.ranges.add(range));
      stored.conflictRanges.add(group.range);
      stored.policyReferences.push(...(segment.policyReferences || []));
    });
  });
  if (!ranges.length) return null;
  return {
    policy: policyName,
    sources: Array.from(sources).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })),
    ranges,
    segments: Array.from(segmentsByKey.values())
      .map((segment) => ({
        ...segment,
        ranges: Array.from(segment.ranges),
        conflictRanges: Array.from(segment.conflictRanges),
      }))
      .sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })),
  };
}

function buildPolicySegmentScope(segmentKey, groups) {
  if (!segmentKey) return null;
  let selectedSegment = null;
  const policiesByName = new Map();
  const ranges = [];
  const conflictRangeSet = new Set();

  groups.forEach((group) => {
    const segment = (group.segments || []).find((item) => item.key === segmentKey);
    if (!segment) return;
    selectedSegment = selectedSegment || segment;
    conflictRangeSet.add(group.range);
    const policies = (group.policies || []).filter((policy) => (policy.segments || []).some((item) => item.key === segmentKey));
    ranges.push({
      range: group.range,
      isConflict: true,
      liveHostCount: group.liveHostCount || 0,
      ipCount: group.ipCount || 0,
      stageLabels: group.stageLabels || [],
      categories: group.categories || [],
      segment,
      policies,
    });
    policies.forEach((policy) => {
      if (!policiesByName.has(policy.policy)) {
        policiesByName.set(policy.policy, {
          policy: policy.policy,
          sources: new Set(),
          ranges: [],
          segmentsByKey: new Map(),
        });
      }
      const stored = policiesByName.get(policy.policy);
      stored.ranges.push(group.range);
      (policy.sources || []).forEach((source) => stored.sources.add(source));
      (policy.segments || []).forEach((item) => {
        if (!stored.segmentsByKey.has(item.key)) stored.segmentsByKey.set(item.key, item);
      });
    });
  });

  if (!selectedSegment) return null;
  const additionalRanges = uniqueSorted([...(selectedSegment.allRanges || []), ...(selectedSegment.ranges || [])])
    .filter((range) => range && !conflictRangeSet.has(range))
    .map((range) => ({
      range,
      isConflict: false,
      liveHostCount: 0,
      ipCount: countIps(range),
      stageLabels: [],
      categories: [],
      segment: selectedSegment,
      policies: [],
    }));
  const policies = Array.from(policiesByName.values())
    .map((policy) => ({
      policy: policy.policy,
      sources: Array.from(policy.sources).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })),
      ranges: uniqueSorted(policy.ranges),
      segments: Array.from(policy.segmentsByKey.values()).sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })),
    }))
    .sort((a, b) => b.ranges.length - a.ranges.length || a.policy.localeCompare(b.policy, undefined, { numeric: true, sensitivity: "base" }));

  return {
    scopeType: "segment",
    scopeSegment: selectedSegment.key,
    scopeLabel: `Segment selected: ${selectedSegment.name || "Unnamed segment"}`,
    scopeDescription: `${formatNumber(ranges.length)} conflicting range${ranges.length === 1 ? "" : "s"} and ${formatNumber(policies.length)} USED polic${policies.length === 1 ? "y" : "ies"} map to this segment.`,
    selectedSegment,
    segments: [selectedSegment],
    policies,
    ranges: [...ranges, ...additionalRanges].sort((a, b) => Number(b.isConflict) - Number(a.isConflict) || b.liveHostCount - a.liveHostCount || a.range.localeCompare(b.range)),
  };
}

function renderPolicyConflictVisualization(group, view = policyConflictView(group)) {
  const conflictRangeCount = view.scopeType === "segment" ? (view.ranges || []).filter((item) => item.isConflict).length : view.ranges.length;
  const summary =
    view.scopeType === "segment"
      ? `${formatNumber(conflictRangeCount)} conflicting range${conflictRangeCount === 1 ? "" : "s"} and ${formatNumber(view.policies.length)} consolidated polic${view.policies.length === 1 ? "y" : "ies"} shown for this segment.`
      : `${formatNumber(view.policies.length)} consolidated polic${view.policies.length === 1 ? "y" : "ies"} shown for this conflict range.`;
  return `
    ${view.scopeType === "segment" ? renderPolicySegmentScopeDiagramSvg(group, view) : renderPolicyConflictDiagramSvg(group, view)}
    <div class="stage-summary">
      <strong>${summary}</strong>
      <span>Policies are consolidated across attached segments, so one policy using multiple segments in this overlap appears once with every matching segment listed beneath it.</span>
    </div>
  `;
}

function renderPolicySegmentScopeDiagramSvg(group, view) {
  const ranges = view.ranges || [];
  const conflictRanges = ranges.filter((item) => item.isConflict);
  const policies = view.policies || [];
  const rowHeight = 112;
  const width = 1760;
  const height = Math.max(480, 150 + Math.max(conflictRanges.length, policies.length) * rowHeight);
  const rangeX = 48;
  const rangeW = 360;
  const rangeH = 74;
  const segmentX = 615;
  const segmentW = 460;
  const segmentH = 104;
  const segmentY = Math.round(height / 2 - segmentH / 2);
  const policyX = 1248;
  const policyW = 500;
  const policyH = 74;
  const rangeStartY = Math.max(110, Math.round((height - conflictRanges.length * rowHeight) / 2));
  const policyStartY = Math.max(110, Math.round((height - policies.length * rowHeight) / 2));
  const segment = view.selectedSegment || view.segments?.[0] || {};
  const segmentColor = segment.used ? "#15803d" : "#b42318";
  const segmentFill = segment.used ? "#f0fdf4" : "#fff1f2";
  const segmentLeftX = segmentX;
  const segmentRightX = segmentX + segmentW;
  const segmentCenterY = segmentY + segmentH / 2;

  const rangeRows = conflictRanges
    .map((item, index) => {
      const y = rangeStartY + index * rowHeight;
      const centerY = y + rangeH / 2;
      const active = item.range === group.range;
      const live = Number(item.liveHostCount || 0) > 0;
      const color = live ? "#b42318" : "#2563eb";
      const fill = live ? "#fff1f2" : "#eff6ff";
      const meta = `conflict - ${formatNumber(item.liveHostCount || 0)} live hosts - ${formatNumber(item.policies?.length || 0)} policies`;
      return `
        <path d="M ${rangeX + rangeW} ${centerY} C ${rangeX + rangeW + 100} ${centerY}, ${segmentLeftX - 100} ${segmentCenterY}, ${segmentLeftX} ${segmentCenterY}" fill="none" stroke="${color}" stroke-width="${active ? 4 : 2.6}" stroke-linecap="round" opacity="${active ? 0.85 : 0.55}" />
        <g class="diagram-node-clickable" data-policy-scope-range="${escapeAttr(item.range)}">
          <rect x="${rangeX}" y="${y}" width="${rangeW}" height="${rangeH}" rx="14" fill="${fill}" stroke="${active ? "#2563eb" : color}" stroke-width="${active ? 4 : 2}" />
          ${svgFitText(item.range, rangeX + 20, y + 28, rangeW - 40, { fontSize: 17, minFontSize: 10, weight: 900, fill: "#111827" })}
          ${svgFitText(meta, rangeX + 20, y + 52, rangeW - 40, { fontSize: 12, minFontSize: 9, weight: 800, fill: live ? "#b42318" : "#64748b" })}
        </g>
      `;
    })
    .join("");

  const policyRows = policies
    .map((policy, index) => {
      const y = policyStartY + index * rowHeight;
      const centerY = y + policyH / 2;
      const active = policy.policy === state.selectedPolicyConflictPolicy;
      return `
        <path d="M ${segmentRightX} ${segmentCenterY} C ${segmentRightX + 100} ${segmentCenterY}, ${policyX - 100} ${centerY}, ${policyX} ${centerY}" fill="none" stroke="#2563eb" stroke-width="${active ? 4 : 2.5}" stroke-linecap="round" opacity="${active ? 0.85 : 0.58}" />
        <g class="diagram-node-clickable" data-policy-scope-policy="${escapeAttr(policy.policy || "Unnamed policy")}">
          <rect x="${policyX}" y="${y}" width="${policyW}" height="${policyH}" rx="14" fill="#eff6ff" stroke="#2563eb" stroke-width="${active ? 4 : 2}" />
          <rect x="${policyX}" y="${y}" width="9" height="${policyH}" rx="4" fill="#2563eb" />
          ${svgFitText(policy.policy || "Unnamed policy", policyX + 24, y + 28, policyW - 48, { fontSize: 17, minFontSize: 10, weight: 850, fill: "#111827" })}
          ${svgFitText(`${formatNumber(policy.ranges?.length || 0)} conflicting ranges, ${formatNumber(policy.sources?.length || 0)} sources`, policyX + 24, y + 52, policyW - 48, { fontSize: 12, minFontSize: 9, weight: 750, fill: "#64748b" })}
        </g>
      `;
    })
    .join("");

  return `
    <div class="range-diagram-card">
      <div class="diagram-head">
        <div>
          <span class="eyebrow">Segment policy conflict diagram</span>
          <strong>${escapeHtml(segment.name || "Unnamed segment")}</strong>
        </div>
        <span class="muted">${formatNumber(conflictRanges.length)} conflict ranges, ${formatNumber(policies.length)} policies</span>
      </div>
      <div class="range-diagram-scroll">
        <svg class="range-diagram-svg policy-diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Segment conflict policy diagram">
          <rect width="${width}" height="${height}" fill="#ffffff" />
          <text x="${rangeX}" y="42" font-size="18" font-weight="800" fill="#64748b">CONFLICTING RANGES</text>
          <text x="${segmentX}" y="42" font-size="18" font-weight="800" fill="#64748b">SELECTED SEGMENT</text>
          <text x="${policyX}" y="42" font-size="18" font-weight="800" fill="#64748b">POLICIES USING SEGMENT</text>
          ${rangeRows}
          <g class="diagram-node-clickable" data-policy-scope-segment="${escapeAttr(segment.key || "")}">
            <rect x="${segmentX}" y="${segmentY}" width="${segmentW}" height="${segmentH}" rx="16" fill="${segmentFill}" stroke="${segmentColor}" stroke-width="4" />
            <rect x="${segmentX}" y="${segmentY}" width="10" height="${segmentH}" rx="5" fill="${segmentColor}" />
            ${svgFitText(segment.name || "Unnamed segment", segmentX + 26, segmentY + 34, segmentW - 52, { fontSize: 22, minFontSize: 12, weight: 900, fill: "#111827" })}
            ${svgFitText(segmentParent(segment.path) || segment.path || "No parent", segmentX + 26, segmentY + 62, segmentW - 52, { fontSize: 14, minFontSize: 10, weight: 750, fill: "#64748b" })}
            ${svgFitText(segmentUsageLabel(segment), segmentX + 26, segmentY + 88, segmentW - 52, { fontSize: 14, minFontSize: 10, weight: 850, fill: segmentColor })}
          </g>
          ${policyRows || `<text x="${policyX}" y="${Math.round(height / 2)}" font-size="18" font-weight="800" fill="#64748b">No policy references recorded.</text>`}
        </svg>
      </div>
    </div>
  `;
}

function renderPolicyConflictDiagramSvg(group, view = policyConflictView(group)) {
  const policies = view.policies || [];
  const segments = view.segments || [];
  const segmentCount = Math.max(1, segments.length);
  const policyCount = Math.max(1, policies.length);
  const rowHeight = 118;
  const width = 1760;
  const height = Math.max(480, 150 + Math.max(segmentCount, policyCount) * rowHeight);
  const rangeX = 48;
  const rangeW = 310;
  const rangeH = 112;
  const rangeY = Math.round(height / 2 - rangeH / 2);
  const segmentX = 520;
  const segmentW = 410;
  const segmentH = 92;
  const policyX = 1120;
  const policyW = 570;
  const policyH = 78;
  const rangeCenterX = rangeX + rangeW;
  const rangeCenterY = rangeY + rangeH / 2;
  const segmentStartY = Math.max(114, Math.round((height - segments.length * rowHeight) / 2));
  const policyStartY = Math.max(114, Math.round((height - policies.length * rowHeight) / 2));
  const segmentPositions = new Map();
  const segmentRows = segments
    .map((segment, index) => {
      const y = segmentStartY + index * rowHeight;
      const centerY = y + segmentH / 2;
      const color = segment.used ? "#15803d" : "#b42318";
      const fill = segment.used ? "#f0fdf4" : "#fff1f2";
      const active = view.scopeSegment === segment.key;
      const collapsed = isPolicySegmentCollapsed(segment.key);
      const policyCount = segmentPolicyCount(segment);
      segmentPositions.set(segment.key, { x: segmentX + segmentW, y: centerY, segment });
      return `
        <path d="M ${rangeCenterX} ${rangeCenterY} C ${rangeCenterX + 105} ${rangeCenterY}, ${segmentX - 105} ${centerY}, ${segmentX} ${centerY}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="0.65" />
        <g class="diagram-node-clickable" data-policy-scope-segment="${escapeAttr(segment.key)}">
          <rect x="${segmentX}" y="${y}" width="${segmentW}" height="${segmentH}" rx="14" fill="${collapsed ? "#f8fafc" : fill}" stroke="${active ? "#2563eb" : color}" stroke-width="${active ? 4 : 2}" opacity="${collapsed ? 0.82 : 1}" />
          <rect x="${segmentX}" y="${y}" width="9" height="${segmentH}" rx="4" fill="${color}" />
          ${svgFitText(segment.name || "Unnamed segment", segmentX + 24, y + 27, segmentW - 156, { fontSize: 19, minFontSize: 11, weight: 850, fill: "#111827" })}
          ${svgFitText(segmentParent(segment.path) || segment.path || "No parent", segmentX + 24, y + 51, segmentW - 156, { fontSize: 13, minFontSize: 9, weight: 750, fill: "#64748b" })}
          ${svgFitText(categoryPillsText(segment), segmentX + 24, y + 74, segmentW - 156, { fontSize: 11, minFontSize: 8, weight: 800, fill: "#64748b" })}
          ${svgFitText(segmentUsageLabel(segment), segmentX + segmentW - 20, y + 27, 132, { fontSize: 11, minFontSize: 8, weight: 850, fill: color, anchor: "end" })}
          <g class="diagram-node-clickable" data-toggle-policy-segment="${escapeAttr(segment.key)}">
            <rect x="${segmentX + segmentW - 78}" y="${y + 50}" width="58" height="28" rx="14" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.8" />
            <text x="${segmentX + segmentW - 49}" y="${y + 70}" text-anchor="middle" font-size="16" font-weight="950" fill="#1e3a8a">${collapsed ? "+" : "-"}</text>
          </g>
          ${collapsed ? svgFitText(`${formatNumber(policyCount)} policies hidden`, segmentX + 24, y + segmentH - 9, segmentW - 156, { fontSize: 11, minFontSize: 8, weight: 800, fill: "#64748b" }) : ""}
        </g>
      `;
    })
    .join("");
  const policyRows = policies
    .map((policy, index) => {
      const y = policyStartY + index * rowHeight;
      const centerY = y + policyH / 2;
      const inbound = (policy.segments || [])
        .map((segment) => {
          const start = segmentPositions.get(segment.key);
          if (!start) return "";
          const color = segment.used ? "#15803d" : "#b42318";
          return `<path d="M ${start.x} ${start.y} C ${start.x + 100} ${start.y}, ${policyX - 100} ${centerY}, ${policyX} ${centerY}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="0.55" />`;
        })
        .join("");
      const active = view.scopePolicy === policy.policy;
      return `
        ${inbound}
        <g class="diagram-node-clickable" data-policy-scope-policy="${escapeAttr(policy.policy || "Unnamed policy")}">
          <rect x="${policyX}" y="${y}" width="${policyW}" height="${policyH}" rx="14" fill="#eff6ff" stroke="#2563eb" stroke-width="${active ? 4 : 2}" />
          <rect x="${policyX}" y="${y}" width="9" height="${policyH}" rx="4" fill="#2563eb" />
          ${svgFitText(policy.policy || "Unnamed policy", policyX + 24, y + 28, policyW - 205, { fontSize: 18, minFontSize: 10, weight: 850, fill: "#111827" })}
          ${svgFitText(`${formatNumber(policy.segments.length)} segments: ${policy.segments.map((segment) => segment.name).join(", ")}`, policyX + 24, y + 52, policyW - 46, { fontSize: 13, minFontSize: 9, weight: 750, fill: "#64748b" })}
          ${svgFitText(`${formatNumber(policy.sources.length)} source${policy.sources.length === 1 ? "" : "s"}`, policyX + policyW - 22, y + 29, 150, { fontSize: 12, minFontSize: 9, weight: 850, fill: "#2563eb", anchor: "end" })}
        </g>
      `;
    })
    .join("");
  return `
    <div class="range-diagram-card">
      <div class="diagram-head">
        <div>
          <span class="eyebrow">Conflict policy diagram</span>
          <strong>${escapeHtml(group.range)}</strong>
        </div>
        <span class="muted">${formatNumber(view.segments.length)} of ${formatNumber(group.segments.length)} segments, ${formatNumber(view.policies.length)} of ${formatNumber(group.policies.length)} policies</span>
      </div>
      <div class="range-diagram-scroll">
        <svg class="range-diagram-svg policy-diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Range conflict policy diagram">
          <rect width="${width}" height="${height}" fill="#ffffff" />
          <text x="${rangeX}" y="42" font-size="18" font-weight="800" fill="#64748b">CONFLICTING RANGE</text>
          <text x="${segmentX}" y="42" font-size="18" font-weight="800" fill="#64748b">${view.scopeType === "policy" ? "SEGMENTS USED BY POLICY" : "ATTACHED SEGMENTS"}</text>
          <text x="${policyX}" y="42" font-size="18" font-weight="800" fill="#64748b">${view.scopeType === "segment" ? "POLICIES USING SEGMENT" : "CONSOLIDATED POLICIES IN USE"}</text>
          <g class="diagram-node-clickable" data-policy-scope-range="${escapeAttr(group.range)}">
            <rect x="${rangeX}" y="${rangeY}" width="${rangeW}" height="${rangeH}" rx="16" fill="${group.liveHostCount ? "#fff1f2" : "#eff6ff"}" stroke="${group.liveHostCount ? "#b42318" : "#2563eb"}" stroke-width="3" />
            ${svgFitText(group.range, rangeX + 22, rangeY + 38, rangeW - 44, { fontSize: 23, minFontSize: 13, weight: 900, fill: "#111827" })}
            ${svgFitText(`${formatNumber(group.ipCount || 0)} IPs in range`, rangeX + 22, rangeY + 68, rangeW - 44, { fontSize: 15, minFontSize: 10, weight: 800, fill: "#64748b" })}
            ${svgFitText(`${formatNumber(group.liveHostCount || 0)} live hosts`, rangeX + 22, rangeY + 92, rangeW - 44, { fontSize: 15, minFontSize: 10, weight: 850, fill: group.liveHostCount ? "#b42318" : "#15803d" })}
          </g>
          ${segmentRows}
          ${policyRows || `<text x="${policyX}" y="${Math.round(height / 2)}" font-size="18" font-weight="800" fill="#64748b">No direct policy references recorded.</text>`}
        </svg>
      </div>
    </div>
  `;
}

function renderPolicyConflictDetails(group, view = policyConflictView(group)) {
  if (view.scopeType === "segment") return renderPolicySegmentScopeDetails(view);
  const heading =
    view.scopeType === "policy"
        ? "Segments assigned to selected policy"
        : "Consolidated policy usage for this conflict";
  return `
    <div class="range-row-list">
      <h3>${escapeHtml(heading)}</h3>
      ${view.scopeType ? "" : renderPolicySegmentGroups(group)}
      ${
        view.policies.length
          ? view.policies
              .map(
                (policy) => `
                  <article class="range-row-card ${view.scopePolicy === policy.policy ? "selected" : ""}">
                    <div class="range-row-stage">
                      <span class="pill good">${formatNumber(policy.segments.length)} segment${policy.segments.length === 1 ? "" : "s"}</span>
                      <span class="pill">${formatNumber(policy.sources.length)} source${policy.sources.length === 1 ? "" : "s"}</span>
                      <button class="link-button" type="button" data-policy-scope-policy="${escapeAttr(policy.policy || "Unnamed policy")}">Show policy segments</button>
                    </div>
                    <h4>${escapeHtml(policy.policy || "Unnamed policy")}</h4>
                    <div class="range-chip-list">${policy.sources.map((source) => `<span class="pill">${escapeHtml(source)}</span>`).join("")}</div>
                    <div class="segment-visual-grid compact">
                      ${policy.segments
                        .map(
                          (segment) => `
                            <div class="range-segment-card clickable-card ${segment.used ? "used" : "unused"} ${view.scopeSegment === segment.key ? "selected" : ""}" data-policy-scope-segment="${escapeAttr(segment.key || "")}">
                              <div class="segment-title">${escapeHtml(segment.name || "Unnamed segment")}</div>
                              <div class="muted">${escapeHtml(segment.path || "No hierarchy")}</div>
                              <div class="range-chip-list">
                                <span class="pill ${segment.used ? "good" : "danger"}">${escapeHtml(segmentUsageLabel(segment))}</span>
                                ${segment.ranges.map((range) => rangeLink(range, range, "pill")).join("")}
                              </div>
                            </div>
                          `
                        )
                        .join("")}
                    </div>
                  </article>
                `
              )
              .join("")
          : `<div class="empty">No policies were found for this selection.</div>`
      }
    </div>
  `;
}

function renderPolicySegmentGroups(group) {
  return `
    <div class="policy-segment-groups">
      ${(group.segments || [])
        .map((segment) => {
          const collapsed = isPolicySegmentCollapsed(segment.key);
          const policies = (group.policies || []).filter((policy) => (policy.segments || []).some((item) => item.key === segment.key));
          return `
            <article class="policy-segment-group ${segment.used ? "used" : "unused"} ${collapsed ? "collapsed" : ""}">
              <div class="policy-segment-group-head">
                <button class="mini-toggle" type="button" data-toggle-policy-segment="${escapeAttr(segment.key || "")}" title="${collapsed ? "Expand segment policies" : "Collapse segment policies"}">${collapsed ? "+" : "-"}</button>
                <button class="link-button segment-group-title" type="button" data-policy-scope-segment="${escapeAttr(segment.key || "")}">${escapeHtml(segment.name || "Unnamed segment")}</button>
                <span class="pill ${segment.used ? "good" : "danger"}">${escapeHtml(segmentUsageLabel(segment))}</span>
                <span class="pill">${formatNumber(policies.length)} polic${policies.length === 1 ? "y" : "ies"} in this range</span>
              </div>
              <div class="muted">${escapeHtml(segment.path || "No hierarchy")}</div>
              ${
                collapsed
                  ? `<div class="muted">Policies hidden for this segment.</div>`
                  : `<div class="policy-ref-list">${policies.length ? policies.map((policy) => `<span>${escapeHtml(policy.policy || "Unnamed policy")} <em>${formatNumber(policy.sources?.length || 0)} sources</em></span>`).join("") : `<span>No policy references recorded.</span>`}</div>`
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPolicySegmentScopeDetails(view) {
  const conflictRanges = (view.ranges || []).filter((item) => item.isConflict);
  const nonConflictRanges = (view.ranges || []).filter((item) => !item.isConflict);
  const nonConflictHidden = arePolicyNonConflictRangesHidden(view.scopeSegment);
  return `
    <div class="range-row-list">
      <h3>Conflicting ranges and USED policies for selected segment</h3>
      <div class="segment-visual-grid compact">
        ${conflictRanges
          .map(
            (item) => {
              const collapsed = isPolicyRangeCollapsed(item.range);
              return `
              <article class="range-segment-card ${item.range === state.selectedRange ? "selected" : ""} ${item.isConflict ? "conflict-range-card" : "nonconflict-range-card"}">
                <div class="range-row-stage">
                  <button class="pill clickable-range" type="button" data-policy-scope-range="${escapeAttr(item.range)}"><strong>${escapeHtml(item.range)}</strong></button>
                  <span class="pill danger">conflicting range</span>
                  <span class="pill ${item.liveHostCount ? "danger" : "good"}">${formatNumber(item.liveHostCount || 0)} live hosts</span>
                  <button class="link-button" type="button" data-toggle-policy-range="${escapeAttr(item.range)}">${collapsed ? "Expand" : "Collapse"}</button>
                  ${(item.stageLabels || []).map((label) => `<span class="pill">${escapeHtml(label)}</span>`).join("")}
                </div>
                <div class="muted">${formatNumber(item.ipCount || 0)} IPs in ${item.isConflict ? "conflicting" : "configured"} range</div>
                ${
                  collapsed
                    ? `<div class="muted">Range details hidden.</div>`
                    : `<div class="policy-ref-list">
                        ${(item.policies || []).length ? item.policies.map((policy) => `<span>${escapeHtml(policy.policy || "Unnamed policy")} <em>${formatNumber(policy.sources?.length || 0)} sources</em></span>`).join("") : `<span>No policy references for this range.</span>`}
                      </div>`
                }
              </article>
            `;
            }
          )
          .join("")}
        ${
          nonConflictRanges.length
            ? `<article class="range-segment-card nonconflict-range-card">
                <div class="range-row-stage">
                  <button class="mini-toggle" type="button" data-toggle-policy-nonconflict-ranges="${escapeAttr(view.scopeSegment)}">${nonConflictHidden ? "+" : "-"}</button>
                  <strong>${formatNumber(nonConflictRanges.length)} other non-conflicting range${nonConflictRanges.length === 1 ? "" : "s"}</strong>
                  <span class="pill">${formatNumber(nonConflictRanges.reduce((sum, item) => sum + Number(item.ipCount || 0), 0))} IPs across ranges</span>
                  <button class="link-button" type="button" data-toggle-policy-nonconflict-ranges="${escapeAttr(view.scopeSegment)}">${nonConflictHidden ? "Show group" : "Hide group"}</button>
                </div>
                <div class="muted">These ranges belong to the selected segment but are not part of the active conflict list.</div>
                ${
                  nonConflictHidden
                    ? `<div class="muted">Non-conflicting ranges hidden.</div>`
                    : `<div class="range-chip-list">${nonConflictRanges.map((item) => `<span class="pill">${escapeHtml(item.range)} <em>${formatNumber(item.ipCount || 0)} IPs</em></span>`).join("")}</div>`
                }
              </article>`
            : ""
        }
      </div>
      <h3>Consolidated policies mapped to this segment</h3>
      ${
        (view.policies || []).length
          ? view.policies
              .map(
                (policy) => `
                  <article class="range-row-card ${view.scopePolicy === policy.policy ? "selected" : ""}">
                    <div class="range-row-stage">
                      <span class="pill good">${formatNumber(policy.ranges?.length || 0)} conflicting range${(policy.ranges?.length || 0) === 1 ? "" : "s"}</span>
                      <span class="pill">${formatNumber(policy.sources?.length || 0)} source${(policy.sources?.length || 0) === 1 ? "" : "s"}</span>
                      <button class="link-button" type="button" data-policy-scope-policy="${escapeAttr(policy.policy || "Unnamed policy")}">Show policy segments</button>
                    </div>
                    <h4>${escapeHtml(policy.policy || "Unnamed policy")}</h4>
                    <div class="range-chip-list">
                      ${(policy.ranges || []).map((range) => `<button class="pill clickable-range" type="button" data-policy-scope-range="${escapeAttr(range)}"><strong>${escapeHtml(range)}</strong></button>`).join("")}
                    </div>
                    <div class="range-chip-list">${(policy.sources || []).map((source) => `<span class="pill">${escapeHtml(source)}</span>`).join("")}</div>
                  </article>
                `
              )
              .join("")
          : `<div class="empty">No policies were found for this segment.</div>`
      }
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
          ${svgFitText(segmentUsageLabel(segment), segmentX + segmentW - 24, y + 28, 140, { fontSize: 12, minFontSize: 8, weight: 800, fill: color, anchor: "end" })}
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
        <span class="pill ${segment.used ? "good" : "danger"}">${escapeHtml(segmentUsageLabel(segment))}</span>
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
              ${svgFitText(segmentUsageLabel(other), otherX + otherW - 22, y + 26, 132, { fontSize: 11, minFontSize: 8, weight: 850, fill: otherColor, anchor: "end" })}
              ${svgFitText(categoryPillsText(other), otherX + otherW - 22, y + 48, 110, { fontSize: 11, minFontSize: 8, weight: 800, fill: "#64748b", anchor: "end" })}
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
            ${svgFitText(segmentUsageLabel(segment), segmentX + 26, segmentY + 95, segmentW - 170, { fontSize: 15, minFontSize: 9, weight: 850, fill: selectedColor })}
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
              ${svgFitText(segmentUsageLabel(segment), segmentX + segmentW - 22, y + 26, 132, { fontSize: 11, minFontSize: 8, weight: 850, fill: color, anchor: "end" })}
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
        <span class="pill ${segment.used ? "good" : "danger"}">${escapeHtml(segmentUsageLabel(segment))}</span>
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
        <span class="pill ${segment.used ? "good" : "danger"}">${escapeHtml(segmentUsageLabel(segment))}</span>
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
        <span class="pill ${segment.used ? "good" : "danger"}">${escapeHtml(segmentUsageLabel(segment))}</span>
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
                  (row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.path)}</td><td>${escapeHtml(segmentUsageLabel(row))}${row.used ? " - review manually" : ""}</td><td>${formatNumber(row.child_count || 0)}</td></tr>`
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
      state.visualizationLens = button.dataset.vizLens || "mapping";
      localStorage.setItem("visualizationLens", state.visualizationLens);
      render();
    });
  });
  root.querySelectorAll("[data-mapping-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mappingSegmentScope = button.dataset.mappingScope || "all";
      state.selectedMappingSegment = "";
      state.selectedMappingPolicy = "";
      localStorage.setItem("mappingSegmentScope", state.mappingSegmentScope);
      localStorage.removeItem("selectedMappingSegment");
      localStorage.removeItem("selectedMappingPolicy");
      render();
    });
  });
  root.querySelectorAll("[data-toggle-unmapped-policies]").forEach((button) => {
    button.addEventListener("click", () => {
      state.hideUnmappedMappingPolicies = !state.hideUnmappedMappingPolicies;
      localStorage.setItem("hideUnmappedMappingPolicies", String(state.hideUnmappedMappingPolicies));
      if (state.hideUnmappedMappingPolicies) {
        const selected = findMappingPolicy(segmentPolicyMapping(), state.selectedMappingPolicy);
        if (selected && !Number(selected.segment_count || selected.segments?.length || 0)) {
          state.selectedMappingPolicy = "";
          localStorage.removeItem("selectedMappingPolicy");
        }
      }
      render();
    });
  });
  root.querySelectorAll("[data-mapping-segment]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedMappingSegment = button.dataset.mappingSegment || "";
      state.selectedMappingPolicy = "";
      localStorage.setItem("selectedMappingSegment", state.selectedMappingSegment);
      localStorage.removeItem("selectedMappingPolicy");
      render();
    });
  });
  root.querySelectorAll("[data-toggle-mapping-segment-links]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMappingSegmentLinks(button.dataset.toggleMappingSegmentLinks || "");
    });
  });
  root.querySelectorAll("[data-mapping-policy]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedMappingPolicy = button.dataset.mappingPolicy || "";
      state.selectedMappingSegment = "";
      localStorage.setItem("selectedMappingPolicy", state.selectedMappingPolicy);
      localStorage.removeItem("selectedMappingSegment");
      render();
    });
  });
  root.querySelectorAll("[data-clear-mapping-focus]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMappingSegment = "";
      state.selectedMappingPolicy = "";
      localStorage.removeItem("selectedMappingSegment");
      localStorage.removeItem("selectedMappingPolicy");
      render();
    });
  });
  root.querySelectorAll("[data-range-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRange = button.dataset.rangeSelect || "";
      state.selectedPolicyConflictSegment = "";
      state.selectedPolicyConflictPolicy = "";
      localStorage.setItem("selectedRange", state.selectedRange);
      localStorage.removeItem("selectedPolicyConflictSegment");
      localStorage.removeItem("selectedPolicyConflictPolicy");
      render();
    });
  });
  root.querySelectorAll("[data-policy-scope-segment]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedPolicyConflictSegment = button.dataset.policyScopeSegment || "";
      state.selectedPolicyConflictPolicy = "";
      localStorage.setItem("selectedPolicyConflictSegment", state.selectedPolicyConflictSegment);
      localStorage.removeItem("selectedPolicyConflictPolicy");
      render();
    });
  });
  root.querySelectorAll("[data-toggle-policy-segment]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePolicySegment(button.dataset.togglePolicySegment || "");
    });
  });
  root.querySelectorAll("[data-policy-scope-range]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedRange = button.dataset.policyScopeRange || "";
      state.selectedPolicyConflictSegment = "";
      state.selectedPolicyConflictPolicy = "";
      localStorage.setItem("selectedRange", state.selectedRange);
      localStorage.removeItem("selectedPolicyConflictSegment");
      localStorage.removeItem("selectedPolicyConflictPolicy");
      render();
    });
  });
  root.querySelectorAll("[data-toggle-policy-range]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePolicyRange(button.dataset.togglePolicyRange || "");
    });
  });
  root.querySelectorAll("[data-toggle-policy-nonconflict-ranges]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePolicyNonConflictRanges(button.dataset.togglePolicyNonconflictRanges || "");
    });
  });
  root.querySelectorAll("[data-policy-scope-policy]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedPolicyConflictPolicy = button.dataset.policyScopePolicy || "";
      state.selectedPolicyConflictSegment = "";
      localStorage.setItem("selectedPolicyConflictPolicy", state.selectedPolicyConflictPolicy);
      localStorage.removeItem("selectedPolicyConflictSegment");
      render();
    });
  });
  root.querySelectorAll("[data-clear-policy-conflict-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPolicyConflictSegment = "";
      state.selectedPolicyConflictPolicy = "";
      localStorage.removeItem("selectedPolicyConflictSegment");
      localStorage.removeItem("selectedPolicyConflictPolicy");
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
  root.querySelectorAll("[data-download-mapping-png]").forEach((button) => {
    button.addEventListener("click", () => downloadMappingPng());
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

function togglePolicySegment(segmentKey) {
  if (!segmentKey) return;
  state.collapsedPolicySegments = { ...(state.collapsedPolicySegments || {}) };
  if (state.collapsedPolicySegments[segmentKey]) delete state.collapsedPolicySegments[segmentKey];
  else state.collapsedPolicySegments[segmentKey] = true;
  localStorage.setItem("collapsedPolicySegments", JSON.stringify(state.collapsedPolicySegments));
  render();
}

function togglePolicyRange(range) {
  if (!range) return;
  state.collapsedPolicyRanges = { ...(state.collapsedPolicyRanges || {}) };
  if (state.collapsedPolicyRanges[range]) delete state.collapsedPolicyRanges[range];
  else state.collapsedPolicyRanges[range] = true;
  localStorage.setItem("collapsedPolicyRanges", JSON.stringify(state.collapsedPolicyRanges));
  render();
}

function togglePolicyNonConflictRanges(segmentKey) {
  if (!segmentKey) return;
  state.hiddenPolicyNonConflictRanges = { ...(state.hiddenPolicyNonConflictRanges || {}) };
  if (state.hiddenPolicyNonConflictRanges[segmentKey]) delete state.hiddenPolicyNonConflictRanges[segmentKey];
  else state.hiddenPolicyNonConflictRanges[segmentKey] = true;
  localStorage.setItem("hiddenPolicyNonConflictRanges", JSON.stringify(state.hiddenPolicyNonConflictRanges));
  render();
}

function toggleMappingSegmentLinks(segmentKey) {
  if (!segmentKey) return;
  state.hiddenMappingSegmentLinks = { ...(state.hiddenMappingSegmentLinks || {}) };
  if (state.hiddenMappingSegmentLinks[segmentKey]) delete state.hiddenMappingSegmentLinks[segmentKey];
  else state.hiddenMappingSegmentLinks[segmentKey] = true;
  localStorage.setItem("hiddenMappingSegmentLinks", JSON.stringify(state.hiddenMappingSegmentLinks));
  render();
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
  await downloadSvgAsPng(svg, `${slugify(`range-${selected}`)}.png`, "range diagram");
}

async function downloadMappingPng() {
  const svg = document.querySelector(".segment-policy-map-svg");
  if (!svg) return toast("No mapping graph is available to download.");
  const focus = state.selectedMappingSegment || state.selectedMappingPolicy || state.mappingSegmentScope || "all";
  await downloadSvgAsPng(svg, `${slugify(`segments-policies-map-${focus}`)}.png`, "mapping graph");
}

async function downloadSvgAsPng(svg, filename, label = "diagram") {
  const source = svgMarkupForExport(svg);
  const url = svgMarkupDataUrl(source);
  try {
    const image = await loadImage(url);
    const viewBox = svg.viewBox?.baseVal;
    const width = viewBox?.width || svg.clientWidth || 1400;
    const height = viewBox?.height || svg.clientHeight || 600;
    const scale = Math.max(1, Math.min(2, 16000 / Math.max(width, height)));
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
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    toast(`Unable to export ${label}: ${error.message}`);
  }
}

function svgMarkupForExport(svg) {
  let source = svg.outerHTML || "";
  if (!source.includes("xmlns=")) {
    source = source.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return source;
}

function svgMarkupDataUrl(svgMarkup) {
  return `data:image/svg+xml;charset=utf-8,${percentEncodeUtf8(svgMarkup)}`;
}

function percentEncodeUtf8(value) {
  const bytes = [];
  for (const char of String(value || "")) {
    const codePoint = char.codePointAt(0);
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    }
  }
  return bytes.map((byte) => `%${byte.toString(16).padStart(2, "0").toUpperCase()}`).join("");
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = document.createElement("img");
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
    "selectedMappingSegment",
    "selectedMappingPolicy",
    "mappingSegmentScope",
    "hideUnmappedMappingPolicies",
    "selectedRange",
    "selectedSegment",
    "selectedIp",
    "selectedPolicyConflictSegment",
    "selectedPolicyConflictPolicy",
    "collapsedPolicySegments",
    "collapsedPolicyRanges",
    "hiddenPolicyNonConflictRanges",
    "hiddenMappingSegmentLinks",
    "visualizationLens",
    "hostIpSource",
    "vizFilter:mapping",
    "vizFilter:ranges",
    "vizFilter:segments",
    "vizFilter:ips",
    "vizFilter:policies",
  ].forEach((key) => localStorage.removeItem(key));
  state.selectedRange = "";
  state.selectedSegment = "";
  state.selectedIp = "";
  state.selectedMappingSegment = "";
  state.selectedMappingPolicy = "";
  state.mappingSegmentScope = "all";
  state.hideUnmappedMappingPolicies = false;
  state.selectedPolicyConflictSegment = "";
  state.selectedPolicyConflictPolicy = "";
  state.collapsedPolicySegments = {};
  state.collapsedPolicyRanges = {};
  state.hiddenPolicyNonConflictRanges = {};
  state.hiddenMappingSegmentLinks = {};
  state.visualizationLens = "mapping";
  state.visualizationFilters = { mapping: "", ranges: "", segments: "", ips: "", policies: "" };
}

function stageActions(stageKey, rows) {
  return rows.map((row) => actionForRow(stageKey, row)).filter(Boolean);
}

function segmentPolicyMapping() {
  const mapping = state.analysis?.mapping || {};
  return {
    summary: mapping.summary || {},
    segments: (mapping.segments || []).map((segment) => ({
      ...segment,
      hasConflicts: Boolean(segment.has_conflicts),
      policyReferenceCount: Number(segment.policy_reference_count || 0),
      conflictRangeCount: Number(segment.conflict_range_count || 0),
    })),
    policies: mapping.policies || [],
  };
}

function findMappingSegment(mapping, segmentKey) {
  if (!segmentKey) return null;
  return (mapping.segments || []).find((segment) => segment.key === segmentKey) || null;
}

function findMappingPolicy(mapping, policyName) {
  if (!policyName) return null;
  return (mapping.policies || []).find((policy) => policy.policy === policyName) || null;
}

function sortMappingSegments(segments) {
  return [...(segments || [])].sort((a, b) => {
    const aPath = String(a.path || "");
    const bPath = String(b.path || "");
    return aPath.localeCompare(bPath, undefined, { numeric: true, sensitivity: "base" }) || String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true, sensitivity: "base" });
  });
}

function normalizedPathText(path) {
  return String(path || "").trim().replace(/\s*\/\s*/g, " / ");
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

function rangePolicyGroups(groups = rangeGroups()) {
  return groups
    .map((group) => {
      const policies = new Map();
      group.segments.forEach((segment) => {
        (segment.policyReferences || []).forEach((ref) => {
          const policyName = String(ref.policy || "Unnamed policy").trim() || "Unnamed policy";
          if (!policies.has(policyName)) {
            policies.set(policyName, {
              policy: policyName,
              sources: new Set(),
              segmentsByKey: new Map(),
            });
          }
          const policy = policies.get(policyName);
          if (ref.source) policy.sources.add(ref.source);
          if (!policy.segmentsByKey.has(segment.key)) {
            policy.segmentsByKey.set(segment.key, {
              ...segment,
              ranges: Array.from(segment.ranges || []),
              allRanges: Array.from(segment.allRanges || []),
              policyReferences: [],
            });
          }
          policy.segmentsByKey.get(segment.key).policyReferences.push(ref);
        });
      });
      const consolidated = Array.from(policies.values())
        .map((policy) => ({
          ...policy,
          sources: Array.from(policy.sources).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })),
          segments: Array.from(policy.segmentsByKey.values()).sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => b.segments.length - a.segments.length || a.policy.localeCompare(b.policy, undefined, { numeric: true, sensitivity: "base" }));
      return { ...group, policies: consolidated };
    })
    .filter((group) => group.policies.length)
    .sort((a, b) => b.liveHostCount - a.liveHostCount || b.policies.length - a.policies.length || a.range.localeCompare(b.range));
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
  const url = svgMarkupDataUrl(svgMarkup);
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
    .map((category) => category.title || `Rule ${category.number}`)
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

function segmentPolicyCount(segment = {}) {
  return Number(segment.policyReferenceCount ?? segment.policy_reference_count ?? 0) || 0;
}

function segmentUsageLabel(segment = {}) {
  if (!segment?.used) return "NOT USED (0 policies)";
  const count = segmentPolicyCount(segment);
  return `USED (${formatNumber(count)} ${count === 1 ? "policy" : "policies"})`;
}

function countIps(range = "") {
  const [start, end] = String(range || "").split("-").map((value) => value.trim());
  if (!start || !end) return 0;
  const first = ipToNumber(start);
  const last = ipToNumber(end);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return 0;
  return last - first + 1;
}

function sameSegment(left = {}, right = {}) {
  return (left.key && right.key && left.key === right.key) || (left.path && right.path && left.path === right.path && left.name === right.name);
}

function updateVisualizationFilter(lens, value) {
  if (!["mapping", "ranges", "segments", "ips", "policies"].includes(lens)) return;
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

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
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
