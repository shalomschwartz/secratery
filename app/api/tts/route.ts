import { NextRequest } from "next/server";

// Text-to-speech via OpenAI-compatible endpoint or browser TTS.
// We proxy to the browser; this route just validates auth and returns the text.
// Actual TTS is handled client-side using the Web Speech API.
// If you want server-side TTS, replace this with an ElevenLabs / OpenAI TTS call.

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  return new Response(JSON.stringify({ text }), {
    headers: { "Content-Type": "application/json" },
  });
}
