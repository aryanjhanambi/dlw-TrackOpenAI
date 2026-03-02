/* Meridian — Demo Frontend
   Behavior:
   - / (no hash) shows LOGIN tab
   - after login, opens /#app in a NEW TAB for the real platform
   - app tab requires auth session; otherwise redirects back to login
*/

(function () {
  const STORAGE_KEY = "codex_governor_demo_v2";
  const AUTH_KEY = "codex_governor_auth_v1";

  const routes = {
    "#/onboarding": "view-onboard",
    "#/org": "view-org",
    "#/policy": "view-policy",
    "#/workflows": "view-workflows",
    "#/review": "view-review",
    "#/memory": "view-memory",
    "#/audit": "view-audit",
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const isAppTab = location.hash.startsWith("#app");
  const auth = loadAuth();

  function showLoginTab() {
    $("#loginPage").classList.remove("hidden");
    $("#appShell").classList.add("hidden");
  }

  function showAppTab() {
    $("#loginPage").classList.add("hidden");
    $("#appShell").classList.remove("hidden");
  }

  function requireAuthForApp() {
    if (!auth || !auth.email) {
      location.hash = "";
      showLoginTab();
      toast("Please sign in to access the platform.");
      return false;
    }
    return true;
  }

  if (isAppTab) {
    if (requireAuthForApp()) showAppTab();
  } else {
    showLoginTab();
  }

  window.addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#app")) return;
    const routePart = location.hash.replace("#app", "") || "#/onboarding";
    if (routePart.startsWith("#/project/")) {
      const projectId = decodeURIComponent(routePart.slice("#/project/".length));
      if (!projectBelongsToActiveEnterprise(projectId)) {
        toast("Project-enterprise mismatch. Please select a valid project.");
        navigateTo("view-workflows");
        return;
      }
      selectedPreviewProjectId = projectId;
      activateNavByView("");
      activateProjectSubtab(projectId);
      showView("view-project-preview");
      return;
    }
    const viewId = routes[routePart] || "view-onboard";
    activateNavByView(viewId);
    activateProjectSubtab("");
    showView(viewId);
  });

  const loginForm = $("#loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);

      const name = String(fd.get("name") || "").trim();
      const email = String(fd.get("email") || "").trim();
      const password = String(fd.get("password") || "").trim();
      if (!name || !email || !password) return;

      saveAuth({ name, email, at: new Date().toISOString() });
      $("#loginMsg").textContent = `Signed in as ${name} (${email}). Opening platform...`;
      $("#loginMsg").classList.remove("muted", "hidden");

      window.open("/#app", "_blank", "noopener,noreferrer");
      toast("Platform opened in a new tab.");
      e.currentTarget.reset();
    });
  }

  const state = loadState();
  if (!isAppTab) return;
  if (!requireAuthForApp()) return;

  const projectSelect = $("#projectSelect");
  const btnAddProject = $("#btnAddProject");
  const projectSubtabs = $("#projectSubtabs");
  const structureSelect = $("#formPolicies")?.querySelector("[name='structure']");
  const customStructureWrap = $("#custom-structure-wrap");
  const customStructureSample = $("#custom-structure-sample");
  const saveStructureSampleBtn = $("#save-structure-sample");
  const structureSampleStatus = $("#structure-sample-status");
  const codexToggleBtn = $("#codex-toggle-btn");
  const codexCheckbox = $("#useCodex");
  const codexCostBadge = $("#codex-cost-badge");
  const codeProjectTargetSelect = $("#code-project-target");
  const saveCodeTargetBtn = $("#save-code-target");
  const autoApprovalCountEl = $("#auto-approval-count");
  const decisionReviewerSelect = $("#decision-reviewer");
  const codexStepsListEl = $("#codex-steps-list");
  const deleteOpenProjectBtn = $("#delete-open-project-btn");
  const orgNextBtn = $("#org-next-btn");
  const policyNextBtn = $("#policy-next-btn");
  let selectedPreviewProjectId = state.activeProjectId;

  $("#btnReset").addEventListener("click", () => {
    const preservedMemory = state.memoryLedgerByEnterprise || {};
    const resetState = {
      enterpriseId: "",
      companyName: "",
      projects: [],
      activeProjectId: "",
      preferredCodeTargetProjectId: "",
      projectData: {},
      memoryLedgerByEnterprise: preservedMemory,
      _globalAudit: [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(resetState));
    toast("Workspace reset. Institutional Memory preserved.");
    setTimeout(() => location.reload(), 400);
  });

  $("#btnLogout").addEventListener("click", () => {
    localStorage.removeItem(AUTH_KEY);
    toast("Logged out. Workspace data is preserved.");
    location.hash = "";
    setTimeout(() => location.reload(), 200);
  });

  $("#btnExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    downloadBlob(blob, `meridian-export-${timestampFileSafe()}.json`);
  });

  projectSelect.addEventListener("change", () => {
    const nextProjectId = projectSelect.value;
    if (nextProjectId && !projectBelongsToActiveEnterprise(nextProjectId)) {
      toast("Project-enterprise mismatch. Select a project under the active Enterprise ID.");
      renderProjectPicker();
      return;
    }
    state.activeProjectId = nextProjectId;
    selectedPreviewProjectId = state.activeProjectId;
    saveState(state);
    selectedReviewTaskId = null;
    syncHeaderBadges();
    const routePart = location.hash.replace("#app", "") || "#/workflows";
    const viewId = routes[routePart] || "view-workflows";
    showView(viewId);
  });

  btnAddProject.addEventListener("click", () => {
    if (!state.enterpriseId) {
      toast("Set Enterprise ID in Onboarding before creating a project.");
      return;
    }
    const name = window.prompt("Project name");
    if (!name || !name.trim()) return;
    const id = "prj_" + Math.random().toString(36).slice(2, 9);
    state.projects.push({ id, name: name.trim(), enterpriseId: state.enterpriseId });
    state.activeProjectId = id;
    selectedPreviewProjectId = id;
    if (!state.projectData) state.projectData = {};
    state.projectData[id] = state.projectData[id] || {
      lead: undefined,
      approvalsRequired: 1,
      dryRunGating: "on",
      policies: {},
      members: [],
      tasks: [],
      memory: [],
    };
    saveState(state);
    renderProjectPicker();
    renderProjectSubtabs();
    syncHeaderBadges();
    toast(`Project created under ${state.enterpriseId}: ${name.trim()}`);
  });

  deleteOpenProjectBtn?.addEventListener("click", () => {
    const projectId = selectedPreviewProjectId || state.activeProjectId;
    if (!projectId) {
      toast("No project selected.");
      return;
    }
    if (!projectBelongsToActiveEnterprise(projectId)) {
      toast("Project-enterprise mismatch. Cannot delete outside active enterprise.");
      return;
    }
    const project = projectById(projectId);
    if (!project) return;
    const confirmed = window.confirm(`Delete project \"${project.name}\" and all its project data?`);
    if (!confirmed) return;

    state.projects = (state.projects || []).filter((p) => p.id !== projectId);
    if (state.projectData && state.projectData[projectId]) delete state.projectData[projectId];
    if (state.preferredCodeTargetProjectId === projectId) state.preferredCodeTargetProjectId = "";

    const enterpriseProjectsAfter = projectsForActiveEnterprise();
    state.activeProjectId = enterpriseProjectsAfter[0]?.id || "";
    selectedPreviewProjectId = state.activeProjectId;
    selectedReviewTaskId = null;
    saveState(state);
    syncHeaderBadges();
    showView("view-workflows");
    toast(`Project deleted: ${project.name}`);
  });

  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showView(btn.dataset.view);
      const targetView = btn.dataset.view;
      const route = Object.keys(routes).find((k) => routes[k] === targetView) || "#/onboarding";
      location.hash = "#app" + route;
    });
  });

  orgNextBtn?.addEventListener("click", () => navigateTo("view-policy"));
  policyNextBtn?.addEventListener("click", () => navigateTo("view-workflows"));

  function activateNavByView(viewId){
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === viewId));
  }

  function activateProjectSubtab(projectId) {
    $$(".project-subtab").forEach((b) => b.classList.toggle("active", b.dataset.projectId === projectId));
  }

  function showView(viewId) {
    $$(".view").forEach((v) => v.classList.add("hidden"));
    const target = $("#" + viewId);
    if (target) target.classList.remove("hidden");

    if (viewId === "view-org") renderOrg();
    if (viewId === "view-policy") renderPolicies();
    if (viewId === "view-workflows") renderTasks();
    if (viewId === "view-review") renderQueue();
    if (viewId === "view-memory") renderMemory();
    if (viewId === "view-audit") renderAudit();
    if (viewId === "view-project-preview") renderProjectPreview();

    syncHeaderBadges();
  }

  $("#formEnterprise").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    state.enterpriseId = String(fd.get("enterpriseId") || "").trim();
    state.companyName = String(fd.get("companyName") || "").trim();
    if (!state.enterpriseId || !state.companyName) return;

    syncProjectSelectionForEnterprise(false);

    saveState(state);
    toast(`Enterprise session started for ${state.companyName}.`);
    syncHeaderBadges();
    navigateTo("view-org");
  });

  $("#formLead").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const name = String(fd.get("name") || "").trim();
    const dryRunGating = String(fd.get("dryRunGating") || "on");
    if (!email || !name) return;

    const project = currentProjectState();
    if (!project) {
      toast("Create a project first using the + button under Audit.");
      return;
    }
    project.lead = { email, name };
    project.dryRunGating = dryRunGating === "off" ? "off" : "on";
    upsertMember({ name, email, role: "lead" });
    project.approvalsRequired = recommendedApprovals(project);

    addAuditGlobal("LEAD_REGISTERED", email, {
      approvalsRequired: project.approvalsRequired,
      dryRunGating: project.dryRunGating,
    });
    saveState(state);

    $("#leadStatus").textContent = `Registered: ${name} (${email})`;
    $("#leadStatus").classList.remove("muted");
    toast("Lead Engineer registered.");
    syncRecommendedApprovals(false);
    syncHeaderBadges();
    navigateTo("view-org");
  });

  function navigateTo(viewId) {
    const btn = $(`.nav-item[data-view="${viewId}"]`);
    if (btn) btn.click();
    else showView(viewId);
  }

  $("#formPolicies").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const project = currentProjectState();
    if (!project) {
      toast("Create a project first using the + button under Audit.");
      return;
    }
    project.policies = {
      languages: splitCSV(fd.get("languages")),
      structure: String(fd.get("structure") || "clean-arch"),
      structureSample: String(fd.get("structureSample") || "").trim(),
      formatting: String(fd.get("formatting") || "prettier-black"),
      security: splitCSV(fd.get("security")),
      constraints: String(fd.get("constraints") || "").trim(),
    };

    addAuditGlobal("POLICY_UPDATED", project.lead?.email || "system", { policies: project.policies });
    saveState(state);
    toast("Policies saved.");
    renderPolicies();
    syncHeaderBadges();
  });

  $("#formMember").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const member = {
      name: String(fd.get("name") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      role: String(fd.get("role") || "engineer"),
    };
    if (!member.name || !member.email) return;
    if (!currentProjectState()) {
      toast("Create a project first using the + button under Audit.");
      return;
    }

    upsertMember(member);
    addAuditGlobal("MEMBER_UPSERT", currentProjectState().lead?.email || "lead", { member });
    saveState(state);
    e.currentTarget.reset();
    toast("Member added.");
    renderOrg();
    syncRecommendedApprovals(true);
  });

  function upsertMember(member) {
    const project = currentProjectState();
    if (!project) return;
    const idx = project.members.findIndex((m) => m.email.toLowerCase() === member.email.toLowerCase());
    if (idx >= 0) project.members[idx] = { ...project.members[idx], ...member };
    else project.members.push(member);
  }

  function recommendedApprovals(project) {
    const memberCount = project.members.length;
    const roleCount = new Set(project.members.map((m) => m.role)).size;
    return Math.max(1, Math.min(5, Math.max(memberCount, roleCount)));
  }

  function syncRecommendedApprovals(updateState) {
    const project = currentProjectState();
    if (!project) {
      if (autoApprovalCountEl) autoApprovalCountEl.textContent = "1";
      return;
    }
    const recommended = recommendedApprovals(project);
    if (autoApprovalCountEl) autoApprovalCountEl.textContent = String(recommended);
    if (updateState) {
      project.approvalsRequired = recommended;
      saveState(state);
    }
  }

  function eligibleReviewersForTask(task) {
    const project = currentProjectState();
    if (!project) return [];
    const lowRisk = Number(task?.risk?.score || 0) < 0.3;
    const allowedRoles = new Set(["engineer", "reviewer", "lead"]);
    return (project.members || [])
      .filter((m) => m && m.email && allowedRoles.has(String(m.role || "").toLowerCase()))
      .filter((m) => (lowRisk ? String(m.role || "").toLowerCase() !== "lead" : true))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }

  function renderDecisionReviewerOptions(task) {
    if (!decisionReviewerSelect) return;
    const reviewers = eligibleReviewersForTask(task);
    if (!reviewers.length) {
      decisionReviewerSelect.innerHTML = '<option value="">No eligible approvers for this risk</option>';
      decisionReviewerSelect.value = "";
      return;
    }
    decisionReviewerSelect.innerHTML = reviewers
      .map((m) => {
        const role = roleLabel(String(m.role || "engineer"));
        return `<option value="${escapeAttr(m.email)}">${escapeHtml(m.name || m.email)} (${escapeHtml(
          role
        )}) - ${escapeHtml(m.email)}</option>`;
      })
      .join("");
    decisionReviewerSelect.value = reviewers[0].email;
  }

  let selectedWorkflow = "code";
  $$(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      selectedWorkflow = t.dataset.workflow;
    });
  });

  $("#formTask").addEventListener("submit", async (e) => {
    e.preventDefault();
    const targetProjectId = codeProjectTargetSelect?.value || state.activeProjectId;
    if (!requireOrgReady(targetProjectId)) return;

    const fd = new FormData(e.currentTarget);
    const useCodex = !!fd.get("useCodex");
    const title = String(fd.get("title") || "").trim();
    const stage = String(fd.get("stage") || "development");
    const prompt = String(fd.get("prompt") || "").trim();
    let codeInput = String(fd.get("codeInput") || "").trim();
    let output = "";
    let aiMeta = {};

    if (useCodex) {
      const generated = await generateCodexDraftInForm(targetProjectId);
      if (generated) {
        codeInput = generated.codeInput;
        output = generated.output;
        aiMeta = generated.aiMeta;
      }
    } else {
      setAiStatus("Codex generation is optional and off by default to save credits.");
    }

    const project = projectStateById(targetProjectId);
    if (!project) {
      toast("Target project not found. Select a valid project.");
      return;
    }

    const riskFromEngine = await assessTaskRiskFromBackend({
      title,
      stage,
      prompt,
      codeInput,
      projectName: state.projects.find((p) => p.id === targetProjectId)?.name || "Project",
    });

    const task = createTask({
      title,
      stage,
      prompt,
      workflow: "code",
      codeInput,
      aiOutput: output,
      aiMeta,
      projectState: project,
      riskOverride: riskFromEngine?.risk,
      riskAssessment: riskFromEngine?.assessment,
    });

    project.tasks.unshift(task);
    addAudit(task, "TASK_CREATED", auth.email, { workflow: task.workflow, stage: task.stage });
    saveState(state);

    e.currentTarget.reset();
    if (codexToggleBtn && codexCheckbox) {
      codexCheckbox.checked = false;
      codexToggleBtn.classList.remove("active");
      codexToggleBtn.setAttribute("aria-pressed", "false");
    }
    toast("Governed task created.");
    renderTasks();
    navigateTo("view-review");
  });

  const codeInputEl = $("#formTask")?.querySelector("[name='codeInput']");
  const aiStatusEl = $("#aiStatus");
  if (codeInputEl) {
    codeInputEl.addEventListener("input", () => {
      const preview = $("#codePreview");
      if (!preview) return;
      const value = String(codeInputEl.value || "").trim();
      preview.textContent = value || "No code provided yet.";
    });
  }

  function setAiStatus(message, isError = false) {
    if (!aiStatusEl) return;
    aiStatusEl.textContent = message;
    aiStatusEl.classList.toggle("error", isError);
    aiStatusEl.classList.toggle("muted", !isError);
  }

  function setCodexSteps(steps) {
    if (!codexStepsListEl) return;
    const list = Array.isArray(steps) && steps.length
      ? steps
      : ['Codex generation is off. Enable "Generate Draft With CODEX" to see step-by-step execution.'];
    codexStepsListEl.innerHTML = list.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  }

  async function generateCodexDraftInForm(targetProjectId) {
    if (!requireOrgReady(targetProjectId)) return null;
    const form = $("#formTask");
    if (!form) return null;
    const title = String(form.querySelector("[name='title']")?.value || "").trim();
    const stage = String(form.querySelector("[name='stage']")?.value || "development").trim();
    const prompt = String(form.querySelector("[name='prompt']")?.value || "").trim();
    let codeInput = String(form.querySelector("[name='codeInput']")?.value || "").trim();

    if (!title || !prompt) {
      setAiStatus("Add Task Title and Task Description before generating with Codex.", true);
      setCodexSteps([
        "Input validation failed.",
        "Task Title and Task Description are required before Codex can run.",
      ]);
      return null;
    }

    setAiStatus("Generating policy-aware draft with Codex...");
    setCodexSteps([
      "Collected task title, SDLC stage, prompt, and optional input code.",
      "Loaded current project policy constraints (languages, structure, formatting, security, and constraints).",
      "Built a constrained Codex request payload for policy-aware draft generation.",
      "Calling Codex API endpoint.",
    ]);
    try {
      const project = projectStateById(targetProjectId);
      if (!project) {
        setAiStatus("Target project not found.", true);
        setCodexSteps([
          "Project lookup failed.",
          "No active target project found for this request.",
        ]);
        return null;
      }
      const draft = await requestCodexDraft({
        project_name: state.projects.find((p) => p.id === targetProjectId)?.name || "Project",
        task_title: title,
        stage,
        task_prompt: prompt,
        input_code: codeInput,
        policy: {
          languages: project.policies?.languages || [],
          structure: project.policies?.structure || "unspecified",
          formatting: project.policies?.formatting || "unspecified",
          security: project.policies?.security || [],
          constraints: project.policies?.constraints || "",
        },
        force_refresh: false,
      });
      codeInput = String(draft.generated_code || codeInput).trim();
      if (codeInputEl) {
        codeInputEl.value = codeInput;
        const preview = $("#codePreview");
        if (preview) preview.textContent = codeInput || "No code provided yet.";
      }
      const output = `${draft.summary || "Codex draft generated."}\n\n${(draft.risk_notes || [])
        .map((r) => `- ${r}`)
        .join("\n")}`.trim();
      const aiMeta = {
        model: draft.model,
        cached: !!draft.cached,
        prompt_chars: draft.prompt_chars,
        output_chars: draft.output_chars,
      };
      const riskNotes = Array.isArray(draft.risk_notes) ? draft.risk_notes : [];
      setCodexSteps([
        "Validated required task inputs before execution.",
        "Applied company policy constraints to the prompt template.",
        `Submitted request to Codex (${aiMeta.cached ? "cache hit" : "fresh generation"}).`,
        `Received response from model: ${aiMeta.model || "unknown"}.`,
        `Generated code payload size: ${aiMeta.output_chars || 0} characters.`,
        riskNotes.length ? `Risk notes returned: ${riskNotes.join(" | ")}` : "No additional risk notes returned by Codex.",
        "Updated Code Preview with the generated draft.",
      ]);
      setAiStatus(`Codex draft ready (${aiMeta.cached ? "cache hit" : "new call"} • model: ${aiMeta.model}).`);
      return { codeInput, output, aiMeta };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setAiStatus(`Codex generation failed: ${message}.`, true);
      setCodexSteps([
        "Prepared policy-aware request for Codex.",
        "Codex call failed before a usable draft was returned.",
        `Failure reason: ${message}`,
      ]);
      return null;
    }
  }

  if (codexToggleBtn && codexCheckbox) {
    codexToggleBtn.addEventListener("click", async () => {
      codexCheckbox.checked = !codexCheckbox.checked;
      codexToggleBtn.classList.toggle("active", codexCheckbox.checked);
      codexToggleBtn.setAttribute("aria-pressed", codexCheckbox.checked ? "true" : "false");
      if (codexCheckbox.checked) {
        const targetProjectId = codeProjectTargetSelect?.value || state.activeProjectId;
        await generateCodexDraftInForm(targetProjectId);
      } else {
        setAiStatus("Codex draft toggle is off.");
        setCodexSteps([]);
      }
    });
  }

  function estimateTokenCount(text) {
    return Math.max(1, Math.ceil((text || "").length / 4));
  }

  function updateCodexCostEstimate() {
    if (!codexCostBadge) return;
    const form = $("#formTask");
    if (!form) return;
    const title = String(form.querySelector("[name='title']")?.value || "");
    const stage = String(form.querySelector("[name='stage']")?.value || "");
    const prompt = String(form.querySelector("[name='prompt']")?.value || "");
    const code = String(form.querySelector("[name='codeInput']")?.value || "");
    const targetProjectId = codeProjectTargetSelect?.value || state.activeProjectId;
    const policy = projectStateById(targetProjectId)?.policies || {};
    const policyText = [
      (policy.languages || []).join(", "),
      policy.structure || "",
      policy.structureSample || "",
      policy.formatting || "",
      (policy.security || []).join(", "),
      policy.constraints || "",
    ].join(" ");

    const inputTokens = estimateTokenCount(`${title} ${stage} ${prompt} ${code} ${policyText}`);
    const outputTokens = 350;

    // Conservative approximation tuned for testing visibility only.
    const INPUT_RATE_PER_1M = 0.4;
    const OUTPUT_RATE_PER_1M = 1.6;
    const estUsd = (inputTokens / 1_000_000) * INPUT_RATE_PER_1M + (outputTokens / 1_000_000) * OUTPUT_RATE_PER_1M;

    codexCostBadge.textContent = `Est. cost: ~$${estUsd.toFixed(4)} (${inputTokens + outputTokens} tok)`;
  }

  function toggleCustomStructureInput() {
    if (!structureSelect || !customStructureWrap) return;
    const isCustom = structureSelect.value === "custom";
    customStructureWrap.classList.toggle("hidden", !isCustom);
  }

  structureSelect?.addEventListener("change", toggleCustomStructureInput);

  saveStructureSampleBtn?.addEventListener("click", () => {
    const sample = String(customStructureSample?.value || "").trim();
    if (!sample) {
      if (structureSampleStatus) {
        structureSampleStatus.textContent = "Add a sample format before saving.";
        structureSampleStatus.classList.remove("hidden", "muted");
        structureSampleStatus.classList.add("error");
      }
      return;
    }
    const project = currentProjectState();
    if (!project) {
      toast("Create a project first using the + button under Audit.");
      return;
    }
    project.policies = project.policies || {};
    project.policies.structure = structureSelect?.value || project.policies.structure || "custom";
    project.policies.structureSample = sample;
    saveState(state);
    if (structureSampleStatus) {
      structureSampleStatus.textContent = "Custom structure sample saved.";
      structureSampleStatus.classList.remove("hidden", "error");
      structureSampleStatus.classList.add("muted");
    }
    updateCodexCostEstimate();
  });

  $("#formTask")?.addEventListener("input", updateCodexCostEstimate);
  codeProjectTargetSelect?.addEventListener("change", updateCodexCostEstimate);
  saveCodeTargetBtn?.addEventListener("click", () => {
    const targetProjectId = codeProjectTargetSelect?.value || "";
    if (!targetProjectId) {
      toast("Select a project first.");
      return;
    }
    state.preferredCodeTargetProjectId = targetProjectId;
    saveState(state);
    const project = state.projects.find((p) => p.id === targetProjectId);
    toast(`Saved target project: ${project?.name || "Project"}`);
  });

  async function requestCodexDraft(payload) {
    const response = await fetch("/ai/codex-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        if (body && typeof body.detail === "string") detail = body.detail;
      } catch (_err) {
        // ignore parse errors
      }
      throw new Error(detail);
    }
    return response.json();
  }

  async function requestRiskAssessment(payload) {
    const response = await fetch("/api/v1/risk/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        if (body && typeof body.detail === "string") detail = body.detail;
      } catch (_err) {
        // ignore parse errors
      }
      throw new Error(detail);
    }
    return response.json();
  }

  function normalizeRiskLevel(level, scorePercent) {
    const upper = String(level || "").toUpperCase();
    if (upper === "HIGH" && scorePercent >= 90) return "CRITICAL";
    if (upper === "HIGH") return "HIGH";
    if (upper === "MEDIUM") return "MEDIUM";
    return "LOW";
  }

  function buildSyntheticPatch({ title, stage, prompt, codeInput }) {
    const code = String(codeInput || "").trim();
    if (code.includes("--- a/") && code.includes("+++ b/")) return code;
    const fileName = `app/${String(stage || "development").toLowerCase()}_workflow.py`;
    const body = code || `# ${title}\n# ${prompt}\npass\n`;
    const plusLines = body
      .split("\n")
      .map((line) => `+${line}`)
      .join("\n");
    return `--- a/${fileName}\n+++ b/${fileName}\n@@ -0,0 +1,${Math.max(1, body.split("\n").length)} @@\n${plusLines}\n`;
  }

  function mapRiskAssessmentToUi(assessment) {
    const scoreRaw = Number(assessment?.risk_score || 0);
    const scorePercent = Math.max(0, Math.min(100, scoreRaw));
    const reasons = Array.isArray(assessment?.risk_reasons)
      ? assessment.risk_reasons.map((item) => String(item))
      : [];
    return {
      risk: {
        score: scorePercent / 100,
        level: normalizeRiskLevel(assessment?.risk_level, scorePercent),
        tags: reasons.length ? reasons.slice(0, 4) : ["Deterministic risk engine"],
        source: "risk_engine_v1",
      },
      assessment: assessment || null,
    };
  }

  async function assessTaskRiskFromBackend({ title, stage, prompt, codeInput, projectName }) {
    try {
      const generatedPatch = buildSyntheticPatch({ title, stage, prompt, codeInput });
      const payload = {
        generated_patch: generatedPatch,
        prompt,
        metadata: {
          project_name: projectName,
          task_title: title,
          stage,
          source: "prototype-ui",
        },
      };
      const response = await requestRiskAssessment(payload);
      const mapped = mapRiskAssessmentToUi(response?.data);
      setCodexSteps([
        "Built deterministic patch payload for risk analysis.",
        "Submitted patch to backend risk engine.",
        `Risk engine result: ${mapped.risk.level} (${Math.round(mapped.risk.score * 100)}%).`,
        `Reasons: ${(mapped.risk.tags || []).join(" | ") || "none"}`,
      ]);
      return mapped;
    } catch (_err) {
      return null;
    }
  }

  let selectedReviewTaskId = null;

  function renderQueue() {
    const queue = (currentProjectState()?.tasks || [])
      .filter((t) => t.status === "PENDING_REVIEW")
      .map((t) => recomputeTaskRisk(t));
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
    recomputeTaskRisk(task);

    $("#reviewEmpty").classList.add("hidden");
    $("#reviewPanel").classList.remove("hidden");
    $("#reviewPill").classList.remove("hidden");

    const shortId = String(task.id || "").slice(0, 8);
    $("#reviewPill").textContent = `Selected: ${task.title} (${shortId})`;

    $("#rvTitle").textContent = task.title;
    $("#rvWorkflow").textContent = workflowLabel(task.workflow);
    $("#rvStage").textContent = task.stage;
    $("#rvRisk").textContent = `${task.risk.level} (${Math.round(task.risk.score * 100)}%) • ${task.risk.tags.join(", ") || "—"}`;
    $("#rvApprovalsReq").textContent = String(task.approvalsRequired);
    renderDecisionReviewerOptions(task);

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

    const project = currentProjectState();
    if (!project) return;
    appendEnterpriseMemory({
      id: "mem_" + Math.random().toString(36).slice(2, 10),
      taskId: task.id,
      projectId: state.activeProjectId,
      projectName: projectById(state.activeProjectId)?.name || "Project",
      title: task.title,
      workflow: task.workflow,
      stage: task.stage,
      reviewer,
      comment,
      decision: "REJECTED",
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

    if ((currentProjectState()?.dryRunGating || "on") === "on" && task.workflow === "code" && !task.dryRunCompleted) {
      toast("Dry-run must be completed before approval (policy).");
      return;
    }

    task.approvals.push({ reviewer, decision: "APPROVE", comment, at: new Date().toISOString() });

    if (task.approvals.filter(a => a.decision === "APPROVE").length >= task.approvalsRequired) {
      task.status = "APPROVED";
      addAudit(task, "OUTPUT_APPROVED", reviewer, { comment, approvalsCount: task.approvals.length });
      const project = currentProjectState();
      if (project) {
        appendEnterpriseMemory({
          id: "mem_" + Math.random().toString(36).slice(2, 10),
          taskId: task.id,
          projectId: state.activeProjectId,
          projectName: projectById(state.activeProjectId)?.name || "Project",
          title: task.title,
          workflow: task.workflow,
          stage: task.stage,
          reviewer,
          comment: comment || "Approved after review.",
          decision: "APPROVED",
          risk: task.risk,
          createdAt: new Date().toISOString(),
        });
      }
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
    renderMemory();
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

  $("#memorySearch").addEventListener("input", renderMemory);
  $("#memoryFilter").addEventListener("change", renderMemory);

  function renderMemory() {
    const q = ($("#memorySearch").value || "").trim().toLowerCase();
    const f = $("#memoryFilter").value;

    const memory = enterpriseMemoryLedger();
    const list = memory.filter((m) => {
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

    if (!memory.length) {
      el.innerHTML = `<div class="empty">No rejections yet. Rejected outputs will appear here.</div>`;
      return;
    }
    if (!list.length) {
      el.innerHTML = `<div class="empty">No matches.</div>`;
      return;
    }

    list.forEach((m) => {
      const decision = String(m.decision || "REJECTED").toUpperCase();
      const decisionClass = decision === "APPROVED" ? "status-approved" : "status-rejected";
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
            <span class="tag ${decisionClass}">${escapeHtml(decision)}</span>
            <span class="tag ${m.risk.level === "CRITICAL" ? "risk-critical" : m.risk.level === "HIGH" ? "risk-high" : m.risk.level === "MEDIUM" ? "risk-med" : "risk-low"}">
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
    const projectTasks = currentProjectState()?.tasks || [];
    const tasks = projectTasks.filter((t) => {
      if (!q) return true;
      return (t.id || "").toLowerCase().includes(q) || (t.title || "").toLowerCase().includes(q);
    });

    const el = $("#auditList");
    el.innerHTML = "";

    if (!projectTasks.length) {
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

  function renderProjectPreview() {
    const list = $("#projectPreviewList");
    const title = $("#projectPreviewTitle");
    if (!list || !title) return;
    if (selectedPreviewProjectId && !projectBelongsToActiveEnterprise(selectedPreviewProjectId)) {
      title.textContent = "Project Code Preview";
      list.innerHTML = `<div class="empty">Project-enterprise mismatch. Select a valid project for this Enterprise ID.</div>`;
      deleteOpenProjectBtn?.classList.add("hidden");
      return;
    }

    const project = projectById(selectedPreviewProjectId);
    const projectState = projectStateById(selectedPreviewProjectId);
    title.textContent = `Project Code Preview: ${project?.name || "Unknown Project"}`;
    deleteOpenProjectBtn?.classList.toggle("hidden", !project);
    list.innerHTML = "";

    if (!projectState) {
      list.innerHTML = `<div class="empty">Project data not found.</div>`;
      return;
    }

    const tasksWithCode = (projectState.tasks || []).filter((t) => String(t.codeInput || "").trim());
    if (!tasksWithCode.length) {
      list.innerHTML = `<div class="empty">No code snippets saved for this project yet.</div>`;
      return;
    }

    tasksWithCode.forEach((t) => {
      const item = document.createElement("div");
      item.className = "mem-item";
      item.innerHTML = `
        <div class="mem-top">
          <div>
            <div class="mem-title">${escapeHtml(t.title)}</div>
            <div class="mem-meta">${escapeHtml(workflowLabel(t.workflow))} • Stage: ${escapeHtml(
        t.stage
      )} • Task: ${escapeHtml(t.id)}</div>
          </div>
          <div class="task-badges">
            <span class="tag">Status: ${escapeHtml(String(t.status || "unknown").replaceAll("_", " "))}</span>
          </div>
        </div>
        <pre class="code">${escapeHtml(t.codeInput)}</pre>
        <div class="task-actions">
          <button type="button" class="btn btn-danger" data-delete-preview="${escapeAttr(t.id)}">Delete Preview</button>
        </div>
      `;
      const deleteBtn = item.querySelector("button[data-delete-preview]");
      deleteBtn?.addEventListener("click", () => {
        const confirmed = window.confirm("Remove this preview code from the project tab?");
        if (!confirmed) return;
        t.codeInput = "";
        t.aiMeta = {};
        touch(t);
        addAudit(t, "PROJECT_PREVIEW_REMOVED", auth.email, { removed: "code_preview" });
        saveState(state);
        renderProjectPreview();
        toast("Preview code removed from project tab.");
      });
      list.appendChild(item);
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

  function renderTasks() {
    const el = $("#tasksList");
    el.innerHTML = "";
    const project = currentProjectState();
    if (!project) {
      el.innerHTML = `<div class="empty">No project yet. Use the + button under Audit to create a project.</div>`;
      return;
    }
    const tasks = project.tasks.map((t) => recomputeTaskRisk(t));

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
      task.risk.level === "CRITICAL" ? "risk-critical" : task.risk.level === "HIGH" ? "risk-high" : task.risk.level === "MEDIUM" ? "risk-med" : "risk-low";
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
    return "Code (Core)";
  }

  function createTask(input) {
    const id = "tsk_" + Math.random().toString(36).slice(2, 10);
    const now = new Date().toISOString();
    const project = input.projectState || currentProjectState();
    if (!project) throw new Error("No active project");
    const policies = project.policies || {};
    const risk = input.riskOverride || riskScore(input, policies);
    const output = input.aiOutput || simulateOutput(input, policies);

    return {
      id,
      title: input.title,
      stage: input.stage,
      workflow: input.workflow,
      prompt: input.prompt,
      codeInput: input.codeInput || "",
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
      approvalsRequired: project.approvalsRequired || 1,
      approvals: [],
      dryRunCompleted: false,
      createdAt: now,
      updatedAt: now,
      audit: [],
      artifacts: { affectedFiles: simulateAffectedFiles(input.workflow) },
      aiMeta: input.aiMeta || {},
      riskAssessment: input.riskAssessment || null,
    };
  }

  function recomputeTaskRisk(task) {
    if (task?.risk?.source === "risk_engine_v1") return task;
    const policies = task.policiesSnapshot || currentProjectState()?.policies || {};
    const input = {
      title: task.title || "",
      prompt: task.prompt || "",
      codeInput: task.codeInput || "",
      stage: task.stage || "development",
      impactsProd: !!task.flags?.impactsProd,
      touchesSecurity: !!task.flags?.touchesSecurity,
      touchesData: !!task.flags?.touchesData,
    };
    task.risk = riskScore(input, policies);
    return task;
  }

  function simulateAffectedFiles(workflow) {
    if (workflow === "code") return ["app/api/routes.py", "app/services/auth.py", "tests/test_auth.py"];
    return ["app/api/routes.py", "app/services/auth.py", "tests/test_auth.py"];
  }

  function simulateOutput(input, policies) {
    const policyLine = [
      `# Policies`,
      `# languages: ${(policies.languages || []).join(", ") || "unspecified"}`,
      `# structure: ${policies.structure || "unspecified"}${policies.structureSample ? ` (${policies.structureSample})` : ""}`,
      `# formatting: ${policies.formatting || "unspecified"}`,
      `# security: ${(policies.security || []).join(", ") || "unspecified"}`,
      policies.constraints ? `# constraints: ${policies.constraints}` : "",
    ].filter(Boolean).join("\n");

    return `${policyLine}\n\n# Task: ${input.title}\n# Stage: ${input.stage}\n\nProposed changes:\n- Implement guarded access based on roles/permissions\n- Follow formatting + structure policies\n- Add tests and dry-run evidence before approval\n\nDiff summary (simulated):\n- app/api/routes.py: add role guard\n- app/services/auth.py: centralized permission check\n- tests/test_auth.py: new tests\n`;
  }

  function riskScore(input, policies) {
    let score = 0.08;
    const tags = [];

    const stageWeights = {
      design: 0.08,
      development: 0.14,
      testing: 0.18,
      deployment: 0.35,
      incident: 0.32,
      communication: 0.1,
      governance: 0.2,
    };
    const stage = String(input.stage || "development").toLowerCase();
    score += stageWeights[stage] || 0.14;
    tags.push(`Stage:${stage}`);

    if (input.impactsProd) {
      score += 0.22;
      tags.push("Production");
    }
    if (input.touchesSecurity) {
      score += 0.25;
      tags.push("Security");
    }
    if (input.touchesData) {
      score += 0.16;
      tags.push("Data");
    }

    const text = `${input.title || ""} ${input.prompt || ""} ${input.codeInput || ""}`.toLowerCase();
    const strongKeywords = ["delete", "drop table", "truncate", "rm -rf", "root", "iam", "secret", "encryption"];
    const mediumKeywords = ["auth", "payment", "prod", "migration", "schema", "token", "permission"];

    strongKeywords.forEach((w) => {
      if (text.includes(w)) {
        score += 0.12;
        tags.push("CriticalKeyword");
      }
    });
    mediumKeywords.forEach((w) => {
      if (text.includes(w)) {
        score += 0.06;
        tags.push("RiskKeyword");
      }
    });

    const promptLen = String(input.prompt || "").length;
    if (promptLen > 500) {
      score += 0.06;
      tags.push("LargePrompt");
    }
    if (promptLen > 1200) {
      score += 0.08;
      tags.push("VeryLargePrompt");
    }

    const codeLines = String(input.codeInput || "").split("\n").filter(Boolean).length;
    if (codeLines > 80) {
      score += 0.07;
      tags.push("LargeCodeInput");
    }
    if (codeLines > 220) {
      score += 0.1;
      tags.push("VeryLargeCodeInput");
    }

    const langs = (policies.languages || []).map((x) => String(x).toLowerCase());
    if (langs.length && !langs.some((l) => text.includes(l))) {
      score += 0.05;
      tags.push("PolicyLangMismatch");
    }

    score = Math.max(0.05, Math.min(1, score));
    const level = score >= 0.82 ? "CRITICAL" : score >= 0.64 ? "HIGH" : score >= 0.36 ? "MEDIUM" : "LOW";

    return { score, level, tags: Array.from(new Set(tags)) };
  }

  function renderOrg() {
    const project = currentProjectState();
    if (!project) {
      const tbody = $("#membersTbody");
      tbody.innerHTML = '<tr><td colspan="4">No project yet. Use the + button under Audit.</td></tr>';
      return;
    }
    const tbody = $("#membersTbody");
    tbody.innerHTML = "";
    project.members.forEach((m) => {
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
        project.members = project.members.filter((m) => m.email !== email);
        addAuditGlobal("MEMBER_REMOVED", auth.email, { email });
        saveState(state);
        renderOrg();
        toast("Member removed.");
        syncRecommendedApprovals(true);
      });
    });
  }

  function renderPolicies() {
    const p = currentProjectState()?.policies || {};
    const form = $("#formPolicies");
    if (!form) return;
    form.languages.value = (p.languages || []).join(", ");
    form.structure.value = p.structure || "clean-arch";
    form.structureSample.value = p.structureSample || "";
    form.formatting.value = p.formatting || "prettier-black";
    form.security.value = (p.security || []).join(", ");
    form.constraints.value = p.constraints || "";
    toggleCustomStructureInput();
    updateCodexCostEstimate();
  }

  function roleLabel(role) {
    if (role === "lead") return "Lead Engineer";
    if (role === "reviewer") return "Reviewer";
    return "Engineer";
  }

  function requireOrgReady(targetProjectId) {
    if (!state.enterpriseId || !state.companyName) {
      toast("Complete Enterprise ID + Company Name first.");
      navigateTo("view-onboard");
      return false;
    }
    const project = projectStateById(targetProjectId || state.activeProjectId);
    if (!project) {
      toast("Create a project first using the + button under Audit.");
      return false;
    }
    if (!project.lead) {
      toast("Register a Lead Engineer first.");
      navigateTo("view-onboard");
      return false;
    }
    if (!project.policies || Object.keys(project.policies).length === 0) {
      toast("Set company policies before creating tasks.");
      navigateTo("view-policy");
      return false;
    }
    return true;
  }

  function findTask(taskId) {
    return (currentProjectState()?.tasks || []).find((t) => t.id === taskId);
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

  function enterpriseMemoryLedger() {
    const enterpriseId = String(state.enterpriseId || "").trim();
    if (!enterpriseId) return [];
    if (!state.memoryLedgerByEnterprise) state.memoryLedgerByEnterprise = {};
    if (!Array.isArray(state.memoryLedgerByEnterprise[enterpriseId])) {
      state.memoryLedgerByEnterprise[enterpriseId] = [];
    }
    return state.memoryLedgerByEnterprise[enterpriseId];
  }

  function appendEnterpriseMemory(entry) {
    const ledger = enterpriseMemoryLedger();
    ledger.unshift(entry);
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
    syncProjectSelectionForEnterprise(false);
    renderProjectPicker();
    renderProjectSubtabs();
    renderCodeProjectTargetOptions();
    const userBadge = $("#userBadge");
    userBadge.classList.remove("hidden");
    userBadge.textContent = `${auth.name} • ${auth.email}`;

    const orgBadge = $("#orgBadge");
    const exportBtn = $("#btnExport");

    if (state.enterpriseId && state.companyName) {
      orgBadge.classList.remove("hidden");
      const activeProject = state.projects.find((p) => p.id === state.activeProjectId);
      orgBadge.textContent = `${state.companyName} • ${state.enterpriseId} • ${activeProject?.name || "Project"}`;
      exportBtn.classList.remove("hidden");
    } else {
      orgBadge.classList.add("hidden");
      exportBtn.classList.add("hidden");
    }

    const project = currentProjectState();
    $("#policyMode").textContent = project?.policies && Object.keys(project.policies).length ? "Enforced" : "—";
    $("#approvalsRequired").textContent = String(project?.approvalsRequired || "—");
    $("#dryRunGating").textContent = project?.dryRunGating ? project.dryRunGating.toUpperCase() : "—";

    if (project?.lead) {
      $("#leadStatus").textContent = `Registered: ${project.lead.name} (${project.lead.email})`;
      $("#leadStatus").classList.remove("muted");
    } else {
      $("#leadStatus").textContent = "Not registered.";
      $("#leadStatus").classList.add("muted");
    }
    syncRecommendedApprovals(false);
  }

  function currentProjectState() {
    if (!ensureActiveProjectState()) return null;
    return state.projectData[state.activeProjectId];
  }

  function projectsForActiveEnterprise() {
    const enterpriseId = String(state.enterpriseId || "").trim();
    if (!enterpriseId) return [];
    return (state.projects || []).filter((p) => String(p.enterpriseId || "").trim() === enterpriseId);
  }

  function projectBelongsToActiveEnterprise(projectId) {
    const project = projectById(projectId);
    if (!project) return false;
    const enterpriseId = String(state.enterpriseId || "").trim();
    if (!enterpriseId) return false;
    return String(project.enterpriseId || "").trim() === enterpriseId;
  }

  function syncProjectSelectionForEnterprise(showErrorToast = false) {
    const enterpriseProjects = projectsForActiveEnterprise();
    if (!enterpriseProjects.length) {
      if (state.activeProjectId) {
        state.activeProjectId = "";
        selectedPreviewProjectId = "";
      }
      return;
    }
    if (!state.activeProjectId || !projectBelongsToActiveEnterprise(state.activeProjectId)) {
      state.activeProjectId = enterpriseProjects[0].id;
      selectedPreviewProjectId = state.activeProjectId;
      if (showErrorToast) {
        toast("Project-enterprise mismatch detected. Switched to a valid project for this enterprise.");
      }
    }
    if (selectedPreviewProjectId && !projectBelongsToActiveEnterprise(selectedPreviewProjectId)) {
      selectedPreviewProjectId = state.activeProjectId;
    }
  }

  function projectById(projectId) {
    return state.projects.find((p) => p.id === projectId);
  }

  function projectStateById(projectId) {
    if (!projectId) return null;
    if (!state.projectData) return null;
    return state.projectData[projectId] || null;
  }

  function ensureActiveProjectState() {
    const enterpriseProjects = projectsForActiveEnterprise();
    if (!enterpriseProjects.length) return false;
    const exists = enterpriseProjects.some((p) => p.id === state.activeProjectId);
    if (!exists) return false;
    if (!state.projectData) state.projectData = {};
    if (!state.projectData[state.activeProjectId]) {
      state.projectData[state.activeProjectId] = {
        lead: undefined,
        approvalsRequired: 1,
        dryRunGating: "on",
        policies: {},
        members: [],
        tasks: [],
        memory: [],
      };
    }
    return true;
  }

  function renderProjectPicker() {
    if (!projectSelect) return;
    const enterpriseProjects = projectsForActiveEnterprise();
    if (!enterpriseProjects.length) {
      projectSelect.innerHTML = '<option value="">No projects yet</option>';
      projectSelect.value = "";
      return;
    }
    projectSelect.innerHTML = enterpriseProjects
      .map((p) => `<option value=\"${escapeAttr(p.id)}\">${escapeHtml(p.name)}</option>`)
      .join("");
    if (!projectBelongsToActiveEnterprise(state.activeProjectId)) {
      state.activeProjectId = enterpriseProjects[0].id;
    }
    projectSelect.value = state.activeProjectId;
  }

  function renderProjectSubtabs() {
    if (!projectSubtabs) return;
    const enterpriseProjects = projectsForActiveEnterprise();
    if (!enterpriseProjects.length) {
      projectSubtabs.innerHTML = "";
      return;
    }
    projectSubtabs.innerHTML = enterpriseProjects
      .map(
        (p) =>
          `<button type=\"button\" class=\"project-subtab\" data-project-id=\"${escapeAttr(
            p.id
          )}\">Project: ${escapeHtml(p.name)}</button>`
      )
      .join("");

    projectSubtabs.querySelectorAll(".project-subtab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const projectId = btn.dataset.projectId || "";
        if (!projectId) return;
        if (!projectBelongsToActiveEnterprise(projectId)) {
          toast("Project-enterprise mismatch. This project is not under the active Enterprise ID.");
          return;
        }
        selectedPreviewProjectId = projectId;
        activateNavByView("");
        activateProjectSubtab(projectId);
        location.hash = "#app#/project/" + encodeURIComponent(projectId);
      });
    });

    activateProjectSubtab(selectedPreviewProjectId || "");
  }

  function renderCodeProjectTargetOptions() {
    if (!codeProjectTargetSelect) return;
    const enterpriseProjects = projectsForActiveEnterprise();
    if (!enterpriseProjects.length) {
      codeProjectTargetSelect.innerHTML = '<option value="">No projects yet</option>';
      codeProjectTargetSelect.value = "";
      return;
    }
    codeProjectTargetSelect.innerHTML = enterpriseProjects
      .map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`)
      .join("");
    const currentSelected = codeProjectTargetSelect.value;
    const preferred = state.preferredCodeTargetProjectId || "";
    const selected = currentSelected || preferred;
    const exists = enterpriseProjects.some((p) => p.id === selected);
    codeProjectTargetSelect.value = exists ? selected : state.activeProjectId || enterpriseProjects[0].id;
  }

  function loadState() {
    const defaults = {
      enterpriseId: "",
      companyName: "",
      projects: [],
      activeProjectId: "",
      preferredCodeTargetProjectId: "",
      projectData: {},
      memoryLedgerByEnterprise: {},
      _globalAudit: [],
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      const merged = { ...defaults, ...parsed };
      merged.projects = (merged.projects || []).map((project) => ({
        ...project,
        enterpriseId: project.enterpriseId || merged.enterpriseId || "",
      }));
      if (!merged.memoryLedgerByEnterprise || typeof merged.memoryLedgerByEnterprise !== "object") {
        merged.memoryLedgerByEnterprise = {};
      }

      // Migrate legacy single-project shape into the new per-project container.
      if ((!merged.projectData || !Object.keys(merged.projectData).length) && (parsed.tasks || parsed.policies || parsed.members)) {
        merged.projectData = {
          [merged.activeProjectId || "core"]: {
            lead: parsed.lead,
            approvalsRequired: parsed.approvalsRequired || 1,
            dryRunGating: parsed.dryRunGating || "on",
            policies: parsed.policies || {},
            members: parsed.members || [],
            tasks: parsed.tasks || [],
            memory: parsed.memory || [],
          },
        };
      }

      const existingIds = new Set(
        Object.values(merged.memoryLedgerByEnterprise)
          .flatMap((entries) => (Array.isArray(entries) ? entries : []))
          .map((entry) => String(entry?.id || ""))
      );
      for (const project of merged.projects || []) {
        const pid = project.id;
        const enterpriseId = String(project.enterpriseId || merged.enterpriseId || "").trim();
        if (!enterpriseId) continue;
        const oldProjectMemory = merged.projectData?.[pid]?.memory;
        if (!Array.isArray(oldProjectMemory) || !oldProjectMemory.length) continue;
        if (!Array.isArray(merged.memoryLedgerByEnterprise[enterpriseId])) {
          merged.memoryLedgerByEnterprise[enterpriseId] = [];
        }
        oldProjectMemory.forEach((entry) => {
          const entryId = String(entry?.id || "");
          if (!entryId || existingIds.has(entryId)) return;
          existingIds.add(entryId);
          merged.memoryLedgerByEnterprise[enterpriseId].push({
            ...entry,
            projectId: entry.projectId || pid,
            projectName: entry.projectName || project.name || "Project",
          });
        });
      }

      return merged;
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

  function boot() {
    syncProjectSelectionForEnterprise(true);
    syncHeaderBadges();
    const routePart = location.hash.replace("#app", "") || "#/onboarding";
    if (routePart.startsWith("#/project/")) {
      const projectId = decodeURIComponent(routePart.slice("#/project/".length));
      if (!projectBelongsToActiveEnterprise(projectId)) {
        toast("Project-enterprise mismatch. Please select a valid project.");
        navigateTo("view-workflows");
        return;
      }
      selectedPreviewProjectId = projectId;
      activateNavByView("");
      activateProjectSubtab(projectId);
      showView("view-project-preview");
    } else {
      const viewId = routes[routePart] || "view-onboard";
      activateNavByView(viewId);
      activateProjectSubtab("");
      showView(viewId);
    }

    updateCodexCostEstimate();
  }

  boot();
})();
