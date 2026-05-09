<script>
  import { onMount } from "svelte";

  const TOTAL_STEPS = 3;
  let currentStep = $state(0);
  let serverStatus = $state(null);
  let checkingServer = $state(false);
  let finishing = $state(false);
  let copiedTarget = $state(null);
  let selectedServer = $state("ollama");

  let isLastStep = $derived(currentStep === TOTAL_STEPS - 1);

  const servers = {
    ollama: {
      name: "Ollama",
      port: 11434,
      downloadUrl: "https://ollama.com/download",
      description: "Popular open-source local model runner. Supports a wide range of models via a simple CLI.",
      setupInstructions: "Download and install Ollama, then pull a model (e.g. ollama pull llama3.2:1b).",
      needsCors: true,
    },
    lmstudio: {
      name: "LM Studio",
      port: 1234,
      downloadUrl: "https://lmstudio.ai",
      description: "Desktop app for running local models with a visual interface. Download models and start the local server.",
      setupInstructions: "Download and install LM Studio, load a model, then start the local server from the Developer tab.",
      needsCors: false,
    },
    gpt4all: {
      name: "GPT4All",
      port: 4891,
      downloadUrl: "https://gpt4all.io",
      description: "Privacy-focused local AI. Download models and enable the API server to use with FitLock.",
      setupInstructions: "Download and install GPT4All, download a model, then enable the API Server in Settings.",
      needsCors: false,
    }
  };

  let server = $derived(servers[selectedServer]);

  const macCorsCommand = `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"`;
  const windowsCorsInstructions = `Open System Properties > Environment Variables > Add New System Variable:
Name: OLLAMA_ORIGINS
Value: chrome-extension://*`;

  function goToStep(step) {
    if (step >= 0 && step < TOTAL_STEPS) {
      currentStep = step;
      serverStatus = null;
    }
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

  function handleSelectServer(key) {
    selectedServer = key;
    chrome.runtime.sendMessage({ action: "selectLocalAiServer", server: key });
  }

  function handleCheckServer() {
    checkingServer = true;
    serverStatus = null;

    chrome.runtime.sendMessage({ action: "checkLocalAiStatus", server: selectedServer }, (response) => {
      checkingServer = false;
      if (chrome.runtime.lastError) {
        serverStatus = { available: false, error: chrome.runtime.lastError.message };
      } else if (response && response.error === "cors") {
        serverStatus = { available: false, error: `${server.name} is running, but CORS is not configured correctly. Please complete Step 2.` };
      } else if (response && response.available) {
        serverStatus = { available: true };
      } else {
        serverStatus = { available: false, error: `Could not connect to ${server.name}. Is it running on port ${server.port}?` };
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

  <!-- Step 0: Choose Server -->
  {#if currentStep === 0}
    <div class="step-panel active" id="step-0">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 1 — CHOOSE YOUR AI SERVER</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="6" rx="1"/>
              <rect x="2" y="15" width="20" height="6" rx="1"/>
              <circle cx="6" cy="6" r="1" fill="currentColor"/>
              <circle cx="6" cy="18" r="1" fill="currentColor"/>
            </svg>
          </div>
          <h2>Choose Your Local AI Server</h2>
          <p class="step-desc">
            FitLock runs AI models locally on your machine for privacy. Select which server you want to use:
          </p>

          <div class="server-options">
            {#each Object.entries(servers) as [key, srv]}
              <button
                class="server-option"
                class:selected={selectedServer === key}
                onclick={() => handleSelectServer(key)}
              >
                <div class="server-option-header">
                  <strong>{srv.name}</strong>
                  <span class="server-port">port {srv.port}</span>
                </div>
                <p class="server-option-desc">{srv.description}</p>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Step 1: Install & Configure -->
  {#if currentStep === 1}
    <div class="step-panel active" id="step-1">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 2 — INSTALL & CONFIGURE</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <h2>Install {server.name}</h2>
          <p class="step-desc">{server.setupInstructions}</p>

          <div class="url-block">
            <code>{server.downloadUrl}</code>
            <button class="copy-btn" onclick={() => window.open(server.downloadUrl, "_blank")} title="Open in new tab">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>OPEN</span>
            </button>
          </div>

          {#if server.needsCors}
            <h3 style="color: #e8eaed; font-size: 13px; margin: 20px 0 8px;">Configure CORS</h3>
            <p class="step-desc">
              Ollama blocks extension requests by default. Set the <code>OLLAMA_ORIGINS</code> environment variable:
            </p>

            <h3 style="color: #e8eaed; font-size: 13px; margin: 12px 0 8px;">Mac Users (Terminal)</h3>
            <div class="url-block">
              <code>{macCorsCommand}</code>
              <button class="copy-btn" onclick={() => copyToClipboard(macCorsCommand, "macCmd")} title="Copy to clipboard">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span>{copiedTarget === "macCmd" ? "COPIED!" : "COPY"}</span>
              </button>
            </div>

            <h3 style="color: #e8eaed; font-size: 13px; margin: 12px 0 8px;">Windows Users</h3>
            <div class="url-block" style="align-items: flex-start;">
              <code style="white-space: pre-wrap;">{windowsCorsInstructions}</code>
            </div>

            <div class="callout">
              <span class="callout-icon">&#9888;</span>
              <span><strong>Important:</strong> After setting the variable, you must restart the Ollama app completely for the changes to take effect.</span>
            </div>
          {:else}
            <div class="callout" style="border-color: rgba(74, 222, 128, 0.2); background: rgba(74, 222, 128, 0.04);">
              <span class="callout-icon" style="color: #4ade80;">&#10004;</span>
              <span>No extra configuration needed. Just install {server.name}, load a model, and start the server.</span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Step 2: Verify -->
  {#if currentStep === 2}
    <div class="step-panel active" id="step-2">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-label">STEP 3 — VERIFY</span>
        </div>
        <div class="panel-body">
          <div class="step-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h2>Verify Connection</h2>
          <p class="step-desc">
            Make sure {server.name} is running{#if server.needsCors} and you have restarted it after configuring CORS{/if}. Click below to test the connection.
          </p>

          <button id="check-ai-btn" class="action-btn" onclick={handleCheckServer} disabled={checkingServer}>
            {checkingServer ? "CHECKING..." : `CHECK ${server.name.toUpperCase()} STATUS`}
          </button>

          {#if serverStatus}
            <div id="ai-status" class="status-result" class:success={serverStatus.available} class:error={!serverStatus.available}>
              <div id="ai-status-icon" class="status-icon">
                {#if serverStatus.available}
                  &#10004;
                {:else}
                  &#10008;
                {/if}
              </div>
              <div id="ai-status-text" class="status-text">
                {#if serverStatus.available}
                  <strong>{server.name.toUpperCase()} CONNECTED</strong><br>
                  Connection successful. FitLock can now run models locally via {server.name}. Open the extension popup and go to Config to select a model.
                {:else if serverStatus.error}
                  <strong>CHECK FAILED</strong><br>
                  {serverStatus.error}
                {:else}
                  <strong>{server.name.toUpperCase()} NOT DETECTED</strong><br>
                  Ensure {server.name} is running on port {server.port}.
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
    <p>FitLock v1.0 — On-device AI</p>
  </div>
</div>

<style>
  .server-options {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 16px 0;
  }

  .server-option {
    display: block;
    width: 100%;
    text-align: left;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 14px 16px;
    cursor: pointer;
    transition: all 0.15s ease;
    color: #9ca3af;
  }

  .server-option:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .server-option.selected {
    background: rgba(99, 102, 241, 0.08);
    border-color: rgba(99, 102, 241, 0.4);
    color: #e8eaed;
  }

  .server-option-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .server-option-header strong {
    font-size: 14px;
    color: #e8eaed;
  }

  .server-port {
    font-size: 11px;
    font-family: "SF Mono", "Fira Code", monospace;
    color: #6b7280;
    background: rgba(255, 255, 255, 0.04);
    padding: 2px 8px;
    border-radius: 4px;
  }

  .server-option-desc {
    font-size: 12px;
    line-height: 1.5;
    margin: 0;
    color: inherit;
  }
</style>
