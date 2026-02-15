"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "1mb" }));
function getAllowedOrigins() {
    const raw = process.env.ALLOWED_ORIGINS ?? "https://apps.powerapps.com";
    return raw.split(",").map((value) => value.trim()).filter(Boolean);
}
function resolveAllowedOrigin(origin) {
    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.includes("*")) {
        return origin ?? "*";
    }
    if (!origin) {
        return null;
    }
    return allowedOrigins.includes(origin) ? origin : null;
}
function applyCors(req, res) {
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
    if (!applyCors(req, res))
        return;
    res.status(204).send();
});
app.post("/api/chat-proxy", async (req, res) => {
    if (!applyCors(req, res))
        return;
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
    const upstreamUrl = process.env.COPILOT_UPSTREAM_URL?.trim() ?? "";
    if (!upstreamUrl) {
        res.status(200).json({ result: `Azure proxy is live. Received: ${input}` });
        return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
        const headers = { "Content-Type": "application/json" };
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
                const parsed = JSON.parse(raw);
                resultText =
                    (typeof parsed.result === "string" && parsed.result) ||
                        (typeof parsed.response === "string" && parsed.response) ||
                        (typeof parsed.output === "string" && parsed.output) ||
                        raw;
            }
            catch {
                resultText = raw;
            }
        }
        res.status(200).json({ result: resultText || "No response." });
    }
    catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        res.status(502).json({ result: isAbort ? "Upstream timeout." : "Proxy request failed." });
    }
    finally {
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
