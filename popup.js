// ===============================================
// IG AUTO FOLLOW POPUP
// ===============================================

let followersState = {
  isRunning: false,
  trackedCount: 0,
  failedCount: 0,
  totalToFollow: 0,
  usersList: [],
  scanStartScrollTop: 0
};

let likersState = {
  isRunning: false,
  trackedCount: 0,
  failedCount: 0,
  totalToFollow: 0,
  usersList: [],
  scanStartScrollTop: 0
};

let activeMode = "followers";
let activityLog = [];

// ---------------- INIT ----------------
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["followersState", "likersState", "activityLog"], (res) => {
    if (res.followersState) followersState = res.followersState;
    if (res.likersState) likersState = res.likersState;
    if (Array.isArray(res.activityLog)) activityLog = res.activityLog;

    bindUI();
    updateAllUI();
    renderLog();
  });
});

// ---------------- MESSAGE LISTENER ----------------
chrome.runtime.onMessage.addListener((request) => {
  const action = request?.action;

  if (action === "listLoadProgress") {
    const mode = request.mode || activeMode;
    const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
    showStatus(statusId, `⏳ Kaydırılıyor... ${request.step}/${request.maxSteps} — ${request.collected} kullanıcı bulundu`, "info");
  }

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

  if (action === "flowDone") {
    const mode = request.mode || activeMode;
    const state = mode === "followers" ? followersState : likersState;
    state.isRunning = false;

    const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
    showStatus(statusId, "✅ Akış tamamlandı", "success");

    appendLog("success", `✅ [${modeLabel(mode)}] Akış tamamlandı — ${request.trackedCount || 0} takip, ${request.failedCount || 0} başarısız`);

    updateAllUI();
    saveStates();
  }

  if (action === "flowError") {
    const mode = request.mode || activeMode;
    const state = mode === "followers" ? followersState : likersState;
    state.isRunning = false;
    const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
    showStatus(statusId, `❌ ${request.error || "Akış hatası"}`, "error");

    appendLog("error", `❌ [${modeLabel(mode)}] Hata: ${request.error || "bilinmeyen hata"}`);

    updateAllUI();
    saveStates();
  }

  if (action === "flowStatus") {
    const mode = request.mode || activeMode;
    const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
    const type = request.level === "error" ? "error" : request.level === "success" ? "success" : "info";
    showStatus(statusId, request.message || "", type);

    appendLog(type, `[${modeLabel(mode)}] ${request.message || ""}`);
  }
});

// ---------------- UI BIND ----------------
function bindUI() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  byId("loadFollowersList").addEventListener("click", () => loadList("followers"));
  byId("refreshFollowersList").addEventListener("click", () => loadList("followers"));
  byId("startFollowersBtn").addEventListener("click", () => startMode("followers"));
  byId("stopFollowersBtn").addEventListener("click", () => stopMode("followers"));

  byId("loadLikersList").addEventListener("click", () => loadList("likers"));
  byId("refreshLikersList").addEventListener("click", () => loadList("likers"));
  byId("startLikersBtn").addEventListener("click", () => startMode("likers"));
  byId("stopLikersBtn").addEventListener("click", () => stopMode("likers"));

  byId("clearLogBtn").addEventListener("click", clearLog);
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
  const scrollSteps = num(mode === "followers" ? "followersScrollSteps" : "likersScrollSteps", 15);
  showStatus(statusId, `⏳ Liste yükleniyor... (${scrollSteps} adım)`, "info");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) {
      showStatus(statusId, "❌ Aktif sekme bulunamadı", "error");
      appendLog("error", `[${modeLabel(mode)}] Aktif sekme bulunamadı`);
      return;
    }

    chrome.tabs.sendMessage(
      tabs[0].id,
      { action: "loadUsersList", mode, scrollSteps },
      (response) => {
        if (chrome.runtime.lastError) {
          showStatus(statusId, "❌ Content script erişilemedi. Instagram sekmesini yenile.", "error");
          appendLog("error", `[${modeLabel(mode)}] Content script erişilemedi`);
          return;
        }

        if (!response?.success) {
          showStatus(statusId, `❌ ${response?.error || "Liste alınamadı"}`, "error");
          appendLog("error", `[${modeLabel(mode)}] Liste alınamadı: ${response?.error || "bilinmeyen hata"}`);
          return;
        }

        const state = mode === "followers" ? followersState : likersState;
        state.usersList = response.users || [];
        state.totalToFollow = state.usersList.filter((u) => u.status === "follow").length;
        state.scanStartScrollTop = Math.max(0, Number(response.scanStartScrollTop) || 0);

        displayUsersList(mode);
        updateAllUI();
        saveStates();

        const msg = `✅ ${state.usersList.length} kullanıcı yüklendi — ${state.totalToFollow} kişi takip edilecek`;
        showStatus(statusId, msg, "success");
        appendLog("success", `[${modeLabel(mode)}] ${state.usersList.length} kullanıcı yüklendi, ${state.totalToFollow} takip adayı`);
      }
    );
  });
}

function displayUsersList(mode) {
  const state = mode === "followers" ? followersState : likersState;
  const preview = byId(mode === "followers" ? "followersListPreview" : "likersListPreview");

  preview.innerHTML = state.usersList
    .map((u) => `
      <div class="user-item">
        <span class="user-name">@${escapeHtml(u.username)}</span>
        <span class="pill ${u.status === "follow" ? "pill-follow" : "pill-following"}">
          ${u.status === "follow" ? "Takip Et" : "Takipte"}
        </span>
      </div>`)
    .join("");
}

// ---------------- START/STOP ----------------
function startMode(mode) {
  const state = mode === "followers" ? followersState : likersState;
  const statusId = mode === "followers" ? "followersStatus" : "likersStatus";

  const candidates = state.usersList.filter((u) => u.status === "follow");
  if (!candidates.length) {
    showStatus(statusId, "⚠️ Takip adayı yok. Önce listeyi yükle.", "error");
    return;
  }

  const cfg = mode === "followers"
    ? {
        actionDelayMin: num("followersActionDelayMin", 1800),
        actionDelayMax: num("followersActionDelayMax", 4200)
      }
    : {
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

  appendLog("info", `▶️ [${modeLabel(mode)}] Akış başlatıldı — ${candidates.length} kullanıcı`);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) {
      state.isRunning = false;
      updateAllUI();
      showStatus(statusId, "❌ Aktif sekme bulunamadı", "error");
      appendLog("error", `[${modeLabel(mode)}] Başlatılamadı: aktif sekme yok`);
      return;
    }

    chrome.tabs.sendMessage(
      tabs[0].id,
      {
        action: "startFlow",
        mode,
        users: candidates,
        actionDelayMin: cfg.actionDelayMin,
        actionDelayMax: cfg.actionDelayMax,
        sessionLimit: 100,
        scanStartScrollTop: Math.max(0, Number(state.scanStartScrollTop) || 0)
      },
      (response) => {
        if (chrome.runtime.lastError) {
          state.isRunning = false;
          updateAllUI();
          saveStates();
          showStatus(statusId, "❌ Başlatılamadı. Instagram sekmesini yenile.", "error");
          appendLog("error", `[${modeLabel(mode)}] Başlatılamadı: content script erişilemedi`);
          return;
        }

        if (!response?.success) {
          state.isRunning = false;
          updateAllUI();
          saveStates();
          showStatus(statusId, `❌ ${response?.error || "Başlatılamadı"}`, "error");
          appendLog("error", `[${modeLabel(mode)}] Başlatılamadı: ${response?.error || "bilinmeyen"}`);
          return;
        }

        showStatus(statusId, `▶️ Takip başladı — ${response.total} kullanıcı`, "success");
      }
    );
  });
}

function stopMode(mode) {
  const state = mode === "followers" ? followersState : likersState;
  state.isRunning = false;

  const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
  showStatus(statusId, "⏹️ Durduruldu", "error");
  appendLog("info", `⏹️ [${modeLabel(mode)}] Akış kullanıcı tarafından durduruldu`);

  updateAllUI();
  saveStates();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: "stopFollowing", mode }, () => {
      if (chrome.runtime.lastError) console.warn("[POPUP] stop error:", chrome.runtime.lastError.message);
    });
  });
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
}

function showStatus(elementId, message, type) {
  const el = byId(elementId);
  el.textContent = message || "";
  el.className = `status ${type}`;
}

function saveStates() {
  chrome.storage.local.set({ followersState, likersState });
}

// ---------------- LOG ----------------
function appendLog(type, message) {
  const entry = { time: Date.now(), type, message };
  activityLog.unshift(entry);
  if (activityLog.length > 200) activityLog.length = 200;
  chrome.storage.local.set({ activityLog });
  renderLog();
}

function renderLog() {
  const list = byId("logList");
  if (!list) return;

  if (!activityLog.length) {
    list.innerHTML = '<div class="log-empty">Henüz kayıt yok.</div>';
    return;
  }

  list.innerHTML = activityLog.map((entry) => {
    const d = new Date(entry.time);
    const time = d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })
      + " " + d.toTimeString().slice(0, 8);
    return `<div class="log-entry log-${entry.type}">
      <span class="log-time">${escapeHtml(time)}</span>
      <span class="log-msg">${escapeHtml(entry.message)}</span>
    </div>`;
  }).join("");
}

function clearLog() {
  activityLog = [];
  chrome.storage.local.set({ activityLog: [] });
  renderLog();
}

// ---------------- HELPERS ----------------
function byId(id) { return document.getElementById(id); }
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
function modeLabel(mode) {
  return mode === "followers" ? "Takipçiler" : "Beğenenler";
}
