// JARVIS: Home's Agents widget (step 2 of #57, prototypes/jarvis-agents-widget.html design A):
// a one-line summary, then a row per agent (his small visor with its eye in the agent's state
// colour, the project, what it does, how long). One asking you rises to the top in a soft orange
// band with its command and Deny / Allow. The rows come from the island (island/share-agents.ts).

import { h, clear } from "../views/dom";
import { t } from "../i18n/i18n";
import { emitToWindow, onEvent } from "../core/bridge";
import { visor } from "../theme/theme";
import {
  AGENTS_SNAPSHOT, AGENTS_WANTED, AGENT_DECIDE, AGENT_SHOW, agentEye, minutesBetween, rankRows, rowCounts, type AgentRow,
} from "../core/agents";

/** Rows shown under the summary: four, or two under an agent asking you (its band is taller). */
const ROWS = 4, ROWS_UNDER_ASK = 2;

function face(row: AgentRow, width: number): HTMLElement {
  const v = visor(width);
  v.style.setProperty("--eye", agentEye(row.state));
  if (row.state === "finished" || row.state === "idle") v.classList.add("rest");
  return v;
}

const quiet = (e: Event) => e.stopPropagation();

/** Draws the rows into `el` (the widget's whole inside). */
export function renderAgents(el: HTMLElement, rows: readonly AgentRow[], now = Date.now()) {
  clear(el);
  if (rows.length === 0) {
    const empty = h("div", { class: "jv-ag-empty" },
      visor(64, "sleeping"),
      h("p", { class: "t", text: t("No agents running") }),
      h("p", { class: "d", text: t("Start a Claude Code session and it shows up here.") }),
      h("button", { class: "jv-pill", text: t("New session"), onclick: (e: Event) => { quiet(e); void emitToWindow("island", AGENT_SHOW, "launch"); } }));
    el.append(empty);
    return;
  }
  const ranked = rankRows(rows);
  const n = rowCounts(ranked);
  const sum = h("p", { class: "jv-ag-sum" });
  const parts: HTMLElement[] = [];
  if (n.asking) parts.push(h("b", { class: "ask", text: t("{n} needs you", { n: n.asking }) }));
  if (n.working) parts.push(h("b", { text: t("{n} working", { n: n.working }) }));
  if (n.done) parts.push(h("span", { text: t("{n} done", { n: n.done }) }));
  parts.forEach((p, i) => { if (i) sum.append(document.createTextNode(" · ")); sum.append(p); });
  el.append(sum);

  const asking = ranked[0]?.ask ? ranked[0] : null;
  if (asking && asking.ask) {
    const ask = asking.ask;
    const band = h("div", { class: "jv-ag-band" },
      h("div", { class: "top" }, face(asking, 34),
        h("div", { class: "x" }, h("p", { class: "t", text: asking.title }),
          h("p", { class: "d", text: ask.question ? t("{app} has a question", { app: asking.app }) : `${asking.app} · ${t("wants to run a command")}` })),
        h("span", { class: "st", text: t("Needs you") })));
    if (ask.question) {
      band.append(h("div", { class: "acts" },
        h("button", { class: "jv-pill blue", text: t("Answer"), onclick: (e: Event) => { quiet(e); void emitToWindow("island", AGENT_SHOW, "question"); } })));
    } else {
      const decide = (d: "allow" | "deny") => (e: Event) => {
        quiet(e);
        void emitToWindow("island", AGENT_DECIDE, { requestId: ask.requestId, d });
      };
      band.append(h("p", { class: "cmd", text: ask.command }),
        h("div", { class: "acts" },
          h("button", { class: "jv-pill", text: t("Deny"), onclick: decide("deny") }),
          h("button", { class: "jv-pill blue", text: t("Allow"), onclick: decide("allow") })));
    }
    band.addEventListener("keydown", quiet);
    el.append(band);
  }
  const rest = ranked.filter((r) => r !== asking);
  const max = asking ? ROWS_UNDER_ASK : ROWS;
  for (const r of rest.slice(0, max)) {
    const mins = minutesBetween(r.since, now);
    const line = r.state === "finished"
      ? t("done {n} min ago", { n: mins })
      : r.doing ?? (r.state === "idle" ? t("Ready") : t("Working"));
    el.append(h("div", { class: "jv-ag-row" }, face(r, 30),
      h("div", { class: "x" }, h("p", { class: "t", text: r.title }), h("p", { class: "d", text: line })),
      r.state === "finished" || r.state === "idle" ? h("span") : h("span", { class: "m", text: mins < 1 ? t("just now") : t("{n} min", { n: mins }) })));
  }
  if (rest.length > max) el.append(h("p", { class: "jv-ag-more", text: t("+ {n} more", { n: rest.length - max }) }));
}

/** Fills `body` and keeps it current; returns a function that stops it. */
export function agentsWidget(body: HTMLElement): () => void {
  let rows: AgentRow[] = [];
  const el = h("div", { class: "jv-ag" });
  body.append(el);
  const draw = () => renderAgents(el, rows);

  draw();
  const off = onEvent<AgentRow[]>(AGENTS_SNAPSHOT, (r) => { rows = Array.isArray(r) ? r : []; draw(); });
  void emitToWindow("island", AGENTS_WANTED);
  // "4 min" moves on with the clock.
  const tick = window.setInterval(draw, 30_000);
  return () => {
    window.clearInterval(tick);
    void off.then((f) => f());
  };
}
