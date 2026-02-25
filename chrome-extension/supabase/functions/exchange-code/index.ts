// Supabase Edge Function: exchange-code
//
// PURPOSE:
// This function lives on Supabase's servers (not in your Chrome extension).
// Its sole job is to securely exchange a Strava authorization code for
// access/refresh tokens WITHOUT exposing your STRAVA_CLIENT_SECRET to the client.
//
// HOW IT GETS CALLED:
// Your Chrome extension calls this via:
//   sbInvoke("exchange-code", { code: "the_code_from_strava" })
//
// which under the hood is just a POST request to:
//   https://cocjwiipjtqsfcnxtimd.supabase.co/functions/v1/exchange-code
//
// WHAT HAPPENS STEP BY STEP:
// 1. Extension sends { code: "abc123" } in the request body
// 2. This function reads STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET from
//    environment variables (set in the Supabase dashboard, never exposed)
// 3. It calls Strava's token endpoint with the code + secret
// 4. Strava responds with { access_token, refresh_token, expires_at, athlete }
// 5. This function stores those tokens in the strava_tokens table
// 6. It sends back { success: true } to the extension
//
// RUNTIME: Deno (not Node.js). Supabase Edge Functions use Deno, which is
// similar to Node but with some differences:
//   - Uses ESM imports (import ... from ...) not require()
//   - Has built-in fetch() globally available
//   - TypeScript works out of the box
//   - Uses Deno.env.get() instead of process.env

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ── CORS headers ─────────────────────────────────────────────
// Chrome extensions make cross-origin requests to this function.
// These headers tell the browser "yes, this origin is allowed."
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    // Handle preflight CORS requests (browser sends OPTIONS before POST)
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // ── Step 1: Parse the request ──────────────────────────────
        const { code } = await req.json();

        if (!code) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing authorization code" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Step 2: Get secrets from environment variables ─────────
        // These are set in the Supabase dashboard under:
        //   Edge Functions → exchange-code → Settings → Environment Variables
        // They NEVER leave the server.
        const stravaClientId = Deno.env.get("STRAVA_CLIENT_ID");
        const stravaClientSecret = Deno.env.get("STRAVA_CLIENT_SECRET");

        if (!stravaClientId || !stravaClientSecret) {
            return new Response(
                JSON.stringify({ success: false, error: "Server misconfigured: missing Strava credentials" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Step 3: Exchange the code with Strava ──────────────────
        // This is the exact same fetch call that was in your background.js,
        // but now it runs on the server where the client_secret is safe.
        const tokenRes = await fetch("https://www.strava.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: stravaClientId,
                client_secret: stravaClientSecret,
                code: code,
                grant_type: "authorization_code",
            }),
        });

        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            return new Response(
                JSON.stringify({ success: false, error: `Strava token exchange failed: ${errText}` }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const tokens = await tokenRes.json();
        // tokens looks like:
        // {
        //   access_token: "abc...",
        //   refresh_token: "def...",
        //   expires_at: 1234567890,       ← Unix timestamp (seconds)
        //   athlete: { id: 12345, ... }   ← The Strava user's profile
        // }

        // ── Step 4: Identify the calling user ──────────────────────
        // The extension sends a JWT in the x-user-jwt header to bypass Kong issues.
        const authHeader = req.headers.get("x-user-jwt");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing x-user-jwt header" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: `Bearer ${authHeader}` } },
        });

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: "Invalid auth token: " + (userError?.message || "User not found") }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Step 5: Store tokens in the database ───────────────────
        const { error: upsertError } = await supabase
            .from("strava_tokens")
            .upsert({
                user_id: user.id,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: new Date(tokens.expires_at * 1000).toISOString(),
                scope: tokens.token_type || "activity:read_all",
                athlete_id: tokens.athlete?.id || null,
                updated_at: new Date().toISOString(),
            });

        if (upsertError) {
            return new Response(
                JSON.stringify({ success: false, error: `Database error: ${upsertError.message}` }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Step 6: Return success ─────────────────────────────────
        // We do NOT return the refresh_token to the client. It stays in the DB.
        return new Response(
            JSON.stringify({
                success: true,
                access_token: tokens.access_token,
                expires_at: tokens.expires_at,
                athlete_id: tokens.athlete?.id,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (err) {
        return new Response(
            JSON.stringify({ success: false, error: err.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
