// ══════════════════════════════════════════════════════════════
//  YouTube Smart Lock — Content Script
// ══════════════════════════════════════════════════════════════
//  This script runs AI inference locally, and blocks/unblocks
//  the page via DOM modifications and CSS classes.
//
//  Depends on: smartlock_logger.js (loaded first via manifest)
// ══════════════════════════════════════════════════════════════

let currentVideoId = null;
let overlayActive = false;
let analysisGeneration = 0;  // incremented on every new analysis to cancel stale ones
let aiBackend = "gemini"; // "gemini" or "ollama" — set during init based on AI availability
let localAiConfigured = false; // whether a local AI model has been selected
let youtubePrompt = null; // custom YouTube prompt loaded from storage (null = use default in bridge)

// ── Session-scoped verdict cache ────────────────────────────
// Keeps track of AI verdicts for the current browsing session so that
// re-visiting the same video doesn't require another AI call and
// previously-blocked videos stay blocked.
const verdictCache = new Map(); // videoId → { isProductive: boolean }

console.log("[FitLock] Content script loaded on:", window.location.href);

// ── Helper: find the player container to host overlays ──────

function getPlayerContainer() {
    return (
        document.querySelector("#movie_player") ||
        document.querySelector("ytd-player#ytd-player") ||
        document.querySelector("#player-container-inner") ||
        document.querySelector("#player-container-outer")
    );
}

// ── Helper: find and pause/play the <video> element ─────────

function lockVideoPlayback() {
    // If an ad is playing, do not lock it!
    const player = document.querySelector("#movie_player");
    if (player && (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting"))) {
        console.log("⚠️ [FitLock Content] Ad is playing, skipping lock request.");
        return;
    }
    console.log("🛑 [FitLock Content] Sending LOCK signal to Main World bridge...");
    window.postMessage({ type: "FITLOCK_LOCK_VIDEO" }, "*");
}

function unlockVideoPlayback(shouldPlay = true) {
    console.log(`▶️ [FitLock Content] Sending UNLOCK signal to Main World bridge... (shouldPlay=${shouldPlay})`);
    window.postMessage({ type: "FITLOCK_UNLOCK_VIDEO", play: shouldPlay }, "*");

    if (shouldPlay) {
        // Nudge YouTube's control-bar auto-hide timer by simulating a brief mouse
        // interaction on the player. Without this, the controls can stay visible
        // and frozen after we resume playback via the API.
        requestAnimationFrame(() => {
            const player = document.querySelector("#movie_player");
            if (player) {
                player.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
            }
        });
    }
}

// ── UI Management ───────────────────────────────────────────

function showScanningOverlay() {
    // If an ad is playing, do not show the scanning overlay or pause the video
    const player = document.querySelector("#movie_player");
    if (player && (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting"))) {
        console.log("[FitLock] Ad is currently playing, skipping scanning overlay.");
        return;
    }

    if (overlayActive) return;
    overlayActive = true;
    document.body.classList.remove("fitlock-productive");

    // Pause video immediately so nothing plays behind the overlay, and lock it
    lockVideoPlayback();

    // Remove any lingering blocked overlay
    const blocked = document.getElementById("fitlock-blocked-overlay");
    if (blocked) blocked.remove();

    let overlay = document.getElementById("fitlock-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "fitlock-overlay";
        overlay.innerHTML = `
      <div class="fitlock-spinner"></div>
      <h1>SCANNING VIDEO</h1>
      <p>FitLock AI is analyzing content...</p>
    `;
    }

    // Insert into the player container so it covers only the video area
    const container = getPlayerContainer();
    if (container) {
        container.appendChild(overlay);
    } else {
        // Fallback: append to body (shouldn't happen on /watch pages)
        document.body.appendChild(overlay);
    }
    overlay.style.display = "flex";
}

function hideOverlayAndAllow() {
    overlayActive = false;
    document.body.classList.add("fitlock-productive");

    const overlay = document.getElementById("fitlock-overlay");
    if (overlay) overlay.remove();

    const blocked = document.getElementById("fitlock-blocked-overlay");
    if (blocked) blocked.remove();

    // Unlock and resume playback — the model said this video is fine
    unlockVideoPlayback(true);
}

function cleanupOverlaysOnly() {
    overlayActive = false;

    // Do NOT add fitlock-productive here — on non-watch pages the CSS rules
    // hide the video element by default.  Adding the class would briefly flash
    // the cached video frame, causing a visible flicker.

    const overlay = document.getElementById("fitlock-overlay");
    if (overlay) overlay.remove();

    const blocked = document.getElementById("fitlock-blocked-overlay");
    if (blocked) blocked.remove();

    // Unlock but do NOT resume playback
    unlockVideoPlayback(false);

    // Actively pause and mute to prevent audio leak from the SPA-cached video.
    // Use YouTube's API for pause, but mute via the raw element since YouTube's
    // API doesn't expose a standalone mute-without-toggle.
    window.postMessage({ type: "FITLOCK_PAUSE_VIDEO" }, "*");
    const video = document.querySelector("video");
    if (video) {
        video.muted = true;
    }

    // Reset currentVideoId so that clicking the same video again triggers
    // a fresh analysis (which will hit the verdict cache for instant blocking).
    currentVideoId = null;
}

function blockVideo() {
    overlayActive = false;

    // Remove scanning overlay
    const scanOverlay = document.getElementById("fitlock-overlay");
    if (scanOverlay) scanOverlay.remove();

    // Don't add the productive class — keep the player hidden
    document.body.classList.remove("fitlock-productive");

    // Ensure video stays locked forever while blocked
    lockVideoPlayback();

    // Build in-player blocked overlay
    let blocked = document.getElementById("fitlock-blocked-overlay");
    if (!blocked) {
        blocked = document.createElement("div");
        blocked.id = "fitlock-blocked-overlay";
        blocked.innerHTML = `
      <div class="fitlock-blocked-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="1" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          <circle cx="12" cy="16.5" r="1.5" />
        </svg>
      </div>
      <h1>VIDEO BLOCKED</h1>
      <p>This video has been flagged as unproductive by FitLock AI.<br>
         Complete your daily running objective to unlock all content.</p>
    `;
    }

    const container = getPlayerContainer();
    if (container) {
        container.appendChild(blocked);
    } else {
        document.body.appendChild(blocked);
    }
    blocked.style.display = "flex";
}

function showOllamaSetupOverlay() {
    if (overlayActive) return;
    overlayActive = true;
    document.body.classList.remove("fitlock-productive");

    lockVideoPlayback();

    // Remove any lingering overlays
    const existing = document.getElementById("fitlock-overlay");
    if (existing) existing.remove();
    const blocked = document.getElementById("fitlock-blocked-overlay");
    if (blocked) blocked.remove();

    let overlay = document.getElementById("fitlock-ollama-setup-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "fitlock-ollama-setup-overlay";
        overlay.innerHTML = `
      <div class="fitlock-blocked-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <circle cx="12" cy="16" r="0.5" fill="currentColor" />
        </svg>
      </div>
      <h1>LOCAL AI REQUIRED</h1>
      <p>Set up a local AI server in FitLock extension settings to enable Smart Lock.<br>
         Choose your server (Ollama, LM Studio, or GPT4All), start it, then select a model in the Config tab.</p>
    `;
    }

    const container = getPlayerContainer();
    if (container) {
        container.appendChild(overlay);
    } else {
        document.body.appendChild(overlay);
    }
    overlay.style.display = "flex";
}

// ── Metadata Extraction ──────────────────────────────────────

function scrapeMetadata(logEntry, targetVideoId) {
    const scrapeStart = performance.now();
    let title = "";
    let source = null;

    // WAIT for the DOM to reflect the correct video ID
    if (targetVideoId) {
        const watchFlexy = document.querySelector("ytd-watch-flexy");
        if (!watchFlexy || watchFlexy.getAttribute("video-id") !== targetVideoId) {
            console.log(`[FitLock] DOM not yet updated for ${targetVideoId}, waiting...`);
            return { title: "", channel: "", description: "" };
        }
    }

    const selectors = [
        { sel: "h1.ytd-video-primary-info-renderer", label: "h1.ytd-video-primary-info-renderer" },
        { sel: "#above-the-fold #title h1 yt-formatted-string", label: "#title h1 yt-formatted-string" },
        { sel: "meta[name='title']", label: "meta[name=title]" },
        { sel: "title", label: "document.title" },
    ];

    for (const { sel, label } of selectors) {
        const el = document.querySelector(sel);
        if (el) {
            title = el.tagName === "META" ? el.content : el.textContent.trim();
            if (title && title !== "YouTube" && title !== "") {
                source = label;
                break;
            }
        }
    }

    let channel = "";
    const channelEl =
        document.querySelector("#owner #channel-name a") ||
        document.querySelector("ytd-video-owner-renderer #channel-name a") ||
        document.querySelector("span.ytd-channel-name a");
    if (channelEl) channel = channelEl.textContent.trim();

    let description = "";

    // Try the structured description element first — it's scoped to the
    // current video component and updates more reliably during SPA navigations
    // than the <meta name="description"> tag (which often retains the PREVIOUS
    // video's description during YouTube's client-side routing).
    const expanderEl = document.querySelector(
        "ytd-watch-metadata #description yt-attributed-string, " +
        "ytd-text-inline-expander #content, " +
        "ytd-text-inline-expander .content, " +
        "#description-inline-expander #plain-snippet-text, " +
        "#description-inline-expander yt-attributed-string"
    );
    if (expanderEl) {
        description = expanderEl.textContent.trim().substring(0, 500);
    }

    // Fallback to meta tag only if the DOM element was empty and the meta tag is fresh
    if (!description) {
        const ogUrlMeta = document.querySelector("meta[property='og:url']");
        const isMetaFresh = !targetVideoId || (ogUrlMeta && ogUrlMeta.content.includes(targetVideoId));
        if (isMetaFresh) {
            const descMeta = document.querySelector("meta[name='description']");
            if (descMeta) {
                const raw = descMeta.content || "";
                if (!raw.startsWith("Enjoy the videos and music you love")) {
                    description = raw;
                }
            }
        }
    }

    title = title.replace(/\s*-\s*YouTube\s*$/, "").trim();

    const scrapeDurationMs = Math.round(performance.now() - scrapeStart);

    logEntry.metadata.title = title || "(empty)";
    logEntry.metadata.channel = channel || "(unknown)";
    logEntry.metadata.description = description || "(empty)";
    logEntry.metadata.source = source || "(none matched)";
    logEntry.metadata.scrapeDurationMs = scrapeDurationMs;

    return { title, channel, description };
}

// ── AI Inference (Via Main World Bridge) ───────────────────────

function runInference(title, description, logEntry) {
    return new Promise((resolve) => {
        const inferenceStart = performance.now();
        const requestId = crypto.randomUUID();

        // Listener for the response
        const messageListener = (event) => {
            if (event.source !== window || !event.data || event.data.type !== "FITLOCK_AI_RESPONSE" || event.data.id !== requestId) {
                return;
            }

            window.removeEventListener("message", messageListener);

            const res = event.data;
            logEntry.ai.inferenceDurationMs = Math.round(performance.now() - inferenceStart);

            if (res.error) {
                logEntry.ai.available = false;
                logEntry.ai.error = res.error;
                resolve(null);
                return;
            }

            logEntry.ai.available = true;
            logEntry.ai.rawResponse = res.rawResponse;

            const result = res.rawResponse;
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    logEntry.ai.parsedResponse = parsed;
                    logEntry.ai.parseMethod = "json_match";
                    resolve(parsed.isProductive === true);
                    return;
                } catch (parseErr) {
                    logEntry.ai.error = "JSON.parse failed on matched block: " + parseErr.message;
                }
            }

            const fallback = result.toLowerCase().includes('"isproductive": true') ||
                result.toLowerCase().includes('"isproductive":true');
            logEntry.ai.parsedResponse = { fallbackMatch: fallback };
            logEntry.ai.parseMethod = "includes_fallback";
            resolve(fallback);
        };

        window.addEventListener("message", messageListener);

        // Ping the main world
        window.postMessage({
            type: "FITLOCK_AI_REQUEST",
            id: requestId,
            title,
            description,
            systemPrompt: youtubePrompt || null
        }, "*");

        // Timeout safeguard
        setTimeout(() => {
            window.removeEventListener("message", messageListener);
            if (logEntry.ai.inferenceDurationMs === null) {
                logEntry.ai.error = "Main world AI bridge timed out after 30 seconds.";
                logEntry.ai.inferenceDurationMs = Math.round(performance.now() - inferenceStart);
                resolve(null);
            }
        }, 30000);
    });
}

// ── AI Inference (Via Local AI Server / Background Script) ──────────────

function runLocalAiInference(title, description, logEntry) {
    return new Promise((resolve) => {
        const inferenceStart = performance.now();

        chrome.runtime.sendMessage(
            { action: "localAiInference", title, description },
            (res) => {
                logEntry.ai.inferenceDurationMs = Math.round(performance.now() - inferenceStart);

                if (chrome.runtime.lastError || !res || !res.success) {
                    const errMsg = res?.error || chrome.runtime.lastError?.message || "Ollama inference failed";
                    console.error("[FitLock] Local AI inference error:", errMsg);
                    logEntry.ai.available = false;
                    logEntry.ai.error = errMsg;
                    resolve(null);
                    return;
                }

                logEntry.ai.available = true;
                logEntry.ai.rawResponse = res.rawResponse;

                console.log("[FitLock] Local AI raw response:", res.rawResponse);

                // Strip markdown code fences if present (e.g. ```json ... ```)
                let result = res.rawResponse;
                result = result.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

                const jsonMatch = result.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        logEntry.ai.parsedResponse = parsed;
                        logEntry.ai.parseMethod = "json_match";
                        console.log("[FitLock] Local AI parsed:", parsed);
                        resolve(parsed.isProductive === true);
                        return;
                    } catch (parseErr) {
                        logEntry.ai.error = "JSON.parse failed on matched block: " + parseErr.message;
                    }
                }

                const fallback = result.toLowerCase().includes('"isproductive": true') ||
                    result.toLowerCase().includes('"isproductive":true');
                logEntry.ai.parsedResponse = { fallbackMatch: fallback };
                logEntry.ai.parseMethod = "includes_fallback";
                console.log("[FitLock] Local AI fallback parse, isProductive:", fallback);
                resolve(fallback);
            }
        );

        // Timeout safeguard (60s for local models since they can be slower)
        setTimeout(() => {
            if (logEntry.ai.inferenceDurationMs === null) {
                logEntry.ai.error = "Local AI inference timed out after 60 seconds.";
                logEntry.ai.inferenceDurationMs = Math.round(performance.now() - inferenceStart);
                resolve(null);
            }
        }, 60000);
    });
}

// ── Main Analysis Pipeline ───────────────────────────────────

async function analyzeCurrentVideo(trigger) {
    // Bump generation so any in-flight analysis for a previous video is discarded
    const thisGeneration = ++analysisGeneration;
    const logEntry = createLogEntry(trigger);

    console.log(`[FitLock] ── Pipeline start (gen ${thisGeneration}) ── trigger: ${trigger}, url: ${window.location.href}`);

    if (!window.location.pathname.startsWith("/watch")) {
        logEntry.verdict.isProductive = null;
        logEntry.verdict.action = "skip_non_watch";
        await finalizeLog(logEntry);
        cleanupOverlaysOnly();
        return;
    }

    // Identify the target video ID we're supposed to analyze
    const targetVideoId = new URLSearchParams(window.location.search).get("v");

    // ── Check session verdict cache ──────────────────────────
    if (targetVideoId && verdictCache.has(targetVideoId)) {
        const cached = verdictCache.get(targetVideoId);
        console.log(`[FitLock] Cache hit for ${targetVideoId}: isProductive=${cached.isProductive}`);

        logEntry.verdict.isProductive = cached.isProductive;
        logEntry.verdict.action = cached.isProductive ? "allow_cached" : "block_cached";

        if (cached.isProductive) {
            hideOverlayAndAllow();
        } else {
            // Show scanning briefly then immediately block
            showScanningOverlay();
            blockVideo();
        }

        await finalizeLog(logEntry);
        return;
    }

    let retries = 0;
    const maxRetries = 20; // Increased retries since we might be waiting for SPA DOM update
    let metadata = { title: "", channel: "", description: "" };

    while (retries < maxRetries) {
        // If an ad is playing, keep waiting until the actual video starts
        const player = document.querySelector("#movie_player");
        if (player && (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting"))) {
            console.log(`[FitLock] Ad showing, waiting for actual video... (gen ${thisGeneration})`);
            // Remove overlay/pause if ad started *after* we began analysis
            hideOverlayAndAllow();
            await new Promise((r) => setTimeout(r, 1000));

            // Stale check inside the ad wait loop
            if (thisGeneration !== analysisGeneration) {
                logEntry.verdict.action = "cancelled_stale";
                await finalizeLog(logEntry);
                return;
            }
            continue;
        }

        // Ad is gone, ensure overlay is up and video is paused
        showScanningOverlay();

        metadata = scrapeMetadata(logEntry, targetVideoId);
        if (metadata.title && metadata.title !== "(empty)") break;
        retries++;
        await new Promise((r) => setTimeout(r, 500));
    }
    logEntry.metadata.retries = retries;

    // Stale check after metadata scraping
    if (thisGeneration !== analysisGeneration) {
        logEntry.verdict.action = "cancelled_stale";
        console.log(`[FitLock] ── Pipeline cancelled (gen ${thisGeneration} superseded by ${analysisGeneration}) ──`);
        await finalizeLog(logEntry);
        return;
    }

    if (!metadata.title || metadata.title === "(empty)") {
        logEntry.verdict.isProductive = null;
        logEntry.verdict.action = "skip_no_metadata";
        logEntry.ai.error = `Failed to extract title after ${maxRetries} retries`;
        await finalizeLog(logEntry);
        hideOverlayAndAllow(); // Fail open if we can't get metadata
        return;
    }

    const isProductive = aiBackend === "gemini"
        ? await runInference(metadata.title, metadata.description, logEntry)
        : await runLocalAiInference(metadata.title, metadata.description, logEntry);

    // Stale check after AI inference
    if (thisGeneration !== analysisGeneration) {
        logEntry.verdict.action = "cancelled_stale";
        console.log(`[FitLock] ── Pipeline cancelled (gen ${thisGeneration} superseded by ${analysisGeneration}) ──`);
        await finalizeLog(logEntry);
        return;
    }

    if (isProductive === null) {
        logEntry.verdict.isProductive = null;
        logEntry.verdict.action = "inconclusive_ai_unavailable";
        blockVideo(); // Fail closed — block until a local AI server is available
    } else {
        logEntry.verdict.isProductive = isProductive;
        logEntry.verdict.action = isProductive ? "allow" : "block";

        // Cache the verdict for this session so re-visits are instant
        if (targetVideoId) {
            verdictCache.set(targetVideoId, { isProductive });
            console.log(`[FitLock] Cached verdict for ${targetVideoId}: isProductive=${isProductive}`);
        }

        if (isProductive) {
            hideOverlayAndAllow();
        } else {
            blockVideo();
        }
    }

    await finalizeLog(logEntry);
}

// ── Initialization ───────────────────────────────────────────

function initSmartLock() {
    chrome.runtime.sendMessage({ action: "getStatus" }, (res) => {
        if (chrome.runtime.lastError) {
            console.error("[FitLock] Failed to get status:", chrome.runtime.lastError.message);
            return;
        }

        // Set AI backend for the session
        aiBackend = res.aiBackend || "gemini";
        localAiConfigured = !!res.localAiModel;

        // Load custom prompt from storage
        chrome.storage.local.get(["youtubePrompt"], (promptData) => {
            if (promptData.youtubePrompt) {
                youtubePrompt = promptData.youtubePrompt;
                console.log("[FitLock] Custom YouTube prompt loaded from storage.");
            }
        });

        console.log(`[FitLock] AI backend: ${aiBackend}, Local AI configured: ${localAiConfigured}`);

        const isActive = !res.unlockedToday &&
            res.blockedSites.includes("youtube.com") &&
            res.youtubeSmartLock;

        if (!isActive) {
            console.log("[FitLock] Smart Lock is NOT active. No analysis will run.");
            document.body.classList.add("fitlock-productive");
            return;
        }

        // When using local AI backend, require a model to be configured
        if (aiBackend === "ollama" && !localAiConfigured) {
            console.log("[FitLock] Non-Chrome browser detected but local AI not configured. Showing setup overlay.");
            if (window.location.pathname.startsWith("/watch")) {
                showOllamaSetupOverlay();
            }
            // Still listen for navigations to show the overlay on new videos
            window.addEventListener("yt-navigate-finish", () => {
                if (window.location.pathname.startsWith("/watch")) {
                    showOllamaSetupOverlay();
                }
            });
            return;
        }

        console.log("[FitLock] Smart Lock is ACTIVE. Starting observation pipeline.");

        document.body.classList.remove("fitlock-productive");

        analyzeCurrentVideo("initial_load");

        window.addEventListener("yt-navigate-finish", () => {
            const videoId = new URLSearchParams(window.location.search).get("v");
            if (videoId && videoId !== currentVideoId) {
                currentVideoId = videoId;
                analyzeCurrentVideo("spa_navigation");
            } else if (!window.location.pathname.startsWith("/watch")) {
                analyzeCurrentVideo("spa_navigation");
            }
        });

        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                const videoId = new URLSearchParams(window.location.search).get("v");
                if (videoId && window.location.pathname.startsWith("/watch") && videoId !== currentVideoId) {
                    currentVideoId = videoId;
                    analyzeCurrentVideo("mutation_observer");
                }
            }
        }).observe(document, { subtree: true, childList: true });
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSmartLock);
} else {
    initSmartLock();
}
