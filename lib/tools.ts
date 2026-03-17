import Anthropic from "@anthropic-ai/sdk";

export const tools: Anthropic.Messages.Tool[] = [
  // ── Calendar ──────────────────────────────────────────────────────────────
  {
    name: "list_events",
    description:
      "List upcoming Google Calendar events. Use to show what's on the schedule.",
    input_schema: {
      type: "object",
      properties: {
        maxResults: {
          type: "number",
          description: "Max events to return (default 10)",
        },
        timeMin: {
          type: "string",
          description: "Start time ISO 8601 (defaults to now)",
        },
        timeMax: { type: "string", description: "End time ISO 8601" },
        q: { type: "string", description: "Free-text search filter" },
        calendarId: {
          type: "string",
          description: "Calendar ID (default: primary)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_event",
    description: "Get full details of a specific calendar event by ID.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "The calendar event ID" },
        calendarId: {
          type: "string",
          description: "Calendar ID (default: primary)",
        },
      },
      required: ["eventId"],
    },
  },
  {
    name: "create_event",
    description: "Create a new Google Calendar event.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title" },
        description: { type: "string", description: "Event notes/description" },
        location: { type: "string", description: "Event location" },
        start: {
          type: "object",
          description: "Start time",
          properties: {
            dateTime: {
              type: "string",
              description: "ISO 8601 for timed events",
            },
            date: {
              type: "string",
              description: "YYYY-MM-DD for all-day events",
            },
            timeZone: {
              type: "string",
              description: "Timezone e.g. America/New_York",
            },
          },
        },
        end: {
          type: "object",
          description: "End time",
          properties: {
            dateTime: { type: "string" },
            date: { type: "string" },
            timeZone: { type: "string" },
          },
        },
        attendees: {
          type: "array",
          description: "List of attendee email addresses",
          items: {
            type: "object",
            properties: { email: { type: "string" } },
          },
        },
        calendarId: {
          type: "string",
          description: "Calendar ID (default: primary)",
        },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "update_event",
    description: "Update an existing calendar event.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID to update" },
        calendarId: { type: "string", description: "Calendar ID (default: primary)" },
        summary: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        start: {
          type: "object",
          properties: {
            dateTime: { type: "string" },
            date: { type: "string" },
            timeZone: { type: "string" },
          },
        },
        end: {
          type: "object",
          properties: {
            dateTime: { type: "string" },
            date: { type: "string" },
            timeZone: { type: "string" },
          },
        },
        attendees: {
          type: "array",
          items: { type: "object", properties: { email: { type: "string" } } },
        },
      },
      required: ["eventId"],
    },
  },
  {
    name: "delete_event",
    description: "Delete a calendar event.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID to delete" },
        calendarId: { type: "string", description: "Calendar ID (default: primary)" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "check_availability",
    description: "Check free/busy availability for a time range.",
    input_schema: {
      type: "object",
      properties: {
        timeMin: { type: "string", description: "Start time ISO 8601" },
        timeMax: { type: "string", description: "End time ISO 8601" },
        calendars: {
          type: "array",
          items: { type: "string" },
          description: "Calendar IDs to check (default: [primary])",
        },
      },
      required: ["timeMin", "timeMax"],
    },
  },
  {
    name: "list_calendars",
    description: "List all calendars the user has access to.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // ── Gmail ─────────────────────────────────────────────────────────────────
  {
    name: "list_emails",
    description: "List emails from Gmail.",
    input_schema: {
      type: "object",
      properties: {
        maxResults: { type: "number", description: "Max emails (default 10)" },
        q: {
          type: "string",
          description:
            "Gmail search query e.g. 'is:unread', 'from:boss@co.com'",
        },
        labelIds: {
          type: "array",
          items: { type: "string" },
          description: "Filter by labels e.g. ['INBOX','UNREAD']",
        },
      },
      required: [],
    },
  },
  {
    name: "get_email",
    description: "Get full content of a specific email by message ID.",
    input_schema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Gmail message ID" },
      },
      required: ["messageId"],
    },
  },
  {
    name: "send_email",
    description: "Send an email.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain text email body" },
        cc: { type: "string", description: "CC recipients (comma-separated)" },
        bcc: { type: "string", description: "BCC recipients" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "reply_to_email",
    description: "Reply to an existing email thread.",
    input_schema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Message ID to reply to" },
        body: { type: "string", description: "Reply body text" },
        to: {
          type: "string",
          description: "Override recipient (default: original sender)",
        },
      },
      required: ["messageId", "body"],
    },
  },
  {
    name: "create_draft",
    description: "Save an email as a draft without sending.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body" },
        cc: { type: "string", description: "CC recipients" },
        bcc: { type: "string", description: "BCC recipients" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "delete_email",
    description: "Move an email to trash.",
    input_schema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Message ID to trash" },
      },
      required: ["messageId"],
    },
  },
  {
    name: "mark_email",
    description: "Mark email as read/unread or add/remove labels.",
    input_schema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Message ID" },
        markAsRead: {
          type: "boolean",
          description: "true = mark read, false = mark unread",
        },
        addLabels: {
          type: "array",
          items: { type: "string" },
          description: "Labels to add",
        },
        removeLabels: {
          type: "array",
          items: { type: "string" },
          description: "Labels to remove",
        },
      },
      required: ["messageId"],
    },
  },
  {
    name: "search_emails",
    description: "Search emails with Gmail query syntax.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query e.g. 'from:boss subject:budget after:2024/01/01'",
        },
        maxResults: {
          type: "number",
          description: "Max results (default 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_email_profile",
    description: "Get the user's Gmail profile (email address, totals, etc.).",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];
