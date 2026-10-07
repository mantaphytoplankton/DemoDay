import { createSign } from "node:crypto";
import { z } from "zod";
import { UpstreamError } from "../errors.ts";

const ServiceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  private_key_id: z.string().optional(),
  private_key: z.string().includes("PRIVATE KEY", { message: "private_key is missing or not a PEM key" }),
  client_email: z.string().email(),
  token_uri: z.string().url().default("https://oauth2.googleapis.com/token"),
});
export type ServiceAccount = z.infer<typeof ServiceAccountSchema>;

/** Validate a service-account key file. Errors name the problem, never the key content. */
export function parseServiceAccount(text: string): ServiceAccount {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("the file is not valid JSON");
  }
  if ((raw as { type?: unknown })?.type !== "service_account") throw new Error("the file is not a service-account key (type must be service_account)");
  const r = ServiceAccountSchema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new Error(`${i.path.join(".") || "key"}: ${i.message}`);
  }
  return r.data;
}

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const REFRESH_EARLY_MS = 5 * 60_000;

/**
 * OAuth access tokens for a service account (JWT bearer grant, RS256 with Node crypto; no SDK).
 * Tokens are cached and refreshed shortly before they expire.
 */
export class ServiceAccountTokenSource {
  readonly account: ServiceAccount;
  private readonly fetchImpl: typeof fetch;
  private cached: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(account: ServiceAccount, fetchImpl: typeof fetch = fetch) {
    this.account = account;
    this.fetchImpl = fetchImpl;
  }

  async token(signal?: AbortSignal): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt - REFRESH_EARLY_MS) return this.cached.token;
    this.inflight ??= this.fetchToken(signal).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchToken(signal?: AbortSignal): Promise<string> {
    const a = this.account;
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${enc({ alg: "RS256", typ: "JWT", ...(a.private_key_id ? { kid: a.private_key_id } : {}) })}.${enc({ iss: a.client_email, scope: SCOPE, aud: a.token_uri, iat: now, exp: now + 3600 })}`;
    const jwt = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(a.private_key).toString("base64url")}`;
    let res: Response;
    try {
      res = await this.fetchImpl(a.token_uri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
    } catch {
      throw new UpstreamError("retryable", null, "service-account sign-in: network error");
    }
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      const why = `${body.error ?? ""}${body.error_description ? `: ${body.error_description}` : ""}`.slice(0, 200);
      throw new UpstreamError(res.status >= 500 ? "retryable" : "rejected", res.status, `service-account sign-in: HTTP ${res.status} ${why}`.trim());
    }
    this.cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}
