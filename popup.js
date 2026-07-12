// ===============================================
// IG AUTO FOLLOW POPUP
// ===============================================

let followersState = {
  isRunning: false,
  trackedCount: 0,
  failedCount: 0,
  totalToFollow: 0,
  usersList: [],
  scanStartScrollTop: 0,
  resumeScrollTop: 0,
  sessionLimit: 300,
  consecutiveFailLimit: 5,
  consecutiveFailLimitEnabled: true
};

let likersState = {
  isRunning: false,
  trackedCount: 0,
  failedCount: 0,
  totalToFollow: 0,
  usersList: [],
  scanStartScrollTop: 0,
  resumeScrollTop: 0,
  sessionLimit: 300,
  consecutiveFailLimit: 5,
  consecutiveFailLimitEnabled: true
};

let analysisState = {
  followersList: [],
  followingList: []
};

let activeMode = "followers";
let activityLog = [];
let blacklist = [];

// ---------------- INIT ----------------
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["followersState", "likersState", "activityLog", "analysisState", "blacklist"], (res) => {
    if (res.followersState) followersState = { ...followersState, ...res.followersState };
    if (res.likersState) likersState = { ...likersState, ...res.likersState };
    if (Array.isArray(res.activityLog)) activityLog = res.activityLog;
    if (res.analysisState) analysisState = { ...analysisState, ...res.analysisState };
    blacklist = normalizeBlacklist(res.blacklist || []);

    bindUI();
    applyModeSettingsToInputs("followers");
    applyModeSettingsToInputs("likers");
    renderBlacklist();
    updateAllUI();
    renderLog();
    updateAnalysisUI();
    updateGeriTakipUI();
  });
});

// ---------------- MESSAGE LISTENER ----------------
chrome.runtime.onMessage.addListener((request) => {
  const action = request?.action;

  if (action === "listLoadProgress") {
    const mode = request.mode || activeMode;
    let statusId;
    if (mode === "analysis-followers") statusId = "analizStatus";
    else if (mode === "analysis-following") statusId = "geritakipStatus";
    else statusId = mode === "followers" ? "followersStatus" : "likersStatus";
    showStatus(statusId, `⏳ Kaydırılıyor... ${request.step}/${request.maxSteps} — ${request.collected} kullanıcı bulundu`, "info");
  }

  if (action === "updateFollowersProgress") {
    followersState.trackedCount = request.trackedCount || 0;
    followersState.failedCount = request.failedCount || 0;
    if (request.lastFailedUsername) addToBlacklist(request.lastFailedUsername, "followers");
    if (request.lastScrollTop !== undefined) {
      followersState.resumeScrollTop = Number(request.lastScrollTop) || 0;
    }
    updateFollowersUI();
    saveStates();
  }

  if (action === "updateLikersProgress") {
    likersState.trackedCount = request.trackedCount || 0;
    likersState.failedCount = request.failedCount || 0;
    if (request.lastFailedUsername) addToBlacklist(request.lastFailedUsername, "likers");
    if (request.lastScrollTop !== undefined) {
      likersState.resumeScrollTop = Number(request.lastScrollTop) || 0;
    }
    updateLikersUI();
    saveStates();
  }

  if (action === "flowDone") {
    const mode = request.mode || activeMode;
    const state = mode === "followers" ? followersState : likersState;
    state.isRunning = false;
    if (Array.isArray(request.failedUsernames)) {
      request.failedUsernames.forEach((username) => addToBlacklist(username, mode));
    }
    if (request.lastScrollTop !== undefined) {
      state.resumeScrollTop = Number(request.lastScrollTop) || 0;
    }

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
  byId("followersConsecutiveFailLimitEnabled").addEventListener("change", () => onModeSettingsChange("followers"));
  byId("followersConsecutiveFailLimit").addEventListener("change", () => onModeSettingsChange("followers"));
  byId("followersSessionLimit").addEventListener("change", () => onModeSettingsChange("followers"));

  byId("loadLikersList").addEventListener("click", () => loadList("likers"));
  byId("refreshLikersList").addEventListener("click", () => loadList("likers"));
  byId("startLikersBtn").addEventListener("click", () => startMode("likers"));
  byId("stopLikersBtn").addEventListener("click", () => stopMode("likers"));
  byId("likersConsecutiveFailLimitEnabled").addEventListener("change", () => onModeSettingsChange("likers"));
  byId("likersConsecutiveFailLimit").addEventListener("change", () => onModeSettingsChange("likers"));
  byId("likersSessionLimit").addEventListener("change", () => onModeSettingsChange("likers"));

  byId("scanFollowersBtn").addEventListener("click", () => loadAnalysisScan("followers"));
  byId("scanFollowingBtn").addEventListener("click", () => loadAnalysisScan("following"));

  byId("saveBlacklistBtn").addEventListener("click", saveBlacklistFromInput);
  byId("clearBlacklistBtn").addEventListener("click", clearBlacklist);
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
  const state = mode === "followers" ? followersState : likersState;
  const statusId = mode === "followers" ? "followersStatus" : "likersStatus";
  const scrollSteps = num(mode === "followers" ? "followersScrollSteps" : "likersScrollSteps", 15);

  // On refresh, resume scanning from where the flow last left off so scroll order is preserved.
  const isRefresh = state.usersList.length > 0;
  const resumeScrollTop = isRefresh ? (state.resumeScrollTop || 0) : 0;

  showStatus(statusId, `⏳ Liste yükleniyor... (${scrollSteps} adım)`, "info");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) {
      showStatus(statusId, "❌ Aktif sekme bulunamadı", "error");
      appendLog("error", `[${modeLabel(mode)}] Aktif sekme bulunamadı`);
      return;
    }

    chrome.tabs.sendMessage(
      tabs[0].id,
      { action: "loadUsersList", mode, scrollSteps, resumeScrollTop },
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

        const loadedUsers = response.users || [];
        const blacklistSet = new Set(blacklist);
        state.usersList = loadedUsers.filter((u) => !blacklistSet.has(normalizeUsername(u.username)));
        state.totalToFollow = state.usersList.filter((u) => u.status === "follow").length;
        state.scanStartScrollTop = Math.max(0, Number(response.scanStartScrollTop) || 0);

        displayUsersList(mode);
        updateAllUI();
        saveStates();

        const filteredCount = Math.max(0, loadedUsers.length - state.usersList.length);
        const filteredText = filteredCount ? `, ${filteredCount} blacklist nedeniyle atlandı` : "";
        const msg = `✅ ${state.usersList.length} kullanıcı yüklendi — ${state.totalToFollow} kişi takip edilecek${filteredText}`;
        showStatus(statusId, msg, "success");
        appendLog("success", `[${modeLabel(mode)}] ${state.usersList.length} kullanıcı yüklendi, ${state.totalToFollow} takip adayı${filteredText}`);
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
  syncModeSettingsFromInputs(mode);

  const candidates = state.usersList.filter((u) => u.status === "follow");
  if (!candidates.length) {
    showStatus(statusId, "⚠️ Takip adayı yok. Önce listeyi yükle.", "error");
    return;
  }

  const cfg = mode === "followers"
    ? {
        actionDelayMin: num("followersActionDelayMin", 1800),
        actionDelayMax: num("followersActionDelayMax", 4200),
        consecutiveFailLimit: num("followersConsecutiveFailLimit", 5),
        consecutiveFailLimitEnabled: !!byId("followersConsecutiveFailLimitEnabled")?.checked,
        sessionLimit: num("followersSessionLimit", 300)
      }
    : {
        actionDelayMin: num("likersActionDelayMin", 1800),
        actionDelayMax: num("likersActionDelayMax", 4200),
        consecutiveFailLimit: num("likersConsecutiveFailLimit", 5),
        consecutiveFailLimitEnabled: !!byId("likersConsecutiveFailLimitEnabled")?.checked,
        sessionLimit: num("likersSessionLimit", 300)
      };

  if (cfg.actionDelayMin > cfg.actionDelayMax) {
    showStatus(statusId, "❌ Min gecikme, max gecikmeden büyük olamaz", "error");
    return;
  }
  if (cfg.sessionLimit < 1) {
    showStatus(statusId, "❌ Başarılı işlem limiti en az 1 olmalı", "error");
    return;
  }

  state.isRunning = true;
  state.trackedCount = 0;
  state.failedCount = 0;
  state.sessionLimit = cfg.sessionLimit;
  state.consecutiveFailLimit = cfg.consecutiveFailLimit;
  state.consecutiveFailLimitEnabled = cfg.consecutiveFailLimitEnabled;
  updateAllUI();
  saveStates();

  appendLog("info", `▶️ [${modeLabel(mode)}] Akış başlatıldı — ${candidates.length} kullanıcı, başarılı limit ${cfg.sessionLimit}`);

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
        consecutiveFailLimit: cfg.consecutiveFailLimit,
        consecutiveFailLimitEnabled: cfg.consecutiveFailLimitEnabled,
        sessionLimit: cfg.sessionLimit,
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

// ---------------- ANALYSIS SCAN ----------------
function loadAnalysisScan(scanType) {
  const isFollowers = scanType === "followers";
  const statusId = isFollowers ? "analizStatus" : "geritakipStatus";
  const mode = isFollowers ? "analysis-followers" : "analysis-following";
  const scrollSteps = num(isFollowers ? "analizFollowersScrollSteps" : "analizFollowingScrollSteps", 30);

  showStatus(statusId, `⏳ Taranıyor... (${scrollSteps} adım)`, "info");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.length) {
      showStatus(statusId, "❌ Aktif sekme bulunamadı", "error");
      return;
    }

    chrome.tabs.sendMessage(
      tabs[0].id,
      { action: "loadUsersList", mode, scrollSteps },
      (response) => {
        if (chrome.runtime.lastError) {
          showStatus(statusId, "❌ Content script erişilemedi. Instagram sekmesini yenile.", "error");
          return;
        }

        if (!response?.success) {
          showStatus(statusId, `❌ ${response?.error || "Tarama başarısız"}`, "error");
          return;
        }

        const users = response.users || [];
        if (isFollowers) {
          analysisState.followersList = users;
          showStatus(statusId, `✅ ${users.length} takipçi tarandı`, "success");
          appendLog("success", `[Analiz] Takipçi taraması tamamlandı: ${users.length} kullanıcı`);
        } else {
          analysisState.followingList = users;
          showStatus(statusId, `✅ ${users.length} kişi tarandı`, "success");
          appendLog("success", `[Analiz] Takip edilen taraması tamamlandı: ${users.length} kullanıcı`);
        }

        saveStates();
        updateAnalysisUI();
        updateGeriTakipUI();
      }
    );
  });
}

// Cross-reference followers and following lists.
// Returns { mutuals, onlyFollowers, notFollowingBack }
function computeAnalysis() {
  const followersSet = new Set(analysisState.followersList.map((u) => u.username));

  // From followers list: mutual = you follow them back; onlyFollowers = you don't
  const mutuals = analysisState.followersList.filter((u) => u.status === "following");
  const onlyFollowers = analysisState.followersList.filter((u) => u.status === "follow");

  // From following list: those NOT in your followers list don't follow you back
  const notFollowingBack = analysisState.followingList.filter((u) => !followersSet.has(u.username));

  return { mutuals, onlyFollowers, notFollowingBack };
}

function updateAnalysisUI() {
  const count = analysisState.followersList.length;
  if (count === 0) {
    byId("analizResultsSection").classList.add("hidden");
    return;
  }

  const { mutuals, onlyFollowers } = computeAnalysis();
  byId("analizFollowersCount").textContent = count;
  byId("analizMutualCount").textContent = mutuals.length;
  byId("analizOnlyFollowersCount").textContent = onlyFollowers.length;
  byId("analizResultsSection").classList.remove("hidden");
  renderAnalysisList("analizOnlyFollowersList", onlyFollowers);
}

function updateGeriTakipUI() {
  const followingCount = analysisState.followingList.length;
  const followersCount = analysisState.followersList.length;

  if (followingCount === 0) {
    byId("geritakipResultsSection").classList.add("hidden");
    byId("geritakipWarning").classList.add("hidden");
    return;
  }

  byId("geritakipFollowingCount").textContent = followingCount;

  if (followersCount === 0) {
    // Can still show following count but can't compute non-reciprocal
    byId("geritakipWarning").classList.remove("hidden");
    byId("geritakipNFBCount").textContent = "—";
    byId("geritakipMutualCount").textContent = "—";
    byId("geritakipResultsSection").classList.remove("hidden");
    byId("geritakipList").innerHTML = '<div class="list-empty">Karşılaştırma için önce Analiz sekmesinde takipçileri tarayın.</div>';
    return;
  }

  byId("geritakipWarning").classList.add("hidden");
  const { notFollowingBack, mutuals } = computeAnalysis();
  byId("geritakipNFBCount").textContent = notFollowingBack.length;
  byId("geritakipMutualCount").textContent = mutuals.length;
  byId("geritakipResultsSection").classList.remove("hidden");
  renderAnalysisList("geritakipList", notFollowingBack);
}

function renderAnalysisList(elementId, users) {
  const el = byId(elementId);
  if (!el) return;

  if (!users.length) {
    el.innerHTML = '<div class="list-empty">Sonuç bulunamadı. 🎉</div>';
    return;
  }

  el.innerHTML = users
    .map((u) => `
      <div class="user-item">
        <span class="user-name">@${escapeHtml(u.username)}</span>
      </div>`)
    .join("");
}

// ---------------- UI UPDATE ----------------
function updateFollowersUI() {
  applyModeSettingsToInputs("followers");
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
  applyModeSettingsToInputs("likers");
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
  if (!el) return;
  el.textContent = message || "";
  el.className = `status ${type}`;
}

function saveStates() {
  chrome.storage.local.set({ followersState, likersState, analysisState, blacklist });
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

function onModeSettingsChange(mode) {
  syncModeSettingsFromInputs(mode);
  applyModeSettingsToInputs(mode);
  saveStates();
}

function syncModeSettingsFromInputs(mode) {
  const state = mode === "followers" ? followersState : likersState;
  const prefix = mode === "followers" ? "followers" : "likers";
  state.consecutiveFailLimit = Math.max(1, num(`${prefix}ConsecutiveFailLimit`, 5));
  state.sessionLimit = Math.max(1, num(`${prefix}SessionLimit`, 300));
  state.consecutiveFailLimitEnabled = !!byId(`${prefix}ConsecutiveFailLimitEnabled`)?.checked;
}

function applyModeSettingsToInputs(mode) {
  const state = mode === "followers" ? followersState : likersState;
  const prefix = mode === "followers" ? "followers" : "likers";
  const failLimitInput = byId(`${prefix}ConsecutiveFailLimit`);
  const failEnabledInput = byId(`${prefix}ConsecutiveFailLimitEnabled`);
  const sessionLimitInput = byId(`${prefix}SessionLimit`);
  if (!failLimitInput || !failEnabledInput || !sessionLimitInput) return;

  failLimitInput.value = String(Math.max(1, Number(state.consecutiveFailLimit) || 5));
  sessionLimitInput.value = String(Math.max(1, Number(state.sessionLimit) || 300));
  failEnabledInput.checked = state.consecutiveFailLimitEnabled !== false;
  failLimitInput.disabled = !failEnabledInput.checked;
}

function normalizeBlacklist(list) {
  const uniq = new Set();
  for (const item of list || []) {
    const normalized = normalizeUsername(item);
    if (normalized) uniq.add(normalized);
  }
  return Array.from(uniq);
}

function normalizeUsername(username) {
  return String(username || "").trim().replace(/^@+/, "").toLowerCase();
}

function renderBlacklist() {
  const input = byId("blacklistInput");
  if (!input) return;
  input.value = blacklist.join("\n");
}

function saveBlacklistFromInput() {
  const raw = byId("blacklistInput")?.value || "";
  blacklist = normalizeBlacklist(raw.split(/\r?\n/));
  saveStates();
  renderBlacklist();
  appendLog("success", `✅ [Blacklist] ${blacklist.length} kullanıcı kaydedildi`);
}

function clearBlacklist() {
  blacklist = [];
  saveStates();
  renderBlacklist();
  appendLog("info", "🧹 [Blacklist] Temizlendi");
}

function addToBlacklist(username, mode) {
  const normalized = normalizeUsername(username);
  if (!normalized) return;
  if (blacklist.includes(normalized)) return;
  blacklist.push(normalized);
  blacklist.sort();
  renderBlacklist();
  saveStates();
  appendLog("info", `🚫 [${modeLabel(mode)}] Başarısız kullanıcı blacklist'e eklendi: @${normalized}`);
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
