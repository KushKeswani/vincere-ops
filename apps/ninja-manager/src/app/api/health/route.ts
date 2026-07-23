import { getDatabase } from "@/lib/db/client";

export async function GET() {
  try {
    await getDatabase().query("SELECT 1 AS ok");
    return Response.json({ status: "healthy", service: "vincere-ninja-manager", timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Health check failed", error);
    return Response.json({ status: "unhealthy", service: "vincere-ninja-manager" }, { status: 503 });
  }
}
