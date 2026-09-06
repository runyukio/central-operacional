import assert from "node:assert/strict";
import test from "node:test";
import { demoUsers } from "./demo-auth";
import { sessionValidationData, validateCurrentSessionToken } from "./session-validation";

const originalLookup = sessionValidationData.findUser;
const originalNodeEnv = process.env.NODE_ENV;
const originalDemoFlag = process.env.ALLOW_DEMO_LOGIN;
test.afterEach(() => {
  sessionValidationData.findUser = originalLookup;
  if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalNodeEnv });
  if (originalDemoFlag === undefined) delete process.env.ALLOW_DEMO_LOGIN; else process.env.ALLOW_DEMO_LOGIN = originalDemoFlag;
});

test("explicit demo sessions work only outside production, never as a production bypass", async () => {
  sessionValidationData.findUser = async () => null;
  const demo = demoUsers[0];
  const token = { email: demo.email, sub: demo.email, demoSession: true };
  Object.assign(process.env, { NODE_ENV: "development", ALLOW_DEMO_LOGIN: "true" });
  assert.equal((await validateCurrentSessionToken(token)).authInvalid, undefined);
  assert.equal((await validateCurrentSessionToken({ ...token, demoSession: false })).authInvalid, true);
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal((await validateCurrentSessionToken(token)).authInvalid, true);
});
