import { sbSelect, sbInvoke } from "./supabase.js";
import { applyBlockingRules } from "./blocking.js";
import { DEFAULT_YOUTUBE_PROMPT } from "./ai.js";
import { scheduleReset } from "./reset.js";

// ── Sync Engine (Cloud → Local) ──
export async function syncCloudToLocal() {
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
          youtubePrompt: p.youtube_prompt || DEFAULT_YOUTUBE_PROMPT,
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
