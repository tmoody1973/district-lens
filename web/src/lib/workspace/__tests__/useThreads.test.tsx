import { test, expect, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useThreads } from "@/lib/workspace/useThreads";
import type { AbstractAgent, Message } from "@ag-ui/client";
import { DEFAULT_STATE } from "@/types/agent-state";

type ThreadsApi = ReturnType<typeof useThreads>;

function makeFakeAgent() {
  const setMessagesCalls: Message[][] = [];
  const agent = {
    messages: [] as Message[],
    setMessages: vi.fn((msgs: Message[]) => {
      setMessagesCalls.push(msgs);
    }),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  };
  return { agent: agent as unknown as AbstractAgent, setMessagesCalls };
}

const THREAD_MESSAGES = [
  { role: "user", content: "Tell me about WI-04" },
  { role: "assistant", content: "Here is what the evidence shows…" },
];

function stubThreadApi(messages: typeof THREAD_MESSAGES, briefs: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/threads") {
        return { ok: true, json: async () => ({ threads: [] }) };
      }
      if (url.startsWith("/api/threads/")) {
        return {
          ok: true,
          json: async () => ({
            thread: { thread_id: "t1", title: "WI research", notes: "", messages },
            briefs,
          }),
        };
      }
      if (url.startsWith("/api/saved/brief/")) {
        return {
          ok: true,
          json: async () => ({ brief: { answer_snapshot: { currentRaceKey: "2026-H-WI-04" } } }),
        };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
}

function Harness({
  agent,
  apiRef,
  onRestoreBrief = () => {},
}: {
  agent: AbstractAgent;
  apiRef: { current: ThreadsApi | null };
  onRestoreBrief?: (s: unknown) => void;
}) {
  apiRef.current = useThreads({
    agentState: DEFAULT_STATE,
    agent,
    isSignedIn: true,
    onRestoreBrief: onRestoreBrief as never,
    onClearBrief: () => {},
  });
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("C1: restored thread messages survive the thread switch (not wiped)", async () => {
  const { agent, setMessagesCalls } = makeFakeAgent();
  stubThreadApi(THREAD_MESSAGES);
  const apiRef: { current: ThreadsApi | null } = { current: null };
  render(<Harness agent={agent} apiRef={apiRef} />);

  await act(async () => {
    await apiRef.current!.openThread("t1");
  });

  // The LAST write to the agent must be the restored conversation — the
  // shipped bug had the thread-switch effect wiping it with [] afterwards.
  const last = setMessagesCalls[setMessagesCalls.length - 1];
  expect(last.map((m) => ({ role: m.role, content: m.content }))).toEqual(THREAD_MESSAGES);
});

test("ISC-41: switching to a thread with no messages clears the chat", async () => {
  const { agent, setMessagesCalls } = makeFakeAgent();
  stubThreadApi([]);
  const apiRef: { current: ThreadsApi | null } = { current: null };
  render(<Harness agent={agent} apiRef={apiRef} />);

  await act(async () => {
    await apiRef.current!.openThread("t1");
  });

  const last = setMessagesCalls[setMessagesCalls.length - 1];
  expect(last).toEqual([]);
});

test("C8: switching threads replaces the chat with the new thread's messages", async () => {
  const { agent, setMessagesCalls } = makeFakeAgent();
  const conversations: Record<string, typeof THREAD_MESSAGES> = {
    t1: THREAD_MESSAGES,
    t2: [{ role: "user", content: "Now compare MT-Sen" }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/threads") return { ok: true, json: async () => ({ threads: [] }) };
      const id = url.split("/").pop()!;
      return {
        ok: true,
        json: async () => ({
          thread: { thread_id: id, title: id, notes: "", messages: conversations[id] ?? [] },
          briefs: [],
        }),
      };
    }),
  );
  const apiRef: { current: ThreadsApi | null } = { current: null };
  render(<Harness agent={agent} apiRef={apiRef} />);

  await act(async () => {
    await apiRef.current!.openThread("t1");
  });
  await act(async () => {
    await apiRef.current!.openThread("t2");
  });

  const last = setMessagesCalls[setMessagesCalls.length - 1];
  expect(last.map((m) => ({ role: m.role, content: m.content }))).toEqual(conversations.t2);
});

test("D3: opening a thread lands on the list — no auto-open of its latest brief", async () => {
  const { agent } = makeFakeAgent();
  stubThreadApi(THREAD_MESSAGES, [
    { brief_id: "b1", race_key: "2026-H-WI-04", created_at: "2026-06-01" },
  ]);
  const onRestoreBrief = vi.fn();
  const apiRef: { current: ThreadsApi | null } = { current: null };
  render(<Harness agent={agent} apiRef={apiRef} onRestoreBrief={onRestoreBrief} />);

  await act(async () => {
    await apiRef.current!.openThread("t1");
  });

  expect(onRestoreBrief).not.toHaveBeenCalled();
});
