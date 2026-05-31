/**
 * Auth module — wires the User Store + broker-cred map from env, sets up
 * JwtModule for HS256 sign/verify, and exposes the login + mqtt-credentials
 * REST surface.
 *
 * v2 (Keycloak) replaces this module's contents wholesale; the OpenAPI
 * contract on AuthController + the JWT claim shape in auth.types stay.
 */

import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import {
  BROKER_CRED_MAP,
  USER_STORE,
  type BrokerCredMap,
  type UserStore,
} from "./auth.types";

/**
 * Read role bcrypt hashes from env. Both hashes must be present at startup —
 * missing means the deployment wasn't seeded properly.
 * @returns Two-role user store
 * @throws Error when either hash env var is unset
 */
function loadUserStoreFromEnv(): UserStore {
  const operator = process.env["AUTH_OPERATOR_PWHASH"];
  const viewer = process.env["AUTH_VIEWER_PWHASH"];
  if (!operator) throw new Error("AUTH_OPERATOR_PWHASH is required");
  if (!viewer) throw new Error("AUTH_VIEWER_PWHASH is required");
  return { operator, viewer };
}

/**
 * Read role broker creds from env. Usernames are conventional and fixed
 * (arcnode_operator / arcnode_viewer); passwords come from secrets.
 * @returns Per-role broker credential map
 * @throws Error when either password env var is unset
 */
function loadBrokerCredsFromEnv(): BrokerCredMap {
  const operatorPw = process.env["MQTT_OPERATOR_PASSWORD"];
  const viewerPw = process.env["MQTT_VIEWER_PASSWORD"];
  if (!operatorPw) throw new Error("MQTT_OPERATOR_PASSWORD is required");
  if (!viewerPw) throw new Error("MQTT_VIEWER_PASSWORD is required");
  return {
    operator: { username: "arcnode_operator", password: operatorPw },
    viewer: { username: "arcnode_viewer", password: viewerPw },
  };
}

/** Wires AuthController + AuthService + JwtAuthGuard with env-loaded providers. */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    { provide: USER_STORE, useFactory: loadUserStoreFromEnv },
    { provide: BROKER_CRED_MAP, useFactory: loadBrokerCredsFromEnv },
  ],
})
export class AuthModule {}
