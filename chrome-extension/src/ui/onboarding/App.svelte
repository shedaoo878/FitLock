<script>
  import { onMount } from "svelte";

  const TOTAL_STEPS = 5;
  let currentStep = $state(0);
  let aiStatus = $state(null);
  let checkingAi = $state(false);
  let finishing = $state(false);
  let copiedTarget = $state(null);

  let isLastStep = $derived(currentStep === TOTAL_STEPS - 1);

  const flagUrls = [
    "chrome://flags/#optimization-guide-on-device-model",
    "chrome://flags/#prompt-api-for-gemini-nano",
    "chrome://components",
  ];

  function goToStep(step) {
    if (step >= 0 && step < TOTAL_STEPS) currentStep = step;
  }

  async function copyToClipboard(text, targetId) {
    try {
      await navigator.clipboard.writeText(text);
      copiedTarget = targetId;
      setTimeout(() => (copiedTarget = null), 1500);
    } catch {
      // Clipboard API unavailable — ignore
    }
  }

  async function checkAiAvailability() {
    if (typeof LanguageModel !== "undefined") {
      try {
        if (typeof LanguageModel.availability === "function") {
          const avail = await LanguageModel.availability();
          const state = typeof avail === "string" ? avail : avail?.available || "no";
          if (state === "readily" || state === "available") return { available: true, api: "LanguageModel.availability" };
          if (state === "after-download") return { available: false, downloading: true, api: "LanguageModel.availability" };
        }
        if (typeof LanguageModel.capabilities === "function") {
          const caps = await LanguageModel.capabilities();
          const state = typeof caps === "string" ? caps : caps?.available || "no";
          if (state === "readily" || state === "available") return { available: true, api: "LanguageModel.capabilities" };
          if (state === "after-download") return { available: false, downloading: true, api: "LanguageModel.capabilities" };
        }
      } catch {
        /* fall through */
      }
    }

    if (typeof self.ai !== "undefined" && self.ai?.languageModel) {
      try {
        if (typeof self.ai.languageModel.capabilities === "function") {
          const caps = await self.ai.languageModel.capabilities();
          const state = typeof caps === "string" ? caps : caps?.available || "no";
          if (state === "readily" || state === "available") return { available: true, api: "self.ai" };
          if (state === "after-download") return { available: false, downloading: true, api: "self.ai" };
        }
      } catch {
        /* fall through */
      }
    }

    if (typeof window.ai !== "undefined" && window.ai?.languageModel) {
      try {
        if (typeof window.ai.languageModel.capabilities === "function") {
          const caps = await window.ai.languageModel.capabilities();
          const state = typeof caps === "string" ? caps : caps?.available || "no";
          if (state === "readily" || state === "available") return { available: true, api: "window.ai" };
          if (state === "after-download") return { available: false, downloading: true, api: "window.ai" };
        }
      } catch {
        /* fall through */
      }
    }

    return { available: false, downloading: false };
  }

  async function handleCheckAi() {
    checkingAi = true;
    aiStatus = null;
    try {
      aiStatus = await checkAiAvailability();
    } catch (err) {
      aiStatus = { available: false, error: err.message };
    }
    checkingAi = false;
  }

  function finishSetup() {
    finishing = true;
    chrome.storage.local.set({ onboardingComplete: true }, () => {
      setTimeout(() => window.close(), 800);
    });
  }

  function handleKeydown(e) {
    if (e.key === "ArrowRight" || e.key === "Enter") {
      if (currentStep < TOTAL_STEPS - 1) goToStep(currentStep + 1);
    } else if (e.key === "ArrowLeft") {
      if (currentStep > 0) goToStep(currentStep - 1);
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  });
</script>

<div class="grid-bg"></div>

<div class="container">
  <!-- Top Bar -->
  <div class="topbar">
    <span class="topbar-logo">FITLOCK</span>
    {#if finishing}
      <span class="topbar-status" style="color: #4ade80; border-color: rgba(34, 197, 94, 0.25); background: rgba(34, 197, 94, 0.06);">SETUP COMPLETE</span>
    {:else}
      <span class="topbar-status">SETUP REQUIRED</span>
    {/if}
  </div>

  <!-- Stepper Indicator -->
  <div class="stepper">
    {#each Array(TOTAL_STEPS) as _, i}
      {#if i > 0}
        <div class="step-line" class:completed={i - 1 < currentStep} class:active={i - 1 === currentStep}></div>
      {/if}
      <div class="step-dot" class:active={i === currentStep} class:completed={i < currentStep} data-step={i}>
        <span>{i + 1}</span>
      </div>
    {/each}
  </div>

  <!-- Step 0: Welcome -->
  {#if currentStep === 0}
    <div class="step-panel active" id="step-0">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">WELCOME</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h2>Smart Lock AI Setup</h2>
          <p class="step-desc">
            FitLock uses <strong>Gemini Nano</strong> — Google's on-device AI model — to analyze YouTube videos
            and determine if they're productive or distracting. Everything runs <strong>locally on your machine</strong>,
            meaning your browsing data never leaves your device.
          </p>
          <p class="step-desc muted-desc">
            This AI feature requires a few Chrome flags to be enabled. This guide will walk you through each step.
            It takes about <strong>2 minutes</strong>.
          </p>
        </div>
      </div>
    </div>
  {/if}

  <!-- Step 1: Flag #1 -->
  {#if currentStep === 1}
    <div class="step-panel active" id="step-1">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 1 — ENABLE ON-DEVICE MODEL</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
              <line x1="4" y1="22" x2="4" y2="15"/>
            </svg>
          </div>
          <h2>Enable the On-Device Model</h2>
          <p class="step-desc">
            Copy the URL below and paste it into your Chrome address bar. Then set the flag to
            <strong class="highlight">Enabled BypassPerfRequirement</strong>.
          </p>
          <div class="url-block">
            <code>{flagUrls[0]}</code>
            <button class="copy-btn" onclick={() => copyToClipboard(flagUrls[0], "flag1")} title="Copy to clipboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>{copiedTarget === "flag1" ? "COPIED!" : "COPY"}</span>
            </button>
          </div>
          <div class="callout">
            <span class="callout-icon">&#9888;</span>
            <span>Select <strong>"Enabled BypassPerfRequirement"</strong> from the dropdown — not just "Enabled".</span>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Step 2: Flag #2 -->
  {#if currentStep === 2}
    <div class="step-panel active" id="step-2">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 2 — ENABLE PROMPT API</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
          </div>
          <h2>Enable the Prompt API</h2>
          <p class="step-desc">
            Copy this URL into Chrome's address bar and set the flag to <strong class="highlight">Enabled</strong>.
          </p>
          <div class="url-block">
            <code>{flagUrls[1]}</code>
            <button class="copy-btn" onclick={() => copyToClipboard(flagUrls[1], "flag2")} title="Copy to clipboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>{copiedTarget === "flag2" ? "COPIED!" : "COPY"}</span>
            </button>
          </div>
          <div class="callout info">
            <span class="callout-icon">&#8505;</span>
            <span>This flag enables Chrome's built-in Prompt API which FitLock uses for local AI inference.</span>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Step 3: Download Model -->
  {#if currentStep === 3}
    <div class="step-panel active" id="step-3">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 3 — DOWNLOAD AI MODEL</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <h2>Download the AI Model</h2>
          <p class="step-desc">
            Copy the URL below and paste it into Chrome. Find <strong>"Optimization Guide On Device Model"</strong>
            in the list, then click <strong class="highlight">"Check for update"</strong>.
          </p>
          <div class="url-block">
            <code>{flagUrls[2]}</code>
            <button class="copy-btn" onclick={() => copyToClipboard(flagUrls[2], "flag3")} title="Copy to clipboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>{copiedTarget === "flag3" ? "COPIED!" : "COPY"}</span>
            </button>
          </div>
          <div class="callout info">
            <span class="callout-icon">&#8505;</span>
            <span>The model download is ~1.7 GB. It may take a few minutes depending on your connection. The version number will update once the download completes.</span>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Step 4: Restart & Verify -->
  {#if currentStep === 4}
    <div class="step-panel active" id="step-4">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 4 — RESTART & VERIFY</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h2>Restart Chrome & Verify</h2>
          <p class="step-desc">
            Close and reopen Chrome for the flags to take effect. Then come back to this page and click the button below
            to verify that the AI model is ready.
          </p>

          <button id="check-ai-btn" class="action-btn" onclick={handleCheckAi} disabled={checkingAi}>
            {checkingAi ? "CHECKING..." : "CHECK AI STATUS"}
          </button>

          {#if aiStatus}
            <div id="ai-status" class="status-result" class:success={aiStatus.available} class:error={!aiStatus.available}>
              <div id="ai-status-icon" class="status-icon">
                {#if aiStatus.available}
                  &#10004;
                {:else if aiStatus.downloading}
                  &#9203;
                {:else}
                  &#10008;
                {/if}
              </div>
              <div id="ai-status-text" class="status-text">
                {#if aiStatus.available}
                  <strong>AI MODEL READY</strong><br>
                  Gemini Nano is available and working (via {aiStatus.api}). Smart Lock AI will classify YouTube videos locally on your device.
                {:else if aiStatus.downloading}
                  <strong>MODEL DOWNLOADING</strong><br>
                  The AI model API was detected but the model is still downloading. Visit <code>chrome://components</code> and check "Optimization Guide On Device Model", then wait for the download to complete.
                {:else if aiStatus.error}
                  <strong>CHECK FAILED</strong><br>
                  {aiStatus.error}
                {:else}
                  <strong>AI MODEL NOT DETECTED</strong><br>
                  Make sure you've enabled both flags and restarted Chrome.
                {/if}
              </div>
            </div>
          {/if}

          <div class="callout info" style="margin-top: 16px;">
            <span class="callout-icon">&#8505;</span>
            <span>If the check fails after restarting, wait a few minutes for the model to finish downloading, then try again.</span>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Navigation -->
  <div class="nav-row">
    {#if currentStep > 0}
      <button id="prev-btn" class="nav-btn" onclick={() => goToStep(currentStep - 1)}>&#8592; BACK</button>
    {:else}
      <div></div>
    {/if}
    <div class="nav-spacer"></div>
    {#if !isLastStep}
      <button id="next-btn" class="nav-btn primary" onclick={() => goToStep(currentStep + 1)}>
        {currentStep === 0 ? "GET STARTED" : "NEXT STEP"} &#8594;
      </button>
    {:else}
      <button id="finish-btn" class="nav-btn success" onclick={finishSetup} disabled={finishing}>
        {finishing ? "CLOSING..." : "FINISH SETUP"} &#10003;
      </button>
    {/if}
  </div>

  <!-- Footer -->
  <div class="footer">
    <p>FitLock v1.0 — On-device AI powered by Gemini Nano</p>
  </div>
</div>
