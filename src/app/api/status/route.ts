import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/ai/provider";
import { storageEnabled } from "@/lib/storage/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the server is configured for, so the UI can show the right options. */
export async function GET() {
  const ai = aiConfig();
  return NextResponse.json({ storage: storageEnabled(), ai: { available: !!ai, label: ai?.label } });
}
