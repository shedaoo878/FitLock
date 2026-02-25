// Supabase Edge Function: refresh-token
//
// PURPOSE:
// Strava access tokens expire every ~6 hours. When a token expires, you
// can't just ask the user to re-authorize — that would be terrible UX.
// Instead, you use the refresh_token to silently get a new access_token.
//
// This function does exactly that:
// 1. Reads the user's stored refresh_token from the strava_tokens table
// 2. Sends it to Strava with your client_secret
// 3. Gets back a fresh access_token (and sometimes a new refresh_token)
// 4. Updates the database with the new tokens
//
// HOW IT GETS CALLED:
// From the Chrome extension via:
//   sbInvoke("refresh-token", {})
//
// The extension should call this when it detects the access_token has expired
// (by checking the expires_at timestamp before making a Strava API request).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // ── Step 1: Authenticate the caller ─────────────────────────
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

        // ── Step 2: Read the user's current tokens from the DB ──────
        const { data: tokenRow, error: fetchError } = await supabase
            .from("strava_tokens")
            .select("refresh_token, expires_at")
            .eq("user_id", user.id)
            .single();

        if (fetchError || !tokenRow) {
            return new Response(
                JSON.stringify({ success: false, error: "No Strava connection found. Connect Strava first." }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Step 3: Check if refresh is actually needed ──────────────
        // If the token hasn't expired yet, skip the refresh
        const expiresAt = new Date(tokenRow.expires_at).getTime();
        const bufferMs = 60 * 1000; // 60 second buffer
        if (Date.now() < expiresAt - bufferMs) {
            return new Response(
                JSON.stringify({
                    success: true,
                    message: "Token still valid",
                    refreshed: false,
                    access_token: tokenRow.access_token,
                    expires_at: expiresAt / 1000
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Step 4: Exchange refresh_token for new tokens ────────────
        const stravaClientId = Deno.env.get("STRAVA_CLIENT_ID");
        const stravaClientSecret = Deno.env.get("STRAVA_CLIENT_SECRET");

        if (!stravaClientId || !stravaClientSecret) {
            return new Response(
                JSON.stringify({ success: false, error: "Server misconfigured: missing Strava credentials" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const tokenRes = await fetch("https://www.strava.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: stravaClientId,
                client_secret: stravaClientSecret,
                refresh_token: tokenRow.refresh_token,
                grant_type: "refresh_token",
            }),
        });

        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            return new Response(
                JSON.stringify({ success: false, error: `Strava refresh failed: ${errText}` }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const newTokens = await tokenRes.json();

        // ── Step 5: Update the database with fresh tokens ────────────
        const { error: updateError } = await supabase
            .from("strava_tokens")
            .update({
                access_token: newTokens.access_token,
                refresh_token: newTokens.refresh_token,
                expires_at: new Date(newTokens.expires_at * 1000).toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("user_id", user.id);

        if (updateError) {
            return new Response(
                JSON.stringify({ success: false, error: `Database update failed: ${updateError.message}` }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Step 6: Return the new access token to the extension ─────
        return new Response(
            JSON.stringify({
                success: true,
                refreshed: true,
                access_token: newTokens.access_token,
                expires_at: newTokens.expires_at,
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
