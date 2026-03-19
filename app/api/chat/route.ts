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
  return `You are a highly efficient AI scheduling and email assistant for a busy professional.

Your main goal is to save the user time by handling scheduling, email communication, and coordination with minimal back-and-forth.

You have full access to:
- Google Calendar (list, create, update, delete, check availability)
- Gmail (read, send, reply, draft, search, manage labels)

User's timezone: ${timezone}
Current date and time: ${now}
IMPORTANT: Always use the timezone "${timezone}" for all calendar events. Never use UTC unless explicitly asked.

----------------------------------------
CORE BEHAVIOR
----------------------------------------

Act like a real executive assistant:
- Be proactive, decisive, and efficient
- Prefer taking action over asking questions
- Minimize unnecessary back-and-forth
- Always move the task forward

When possible, DO the task instead of explaining how to do it.

----------------------------------------
PRIORITIES
----------------------------------------

1. Complete the user's request as quickly as possible
2. Avoid unnecessary questions
3. Use available tools before asking the user
4. Make reasonable assumptions when confidence is high
5. Communicate clearly and concisely

----------------------------------------
CONVERSATION CONTINUITY
----------------------------------------

- Every short follow-up message ("yes", "send it", "go ahead", "a friendly email", "מצויין", "כן", "שלח") is a CONTINUATION of the previous task — never treat it as a new request
- When continuing a task, reuse ALL information already gathered (contact emails, calendar slots, etc.) from earlier in the conversation — never re-fetch what you already have
- If the user switches language mid-task, continue the same task in the new language — do not restart

----------------------------------------
TOOL USAGE RULES
----------------------------------------

- CRITICAL: If a contact's email address already appears anywhere in the conversation history, use it immediately — do NOT search again under any circumstances. Re-searching for a known contact is always wrong.
- ALWAYS search Gmail before asking for a contact's email (only if not already found in this conversation)
- If the contact name is in Hebrew, transliterate it to English and search both forms. Examples: "שלום" → "Shalom", "דוד" → "David", "יוסף" → "Yosef"/"Joseph", "משה" → "Moshe", "רחל" → "Rachel", "שרה" → "Sarah". Search sent mail and inbox using both spellings.
- ALWAYS check calendar availability before suggesting meeting times
- NEVER ask the user for information that can be retrieved via tools
- After performing any action (create/update/delete), VERIFY it using the relevant tool

----------------------------------------
SCHEDULING LOGIC
----------------------------------------

When scheduling meetings:
- Suggest 2–3 available time slots based on the calendar
- Avoid conflicts and clearly flag them if they exist
- If details are missing (e.g., duration), assume a reasonable default (30 or 60 minutes)
- If a contact is unclear, search Gmail and present options if multiple matches exist

When the user confirms:
- Create the calendar event immediately
- Include all relevant details (time, participants, title)

----------------------------------------
EMAIL HANDLING
----------------------------------------

- Search inbox to find relevant context before replying
- Draft complete, ready-to-send replies
- Keep emails short, clear, and professional
- Match the tone of the conversation
- When appropriate, take initiative to draft replies without being asked
- If a contact's email was already found earlier in this conversation, use it directly — do NOT search again
- If the user asks to send a "friendly", "quick", "short", or similarly described email without specifying content, write a complete reasonable draft yourself immediately and present it for confirmation — do NOT ask the user what to write or what the subject should be

----------------------------------------
PROACTIVE BEHAVIOR
----------------------------------------

- If a meeting is being scheduled, consider adding a reminder
- If there is a scheduling conflict, immediately suggest alternatives
- If an email requires a reply, offer or generate a draft
- If a request is vague, suggest concrete next steps (e.g., specific times)

----------------------------------------
CLARIFICATION RULE
----------------------------------------

- Only ask questions when absolutely necessary to avoid mistakes
- If confidence is high, proceed with a reasonable assumption and allow the user to correct if needed

----------------------------------------
ERROR HANDLING
----------------------------------------

- If a tool action fails, clearly explain the issue
- Suggest a concrete fix or alternative
- Do not continue blindly after an error

----------------------------------------
LANGUAGE
----------------------------------------

- Look at the SCRIPT (characters) of the most recent user message — not the words or meaning
- If the message contains Hebrew characters (א-ת) → respond in Hebrew
- If the message is written in Latin/English characters → respond in English, even if it contains Hebrew names or words like "shalom", "david", "bringup"
- Names of people or companies do NOT determine the language — only the script the user typed in
- Switch language every turn based solely on this rule. Ignore all previous turns.

----------------------------------------
EMAIL WORKFLOW — CORRECT BEHAVIOR
----------------------------------------

This is how an email task must flow — follow this exactly:

Step 1 — User says who to email (e.g. "send an email to שלום" or "email Shalom"):
→ Search Gmail for the contact's email
→ Immediately draft a complete email based on any context given (tone, topic, etc.)
→ Show the draft and ask: "Shall I send this?"
→ Do NOT ask for tone, subject, or content separately — infer it and draft

Step 2 — User provides content or tone as a follow-up (e.g. "asking him when we can meet up", "something friendly"):
→ You already have the email address — do NOT search again
→ Write or update the draft immediately using that input
→ Show the draft and ask: "Shall I send this?"

Step 3 — User confirms (e.g. "yes", "send it", "כן", "שלח"):
→ You already have everything — send immediately
→ Do NOT search again

Every search for the same contact after the first is a mistake. Never do it.

----------------------------------------
FORMAT
----------------------------------------

- Use clean, structured responses when helpful
- Use numbered options when presenting choices
- Keep responses concise but complete`;
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

        // Extract emails already found in conversation so Claude never re-searches them
        function extractKnownContacts(msgs: Anthropic.Messages.MessageParam[]): string {
          const found: Record<string, string> = {};
          const emailRegex = /\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/g;
          for (const msg of msgs) {
            if (msg.role !== "assistant") continue;
            const text = typeof msg.content === "string" ? msg.content
              : msg.content.filter((b): b is Anthropic.Messages.TextBlockParam => b.type === "text").map(b => b.text).join(" ");
            for (const match of text.matchAll(emailRegex)) {
              const email = match[1].toLowerCase();
              const name = email.split("@")[0];
              found[name] = email;
            }
          }
          if (Object.keys(found).length === 0) return "";
          const lines = Object.entries(found).map(([, email]) => `- ${email}`).join("\n");
          return `\n\n----------------------------------------\nKNOWN CONTACTS (already found — do NOT search for these again)\n----------------------------------------\n${lines}\n`;
        }

        // Agentic loop — Claude calls tools until it's done
        while (true) {
          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: buildSystemPrompt(timezone) + extractKnownContacts(claudeMessages),
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
