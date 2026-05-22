import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

// Python ADK backend exposes /copilotkit via ag_ui_adk.add_adk_fastapi_endpoint.
// AGENT_URL is set at deploy time; falls back to local dev server.
const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000";

const runtime = new CopilotRuntime({
  agents: {
    districtlens_root: new HttpAgent({
      url: `${agentUrl}/copilotkit`,
    }),
  },
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter: new ExperimentalEmptyAdapter(),
  endpoint: "/api/copilotkit",
});

export { handleRequest as GET, handleRequest as POST };
