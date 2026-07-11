// ===============================================
// IG GUARDED MODE POPUP
// ===============================================

let followersState = {
  isRunning: false,
  trackedCount: 0,
  failedCount: 0,
  totalToFollow: 0,
  usersList: [],
  awaitingApproval: false,
  pendingBatch: [],
  currentBatchId: null
};

let likersState = {
  isRunning: false,
  trackedCount: 0,
  failedCount: 0,
  totalToFollow: 0,
  usersList: [],
  awaitingApproval: false,
  pendingBatch: [],
  currentBatchId: null
};

let activeMode = "followers";

// ---------------- INIT ----------------
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["followersState", "likersState"], (res) => {
    if (res.followersState) followersState = res.followersState;
    if (res.likersState) likersState = res.likersState;

    bindUI();
    updateAllUI();
  });
});

// ---------------- MESSAGE LISTENER ----------------
chrome.runtime.onMessage.addListener((request) => {
  const action = request?.action;

  if (action === "updateFollowersProgress") {
    followersState.trackedCount = request.trackedCount || 0;
    followersState.failedCount = request.failedCount || 0;
    updateFollowersUI();
    saveStates();
  }

  if (action === "updateLikersProgress") {
    likersState.trackedCount = request.trackedCount || 0;
    likersState.failedCount = request.failedCount || 0;
    updateLikersUI();
    saveStates();
  }

  if (action === "batchApprovalRequired") {
    const mode = request.mode || activeMode;
    activeMode = mode;

    const state = mode === "followers" ? followersState : likersState;
    state.awaitingApproval = true;
    state.pendingBatch = Array.isArray(request.users) ? request.users : [];
    state.currentBatchId = request.batchId || null;

    renderBatchApproval(mode, state.pendingBatch, state.currentBatchId);
    showBatchSection(true);
    switchTab(mode);

    saveStates();
  }

  if (action === "flowDone") {
    const mode = request.mode || activeMode;
    const state = mode === "followers" ? followersState : likersState;
    state.isRunning = false;
    state.awaitingApproval = false;
    state.pendingBatch = [];
    state.currentBatchId = null;

    const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
    showStatus(statusId, "✅ Akış tamamlandı", "success");
    showBatchSection(false);

    updateAllUI();
    saveStates();
  }

  if (action === "flowError") {
    const mode = request.mode || activeMode;
    const state = mode === "followers" ? followersState : likersState;
    state.isRunning = false;
    const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
    showStatus(statusId, `❌ ${request.error || "Akış hatası"}`, "error");
    updateAllUI();
    saveStates();
  }

  if (action === "flowStatus") {
    const mode = request.mode || activeMode;
    const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
    const type = request.level === "error" ? "error" : request.level === "success" ? "success" : "info";
    showStatus(statusId, request.message || "", type);
  }
});

// ---------------- UI BIND ----------------
function bindUI() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Followers
  byId("loadFollowersList").addEventListener("click", () => loadList("followers"));
  byId("refreshFollowersList").addEventListener("click", () => loadList("followers"));
  byId("startFollowersBtn").addEventListener("click", () => startMode("followers"));
  byId("stopFollowersBtn").addEventListener("click", () => stopMode("followers"));

  // Likers
  byId("loadLikersList").addEventListener("click", () => loadList("likers"));
  byId("refreshLikersList").addEventListener("click", () => loadList("likers"));
  byId("startLikersBtn").addEventListener("click", () => startMode("likers"));
  byId("stopLikersBtn").addEventListener("click", () => stopMode("likers"));

  // Batch actions
  byId("approveAllBatchBtn").addEventListener("click", () => decideBatch("approve_all"));
  byId("approveSelectedBatchBtn").addEventListener("click", () => approveSelectedBatch());
  byId("approveByScoreBatchBtn").addEventListener("click", () => approveByScoreBatch());
  byId("skipBatchBtn").addEventListener("click", () => decideBatch("skip_batch"));
  byId("stopBatchFlowBtn").addEventListener("click", () => decideBatch("stop"));
}

// ---------------- TABS ----------------
function switchTab(tab) {
  activeMode = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

  document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.classList.add("active");
  byId(tab)?.classList.add("active");
}

// ---------------- LIST LOAD ----------------
function loadList(mode) {
  const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
  showStatus(statusId, "⏳ Liste yükleniyor...", "info");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) {
      showStatus(statusId, "❌ Aktif sekme bulunamadı", "error");
      return;
    }

    chrome.tabs.sendMessage(
      tabs[0].id,
      { action: "loadUsersList", mode },
      (response) => {
        if (chrome.runtime.lastError) {
          showStatus(statusId, "❌ Content script erişilemedi", "error");
          return;
        }

        if (!response?.success) {
          showStatus(statusId, `❌ ${response?.error || "Liste alınamadı"}`, "error");
          return;
        }

        const state = mode === "followers" ? followersState : likersState;
        state.usersList = response.users || [];
        state.totalToFollow = state.usersList.filter((u) => u.status === "follow").length;

        displayUsersList(mode);
        updateAllUI();
        saveStates();

        showStatus(
          statusId,
          `✅ ${state.usersList.length} kullanıcı yüklendi (${state.totalToFollow} aday)`,
          "success"
        );
      }
    );
  });
}

function displayUsersList(mode) {
  const state = mode === "followers" ? followersState : likersState;
  const preview = byId(mode === "followers" ? "followersListPreview" : "likersListPreview");

  preview.innerHTML = state.usersList
    .map((u) => {
      const scoreClass = u.score >= 75 ? "score-high" : u.score >= 50 ? "score-mid" : "score-low";
      return `
      <div class="user-item">
        <div class="user-left">
          <span class="user-name">@${escapeHtml(u.username)}</span>
          <span class="pill ${u.status === "follow" ? "pill-follow" : "pill-following"}">
            ${u.status === "follow" ? "Follow" : "Following"}
          </span>
        </div>
        <span class="pill ${scoreClass}">Skor: ${Number(u.score || 0)}</span>
      </div>`;
    })
    .join("");
}

// ---------------- START/STOP ----------------
function startMode(mode) {
  const state = mode === "followers" ? followersState : likersState;
  const statusId = mode === "followers" ? "followersStatus" : "likersStatus";

  const candidates = state.usersList.filter((u) => u.status === "follow");
  if (!candidates.length) {
    showStatus(statusId, "⚠️ Takip adayı yok. Önce liste yükle.", "error");
    return;
  }

  const cfg = mode === "followers"
    ? {
        batchSize: num("followersBatchSize", 20),
        actionDelayMin: num("followersActionDelayMin", 1800),
        actionDelayMax: num("followersActionDelayMax", 4200)
      }
    : {
        batchSize: num("likersBatchSize", 20),
        actionDelayMin: num("likersActionDelayMin", 1800),
        actionDelayMax: num("likersActionDelayMax", 4200)
      };

  if (cfg.actionDelayMin > cfg.actionDelayMax) {
    showStatus(statusId, "❌ Min gecikme, max gecikmeden büyük olamaz", "error");
    return;
  }

  state.isRunning = true;
  state.trackedCount = 0;
  state.failedCount = 0;
  updateAllUI();
  saveStates();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) {
      showStatus(statusId, "❌ Aktif sekme bulunamadı", "error");
      return;
    }

    chrome.tabs.sendMessage(
      tabs[0].id,
      {
        action: "startGuardedFlow",
        mode,
        users: candidates,
        batchSize: cfg.batchSize,
        actionDelayMin: cfg.actionDelayMin,
        actionDelayMax: cfg.actionDelayMax,
        sessionLimit: 100
      },
      (response) => {
        if (chrome.runtime.lastError) {
          state.isRunning = false;
          updateAllUI();
          saveStates();
          showStatus(statusId, "❌ Başlatılamadı: content script yok", "error");
          return;
        }

        if (!response?.success) {
          state.isRunning = false;
          updateAllUI();
          saveStates();
          showStatus(statusId, `❌ ${response?.error || "Başlatılamadı"}`, "error");
          return;
        }

        showStatus(statusId, `▶️ Guarded akış başladı (${response.total})`, "success");
      }
    );
  });
}

function stopMode(mode) {
  const state = mode === "followers" ? followersState : likersState;
  state.isRunning = false;
  state.awaitingApproval = false;
  state.pendingBatch = [];
  state.currentBatchId = null;

  const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
  showStatus(statusId, "⏹️ Durduruldu", "error");
  showBatchSection(false);

  updateAllUI();
  saveStates();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: "stopFollowing", mode }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[POPUP] stopFollowing error:", chrome.runtime.lastError.message);
        return;
      }
      console.log("[POPUP] stopFollowing response:", response);
    });
  });
}

// ---------------- BATCH APPROVAL UI ----------------
function renderBatchApproval(mode, users, batchId) {
  byId("batchModeBadge").textContent = `Mode: ${mode}`;
  byId("batchIdBadge").textContent = `Batch: ${batchId || "-"}`;
  byId("batchCountBadge").textContent = `${users.length} kullanıcı`;

  const list = byId("batchUsersList");
  list.innerHTML = users.map((u, i) => {
    const score = Number(u.score || 0);
    const scoreClass = score >= 75 ? "score-high" : score >= 50 ? "score-mid" : "score-low";
    return `
      <div class="batch-user-item">
        <div class="batch-user-left">
          <input type="checkbox" class="batch-checkbox" data-username="${escapeAttr(u.username)}" checked />
          <span class="user-name">@${escapeHtml(u.username)}</span>
        </div>
        <div class="batch-user-right">
          <span class="pill ${scoreClass}">${score}</span>
          <span class="pill">${escapeHtml(u.risk || "medium")}</span>
        </div>
      </div>
    `;
  }).join("");

  byId("batchStatus").textContent = "Batch onayı bekleniyor...";
  byId("batchStatus").className = "status info";
}

function showBatchSection(show) {
  byId("batchApprovalSection").classList.toggle("hidden", !show);
}

function decideBatch(decision) {
  const mode = activeMode;
  const state = mode === "followers" ? followersState : likersState;
  if (!state.currentBatchId) return;

  sendDecision({
    action: "batchApprovalDecision",
    batchId: state.currentBatchId,
    decision
  });

  afterDecisionCleanup(mode, decision);
}

function approveSelectedBatch() {
  const mode = activeMode;
  const state = mode === "followers" ? followersState : likersState;
  if (!state.currentBatchId) return;

  const selected = Array.from(document.querySelectorAll(".batch-checkbox:checked"))
    .map((el) => el.getAttribute("data-username"))
    .filter(Boolean);

  sendDecision({
    action: "batchApprovalDecision",
    batchId: state.currentBatchId,
    decision: "approve_selected",
    selectedUsernames: selected
  });

  afterDecisionCleanup(mode, "approve_selected");
}

function approveByScoreBatch() {
  const mode = activeMode;
  const state = mode === "followers" ? followersState : likersState;
  if (!state.currentBatchId) return;

  const minScore = num("batchMinScoreInput", 70);

  sendDecision({
    action: "batchApprovalDecision",
    batchId: state.currentBatchId,
    decision: "approve_by_score",
    minScore
  });

  afterDecisionCleanup(mode, "approve_by_score");
}

function sendDecision(payload) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) {
      console.warn("[POPUP] No active tab");
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, payload, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[POPUP] sendDecision error:", chrome.runtime.lastError.message);
        return;
      }
      console.log("[POPUP] Decision response:", response);
    });
  });
}

function afterDecisionCleanup(mode, decision) {
  const state = mode === "followers" ? followersState : likersState;
  state.awaitingApproval = false;
  state.pendingBatch = [];
  state.currentBatchId = null;

  showBatchSection(false);

  const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
  const textMap = {
    approve_all: "✅ Batch onaylandı",
    approve_selected: "✅ Seçili kullanıcılar onaylandı",
    approve_by_score: "✅ Skora göre onaylandı",
    skip_batch: "⏭️ Batch geçildi",
    stop: "⏹️ Akış durduruldu"
  };
  const type = decision === "skip_batch" || decision === "stop" ? "error" : "success";
  showStatus(statusId, textMap[decision] || "Karar gönderildi", type);

  if (decision === "stop") {
    state.isRunning = false;
  }

  updateAllUI();
  saveStates();
}

// ---------------- UI UPDATE ----------------
function updateFollowersUI() {
  byId("followersTotalToFollow").textContent = followersState.totalToFollow;
  byId("followersTrackedCount").textContent = followersState.trackedCount;
  byId("followersFailedCount").textContent = followersState.failedCount;

  const pct = followersState.totalToFollow
    ? Math.min(100, (followersState.trackedCount / followersState.totalToFollow) * 100)
    : 0;
  byId("followersProgressFill").style.width = `${pct}%`;

  byId("startFollowersBtn").classList.toggle("hidden", followersState.isRunning);
  byId("stopFollowersBtn").classList.toggle("hidden", !followersState.isRunning);

  const hasUsers = followersState.usersList.length > 0;
  byId("loadFollowersList").classList.toggle("hidden", hasUsers);
  byId("refreshFollowersList").classList.toggle("hidden", !hasUsers);
}

function updateLikersUI() {
  byId("likersTotalToFollow").textContent = likersState.totalToFollow;
  byId("likersTrackedCount").textContent = likersState.trackedCount;
  byId("likersFailedCount").textContent = likersState.failedCount;

  const pct = likersState.totalToFollow
    ? Math.min(100, (likersState.trackedCount / likersState.totalToFollow) * 100)
    : 0;
  byId("likersProgressFill").style.width = `${pct}%`;

  byId("startLikersBtn").classList.toggle("hidden", likersState.isRunning);
  byId("stopLikersBtn").classList.toggle("hidden", !likersState.isRunning);

  const hasUsers = likersState.usersList.length > 0;
  byId("loadLikersList").classList.toggle("hidden", hasUsers);
  byId("refreshLikersList").classList.toggle("hidden", !hasUsers);
}

function updateAllUI() {
  updateFollowersUI();
  updateLikersUI();

  if (followersState.awaitingApproval || likersState.awaitingApproval) {
    showBatchSection(true);
  }
}

function showStatus(elementId, message, type) {
  const el = byId(elementId);
  el.textContent = message || "";
  el.className = `status ${type}`;
}

function saveStates() {
  chrome.storage.local.set({
    followersState,
    likersState
  });
}

// ---------------- HELPERS ----------------
function byId(id) {
  return document.getElementById(id);
}
function num(id, fallback) {
  const v = Number(byId(id)?.value);
  return Number.isFinite(v) ? v : fallback;
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) {
  return escapeHtml(s).replaceAll('"', "&quot;");
}