import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { tools } from "@/lib/tools";
import { executeTool } from "@/lib/tool-executor";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are a highly capable personal AI secretary. You have full access to the user's Google Calendar and Gmail through tools.

Your capabilities:
- Google Calendar: list events, create/update/delete events, check availability, manage multiple calendars
- Gmail: read/send/reply/draft emails, search, mark read/unread, manage labels, trash emails

Guidelines:
- Today's date and time: ${new Date().toISOString()}
- Be proactive and efficient — take action immediately when asked
- Always confirm what you did after completing actions
- When creating calendar events, infer a reasonable timezone if not specified
- When showing events or emails, format them clearly and concisely
- If you need more info to complete a task, ask once — then act
- You can do multiple things in one turn (e.g. check calendar AND send an email)`;

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

  const { messages } = await req.json();
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
            system: SYSTEM_PROMPT,
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
