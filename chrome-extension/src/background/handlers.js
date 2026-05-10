import {
  sbGoogleSignIn,
  sbSignOut,
  sbSelect,
  sbInsert,
  sbDelete,
  sbUpsert,
} from "./supabase.js";
import { detectAIBackend, localAiInference, checkLocalAiStatus, DEFAULT_YOUTUBE_PROMPT } from "./ai.js";
import { stravaAuth, checkRunningGoal } from "./strava.js";
import { applyBlockingRules } from "./blocking.js";
import { syncCloudToLocal } from "./sync.js";
import { scheduleReset } from "./reset.js";

// ── Handler Functions ──

async function handleAddSite(msg, sendResponse) {
  const data = await chrome.storage.local.get(["blockedSites", "sbUser"]);
  const sites = data.blockedSites || [];
  const domain = msg.domain.replace(/^(https?:\/\/)?(www\.)?/, "").replace(/\/.*$/, "");
  if (!sites.includes(domain)) {
    sites.push(domain);

    // Save to DB (check-before-insert to prevent duplicates)
    if (data.sbUser && data.sbUser.id) {
      try {
        const existing = await sbSelect("blocked_sites", `user_id=eq.${data.sbUser.id}&domain=eq.${domain}`);
        if (!existing || existing.length === 0) {
          await sbInsert("blocked_sites", { user_id: data.sbUser.id, domain: domain });
        }
      } catch (err) {
        console.warn("Failed to insert blocked site to Supabase:", err);
      }
    }

    await chrome.storage.local.set({ blockedSites: sites });
    await applyBlockingRules();
    sendResponse({ success: true, sites });
  } else {
    sendResponse({ success: true, sites, alreadyExists: true });
  }
}

async function handleRemoveSite(msg, sendResponse) {
  const data = await chrome.storage.local.get(["blockedSites", "unlockedToday", "sbUser"]);
  if (!data.unlockedToday) {
    sendResponse({ success: false, error: "Cannot remove sites while locked. Complete your goal first." });
    return;
  }
  const sites = (data.blockedSites || []).filter((s) => s !== msg.domain);

  // Delete from DB
  if (data.sbUser && data.sbUser.id) {
    try {
      await sbDelete("blocked_sites", `user_id=eq.${data.sbUser.id}&domain=eq.${msg.domain}`);
    } catch (err) {
      console.warn("Failed to delete blocked site from Supabase:", err);
    }
  }

  await chrome.storage.local.set({ blockedSites: sites });
  await applyBlockingRules();
  sendResponse({ success: true, sites });
}

async function handleConnectStrava(_msg, sendResponse) {
  try {
    await stravaAuth();
    sendResponse({ success: true });
  } catch (err) {
    console.error("[FitLock] Strava auth error:", err);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGoogleSignIn(_msg, sendResponse) {
  try {
    const res = await sbGoogleSignIn();
    await syncCloudToLocal();
    sendResponse({ success: true, user: res.user });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGoogleSignOut(_msg, sendResponse) {
  try {
    await sbSignOut();
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleCheckGoal(_msg, sendResponse) {
  try {
    const result = await checkRunningGoal();
    sendResponse({ success: true, ...result });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleSetGoal(msg, sendResponse) {
  await chrome.storage.local.set({ goalMiles: msg.goalMiles });
  const data = await chrome.storage.local.get(["activityCache", "sbUser"]);

  let updatedCache = data.activityCache;
  if (updatedCache && updatedCache.result) {
    updatedCache.result.goalMiles = msg.goalMiles;
    updatedCache.result.goalMet = updatedCache.result.today.miles >= msg.goalMiles;
    await chrome.storage.local.set({ activityCache: updatedCache });

    // Also check if sites should now be unlocked or locked based on new goal
    if (updatedCache.result.goalMet) {
      await chrome.storage.local.set({ unlockedToday: true });
    } else {
      await chrome.storage.local.set({ unlockedToday: false });
    }
    await applyBlockingRules();
  }

  if (data.sbUser && data.sbUser.id) {
    try {
      await sbUpsert("profiles", { id: data.sbUser.id, daily_goal_miles: msg.goalMiles });
    } catch (err) {
      console.warn("Failed to update profile goal in Supabase:", err);
    }
  }

  sendResponse({ success: true, activityCache: updatedCache });
}

async function handleSetResetHour(msg, sendResponse) {
  await chrome.storage.local.set({ resetHour: msg.resetHour });
  const data = await chrome.storage.local.get(["sbUser"]);

  // Save to DB
  if (data.sbUser && data.sbUser.id) {
    try {
      await sbUpsert("profiles", { id: data.sbUser.id, reset_hour: msg.resetHour });
    } catch (err) {
      console.warn("Failed to update profile reset hour in Supabase:", err);
    }
  }

  await scheduleReset();
  sendResponse({ success: true });
}

async function handleToggleSmartLock(msg, sendResponse) {
  await chrome.storage.local.set({ youtubeSmartLock: msg.enabled });
  await applyBlockingRules();
  sendResponse({ success: true });
}

async function handleGetStatus(_msg, sendResponse) {
  const data = await chrome.storage.local.get(
    ["blockedSites", "goalMiles", "unlockedToday", "stravaConnected", "activityCache", "resetHour", "sbUser", "youtubeSmartLock", "localAiModel", "localAiServer", "preferredAiBackend"]
  );
  const aiBackend = data.preferredAiBackend || await detectAIBackend();
  sendResponse({
    blockedSites: data.blockedSites || [],
    goalMiles: data.goalMiles || 1,
    unlockedToday: data.unlockedToday || false,
    stravaConnected: !!data.stravaConnected,
    lastCheck: data.activityCache?.result || null,
    resetHour: data.resetHour ?? 0,
    googleUser: data.sbUser || null,
    youtubeSmartLock: data.youtubeSmartLock || false,
    aiBackend,
    preferredAiBackend: data.preferredAiBackend || null,
    localAiModel: data.localAiModel || null,
    localAiServer: data.localAiServer || "ollama",
  });
}

async function handleCheckAiStatus(_msg, sendResponse) {
  try {
    let available = false;
    if (typeof self.ai !== "undefined" && self.ai?.languageModel) {
      const caps = await self.ai.languageModel.capabilities();
      available = caps && caps.available === "readily";
    }
    sendResponse({ available });
  } catch (err) {
    sendResponse({ available: false, error: err.message });
  }
}

async function handleCheckLocalAiStatus(msg, sendResponse) {
  try {
    const serverKey = msg.server || "ollama";
    const result = await checkLocalAiStatus(serverKey);
    sendResponse(result);
  } catch {
    sendResponse({ available: false, models: [] });
  }
}

function handleSelectLocalAiServer(msg, sendResponse) {
  chrome.storage.local.set({ localAiServer: msg.server, localAiModel: "" }, () => {
    sendResponse({ success: true });
  });
}

function handleSelectLocalAiModel(msg, sendResponse) {
  chrome.storage.local.set({ localAiModel: msg.model }, () => {
    sendResponse({ success: true });
  });
}

async function handleLocalAiInference(msg, sendResponse) {
  try {
    const rawResponse = await localAiInference(msg.title, msg.description);
    sendResponse({ success: true, rawResponse });
  } catch (err) {
    console.error("[FitLock] Local AI inference failed in background:", err.message, err);
    sendResponse({ success: false, error: err.message });
  }
}

function handleGetPrompts(_msg, sendResponse) {
  chrome.storage.local.get(["youtubePrompt"], (data) => {
    sendResponse({
      success: true,
      youtubePrompt: data.youtubePrompt || DEFAULT_YOUTUBE_PROMPT,
      defaultYoutubePrompt: DEFAULT_YOUTUBE_PROMPT,
    });
  });
}

async function handleSetYoutubePrompt(msg, sendResponse) {
  const newPrompt = msg.prompt;
  await chrome.storage.local.set({ youtubePrompt: newPrompt });
  const data = await chrome.storage.local.get(["sbUser"]);
  if (data.sbUser && data.sbUser.id) {
    try {
      await sbUpsert("profiles", { id: data.sbUser.id, youtube_prompt: newPrompt });
    } catch (err) {
      console.warn("Failed to update youtube_prompt in Supabase:", err);
    }
  }
  sendResponse({ success: true });
}

async function handleResetYoutubePrompt(_msg, sendResponse) {
  await chrome.storage.local.set({ youtubePrompt: DEFAULT_YOUTUBE_PROMPT });
  const data = await chrome.storage.local.get(["sbUser"]);
  if (data.sbUser && data.sbUser.id) {
    try {
      await sbUpsert("profiles", { id: data.sbUser.id, youtube_prompt: null });
    } catch (err) {
      console.warn("Failed to reset youtube_prompt in Supabase:", err);
    }
  }
  sendResponse({ success: true });
}

function handleSetPreferredAiBackend(msg, sendResponse) {
  const backend = msg.backend; // "gemini" | "ollama"
  chrome.storage.local.set({ preferredAiBackend: backend }, () => {
    sendResponse({ success: true });
  });
}

async function handleDisconnectStrava(_msg, sendResponse) {
  const data = await chrome.storage.local.get(["sbUser"]);
  // Delete from DB
  if (data.sbUser && data.sbUser.id) {
    try {
      await sbDelete("strava_tokens", `user_id=eq.${data.sbUser.id}`);
    } catch (err) {
      console.warn("Failed to delete Strava tokens from Supabase:", err);
    }
  }

  // Clean up both new and legacy storage keys
  await chrome.storage.local.remove([
    "stravaConnected", "stravaAthleteId",
    "stravaCachedToken", "stravaCachedTokenExpiry",
    // Legacy keys (backward compatibility cleanup)
    "stravaAccessToken", "stravaRefreshToken", "stravaTokenExpiry",
    "stravaClientId", "stravaClientSecret",
  ]);
  sendResponse({ success: true });
}

// ── Dispatch Map ──
const handlers = {
  addSite: handleAddSite,
  removeSite: handleRemoveSite,
  connectStrava: handleConnectStrava,
  googleSignIn: handleGoogleSignIn,
  googleSignOut: handleGoogleSignOut,
  checkGoal: handleCheckGoal,
  setGoal: handleSetGoal,
  setResetHour: handleSetResetHour,
  toggleSmartLock: handleToggleSmartLock,
  getStatus: handleGetStatus,
  checkAiStatus: handleCheckAiStatus,
  checkLocalAiStatus: handleCheckLocalAiStatus,
  checkOllamaStatus: handleCheckLocalAiStatus, // alias
  selectLocalAiServer: handleSelectLocalAiServer,
  selectLocalAiModel: handleSelectLocalAiModel,
  selectOllamaModel: handleSelectLocalAiModel, // consolidated: same as selectLocalAiModel
  localAiInference: handleLocalAiInference,
  getPrompts: handleGetPrompts,
  setYoutubePrompt: handleSetYoutubePrompt,
  resetYoutubePrompt: handleResetYoutubePrompt,
  disconnectStrava: handleDisconnectStrava,
  setPreferredAiBackend: handleSetPreferredAiBackend,
};

// ── Registration ──
export function registerMessageHandlers() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handler = handlers[msg.action];
    if (!handler) {
      sendResponse({ success: false, error: `Unknown action: ${msg.action}` });
      return false;
    }
    handler(msg, sendResponse);
    return true; // keep channel open for async response
  });
}
