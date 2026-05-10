import { sbInvoke } from "./supabase.js";
import { applyBlockingRules } from "./blocking.js";

// ── Constants ──
const METERS_PER_MILE = 1609.34;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Your Strava API app's Client ID (public, safe to embed)
// Find this at: https://www.strava.com/settings/api
const STRAVA_CLIENT_ID = "203705";

// ── Token Refresh Race Guard ──
// Prevents concurrent refresh calls from creating duplicate requests.
let refreshPromise = null;

// ── Strava OAuth (via Edge Function) ──
export async function stravaAuth() {
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

async function doRefresh() {
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

export async function getValidAccessToken() {
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
  // Deduplicate concurrent calls: if a refresh is already in-flight, reuse it
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

// ── Strava Activity Check ──
export async function checkRunningGoal() {
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
