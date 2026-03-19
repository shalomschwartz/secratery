import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { tools } from "@/lib/tools";
import { executeTool } from "@/lib/tool-executor";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

function buildSystemPrompt(timezone: string) {
  const now = new Date().toLocaleString("en-US", { timeZone: timezone, hour12: false });
  return `You are a highly capable personal AI secretary. You have full access to the user's Google Calendar and Gmail through tools.

Your capabilities:
- Google Calendar: list events, create/update/delete events, check availability, manage multiple calendars
- Gmail: read/send/reply/draft emails, search, mark read/unread, manage labels, trash emails

User's timezone: ${timezone}
Current date and time for the user: ${now}
IMPORTANT: Always use the timezone "${timezone}" when creating or referencing calendar events. Never use UTC unless explicitly asked.

## How to handle requests

**Be a real secretary — use your tools proactively:**
- If the user mentions a person's name, search their emails first to find that person's email address before asking the user for it. Never ask for an email address you can look up yourself.
- If the name is given in Hebrew, transliterate it to English and search for both forms. Examples: "שלום" → search "Shalom", "דוד" → search "David", "יוסף" → search "Yosef"/"Joseph", "משה" → search "Moshe"/"Moses", "רחל" → search "Rachel", "שרה" → search "Sarah", etc. Search the user's sent mail and inbox using both spellings to find the right contact.
- If the user mentions a company, topic, or event you don't have details for, search emails or calendar first.
- Make intelligent assumptions and suggestions. For example: if no time is given for a meeting, suggest a time that works based on the user's calendar availability.
- Proactively flag potential issues: conflicts, missing info, ambiguous names, etc.

**Clarify before acting — but only what matters:**
- Before creating, sending, or deleting anything, repeat back the key details to the user and ask them to confirm. For example: "I'll schedule a meeting with David (david@example.com) on Thursday at 3pm for 1 hour — shall I go ahead?"
- If the user's request is ambiguous (e.g. "John" matches multiple contacts), list the options and ask which one.
- Do NOT ask for information you can look up yourself using your tools.

**Verify your own work:**
- After completing an action (creating event, sending email, etc.), use your tools to verify it actually happened — e.g. fetch the created event or check sent mail — before telling the user it's done.
- If something went wrong, tell the user clearly and try again or suggest a fix.

**Format output clearly:**
- Show emails and events in a clean, readable format.
- When listing multiple items, number them.
- Keep responses concise but complete.

**You can do multiple things in one turn** (e.g. search for a contact AND check calendar AND create an event).

**Language:** Always respond in the same language the user wrote in. If they write in Hebrew, reply in Hebrew. If in English, reply in English. Never mix languages in one response.`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (session.error === "RefreshAccessTokenError") {
    return new Response(JSON.stringify({ error: "TokenExpired" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, timezone = "UTC" } = await req.json();
  const accessToken = session.accessToken;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const claudeMessages: Anthropic.Messages.MessageParam[] = messages.map(
          (m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })
        );

        // Agentic loop — Claude calls tools until it's done
        while (true) {
          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: buildSystemPrompt(timezone),
            tools,
            messages: claudeMessages,
          });

          // Stream any text blocks to the client immediately
          for (const block of response.content) {
            if (block.type === "text" && block.text) {
              enqueue({ type: "text", text: block.text });
            }
          }

          if (response.stop_reason === "end_turn") break;

          const toolUses = response.content.filter(
            (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
          );
          if (toolUses.length === 0) break;

          // Execute all tool calls (may run in parallel)
          const toolResults = await Promise.all(
            toolUses.map(async (toolUse) => {
              enqueue({ type: "tool_call", name: toolUse.name });
              try {
                const result = await executeTool(
                  toolUse.name,
                  toolUse.input as Record<string, unknown>,
                  accessToken
                );
                enqueue({ type: "tool_result", name: toolUse.name });
                return {
                  type: "tool_result" as const,
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(result),
                };
              } catch (err: unknown) {
                const message =
                  err instanceof Error ? err.message : String(err);
                enqueue({ type: "tool_error", name: toolUse.name, error: message });
                return {
                  type: "tool_result" as const,
                  tool_use_id: toolUse.id,
                  content: `Error: ${message}`,
                  is_error: true,
                };
              }
            })
          );

          // Add assistant turn + tool results and continue the loop
          claudeMessages.push({
            role: "assistant",
            content: response.content,
          });
          claudeMessages.push({
            role: "user",
            content: toolResults,
          });
        }

        enqueue({ type: "done" });
        controller.close();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        enqueue({ type: "error", error: message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
