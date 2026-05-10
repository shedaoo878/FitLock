// ══════════════════════════════════════════════════════════════
//  FitLock — Background Service Worker (Orchestrator)
// ══════════════════════════════════════════════════════════════
//  This file wires together the extension's lifecycle events.
//  All logic lives in focused modules:
//    ai.js       — AI backend detection, inference, status
//    strava.js   — OAuth, token management, goal checking
//    blocking.js — declarativeNetRequest rule management
//    sync.js     — cloud-to-local sync engine
//    reset.js    — daily reset alarm scheduling
//    handlers.js — message dispatch (20 actions)
//    supabase.js — Supabase SDK wrapper
// ══════════════════════════════════════════════════════════════

import { registerMessageHandlers } from "./handlers.js";
import { syncCloudToLocal } from "./sync.js";
import { scheduleReset, registerAlarmListener } from "./reset.js";
import { applyBlockingRules } from "./blocking.js";

// ── Initialization ──
chrome.runtime.onInstalled.addListener(async (details) => {
  // Open onboarding wizard on first install only
  if (details.reason === "install") {
    let isChrome = false;
    // Check userAgentData brands for Google Chrome (ignores Edge, Brave, etc. which don't have it in brands)
    if (navigator.userAgentData && navigator.userAgentData.brands) {
      isChrome = navigator.userAgentData.brands.some(b => b.brand === "Google Chrome");
    } else {
      // Fallback: check userAgent string for Chrome, but NOT Edge/Edg, OPR, Arc
      const ua = navigator.userAgent;
      if (ua.includes("Chrome") && !ua.includes("Edg") && !ua.includes("OPR") && !ua.includes("Arc") && !ua.includes("Dia")) {
        isChrome = true;
      }
    }

    if (isChrome) {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
      chrome.storage.local.set({ preferredAiBackend: "gemini" });
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL("local-ai-setup.html") });
      chrome.storage.local.set({ preferredAiBackend: "ollama" });
    }
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

// ── Register Listeners ──
registerAlarmListener();
registerMessageHandlers();
