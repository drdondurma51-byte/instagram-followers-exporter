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
  consecutiveFails: 0,
  scanStartScrollTop: 0
};

console.log("🚀 IG Auto Follow content-script loaded");

// ---------------- MESSAGE LISTENER ----------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request?.action;

  if (action === "loadUsersList") {
    loadUsersList(request.mode, request.scrollSteps || 15)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
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
async function loadUsersList(mode, scrollSteps) {
  try {
    const modal = getActiveModal();
    if (!modal) {
      return {
        success: false,
        error: 'Modal bulunamadı. Lütfen "Takipçiler" veya beğeni listesi modalını açın.'
      };
    }

    const scrollable = findScrollableContainer(modal);
    const scanStartScrollTop = Math.max(0, Number(scrollable?.scrollTop) || 0);
    const users = await autoScrollAndCollect(modal, scrollSteps, mode);
    if (!users.length) {
      return {
        success: false,
        error: "Modal açık ama kullanıcı bulunamadı. Biraz aşağı kaydırıp tekrar deneyin."
      };
    }

    return { success: true, mode, users, scanStartScrollTop };
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
    consecutiveFailLimit = 5,
    sessionLimit = 100,
    scanStartScrollTop
  } = payload || {};

  if (!Array.isArray(users) || users.length === 0) {
    return { success: false, error: "Takip edilecek kullanıcı yok." };
  }

  FLOW.isRunning = true;
  FLOW.mode = mode || "followers";
  FLOW.queue = users.map((u) => ({ username: u.username, scrollTop: u.scrollTop || 0 }));
  FLOW.processed = 0;
  FLOW.tracked = 0;
  FLOW.failed = 0;
  FLOW.actionDelayMin = Number(actionDelayMin);
  FLOW.actionDelayMax = Number(actionDelayMax);
  FLOW.sessionLimit = Number(sessionLimit);
  FLOW.consecutiveFailLimit = Math.max(1, Number(consecutiveFailLimit) || 5);
  FLOW.consecutiveFails = 0;
  FLOW.scanStartScrollTop = Math.max(0, Number(scanStartScrollTop) || 0);

  runFlow().catch((e) => {
    safeSendMessage({ action: "flowError", mode: FLOW.mode, error: e.message });
    FLOW.isRunning = false;
  });

  return { success: true, total: FLOW.queue.length, mode: FLOW.mode };
}

// ---------------- MAIN FLOW ----------------
async function runFlow() {
  const scrollable = getModalScrollable();

  while (FLOW.isRunning && FLOW.queue.length > 0) {
    if (FLOW.processed >= FLOW.sessionLimit) {
      await emitStatus("Session limiti doldu, akış durduruldu.", "info");
      FLOW.isRunning = false;
      break;
    }

    const item = FLOW.queue.shift();

    // Scroll to the exact position where this user was collected, then wait for DOM to render.
    if (scrollable) {
      scrollable.scrollTop = Math.min(
        Math.max(0, Number(item.scrollTop) || 0),
        Math.max(0, scrollable.scrollHeight - scrollable.clientHeight)
      );
      await sleep(3000);
    }

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
  // Prefer a dialog that has profile links; buttons are not required
  for (let i = dialogs.length - 1; i >= 0; i--) {
    const d = dialogs[i];
    if (d.querySelector('a[href^="/"]')) return d;
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
  while (current && depth < 12) {
    if (current.querySelector("button")) return current;
    current = current.parentElement;
    depth++;
  }
  return null;
}

function findButtonNearLink(link) {
  // 1. Direct ancestor containing a button
  const ancestor = findAncestorWithButton(link);
  if (ancestor) {
    const btn = ancestor.querySelector("button");
    if (btn) return btn;
  }
  // 2. Sibling elements of the link's parent
  const parent = link.parentElement;
  if (parent) {
    let sibling = parent.nextElementSibling;
    while (sibling) {
      const btn = sibling.tagName === "BUTTON" ? sibling : sibling.querySelector("button");
      if (btn) return btn;
      sibling = sibling.nextElementSibling;
    }
    sibling = parent.previousElementSibling;
    while (sibling) {
      const btn = sibling.tagName === "BUTTON" ? sibling : sibling.querySelector("button");
      if (btn) return btn;
      sibling = sibling.previousElementSibling;
    }
  }
  return null;
}

function extractUsersList(modal) {
  const users = [];
  const seen = new Set();
  collectFromModal(modal, seen, users);
  return users;
}

function collectFromModal(modal, seen, users, scrollTop) {
  let added = 0;
  for (const link of modal.querySelectorAll('a[href^="/"]')) {
    try {
      const href = link.getAttribute("href") || "";
      const parts = href.split("/").filter(Boolean);
      if (parts.length !== 1) continue;

      const username = parts[0].trim();
      if (!isValidUsername(username) || seen.has(username)) continue;

      const button = findButtonNearLink(link);
      let alreadyFollowing = false;
      if (button) {
        const t = (button.textContent || "").toLowerCase().trim();
        alreadyFollowing =
          t.includes("following") || t.includes("pending") ||
          t.includes("requested") || t.includes("takipte") ||
          t.includes("takiptesin") || t.includes("beklemede") ||
          t.includes("takip isteği");
      }

      users.push({ username, status: alreadyFollowing ? "following" : "follow", scrollTop: scrollTop || 0 });
      seen.add(username);
      added++;
    } catch (_) {}
  }
  return added;
}

async function autoScrollAndCollect(modal, maxSteps, mode) {
  const seen = new Set();
  const users = [];
  const scrollable = findScrollableContainer(modal);

  for (let step = 0; step < maxSteps; step++) {
    const currentScrollTop = scrollable ? (scrollable.scrollTop || 0) : 0;
    const added = collectFromModal(modal, seen, users, currentScrollTop);

    await safeSendMessage({
      action: "listLoadProgress",
      mode,
      step: step + 1,
      maxSteps,
      collected: users.length
    });

    // After step 2, stop if no new users were found (reached list end)
    if (step >= 2 && added === 0) break;

    scrollable.scrollTop += 400;
    await sleep(rand(650, 950));
  }

  // Final collect after last scroll
  const finalScrollTop = scrollable ? (scrollable.scrollTop || 0) : 0;
  collectFromModal(modal, seen, users, finalScrollTop);
  return users;
}

function findScrollableContainer(modal) {
  let best = null;
  let bestScrollHeight = 0;
  for (const div of modal.querySelectorAll("div")) {
    const overflow = window.getComputedStyle(div).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && div.scrollHeight > div.clientHeight + 50) {
      if (div.scrollHeight > bestScrollHeight) {
        best = div;
        bestScrollHeight = div.scrollHeight;
      }
    }
  }
  return best || modal;
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
function getModalScrollable() {
  const modal = getActiveModal();
  return modal ? findScrollableContainer(modal) : null;
}

function clickFollowButton(username) {
  try {
    const root = getActiveModal() || document;
    const links = root.querySelectorAll('a[href^="/"]');

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const parts = href.split("/").filter(Boolean);
      if (parts.length !== 1 || parts[0] !== username) continue;

      const button = findButtonNearLink(link);
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
