"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
  AssistantChatMessage,
  AssistantDataSourceMode,
  AssistantReplyMode,
  AssistantRouteResponse,
} from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

type AssistantChatProps = {
  initialAssistantMessage: string;
  starterPrompts: string[];
  openAiConfigured: boolean;
  openAiModel: string;
  sourceMode: AssistantDataSourceMode;
};

type LocalMessage = AssistantChatMessage & {
  id: string;
};

function createMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function trimConversation(messages: LocalMessage[]) {
  return messages.slice(-12);
}

function toApiMessages(messages: LocalMessage[]): AssistantChatMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

function modeLabel(mode: AssistantReplyMode, model: string | null) {
  if (mode === "openai" && model) {
    return `OpenAI ${model}`;
  }

  return "Local fallback";
}

export function AssistantChat({
  initialAssistantMessage,
  starterPrompts,
  openAiConfigured,
  openAiModel,
  sourceMode,
}: AssistantChatProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      content: initialAssistantMessage,
    },
  ]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [replyMode, setReplyMode] = useState<AssistantReplyMode>(
    openAiConfigured ? "openai" : "local_fallback",
  );
  const [replyModel, setReplyModel] = useState<string | null>(
    openAiConfigured ? openAiModel : null,
  );
  const [isSending, setIsSending] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isSending]);

  async function sendPrompt(nextPrompt: string) {
    const normalizedPrompt = nextPrompt.trim();

    if (!normalizedPrompt || isSending) {
      return;
    }

    const nextMessages = trimConversation([
      ...messages,
      {
        id: createMessageId(),
        role: "user",
        content: normalizedPrompt,
      },
    ]);

    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setWarning(null);
    setIsSending(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: toApiMessages(nextMessages),
        }),
      });

      const payload = (await response.json()) as
        | AssistantRouteResponse
        | { error?: string };

      if (!response.ok || !("reply" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Assistant request failed.",
        );
      }

      setMessages(
        trimConversation([
          ...nextMessages,
          {
            id: createMessageId(),
            role: payload.reply.role,
            content: payload.reply.content,
          },
        ]),
      );
      setReplyMode(payload.mode);
      setReplyModel(payload.model);
      setWarning(payload.warning ?? null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Assistant request failed.",
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Card className="flex h-full min-h-[720px] flex-col">
      <CardHeader className="gap-4 border-b border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-200">
                <Sparkles className="size-5" />
              </div>
              <div>
                <CardTitle>Finance analyst</CardTitle>
                <p className="text-sm text-slate-400">
                  Ask for dashboard walkthroughs, finance insights, or internal
                  workflow explanations.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                className={cn(
                  replyMode === "openai"
                    ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"
                    : "border-amber-300/20 bg-amber-300/10 text-amber-50",
                )}
              >
                {modeLabel(replyMode, replyModel)}
              </Badge>
              <Badge>{sourceMode === "warehouse" ? "Warehouse data" : "Sample data"}</Badge>
            </div>
          </div>
          <div className="max-w-xs rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
            {openAiConfigured
              ? "OpenAI is configured, so responses can use the model-backed path with local fallback if the request fails."
              : "OpenAI is not configured yet, so replies are coming from the local finance-aware fallback engine."}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={isSending}
              onClick={() => {
                void sendPrompt(prompt);
              }}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {prompt}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 min-h-0 flex-col gap-4 pt-6">
        {warning ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
            OpenAI request fell back locally: {warning}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-3xl rounded-3xl px-5 py-4 text-sm leading-7 shadow-[0_18px_40px_rgba(3,7,18,0.24)]",
                message.role === "assistant"
                  ? "border border-white/10 bg-white/[0.04] text-slate-200"
                  : "ml-auto border border-cyan-400/20 bg-cyan-400/10 text-cyan-50",
              )}
            >
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                {message.role === "assistant" ? "Assistant" : "You"}
              </p>
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          ))}

          {isSending ? (
            <div className="flex max-w-3xl items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-slate-300">
              <LoaderCircle className="size-4 animate-spin text-cyan-300" />
              Thinking through the dashboard context...
            </div>
          ) : null}

          <div ref={messageEndRef} />
        </div>

        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void sendPrompt(draft);
          }}
        >
          <Textarea
            value={draft}
            disabled={isSending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendPrompt(draft);
              }
            }}
            placeholder="Ask about cash flow, spending drivers, low-confidence rows, rules, imports, or how to use a page."
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Enter to send, Shift+Enter for a new line
            </p>
            <Button type="submit" disabled={isSending || !draft.trim()}>
              <ArrowUp className="mr-2 size-4" />
              Send
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
