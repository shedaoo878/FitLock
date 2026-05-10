// ── Blocking Rules ──
export async function applyBlockingRules() {
  const data = await chrome.storage.local.get(["blockedSites", "unlockedToday", "youtubeSmartLock"]);  
  const sites = data.blockedSites || [];
  const unlocked = data.unlockedToday || false;
  const smartLock = data.youtubeSmartLock || false;

  // Get existing dynamic rules to remove them
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existingRules.map((r) => r.id);

  if (unlocked || sites.length === 0) {
    // Remove all rules — sites are unlocked
    if (removeIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: removeIds,
      });
    }
    return;
  }

  // Build redirect rules for each blocked domain
  const redirectUrl = chrome.runtime.getURL("blocked.html");
  const addRules = [];

  sites.forEach((domain, index) => {
    if (domain === "youtube.com" && smartLock) {
      return; // Skip adding network blocking rule for YouTube if Smart Lock is active
    }
    const ruleId = index + 1; // IDs must be >= 1
    addRules.push({
      id: ruleId,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { url: redirectUrl },
      },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: [
          "main_frame",
          "sub_frame",
          "xmlhttprequest",
          "media",
          "image",
          "script",
          "stylesheet",
          "font",
          "object",
          "other",
        ],
      },
    });
  });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeIds,
    addRules: addRules,
  });
}
