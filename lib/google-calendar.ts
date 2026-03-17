import { google } from "googleapis";

function getCalendarClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

export async function listEvents(
  accessToken: string,
  params: {
    maxResults?: number;
    timeMin?: string;
    timeMax?: string;
    q?: string;
    calendarId?: string;
  }
) {
  const calendar = getCalendarClient(accessToken);
  const { maxResults = 10, timeMin, timeMax, q, calendarId = "primary" } =
    params;

  const response = await calendar.events.list({
    calendarId,
    timeMin: timeMin || new Date().toISOString(),
    timeMax,
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
    q,
  });

  return response.data.items || [];
}

export async function getEvent(
  accessToken: string,
  eventId: string,
  calendarId = "primary"
) {
  const calendar = getCalendarClient(accessToken);
  const response = await calendar.events.get({ calendarId, eventId });
  return response.data;
}

export async function createEvent(
  accessToken: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: Array<{ email: string }>;
    reminders?: {
      useDefault: boolean;
      overrides?: Array<{ method: string; minutes: number }>;
    };
    calendarId?: string;
  }
) {
  const calendar = getCalendarClient(accessToken);
  const { calendarId = "primary", ...eventBody } = event;
  const response = await calendar.events.insert({
    calendarId,
    requestBody: eventBody,
  });
  return response.data;
}

export async function updateEvent(
  accessToken: string,
  params: {
    eventId: string;
    calendarId?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: Array<{ email: string }>;
  }
) {
  const calendar = getCalendarClient(accessToken);
  const { eventId, calendarId = "primary", ...updates } = params;

  const existing = await calendar.events.get({ calendarId, eventId });
  const updated = { ...existing.data, ...updates };

  const response = await calendar.events.update({
    calendarId,
    eventId,
    requestBody: updated,
  });
  return response.data;
}

export async function deleteEvent(
  accessToken: string,
  eventId: string,
  calendarId = "primary"
) {
  const calendar = getCalendarClient(accessToken);
  await calendar.events.delete({ calendarId, eventId });
  return { success: true, eventId };
}

export async function checkAvailability(
  accessToken: string,
  params: {
    timeMin: string;
    timeMax: string;
    calendars?: string[];
  }
) {
  const calendar = getCalendarClient(accessToken);
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      items: (params.calendars || ["primary"]).map((id) => ({ id })),
    },
  });
  return response.data;
}

export async function listCalendars(accessToken: string) {
  const calendar = getCalendarClient(accessToken);
  const response = await calendar.calendarList.list();
  return response.data.items || [];
}
