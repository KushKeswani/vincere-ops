import "server-only";

import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AuthenticatedUser, UserRole } from "@/lib/domain/types";
import { homePathForRole, isRoleAllowed } from "@/lib/deployment/contracts";
import { getDeploymentConfiguration, getDeploymentProfile } from "@/lib/deployment/server";
import { getNinjaRepository } from "@/lib/repositories/ninja-repository";

const COOKIE_NAME = "vincere_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyCredentials(email: string, password: string): Promise<AuthenticatedUser | null> {
  const user = await getNinjaRepository().findUserByEmail(email);
  if (!user || user.status !== "active") return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  const { passwordHash: _passwordHash, status: _status, ...safeUser } = user;
  void _passwordHash;
  void _status;
  if (!isRoleAllowed(getDeploymentProfile(), safeUser.role)) return null;
  return safeUser;
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await getNinjaRepository().createSession(userId, hashToken(token), expiresAt);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getDeploymentConfiguration().secureCookies,
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) await getNinjaRepository().deleteSession(hashToken(token));
  cookieStore.delete(COOKIE_NAME);
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const repository = getNinjaRepository();
  if (!token && getDeploymentProfile().mode === "LOCAL_ONLY") {
    return repository.findLocalOperatorUser();
  }
  if (!token) return null;
  const user = await repository.findUserBySessionHash(hashToken(token));
  if (!user || !isRoleAllowed(getDeploymentProfile(), user.role)) return null;
  return user;
}

export async function requireUser(roles?: UserRole[]): Promise<AuthenticatedUser> {
  const profile = getDeploymentProfile();
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (roles && !roles.includes(user.role)) redirect(homePathForRole(profile, user.role));
  return user;
}
