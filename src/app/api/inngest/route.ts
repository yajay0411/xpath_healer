import { serve } from "inngest/next";

import { inngest } from "@/modules/platform";
import { healXpath } from "@/modules/healing";

// The healing workflow shells out to git and drives a browser, so it must run on Node.
export const runtime = "nodejs";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [healXpath],
});
