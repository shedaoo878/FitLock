// ── Supabase Client ──
importScripts("supabase.js");

// ── Constants ──
const METERS_PER_MILE = 1609.34;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const RESET_ALARM = "fitlock-daily-reset";

// Your Strava API app's Client ID (public, safe to embed)
// Find this at: https://www.strava.com/settings/api
const STRAVA_CLIENT_ID = "203705";

// ── Initialization ──
chrome.runtime.onInstalled.addListener((details) => {
  // Open onboarding wizard on first install only
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }

  chrome.storage.local.get(["blockedSites", "goalMiles", "resetHour", "sbUser"], (data) => {
    if (!data.blockedSites) chrome.storage.local.set({ blockedSites: [] });
    if (!data.goalMiles) chrome.storage.local.set({ goalMiles: 1 });
    if (data.resetHour === undefined) chrome.storage.local.set({ resetHour: 0 });
    if (data.sbUser) {
      syncCloudToLocal();
    }
  });
  scheduleReset();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(["sbUser"], (data) => {
    if (data.sbUser) {
      syncCloudToLocal();
    }
  });
  scheduleReset();
  applyBlockingRules();
});

// ── Daily Reset (configurable hour, default midnight) ──
async function scheduleReset() {
  const data = await chrome.storage.local.get(["resetHour"]);
  const resetHour = data.resetHour ?? 0;

  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setHours(resetHour, 0, 0, 0);

  // If that time already passed today, schedule for tomorrow
  if (nextReset.getTime() <= now.getTime()) {
    nextReset.setDate(nextReset.getDate() + 1);
  }

  chrome.alarms.create(RESET_ALARM, {
    when: nextReset.getTime(),
    periodInMinutes: 24 * 60,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RESET_ALARM) {
    chrome.storage.local.set({ unlockedToday: false, activityCache: null });
    applyBlockingRules();
  }
});

// ── Blocking Rules ──
async function applyBlockingRules() {
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

// ── Sync Engine (Cloud → Local) ──
async function syncCloudToLocal() {
  try {
    const data = await chrome.storage.local.get(["sbUser"]);
    if (!data.sbUser || !data.sbUser.id) return;

    // 1. Sync Profile (Goal & Reset Hour)
    try {
      const profiles = await sbSelect("profiles", `id=eq.${data.sbUser.id}`);
      if (profiles && profiles.length > 0) {
        const p = profiles[0];
        await chrome.storage.local.set({
          goalMiles: p.daily_goal_miles || 1,
          resetHour: p.reset_hour || 0,
        });
        scheduleReset();
      }
    } catch (e) {
      console.warn("Failed to sync profile:", e);
    }

    // 2. Sync Blocked Sites
    try {
      const sites = await sbSelect("blocked_sites", `user_id=eq.${data.sbUser.id}`);
      if (sites) {
        const domainList = sites.map((s) => s.domain);
        await chrome.storage.local.set({ blockedSites: domainList });
        applyBlockingRules();
      }
    } catch (e) {
      console.warn("Failed to sync blocked sites:", e);
    }

    // 3. Sync Strava State
    try {
      // Refreshing the token will verify if a valid Strava connection exists in the DB
      const result = await sbInvoke("refresh-token", {});
      if (result.success) {
        await chrome.storage.local.set({
          stravaConnected: true,
          stravaCachedToken: result.access_token,
          stravaCachedTokenExpiry: result.expires_at * 1000,
        });
      } else {
        await chrome.storage.local.set({ stravaConnected: false });
      }
    } catch (e) {
      console.warn("Strava sync failed (likely not connected):", e);
      await chrome.storage.local.set({ stravaConnected: false });
    }
  } catch (globalErr) {
    console.error("Critical error in syncCloudToLocal:", globalErr);
  }
}

// ── Strava OAuth (via Edge Function) ──
async function stravaAuth() {
  // Step 1: Open the Strava authorization page in a popup window.
  const redirectUri = chrome.identity.getRedirectURL();
  console.log("[FitLock] Redirect URI:", redirectUri);

  const authUrl =
    `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&approval_prompt=force&scope=activity:read_all`;

  console.log("[FitLock] Auth URL:", authUrl);

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  // Step 2: Extract the authorization code from the redirect URL
  const url = new URL(responseUrl);
  const code = url.searchParams.get("code");
  if (!code) throw new Error("No authorization code received from Strava.");

  // Step 3: Send the code to the Edge Function for secure token exchange.
  const result = await sbInvoke("exchange-code", { code });

  if (!result.success) {
    throw new Error(result.error || "Token exchange failed.");
  }

  // Step 4: Store the tokens and connection flag locally.
  await chrome.storage.local.set({
    stravaConnected: true,
    stravaAthleteId: result.athlete_id || null,
    stravaCachedToken: result.access_token,
    stravaCachedTokenExpiry: result.expires_at * 1000,
  });

  return true;
}

async function getValidAccessToken() {
  // Check if we have a cached token that's still valid
  const data = await chrome.storage.local.get(["stravaCachedToken", "stravaCachedTokenExpiry", "stravaConnected"]);

  if (data.stravaCachedToken && data.stravaCachedTokenExpiry) {
    // Use cached token if it's still valid (with 60s buffer)
    if (Date.now() < data.stravaCachedTokenExpiry - 60000) {
      return data.stravaCachedToken;
    }
  }

  if (!data.stravaConnected) {
    throw new Error("Strava not connected. Please connect in the FitLock extension.");
  }

  // Token expired (or not cached) — call the refresh Edge Function
  // The Edge Function will find the user's refresh_token in the database
  const result = await sbInvoke("refresh-token", {});

  if (!result.success) {
    // Force disconnect on auth error
    await chrome.storage.local.set({ stravaConnected: false });
    throw new Error(result.error || "Failed to fetch valid Strava token. Please reconnect.");
  }

  // Cache the valid token locally
  await chrome.storage.local.set({
    stravaCachedToken: result.access_token,
    stravaCachedTokenExpiry: result.expires_at * 1000,
  });

  return result.access_token;
}

// ── Strava Activity Check ──
async function checkRunningGoal() {
  // Check cache first
  const cacheData = await chrome.storage.local.get(["activityCache"]);
  const cache = cacheData.activityCache;
  if (cache && Date.now() - cache.timestamp < CACHE_DURATION_MS) {
    return cache.result;
  }

  const accessToken = await getValidAccessToken();
  const goalData = await chrome.storage.local.get(["goalMiles"]);
  const goalMiles = goalData.goalMiles || 1;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Get start of the week (Monday)
  const weekStart = new Date(todayStart);
  const dayOfWeek = weekStart.getDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  weekStart.setDate(weekStart.getDate() - diffToMonday);

  const afterWeek = Math.floor(weekStart.getTime() / 1000);

  const res = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${afterWeek}&per_page=200`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) throw new Error("Failed to fetch Strava activities.");

  const activities = await res.json();
  const runs = activities.filter((a) => a.type === "Run");

  // Today's stats
  const todayTimestamp = todayStart.getTime();
  const todayRuns = runs.filter((a) => new Date(a.start_date_local).getTime() >= todayTimestamp);
  const todayMeters = todayRuns.reduce((sum, a) => sum + a.distance, 0);
  const todayMiles = todayMeters / METERS_PER_MILE;
  const todayDurationSec = todayRuns.reduce((sum, a) => sum + a.moving_time, 0);
  const todayRunCount = todayRuns.length;

  // Week's stats
  const weekMeters = runs.reduce((sum, a) => sum + a.distance, 0);
  const weekMiles = weekMeters / METERS_PER_MILE;
  const weekDurationSec = runs.reduce((sum, a) => sum + a.moving_time, 0);
  const weekRunCount = runs.length;

  const goalMet = todayMiles >= goalMiles;

  const result = {
    goalMet,
    goalMiles,
    today: {
      miles: todayMiles,
      runs: todayRunCount,
      durationSec: todayDurationSec,
    },
    week: {
      miles: weekMiles,
      runs: weekRunCount,
      durationSec: weekDurationSec,
    },
  };

  // Cache the result
  await chrome.storage.local.set({
    activityCache: { timestamp: Date.now(), result },
  });

  // If goal is met, unlock sites
  if (goalMet) {
    await chrome.storage.local.set({ unlockedToday: true });
    await applyBlockingRules();
  }

  return result;
}

// ── Message Handler ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "addSite") {
    chrome.storage.local.get(["blockedSites", "sbUser"], async (data) => {
      const sites = data.blockedSites || [];
      const domain = msg.domain.replace(/^(https?:\/\/)?(www\.)?/, "").replace(/\/.*$/, "");
      if (!sites.includes(domain)) {
        sites.push(domain);

        // Save to DB
        if (data.sbUser && data.sbUser.id) {
          try {
            await sbInsert("blocked_sites", { user_id: data.sbUser.id, domain: domain });
          } catch (err) {
            console.warn("Failed to insert blocked site to Supabase:", err);
          }
        }

        chrome.storage.local.set({ blockedSites: sites }, () => {
          applyBlockingRules().then(() => sendResponse({ success: true, sites }));
        });
      } else {
        sendResponse({ success: true, sites, alreadyExists: true });
      }
    });
    return true; // keep channel open for async response
  }

  if (msg.action === "removeSite") {
    chrome.storage.local.get(["blockedSites", "unlockedToday", "sbUser"], async (data) => {
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

      chrome.storage.local.set({ blockedSites: sites }, () => {
        applyBlockingRules().then(() => sendResponse({ success: true, sites }));
      });
    });
    return true;
  }

  if (msg.action === "connectStrava") {
    stravaAuth()
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error("[FitLock] Strava auth error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (msg.action === "googleSignIn") {
    sbGoogleSignIn()
      .then(async (res) => {
        await syncCloudToLocal();
        sendResponse({ success: true, user: res.user });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.action === "googleSignOut") {
    sbSignOut()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.action === "checkGoal") {
    checkRunningGoal()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.action === "setGoal") {
    chrome.storage.local.set({ goalMiles: msg.goalMiles }, async () => {
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
          // You might not want to instantly lock them, but logically if objective increased, maybe reconsider.
          // Let's rely on standard logic - if they set it higher, it doesn't auto-lock until reset, unless you want it to.
          // Assuming we only unlock if met.
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
    });
    return true;
  }


  if (msg.action === "setResetHour") {
    chrome.storage.local.set({ resetHour: msg.resetHour }, async () => {
      const data = await chrome.storage.local.get(["sbUser"]);

      // Save to DB
      if (data.sbUser && data.sbUser.id) {
        try {
          await sbUpsert("profiles", { id: data.sbUser.id, reset_hour: msg.resetHour });
        } catch (err) {
          console.warn("Failed to update profile reset hour in Supabase:", err);
        }
      }

      scheduleReset().then(() => sendResponse({ success: true }));
    });
    return true;
  }

  if (msg.action === "toggleSmartLock") {
    chrome.storage.local.set({ youtubeSmartLock: msg.enabled }, async () => {
      await applyBlockingRules();
      sendResponse({ success: true });
    });
    return true;
  }



  if (msg.action === "getStatus") {
    chrome.storage.local.get(
      ["blockedSites", "goalMiles", "unlockedToday", "stravaConnected", "activityCache", "resetHour", "sbUser", "youtubeSmartLock"],
      (data) => {
        sendResponse({
          blockedSites: data.blockedSites || [],
          goalMiles: data.goalMiles || 1,
          unlockedToday: data.unlockedToday || false,
          stravaConnected: !!data.stravaConnected,
          lastCheck: data.activityCache?.result || null,
          resetHour: data.resetHour ?? 0,
          googleUser: data.sbUser || null,
          youtubeSmartLock: data.youtubeSmartLock || false,
        });
      }
    );
    return true;
  }

  if (msg.action === "checkAiStatus") {
    // Check if the built-in AI APIs are available in the service worker context
    // We test both the new global LanguageModel and the older self.ai namespace
    (async () => {
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
    })();
    return true;
  }

  if (msg.action === "disconnectStrava") {
    chrome.storage.local.get(["sbUser"], async (data) => {
      // Delete from DB
      if (data.sbUser && data.sbUser.id) {
        try {
          await sbDelete("strava_tokens", `user_id=eq.${data.sbUser.id}`);
        } catch (err) {
          console.warn("Failed to delete Strava tokens from Supabase:", err);
        }
      }

      // Clean up both new and legacy storage keys
      chrome.storage.local.remove(
        [
          "stravaConnected", "stravaAthleteId",
          "stravaCachedToken", "stravaCachedTokenExpiry",
          // Legacy keys (backward compatibility cleanup)
          "stravaAccessToken", "stravaRefreshToken", "stravaTokenExpiry",
          "stravaClientId", "stravaClientSecret",
        ],
        () => sendResponse({ success: true })
      );
    });
    return true;
  }
});
