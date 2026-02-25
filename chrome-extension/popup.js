// ── DOM Elements ──
const tabs = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");
const siteInput = document.getElementById("site-input");
const addSiteBtn = document.getElementById("add-site-btn");
const blockedList = document.getElementById("blocked-list");
const emptyMsg = document.getElementById("empty-msg");
const goalInput = document.getElementById("goal-input");
const saveGoalBtn = document.getElementById("save-goal-btn");
const checkGoalBtn = document.getElementById("check-goal-btn");
const progressSection = document.getElementById("progress-section");
const progressText = document.getElementById("progress-text");
const progressFill = document.getElementById("progress-fill");
const connectGoogleBtn = document.getElementById("connect-google-btn");
const disconnectGoogleBtn = document.getElementById("disconnect-google-btn");
const googleDisconnected = document.getElementById("google-disconnected");
const googleConnected = document.getElementById("google-connected");
const googleEmailLabel = document.getElementById("google-email-label");
const connectStravaBtn = document.getElementById("connect-strava-btn");
const disconnectStravaBtn = document.getElementById("disconnect-strava-btn");
const stravaDisconnected = document.getElementById("strava-disconnected");
const stravaConnected = document.getElementById("strava-connected");
const statusBanner = document.getElementById("status-banner");
const resetHourInput = document.getElementById("reset-hour-input");
const saveResetBtn = document.getElementById("save-reset-btn");

let isUnlocked = false; // track lock state for remove button visibility

// ── Tab Switching ──
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tabContents.forEach((tc) => tc.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── Load State ──
function loadStatus() {
  chrome.runtime.sendMessage({ action: "getStatus" }, (res) => {
    isUnlocked = res.unlockedToday;
    renderBlockedList(res.blockedSites, res.youtubeSmartLock);
    goalInput.value = res.goalMiles;
    resetHourInput.value = res.resetHour;

    if (res.googleUser) {
      googleDisconnected.classList.add("hidden");
      googleConnected.classList.remove("hidden");
      googleEmailLabel.textContent = res.googleUser.email || "SIGNED IN";
    } else {
      googleDisconnected.classList.remove("hidden");
      googleConnected.classList.add("hidden");

      // Force user to the account tab if not connected to Google
      document.querySelector('[data-tab="account"]').click();
    }

    if (res.stravaConnected) {
      stravaDisconnected.classList.add("hidden");
      stravaConnected.classList.remove("hidden");
    } else {
      stravaDisconnected.classList.remove("hidden");
      stravaConnected.classList.add("hidden");

      // Force user to the account tab if not connected to Strava
      if (res.googleUser) {
        document.querySelector('[data-tab="account"]').click();
      }
    }

    if (!res.googleUser) {
      statusBanner.textContent = "Please sign in to your FitLock account.";
      statusBanner.className = "banner locked";
    } else if (!res.stravaConnected) {
      statusBanner.textContent = "Please connect to Strava to use FitLock.";
      statusBanner.className = "banner locked";
    } else if (res.unlockedToday) {
      statusBanner.textContent = "Sites unlocked — goal completed today!";
      statusBanner.className = "banner unlocked";
    } else if (res.blockedSites.length > 0) {
      statusBanner.textContent = "Sites locked — complete your run to unlock.";
      statusBanner.className = "banner locked";
    } else {
      statusBanner.classList.add("hidden");
    }

    if (res.lastCheck) {
      showProgress(res.lastCheck);
    }
  });
}

// ── Blocked Sites ──
function renderBlockedList(sites, smartLockActive = false) {
  blockedList.innerHTML = "";
  if (sites.length === 0) {
    emptyMsg.classList.remove("hidden");
    return;
  }
  emptyMsg.classList.add("hidden");
  sites.forEach((domain) => {
    const li = document.createElement("li");
    let innerHTML = `<span class="domain">${domain}</span>`;

    if (domain === "youtube.com") {
      innerHTML += `
        <label class="smart-toggle">
          <input type="checkbox" id="yt-smart-lock" ${smartLockActive ? "checked" : ""}>
          Smart Lock
        </label>
      `;
    }

    if (isUnlocked) {
      innerHTML += `<button class="remove-btn" data-domain="${domain}">Remove</button>`;
    }

    li.innerHTML = innerHTML;
    blockedList.appendChild(li);
  });

  const smartToggle = document.getElementById("yt-smart-lock");
  if (smartToggle) {
    smartToggle.addEventListener("change", (e) => {
      chrome.runtime.sendMessage({ action: "toggleSmartLock", enabled: e.target.checked });
    });
  }

  if (isUnlocked) {
    blockedList.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "removeSite", domain: btn.dataset.domain }, (res) => {
          if (res.success) loadStatus();
        });
      });
    });
  }
}

addSiteBtn.addEventListener("click", () => {
  const domain = siteInput.value.trim();
  if (!domain) return;
  chrome.runtime.sendMessage({ action: "addSite", domain }, (res) => {
    if (res.success) {
      loadStatus();
      siteInput.value = "";
    }
  });
});

siteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSiteBtn.click();
});

// ── Goal ──
saveGoalBtn.addEventListener("click", () => {
  const miles = parseFloat(goalInput.value);
  if (isNaN(miles) || miles <= 0) return;
  chrome.runtime.sendMessage({ action: "setGoal", goalMiles: miles }, (res) => {
    saveGoalBtn.textContent = "SAVED!";
    setTimeout(() => (saveGoalBtn.textContent = "SET"), 1500);
    if (res && res.activityCache && res.activityCache.result) {
      showProgress(res.activityCache.result);
    }
    loadStatus(); // Refresh the banner and state
  });
});

checkGoalBtn.addEventListener("click", () => {
  checkGoalBtn.textContent = "Checking...";
  checkGoalBtn.disabled = true;
  chrome.runtime.sendMessage({ action: "checkGoal" }, (res) => {
    checkGoalBtn.textContent = "Check Progress";
    checkGoalBtn.disabled = false;
    if (res.success) {
      showProgress(res);
      loadStatus(); // refresh banner
    } else {
      alert(res.error || "Failed to check goal. Make sure Strava is connected.");
    }
  });
});

function showProgress(data) {
  progressSection.classList.remove("hidden");
  const todayMiles = data.today ? data.today.miles : 0;
  const pct = Math.min((todayMiles / data.goalMiles) * 100, 100);
  progressText.textContent = `${todayMiles.toFixed(2)} / ${data.goalMiles} miles${data.goalMet ? " — Goal met!" : ""}`;
  progressFill.style.width = `${pct}%`;
}

// ── Account & Google ──
connectGoogleBtn.addEventListener("click", () => {
  connectGoogleBtn.textContent = "SIGNING IN...";
  connectGoogleBtn.disabled = true;

  chrome.runtime.sendMessage({ action: "googleSignIn" }, (res) => {
    connectGoogleBtn.textContent = "SIGN IN WITH GOOGLE";
    connectGoogleBtn.disabled = false;
    if (res.success) {
      loadStatus();
    } else {
      alert(res.error || "Failed to sign in with Google.");
    }
  });
});

disconnectGoogleBtn.addEventListener("click", () => {
  disconnectGoogleBtn.textContent = "SIGNING OUT...";
  disconnectGoogleBtn.disabled = true;

  chrome.runtime.sendMessage({ action: "googleSignOut" }, () => {
    disconnectGoogleBtn.textContent = "SIGN OUT";
    disconnectGoogleBtn.disabled = false;
    loadStatus();
  });
});

// ── Strava ──
connectStravaBtn.addEventListener("click", () => {
  connectStravaBtn.textContent = "Connecting...";
  connectStravaBtn.disabled = true;

  chrome.runtime.sendMessage({ action: "connectStrava" }, (res) => {
    connectStravaBtn.textContent = "CONNECT TO STRAVA";
    connectStravaBtn.disabled = false;

    if (chrome.runtime.lastError) {
      alert("Connection error: " + chrome.runtime.lastError.message);
      return;
    }

    if (res && res.success) {
      loadStatus();
    } else {
      alert((res && res.error) || "Failed to connect to Strava.");
    }
  });
});

disconnectStravaBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "disconnectStrava" }, () => {
    loadStatus();
  });
});

// ── Settings ──
saveResetBtn.addEventListener("click", () => {
  const resetHour = parseInt(resetHourInput.value, 10);
  chrome.runtime.sendMessage({ action: "setResetHour", resetHour }, () => {
    saveResetBtn.textContent = "Saved!";
    setTimeout(() => (saveResetBtn.textContent = "Save"), 1500);
  });
});

// ── Init ──
loadStatus();
