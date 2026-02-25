<script>
  import { onMount } from "svelte";

  let activeTab = $state("sites");
  let blockedSites = $state([]);
  let goalMiles = $state(1);
  let isUnlocked = $state(false);
  let stravaConnected = $state(false);
  let googleUser = $state(null);
  let youtubeSmartLock = $state(false);
  let resetHour = $state(0);
  let lastCheck = $state(null);
  let siteInput = $state("");

  // Button loading states
  let googleSigningIn = $state(false);
  let googleSigningOut = $state(false);
  let stravaConnecting = $state(false);
  let checkingGoal = $state(false);
  let goalSaved = $state(false);
  let resetSaved = $state(false);

  // Derived: status banner
  let statusMessage = $derived.by(() => {
    if (!googleUser) return "Please sign in to your FitLock account.";
    if (!stravaConnected) return "Please connect to Strava to use FitLock.";
    if (isUnlocked) return "Sites unlocked — goal completed today!";
    if (blockedSites.length > 0) return "Sites locked — complete your run to unlock.";
    return "";
  });

  let statusClass = $derived.by(() => {
    if (!googleUser || !stravaConnected) return "banner locked";
    if (isUnlocked) return "banner unlocked";
    if (blockedSites.length > 0) return "banner locked";
    return "";
  });

  // Derived: progress
  let progressPct = $derived(
    lastCheck ? Math.min(((lastCheck.today?.miles || 0) / lastCheck.goalMiles) * 100, 100) : 0
  );

  let progressText = $derived.by(() => {
    if (!lastCheck) return "";
    const todayMiles = lastCheck.today?.miles || 0;
    let text = `${todayMiles.toFixed(2)} / ${lastCheck.goalMiles} miles`;
    if (lastCheck.goalMet) text += " — Goal met!";
    return text;
  });

  function loadStatus() {
    chrome.runtime.sendMessage({ action: "getStatus" }, (res) => {
      isUnlocked = res.unlockedToday;
      blockedSites = res.blockedSites || [];
      goalMiles = res.goalMiles;
      resetHour = res.resetHour ?? 0;
      youtubeSmartLock = res.youtubeSmartLock || false;
      googleUser = res.googleUser;
      stravaConnected = res.stravaConnected;
      lastCheck = res.lastCheck;

      if (!res.googleUser || !res.stravaConnected) {
        activeTab = "account";
      }
    });
  }

  function addSite() {
    const domain = siteInput.trim();
    if (!domain) return;
    chrome.runtime.sendMessage({ action: "addSite", domain }, (res) => {
      if (res.success) {
        siteInput = "";
        loadStatus();
      }
    });
  }

  function removeSite(domain) {
    chrome.runtime.sendMessage({ action: "removeSite", domain }, (res) => {
      if (res.success) loadStatus();
    });
  }

  function toggleSmartLock(enabled) {
    youtubeSmartLock = enabled;
    chrome.runtime.sendMessage({ action: "toggleSmartLock", enabled });
  }

  function setGoal() {
    const miles = parseFloat(goalMiles);
    if (isNaN(miles) || miles <= 0) return;
    chrome.runtime.sendMessage({ action: "setGoal", goalMiles: miles }, (res) => {
      goalSaved = true;
      setTimeout(() => (goalSaved = false), 1500);
      if (res?.activityCache?.result) {
        lastCheck = res.activityCache.result;
      }
      loadStatus();
    });
  }

  function checkGoal() {
    checkingGoal = true;
    chrome.runtime.sendMessage({ action: "checkGoal" }, (res) => {
      checkingGoal = false;
      if (res.success) {
        lastCheck = res;
        loadStatus();
      } else {
        alert(res.error || "Failed to check goal. Make sure Strava is connected.");
      }
    });
  }

  function connectGoogle() {
    googleSigningIn = true;
    chrome.runtime.sendMessage({ action: "googleSignIn" }, (res) => {
      googleSigningIn = false;
      if (res.success) {
        loadStatus();
      } else {
        alert(res.error || "Failed to sign in with Google.");
      }
    });
  }

  function disconnectGoogle() {
    googleSigningOut = true;
    chrome.runtime.sendMessage({ action: "googleSignOut" }, () => {
      googleSigningOut = false;
      loadStatus();
    });
  }

  function connectStrava() {
    stravaConnecting = true;
    chrome.runtime.sendMessage({ action: "connectStrava" }, (res) => {
      stravaConnecting = false;
      if (chrome.runtime.lastError) {
        alert("Connection error: " + chrome.runtime.lastError.message);
        return;
      }
      if (res?.success) {
        loadStatus();
      } else {
        alert(res?.error || "Failed to connect to Strava.");
      }
    });
  }

  function disconnectStrava() {
    chrome.runtime.sendMessage({ action: "disconnectStrava" }, () => {
      loadStatus();
    });
  }

  function saveResetHour() {
    const hour = parseInt(resetHour, 10);
    chrome.runtime.sendMessage({ action: "setResetHour", resetHour: hour }, () => {
      resetSaved = true;
      setTimeout(() => (resetSaved = false), 1500);
    });
  }

  function handleSiteKeydown(e) {
    if (e.key === "Enter") addSite();
  }

  onMount(() => {
    loadStatus();
  });
</script>

<div class="container">
  <!-- Header -->
  <div class="header">
    <div class="header-title">
      <span class="logo">FITLOCK</span>
      <span class="version">v1.0</span>
    </div>
    {#if statusMessage}
      <div class={statusClass}>{statusMessage}</div>
    {/if}
  </div>

  <!-- Tab Navigation -->
  <div class="tabs">
    <button class="tab" class:active={activeTab === "sites"} onclick={() => (activeTab = "sites")}>BLOCKED</button>
    <button class="tab" class:active={activeTab === "goal"} onclick={() => (activeTab = "goal")}>GOAL</button>
    <button class="tab" class:active={activeTab === "account"} onclick={() => (activeTab = "account")}>ACCOUNT</button>
    <button class="tab" class:active={activeTab === "settings"} onclick={() => (activeTab = "settings")}>CONFIG</button>
  </div>

  <!-- Sites Tab -->
  {#if activeTab === "sites"}
    <div class="tab-content active" id="tab-sites">
      <div class="section-header">
        <span class="section-label">DOMAIN BLOCKLIST</span>
      </div>
      <div class="input-group">
        <input type="text" bind:value={siteInput} placeholder="enter domain" spellcheck="false" onkeydown={handleSiteKeydown}>
        <button id="add-site-btn" onclick={addSite}>+ ADD</button>
      </div>
      {#if blockedSites.length === 0}
        <p class="muted">No domains registered.</p>
      {:else}
        <ul id="blocked-list">
          {#each blockedSites as domain}
            <li>
              <span class="domain">{domain}</span>
              {#if domain === "youtube.com"}
                <label class="smart-toggle">
                  <input
                    type="checkbox"
                    checked={youtubeSmartLock}
                    onchange={(e) => toggleSmartLock(e.target.checked)}
                  >
                  Smart Lock
                </label>
              {/if}
              {#if isUnlocked}
                <button class="remove-btn" onclick={() => removeSite(domain)}>Remove</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <!-- Goal Tab -->
  {#if activeTab === "goal"}
    <div class="tab-content active" id="tab-goal">
      <div class="section-header">
        <span class="section-label">DAILY OBJECTIVE</span>
      </div>
      <label for="goal-input">Distance requirement (mi)</label>
      <div class="input-group">
        <input type="number" id="goal-input" bind:value={goalMiles} min="0.1" step="0.1">
        <button id="save-goal-btn" onclick={setGoal}>{goalSaved ? "SAVED!" : "SET"}</button>
      </div>
      {#if lastCheck}
        <div id="progress-section">
          <div class="data-row">
            <span class="data-label">PROGRESS</span>
            <span id="progress-text" class="data-value">{progressText}</span>
          </div>
          <div class="progress-bar">
            <div id="progress-fill" class="progress-fill" style="width: {progressPct}%"></div>
          </div>
        </div>
      {/if}
      <button id="check-goal-btn" class="full-btn" onclick={checkGoal} disabled={checkingGoal}>
        {checkingGoal ? "Checking..." : "QUERY STRAVA"}
      </button>
    </div>
  {/if}

  <!-- Account Tab -->
  {#if activeTab === "account"}
    <div class="tab-content active" id="tab-account">
      {#if !googleUser}
        <!-- Google Sign In -->
        <div id="google-disconnected">
          <div class="section-header">
            <span class="section-label">FITLOCK ACCOUNT</span>
          </div>
          <p class="setting-desc">Sign in with Google to sync your settings and connect Strava.</p>
          <button id="connect-google-btn" class="full-btn" onclick={connectGoogle} disabled={googleSigningIn}>
            {googleSigningIn ? "SIGNING IN..." : "SIGN IN WITH GOOGLE"}
          </button>
        </div>
      {:else}
        <!-- Google Connected -->
        <div id="google-connected">
          <div class="section-header">
            <span class="section-label">FITLOCK ACCOUNT</span>
          </div>
          <div class="connection-status">
            <span class="status-dot online"></span>
            <span id="google-email-label" class="status-label">{googleUser.email || "SIGNED IN"}</span>
          </div>
          <button
            id="disconnect-google-btn"
            class="full-btn danger-btn"
            style="margin-bottom: 20px;"
            onclick={disconnectGoogle}
            disabled={googleSigningOut}
          >
            {googleSigningOut ? "SIGNING OUT..." : "SIGN OUT"}
          </button>

          <hr class="divider">

          <!-- Strava Section -->
          {#if !stravaConnected}
            <div id="strava-disconnected">
              <div class="section-header">
                <span class="section-label">STRAVA CONNECTION</span>
              </div>
              <p class="setting-desc">Link your Strava account to track running goals.</p>
              <button id="connect-strava-btn" class="full-btn strava-btn" onclick={connectStrava} disabled={stravaConnecting}>
                {stravaConnecting ? "Connecting..." : "CONNECT TO STRAVA"}
              </button>
            </div>
          {:else}
            <div id="strava-connected">
              <div class="section-header">
                <span class="section-label">STRAVA CONNECTION</span>
              </div>
              <div class="connection-status">
                <span class="status-dot online"></span>
                <span class="status-label">CONNECTED</span>
              </div>
              <button id="disconnect-strava-btn" class="full-btn danger-btn" onclick={disconnectStrava}>REVOKE STRAVA ACCESS</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Settings Tab -->
  {#if activeTab === "settings"}
    <div class="tab-content active" id="tab-settings">
      <div class="section-header">
        <span class="section-label">RESET SCHEDULE</span>
      </div>
      <label for="reset-hour-input">Daily lock reset</label>
      <p class="setting-desc">Blocking rules re-engage at this hour.</p>
      <div class="input-group">
        <select id="reset-hour-input" bind:value={resetHour}>
          <option value={0}>00:00 — Midnight</option>
          <option value={1}>01:00</option>
          <option value={2}>02:00</option>
          <option value={3}>03:00</option>
          <option value={4}>04:00</option>
          <option value={5}>05:00</option>
          <option value={6}>06:00</option>
          <option value={7}>07:00</option>
          <option value={8}>08:00</option>
          <option value={9}>09:00</option>
          <option value={10}>10:00</option>
          <option value={11}>11:00</option>
          <option value={12}>12:00 — Noon</option>
        </select>
        <button id="save-reset-btn" onclick={saveResetHour}>{resetSaved ? "Saved!" : "SET"}</button>
      </div>
    </div>
  {/if}
</div>
