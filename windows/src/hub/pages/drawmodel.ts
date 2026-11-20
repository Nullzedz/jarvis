// JARVIS: who draws his windows (issue #14), on the Voice page under « Windows ».
// Four cards (design B): Haiku, Sonnet, Opus, Other. Other opens a search list
// (design C) of the AIs signed in with the user's own account, like Claude Code:
// ChatGPT through the Codex app, Gemini through the Gemini CLI. One that isn't
// installed and signed in is shown greyed out.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { Bridge, type DrawModel } from "../../core/bridge";
import type { FlowPrefs } from "../../core/flow";
import type { HubContext } from "../shell";
import { icon } from "../ui";

const CARDS: { id: string; name: string; icon: string; chips: () => string[] }[] = [
  { id: "claude:claude-haiku-4-5", name: "Haiku", icon: "bolt", chips: () => [t("about 3 s"), t("simple")] },
  { id: "claude:claude-sonnet-5-5", name: "Sonnet", icon: "sliders", chips: () => [t("about 8 s"), t("clean")] },
  { id: "claude:claude-opus-5-5", name: "Opus", icon: "star", chips: () => [t("about 20 s"), t("best")] },
];
const MAKERS: Record<DrawModel["maker"], string> = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };

export function drawModelCards(ctx: HubContext, prefs: FlowPrefs): HTMLElement {
  const box = h("div", { class: "hub-card jv-draw" });
  let picked = prefs.drawModel || "claude:claude-sonnet-5-5";
  let otherOpen = !CARDS.some((c) => c.id === picked);
  let models: DrawModel[] = [];
  let query = "";

  const save = (id: string) => {
    picked = id;
    void ctx.setPrefs((p) => (p.drawModel = id));
    draw();
  };

  const chip = (text: string) => h("span", { class: "jv-chip", text });

  function list(): HTMLElement {
    const wrap = h("div", { class: "jv-other" });
    const search = h("input", { class: "hub-input", type: "search", placeholder: t("Search models"), value: query, spellcheck: "false" }) as HTMLInputElement;
    const rows = h("div", { class: "jv-models" });
    const fillRows = () => {
      clear(rows);
      const q = query.trim().toLowerCase();
      const shown = models.filter((m) => m.maker !== "claude" && `${m.name} ${MAKERS[m.maker]}`.toLowerCase().includes(q));
      if (!shown.length) rows.append(h("div", { class: "hub-note", text: models.length ? t("No model matches.") : t("Looking…") }));
      for (const m of shown) {
        const row = h("button", { class: `jv-model${m.id === picked ? " on" : ""}`, disabled: !m.ready });
        row.append(
          h("span", { class: "jv-model-name" }, m.id === picked ? icon("check") : h("span", { class: "jv-gap" }), h("span", { text: m.name })),
          h("span", { class: "jv-model-note", text: `${MAKERS[m.maker]} · ${m.ready ? t("signed in") : t("install and sign in first")}` }),
        );
        if (m.ready) row.addEventListener("click", () => save(m.id));
        rows.append(row);
      }
    };
    search.addEventListener("input", () => {
      query = search.value;
      fillRows();
    });
    fillRows();
    wrap.append(search, rows);
    return wrap;
  }

  function draw() {
    clear(box);
    box.append(
      h("div", { class: "title", text: t("Drawing model") }),
      h("div", { class: "hub-note", text: t("Who draws his windows. He still answers out loud at once.") }),
    );
    const grid = h("div", { class: "jv-tiles jv-draw-cards" });
    for (const c of CARDS) {
      const on = !otherOpen && picked === c.id;
      const tile = h("button", { class: `jv-tile${on ? " on" : ""}` }, h("span", { class: "jv-icon" }, icon(c.icon)), h("span", { class: "jv-name", text: c.name }), h("span", { class: "jv-chips" }, ...c.chips().map(chip)));
      tile.addEventListener("click", () => {
        otherOpen = false;
        save(c.id);
      });
      grid.append(tile);
    }
    const otherName = otherOpen ? models.find((m) => m.id === picked)?.name : undefined;
    const other = h("button", { class: `jv-tile${otherOpen ? " on" : ""}` }, h("span", { class: "jv-icon" }, icon("grid")), h("span", { class: "jv-name", text: t("Other") }), h("span", { class: "jv-chips" }, chip(otherName ?? t("your sign-in"))));
    other.addEventListener("click", () => {
      otherOpen = true;
      draw();
    });
    grid.append(other);
    box.append(grid);
    if (otherOpen) box.append(list());
  }

  draw();
  void Bridge.drawModels().then((m) => {
    models = m ?? [];
    draw();
  });
  return box;
}
