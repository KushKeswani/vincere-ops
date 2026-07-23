import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/deployment/contracts";
import { getDeploymentProfile } from "@/lib/deployment/server";

export default async function HomePage() {
  const user = await getCurrentUser();
  redirect(user ? homePathForRole(getDeploymentProfile(), user.role) : "/sign-in");
}
