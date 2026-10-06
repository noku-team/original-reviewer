import { afterEach, describe, expect, it } from "vitest";
import {
  clearCredentials,
  getCredential,
  initCredentialStore,
  saveCredential,
} from "../src/connect/store.ts";

afterEach(async () => {
  clearCredentials();
  await initCredentialStore();
});

describe("credential store", () => {
  it("keeps a token in memory", async () => {
    await saveCredential(1, "tok");
    expect(await getCredential(1)).toBe("tok");
    clearCredentials();
    expect(await getCredential(1)).toBeUndefined();
  });

  it.skipIf(!process.env.REDIS_URL)("reloads a token from redis after memory clear", async () => {
    const ok = await initCredentialStore(process.env.REDIS_URL);
    expect(ok).toBe(true);
    await saveCredential(424242, "persist-me");
    clearCredentials();
    expect(await getCredential(424242)).toBe("persist-me");
  });
});
