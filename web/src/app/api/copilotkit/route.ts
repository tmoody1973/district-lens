import { createVertex } from "@ai-sdk/google-vertex";
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import {
  districtLookupAction,
  getRaceBriefAction,
  getIncumbentLegislationAction,
  findCandidateAction,
  getStateRacesAction,
  findCompetitiveRacesAction,
  getCandidateProfileAction,
  searchCandidatePositionsAction,
  searchCurrentNewsAction,
  getElectionDatesAction,
} from "@/lib/server-actions";

const vertex = createVertex({
  project: process.env.GOOGLE_CLOUD_PROJECT ?? "civicsync-440613",
  location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
});
const model = vertex("gemini-2.5-pro");

const tools = [
  defineTool({
    name: districtLookupAction.name,
    description: districtLookupAction.description,
    parameters: z.object({ address: z.string() }),
    execute: ({ address }) => districtLookupAction.handler({ address }),
  }),
  defineTool({
    name: getRaceBriefAction.name,
    description: getRaceBriefAction.description,
    parameters: z.object({ race_key: z.string() }),
    execute: ({ race_key }) => getRaceBriefAction.handler({ race_key }),
  }),
  defineTool({
    name: getIncumbentLegislationAction.name,
    description: getIncumbentLegislationAction.description,
    parameters: z.object({ race_key: z.string() }),
    execute: ({ race_key }) => getIncumbentLegislationAction.handler({ race_key }),
  }),
  defineTool({
    name: findCandidateAction.name,
    description: findCandidateAction.description,
    parameters: z.object({ name: z.string(), state: z.string().optional() }),
    execute: ({ name, state }) => findCandidateAction.handler({ name, state }),
  }),
  defineTool({
    name: getStateRacesAction.name,
    description: getStateRacesAction.description,
    parameters: z.object({ state_code: z.string() }),
    execute: ({ state_code }) => getStateRacesAction.handler({ state_code }),
  }),
  defineTool({
    name: findCompetitiveRacesAction.name,
    description: findCompetitiveRacesAction.description,
    parameters: z.object({ state: z.string().optional() }),
    execute: ({ state }) => findCompetitiveRacesAction.handler({ state }),
  }),
  defineTool({
    name: getCandidateProfileAction.name,
    description: getCandidateProfileAction.description,
    parameters: z.object({ race_key: z.string() }),
    execute: ({ race_key }) => getCandidateProfileAction.handler({ race_key }),
  }),
  defineTool({
    name: searchCandidatePositionsAction.name,
    description: searchCandidatePositionsAction.description,
    parameters: z.object({ candidate_name: z.string(), issue: z.string() }),
    execute: ({ candidate_name, issue }) =>
      searchCandidatePositionsAction.handler({ candidate_name, issue }),
  }),
  defineTool({
    name: searchCurrentNewsAction.name,
    description: searchCurrentNewsAction.description,
    parameters: z.object({ candidate_name: z.string() }),
    execute: ({ candidate_name }) => searchCurrentNewsAction.handler({ candidate_name }),
  }),
  defineTool({
    name: getElectionDatesAction.name,
    description: getElectionDatesAction.description,
    parameters: z.object({ state_code: z.string() }),
    execute: ({ state_code }) => getElectionDatesAction.handler({ state_code }),
  }),
];

const runtime = new CopilotRuntime({
  agents: { default: new BuiltInAgent({ model, tools }) },
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  endpoint: "/api/copilotkit",
});

export { handleRequest as GET, handleRequest as POST };
