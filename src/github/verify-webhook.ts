import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(opts: {
  secret: string;
  payload: string;
  signatureHeader: string | undefined;
}): boolean {
  const header = opts.signatureHeader;
  if (!header?.startsWith("sha256=")) return false;
  const digest = header.slice("sha256=".length);
  const expected = createHmac("sha256", opts.secret).update(opts.payload).digest();
  const actual = Buffer.from(digest, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
