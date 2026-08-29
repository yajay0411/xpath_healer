import { serve } from "inngest/next";

import { inngest } from "@/lib/events";
import { healXpath } from "@/lib/heal/workflow";

// The healing workflow shells out to git and drives a browser, so it must run on Node.
export const runtime = "nodejs";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [healXpath],
});
