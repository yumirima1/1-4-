import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(
  body: JsonRecord,
  status: number,
  headers: HeadersInit,
): Response {
  return Response.json(body, { status, headers });
}

function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

Deno.serve(async (request: Request) => {
  const allowedOrigin = Deno.env.get("PUSH_ALLOWED_ORIGIN");
  if (!allowedOrigin) {
    console.error("PUSH_ALLOWED_ORIGIN is not configured.");
    return Response.json({
      error: "Push subscription service is not configured.",
    }, { status: 500 });
  }

  const origin = request.headers.get("origin");
  if (!origin || origin !== allowedOrigin) {
    return Response.json({ error: "Origin is not allowed." }, { status: 403 });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
  }

  try {
    const payload: unknown = await request.json();
    if (!isRecord(payload)) {
      return jsonResponse(
        { error: "Invalid subscription payload." },
        400,
        corsHeaders,
      );
    }
    const { action, managementToken } = payload;
    if (
      (action !== "register" && action !== "remove") ||
      typeof managementToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(managementToken)
    ) {
      return jsonResponse(
        { error: "Invalid subscription payload." },
        400,
        corsHeaders,
      );
    }

    let endpoint: string | null = null;
    let p256dh: string | null = null;
    let auth: string | null = null;
    if (action === "register" || payload.subscription !== undefined) {
      if (!isRecord(payload.subscription)) {
        return jsonResponse(
          { error: "Invalid subscription payload." },
          400,
          corsHeaders,
        );
      }
      const keys = payload.subscription.keys;
      if (
        typeof payload.subscription.endpoint !== "string" ||
        payload.subscription.endpoint.length > 2048 ||
        !isRecord(keys) ||
        typeof keys.p256dh !== "string" ||
        !/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) ||
        typeof keys.auth !== "string" ||
        !/^[A-Za-z0-9_-]{16,32}$/.test(keys.auth)
      ) {
        return jsonResponse(
          { error: "Invalid subscription payload." },
          400,
          corsHeaders,
        );
      }
      endpoint = payload.subscription.endpoint;
      p256dh = keys.p256dh;
      auth = keys.auth;

      let endpointUrl: URL;
      try {
        endpointUrl = new URL(endpoint);
      } catch {
        return jsonResponse(
          { error: "Invalid push endpoint." },
          400,
          corsHeaders,
        );
      }
      const endpointHost = endpointUrl.hostname.toLowerCase();
      const supportedPushHost = endpointHost === "fcm.googleapis.com" ||
        endpointHost === "updates.push.services.mozilla.com" ||
        endpointHost === "web.push.apple.com" ||
        endpointHost.endsWith(".notify.windows.com");
      if (endpointUrl.protocol !== "https:" || !supportedPushHost) {
        return jsonResponse(
          { error: "Unsupported push endpoint." },
          400,
          corsHeaders,
        );
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("PUSH_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase service credentials are not configured.");
      return jsonResponse(
        { error: "Push subscription service is not configured." },
        500,
        corsHeaders,
      );
    }

    const tokenHash = encodeHex(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(managementToken),
        ),
      ),
    );
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (action === "register") {
      if (!endpoint || !p256dh || !auth) {
        return jsonResponse(
          { error: "Invalid subscription payload." },
          400,
          corsHeaders,
        );
      }
      const { error } = await admin.from("push_subscriptions").upsert({
        user_id: null,
        endpoint,
        p256dh,
        auth,
        manage_token_hash: tokenHash,
        updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (error) {
        console.error("Could not save a push subscription:", error.message);
        return jsonResponse(
          { error: "Could not save the push subscription." },
          500,
          corsHeaders,
        );
      }
    } else {
      let query = admin
        .from("push_subscriptions")
        .delete()
        .eq("manage_token_hash", tokenHash);
      if (endpoint) query = query.eq("endpoint", endpoint);
      const { error } = await query;
      if (error) {
        console.error("Could not remove a push subscription:", error.message);
        return jsonResponse(
          { error: "Could not remove the push subscription." },
          500,
          corsHeaders,
        );
      }
    }

    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (error) {
    console.error("Push subscription request failed:", error);
    return jsonResponse(
      { error: "Could not process the push subscription." },
      500,
      corsHeaders,
    );
  }
});
