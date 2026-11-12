// Netlify Function: POST /api/chat
//
// Real-time chat with the AI Analyst. Answers are streamed back as they are
// generated (NVIDIA Nemotron 3.5 Bolt E4B), always grounded in the results
// snapshot the visitor is currently viewing. The key stays in NVIDIA_API_KEY.

import type { Config } from "@netlify/functions";
import { handleChat } from "../../server/chat";

export default async (req: Request) => handleChat(req, { env: (name) => Netlify.env.get(name) });

export const config: Config = {
  path: "/api/chat",
  method: ["POST"],
  // Protects the free LLM quota: 15 messages per minute per visitor
  rateLimit: { windowLimit: 15, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
