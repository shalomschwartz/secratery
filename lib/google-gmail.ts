import { google } from "googleapis";

function getGmailClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

function encodeEmail(params: {
  to: string;
  subject: string;
  body: string;
  from?: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
  ];
  if (params.from) lines.push(`From: ${params.from}`);
  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);
  lines.push("", params.body);

  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

function parseMessage(msg: {
  id?: string | null;
  threadId?: string | null;
  snippet?: string | null;
  labelIds?: string[] | null;
  payload?: {
    headers?: Array<{ name?: string | null; value?: string | null }>;
    body?: { data?: string | null };
    parts?: Array<{
      mimeType?: string | null;
      body?: { data?: string | null };
    }>;
  };
}) {
  const headers = msg.payload?.headers || [];
  const get = (name: string) =>
    headers.find(
      (h) => (h.name || "").toLowerCase() === name.toLowerCase()
    )?.value || "";

  let body = "";
  if (msg.payload?.body?.data) {
    body = Buffer.from(msg.payload.body.data, "base64").toString();
  } else if (msg.payload?.parts) {
    const textPart = msg.payload.parts.find(
      (p) => p.mimeType === "text/plain"
    );
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64").toString();
    }
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    subject: get("Subject"),
    from: get("From"),
    to: get("To"),
    date: get("Date"),
    snippet: msg.snippet,
    body: body.substring(0, 3000),
    labels: msg.labelIds || [],
    messageId: get("Message-ID"),
    references: get("References"),
  };
}

export async function listEmails(
  accessToken: string,
  params: {
    maxResults?: number;
    q?: string;
    labelIds?: string[];
  }
) {
  const gmail = getGmailClient(accessToken);
  const { maxResults = 10, q, labelIds = ["INBOX"] } = params;

  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q,
    labelIds,
  });

  if (!response.data.messages?.length) return [];

  // Use metadata format (headers only) for fast listing — no full body needed
  const messages = await Promise.all(
    response.data.messages.slice(0, maxResults).map((m) =>
      gmail.users.messages.get({
        userId: "me",
        id: m.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "To", "Date", "Message-ID", "References"],
      })
    )
  );

  return messages.map((m) => ({
    id: m.data.id,
    threadId: m.data.threadId,
    subject: m.data.payload?.headers?.find(h => h.name === "Subject")?.value || "",
    from: m.data.payload?.headers?.find(h => h.name === "From")?.value || "",
    to: m.data.payload?.headers?.find(h => h.name === "To")?.value || "",
    date: m.data.payload?.headers?.find(h => h.name === "Date")?.value || "",
    snippet: m.data.snippet,
    labels: m.data.labelIds || [],
    messageId: m.data.payload?.headers?.find(h => h.name === "Message-ID")?.value || "",
    references: m.data.payload?.headers?.find(h => h.name === "References")?.value || "",
    body: "(Use get_email with this id to read the full message body)",
  }));
}

export async function getEmail(accessToken: string, messageId: string) {
  const gmail = getGmailClient(accessToken);
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  return parseMessage(response.data);
}

export async function sendEmail(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
  }
) {
  const gmail = getGmailClient(accessToken);
  const raw = encodeEmail(params);
  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
  return response.data;
}

export async function replyToEmail(
  accessToken: string,
  params: {
    messageId: string;
    body: string;
    to?: string;
  }
) {
  const gmail = getGmailClient(accessToken);

  const original = await gmail.users.messages.get({
    userId: "me",
    id: params.messageId,
    format: "full",
  });

  const headers = original.data.payload?.headers || [];
  const get = (name: string) =>
    headers.find(
      (h) => (h.name || "").toLowerCase() === name.toLowerCase()
    )?.value || "";

  const to = params.to || get("From");
  const rawSubject = get("Subject");
  const subject = rawSubject.startsWith("Re:") ? rawSubject : `Re: ${rawSubject}`;
  const messageId = get("Message-ID");
  const references = get("References")
    ? `${get("References")} ${messageId}`
    : messageId;

  const raw = encodeEmail({
    to,
    subject,
    body: params.body,
    inReplyTo: messageId,
    references,
  });

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: original.data.threadId! },
  });
  return response.data;
}

export async function createDraft(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
  }
) {
  const gmail = getGmailClient(accessToken);
  const raw = encodeEmail(params);
  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });
  return response.data;
}

export async function deleteEmail(accessToken: string, messageId: string) {
  const gmail = getGmailClient(accessToken);
  await gmail.users.messages.trash({ userId: "me", id: messageId });
  return { success: true, messageId };
}

export async function markEmail(
  accessToken: string,
  params: {
    messageId: string;
    markAsRead?: boolean;
    addLabels?: string[];
    removeLabels?: string[];
  }
) {
  const gmail = getGmailClient(accessToken);
  const addLabelIds = [...(params.addLabels || [])];
  const removeLabelIds = [...(params.removeLabels || [])];

  if (params.markAsRead === true) removeLabelIds.push("UNREAD");
  if (params.markAsRead === false) addLabelIds.push("UNREAD");

  const response = await gmail.users.messages.modify({
    userId: "me",
    id: params.messageId,
    requestBody: { addLabelIds, removeLabelIds },
  });
  return response.data;
}

export async function searchEmails(
  accessToken: string,
  query: string,
  maxResults = 10
) {
  return listEmails(accessToken, { q: query, maxResults });
}

export async function getProfile(accessToken: string) {
  const gmail = getGmailClient(accessToken);
  const response = await gmail.users.getProfile({ userId: "me" });
  return response.data;
}
