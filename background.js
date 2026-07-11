chrome.runtime.onInstalled.addListener(() => {
  console.log("IG Auto Follow installed");

  chrome.storage.local.get(["followersState", "likersState"], (result) => {
    const next = {};

    if (!result.followersState) {
      next.followersState = {
        isRunning: false,
        trackedCount: 0,
        failedCount: 0,
        totalToFollow: 0,
        usersList: []
      };
    }

    if (!result.likersState) {
      next.likersState = {
        isRunning: false,
        trackedCount: 0,
        failedCount: 0,
        totalToFollow: 0,
        usersList: []
      };
    }

    if (Object.keys(next).length > 0) {
      chrome.storage.local.set(next);
    }
  });
});

// When the popup is closed, persist flow completion so popup shows correct state on reopen
chrome.runtime.onMessage.addListener((request) => {
  const action = request?.action;

  if (action === "flowDone" || action === "flowError") {
    const mode = request.mode;
    if (!mode) return;
    const key = mode === "followers" ? "followersState" : "likersState";
    chrome.storage.local.get([key], (res) => {
      const state = { ...(res[key] || {}) };
      state.isRunning = false;
      if (request.trackedCount !== undefined) state.trackedCount = request.trackedCount;
      if (request.failedCount !== undefined) state.failedCount = request.failedCount;
      chrome.storage.local.set({ [key]: state });
    });
  }
});
