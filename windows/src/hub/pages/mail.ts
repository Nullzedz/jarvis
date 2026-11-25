// The Mail section's Sorting tab (classic Outlook), design A of #74: the automatic sorting's
// switch, today's counts, one row each for the VIPs, the banned words, the rules and what
// JARVIS sent (each opens its own page, ‹ Sorting), then the journal with Undo. Port of
// MailHubPages.swift; what they decide lives in src-tauri/src/mail/triage.rs.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import {
  MAIL_FIELDS, MailBridge, fieldTitle, journalLine, nameOf, reasonLine, ruleLine, ruleName,
  type MailAction, type MailField, type MailSettings, type TriageView,
} from "../../core/mail";
import type { HubContext } from "../shell";

const EMPTY: TriageView = {
  settings: { autoSort: false, autoSortSince: null, banned: [], vip: [], rules: [] },
  journal: [], sent: [], today: { sorted: 0, junk: 0, important: 0 }, windows: true, outlookOpen: false,
};

async function load(): Promise<TriageView> {
  return (await MailBridge.triage()) ?? EMPTY;
}

function save(settings: MailSettings) {
  void MailBridge.setTriage(settings);
}

function input(placeholder: string, onEnter?: () => void): HTMLInputElement {
  const el = h("input", { class: "jv-sinput", placeholder }) as HTMLInputElement;
  if (onEnter) el.addEventListener("keydown", (e) => e.key === "Enter" && onEnter());
  return el;
}

function choose<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const el = h("select", { class: "jv-sselect" }) as HTMLSelectElement;
  for (const [v, label] of options) el.append(h("option", { value: v, text: label }));
  el.value = value;
  el.addEventListener("change", () => onChange(el.value as T));
  return el;
}

function switchEl(on: boolean, onChange: (v: boolean) => void, label: string): HTMLElement {
  const sw = h("span", { class: `jv-switch${on ? " on" : ""}` }, h("i"));
  const b = h("button", { class: "jv-sswitch", role: "switch", "aria-checked": String(on), "aria-label": label }, sw);
  b.addEventListener("click", () => {
    const next = !sw.classList.contains("on");
    sw.classList.toggle("on", next);
    b.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return b;
}

function time(ms: number, withDay = false): string {
  try {
    return new Intl.DateTimeFormat(document.documentElement.lang || undefined, withDay
      ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
}

const card = (...kids: (HTMLElement | null)[]) => h("div", { class: "jv-scard" }, ...kids.filter((k): k is HTMLElement => !!k));
const empty = (text: string) => h("p", { class: "jv-sempty", text });

type Kind = "junk" | "important" | "read" | "move";

export async function mailOverviewPage(page: HTMLElement, ctx: HubContext) {
  const view = await load();
  const root = h("div", { class: "jv-msort" });
  // Removing says what went, with Undo for a few seconds (#84).
  const toast = h("div", { class: "jv-toast", role: "status" });
  let toastAt = 0;
  const removed = (what: string, undo: () => void) => {
    clear(toast);
    toast.append(h("span", { text: t("Removed “{0}”", { 0: what }) }),
      h("button", { class: "jv-link", text: t("Undo"), onclick: () => { toast.classList.remove("on"); undo(); } }));
    toast.classList.add("on");
    window.clearTimeout(toastAt);
    toastAt = window.setTimeout(() => toast.classList.remove("on"), 6000);
  };
  page.append(root, toast);
  const scroller = () => page.closest(".hub-scroll") as HTMLElement | null;
  let scrollBack = 0;

  /** When the automatic sorting is off, the pages that feed it say so, with the switch. */
  const offHint = (): HTMLElement | null => {
    if (view.settings.autoSort) return null;
    const hint = card(h("div", { class: "jv-srow" },
      h("div", { class: "lbl" }, h("span", { text: t("Automatic sorting is off: these settings do nothing until it is on.") })),
      h("button", { class: "jv-chipbtn", text: t("Turn on"), onclick: () => {
        view.settings = { ...view.settings, autoSort: true };
        save(view.settings);
        hint.remove();
      } })));
    return hint;
  };

  // ── A row's own page ──
  const drill = (title: string, say: string | null, body: () => HTMLElement[]) => {
    scrollBack = scroller()?.scrollTop ?? 0;
    clear(root);
    root.append(h("button", { class: "back", text: `‹ ${t("Sorting")}`, onclick: () => {
      drawMain();
      requestAnimationFrame(() => { const s = scroller(); if (s) s.scrollTop = scrollBack; });
    } }), h("p", { class: "jv-ptitle", text: title }));
    if (say) root.append(h("p", { class: "jv-psay", text: say }));
    root.append(...body());
    const s = scroller();
    if (s) s.scrollTop = 0;
  };

  const chips = (key: "banned" | "vip", placeholder: string, emptyText: string) => (): HTMLElement[] => {
    const box = h("div", { class: "jv-schips" });
    const field = input(placeholder, () => add());
    const addBtn = h("button", { class: "jv-chipbtn primary", text: t("Add"), disabled: true, onclick: () => add() }) as HTMLButtonElement;
    const valid = () => {
      const w = field.value.trim();
      return !!w && !view.settings[key].some((x) => x.toLowerCase() === w.toLowerCase());
    };
    field.addEventListener("input", () => { addBtn.disabled = !valid(); });
    const add = () => {
      const w = field.value.trim();
      const list = view.settings[key];
      if (!w || list.some((x) => x.toLowerCase() === w.toLowerCase())) return;
      view.settings = { ...view.settings, [key]: [...list, w] };
      save(view.settings);
      field.value = "";
      addBtn.disabled = true;
      draw();
    };
    const draw = () => {
      clear(box);
      const list = view.settings[key];
      if (!list.length) { box.append(empty(emptyText)); return; }
      for (const w of list) {
        box.append(h("span", { class: "jv-schip" }, h("span", { text: w }),
          h("button", { "aria-label": t("Delete {0}", { 0: w }), title: t("Delete"), text: "×", onclick: () => {
            const before = view.settings[key];
            view.settings = { ...view.settings, [key]: before.filter((x) => x !== w) };
            save(view.settings);
            draw();
            removed(w, () => { view.settings = { ...view.settings, [key]: before }; save(view.settings); draw(); });
          } })));
      }
    };
    draw();
    return [offHint(), card(h("div", { class: "jv-sadd" }, field, addBtn), box)]
      .filter((x): x is HTMLElement => !!x);
  };

  const rules = (): HTMLElement[] => {
    let field: MailField = "sender";
    let kind: Kind = "junk";
    const value = input(t("newsletter, @shop.com, invoice…"), () => add());
    const mailbox = input(t("Mailbox name"), () => add());
    mailbox.style.display = "none";
    const action = (): MailAction | null => {
      switch (kind) {
        case "junk": return { kind: "junk" };
        case "important": return { kind: "important" };
        case "read": return { kind: "markRead" };
        case "move": return mailbox.value.trim() ? { kind: "move", mailbox: mailbox.value.trim() } : null;
      }
    };
    const list = h("div");
    const addBtn = h("button", { class: "jv-chipbtn primary", text: t("Add"), disabled: true, onclick: () => add() }) as HTMLButtonElement;
    const check = () => { addBtn.disabled = !value.value.trim() || !action(); };
    value.addEventListener("input", check);
    mailbox.addEventListener("input", check);
    const add = () => {
      const v = value.value.trim();
      const a = action();
      if (!v || !a) return;
      view.settings = { ...view.settings, rules: [...view.settings.rules, {
        id: `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`,
        name: ruleName(field, v, a), enabled: true, conditions: [{ field, value: v }], action: a,
      }] };
      save(view.settings);
      value.value = "";
      mailbox.value = "";
      check();
      draw();
    };
    const draw = () => {
      clear(list);
      if (!view.settings.rules.length) { list.append(empty(t("No rules yet. Example: if the sender contains “newsletter”, move to Junk."))); return; }
      for (const r of view.settings.rules) {
        list.append(h("div", { class: "jv-srow" },
          switchEl(r.enabled, (on) => {
            view.settings = { ...view.settings, rules: view.settings.rules.map((x) => (x.id === r.id ? { ...x, enabled: on } : x)) };
            save(view.settings);
          }, r.name),
          h("span", { class: "grow", text: r.name }),
          h("button", { class: "jv-chipbtn danger", text: t("Delete"), onclick: () => {
            const before = view.settings.rules;
            view.settings = { ...view.settings, rules: before.filter((x) => x.id !== r.id) };
            save(view.settings);
            draw();
            removed(r.name, () => { view.settings = { ...view.settings, rules: before }; save(view.settings); draw(); });
          } })));
      }
    };
    draw();
    const form = card(
      h("div", { class: "jv-sadd" }, h("b", { class: "if", text: t("If") }),
        choose(MAIL_FIELDS.map((f) => [f, fieldTitle(f)] as [MailField, string]), field, (f) => (field = f)),
        h("span", { class: "cap", text: t("contains") }), value),
      h("div", { class: "jv-sadd" }, h("b", { class: "if", text: t("Then") }),
        choose<Kind>([
          ["junk", ruleLine({ kind: "junk" })],
          ["important", ruleLine({ kind: "important" })],
          ["read", ruleLine({ kind: "markRead" })],
          ["move", t("Move to mailbox…")],
        ], kind, (k) => { kind = k; mailbox.style.display = k === "move" ? "" : "none"; check(); }),
        mailbox, h("span", { class: "grow" }), addBtn));
    return [offHint(), form, card(list)].filter((x): x is HTMLElement => !!x);
  };

  const sent = (): HTMLElement[] => {
    if (!view.sent.length) return [card(empty(t("Nothing sent yet.")))];
    return [card(...view.sent.map((e) => h("div", { class: "jv-srow" },
      h("div", { class: "grow" }, h("b", { text: e.to.join(", ") }), h("p", { class: "cap", text: e.subject + (e.attachments.length ? ` · ${e.attachments.join(", ")}` : "") })),
      h("span", { class: "cap", text: time(e.date, true) }))))];
  };

  // ── The page ──
  const drawMain = () => {
    clear(root);
    const sw = card(h("div", { class: "jv-srow" },
      h("div", { class: "lbl grow" }, h("b", { text: t("Sort new messages automatically") }),
        h("span", { text: t("JARVIS sorts your Outlook inboxes: VIPs first, then banned words, then your rules. It never deletes a message.") }),
        h("span", { text: t("Only messages that arrive from now on, in every Outlook account. The classic Outlook must be open.") })),
      switchEl(view.settings.autoSort, (on) => { view.settings = { ...view.settings, autoSort: on }; save(view.settings); }, t("Sort new messages automatically"))));
    if (!view.windows) sw.append(h("p", { class: "jv-snote", text: t("Outlook is only reached on Windows.") }));
    else if (!view.outlookOpen) sw.append(h("p", { class: "jv-snote", text: t("Outlook is closed: nothing is sorted until it is open.") }));
    sw.dataset.anchor = "mail.autosort";

    const stat = (v: number, label: string, color: string) =>
      h("div", { class: "jv-sstat" }, h("span", { class: "n", style: `color:${color}`, text: String(v) }), h("span", { class: "cap", text: label }));
    const stats = h("div", { class: "jv-sstats" },
      stat(view.today.sorted, t("sorted today"), "#0a84ff"),
      stat(view.today.junk, t("sent to Junk"), "#8e939c"),
      stat(view.today.important, t("marked important"), "#ff9f0a"));

    const row = (title: string, count: number, anchor: string | null, open: () => void) => {
      const r = h("button", { class: "jv-sdrill", onclick: open }, h("b", { text: title }), h("span", { class: "cap", text: `${count} ›` }));
      if (anchor) r.dataset.anchor = anchor;
      return r;
    };
    const groups = card(
      row(t("VIP"), view.settings.vip.length, "mail.vip", () => drill(t("VIP"),
        t("Messages from these addresses or domains are always flagged important, and no rule ever moves them."),
        chips("vip", t("paul@client.com or @client.com"), t("No VIPs yet. Add an address, or a whole domain with @.")))),
      row(t("Banned words"), view.settings.banned.length, "mail.banned", () => drill(t("Banned words"),
        t("A message whose sender, subject or text holds one of these words or addresses goes straight to Junk. Whole words only: “sale” does not catch “Salesforce”."),
        chips("banned", t("A word, a phrase or an address"), t("No banned words. Add a word, or click “Always ignore this sender” on a message in the island.")))),
      row(t("Rules"), view.settings.rules.length, "mail.rules", () => drill(t("Rules"),
        t("If a message matches, JARVIS does the action. The first rule that matches wins; VIPs and banned words come before."), rules)),
      row(t("Sent by JARVIS"), view.sent.length, null, () => drill(t("Sent by JARVIS"), null, sent)));
    groups.classList.add("list");

    const head = h("div", { class: "jv-srow head" }, h("span", { class: "cap grow", text: t("Journal") }));
    if (view.journal.length) {
      const ask = h("button", { class: "jv-chipbtn", text: t("Clear") });
      ask.addEventListener("click", () => {
        ask.replaceWith(h("span", { class: "jv-sconfirm" },
          h("span", { class: "cap", text: t("Clear the journal? Its Undo goes with it.") }),
          h("button", { class: "jv-chipbtn danger", text: t("Clear"), onclick: () => void MailBridge.clearJournal().then(() => { view.journal = []; drawMain(); }) }),
          h("button", { class: "jv-chipbtn", text: t("Keep"), onclick: () => drawMain() })));
      });
      head.append(ask);
    }
    const journal = card(head);
    if (!view.journal.length) journal.append(empty(t("Nothing sorted yet. What JARVIS does to your messages shows up here, with an Undo.")));
    for (const e of view.journal) {
      journal.append(h("div", { class: "jv-srow line" },
        h("div", { class: "grow" },
          h("p", {}, h("b", { text: nameOf(e.sender) }), h("span", { class: "dim", text: `  ${e.subject}` })),
          h("p", { class: "cap", text: `${journalLine(e.action)} · ${reasonLine(e.reason)}` })),
        h("span", { class: "cap", text: time(e.date) }),
        e.undone ? h("span", { class: "cap", text: t("Undone") })
          : h("button", { class: "jv-slink", text: t("Undo"), onclick: () => void MailBridge.undo(e.id).then(async () => { Object.assign(view, await load()); drawMain(); }) })));
    }
    root.append(sw, stats, groups, journal);
  };
  drawMain();
  void ctx;
}
