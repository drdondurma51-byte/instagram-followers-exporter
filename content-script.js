// ===============================================
// IG GUARDED MODE CONTENT SCRIPT
// ===============================================

const FLOW = {
  isRunning: false,
  mode: null, // followers | likers
  queue: [],
  processed: 0,
  tracked: 0,
  failed: 0,
  batchSize: 20,
  batchIndex: 0,
  waitingApproval: false,
  currentBatch: [],
  currentBatchId: null,
  actionDelayMin: 1800,
  actionDelayMax: 4200,
  cooldownMin: 20000,
  cooldownMax: 60000,
  sessionLimit: 100,
  consecutiveFailLimit: 3,
  consecutiveFails: 0
};

let pendingDecisionResolver = null;

console.log("🚀 IG Guarded content-script loaded");

// ---------------- MESSAGE LISTENER ----------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request?.action;

  if (action === "loadUsersList") {
    const result = loadUsersList(request.mode);
    sendResponse(result);
    return true;
  }

  if (action === "startGuardedFlow") {
    startGuardedFlow(request)
      .then((res) => sendResponse(res))
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (action === "batchApprovalDecision") {
    if (pendingDecisionResolver) {
      pendingDecisionResolver(request);
      pendingDecisionResolver = null;
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "No pending approval resolver" });
    }
    return true;
  }

  if (action === "stopFollowing") {
    FLOW.isRunning = false;
    FLOW.waitingApproval = false;
    if (pendingDecisionResolver) {
      pendingDecisionResolver({ decision: "stop" });
      pendingDecisionResolver = null;
    }
    sendResponse({ success: true });
    return true;
  }

  sendResponse({ success: false, error: "Unknown action" });
  return true;
});

// ---------------- LIST LOAD ----------------
function loadUsersList(mode) {
  try {
    const modal = getActiveModal();
    if (!modal) {
      return {
        success: false,
        error: 'Modal bulunamadı. Lütfen "Takipçiler" veya beğeni modalını açın.'
      };
    }

    const users = extractUsersList(modal, mode);
    if (!users.length) {
      return {
        success: false,
        error: "Modal açık ama kullanıcı bulunamadı. Biraz aşağı kaydırıp tekrar deneyin."
      };
    }

    return {
      success: true,
      mode,
      users
    };
  } catch (error) {
    return {
      success: false,
      error: `Liste yükleme hatası: ${error.message}`
    };
  }
}

// ---------------- FLOW START ----------------
async function startGuardedFlow(payload) {
  const {
    mode,
    users,
    actionDelayMin = 1800,
    actionDelayMax = 4200,
    batchSize = 20,
    sessionLimit = 100
  } = payload || {};

  if (!Array.isArray(users) || users.length === 0) {
    return { success: false, error: "Takip edilecek kullanıcı yok." };
  }

  FLOW.isRunning = true;
  FLOW.mode = mode || "followers";
  FLOW.queue = users.map((u) => ({
    username: u.username,
    score: Number(u.score || 50),
    risk: u.risk || "medium"
  }));
  FLOW.processed = 0;
  FLOW.tracked = 0;
  FLOW.failed = 0;
  FLOW.batchSize = Math.max(1, Number(batchSize || 20));
  FLOW.batchIndex = 0;
  FLOW.waitingApproval = false;
  FLOW.currentBatch = [];
  FLOW.currentBatchId = null;
  FLOW.actionDelayMin = Number(actionDelayMin);
  FLOW.actionDelayMax = Number(actionDelayMax);
  FLOW.sessionLimit = Number(sessionLimit);
  FLOW.consecutiveFails = 0;

  runFlow().catch((e) => {
    safeSendMessage({
      action: "flowError",
      mode: FLOW.mode,
      error: e.message
    });
    FLOW.isRunning = false;
  });

  return {
    success: true,
    total: FLOW.queue.length,
    mode: FLOW.mode
  };
}

// ---------------- MAIN FLOW ----------------
async function runFlow() {
  while (FLOW.isRunning && FLOW.queue.length > 0) {
    if (FLOW.processed >= FLOW.sessionLimit) {
      await emitStatus("Session limit reached, flow paused.", "info");
      FLOW.isRunning = false;
      break;
    }

    FLOW.batchIndex += 1;
    const batch = FLOW.queue.splice(0, FLOW.batchSize);
    FLOW.currentBatch = batch;
    FLOW.currentBatchId = `${FLOW.mode}-${Date.now()}-${FLOW.batchIndex}`;

    FLOW.waitingApproval = true;
    const decision = await askBatchApproval(batch, FLOW.currentBatchId, FLOW.mode);
    FLOW.waitingApproval = false;

    if (!FLOW.isRunning) break;

    const approved = applyDecision(batch, decision);
    if (decision?.decision === "stop") {
      FLOW.isRunning = false;
      break;
    }

    for (const item of approved) {
      if (!FLOW.isRunning) break;

      const ok = clickFollowButton(item.username);
      FLOW.processed += 1;

      if (ok) {
        FLOW.tracked += 1;
        FLOW.consecutiveFails = 0;
      } else {
        FLOW.failed += 1;
        FLOW.consecutiveFails += 1;
      }

      await emitProgress();
      await sleep(rand(FLOW.actionDelayMin, FLOW.actionDelayMax));

      if (FLOW.consecutiveFails >= FLOW.consecutiveFailLimit) {
        await emitStatus("Ardışık hata limiti aşıldı. Akış durduruldu.", "error");
        FLOW.isRunning = false;
        break;
      }
    }

    if (!FLOW.isRunning) break;

    await sleep(rand(FLOW.cooldownMin, FLOW.cooldownMax));
  }

  await emitDone();
  FLOW.isRunning = false;
}

// ---------------- APPROVAL ----------------
function askBatchApproval(batch, batchId, mode) {
  return new Promise((resolve) => {
    pendingDecisionResolver = resolve;

    safeSendMessage({
      action: "batchApprovalRequired",
      mode,
      batchId,
      users: batch
    });
  });
}

function applyDecision(batch, decision) {
  const d = decision?.decision;

  if (d === "approve_all") return batch;
  if (d === "skip_batch") return [];
  if (d === "stop") return [];

  if (d === "approve_selected") {
    const set = new Set(decision.selectedUsernames || []);
    return batch.filter((u) => set.has(u.username));
  }

  if (d === "approve_by_score") {
    const min = Number(decision.minScore || 70);
    return batch.filter((u) => Number(u.score || 0) >= min);
  }

  return [];
}

// ---------------- MODAL + EXTRACTION ----------------
function getActiveModal() {
  let modal = document.querySelector('[role="dialog"]');
  if (modal) return modal;

  const dialogs = document.querySelectorAll('[role="dialog"]');
  if (dialogs.length) return dialogs[dialogs.length - 1];

  modal = document.querySelector('div[class*="Modal"]');
  if (modal) return modal;

  modal = document.querySelector('[data-testid="modal"]');
  if (modal) return modal;

  return null;
}

function extractUsersList(modal) {
  const users = [];
  const seen = new Set();

  let containers = modal.querySelectorAll("li");
  if (!containers.length) containers = modal.querySelectorAll('div[role="presentation"]');
  if (!containers.length) containers = modal.querySelectorAll("div");

  containers.forEach((container) => {
    try {
      const link = container.querySelector('a[href^="/"]');
      const button = container.querySelector("button");
      if (!link || !button) return;

      const href = link.getAttribute("href") || "";
      const username = (href.split("/")[1] || "").trim();

      if (!isValidUsername(username)) return;
      if (seen.has(username)) return;

      const buttonText = (button.textContent || "").toLowerCase().trim();
      const alreadyFollowing =
        buttonText.includes("following") ||
        buttonText.includes("pending") ||
        buttonText.includes("requested") ||
        buttonText.includes("takipte");

      const score = scoreUser(username, alreadyFollowing);
      const risk = riskLevel(score);

      users.push({
        username,
        status: alreadyFollowing ? "following" : "follow",
        score,
        risk
      });

      seen.add(username);
    } catch (_) {}
  });

  return users;
}

function isValidUsername(username) {
  if (!username) return false;
  if (username.length < 2) return false;
  if (!/^[a-zA-Z0-9._]+$/.test(username)) return false;

  const blocked = new Set(["explore", "p", "direct", "stories", "notifications", "your", "accounts"]);
  if (blocked.has(username)) return false;

  return true;
}

function scoreUser(username, alreadyFollowing) {
  if (alreadyFollowing) return 0;

  let score = 50;

  if (username.length >= 4 && username.length <= 15) score += 10;
  if (username.includes("_")) score -= 3;
  if (/\d{4,}/.test(username)) score -= 8;
  if (/^[a-zA-Z]+$/.test(username)) score += 8;
  if (username.split(".").length > 2) score -= 6;

  return Math.max(0, Math.min(100, score));
}

function riskLevel(score) {
  if (score >= 75) return "low";
  if (score >= 50) return "medium";
  return "high";
}

// ---------------- FOLLOW CLICK ----------------
function clickFollowButton(username) {
  try {
    const links = document.querySelectorAll('a[href^="/"]');

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const linkUsername = href.split("/")[1] || "";
      if (linkUsername !== username) continue;

      const container =
        link.closest("li") ||
        link.closest('div[role="presentation"]') ||
        link.closest('[role="dialog"] div');

      if (!container) continue;

      const button = container.querySelector("button");
      if (!button) continue;

      const text = (button.textContent || "").toLowerCase();

      if (
        text.includes("follow") &&
        !text.includes("following") &&
        !text.includes("pending") &&
        !text.includes("requested")
      ) {
        button.click();
        return true;
      }
    }

    return false;
  } catch (_) {
    return false;
  }
}

// ---------------- REPORTING ----------------
async function emitProgress() {
  await safeSendMessage({
    action: FLOW.mode === "followers" ? "updateFollowersProgress" : "updateLikersProgress",
    trackedCount: FLOW.tracked,
    failedCount: FLOW.failed,
    processed: FLOW.processed,
    remaining: FLOW.queue.length
  });

  await appendAudit({
    ts: Date.now(),
    type: "progress",
    mode: FLOW.mode,
    tracked: FLOW.tracked,
    failed: FLOW.failed,
    processed: FLOW.processed,
    remaining: FLOW.queue.length
  });
}

async function emitDone() {
  await safeSendMessage({
    action: "flowDone",
    mode: FLOW.mode,
    trackedCount: FLOW.tracked,
    failedCount: FLOW.failed,
    processed: FLOW.processed
  });

  await appendAudit({
    ts: Date.now(),
    type: "done",
    mode: FLOW.mode,
    tracked: FLOW.tracked,
    failed: FLOW.failed,
    processed: FLOW.processed
  });
}

async function emitStatus(message, level = "info") {
  await safeSendMessage({
    action: "flowStatus",
    mode: FLOW.mode,
    level,
    message
  });
}

function safeSendMessage(payload) {
  return chrome.runtime.sendMessage(payload).catch(() => {});
}

function appendAudit(log) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["auditLogs"], (res) => {
      const logs = Array.isArray(res.auditLogs) ? res.auditLogs : [];
      logs.push(log);
      chrome.storage.local.set({ auditLogs: logs.slice(-2000) }, () => resolve());
    });
  });
}

// ---------------- UTILS ----------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}