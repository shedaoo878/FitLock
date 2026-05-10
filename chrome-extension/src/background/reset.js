import { applyBlockingRules } from "./blocking.js";

const RESET_ALARM = "fitlock-daily-reset";

// ── Daily Reset (configurable hour, default midnight) ──
export async function scheduleReset() {
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

// ── Alarm Listener ──
export function registerAlarmListener() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RESET_ALARM) {
      chrome.storage.local.set({ unlockedToday: false, activityCache: null });
      applyBlockingRules();
    }
  });
}
