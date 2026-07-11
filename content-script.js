// ===============================================
// IG AUTO FOLLOW CONTENT SCRIPT
// ===============================================

const FLOW = {
  isRunning: false,
  mode: null, // followers | likers
  queue: [],
  processed: 0,
  tracked: 0,
  failed: 0,
  actionDelayMin: 1800,
  actionDelayMax: 4200,
  sessionLimit: 100,
  consecutiveFailLimit: 5,
  consecutiveFails: 0
};

console.log("🚀 IG Auto Follow content-script loaded");

// ---------------- MESSAGE LISTENER ----------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request?.action;

  if (action === "loadUsersList") {
    const result = loadUsersList(request.mode);
    sendResponse(result);
    return true;
  }

  if (action === "startFlow") {
    startFlow(request)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === "stopFollowing") {
    FLOW.isRunning = false;
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
        error: 'Modal bulunamadı. Lütfen "Takipçiler" veya beğeni listesi modalını açın.'
      };
    }

    const users = extractUsersList(modal);
    if (!users.length) {
      return {
        success: false,
        error: "Modal açık ama kullanıcı bulunamadı. Biraz aşağı kaydırıp tekrar deneyin."
      };
    }

    return { success: true, mode, users };
  } catch (error) {
    return { success: false, error: `Liste yükleme hatası: ${error.message}` };
  }
}

// ---------------- FLOW START ----------------
async function startFlow(payload) {
  const {
    mode,
    users,
    actionDelayMin = 1800,
    actionDelayMax = 4200,
    sessionLimit = 100
  } = payload || {};

  if (!Array.isArray(users) || users.length === 0) {
    return { success: false, error: "Takip edilecek kullanıcı yok." };
  }

  FLOW.isRunning = true;
  FLOW.mode = mode || "followers";
  FLOW.queue = users.map((u) => ({ username: u.username }));
  FLOW.processed = 0;
  FLOW.tracked = 0;
  FLOW.failed = 0;
  FLOW.actionDelayMin = Number(actionDelayMin);
  FLOW.actionDelayMax = Number(actionDelayMax);
  FLOW.sessionLimit = Number(sessionLimit);
  FLOW.consecutiveFails = 0;

  runFlow().catch((e) => {
    safeSendMessage({ action: "flowError", mode: FLOW.mode, error: e.message });
    FLOW.isRunning = false;
  });

  return { success: true, total: FLOW.queue.length, mode: FLOW.mode };
}

// ---------------- MAIN FLOW ----------------
async function runFlow() {
  while (FLOW.isRunning && FLOW.queue.length > 0) {
    if (FLOW.processed >= FLOW.sessionLimit) {
      await emitStatus("Session limiti doldu, akış durduruldu.", "info");
      FLOW.isRunning = false;
      break;
    }

    const item = FLOW.queue.shift();
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

  await emitDone();
  FLOW.isRunning = false;
}

// ---------------- MODAL + EXTRACTION ----------------
function getActiveModal() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
  for (let i = dialogs.length - 1; i >= 0; i--) {
    const d = dialogs[i];
    if (d.querySelector('a[href^="/"]') && d.querySelector('button')) return d;
  }
  if (dialogs.length) return dialogs[dialogs.length - 1];
  return (
    document.querySelector('div[class*="Modal"]') ||
    document.querySelector('[data-testid="modal"]') ||
    null
  );
}

function findAncestorWithButton(el) {
  let current = el.parentElement;
  let depth = 0;
  while (current && depth < 6) {
    if (current.querySelector("button")) return current;
    current = current.parentElement;
    depth++;
  }
  return null;
}

function extractUsersList(modal) {
  const users = [];
  const seen = new Set();
  const links = Array.from(modal.querySelectorAll('a[href^="/"]'));

  for (const link of links) {
    try {
      const href = link.getAttribute("href") || "";
      const parts = href.split("/").filter(Boolean);
      if (parts.length !== 1) continue;

      const username = parts[0].trim();
      if (!isValidUsername(username)) continue;
      if (seen.has(username)) continue;

      const container =
        link.closest("li") ||
        link.closest('[role="listitem"]') ||
        findAncestorWithButton(link);

      if (!container) continue;

      const button = container.querySelector("button");
      if (!button) continue;

      const buttonText = (button.textContent || "").toLowerCase().trim();
      const alreadyFollowing =
        buttonText.includes("following") ||
        buttonText.includes("pending") ||
        buttonText.includes("requested") ||
        buttonText.includes("takipte") ||
        buttonText.includes("takiptesin") ||
        buttonText.includes("beklemede") ||
        buttonText.includes("takip isteği");

      users.push({
        username,
        status: alreadyFollowing ? "following" : "follow"
      });

      seen.add(username);
    } catch (_) {}
  }

  return users;
}

function isValidUsername(username) {
  if (!username) return false;
  if (username.length < 2 || username.length > 30) return false;
  if (!/^[a-zA-Z0-9._]+$/.test(username)) return false;

  const blocked = new Set([
    "explore", "p", "direct", "stories", "notifications",
    "your", "accounts", "reels", "reel", "tv", "about",
    "privacy", "safety", "login", "signup", "challenge",
    "api", "graphql", "static", "www"
  ]);
  if (blocked.has(username.toLowerCase())) return false;

  return true;
}

// ---------------- FOLLOW CLICK ----------------
function clickFollowButton(username) {
  try {
    const root = getActiveModal() || document;
    const links = root.querySelectorAll('a[href^="/"]');

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const parts = href.split("/").filter(Boolean);
      if (parts.length !== 1 || parts[0] !== username) continue;

      const container =
        link.closest("li") ||
        link.closest('[role="listitem"]') ||
        findAncestorWithButton(link);

      if (!container) continue;

      const button = container.querySelector("button");
      if (!button) continue;

      const text = (button.textContent || "").toLowerCase().trim();

      const isFollowAction =
        text.includes("follow") ||
        text === "takip et" ||
        text === "takip";

      const isAlreadyFollowing =
        text.includes("following") ||
        text.includes("pending") ||
        text.includes("requested") ||
        text.includes("takiptesin") ||
        text.includes("takipte") ||
        text.includes("beklemede") ||
        text.includes("takip isteği");

      if (isFollowAction && !isAlreadyFollowing) {
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
}

async function emitDone() {
  await safeSendMessage({
    action: "flowDone",
    mode: FLOW.mode,
    trackedCount: FLOW.tracked,
    failedCount: FLOW.failed,
    processed: FLOW.processed
  });
}

async function emitStatus(message, level = "info") {
  await safeSendMessage({ action: "flowStatus", mode: FLOW.mode, level, message });
}

function safeSendMessage(payload) {
  return chrome.runtime.sendMessage(payload).catch(() => {});
}

// ---------------- UTILS ----------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
