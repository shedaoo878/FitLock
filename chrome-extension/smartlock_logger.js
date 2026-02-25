// ══════════════════════════════════════════════════════════════
//  FitLock — Smart Lock Logger
// ══════════════════════════════════════════════════════════════
//  Structured logging for every video analysis event.
//  Logs are persisted to chrome.storage.local under the key
//  "smartLockLogs" and capped at MAX_LOG_ENTRIES to avoid
//  unbounded storage growth.
//
//  Each log entry captures the full lifecycle of a single
//  video check: trigger → metadata scrape → AI inference → verdict.
// ══════════════════════════════════════════════════════════════

const MAX_LOG_ENTRIES = 100;
const LOG_STORAGE_KEY = "smartLockLogs";

// ── Log Entry Builder ──
// Creates a blank entry that gets populated as the pipeline progresses.
function createLogEntry(trigger) {
    return {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        trigger,                        // "initial_load" | "spa_navigation" | "mutation_observer"
        url: window.location.href,
        videoId: new URLSearchParams(window.location.search).get("v") || null,
        pathname: window.location.pathname,

        // Metadata scrape phase
        metadata: {
            title: null,
            channel: null,
            description: null,
            scrapeDurationMs: null,
            retries: null,
            source: null,                 // which DOM element the title came from
        },

        // AI inference phase
        ai: {
            available: null,              // was self.ai.languageModel available?
            rawResponse: null,            // the raw string returned by the model
            parsedResponse: null,         // the parsed JSON object
            parseMethod: null,            // "json_match" | "includes_fallback" | "parse_failed"
            inferenceDurationMs: null,
            error: null,
        },

        // Final verdict
        verdict: {
            isProductive: null,
            action: null,                 // "allow" | "block" | "skip_non_watch" | "skip_no_metadata"
        },

        totalDurationMs: null,
    };
}

// ── Persistence ──
async function persistLog(entry) {
    try {
        const data = await chrome.storage.local.get([LOG_STORAGE_KEY]);
        const logs = data[LOG_STORAGE_KEY] || [];
        logs.push(entry);

        // Cap at MAX_LOG_ENTRIES, drop oldest
        while (logs.length > MAX_LOG_ENTRIES) {
            logs.shift();
        }

        await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
    } catch (err) {
        console.error("[SmartLock Logger] Failed to persist log:", err);
    }
}

// ── Console Output ──
// Structured, color-coded console output for real-time debugging.
function printLog(entry) {
    const verdict = entry.verdict.isProductive;
    const icon = verdict === true ? "✅" : verdict === false ? "🚫" : "⏭️";
    const color = verdict === true ? "#4ade80" : verdict === false ? "#f87171" : "#58a6ff";

    console.groupCollapsed(
        `%c[FitLock Smart Lock] ${icon} ${entry.verdict.action?.toUpperCase()} — ${entry.metadata.title || entry.url}`,
        `color: ${color}; font-weight: bold;`
    );

    console.log("%cTrigger:", "font-weight:bold", entry.trigger);
    console.log("%cURL:", "font-weight:bold", entry.url);
    console.log("%cVideo ID:", "font-weight:bold", entry.videoId);

    console.group("Metadata");
    console.log("Title:", entry.metadata.title);
    console.log("Channel:", entry.metadata.channel);
    console.log("Description:", entry.metadata.description?.substring(0, 200) + "...");
    console.log("Source:", entry.metadata.source);
    console.log("Scrape Duration:", entry.metadata.scrapeDurationMs + "ms");
    console.log("Retries:", entry.metadata.retries);
    console.groupEnd();

    if (entry.ai.available !== null) {
        console.group("AI Inference");
        console.log("Available:", entry.ai.available);
        console.log("Raw Response:", entry.ai.rawResponse);
        console.log("Parsed:", entry.ai.parsedResponse);
        console.log("Parse Method:", entry.ai.parseMethod);
        console.log("Duration:", entry.ai.inferenceDurationMs + "ms");
        if (entry.ai.error) console.error("Error:", entry.ai.error);
        console.groupEnd();
    }

    console.group("Verdict");
    console.log("Productive:", entry.verdict.isProductive);
    console.log("Action:", entry.verdict.action);
    console.groupEnd();

    console.log("%cTotal Duration:", "font-weight:bold", entry.totalDurationMs + "ms");
    console.groupEnd();
}

// ── Public API ──
// Finalize and ship the log entry.
async function finalizeLog(entry) {
    entry.totalDurationMs = Date.now() - new Date(entry.timestamp).getTime();
    printLog(entry);
    await persistLog(entry);
    return entry;
}
