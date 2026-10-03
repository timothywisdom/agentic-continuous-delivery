import { NextResponse } from "next/server";
import { buildAcDArgv, type UiRunRequest } from "../../../../dist/ui/cli-args.js";
import { startCliJob } from "../../../lib/jobs";
import { jsonHeaders } from "../../../lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: UiRunRequest;
  try {
    body = (await request.json()) as UiRunRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const argv = buildAcDArgv(body);
    const job = startCliJob(
      argv,
      typeof body.stdin === "string" ? body.stdin : undefined,
    );
    return new NextResponse(JSON.stringify({ job }), {
      status: 202,
      headers: jsonHeaders(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
