import { NextResponse } from "next/server";

const isAuthorizedCron = (request: Request): boolean => {
  const expectedSecrets = [process.env.CRON_SECRET, process.env.SYNC_CRON_SECRET]
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0);

  if (expectedSecrets.length === 0) {
    return process.env.NODE_ENV !== "production";
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const tokenHeader = request.headers.get("x-sync-cron-secret") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  return expectedSecrets.includes(bearer) || expectedSecrets.includes(tokenHeader);
};

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized cron scheduler run." }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const baseUrl = url.origin;
    const maxWallets = Number(url.searchParams.get("maxWallets") ?? "50");
    const normalizedMax = Number.isFinite(maxWallets) && maxWallets > 0 ? Math.min(Math.floor(maxWallets), 200) : 50;

    const runResponse = await fetch(`${baseUrl}/api/ops/sync-due?maxWallets=${normalizedMax}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store"
    });

    const payload = (await runResponse.json()) as Record<string, unknown>;
    if (!runResponse.ok) {
      return NextResponse.json(
        {
          error: (payload.error as string) ?? "Cron scheduler run failed.",
          details: payload
        },
        { status: runResponse.status }
      );
    }

    return NextResponse.json(
      {
        source: "cron",
        ...payload
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron scheduler run failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
