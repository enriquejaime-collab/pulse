import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";

const getPropertyById = async (propertyId: string) => {
  const store = getPropertyStore();
  const properties = await store.listProperties();
  return properties.find((property) => property.id === propertyId) ?? null;
};

export async function GET(_request: Request, context: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await context.params;
    const property = await getPropertyById(propertyId);
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }
    return NextResponse.json({ property }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load property.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await context.params;
    const payload = (await request.json()) as { name?: string; description?: string | null };
    const property = await getPropertyById(propertyId);
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    const name = payload.name?.trim();
    if (typeof name === "string" && !name) {
      return NextResponse.json({ error: "Property name cannot be empty." }, { status: 400 });
    }

    const store = getPropertyStore();
    const updated = await store.updateProperty(propertyId, {
      name,
      description: payload.description
    });
    return NextResponse.json({ property: updated }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update property.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
