import test from "node:test";
import assert from "node:assert/strict";
import { agentDoing, agentEye, agentTitle, hasSession, minutesBetween } from "../src/core/agents.ts";

const task = (o) => ({ id: "x", name: "Claude Code", state: "idle", steps: [], stepIndex: 0, isIntegration: true, ...o });

test("his eye takes the agent's state colour", () => {
  assert.equal(agentEye("working"), "#30d158");
  assert.equal(agentEye("approval"), "#ff9f0a");
  assert.equal(agentEye("question"), "#ff9f0a");
  assert.equal(agentEye("error"), "#ff453a");
  assert.equal(agentEye("finished"), "#636366");
});

test("only agents with a session get a row", () => {
  assert.ok(!hasSession(task({})), "a quiet integration: no row");
  assert.ok(hasSession(task({ state: "working" })));
  assert.ok(hasSession(task({ sessionCwd: "C:\\code\\korus" })));
  assert.ok(hasSession(task({ isIntegration: false })), "a tagged agent always");
});

test("the row is named for the project, and says what it's doing", () => {
  assert.equal(agentTitle(task({ sessionCwd: "C:\\code\\korus\\" })), "korus");
  assert.equal(agentTitle(task({ sessionCwd: "/home/me/api-server" })), "api-server");
  assert.equal(agentTitle(task({})), "Claude Code");
  assert.equal(agentDoing(task({ steps: ["reading", "editing invoice.ts"], stepIndex: 1 })), "editing invoice.ts");
  assert.equal(agentDoing(task({})), null);
  assert.equal(minutesBetween(0, 4.5 * 60_000), 4);
  assert.equal(minutesBetween(10, 0), 0);
});
