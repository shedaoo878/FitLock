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

  // AI engine state
  let aiBackend = $state("gemini");
  let preferredAiBackend = $state(null);
  let geminiAvailable = $state(false);
  let checkingGemini = $state(false);

  // Local AI state
  let localAiServer = $state("ollama");
  let ollamaAvailable = $state(false);
  let ollamaModels = $state([]);
  let ollamaModel = $state("");
  let ollamaChecking = $state(false);
  let ollamaModelSaved = $state(false);
  let ollamaCorsError = $state(false);
  let backendSaved = $state(false);

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

  let todayMiles = $derived(lastCheck ? lastCheck.today?.miles || 0 : 0);
  let displayedGoalMiles = $derived(lastCheck?.goalMiles || goalMiles);

  let lockStateLabel = $derived.by(() => {
    if (!googleUser) return "AUTH REQUIRED";
    if (!stravaConnected) return "STRAVA REQUIRED";
    if (isUnlocked) return "UNLOCKED";
    if (blockedSites.length > 0) return "LOCKED";
    return "STANDBY";
  });

  let nextAction = $derived.by(() => {
    if (!googleUser) return "Sign in with Google to initialize account sync.";
    if (!stravaConnected) return "Connect Strava so FitLock can verify your run.";
    if (isUnlocked) return "Goal complete. Blocked domains are open until reset.";
    if (blockedSites.length > 0) return "Complete your run, then query Strava to unlock.";
    return "Add domains to activate your daily lock protocol.";
  });

  let aiStatusLabel = $derived.by(() => {
    if (preferredAiBackend === "gemini") return geminiAvailable ? "GEMINI READY" : "GEMINI CHECK";
    return ollamaAvailable ? "LOCAL ONLINE" : "LOCAL OFFLINE";
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
      aiBackend = res.aiBackend || "gemini";
      preferredAiBackend = res.preferredAiBackend || res.aiBackend || "gemini";
      localAiServer = res.localAiServer || "ollama";
      ollamaModel = res.localAiModel || "";

      if (!res.googleUser || !res.stravaConnected) {
        activeTab = "account";
      }

      // Check AI availability based on current preference
      if (preferredAiBackend === "gemini") {
        checkGeminiStatus();
      } else {
        refreshLocalAi();
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

  async function checkGeminiStatus() {
    checkingGemini = true;
    geminiAvailable = false;

    try {
      // Check directly in the popup's own page context (extension pages CAN access these APIs)
      // Try the new global LanguageModel constructor first
      if (typeof LanguageModel !== "undefined") {
        if (typeof LanguageModel.availability === "function") {
          const avail = await LanguageModel.availability();
          const state = typeof avail === "string" ? avail : avail?.available || "no";
          if (state === "readily" || state === "available") { geminiAvailable = true; checkingGemini = false; return; }
        }
        if (typeof LanguageModel.capabilities === "function") {
          const caps = await LanguageModel.capabilities();
          const state = typeof caps === "string" ? caps : caps?.available || "no";
          if (state === "readily" || state === "available") { geminiAvailable = true; checkingGemini = false; return; }
        }
      }

      // Try self.ai namespace
      if (typeof self.ai !== "undefined" && self.ai?.languageModel) {
        if (typeof self.ai.languageModel.capabilities === "function") {
          const caps = await self.ai.languageModel.capabilities();
          const state = typeof caps === "string" ? caps : caps?.available || "no";
          if (state === "readily" || state === "available") { geminiAvailable = true; checkingGemini = false; return; }
        }
      }

      // Try window.ai namespace
      if (typeof window.ai !== "undefined" && window.ai?.languageModel) {
        if (typeof window.ai.languageModel.capabilities === "function") {
          const caps = await window.ai.languageModel.capabilities();
          const state = typeof caps === "string" ? caps : caps?.available || "no";
          if (state === "readily" || state === "available") { geminiAvailable = true; checkingGemini = false; return; }
        }
      }
    } catch {
      // Fall through — not available
    }

    checkingGemini = false;
  }

  function setPreferredBackend(backend) {
    preferredAiBackend = backend;
    chrome.runtime.sendMessage({ action: "setPreferredAiBackend", backend }, () => {
      backendSaved = true;
      setTimeout(() => (backendSaved = false), 1500);

      if (backend === "gemini") {
        checkGeminiStatus();
      } else {
        refreshLocalAi();
      }
    });
  }

  function selectLocalAiServer(server) {
    localAiServer = server;
    chrome.runtime.sendMessage({ action: "selectLocalAiServer", server }, () => {
      ollamaModel = "";
      refreshLocalAi();
    });
  }

  function refreshLocalAi() {
    ollamaChecking = true;
    chrome.runtime.sendMessage({ action: "checkLocalAiStatus", server: localAiServer }, (res) => {
      ollamaChecking = false;
      if (chrome.runtime.lastError) {
        ollamaAvailable = false;
        ollamaModels = [];
        ollamaCorsError = false;
        return;
      }
      ollamaAvailable = res?.available || false;
      ollamaModels = res?.models || [];
      ollamaCorsError = res?.error === "cors";
    });
  }

  function selectOllamaModel() {
    if (!ollamaModel) return;
    chrome.runtime.sendMessage({ action: "selectLocalAiModel", model: ollamaModel }, () => {
      ollamaModelSaved = true;
      setTimeout(() => (ollamaModelSaved = false), 1500);
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
      <div>
        <span class="logo">FITLOCK</span>
        <span class="version">v1.0</span>
      </div>
      <span class="lock-chip" class:unlocked={isUnlocked} class:locked={!isUnlocked}>{lockStateLabel}</span>
    </div>
    {#if statusMessage}
      <div class={statusClass}>
        <span class="terminal-prefix">STATUS</span>
        <span>{statusMessage}</span>
      </div>
    {/if}
    <div class="dashboard-card">
      <div class="command-line">
        <span class="prompt">&gt;</span>
        <span>{nextAction}</span>
      </div>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-label">RUN</span>
          <span class="metric-value">{todayMiles.toFixed(2)}</span>
          <span class="metric-unit">/ {displayedGoalMiles} MI</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">LOCKLIST</span>
          <span class="metric-value">{blockedSites.length}</span>
          <span class="metric-unit">{blockedSites.length === 1 ? "DOMAIN" : "DOMAINS"}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">AI</span>
          <span class="metric-value small">{preferredAiBackend === "gemini" ? "GEMINI" : "LOCAL"}</span>
          <span class="metric-unit">{aiStatusLabel}</span>
        </div>
      </div>
      <div id="progress-section">
        <div class="data-row">
          <span class="data-label">DAILY PROGRESS</span>
          <span id="progress-text" class="data-value">{lastCheck ? progressText : "Awaiting Strava query"}</span>
        </div>
        <div class="progress-bar">
          <div id="progress-fill" class="progress-fill" style="width: {progressPct}%"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Tab Navigation -->
  <div class="tabs">
    <button class="tab" class:active={activeTab === "sites"} onclick={() => (activeTab = "sites")}>
      <span class="tab-index">01</span>
      <span>BLOCKED</span>
    </button>
    <button class="tab" class:active={activeTab === "goal"} onclick={() => (activeTab = "goal")}>
      <span class="tab-index">02</span>
      <span>GOAL</span>
    </button>
    <button class="tab" class:active={activeTab === "account"} onclick={() => (activeTab = "account")}>
      <span class="tab-index">03</span>
      <span>ACCOUNT</span>
    </button>
    <button class="tab" class:active={activeTab === "settings"} onclick={() => (activeTab = "settings")}>
      <span class="tab-index">04</span>
      <span>CONFIG</span>
    </button>
  </div>

  <!-- Sites Tab -->
  {#if activeTab === "sites"}
    <div class="tab-content active" id="tab-sites">
      <div class="section-header">
        <span class="section-label">DOMAIN BLOCKLIST</span>
        <span class="section-meta">{blockedSites.length} ACTIVE</span>
      </div>
      <div class="terminal-panel">
        <div class="input-group">
          <input type="text" bind:value={siteInput} placeholder="enter domain" spellcheck="false" onkeydown={handleSiteKeydown}>
          <button id="add-site-btn" class="primary-btn" onclick={addSite}>+ ADD</button>
        </div>
        {#if blockedSites.length === 0}
          <div class="empty-state">
            <span class="empty-code">NO_TARGETS</span>
            <p class="muted">No domains registered. Add a site to activate lock rules.</p>
          </div>
        {:else}
          <ul id="blocked-list">
            {#each blockedSites as domain}
              <li>
                <span class="domain">{domain}</span>
                <div class="row-actions">
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
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Goal Tab -->
  {#if activeTab === "goal"}
    <div class="tab-content active" id="tab-goal">
      <div class="section-header">
        <span class="section-label">DAILY OBJECTIVE</span>
        <span class="section-meta">{Math.round(progressPct)}% COMPLETE</span>
      </div>
      <div class="terminal-panel">
        <div class="goal-hero">
          <div>
            <span class="metric-label">TODAY</span>
            <div class="goal-number">{todayMiles.toFixed(2)}<span> MI</span></div>
          </div>
          <div class="goal-target">
            <span class="metric-label">TARGET</span>
            <strong>{displayedGoalMiles} MI</strong>
          </div>
        </div>
        <div class="progress-bar large">
          <div id="progress-fill" class="progress-fill" style="width: {progressPct}%"></div>
        </div>
        <label for="goal-input">Distance requirement (mi)</label>
        <div class="input-group">
          <input type="number" id="goal-input" bind:value={goalMiles} min="0.1" step="0.1">
          <button id="save-goal-btn" class="primary-btn" onclick={setGoal}>{goalSaved ? "SAVED!" : "SET"}</button>
        </div>
        <button id="check-goal-btn" class="full-btn primary-btn" onclick={checkGoal} disabled={checkingGoal}>
          {checkingGoal ? "Checking..." : "QUERY STRAVA"}
        </button>
      </div>
    </div>
  {/if}

  <!-- Account Tab -->
  {#if activeTab === "account"}
    <div class="tab-content active" id="tab-account">
      {#if !googleUser}
        <!-- Google Sign In -->
        <div id="google-disconnected" class="terminal-panel">
          <div class="section-header compact">
            <span class="section-label">FITLOCK ACCOUNT</span>
            <span class="section-meta warning">OFFLINE</span>
          </div>
          <p class="setting-desc">Sign in with Google to sync your settings and connect Strava.</p>
          <button id="connect-google-btn" class="full-btn primary-btn" onclick={connectGoogle} disabled={googleSigningIn}>
            {googleSigningIn ? "SIGNING IN..." : "SIGN IN WITH GOOGLE"}
          </button>
        </div>
      {:else}
        <!-- Google Connected -->
        <div id="google-connected" class="account-stack">
          <div class="terminal-panel">
            <div class="section-header compact">
              <span class="section-label">FITLOCK ACCOUNT</span>
              <span class="section-meta positive">ONLINE</span>
            </div>
            <div class="connection-status">
              <span class="status-dot online"></span>
              <span id="google-email-label" class="status-label">{googleUser.email || "SIGNED IN"}</span>
            </div>
            <button
              id="disconnect-google-btn"
              class="full-btn danger-btn"
              onclick={disconnectGoogle}
              disabled={googleSigningOut}
            >
              {googleSigningOut ? "SIGNING OUT..." : "SIGN OUT"}
            </button>
          </div>

          <hr class="divider">

          <!-- Strava Section -->
          {#if !stravaConnected}
            <div id="strava-disconnected" class="terminal-panel">
              <div class="section-header compact">
                <span class="section-label">STRAVA CONNECTION</span>
                <span class="section-meta warning">REQUIRED</span>
              </div>
              <p class="setting-desc">Link your Strava account to track running goals.</p>
              <button id="connect-strava-btn" class="full-btn strava-btn" onclick={connectStrava} disabled={stravaConnecting}>
                {stravaConnecting ? "Connecting..." : "CONNECT TO STRAVA"}
              </button>
            </div>
          {:else}
            <div id="strava-connected" class="terminal-panel">
              <div class="section-header compact">
                <span class="section-label">STRAVA CONNECTION</span>
                <span class="section-meta positive">SYNC READY</span>
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
      <!-- AI Engine Section -->
      <div class="section-header">
        <span class="section-label">AI ENGINE</span>
        <span class="section-meta">{aiStatusLabel}</span>
      </div>
      <div class="terminal-panel">
        <p class="setting-desc">Choose which AI backend Smart Lock uses for YouTube analysis.</p>

        <div class="ai-engine-selector">
          <button
            class="engine-option"
            class:selected={preferredAiBackend === "gemini"}
            onclick={() => setPreferredBackend("gemini")}
          >
            <span class="engine-icon">✦</span>
            <span class="engine-name">Gemini Nano</span>
            <span class="engine-tag">BUILT-IN</span>
          </button>
          <button
            class="engine-option"
            class:selected={preferredAiBackend === "ollama"}
            onclick={() => setPreferredBackend("ollama")}
          >
            <span class="engine-icon">⚙</span>
            <span class="engine-name">Local AI Server</span>
            <span class="engine-tag">EXTERNAL</span>
          </button>
        </div>

        {#if backendSaved}
          <p class="setting-desc success-message">Preference saved — reload YouTube tabs to apply.</p>
        {/if}

        <!-- Gemini Nano Status -->
        {#if preferredAiBackend === "gemini"}
          <div class="ai-status-box">
            <div class="connection-status inline">
              <span class="status-dot" class:online={geminiAvailable}></span>
              <span class="status-label" class:offline={!geminiAvailable}>
                {checkingGemini ? "CHECKING..." : geminiAvailable ? "AVAILABLE" : "NOT DETECTED"}
              </span>
            </div>
            {#if geminiAvailable}
              <p class="setting-desc subtle">Gemini Nano is ready. YouTube videos will be analyzed on-device using Chrome's built-in AI.</p>
            {:else}
              <p class="setting-desc warning-text">Gemini Nano is not available. Enable Chrome flags and download the model via the onboarding guide, or switch to a Local AI Server.</p>
            {/if}
            <button class="full-btn primary-btn" onclick={checkGeminiStatus} disabled={checkingGemini}>
              {checkingGemini ? "Checking..." : "RECHECK GEMINI STATUS"}
            </button>
          </div>
        {/if}

        <!-- Local AI Server Config -->
        {#if preferredAiBackend === "ollama"}
          <div class="ai-status-box">
            <label for="local-ai-server-select">Server</label>
            <div class="input-group">
              <select id="local-ai-server-select" bind:value={localAiServer} onchange={(e) => selectLocalAiServer(e.target.value)}>
                <option value="ollama">Ollama</option>
                <option value="lmstudio">LM Studio</option>
                <option value="gpt4all">GPT4All</option>
              </select>
            </div>

            <div class="connection-status inline">
              <span class="status-dot" class:online={ollamaAvailable}></span>
              <span class="status-label" class:offline={!ollamaAvailable}>
                {ollamaChecking ? "CHECKING..." : ollamaAvailable ? "CONNECTED" : "NOT DETECTED"}
              </span>
            </div>

            {#if ollamaAvailable && ollamaModels.length > 0}
              <label for="ollama-model-select">Model</label>
              <div class="input-group">
                <select id="ollama-model-select" bind:value={ollamaModel}>
                  <option value="">Select a model...</option>
                  {#each ollamaModels as model}
                    <option value={model}>{model}</option>
                  {/each}
                </select>
                <button id="save-ollama-btn" class="primary-btn" onclick={selectOllamaModel} disabled={!ollamaModel}>
                  {ollamaModelSaved ? "Saved!" : "SET"}
                </button>
              </div>
            {:else if ollamaAvailable}
              <p class="setting-desc">Server is running but no models found. Pull or load a model first.</p>
            {:else if ollamaCorsError}
              <p class="setting-desc warning-text">
                Server is running but blocking extension requests. Set the OLLAMA_ORIGINS environment variable:
              </p>
              <div class="cors-fix-box">
                <code>OLLAMA_ORIGINS=chrome-extension://* ollama serve</code>
              </div>
            {:else}
              <p class="setting-desc">Install and start your local AI server to enable Smart Lock.</p>
            {/if}

            <button class="full-btn primary-btn" onclick={refreshLocalAi} disabled={ollamaChecking}>
              {ollamaChecking ? "Checking..." : "REFRESH STATUS"}
            </button>
          </div>
        {/if}
      </div>

      <hr class="divider">

      <!-- Reset Schedule -->
      <div class="terminal-panel">
        <div class="section-header compact">
          <span class="section-label">RESET SCHEDULE</span>
          <span class="section-meta">{resetHour}:00</span>
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
          <button id="save-reset-btn" class="primary-btn" onclick={saveResetHour}>{resetSaved ? "Saved!" : "SET"}</button>
        </div>
      </div>
    </div>
  {/if}
</div>
