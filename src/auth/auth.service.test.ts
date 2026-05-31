/**
 * Unit tests for AuthService — bcrypt verification + HS256 JWT sign/verify.
 * AAA pattern. Uses real bcrypt + JwtService with throwaway secret.
 */

import "reflect-metadata";
import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";
import type { UserStore } from "./auth.types";

const TEST_SECRET = "test-jwt-secret-for-unit-tests-only";
const OPERATOR_PW = "operator-correct-horse";
const VIEWER_PW = "viewer-battery-staple";

let store: UserStore;
let jwt: JwtService;
let service: AuthService;

before(async () => {
  store = {
    operator: await bcrypt.hash(OPERATOR_PW, 4),
    viewer: await bcrypt.hash(VIEWER_PW, 4),
  };
  jwt = new JwtService({ secret: TEST_SECRET });
  service = new AuthService(store, jwt);
});

describe("AuthService.login", () => {
  it("returns a JWT on valid operator credentials", async () => {
    const result = await service.login(
      { username: "operator", password: OPERATOR_PW },
      TEST_SECRET,
    );
    const decoded = jwt.verify<{ sub: string; role: string }>(result.token, {
      secret: TEST_SECRET,
    });
    assert.equal(decoded.sub, "operator");
    assert.equal(decoded.role, "operator");
  });

  it("returns a JWT with role=viewer on valid viewer credentials", async () => {
    const result = await service.login(
      { username: "viewer", password: VIEWER_PW },
      TEST_SECRET,
    );
    const decoded = jwt.verify<{ role: string }>(result.token, {
      secret: TEST_SECRET,
    });
    assert.equal(decoded.role, "viewer");
  });

  it("rejects bad password with UnauthorizedException", async () => {
    await assert.rejects(
      service.login(
        { username: "operator", password: "wrong" },
        TEST_SECRET,
      ),
      UnauthorizedException,
    );
  });

  it("rejects unknown username with UnauthorizedException", async () => {
    await assert.rejects(
      service.login(
        { username: "ghost", password: OPERATOR_PW },
        TEST_SECRET,
      ),
      UnauthorizedException,
    );
  });
});
