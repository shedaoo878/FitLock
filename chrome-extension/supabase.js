// ══════════════════════════════════════════════════════════════
//  FitLock — Lightweight Supabase Client for Chrome Extensions
// ══════════════════════════════════════════════════════════════
//
//  Replace the two placeholders below with your Supabase project
//  credentials. You can find them in the Supabase dashboard:
//    → Settings → API → Project URL  &  anon/public key
//
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://cocjwiipjtqsfcnxtimd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvY2p3aWlwanRxc2Zjbnh0aW1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjExNDIsImV4cCI6MjA4NzEzNzE0Mn0.74qkbqpM3rgcQ7pFbkzCJ4jc808mhXIikkRIDZHMy2k";

// ── Helper: build common headers ──
function sbHeaders(token) {
    const headers = {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
}

// ═══════════════════════════════
//  AUTH
// ═══════════════════════════════

async function sbGoogleSignIn() {
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUri)}`;

    const responseUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true,
    });

    if (!responseUrl) {
        throw new Error("Failed to authenticate with Google.");
    }

    // Parse the hash parameters from the redirect URL
    // e.g., https://<extension-id>.chromiumapp.org/#access_token=...&refresh_token=...
    const url = new URL(responseUrl);
    const hash = url.hash.substring(1);
    const params = new URLSearchParams(hash);

    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");

    if (!access_token || !refresh_token) {
        throw new Error("Missing tokens in Google Auth response.");
    }

    // Persist session in chrome.storage for use across popup & background
    await chrome.storage.local.set({
        sbAccessToken: access_token,
        sbRefreshToken: refresh_token,
    });

    // Fetch the user profile using the new token
    const userRes = await sbGetUser();
    if (userRes) {
        await chrome.storage.local.set({ sbUser: userRes });
    }

    return { access_token, refresh_token, user: userRes };
}

async function sbSignOut() {
    const { sbAccessToken } = await chrome.storage.local.get(["sbAccessToken"]);
    if (sbAccessToken) {
        await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
            method: "POST",
            headers: sbHeaders(sbAccessToken),
        });
    }
    await chrome.storage.local.remove([
        "sbAccessToken",
        "sbRefreshToken",
        "sbUser",
    ]);
}

async function sbGetUser() {
    const token = await sbGetToken();
    if (!token) return null;

    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: sbHeaders(token),
    });

    if (!res.ok) return null;
    return res.json();
}

async function sbRefreshSession() {
    const { sbRefreshToken } = await chrome.storage.local.get([
        "sbRefreshToken",
    ]);
    if (!sbRefreshToken) throw new Error("No refresh token — user must sign in.");

    const res = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
            method: "POST",
            headers: sbHeaders(),
            body: JSON.stringify({ refresh_token: sbRefreshToken }),
        }
    );

    if (!res.ok) throw new Error("Session refresh failed — user must sign in.");

    const data = await res.json();
    await chrome.storage.local.set({
        sbAccessToken: data.access_token,
        sbRefreshToken: data.refresh_token,
        sbUser: data.user,
    });
    return data.access_token;
}

// Get a valid access token, auto-refreshing if needed
async function sbGetToken() {
    const { sbAccessToken } = await chrome.storage.local.get(["sbAccessToken"]);
    if (!sbAccessToken) return null;

    // Decode JWT expiry (tokens are base64url-encoded JSON)
    try {
        const base64Url = sbAccessToken.split(".")[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(
            decodeURIComponent(
                atob(base64)
                    .split("")
                    .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                    .join("")
            )
        );
        const expiresAt = payload.exp * 1000;
        // Refresh 60 seconds before expiry
        if (Date.now() >= expiresAt - 60000) {
            return await sbRefreshSession();
        }
    } catch (err) {
        console.warn("Failed to decode JWT, defaulting to refresh:", err);
        // If we can't decode it, try refreshing
        return await sbRefreshSession();
    }
    return sbAccessToken;
}

// ═══════════════════════════════
//  DATABASE (PostgREST)
// ═══════════════════════════════

// SELECT — e.g. sbSelect("blocked_sites", "select=domain")
async function sbSelect(table, query = "") {
    const token = await sbGetToken();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        headers: sbHeaders(token),
    });
    if (!res.ok) throw new Error(`SELECT ${table} failed: ${res.status}`);
    return res.json();
}

// INSERT — e.g. sbInsert("blocked_sites", { domain: "reddit.com" })
async function sbInsert(table, data) {
    const token = await sbGetToken();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: {
            ...sbHeaders(token),
            Prefer: "return=representation",
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`INSERT ${table} failed: ${res.status}`);
    return res.json();
}

// UPDATE — e.g. sbUpdate("profiles", "id=eq.abc-123", { daily_goal_miles: 3 })
async function sbUpdate(table, query, data) {
    const token = await sbGetToken();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        method: "PATCH",
        headers: {
            ...sbHeaders(token),
            Prefer: "return=representation",
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`UPDATE ${table} failed: ${res.status}`);
    return res.json();
}

// DELETE — e.g. sbDelete("blocked_sites", "domain=eq.reddit.com")
async function sbDelete(table, query) {
    const token = await sbGetToken();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        method: "DELETE",
        headers: sbHeaders(token),
    });
    if (!res.ok) throw new Error(`DELETE ${table} failed: ${res.status}`);
    return res.ok;
}

// UPSERT — insert or update on conflict
async function sbUpsert(table, data) {
    const token = await sbGetToken();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: {
            ...sbHeaders(token),
            Prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`UPSERT ${table} failed: ${res.status}`);
    return res.json();
}

// ═══════════════════════════════
//  EDGE FUNCTIONS
// ═══════════════════════════════

// Call a Supabase Edge Function
// e.g. sbInvoke("exchange-code", { code: "abc123" })
async function sbInvoke(functionName, body = {}) {
    let token = await sbGetToken();
    console.log(`[FitLock] Invoking Edge Function "${functionName}". Token starts with: `, token ? token.substring(0, 15) + "..." : "NULL");

    // Always use the ANON KEY for the Authorization header to pass the Kong API Gateway.
    // Pass the actual user JWT in a custom header so the Edge Function can verify it.
    let res = await fetch(
        `${SUPABASE_URL}/functions/v1/${functionName}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                "x-user-jwt": token || "",
            },
            body: JSON.stringify(body),
        }
    );

    // Auto-retry once on 401 by forcing a session refresh
    if (res.status === 401) {
        console.warn(`[FitLock] 401 from "${functionName}", refreshing session and retrying...`);
        try {
            token = await sbRefreshSession();
            console.log(`[FitLock] Refreshed Session. New token starts with: `, token ? token.substring(0, 15) + "..." : "NULL");
            res = await fetch(
                `${SUPABASE_URL}/functions/v1/${functionName}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                        "x-user-jwt": token || "",
                    },
                    body: JSON.stringify(body),
                }
            );
        } catch (refreshErr) {
            throw new Error(`Session expired. Please sign out and sign back in. (${refreshErr.message})`);
        }
    }

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Edge function "${functionName}" failed: ${err}`);
    }
    return res.json();
}
