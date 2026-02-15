import express, { Request, Response } from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

function resolveUpstreamUrl(): string {
  const direct = process.env.COPILOT_UPSTREAM_URL?.trim();
  if (direct) {
    return direct;
  }

  const base = process.env.FLOW_BASE_URL?.trim();
  if (!base) {
    return "";
  }

  const apiVersion = process.env.FLOW_API_VERSION?.trim() || "1";
  const sp = process.env.FLOW_SP?.trim();
  const sv = process.env.FLOW_SV?.trim();
  const sig = process.env.FLOW_SIG?.trim();

  const queryParts = [
    `api-version=${encodeURIComponent(apiVersion)}`,
    sp ? `sp=${sp}` : "",
    sv ? `sv=${encodeURIComponent(sv)}` : "",
    sig ? `sig=${encodeURIComponent(sig)}` : ""
  ].filter(Boolean);

  return queryParts.length > 0 ? `${base}?${queryParts.join("&")}` : base;
}

function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? "https://apps.powerapps.com";
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function resolveAllowedOrigin(origin: string | undefined): string | null {
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.includes("*")) {
    return origin ?? "*";
  }

  if (!origin) {
    return null;
  }

  return allowedOrigins.includes(origin) ? origin : null;
}

function applyCors(req: Request, res: Response): boolean {
  const origin = req.header("origin");
  const allowed = resolveAllowedOrigin(origin);
  if (!allowed) {
    res.status(403).json({ result: "Origin not allowed." });
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-proxy-key");
  res.setHeader("Vary", origin ? "Origin" : "*");
  return true;
}

app.options("/api/chat-proxy", (req, res) => {
  if (!applyCors(req, res)) return;
  res.status(204).send();
});

app.post("/api/chat-proxy", async (req, res) => {
  if (!applyCors(req, res)) return;

  const requireSharedSecret = (process.env.REQUIRE_SHARED_SECRET ?? "false").toLowerCase() === "true";
  if (requireSharedSecret) {
    const expected = process.env.PROXY_SHARED_SECRET ?? "";
    const supplied = req.header("x-proxy-key") ?? "";
    if (!expected || supplied !== expected) {
      res.status(401).json({ result: "Unauthorized." });
      return;
    }
  }

  const input = typeof req.body?.input === "string" ? req.body.input.trim() : "";
  if (!input) {
    res.status(400).json({ result: "Input is required." });
    return;
  }

  const upstreamUrl = resolveUpstreamUrl();
  if (!upstreamUrl) {
    res.status(200).json({ result: `Azure proxy is live. Received: ${input}` });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.COPILOT_UPSTREAM_API_KEY) {
      headers["x-api-key"] = process.env.COPILOT_UPSTREAM_API_KEY;
    }

    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ input }),
      signal: controller.signal
    });

    const raw = await response.text();
    if (!response.ok) {
      res.status(502).json({ result: "Upstream service error." });
      return;
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

    res.status(200).json({ result: resultText || "No response." });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    res.status(502).json({ result: isAbort ? "Upstream timeout." : "Proxy request failed." });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`Proxy listening on ${port}`);
});
