<script>
  import { onMount } from "svelte";

  const TOTAL_STEPS = 3;
  let currentStep = $state(0);
  let ollamaStatus = $state(null);
  let checkingOllama = $state(false);
  let finishing = $state(false);
  let copiedTarget = $state(null);

  let isLastStep = $derived(currentStep === TOTAL_STEPS - 1);

  const macCommand = `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"`;
  const windowsInstructions = `Open System Properties → Environment Variables → Add New System Variable:
Name: OLLAMA_ORIGINS
Value: chrome-extension://*`;
  const downloadUrl = "https://ollama.com/download";

  function goToStep(step) {
    if (step >= 0 && step < TOTAL_STEPS) currentStep = step;
  }

  async function copyToClipboard(text, targetId) {
    try {
      await navigator.clipboard.writeText(text);
      copiedTarget = targetId;
      setTimeout(() => (copiedTarget = null), 1500);
    } catch {
      // Clipboard API unavailable
    }
  }

  function handleCheckOllama() {
    checkingOllama = true;
    ollamaStatus = null;
    
    // Check background.js for ollama status
    chrome.runtime.sendMessage({ action: "checkOllamaStatus" }, (response) => {
      checkingOllama = false;
      if (chrome.runtime.lastError) {
        ollamaStatus = { available: false, error: chrome.runtime.lastError.message };
      } else if (response && response.error === "cors") {
        ollamaStatus = { available: false, error: "Ollama is running, but CORS is not configured correctly. Please complete Step 2." };
      } else if (response && response.available) {
        ollamaStatus = { available: true };
      } else {
         ollamaStatus = { available: false, error: "Could not connect to Ollama. Is it running?" };
      }
    });
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

  <!-- Step 0: Welcome / Download -->
  {#if currentStep === 0}
    <div class="step-panel active" id="step-0">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 1 — INSTALL OLLAMA</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <!-- Download Icon -->
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <h2>Install Ollama</h2>
          <p class="step-desc">
            FitLock uses <strong>Ollama</strong> to run AI models locally on your machine. Everything runs securely on your device, meaning your browsing data never leaves your computer.
          </p>
          <div class="url-block">
             <code>{downloadUrl}</code>
             <button class="copy-btn" onclick={() => window.open(downloadUrl, "_blank")} title="Open in new tab">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>
               </svg>
               <span>OPEN</span>
             </button>
           </div>
          <p class="step-desc muted-desc">
            Download and install Ollama for your operating system. Once installed, ensure the Ollama app is running in the background.
          </p>
        </div>
      </div>
    </div>
  {/if}

  <!-- Step 1: Configuration (CORS) -->
  {#if currentStep === 1}
    <div class="step-panel active" id="step-1">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 2 — CONFIGURE CORS</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
             <!-- Console Icon -->
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
          </div>
          <h2>Configure Ollama</h2>
          <p class="step-desc">
            By default, Ollama blocks requests from browser extensions. We need to set the `OLLAMA_ORIGINS` environment variable so FitLock can connect to it.
          </p>
          
          <h3 style="color: #e8eaed; font-size: 13px; margin: 16px 0 8px;">Mac Users (Terminal)</h3>
          <div class="url-block">
            <code>{macCommand}</code>
            <button class="copy-btn" onclick={() => copyToClipboard(macCommand, "macCmd")} title="Copy to clipboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>{copiedTarget === "macCmd" ? "COPIED!" : "COPY"}</span>
            </button>
          </div>

          <h3 style="color: #e8eaed; font-size: 13px; margin: 16px 0 8px;">Windows Users</h3>
          <div class="url-block" style="align-items: flex-start;">
            <code style="white-space: pre-wrap;">{windowsInstructions}</code>
          </div>
          
          <div class="callout">
             <span class="callout-icon">&#9888;</span>
             <span><strong>Important:</strong> After setting the variable, you must restart the Ollama app completely for the changes to take effect.</span>
           </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Step 2: Restart & Verify -->
  {#if currentStep === 2}
    <div class="step-panel active" id="step-2">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 3 — VERIFY</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <!-- Verify Icon -->
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h2>Verify Connection</h2>
          <p class="step-desc">
            Make sure Ollama is running and you have restarted it after configuring the environment variables. Click the button below to test the connection.
          </p>

          <button id="check-ai-btn" class="action-btn" onclick={handleCheckOllama} disabled={checkingOllama}>
            {checkingOllama ? "CHECKING..." : "CHECK OLLAMA STATUS"}
          </button>

          {#if ollamaStatus}
            <div id="ai-status" class="status-result" class:success={ollamaStatus.available} class:error={!ollamaStatus.available}>
              <div id="ai-status-icon" class="status-icon">
                {#if ollamaStatus.available}
                  &#10004;
                {:else}
                  &#10008;
                {/if}
              </div>
              <div id="ai-status-text" class="status-text">
                {#if ollamaStatus.available}
                  <strong>OLLAMA CONNECTED</strong><br>
                  Connection successful. FitLock can now run models locally via Ollama. Make sure to download a model (like llama3) if you haven't already.
                {:else if ollamaStatus.error}
                  <strong>CHECK FAILED</strong><br>
                  {ollamaStatus.error}
                {:else}
                  <strong>OLLAMA NOT DETECTED</strong><br>
                  Ensure the Ollama app is running and your `OLLAMA_ORIGINS` are configured.
                {/if}
              </div>
            </div>
          {/if}

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
        NEXT STEP &#8594;
      </button>
    {:else}
      <button id="finish-btn" class="nav-btn success" onclick={finishSetup} disabled={finishing}>
        {finishing ? "CLOSING..." : "FINISH SETUP"} &#10003;
      </button>
    {/if}
  </div>

  <!-- Footer -->
  <div class="footer">
    <p>FitLock v1.0 — On-device AI powered by Ollama</p>
  </div>
</div>
