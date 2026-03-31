import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDashboardAssistantContext } from "@/lib/assistant/context";
import { generateLocalAssistantReply } from "@/lib/assistant/fallback";
import { getOpenAiAssistantReply, isOpenAiConfigured } from "@/lib/assistant/openai";
import type { AssistantRouteResponse } from "@/lib/assistant/types";

export const runtime = "nodejs";

const assistantRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4_000),
      }),
    )
    .min(1)
    .max(20),
});

function sanitizeAssistantOutput(content: string) {
  return (
    content
      // Remove common markdown structures
      .replace(/^\s*#{1,6}\s*/gm, "")
      .replace(/^\s*>+\s?/gm, "")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      // Convert emphasis into explicit highlight anchors the UI can style.
      .replace(/\*\*([^*]+?)\*\*|__([^_]+?)__/g, "<hl>$1$2</hl>")
      .trim()
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = assistantRequestSchema.parse(await request.json());
    const context = await getDashboardAssistantContext();

    if (isOpenAiConfigured()) {
      try {
        const reply = await getOpenAiAssistantReply(payload.messages, context);

        return NextResponse.json({
          reply: {
            role: "assistant",
            content: sanitizeAssistantOutput(reply.content),
          },
          mode: "openai",
          sourceMode: context.sourceMode,
          model: reply.model,
        } satisfies AssistantRouteResponse);
      } catch (error) {
        const fallback = generateLocalAssistantReply(payload.messages, context);

        return NextResponse.json({
          reply: {
            role: "assistant",
            content: sanitizeAssistantOutput(fallback),
          },
          mode: "local_fallback",
          sourceMode: context.sourceMode,
          model: null,
          warning:
            error instanceof Error
              ? error.message
              : "OpenAI request failed, using local fallback.",
        } satisfies AssistantRouteResponse);
      }
    }

    return NextResponse.json({
      reply: {
        role: "assistant",
        content: sanitizeAssistantOutput(generateLocalAssistantReply(payload.messages, context)),
      },
      mode: "local_fallback",
      sourceMode: context.sourceMode,
      model: null,
    } satisfies AssistantRouteResponse);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid assistant request payload.",
      },
      { status: 400 },
    );
  }
}
