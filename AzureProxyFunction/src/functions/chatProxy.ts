import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

type ProxyBody = {
  input?: string;
};

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getCorsHeaders(origin: string | null, allowOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,x-proxy-key",
    "Vary": origin ? "Origin" : "*"
  };
}

function resolveAllowOrigin(origin: string | null, allowedOrigins: string[]): string | null {
  if (allowedOrigins.length === 0) {
    return origin ?? "*";
  }

  if (!origin) return null;

  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    return origin;
  }

  return null;
}

function jsonResponse(status: number, body: unknown, corsHeaders: Record<string, string>): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    },
    jsonBody: body
  };
}

app.http("chatProxy", {
  methods: ["POST", "OPTIONS"],
  authLevel: "function",
  route: "chat-proxy",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
    const requestOrigin = request.headers.get("origin");
    const allowOrigin = resolveAllowOrigin(requestOrigin, allowedOrigins);

    if (!allowOrigin) {
      return {
        status: 403,
        headers: {
          "Content-Type": "application/json"
        },
        jsonBody: { result: "Origin not allowed." }
      };
    }

    const corsHeaders = getCorsHeaders(requestOrigin, allowOrigin);

    if (request.method === "OPTIONS") {
      return {
        status: 204,
        headers: corsHeaders
      };
    }

    const requireSharedSecret = (process.env.REQUIRE_SHARED_SECRET ?? "false").toLowerCase() === "true";
    if (requireSharedSecret) {
      const expected = process.env.PROXY_SHARED_SECRET ?? "";
      const supplied = request.headers.get("x-proxy-key") ?? "";
      if (!expected || supplied !== expected) {
        return jsonResponse(401, { result: "Unauthorized." }, corsHeaders);
      }
    }

    let payload: ProxyBody;
    try {
      payload = (await request.json()) as ProxyBody;
    } catch {
      return jsonResponse(400, { result: "Invalid JSON body." }, corsHeaders);
    }

    const input = payload.input?.trim();
    if (!input) {
      return jsonResponse(400, { result: "Input is required." }, corsHeaders);
    }

    const upstreamUrl = process.env.COPILOT_UPSTREAM_URL;
    if (!upstreamUrl) {
      return jsonResponse(200, { result: `Azure proxy is live. Received: ${input}` }, corsHeaders);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (process.env.COPILOT_UPSTREAM_API_KEY) {
        headers["x-api-key"] = process.env.COPILOT_UPSTREAM_API_KEY;
      }

      const upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ input }),
        signal: controller.signal
      });

      const raw = await upstreamResponse.text();

      if (!upstreamResponse.ok) {
        context.error(`Upstream error ${upstreamResponse.status}: ${raw}`);
        return jsonResponse(502, { result: "Upstream service error." }, corsHeaders);
      }

      let resultText = "";
      if (raw?.trim()) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          resultText =
            (typeof parsed.result === "string" && parsed.result) ||
            (typeof parsed.response === "string" && parsed.response) ||
            (typeof parsed.output === "string" && parsed.output) ||
            raw;
        } catch {
          resultText = raw;
        }
      }

      return jsonResponse(200, { result: resultText || "No response." }, corsHeaders);
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      context.error(isAbort ? "Upstream timeout." : `Proxy error: ${String(error)}`);
      return jsonResponse(502, { result: isAbort ? "Upstream timeout." : "Proxy request failed." }, corsHeaders);
    } finally {
      clearTimeout(timeout);
    }
  }
});
