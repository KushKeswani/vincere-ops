"use server";

import { redirect } from "next/navigation";

import { signInSchema } from "@/lib/domain/schemas";
import { homePathForRole } from "@/lib/deployment/contracts";
import { getDeploymentProfile } from "@/lib/deployment/server";
import { createSession, destroySession, verifyCredentials } from "@/lib/auth/session";

export interface SignInState {
  message?: string;
  email?: string;
  errors?: { email?: string[]; password?: string[] };
}

export async function signInAction(_state: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { email: String(formData.get("email") ?? "").trim(), errors: parsed.error.flatten().fieldErrors };
  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) return { email: parsed.data.email, message: "The email or password is incorrect." };
  await createSession(user.id);
  redirect(homePathForRole(getDeploymentProfile(), user.role));
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/sign-in");
}
