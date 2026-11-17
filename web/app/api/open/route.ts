import { NextResponse } from "next/server";
import { loadRepoConfig } from "../../../../dist/config/load.js";
import { openInEditor } from "../../../../dist/ui/open-editor.js";
import { jsonHeaders, repoRoot } from "../../../lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { file?: unknown; line?: unknown };
  try {
    body = (await request.json()) as { file?: unknown; line?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.file !== "string" || !body.file.trim()) {
    return NextResponse.json({ error: "file string required" }, { status: 400 });
  }

  const line =
    typeof body.line === "number" && Number.isFinite(body.line)
      ? body.line
      : typeof body.line === "string" && body.line.trim()
        ? Number(body.line)
        : null;

  try {
    const root = repoRoot();
    const config = loadRepoConfig(root);
    const result = await openInEditor({
      repoRoot: root,
      file: body.file.trim(),
      line: line != null && Number.isFinite(line) ? line : null,
      openCommand: config.repo?.openCommand ?? null,
    });
    return new NextResponse(JSON.stringify(result), {
      status: result.ok ? 200 : 500,
      headers: jsonHeaders(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
