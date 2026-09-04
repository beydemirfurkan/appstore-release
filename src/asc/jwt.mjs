// ES256 JWT generation for App Store Connect. Single responsibility: signing tokens.
import crypto from "node:crypto";

const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

/**
 * Returns a token provider: a zero-arg function that mints a fresh, short-lived
 * ASC JWT on each call. Callers invoke it per request so tokens never expire mid-run.
 *
 * @param {{ keyId: string, issuerId: string, privateKey: string, ttlSeconds?: number }} opts
 * @returns {() => string}
 */
export function createTokenProvider({ keyId, issuerId, privateKey, ttlSeconds = 900 }) {
  return () => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", kid: keyId, typ: "JWT" };
    const payload = { iss: issuerId, iat: now, exp: now + ttlSeconds, aud: "appstoreconnect-v1" };
    const signingInput = `${base64url(header)}.${base64url(payload)}`;
    const signature = crypto
      .sign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" })
      .toString("base64url");
    return `${signingInput}.${signature}`;
  };
}
