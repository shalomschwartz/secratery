import * as calendar from "./google-calendar";
import * as gmail from "./google-gmail";

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  accessToken: string
): Promise<unknown> {
  switch (name) {
    // Calendar
    case "list_events":
      return calendar.listEvents(accessToken, input as Parameters<typeof calendar.listEvents>[1]);
    case "get_event":
      return calendar.getEvent(
        accessToken,
        input.eventId as string,
        input.calendarId as string | undefined
      );
    case "create_event":
      return calendar.createEvent(accessToken, input as Parameters<typeof calendar.createEvent>[1]);
    case "update_event":
      return calendar.updateEvent(accessToken, input as Parameters<typeof calendar.updateEvent>[1]);
    case "delete_event":
      return calendar.deleteEvent(
        accessToken,
        input.eventId as string,
        input.calendarId as string | undefined
      );
    case "check_availability":
      return calendar.checkAvailability(
        accessToken,
        input as Parameters<typeof calendar.checkAvailability>[1]
      );
    case "list_calendars":
      return calendar.listCalendars(accessToken);

    // Gmail
    case "list_emails":
      return gmail.listEmails(accessToken, input as Parameters<typeof gmail.listEmails>[1]);
    case "get_email":
      return gmail.getEmail(accessToken, input.messageId as string);
    case "send_email":
      return gmail.sendEmail(accessToken, input as Parameters<typeof gmail.sendEmail>[1]);
    case "reply_to_email":
      return gmail.replyToEmail(accessToken, input as Parameters<typeof gmail.replyToEmail>[1]);
    case "create_draft":
      return gmail.createDraft(accessToken, input as Parameters<typeof gmail.createDraft>[1]);
    case "delete_email":
      return gmail.deleteEmail(accessToken, input.messageId as string);
    case "mark_email":
      return gmail.markEmail(accessToken, input as Parameters<typeof gmail.markEmail>[1]);
    case "search_emails":
      return gmail.searchEmails(
        accessToken,
        input.query as string,
        input.maxResults as number | undefined
      );
    case "get_email_profile":
      return gmail.getProfile(accessToken);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
