"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
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

const assistantHighlightClassName = "font-mono font-medium text-emerald-400";

function sanitizeAssistantContent(content: string) {
  return content
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*]+?)\*\*|__([^_]+?)__/g, "<hl>$1$2</hl>")
    .trim();
}

function createHighlightNode(value: string, key: string) {
  return (
    <span key={key} data-anchor="assistant-value" className={assistantHighlightClassName}>
      {value}
    </span>
  );
}

function renderCurrencyAnchors(text: string, keyPrefix: string) {
  const currencyPattern = /(-?\$[\d,]+(?:\.\d{2})?)/g;
  const parts = text.split(currencyPattern);

  if (parts.length === 1) {
    return [text];
  }

  return parts.map((part, index) => {
    const isCurrencyValue = /^-?\$[\d,]+(?:\.\d{2})?$/.test(part);

    if (!isCurrencyValue) {
      return <span key={`${keyPrefix}-text-${index}`}>{part}</span>;
    }

    return createHighlightNode(part, `${keyPrefix}-currency-${index}`);
  });
}

function renderMessageContent(content: string) {
  const sanitizedContent = sanitizeAssistantContent(content);
  const highlightedValuePattern = /<hl>([\s\S]+?)<\/hl>/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = highlightedValuePattern.exec(sanitizedContent)) !== null) {
    const anchorValue = (match[1] ?? "").trim();

    if (match.index > lastIndex) {
      nodes.push(...renderCurrencyAnchors(sanitizedContent.slice(lastIndex, match.index), `segment-${i}`));
    }

    nodes.push(createHighlightNode(anchorValue, `anchor-${i}`));
    i += 1;
    lastIndex = match.index + match[0].length;
  }

  if (nodes.length === 0) {
    return <>{renderCurrencyAnchors(sanitizedContent, "message")}</>;
  }

  if (lastIndex < sanitizedContent.length) {
    nodes.push(...renderCurrencyAnchors(sanitizedContent.slice(lastIndex), "tail"));
  }

  return <>{nodes}</>;
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
      <CardHeader className="gap-4 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="rounded-sm border border-border bg-background p-3 text-emerald-500">
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
                    ? "border-emerald-500/40 text-emerald-400"
                    : "border-amber-500/40 text-amber-400",
                )}
              >
                {modeLabel(replyMode, replyModel)}
              </Badge>
              <Badge>{sourceMode === "warehouse" ? "Warehouse data" : "Sample data"}</Badge>
            </div>
          </div>
          <div className="max-w-xs rounded-sm border border-border bg-background px-4 py-3 text-sm text-slate-400">
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
              className="rounded-sm border border-border bg-background px-3 py-2 text-left text-sm text-slate-400 transition-colors hover:border-emerald-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {prompt}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 min-h-0 flex-col gap-4 pt-6">
        {warning ? (
          <div className="rounded-sm border border-amber-500/40 bg-background px-4 py-3 text-sm text-amber-400">
            OpenAI request fell back locally: {warning}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-sm border border-red-500/40 bg-background px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        ) : null}

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-3xl rounded-sm px-5 py-4 text-sm leading-7",
                message.role === "assistant"
                  ? "border border-border bg-background text-slate-200"
                  : "ml-auto border border-emerald-500/40 bg-emerald-500/5 text-slate-100",
              )}
            >
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                {message.role === "assistant" ? "Assistant" : "You"}
              </p>
              <div className="whitespace-pre-wrap">{renderMessageContent(message.content)}</div>
            </div>
          ))}

          {isSending ? (
            <div className="flex max-w-3xl items-center gap-3 rounded-sm border border-border bg-background px-5 py-4 text-sm text-slate-300">
              <LoaderCircle className="size-4 animate-spin text-emerald-500" />
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
