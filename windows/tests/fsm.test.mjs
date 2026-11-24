// Island open/close state machine (src/island/fsm.ts).

import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { IslandStateMachine } from "../src/island/fsm.ts";

let fsm;
let transitions;

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fsm = new IslandStateMachine();
  transitions = [];
  fsm.onTransition = (from, to) => transitions.push(`${from}>${to}`);
});

afterEach(() => mock.timers.reset());

const seconds = (n) => mock.timers.tick(n * 1000);

test("starts hidden and opens on the greeting at launch", () => {
  assert.equal(fsm.state, "hidden");
  fsm.launch();
  assert.equal(fsm.state, "coucou");
  assert.deepEqual(transitions, ["hidden>coucou"]);
});

test("the greeting collapses to the compact island 0.6 s after it ends", () => {
  fsm.launch();
  fsm.greetComplete();
  seconds(0.5);
  assert.equal(fsm.state, "coucou");
  seconds(0.1);
  assert.equal(fsm.state, "petit");
});

test("a hovered greeting stays for 10 s, whatever the animation does", () => {
  fsm.launch();
  fsm.mouseEntered();
  fsm.greetComplete();
  seconds(9.9);
  assert.equal(fsm.state, "coucou");
  seconds(0.1);
  assert.equal(fsm.state, "petit");
});

test("leaving the greeting collapses it at once", () => {
  fsm.launch();
  fsm.mouseEntered();
  fsm.mouseLeft();
  assert.equal(fsm.state, "petit");
});

// JARVIS: the notch prototype (docs/jarvis/design/prototypes/jarvis-notch.html): the pointer on
// the closed pill opens the notch at once; 3 s after it leaves, the notch folds straight back.

test("the pointer on the closed pill opens the notch at once, and it stays while hovered", () => {
  fsm.mouseEntered();
  assert.equal(fsm.state, "home");
  assert.equal(fsm.openedByHover, true);
  seconds(600);
  assert.equal(fsm.state, "home");
  assert.deepEqual(transitions, ["hidden>home"]);
});

test("3 s after the pointer leaves, the notch folds back to the closed pill", () => {
  fsm.mouseEntered();
  fsm.mouseLeft();
  seconds(2.9);
  assert.equal(fsm.state, "home");
  seconds(0.1);
  assert.equal(fsm.state, "hidden");
});

test("coming back before the 3 s are up keeps it open", () => {
  fsm.mouseEntered();
  fsm.mouseLeft();
  seconds(2.5);
  fsm.mouseEntered();
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("a click opens the compact island", () => {
  fsm.reveal();
  fsm.click();
  assert.equal(fsm.state, "home");
  fsm.click();
  assert.equal(fsm.state, "home");
  assert.deepEqual(transitions, ["hidden>petit", "petit>home"]);
});

test("#86: a click on the closed pill opens it as a click, even if the hover wake came first", () => {
  fsm.click();
  assert.equal(fsm.state, "home");
  fsm.mouseLeft();
  seconds(4);
  assert.equal(fsm.state, "home", "a click-opened island doesn't fold after the hover's 3 s");
  fsm.forceHidden();
  fsm.mouseEntered();
  fsm.click();
  fsm.mouseLeft();
  seconds(4);
  assert.equal(fsm.state, "home");
});

test("the open island folds 15 s after the mouse leaves", () => {
  fsm.forceHome();
  fsm.mouseLeft();
  seconds(14);
  assert.equal(fsm.state, "home");
  seconds(1);
  assert.equal(fsm.state, "hidden");
});

test("coming back to the open island cancels the collapse", () => {
  fsm.forceHome();
  fsm.mouseLeft();
  seconds(14);
  fsm.mouseEntered();
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("a pinned island stays open when the mouse leaves", () => {
  fsm.forceHome();
  fsm.pinned = true;
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("the collapse delay is the configured one", () => {
  fsm.homeToPetitDelay = 5;
  fsm.forceHome();
  fsm.mouseLeft();
  seconds(5);
  assert.equal(fsm.state, "hidden");
});

test("reveal shows the compact island from hidden and hides it again after 60 s", () => {
  fsm.reveal();
  assert.equal(fsm.state, "petit");
  seconds(60);
  assert.equal(fsm.state, "hidden");
});

test("reveal leaves an island that is already showing alone", () => {
  fsm.forceHome();
  fsm.reveal();
  assert.equal(fsm.state, "home");
  assert.deepEqual(transitions, ["hidden>home"]);
});

test("forcing the island open cancels a pending hide", () => {
  fsm.reveal();
  fsm.forceHome();
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("an explicit close goes to the compact island and cancels the collapse", () => {
  fsm.forceHome();
  fsm.mouseLeft();
  fsm.forcePetit();
  assert.equal(fsm.state, "petit");
  seconds(600);
  assert.equal(fsm.state, "petit");
});

test("forceHidden hides from any state", () => {
  fsm.forceHome();
  fsm.forceHidden();
  assert.equal(fsm.state, "hidden");
});

test("a transition to the current state is not reported", () => {
  fsm.forceHome();
  fsm.forceHome();
  assert.deepEqual(transitions, ["hidden>home"]);
});

// ── Auto-close delay from Settings (IslandAutoCloseTests.swift) ──────────────

/** Opened by a click, the way the Mac tests open theirs. */
function opened(delay) {
  fsm.homeToPetitDelay = delay;
  fsm.reveal();
  fsm.click();
  fsm.mouseEntered();
  assert.equal(fsm.state, "home");
}

test("a configured 2-second delay replaces the default 15 seconds", () => {
  opened(2);
  fsm.mouseLeft();
  seconds(1.9);
  assert.equal(fsm.state, "home");
  seconds(0.1);
  assert.equal(fsm.state, "hidden");
});

test("editing the delay during a countdown replaces its timer", () => {
  opened(15);
  fsm.mouseLeft();
  fsm.homeToPetitDelay = 0.05;
  seconds(0.05);
  assert.equal(fsm.state, "hidden");
});

test("a longer delay also cancels the shorter timer that was running", () => {
  opened(0.05);
  fsm.mouseLeft();
  fsm.homeToPetitDelay = 0.25;
  seconds(0.1);
  assert.equal(fsm.state, "home");
  seconds(0.15);
  assert.equal(fsm.state, "hidden");
});

test("coming back cancels the countdown, and leaving again starts it with the delay", () => {
  opened(0.05);
  fsm.mouseLeft();
  fsm.mouseEntered();
  seconds(0.1);
  assert.equal(fsm.state, "home");
  fsm.mouseLeft();
  seconds(0.05);
  assert.equal(fsm.state, "hidden");
});

test("a delay edit while the island is hovered starts no countdown", () => {
  opened(15);
  fsm.homeToPetitDelay = 0.05;
  seconds(600);
  assert.equal(fsm.state, "home");
  fsm.mouseLeft();
  seconds(0.05);
  assert.equal(fsm.state, "hidden");
});

test("the greeting keeps its own timing whatever the auto-close delay", () => {
  fsm.greetAutoCollapseDelay = 0.15;
  fsm.launch();
  fsm.greetComplete();
  fsm.homeToPetitDelay = 0.01;
  seconds(0.05);
  assert.equal(fsm.state, "coucou");
  seconds(0.1);
  assert.equal(fsm.state, "petit");
});

test("an alert waiting for an answer stays open through a delay edit", () => {
  opened(0.05);
  fsm.pinned = true;
  fsm.mouseLeft();
  fsm.homeToPetitDelay = 0.01;
  seconds(600);
  assert.equal(fsm.state, "home");
  fsm.pinned = false;
  fsm.mouseLeft();
  seconds(0.01);
  assert.equal(fsm.state, "hidden");
});

test("an alert pinned during a countdown blocks the old timer and its replacement", () => {
  opened(0.2);
  fsm.mouseLeft();
  fsm.pinned = true;
  fsm.homeToPetitDelay = 0.01;
  seconds(600);
  assert.equal(fsm.state, "home");
  fsm.pinned = false;
  fsm.mouseLeft();
  seconds(0.01);
  assert.equal(fsm.state, "hidden");
});

test("a pin that arrives after the timer was armed still holds the island", () => {
  opened(1);
  fsm.mouseLeft();
  fsm.pinned = true;
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("the deadline the countdown bar reads follows the delay and clears with the timer", () => {
  opened(15);
  assert.equal(fsm.homeCollapseDueAt, null);
  fsm.mouseLeft();
  const first = fsm.homeCollapseDueAt;
  assert.ok(first != null);
  fsm.homeToPetitDelay = 5;
  assert.ok(fsm.homeCollapseDueAt < first);
  fsm.mouseEntered();
  assert.equal(fsm.homeCollapseDueAt, null);
});

// ── A card folded away while it waits (Mac #290) ─────────────────────────────

test("a folded card keeps the compact island on screen until it is answered", () => {
  fsm.forceHome();
  fsm.pinned = true;
  fsm.forcePetit();
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "petit");
  // Reopening brings it back open, and the mouse leaving does not fold it.
  fsm.mouseEntered();
  fsm.click();
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "home");
  // Answered: the usual timer again, back to the closed pill.
  fsm.pinned = false;
  fsm.mouseLeft();
  seconds(15);
  assert.equal(fsm.state, "hidden");
});

test("an unusable delay is ignored", () => {
  for (const bad of [NaN, -1, Infinity]) fsm.homeToPetitDelay = bad;
  assert.equal(fsm.homeToPetitDelay, 15);
});

// ── Hover (the notch prototype) ───────────────────────────────────────────────

test("hover: opened by the pointer, a click inside makes it an ordinary open island", () => {
  fsm.homeToPetitDelay = 5;
  fsm.mouseEntered();
  fsm.mouseLeft();
  fsm.userInteracted();          // the 3 s countdown becomes the normal one
  seconds(3);
  assert.equal(fsm.state, "home");
  seconds(2);
  assert.equal(fsm.state, "hidden");
});

test("hover: a waiting card holds the island open, the pointer leaving doesn't fold it", () => {
  fsm.pinned = true;
  fsm.mouseEntered();
  assert.equal(fsm.state, "home");
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("hover: an island opened by an alert keeps the normal delay", () => {
  fsm.homeToPetitDelay = 5;
  fsm.forceHome();
  fsm.mouseEntered();
  fsm.mouseLeft();
  seconds(3);
  assert.equal(fsm.state, "home");
  seconds(2);
  assert.equal(fsm.state, "hidden");
});
