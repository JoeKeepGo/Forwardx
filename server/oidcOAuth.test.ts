import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import jwt from "jsonwebtoken";
import { GoogleAuthError, GoogleFlowStore, googleSettingsSummary, normalizeGoogleRedirectUri, normalizeOidcIssuer,
  providerJson, readGoogleSettings, startGoogleFlow, exchangeGoogleCode, type GoogleSettings } from "./googleOAuth";
import { oidcSubject, validateOidcMetadata, verifyOidcClaims } from "./oidcOAuth";

const config: GoogleSettings = { enabled: true, provider: "oidc", issuer: "https://id.example.com", label: "Pocket ID",
  clientId: "pocket-client", clientSecret: "test-secret", redirectUri: "https://panel.example.com/api/auth/oidc/callback" };
const errorCode = (code: string) => (error: unknown) => error instanceof GoogleAuthError && error.code === code;
const metadata = (issuer = config.issuer!, auth = ["client_secret_basic"]) => ({ issuer, authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"],
  id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: auth });

test("OIDC settings preserve exact issuer, reject unsafe URLs and unknown modes, and redact secrets", () => {
  assert.equal(readGoogleSettings('{"enabled":true}').provider, "google");
  assert.equal(readGoogleSettings('{"enabled":true,"provider":"unknown"}').enabled, false);
  assert.equal(normalizeOidcIssuer(" https://id.example.com/tenant/ "), "https://id.example.com/tenant/");
  for (const issuer of ["http://id.example.com", "https://u:p@id.example.com", "https://id.example.com?a=b", "https://id.example.com#x", "file:///tmp/keys", "https://id.example.com/../tenant"]) assert.equal(normalizeOidcIssuer(issuer), "");
  assert.equal(normalizeGoogleRedirectUri(config.redirectUri, "oidc"), config.redirectUri);
  assert.equal(normalizeGoogleRedirectUri(config.redirectUri), "");
  assert.equal(normalizeGoogleRedirectUri("https://panel.example.com/api/auth/google/callback", "oidc"), "");
  assert.ok(!JSON.stringify(googleSettingsSummary(config)).includes(config.clientSecret));
});

test("discovery requires exact issuer, trusted same-origin HTTPS endpoints, code/RS256/S256 and supported client authentication", () => {
  assert.equal(validateOidcMetadata(config.issuer!, metadata()).issuer, config.issuer);
  assert.doesNotThrow(() => validateOidcMetadata(config.issuer!, metadata(config.issuer, ["client_secret_post"])));
  for (const patch of [{ issuer: `${config.issuer}/` }, { authorization_endpoint: "https://evil.example/authorize" },
    { token_endpoint: "https://evil.example/token" }, { jwks_uri: "http://id.example.com/jwks" }, { jwks_uri: "https://u:p@id.example.com/jwks" },
    { response_types_supported: ["token"] }, { id_token_signing_alg_values_supported: ["HS256"] },
    { code_challenge_methods_supported: ["plain"] }, { token_endpoint_auth_methods_supported: ["none"] }]) {
    assert.throws(() => validateOidcMetadata(config.issuer!, { ...metadata(), ...patch }), errorCode("provider_error"));
  }
});

test("issuer/sub namespace is bounded and case-sensitive before hashing, preserving old Google identities", () => {
  const a = oidcSubject(config.issuer!, "Subject:Case/123");
  assert.match(a, /^oidc:[a-f0-9]{64}:[a-f0-9]{64}$/);
  assert.ok(a.length <= 255);
  for (const [issuer, sub] of [["https://another.example", "Subject:Case/123"], [config.issuer!, "subject:Case/123"], [`${config.issuer}/`, "Subject:Case/123"]]) assert.notEqual(a, oidcSubject(issuer, sub));
  assert.notEqual(a, "Subject:Case/123");
});

test("OIDC ID tokens enforce signature/algorithm, issuer, audience, azp, nonce, recent iat/exp and verified email", () => {
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: config.issuer, aud: config.clientId, sub: "Subject:123", email: "USER@example.com", email_verified: true, nonce: "nonce", iat: now, exp: now + 60 };
  const sign = (patch: Record<string, unknown> = {}) => jwt.sign(Object.fromEntries(Object.entries({ ...claims, ...patch }).filter(([, v]) => v !== undefined)), keys.privateKey, { algorithm: "RS256" });
  assert.deepEqual(verifyOidcClaims(sign(), keys.publicKey, config, "nonce"), { subject: oidcSubject(config.issuer!, claims.sub), email: "user@example.com", name: "" });
  assert.doesNotThrow(() => verifyOidcClaims(sign({ aud: [config.clientId, "other"], azp: config.clientId }), keys.publicKey, config, "nonce"));
  for (const patch of [{ iss: "https://evil.example" }, { aud: "other" }, { azp: "other" }, { aud: [config.clientId, "other"] },
    { nonce: "wrong" }, { email_verified: false }, { email_verified: "true" }, { email: "bad" }, { sub: "" }, { sub: "a".repeat(256) }, { sub: "用户" },
    { exp: 1 }, { exp: undefined }, { exp: now - 60 }, { iat: now + 60 }, { iat: now - 601 }, { iat: now + 10, exp: now }]) {
    assert.throws(() => verifyOidcClaims(sign(patch), keys.publicKey, config, "nonce"), errorCode("invalid_identity"));
  }
  const withoutIat = jwt.sign(claims, keys.privateKey, { algorithm: "RS256", noTimestamp: true });
  assert.throws(() => verifyOidcClaims(withoutIat, keys.publicKey, config, "nonce"), errorCode("invalid_identity"));
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => verifyOidcClaims(sign(), other.publicKey, config, "nonce"), errorCode("invalid_identity"));
  assert.throws(() => verifyOidcClaims(jwt.sign(claims, "bad", { algorithm: "HS256" }), keys.publicKey, config, "nonce"), errorCode("invalid_identity"));
  assert.throws(() => verifyOidcClaims(jwt.sign(claims, keys.privateKey, { algorithm: "RS512" }), keys.publicKey, config, "nonce"), errorCode("invalid_identity"));
});

test("OIDC state is browser-bound/single-use and changes to issuer or provider invalidate pending flows", () => {
  const store = new GoogleFlowStore();
  const pending = store.create(config, "ip", undefined, Date.now(), metadata().authorization_endpoint);
  const state = new URL(pending.url).searchParams.get("state");
  assert.throws(() => store.consume(state, "other-browser", config), errorCode("invalid_state"));
  assert.throws(() => store.consume(state, pending.browserToken, { ...config, issuer: "https://other.example" }), errorCode("disabled"));
  assert.throws(() => store.consume(state, pending.browserToken, config), errorCode("invalid_state"));
  const fresh = store.create(config, "ip", undefined, Date.now(), metadata().authorization_endpoint);
  assert.throws(() => store.consume(new URL(fresh.url).searchParams.get("state"), fresh.browserToken, { ...config, provider: "google" }), errorCode("disabled"));
});

test("OIDC exchanges send PKCE and use discovery-selected basic/post authentication; cache keys, reject bad kid, and refresh rotation", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  let tokenKid = "key1";
  let jwkKid = "key1";
  let jwksRequests = 0;
  let requests = 0;
  let issuedNonce = "";
  let challenge = "";
  let mode = "client_secret_basic";
  let current: GoogleSettings = { ...config, issuer: "https://exchange.fixture.example", clientId: "client:+ id", clientSecret: "secret: &" };
  globalThis.fetch = async (input, init) => {
    requests++;
    assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json(metadata(current.issuer, [mode]));
    if (url.endsWith("/jwks")) { jwksRequests++; return Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: jwkKid, use: "sig", alg: "RS256" }] }); }
    assert.equal(url, `${current.issuer}/token`);
    const body = new URLSearchParams(String(init?.body));
    assert.equal(crypto.createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), challenge);
    assert.equal(body.get("client_id"), current.clientId); assert.equal(body.get("redirect_uri"), current.redirectUri);
    if (mode === "client_secret_post") assert.equal(body.get("client_secret"), current.clientSecret);
    else { assert.equal((init?.headers as Record<string, string>).Authorization, `Basic ${Buffer.from("client%3A%2B+id:secret%3A+%26").toString("base64")}`); assert.equal(body.get("client_secret"), null); }
    return Response.json({ id_token: jwt.sign({ iss: current.issuer, aud: current.clientId, sub: "sub", nonce: issuedNonce, email: "user@example.com", email_verified: true,
      iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 300 }, keys.privateKey, { algorithm: "RS256", keyid: tokenKid }) });
  };
  const exchange = async () => {
    const pending = await startGoogleFlow(current, crypto.randomUUID());
    const url = new URL(pending.url); issuedNonce = url.searchParams.get("nonce")!; challenge = url.searchParams.get("code_challenge")!;
    const flow = (await import("./googleOAuth")).googleFlows.consume(url.searchParams.get("state"), pending.browserToken, current);
    return exchangeGoogleCode(current, flow, "authorization-code");
  };
  try {
    await exchange(); await exchange(); assert.equal(jwksRequests, 1);
    tokenKid = "key2"; jwkKid = "key2";
    await assert.rejects(exchange(), errorCode("invalid_identity")); assert.equal(jwksRequests, 1);
    now += 31_000;
    await exchange(); assert.equal(jwksRequests, 2);
    tokenKid = "attacker";
    for (let i = 0; i < 3; i++) await assert.rejects(exchange(), errorCode("invalid_identity"));
    assert.equal(jwksRequests, 2);
    current = { ...current, issuer: "https://post.fixture.example" }; mode = "client_secret_post"; tokenKid = jwkKid;
    await exchange(); assert.equal(jwksRequests, 3); assert.ok(requests > 0);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test("provider responses are bounded and errors sanitized without leaking tokens/secrets", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of ["sensitive-token-not-json", "x".repeat(128_001)]) {
      globalThis.fetch = async () => new Response(body);
      await assert.rejects(providerJson("https://id.example.com/jwks"), errorCode("provider_error"));
    }
    globalThis.fetch = async (_url, init) => { assert.equal(init?.redirect, "error"); throw new Error("sensitive-client-secret"); };
    await assert.rejects(providerJson("https://id.example.com/token"), error => errorCode("provider_error")(error) && !String(error).includes("sensitive-client-secret"));
  } finally { globalThis.fetch = original; }
});

test("real SQLite and HTTP Pocket ID profile: login, explicit linking, Google migration, issuer switching, roles, restrictions, disable and 2FA", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forwardx-oidc-auth-"));
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "server/googleOAuth.fixture.ts"], { encoding: "utf8", timeout: 60_000,
      env: { ...process.env, OIDC_FIXTURE: "1", DATABASE_TYPE: "sqlite", SQLITE_PATH: path.join(directory, "oidc.db"), JWT_SECRET: "oidc-fixture-secret-that-is-long-enough",
        FORWARDX_DEV_PANEL: "0", FORWARDX_LOG_DIR: path.join(directory, "logs") } });
    assert.equal(result.status, 0, result.stderr + result.stdout);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
