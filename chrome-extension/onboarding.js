// ══════════════════════════════════════════════════════════════
//  FitLock — Onboarding Setup Wizard
// ══════════════════════════════════════════════════════════════
//  Step navigation, clipboard helpers, and AI availability check.
// ══════════════════════════════════════════════════════════════

const TOTAL_STEPS = 5;
let currentStep = 0;

// ── DOM References ──
const stepDots = document.querySelectorAll(".step-dot");
const stepLines = document.querySelectorAll(".step-line");
const stepPanels = document.querySelectorAll(".step-panel");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const finishBtn = document.getElementById("finish-btn");
const checkAiBtn = document.getElementById("check-ai-btn");
const aiStatus = document.getElementById("ai-status");
const aiStatusIcon = document.getElementById("ai-status-icon");
const aiStatusText = document.getElementById("ai-status-text");

// ── Step Navigation ──

function goToStep(step) {
    if (step < 0 || step >= TOTAL_STEPS) return;
    currentStep = step;

    // Update panels
    stepPanels.forEach((panel, i) => {
        panel.classList.toggle("active", i === step);
    });

    // Update stepper dots and lines
    stepDots.forEach((dot, i) => {
        dot.classList.remove("active", "completed");
        if (i === step) {
            dot.classList.add("active");
        } else if (i < step) {
            dot.classList.add("completed");
        }
    });

    stepLines.forEach((line, i) => {
        line.classList.remove("active", "completed");
        if (i < step) {
            line.classList.add("completed");
        } else if (i === step) {
            line.classList.add("active");
        }
    });

    // Update nav buttons
    prevBtn.classList.toggle("hidden", step === 0);

    const isLast = step === TOTAL_STEPS - 1;
    nextBtn.classList.toggle("hidden", isLast);
    finishBtn.classList.toggle("hidden", !isLast);

    // Update next button text
    if (step === 0) {
        nextBtn.textContent = "GET STARTED →";
    } else {
        nextBtn.textContent = "NEXT STEP →";
    }
}

nextBtn.addEventListener("click", () => goToStep(currentStep + 1));
prevBtn.addEventListener("click", () => goToStep(currentStep - 1));

finishBtn.addEventListener("click", () => {
    // Mark onboarding as complete
    chrome.storage.local.set({ onboardingComplete: true }, () => {
        // Update the topbar status
        const topbarStatus = document.querySelector(".topbar-status");
        topbarStatus.textContent = "SETUP COMPLETE";
        topbarStatus.style.color = "#4ade80";
        topbarStatus.style.borderColor = "rgba(34, 197, 94, 0.25)";
        topbarStatus.style.background = "rgba(34, 197, 94, 0.06)";

        // Show a brief completion message then close
        finishBtn.textContent = "CLOSING...";
        finishBtn.disabled = true;

        setTimeout(() => {
            window.close();
        }, 800);
    });
});

// ── Copy to Clipboard ──

document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const targetId = btn.dataset.target;
        const codeEl = document.getElementById(targetId);
        if (!codeEl) return;

        const text = codeEl.textContent;
        navigator.clipboard.writeText(text).then(() => {
            const label = btn.querySelector("span:last-child");
            const origText = label.textContent;
            label.textContent = "COPIED!";
            btn.classList.add("copied");

            setTimeout(() => {
                label.textContent = origText;
                btn.classList.remove("copied");
            }, 1500);
        }).catch(() => {
            // Fallback: select the text
            const range = document.createRange();
            range.selectNodeContents(codeEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });
    });
});

// ── AI Status Check ──
// The AI API (self.ai.languageModel / LanguageModel) is only available in
// page contexts — NOT in service workers. Since this onboarding page is an
// extension page, we can probe the API directly from here.

async function checkAiAvailability() {
    // Try the new global LanguageModel constructor (Chrome 131+)
    if (typeof LanguageModel !== "undefined") {
        try {
            // Newest Chrome versions use availability(), which returns a string natively
            if (typeof LanguageModel.availability === "function") {
                const avail = await LanguageModel.availability();
                // Depending on Chrome iteration it might be a string ("readily", "available")
                // or an object { available: "readily" }. Handle both.
                const state = typeof avail === "string" ? avail : (avail?.available || "no");

                if (state === "readily" || state === "available") return { available: true, api: "LanguageModel.availability" };
                if (state === "after-download") return { available: false, downloading: true, api: "LanguageModel.availability" };
            }

            // Fallback for slightly older versions using capabilities()
            if (typeof LanguageModel.capabilities === "function") {
                const caps = await LanguageModel.capabilities();
                const state = typeof caps === "string" ? caps : (caps?.available || "no");
                if (state === "readily" || state === "available") return { available: true, api: "LanguageModel.capabilities" };
                if (state === "after-download") return { available: false, downloading: true, api: "LanguageModel.capabilities" };
            }
        } catch (_) { /* fall through */ }
    }

    // Try the older self.ai.languageModel namespace
    if (typeof self.ai !== "undefined" && self.ai?.languageModel) {
        try {
            if (typeof self.ai.languageModel.capabilities === "function") {
                const caps = await self.ai.languageModel.capabilities();
                const state = typeof caps === "string" ? caps : (caps?.available || "no");
                if (state === "readily" || state === "available") return { available: true, api: "self.ai" };
                if (state === "after-download") return { available: false, downloading: true, api: "self.ai" };
            }
        } catch (_) { /* fall through */ }
    }

    // Try window.ai as a last resort
    if (typeof window.ai !== "undefined" && window.ai?.languageModel) {
        try {
            if (typeof window.ai.languageModel.capabilities === "function") {
                const caps = await window.ai.languageModel.capabilities();
                const state = typeof caps === "string" ? caps : (caps?.available || "no");
                if (state === "readily" || state === "available") return { available: true, api: "window.ai" };
                if (state === "after-download") return { available: false, downloading: true, api: "window.ai" };
            }
        } catch (_) { /* fall through */ }
    }

    return { available: false, downloading: false };
}

checkAiBtn.addEventListener("click", async () => {
    checkAiBtn.disabled = true;
    checkAiBtn.textContent = "CHECKING...";
    aiStatus.classList.add("hidden");
    aiStatus.classList.remove("success", "error");

    try {
        const result = await checkAiAvailability();

        aiStatus.classList.remove("hidden");

        if (result.available) {
            aiStatus.classList.add("success");
            aiStatusIcon.textContent = "✅";
            aiStatusText.innerHTML = `<strong>AI MODEL READY</strong><br>Gemini Nano is available and working (via ${result.api}). Smart Lock AI will classify YouTube videos locally on your device.`;
        } else if (result.downloading) {
            aiStatus.classList.add("error");
            aiStatusIcon.textContent = "⏳";
            aiStatusText.innerHTML = `<strong>MODEL DOWNLOADING</strong><br>The AI model API was detected but the model is still downloading. Visit <code>chrome://components</code> and check "Optimization Guide On Device Model", then wait for the download to complete.`;
        } else {
            aiStatus.classList.add("error");
            aiStatusIcon.textContent = "❌";
            aiStatusText.innerHTML = `<strong>AI MODEL NOT DETECTED</strong><br>Debug info: ${result.debug || "None"}<br>Make sure you've enabled both flags and restarted Chrome.`;
        }
    } catch (err) {
        aiStatus.classList.remove("hidden");
        aiStatus.classList.add("error");
        aiStatusIcon.textContent = "❌";
        aiStatusText.innerHTML = `<strong>CHECK FAILED</strong><br>${err.message || "Unable to check AI status. Try reloading this page."}`;
    }

    checkAiBtn.disabled = false;
    checkAiBtn.textContent = "CHECK AI STATUS";
});

// ── Keyboard Navigation ──

document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "Enter") {
        if (currentStep < TOTAL_STEPS - 1) goToStep(currentStep + 1);
    } else if (e.key === "ArrowLeft") {
        if (currentStep > 0) goToStep(currentStep - 1);
    }
});

// ── Init ──
goToStep(0);
