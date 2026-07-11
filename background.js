chrome.runtime.onInstalled.addListener(() => {
  console.log("IG Guarded Assistant installed");

  chrome.storage.local.get(
    ["followersState", "likersState", "activeFlow", "auditLogs"],
    (result) => {
      const next = {};

      if (!result.followersState) {
        next.followersState = {
          isRunning: false,
          trackedCount: 0,
          failedCount: 0,
          totalToFollow: 0,
          usersList: [],
          awaitingApproval: false,
          pendingBatch: [],
          currentBatchId: null
        };
      }

      if (!result.likersState) {
        next.likersState = {
          isRunning: false,
          trackedCount: 0,
          failedCount: 0,
          totalToFollow: 0,
          usersList: [],
          awaitingApproval: false,
          pendingBatch: [],
          currentBatchId: null
        };
      }

      if (!result.activeFlow) {
        next.activeFlow = null;
      }

      if (!result.auditLogs) {
        next.auditLogs = [];
      }

      if (Object.keys(next).length > 0) {
        chrome.storage.local.set(next);
      }
    }
  );
});