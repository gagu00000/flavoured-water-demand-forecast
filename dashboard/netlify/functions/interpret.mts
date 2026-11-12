// Netlify Function: POST /api/interpret
//
// Turns the dashboard's live results snapshot into a grounded LLM interpretation
// (NVIDIA API Catalog, Nemotron 3.5 Bolt E4B). The key lives only in the site's
// environment variables (NVIDIA_API_KEY, scope: Functions).

import type { Config } from "@netlify/functions";
import { handleInterpret } from "../../server/handler";

export default async (req: Request) => handleInterpret(req, { env: (name) => Netlify.env.get(name) });

export const config: Config = {
  path: "/api/interpret",
  method: ["POST"],
  // Protects the free-tier LLM quota from abuse: 10 requests per minute per visitor
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
