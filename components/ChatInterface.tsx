"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";
import {
  Send,
  Mic,
  MicOff,
  LogOut,
  Calendar,
  Mail,
  Loader2,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: string[];
}

interface SSEEvent {
  type: "text" | "tool_call" | "tool_result" | "tool_error" | "done" | "error";
  text?: string;
  name?: string;
  error?: string;
}

// ── Web Speech API types ─────────────────────────────────────────────────────
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}
// ────────────────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  list_events: "📅 Checking calendar",
  get_event: "📅 Reading event",
  create_event: "📅 Creating event",
  update_event: "📅 Updating event",
  delete_event: "📅 Deleting event",
  check_availability: "📅 Checking availability",
  list_calendars: "📅 Loading calendars",
  list_emails: "✉️ Loading emails",
  get_email: "✉️ Reading email",
  send_email: "✉️ Sending email",
  reply_to_email: "✉️ Sending reply",
  create_draft: "✉️ Saving draft",
  delete_email: "✉️ Trashing email",
  mark_email: "✉️ Updating email",
  search_emails: "✉️ Searching emails",
  get_email_profile: "✉️ Loading profile",
};

export function ChatInterface({ userEmail }: { userEmail?: string }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm your AI Secretary. I have full access to your Google Calendar and Gmail. You can ask me to:\n\n• Schedule, edit, or delete calendar events\n• Read, send, reply to, or search your emails\n• Check your availability\n• Draft emails for you\n\nWhat can I help you with today?\n\n---\n\nשלום! אני המזכיר האישי שלך המופעל על ידי בינה מלאכותית. יש לי גישה מלאה ליומן Google ול-Gmail שלך. אני יכול לעזור לך:\n\n• לתזמן, לערוך או למחוק אירועים ביומן\n• לקרוא, לשלוח, להשיב או לחפש מיילים\n• לבדוק את הזמינות שלך\n• לנסח מיילים עבורך\n\nבמה אוכל לעזור לך היום?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const currentAssistantId = useRef<string | null>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeToolCalls]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  // Send a message
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: Message = {
        id: Date.now().toString(),
        role: "user",
        content: text.trim(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);
      setActiveToolCalls([]);

      const assistantId = (Date.now() + 1).toString();
      currentAssistantId.current = assistantId;

      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        toolCalls: [],
      };
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        // Build message history for API (exclude welcome message)
        const history = [
          ...messages.filter((m) => m.id !== "welcome"),
          userMsg,
        ].map((m) => ({ role: m.role, content: m.content }));

        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        });

        if (!resp.ok) {
          const err = await resp.json();
          if (err.error === "TokenExpired") {
            throw new Error(
              "Your session has expired. Please sign in again."
            );
          }
          throw new Error(err.error || "Request failed");
        }

        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            const event: SSEEvent = JSON.parse(raw);

            if (event.type === "text" && event.text) {
              fullText += event.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: fullText } : m
                )
              );
            }

            if (event.type === "tool_call" && event.name) {
              const label = TOOL_LABELS[event.name] ?? `🔧 ${event.name}`;
              setActiveToolCalls((prev) => [...prev, label]);
            }

            if (
              (event.type === "tool_result" || event.type === "tool_error") &&
              event.name
            ) {
              const label = TOOL_LABELS[event.name] ?? `🔧 ${event.name}`;
              setActiveToolCalls((prev) => prev.filter((t) => t !== label));
            }

            if (event.type === "error") {
              throw new Error(event.error);
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Something went wrong";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `⚠️ ${message}` }
              : m
          )
        );
      } finally {
        setIsLoading(false);
        setActiveToolCalls([]);
      }
    },
    [isLoading, messages]
  );

  // Voice recording toggle
  const toggleRecording = useCallback(() => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      alert("Speech recognition is not supported in your browser.");
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    // he-IL recognizes both Hebrew and English speech
    recognition.lang = "he-IL";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);

      if (event.results[event.results.length - 1].isFinal) {
        recognition.stop();
        setIsRecording(false);
        if (transcript.trim()) {
          setTimeout(() => sendMessage(transcript.trim()), 100);
        }
      }
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [isRecording, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-[#0f1117] text-gray-900 dark:text-slate-100 transition-colors duration-500">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900 dark:text-white">AI Secretary</h1>
            <p className="text-xs text-gray-500 dark:text-slate-400">{userEmail}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 mr-2">
            <Calendar size={11} /> Calendar
          </span>
          <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 mr-2">
            <Mail size={11} /> Gmail
          </span>

          <button
            onClick={() => signOut()}
            title="Sign out"
            className="p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold mt-0.5">
                AI
              </div>
            )}
            <div className="flex flex-col gap-1 max-w-[80%]">
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-tr-sm"
                    : "bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-100 rounded-tl-sm shadow-sm border border-gray-100 dark:border-transparent"
                }`}
              >
                {msg.content}
                {msg.role === "assistant" && !msg.content && isLoading && (
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-slate-400 rounded-full animate-bounce" />
                  </span>
                )}
              </div>
            </div>
            {msg.role === "user" && (
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-300 dark:bg-slate-700 flex items-center justify-center text-gray-700 dark:text-white text-xs font-bold mt-0.5">
                {userEmail?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
          </div>
        ))}

        {/* Active tool calls */}
        {activeToolCalls.length > 0 && (
          <div className="flex justify-start gap-3">
            <div className="w-8 h-8" />
            <div className="flex flex-col gap-1.5">
              {activeToolCalls.map((label, i) => (
                <div
                  key={i}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs text-gray-600 dark:text-slate-300"
                >
                  <Loader2 size={12} className="animate-spin text-indigo-500" />
                  {label}…
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-gray-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 backdrop-blur px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          {/* Mic button */}
          <button
            onClick={toggleRecording}
            title={isRecording ? "Stop recording" : "Voice input"}
            className={`relative flex-shrink-0 p-2.5 rounded-xl transition-colors ${
              isRecording
                ? "bg-red-600 text-white pulse-ring"
                : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700"
            }`}
          >
            {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything… schedule a meeting, read emails, send a reply…"
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 transition-all min-h-[42px] max-h-40"
          />

          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0 p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
        <p className="text-center text-xs text-gray-400 dark:text-slate-600 mt-2">
          Press Enter to send · Shift+Enter for new line · Click mic or speak and pause to send
        </p>
      </div>
    </div>
  );
}
