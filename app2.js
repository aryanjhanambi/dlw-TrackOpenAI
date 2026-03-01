/* Codex Governor — Demo Frontend
   Behavior:
   - index2.html (no hash) shows LOGIN tab
   - after login, opens index2.html#app in a NEW TAB for the real platform
   - app tab requires auth session; otherwise redirects back to login
*/

(function () {
  const STORAGE_KEY = "codex_governor_demo_v2";
  const AUTH_KEY = "codex_governor_auth_v1";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------- Auth + Routing ----------
  const isAppTab = location.hash === "#app";

  const auth = loadAuth();

  function showLoginTab() {
    $("#loginPage").classList.remove("hidden");
    $("#appShell").classList.add("hidden");
  }
  window.addEventListener("hashchange", () => {
    const hash = location.hash; // e.g. "#app#/org"
    const routePart = hash.replace("#app", "") || "#/onboarding";
    const viewId = routes[routePart] || "view-onboard";
    activateNavByView(viewId);
    showView(viewId);
  });

  function activateNavByView(viewId){
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === viewId));
  }
  function showAppTab() {
    $("#loginPage").classList.add("hidden");
    $("#appShell").classList.remove("hidden");
    const routes = {
      "#/onboarding": "view-onboard",
      "#/org": "view-org",
      "#/workflows": "view-workflows",
      "#/review": "view-review",
      "#/memory": "view-memory",
      "#/audit": "view-audit",
    };    
  }

  function requireAuthForApp() {
    if (!auth || !auth.email) {
      // kick back to login view in same tab
      location.hash = "";
      showLoginTab();
      toast("Please sign in to access the platform.");
      return false;
    }
    return true;
  }

  // If this is app tab, enforce auth, else show login
  if (isAppTab) {
    if (requireAuthForApp()) {
      showAppTab();
    }
  } else {
    showLoginTab();
  }

  // ---------- Login form (only exists on login tab) ----------
  const loginForm = $("#loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);

      const name = String(fd.get("name") || "").trim();
      const email = String(fd.get("email") || "").trim();
      const password = String(fd.get("password") || "").trim();

      if (!name || !email || !password) return;

      // Demo auth: accept anything, store session locally
      saveAuth({ name, email, at: new Date().toISOString() });

      $("#loginMsg").textContent = `Signed in as ${name} (${email}). Opening platform...`;
      $("#loginMsg").classList.remove("muted");

      // Open main platform in a new tab
      window.open("index2.html#app", "_blank", "noopener,noreferrer");

      toast("Platform opened in a new tab.");
      e.currentTarget.reset();
    });
  }

  // ---------- Platform state ----------
  const state = loadState();

  // If not app tab, stop here (no need to wire app handlers)
  if (!isAppTab) return;

  // If app tab but auth missing, already handled above
  if (!requireAuthForApp()) return;

  // ---------- Header badges + controls ----------
  $("#btnReset").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    toast("Demo data reset. Refreshing...");
    setTimeout(() => location.reload(), 400);
  });

  $("#btnLogout").addEventListener("click", () => {
    localStorage.removeItem(AUTH_KEY);
    toast("Logged out.");
    // Go back to login in this same tab
    location.hash = "";
    setTimeout(() => location.reload(), 200);
  });

  $("#btnExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    downloadBlob(blob, `codex-governor-export-${timestampFileSafe()}.json`);
  });

  // ---------- Navigation ----------
  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showView(btn.dataset.view);
      const targetView = btn.dataset.view;
      const route = Object.keys(routes).find((k) => routes[k] === targetView) || "#/onboarding";
      location.hash = "#app" + route; // updates URL like #app#/org
    });
  });

  function showView(viewId) {
    $$(".view").forEach((v) => v.classList.add("hidden"));
    $("#" + viewId).classList.remove("hidden");

    if (viewId === "view-org") renderOrg();
    if (viewId === "view-workflows") renderTasks();
    if (viewId === "view-review") renderQueue();
    if (viewId === "view-memory") renderMemory();
    if (viewId === "view-audit") renderAudit();

    syncHeaderBadges();
  }

  // ---------- Onboard: Enterprise ----------
  $("#formEnterprise").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    state.enterpriseId = String(fd.get("enterpriseId") || "").trim();
    state.companyName = String(fd.get("companyName") || "").trim();
    if (!state.enterpriseId || !state.companyName) return;

    saveState(state);
    toast(`Enterprise session started for ${state.companyName}.`);
    syncHeaderBadges();
    navigateTo("view-org");
  });

  // ---------- Onboard: Lead Engineer ----------
  $("#formLead").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const email = String(fd.get("email") || "").trim();
    const name = String(fd.get("name") || "").trim();
    const approvalsRequired = Number(fd.get("approvalsRequired") || 1);
    const dryRunGating = String(fd.get("dryRunGating") || "on");

    if (!email || !name) return;

    state.lead = { email, name };
    state.approvalsRequired = approvalsRequired;
    state.dryRunGating = dryRunGating === "off" ? "off" : "on";

    // Ensure lead exists as a member
    upsertMember({ name, email, role: "lead" });

    addAuditGlobal("LEAD_REGISTERED", email, { approvalsRequired, dryRunGating: state.dryRunGating });
    saveState(state);

    $("#leadStatus").textContent = `Registered: ${name} (${email})`;
    $("#leadStatus").classList.remove("muted");
    toast("Lead Engineer registered.");
    syncHeaderBadges();
    navigateTo("view-org");
  });

  function navigateTo(viewId) {
    const btn = $(`.nav-item[data-view="${viewId}"]`);
    if (btn) btn.click();
    else showView(viewId);
  }

  // ---------- Org: Policies ----------
  $("#formPolicies").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    state.policies = {
      languages: splitCSV(fd.get("languages")),
      structure: String(fd.get("structure") || "clean-arch"),
      formatting: String(fd.get("formatting") || "prettier-black"),
      security: splitCSV(fd.get("security")),
      constraints: String(fd.get("constraints") || "").trim(),
    };

    addAuditGlobal("POLICY_UPDATED", state.lead?.email || "system", { policies: state.policies });
    saveState(state);
    toast("Policies saved.");
    renderOrg();
    syncHeaderBadges();
  });

  // ---------- Org: Members ----------
  $("#formMember").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const member = {
      name: String(fd.get("name") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      role: String(fd.get("role") || "engineer"),
    };
    if (!member.name || !member.email) return;

    upsertMember(member);
    addAuditGlobal("MEMBER_UPSERT", state.lead?.email || "lead", { member });
    saveState(state);
    e.currentTarget.reset();
    toast("Member added.");
    renderOrg();
  });

  function upsertMember(member) {
    const idx = state.members.findIndex((m) => m.email.toLowerCase() === member.email.toLowerCase());
    if (idx >= 0) state.members[idx] = { ...state.members[idx], ...member };
    else state.members.push(member);
  }

  // ---------- Workflows: Tabs ----------
  let selectedWorkflow = "code";
  $$(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      selectedWorkflow = t.dataset.workflow;
    });
  });

  // ---------- Workflows: Create task ----------
  $("#formTask").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!requireOrgReady()) return;

    const fd = new FormData(e.currentTarget);
    const task = createTask({
      title: String(fd.get("title") || "").trim(),
      stage: String(fd.get("stage") || "development"),
      prompt: String(fd.get("prompt") || "").trim(),
      impactsProd: !!fd.get("impactsProd"),
      touchesSecurity: !!fd.get("touchesSecurity"),
      touchesData: !!fd.get("touchesData"),
      repo: String(fd.get("repo") || "").trim(),
      branch: String(fd.get("branch") || "").trim(),
      workflow: selectedWorkflow,
    });

    state.tasks.unshift(task);
    addAudit(task, "TASK_CREATED", auth.email, { workflow: task.workflow, stage: task.stage });
    saveState(state);

    e.currentTarget.reset();
    toast("Governed task created.");
    renderTasks();
    navigateTo("view-review");
  });

  // ---------- Review panel wiring ----------
  let selectedReviewTaskId = null;

  function renderQueue() {
    const queue = state.tasks.filter((t) => t.status === "PENDING_REVIEW");
    const el = $("#queueList");
    el.innerHTML = "";

    if (!queue.length) {
      el.innerHTML = `<div class="empty">No pending tasks. Create tasks in Workflows.</div>`;
    } else {
      queue.forEach((t) => {
        const card = taskCard(t, { mode: "queue" });
        const btn = card.querySelector("button[data-review]");
        btn.textContent = "Select";
        btn.addEventListener("click", () => selectReviewTask(t.id));
        el.appendChild(card);
      });
    }

    if (selectedReviewTaskId) renderReviewPanel(selectedReviewTaskId);
    else clearReviewSelection();
  }

  function selectReviewTask(taskId) {
    selectedReviewTaskId = taskId;
    renderReviewPanel(taskId);
  }

  function clearReviewSelection() {
    selectedReviewTaskId = null;
    $("#reviewEmpty").classList.remove("hidden");
    $("#reviewPanel").classList.add("hidden");
    $("#reviewPill").classList.add("hidden");
  }

  function renderReviewPanel(taskId) {
    const task = findTask(taskId);
    if (!task) return;

    $("#reviewEmpty").classList.add("hidden");
    $("#reviewPanel").classList.remove("hidden");
    $("#reviewPill").classList.remove("hidden");

    $("#reviewPill").textContent = `Selected: ${task.id}`;

    $("#rvTitle").textContent = task.title;
    $("#rvWorkflow").textContent = workflowLabel(task.workflow);
    $("#rvStage").textContent = task.stage;
    $("#rvRisk").textContent = `${task.risk.level} (${Math.round(task.risk.score * 100)}%) • ${task.risk.tags.join(", ") || "—"}`;
    $("#rvApprovalsReq").textContent = String(task.approvalsRequired);

    $("#rvOutput").textContent = task.output;

    $("#dryRunStatus").textContent = task.dryRunCompleted ? "Dry-run completed ✅" : "Dry-run not completed.";
    $("#btnDownloadRecord").classList.add("hidden");

    $("#btnDryRun").onclick = () => {
      if (task.status === "PAUSED") return toast("Task is paused. Resume before dry-run.");
      task.dryRunCompleted = true;
      addAudit(task, "DRY_RUN_COMPLETED", auth.email, { ok: true });
      touch(task);
      saveState(state);
      $("#dryRunStatus").textContent = "Dry-run completed ✅";
      toast("Dry-run completed.");
    };

    $("#btnReject").onclick = () => handleReject(taskId);
    $("#btnApprove").onclick = () => handleApprove(taskId);
    $("#btnDownloadRecord").onclick = () => downloadConfirmation(taskId);
  }

  function handleReject(taskId) {
    const task = findTask(taskId);
    if (!task) return;

    const reviewer = String($("#formDecision").reviewer.value || "").trim();
    const comment = String($("#formDecision").comment.value || "").trim();

    if (!reviewer) return toast("Reviewer email is required.");
    if (!comment) return toast("Rejection requires a documented issue/rationale.");

    task.status = "REJECTED";
    task.approvals.push({ reviewer, decision: "REJECT", comment, at: new Date().toISOString() });

    state.memory.unshift({
      id: "mem_" + Math.random().toString(36).slice(2, 10),
      taskId: task.id,
      title: task.title,
      workflow: task.workflow,
      stage: task.stage,
      reviewer,
      comment,
      risk: task.risk,
      createdAt: new Date().toISOString(),
    });

    addAudit(task, "OUTPUT_REJECTED", reviewer, { comment });
    touch(task);
    saveState(state);

    toast("Rejected. Reason stored in institutional memory.");
    $("#formDecision").comment.value = "";
    renderQueue();
    renderMemory();
    renderTasks();
  }

  function handleApprove(taskId) {
    const task = findTask(taskId);
    if (!task) return;

    const reviewer = String($("#formDecision").reviewer.value || "").trim();
    const comment = String($("#formDecision").comment.value || "").trim();

    if (!reviewer) return toast("Reviewer email is required.");

    if (state.dryRunGating === "on" && task.workflow === "code" && !task.dryRunCompleted) {
      toast("Dry-run must be completed before approval (policy).");
      return;
    }

    task.approvals.push({ reviewer, decision: "APPROVE", comment, at: new Date().toISOString() });

    if (task.approvals.filter(a => a.decision === "APPROVE").length >= task.approvalsRequired) {
      task.status = "APPROVED";
      addAudit(task, "OUTPUT_APPROVED", reviewer, { comment, approvalsCount: task.approvals.length });
      toast("Approved. Confirmation record available.");
      $("#btnDownloadRecord").classList.remove("hidden");
    } else {
      addAudit(task, "APPROVAL_RECORDED", reviewer, { comment });
      toast(`Approval recorded. Need ${task.approvalsRequired} total approvals.`);
    }

    touch(task);
    saveState(state);
    renderTasks();
    renderQueue();
    renderAudit();
  }

  function downloadConfirmation(taskId) {
    const task = findTask(taskId);
    if (!task) return;

    const record = {
      recordType: "AI_OUTPUT_CONFIRMATION",
      enterpriseId: state.enterpriseId || "—",
      companyName: state.companyName || "—",
      task: {
        id: task.id,
        title: task.title,
        workflow: workflowLabel(task.workflow),
        stage: task.stage,
        repository: task.repo,
        branch: task.branch,
      },
      summary: {
        risk: task.risk,
        affectedFiles: task.artifacts.affectedFiles,
        timestamps: { createdAt: task.createdAt, approvedAt: new Date().toISOString() },
        approvals: task.approvals,
      },
      generatedBy: auth.email,
      note: "Generated for audit compliance. Humans retain final authority.",
    };

    addAudit(task, "CONFIRMATION_RECORD_DOWNLOADED", auth.email, {});
    touch(task);
    saveState(state);

    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    downloadBlob(blob, `confirmation-${task.id}-${timestampFileSafe()}.json`);
  }

  // ---------- Memory / Audit render ----------
  $("#memorySearch").addEventListener("input", renderMemory);
  $("#memoryFilter").addEventListener("change", renderMemory);

  function renderMemory() {
    const q = ($("#memorySearch").value || "").trim().toLowerCase();
    const f = $("#memoryFilter").value;

    const list = state.memory.filter((m) => {
      if (f !== "all" && m.workflow !== f) return false;
      if (!q) return true;
      return (
        (m.title || "").toLowerCase().includes(q) ||
        (m.comment || "").toLowerCase().includes(q) ||
        (m.reviewer || "").toLowerCase().includes(q) ||
        (m.stage || "").toLowerCase().includes(q) ||
        (m.taskId || "").toLowerCase().includes(q)
      );
    });

    const el = $("#memoryList");
    el.innerHTML = "";

    if (!state.memory.length) {
      el.innerHTML = `<div class="empty">No rejections yet. Rejected outputs will appear here.</div>`;
      return;
    }
    if (!list.length) {
      el.innerHTML = `<div class="empty">No matches.</div>`;
      return;
    }

    list.forEach((m) => {
      const item = document.createElement("div");
      item.className = "mem-item";
      item.innerHTML = `
        <div class="mem-top">
          <div>
            <div class="mem-title">${escapeHtml(m.title)}</div>
            <div class="mem-meta">
              ${escapeHtml(workflowLabel(m.workflow))} • Stage: ${escapeHtml(m.stage)} • Task: ${escapeHtml(m.taskId)}
            </div>
          </div>
          <div class="task-badges">
            <span class="tag ${m.risk.level === "HIGH" ? "risk-high" : m.risk.level === "MEDIUM" ? "risk-med" : "risk-low"}">
              Risk: ${escapeHtml(m.risk.level)}
            </span>
          </div>
        </div>
        <div class="mem-body">
          <strong>Reviewer:</strong> ${escapeHtml(m.reviewer)}<br/>
          <strong>Reason:</strong> ${escapeHtml(m.comment)}
        </div>
      `;
      el.appendChild(item);
    });
  }

  $("#btnAuditRefresh").addEventListener("click", renderAudit);
  $("#auditSearch").addEventListener("input", renderAudit);

  function renderAudit() {
    const q = ($("#auditSearch").value || "").trim().toLowerCase();
    const tasks = state.tasks.filter((t) => {
      if (!q) return true;
      return (t.id || "").toLowerCase().includes(q) || (t.title || "").toLowerCase().includes(q);
    });

    const el = $("#auditList");
    el.innerHTML = "";

    if (!state.tasks.length) {
      el.innerHTML = `<div class="empty">No tasks yet. Audit events will appear here.</div>`;
      return;
    }
    if (!tasks.length) {
      el.innerHTML = `<div class="empty">No matching tasks.</div>`;
      return;
    }

    tasks.forEach((t) => {
      const card = document.createElement("div");
      card.className = "audit-item";
      card.innerHTML = `
        <div class="audit-title">${escapeHtml(t.title)} <span class="muted small">(${escapeHtml(t.id)})</span></div>
        <div class="muted small">${escapeHtml(workflowLabel(t.workflow))} • Stage: ${escapeHtml(t.stage)} • Status: ${escapeHtml(t.status)}</div>
        <div class="audit-timeline">
          ${(t.audit || []).map(evToHtml).join("") || `<div class="muted small">No events.</div>`}
        </div>
      `;
      el.appendChild(card);
    });
  }

  function evToHtml(ev) {
    return `
      <div class="event">
        <div class="et">${escapeHtml(ev.type)}</div>
        <div class="em">${escapeHtml(ev.at)} • actor: ${escapeHtml(ev.actor)}</div>
        <div class="ed">${escapeHtml(JSON.stringify(ev.detail, null, 2))}</div>
      </div>
    `;
  }

  // ---------- Tasks pipeline ----------
  function renderTasks() {
    const el = $("#tasksList");
    el.innerHTML = "";
    const tasks = state.tasks;

    if (!tasks.length) {
      el.innerHTML = `<div class="empty">No tasks yet. Create one from the Workflows tab.</div>`;
      return;
    }
    tasks.forEach((t) => el.appendChild(taskCard(t, { mode: "pipeline" })));
  }

  function taskCard(task, { mode }) {
    const div = document.createElement("div");
    div.className = "task";

    const riskTagClass =
      task.risk.level === "HIGH" ? "risk-high" : task.risk.level === "MEDIUM" ? "risk-med" : "risk-low";
    const statusTag = task.status.replaceAll("_", " ");

    const flags = [];
    if (task.flags.impactsProd) flags.push("Prod");
    if (task.flags.touchesSecurity) flags.push("Security");
    if (task.flags.touchesData) flags.push("Data");

    div.innerHTML = `
      <div class="task-head">
        <div>
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">
            <span>${escapeHtml(workflowLabel(task.workflow))}</span>
            • <span>Stage: ${escapeHtml(task.stage)}</span>
            • <span>ID: ${escapeHtml(task.id)}</span>
          </div>
        </div>
        <div class="task-badges">
          <span class="tag ${riskTagClass}">Risk: ${escapeHtml(task.risk.level)} (${Math.round(task.risk.score*100)}%)</span>
          <span class="tag">Status: ${escapeHtml(statusTag)}</span>
          ${flags.map(f => `<span class="tag">${escapeHtml(f)}</span>`).join("")}
        </div>
      </div>

      <div class="task-actions">
        ${
          mode === "pipeline"
            ? `<button class="btn btn-secondary" data-open="${escapeAttr(task.id)}">Open</button>`
            : `<button class="btn btn-secondary" data-review="${escapeAttr(task.id)}">Review</button>`
        }
      </div>
    `;

    div.querySelector("button[data-open]")?.addEventListener("click", () => {
      navigateTo("view-review");
      selectReviewTask(task.id);
    });

    div.querySelector("button[data-review]")?.addEventListener("click", () => selectReviewTask(task.id));

    return div;
  }

  function workflowLabel(w) {
    if (w === "ppt") return "PowerPoint";
    if (w === "doc") return "Word Docs";
    return "Code (Core)";
  }

  // ---------- Create task ----------
  function createTask(input) {
    const id = "tsk_" + Math.random().toString(36).slice(2, 10);
    const now = new Date().toISOString();
    const policies = state.policies || {};
    const risk = riskScore(input, policies);
    const output = simulateOutput(input, policies);

    return {
      id,
      title: input.title,
      stage: input.stage,
      workflow: input.workflow,
      prompt: input.prompt,
      repo: input.repo || "—",
      branch: input.branch || "—",
      flags: {
        impactsProd: input.impactsProd,
        touchesSecurity: input.touchesSecurity,
        touchesData: input.touchesData,
      },
      policiesSnapshot: policies,
      risk,
      output,
      status: "PENDING_REVIEW",
      approvalsRequired: state.approvalsRequired || 1,
      approvals: [],
      dryRunCompleted: false,
      createdAt: now,
      updatedAt: now,
      audit: [],
      artifacts: { affectedFiles: simulateAffectedFiles(input.workflow) },
    };
  }

  function simulateAffectedFiles(workflow) {
    if (workflow === "code") return ["app/api/routes.py", "app/services/auth.py", "tests/test_auth.py"];
    if (workflow === "ppt") return ["slides/pitch_deck.pptx"];
    return ["docs/governance_report.docx"];
  }

  function simulateOutput(input, policies) {
    const policyLine = [
      `# Policies`,
      `# languages: ${(policies.languages || []).join(", ") || "unspecified"}`,
      `# structure: ${policies.structure || "unspecified"}`,
      `# formatting: ${policies.formatting || "unspecified"}`,
      `# security: ${(policies.security || []).join(", ") || "unspecified"}`,
      policies.constraints ? `# constraints: ${policies.constraints}` : "",
    ].filter(Boolean).join("\n");

    if (input.workflow === "code") {
      return `${policyLine}

# Task: ${input.title}
# Stage: ${input.stage}

Proposed changes:
- Implement guarded access based on roles/permissions
- Follow formatting + structure policies
- Add tests and dry-run evidence before approval

Diff summary (simulated):
- app/api/routes.py: add role guard
- app/services/auth.py: centralized permission check
- tests/test_auth.py: new tests
`;
    }
    if (input.workflow === "ppt") {
      return `${policyLine}

PowerPoint Outline (simulated):
1. Problem: Unsafe autonomous changes
2. Solution: Human-governed orchestration + policies
3. Workflows: Code / PPT / Word with approvals
4. Audit: Confirmation records + traceability
5. Demo: Reject memory + approval gates
`;
    }
    return `${policyLine}

Word Report Outline (simulated):
- Executive Summary
- Governance Model (roles, permissions, policies)
- Approval Workflow & Evidence
- Audit Logs & Confirmation Records
- Institutional Memory (rejection DB)
- Compliance Appendix
`;
  }

  function riskScore(input, policies) {
    let score = 0.15;
    if (input.impactsProd) score += 0.30;
    if (input.touchesSecurity) score += 0.30;
    if (input.touchesData) score += 0.20;

    const text = (input.title + " " + input.prompt).toLowerCase();
    ["delete","drop","truncate","rm -rf","iam","secrets","auth","payments","prod"].forEach((w) => {
      if (text.includes(w)) score += 0.08;
    });

    const langs = (policies.languages || []).map((x) => x.toLowerCase());
    if (langs.length && !langs.some((l) => text.includes(l))) score += 0.05;

    score = Math.max(0, Math.min(1, score));
    const level = score >= 0.70 ? "HIGH" : score >= 0.40 ? "MEDIUM" : "LOW";
    const tags = [];
    if (input.impactsProd) tags.push("Production");
    if (input.touchesSecurity) tags.push("Security");
    if (input.touchesData) tags.push("Data");
    if (level === "HIGH" && tags.length === 0) tags.push("ModelFlag");
    return { score, level, tags };
  }

  // ---------- Org render ----------
  function renderOrg() {
    const p = state.policies || {};
    const form = $("#formPolicies");
    form.languages.value = (p.languages || []).join(", ");
    form.structure.value = p.structure || "clean-arch";
    form.formatting.value = p.formatting || "prettier-black";
    form.security.value = (p.security || []).join(", ");
    form.constraints.value = p.constraints || "";

    const tbody = $("#membersTbody");
    tbody.innerHTML = "";
    state.members.forEach((m) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.email)}</td>
        <td><span class="tag">${escapeHtml(roleLabel(m.role))}</span></td>
        <td><button class="btn btn-ghost" data-del="${escapeAttr(m.email)}">Remove</button></td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("button[data-del]").forEach((b) => {
      b.addEventListener("click", () => {
        const email = b.getAttribute("data-del");
        state.members = state.members.filter((m) => m.email !== email);
        addAuditGlobal("MEMBER_REMOVED", auth.email, { email });
        saveState(state);
        renderOrg();
        toast("Member removed.");
      });
    });
  }

  function roleLabel(role) {
    if (role === "lead") return "Lead Engineer";
    if (role === "reviewer") return "Reviewer";
    return "Engineer";
  }

  // ---------- Helpers ----------
  function requireOrgReady() {
    if (!state.enterpriseId || !state.companyName) {
      toast("Complete Enterprise ID + Company Name first.");
      navigateTo("view-onboard");
      return false;
    }
    if (!state.lead) {
      toast("Register a Lead Engineer first.");
      navigateTo("view-onboard");
      return false;
    }
    if (!state.policies || Object.keys(state.policies).length === 0) {
      toast("Set company policies before creating tasks.");
      navigateTo("view-org");
      return false;
    }
    return true;
  }

  function findTask(taskId) {
    return state.tasks.find((t) => t.id === taskId);
  }

  function touch(task) {
    task.updatedAt = new Date().toISOString();
  }

  function addAudit(task, type, actor, detail) {
    task.audit = task.audit || [];
    task.audit.push({ type, actor, detail, at: new Date().toISOString() });
  }

  function addAuditGlobal(type, actor, detail) {
    state._globalAudit = state._globalAudit || [];
    state._globalAudit.push({ type, actor, detail, at: new Date().toISOString() });
  }

  function splitCSV(v) {
    const s = String(v || "").trim();
    if (!s) return [];
    return s.split(",").map((x) => x.trim()).filter(Boolean);
  }

  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.style.position = "fixed";
      t.style.right = "16px";
      t.style.bottom = "16px";
      t.style.padding = "10px 12px";
      t.style.borderRadius = "12px";
      t.style.border = "1px solid rgba(233,238,252,.16)";
      t.style.background = "rgba(15,23,48,.85)";
      t.style.backdropFilter = "blur(10px)";
      t.style.color = "rgba(233,238,252,.92)";
      t.style.boxShadow = "0 10px 30px rgba(0,0,0,.35)";
      t.style.zIndex = "999";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => (t.style.opacity = "0"), 2200);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function timestampFileSafe() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escapeAttr(str) {
    return escapeHtml(str).replaceAll("`", "&#096;");
  }

  function syncHeaderBadges() {
    // user badge
    const userBadge = $("#userBadge");
    userBadge.classList.remove("hidden");
    userBadge.textContent = `${auth.name} • ${auth.email}`;

    // org badge + export
    const orgBadge = $("#orgBadge");
    const exportBtn = $("#btnExport");

    if (state.enterpriseId && state.companyName) {
      orgBadge.classList.remove("hidden");
      orgBadge.textContent = `${state.companyName} • ${state.enterpriseId}`;
      exportBtn.classList.remove("hidden");
    } else {
      orgBadge.classList.add("hidden");
      exportBtn.classList.add("hidden");
    }

    $("#policyMode").textContent = state.policies && Object.keys(state.policies).length ? "Enforced" : "—";
    $("#approvalsRequired").textContent = String(state.approvalsRequired || "—");
    $("#dryRunGating").textContent = state.dryRunGating ? state.dryRunGating.toUpperCase() : "—";

    if (state.lead) {
      $("#leadStatus").textContent = `Registered: ${state.lead.name} (${state.lead.email})`;
      $("#leadStatus").classList.remove("muted");
    }
  }

  // ---------- Persistence ----------
  function loadState() {
    const defaults = {
      enterpriseId: "",
      companyName: "",
      lead: undefined,
      approvalsRequired: 1,
      dryRunGating: "on",
      policies: {},
      members: [],
      tasks: [],
      memory: [],
      _globalAudit: [],
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  }

  function saveState(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  function loadAuth() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveAuth(session) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  }

  // ---------- Boot ----------
  function boot() {
    syncHeaderBadges();

    // default view
    const routePart = location.hash.replace("#app", "") || "#/onboarding";
    const viewId = routes[routePart] || "view-onboard";
    activateNavByView(viewId);
    showView(viewId);

    // If org already exists, jump to workflows
    if (state.enterpriseId && state.companyName) {
      showView("view-workflows");
      const btn = document.querySelector('.nav-item[data-view="view-workflows"]');
      if (btn) btn.click();
    }
  }

  boot();
})();
