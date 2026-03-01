import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";

const isSupabaseConfigured = (): boolean =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function GET() {
  try {
    const store = getPropertyStore();
    const properties = await store.listProperties();
    return NextResponse.json(
      {
        properties,
        backend: isSupabaseConfigured() ? "supabase" : "local"
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load properties.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { name?: string; description?: string | null };
    const name = (payload.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Property name is required." }, { status: 400 });
    }

    const store = getPropertyStore();
    const property = await store.createProperty(name, payload.description ?? null);
    return NextResponse.json({ property }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create property.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
