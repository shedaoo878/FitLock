// ══════════════════════════════════════════════════════════════
//  FitLock — Supabase Client (Official SDK)
// ══════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cocjwiipjtqsfcnxtimd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvY2p3aWlwanRxc2Zjbnh0aW1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjExNDIsImV4cCI6MjA4NzEzNzE0Mn0.74qkbqpM3rgcQ7pFbkzCJ4jc808mhXIikkRIDZHMy2k";

// ── Custom storage adapter for chrome.storage.local ──
// Service workers don't have localStorage, so we use chrome.storage.local.
// The Supabase SDK expects a synchronous-looking API with getItem/setItem/removeItem,
// but chrome.storage is async. The SDK handles async returns gracefully.
const chromeStorageAdapter = {
  async getItem(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.local.remove(key);
  },
};

// ── Create the Supabase client ──
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: chromeStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Not applicable in extension context
  },
});

// ═══════════════════════════════
//  AUTH
// ═══════════════════════════════

export async function sbGoogleSignIn() {
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
  const url = new URL(responseUrl);
  const hash = url.hash.substring(1);
  const params = new URLSearchParams(hash);

  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");

  if (!access_token || !refresh_token) {
    throw new Error("Missing tokens in Google Auth response.");
  }

  // Set the session in the Supabase client
  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  if (error) throw error;

  // Also persist user info in chrome.storage for quick access by popup
  const user = data.session?.user ?? null;
  if (user) {
    await chrome.storage.local.set({ sbUser: user });
  }

  return { access_token, refresh_token, user };
}

export async function sbSignOut() {
  await supabase.auth.signOut();
  await chrome.storage.local.remove(["sbUser"]);
}

export async function sbGetUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// ═══════════════════════════════
//  DATABASE (via official SDK)
// ═══════════════════════════════

// SELECT — e.g. sbSelect("blocked_sites", "user_id=eq.abc-123")
export async function sbSelect(table, query = "") {
  // Parse PostgREST-style query string into SDK calls
  let q = supabase.from(table).select();
  q = applyFilters(q, query);
  const { data, error } = await q;
  if (error) throw new Error(`SELECT ${table} failed: ${error.message}`);
  return data;
}

// INSERT — e.g. sbInsert("blocked_sites", { domain: "reddit.com" })
export async function sbInsert(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select();
  if (error) throw new Error(`INSERT ${table} failed: ${error.message}`);
  return data;
}

// UPDATE — e.g. sbUpdate("profiles", "id=eq.abc-123", { daily_goal_miles: 3 })
export async function sbUpdate(table, query, row) {
  let q = supabase.from(table).update(row);
  q = applyFilters(q, query);
  const { data, error } = await q.select();
  if (error) throw new Error(`UPDATE ${table} failed: ${error.message}`);
  return data;
}

// DELETE — e.g. sbDelete("blocked_sites", "user_id=eq.abc-123&domain=eq.reddit.com")
export async function sbDelete(table, query) {
  let q = supabase.from(table).delete();
  q = applyFilters(q, query);
  const { error } = await q;
  if (error) throw new Error(`DELETE ${table} failed: ${error.message}`);
  return true;
}

// UPSERT — insert or update on conflict
export async function sbUpsert(table, row) {
  const { data, error } = await supabase
    .from(table)
    .upsert(row, { onConflict: "id" })
    .select();
  if (error) throw new Error(`UPSERT ${table} failed: ${error.message}`);
  return data;
}

// ═══════════════════════════════
//  EDGE FUNCTIONS
// ═══════════════════════════════

export async function sbInvoke(functionName, body = {}) {
  // Get current session token to pass as custom header
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token || "";

  console.log(
    `[FitLock] Invoking Edge Function "${functionName}". Token starts with: `,
    token ? token.substring(0, 15) + "..." : "NULL"
  );

  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
    headers: {
      "x-user-jwt": token,
    },
  });

  if (error) {
    throw new Error(`Edge function "${functionName}" failed: ${error.message}`);
  }
  return data;
}

// ═══════════════════════════════
//  HELPERS
// ═══════════════════════════════

// Parse a PostgREST-style query string (e.g. "id=eq.abc&domain=eq.foo.com")
// into Supabase SDK .eq() / .gt() / etc. filter calls.
// This keeps the call sites in background.js unchanged.
function applyFilters(query, filterString) {
  if (!filterString) return query;

  // Split on & but be careful with values that contain dots
  const parts = filterString.split("&");
  for (const part of parts) {
    // Skip select= params
    if (part.startsWith("select=")) continue;

    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;

    const column = part.substring(0, eqIdx);
    const rest = part.substring(eqIdx + 1);

    // Parse operator and value: "eq.some-value", "gt.5", etc.
    const dotIdx = rest.indexOf(".");
    if (dotIdx === -1) continue;

    const op = rest.substring(0, dotIdx);
    const value = rest.substring(dotIdx + 1);

    switch (op) {
      case "eq":
        query = query.eq(column, value);
        break;
      case "neq":
        query = query.neq(column, value);
        break;
      case "gt":
        query = query.gt(column, value);
        break;
      case "gte":
        query = query.gte(column, value);
        break;
      case "lt":
        query = query.lt(column, value);
        break;
      case "lte":
        query = query.lte(column, value);
        break;
      case "like":
        query = query.like(column, value);
        break;
      case "ilike":
        query = query.ilike(column, value);
        break;
      case "in":
        query = query.in(column, value.replace(/[()]/g, "").split(","));
        break;
      default:
        console.warn(`[FitLock] Unknown PostgREST operator: ${op}`);
    }
  }
  return query;
}
