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
