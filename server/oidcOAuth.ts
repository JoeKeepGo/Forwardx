import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { GoogleAuthError, normalizeOidcIssuer, providerJson, providerNamespace, type GoogleFlow, type GoogleSettings } from "./googleOAuth";

type Metadata = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[] };
type Jwk = crypto.JsonWebKey & { kid: string; alg?: string; use?: string; key_ops?: string[] };

// This deliberately small profile supports Pocket ID's default RS256 keys.
// Administrators choose the trusted HTTPS issuer; discovery cannot redirect a
// browser or send credentials to an unrelated origin, even via HTTP redirects.
export function validateOidcMetadata(issuer: string, data: any): Metadata {
  const valid = (value: unknown) => {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === new URL(issuer).origin
        && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  };
  if (!normalizeOidcIssuer(issuer) || data?.issuer !== issuer
    || ![data.authorization_endpoint, data.token_endpoint, data.jwks_uri].every(valid)
    || !Array.isArray(data.response_types_supported) || !data.response_types_supported.includes("code")
    || !Array.isArray(data.id_token_signing_alg_values_supported) || !data.id_token_signing_alg_values_supported.includes("RS256")
    || !Array.isArray(data.code_challenge_methods_supported) || !data.code_challenge_methods_supported.includes("S256")
    || (data.token_endpoint_auth_methods_supported !== undefined && (!Array.isArray(data.token_endpoint_auth_methods_supported)
      || !data.token_endpoint_auth_methods_supported.some((method: unknown) => method === "client_secret_basic" || method === "client_secret_post")))) {
    throw new GoogleAuthError("provider_error");
  }
  return { issuer, authorization_endpoint: data.authorization_endpoint, token_endpoint: data.token_endpoint,
    jwks_uri: data.jwks_uri, token_endpoint_auth_methods_supported: data.token_endpoint_auth_methods_supported };
}

class OidcProvider {
  private keys: Jwk[] = [];
  private expiresAt = 0;
  private lastFetch = 0;
  private request: Promise<void> | null = null;
  constructor(readonly metadata: Metadata) {}
  async signingKey(kid: string) {
    if (this.expiresAt > Date.now()) {
      const key = this.keys.find(item => item.kid === kid);
      if (key) return key;
    }
    // Unknown kids may trigger one refresh per 30 seconds, not a request per token.
    if (!this.request && Date.now() - this.lastFetch >= 30_000) {
      this.lastFetch = Date.now();
      this.request = providerJson(this.metadata.jwks_uri).then(data => {
        if (!Array.isArray(data?.keys) || data.keys.length > 16) throw new GoogleAuthError("provider_error");
        const keys = data.keys.filter((key: any) => key.kty === "RSA" && (key.use === undefined || key.use === "sig")
          && (key.alg === undefined || key.alg === "RS256") && typeof key.kid === "string" && key.kid.length <= 256
          && key.d === undefined && (key.key_ops === undefined || (Array.isArray(key.key_ops) && key.key_ops.includes("verify")))) as Jwk[];
        if (new Set(keys.map(key => key.kid)).size !== keys.length) throw new GoogleAuthError("provider_error");
        this.keys = keys;
        this.expiresAt = Date.now() + 30 * 60_000;
      }).finally(() => { this.request = null; });
    }
    if (this.request) await this.request;
    const key = this.expiresAt > Date.now() ? this.keys.find(item => item.kid === kid) : undefined;
    if (!key) throw new GoogleAuthError("invalid_identity");
    return key;
  }
}
const providers = new Map<string, { expiresAt: number; provider: Promise<OidcProvider> }>();
let activeDiscovery = 0;
export async function getOidcProvider(issuer: string) {
  if (!normalizeOidcIssuer(issuer)) throw new GoogleAuthError("provider_error");
  const cached = providers.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.provider;
  if (activeDiscovery >= 8) throw new GoogleAuthError("rate_limited");
  if (providers.size >= 8) providers.delete(providers.keys().next().value!);
  activeDiscovery++;
  const entry = { expiresAt: Date.now() + 60 * 60_000, provider: providerJson(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`)
    .then(data => new OidcProvider(validateOidcMetadata(issuer, data))) };
  providers.set(issuer, entry);
  try { return await entry.provider; }
  catch (error) { if (providers.get(issuer) === entry) providers.delete(issuer); throw error; }
  finally { activeDiscovery--; }
}

export function oidcSubject(issuer: string, sub: string) {
  // Lowercase hex is safe under case-insensitive MySQL collations. Hashing each
  // part separately avoids delimiters, truncation and issuer/sub ambiguity.
  return `${providerNamespace({ provider: "oidc", issuer } as GoogleSettings)}${crypto.createHash("sha256").update(sub).digest("hex")}`;
}
export function verifyOidcClaims(token: string, key: crypto.KeyObject, config: GoogleSettings, nonce: string) {
  try {
    const claims = jwt.verify(token, key, { algorithms: ["RS256"], issuer: config.issuer!, audience: config.clientId, clockTolerance: 30 });
    const now = Date.now() / 1000;
    if (typeof claims === "string" || claims.nonce !== nonce || claims.email_verified !== true
      || typeof claims.sub !== "string" || !/^[\x21-\x7e]{1,255}$/.test(claims.sub)
      || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) || claims.iat! > now + 30
      || claims.iat! < now - 600 || claims.exp! <= claims.iat!
      || (claims.azp !== undefined && claims.azp !== config.clientId)
      || (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== config.clientId)
      || !z.string().email().max(254).safeParse(claims.email).success) throw new Error("claims");
    return { subject: oidcSubject(config.issuer!, claims.sub), email: String(claims.email).trim().toLowerCase(),
      name: typeof claims.name === "string" ? claims.name.trim().slice(0, 24) : "" };
  } catch { throw new GoogleAuthError("invalid_identity"); }
}
export async function exchangeOidcCode(config: GoogleSettings, flow: GoogleFlow, code: unknown) {
  if (typeof code !== "string" || !code || code.length > 4096) throw new GoogleAuthError("invalid_identity");
  const provider = await getOidcProvider(config.issuer!);
  const { metadata } = provider;
  const body = new URLSearchParams({ code, client_id: config.clientId, redirect_uri: config.redirectUri,
    grant_type: "authorization_code", code_verifier: flow.verifier });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const methods = metadata.token_endpoint_auth_methods_supported || ["client_secret_basic"];
  if (methods.includes("client_secret_basic")) {
    const formEncode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
    headers.Authorization = `Basic ${Buffer.from(`${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`).toString("base64")}`;
  } else body.set("client_secret", config.clientSecret);
  const data = await providerJson(metadata.token_endpoint, { method: "POST", headers, body });
  if (data?.error || typeof data?.id_token !== "string" || data.id_token.length > 16_384) throw new GoogleAuthError("invalid_identity");
  const token = jwt.decode(data.id_token, { complete: true });
  if (!token || token.header.alg !== "RS256" || typeof token.header.kid !== "string" || token.header.kid.length > 256
    || token.header.crit !== undefined) throw new GoogleAuthError("invalid_identity");
  // JWT-provided jku/x5u are never followed; only the validated discovery JWKS is used.
  let key: crypto.KeyObject;
  try {
    const jwk = await provider.signingKey(token.header.kid);
    key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    if ((key.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error("weak key");
  } catch (error) { if (error instanceof GoogleAuthError) throw error; throw new GoogleAuthError("invalid_identity"); }
  return verifyOidcClaims(data.id_token, key, config, flow.nonce);
}
