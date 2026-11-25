// JARVIS (#104): your profile, the first tab of Settings, one to one with design A of
// prototypes/jarvis-profile.html: a cover with your photo, then each row with its label and
// hint on the left and its field on the right. Name, how he calls you, your photo, about you
// (he keeps it in mind), location and time zone, your passkey, your AI.

import { h, clear } from "../../views/dom";
import { t, setAddress, titleFor } from "../../i18n/i18n";
import { Bridge, onEvent, type Profile, type SubscriptionStatus } from "../../core/bridge";
import { button, segmented } from "../ui";
import type { HubContext } from "../shell";

/** Your photo, or the default one (soft colour), as a round or rounded-square spot. */
export function photo(src: string | null | undefined, cls = ""): HTMLElement {
  const el = h("span", { class: `jv-pfp ${cls}`.trim() });
  if (src) el.style.backgroundImage = `url("${src}")`;
  return el;
}

/** A picture you picked, made 256 px square (its middle) and a JPEG: small enough to keep. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return c.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const AIS: [string, string, string, () => string][] = [
  ["google", "Gemini", "G", () => t("Free works: about 1,000 requests a day with a Google account.")],
  ["openai", "ChatGPT", "C", () => t("Free works, with smaller limits. Plus or Pro for more.")],
  ["anthropic", "Claude", "A", () => t("Needs Pro or Max: a free account can't be used here.")],
];

/** Where you are: the time zone Windows uses, and its offset from UTC. */
function zone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -new Date().getTimezoneOffset();
  const hh = Math.trunc(Math.abs(off) / 60), mm = Math.abs(off) % 60;
  return `${tz.replace(/_/g, " ")} (UTC ${off < 0 ? "−" : "+"}${hh}${mm ? `:${String(mm).padStart(2, "0")}` : ""})`;
}

export async function profilePage(page: HTMLElement, _ctx: HubContext) {
  let me: Profile = (await Bridge.profileGet()) ?? { name: "", address: "", about: "", photo: null, passkey: false };
  const body = h("div", { class: "jv-profile" });
  page.append(body);

  const save = async () => {
    await Bridge.profileSave(me.name, me.address || "sir", me.about);
    setAddress(titleFor(me.address, me.name));
  };
  let typing = 0;
  const saveSoon = () => { window.clearTimeout(typing); typing = window.setTimeout(() => void save(), 500); };

  const row = (title: string, hint: string, ...field: HTMLElement[]) =>
    h("div", { class: "pr-row" }, h("div", { class: "l" }, h("b", { text: title }), h("span", { text: hint })), h("div", { class: "f" }, ...field));

  function draw() {
    clear(body);
    // The cover, with your photo.
    body.append(h("div", { class: "pr-cover" }, photo(me.photo, "sq big")));
    body.append(h("h1", { class: "pr-h", text: t("Your profile") }), h("p", { class: "pr-sub", text: t("What JARVIS knows about you. It stays on this PC.") }));

    const name = h("input", { class: "pr-input", value: me.name, maxlength: "60", "aria-label": t("Name"), autocomplete: "off" }) as HTMLInputElement;
    name.addEventListener("input", () => { me.name = name.value; saveSoon(); });
    body.append(row(t("Name"), t("What he calls you by."), name));

    body.append(row(t("He calls you"), t("In what he says and writes."),
      segmented<string>([["sir", t("Sir")], ["maam", t("Ma'am")], ["name", t("By my name")]], me.address || "sir", (v) => { me.address = v; void save(); })));

    // Your photo: a picture of yours, or back to the default.
    const pick = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: "" }) as HTMLInputElement;
    pick.addEventListener("change", async () => {
      const f = pick.files?.[0];
      if (!f) return;
      await Bridge.profilePhotoSet(await shrink(f));
    });
    const acts = h("div", { class: "pr-acts" }, button(t("Upload new photo"), () => pick.click()));
    if (me.photo) acts.append(button(t("Use the default"), () => void Bridge.profilePhotoSet(null), "danger"));
    body.append(row(t("Profile photo"), t("Shown in the sidebar."), h("div", { class: "pr-photo" }, photo(me.photo, "sq"), acts, pick)));

    const about = h("textarea", { class: "pr-input pr-area", maxlength: "600", "aria-label": t("About you") }) as HTMLTextAreaElement;
    about.value = me.about;
    about.addEventListener("input", () => { me.about = about.value; saveSoon(); });
    body.append(row(t("About you"), t("A few lines he keeps in mind when he answers."), about));

    body.append(row(t("Location & time zone"), t("Follows Windows."), h("div", { class: "pr-input pr-static", text: zone() })));

    body.append(row(t("Passkey"), t("Six digits only you know. Keep it safe: it can't be recovered if you forget it."), passkey()));

    const ai = h("div", { class: "pr-ais" });
    body.append(row(t("Your AI"), t("The plans he searches and answers through."), ai));
    void drawAi(ai);
  }

  /** ●●●●●● and Change: your passkey now (if there is one), then the new one twice. */
  function passkey(): HTMLElement {
    const box = h("div", { class: "pr-pk" });
    const shown = () => {
      clear(box);
      box.append(h("span", { class: "pr-dots", text: me.passkey ? "••••••" : "—" }), button(me.passkey ? t("Change") : t("Set"), ask));
    };
    const ask = () => {
      clear(box);
      const steps = me.passkey ? [t("Current passkey"), t("New passkey"), t("Type it once more.")] : [t("New passkey"), t("Type it once more.")];
      let at = 0, fresh = "";
      const inp = h("input", { class: "pr-input pr-pin", type: "password", inputmode: "numeric", maxlength: "6", autocomplete: "off" }) as HTMLInputElement;
      const msg = h("span", { class: "pr-msg", text: steps[0] });
      inp.setAttribute("aria-label", steps[0]);
      inp.addEventListener("input", async () => {
        inp.value = inp.value.replace(/\D/g, "").slice(0, 6);
        if (inp.value.length < 6) return;
        const v = inp.value;
        inp.value = "";
        const step = steps[at];
        if (step === t("Current passkey")) {
          if (!(await Bridge.passkeyCheck(v))) { msg.textContent = t("Wrong passkey."); msg.className = "pr-msg bad"; return; }
        } else if (step === t("New passkey")) {
          fresh = v;
        } else if (v !== fresh) {
          at = steps.indexOf(t("New passkey"));
          msg.textContent = t("They didn't match. Choose it again."); msg.className = "pr-msg bad";
          inp.setAttribute("aria-label", steps[at]);
          return;
        } else {
          await Bridge.passkeySet(v);
          me.passkey = true;
          shown();
          box.append(h("span", { class: "pr-msg ok", text: t("Passkey set.") }));
          return;
        }
        at += 1;
        msg.textContent = steps[at]; msg.className = "pr-msg";
        inp.setAttribute("aria-label", steps[at]);
      });
      box.append(inp, msg, button(t("Cancel"), shown));
      inp.focus();
    };
    shown();
    return box;
  }

  async function drawAi(el: HTMLElement) {
    const rows: SubscriptionStatus[] = (await Bridge.subscriptionStatus()) ?? [];
    clear(el);
    for (const [provider, name, mark, what] of AIS) {
      const st = rows.find((r) => r.provider === provider);
      const end = st?.on && st.installed
        ? h("span", { class: "pr-state on", text: t("On") })
        : button(t("Sign in"), async () => {
            const how = await Bridge.subscriptionSignIn(provider);
            note.textContent = how === "install" ? t("Install it, then come back.") : t("A terminal opened: sign in there.");
            void drawAi(el);
          });
      const note = h("span", { text: what() });
      el.append(h("div", { class: "pr-ai" }, h("span", { class: "mark", text: mark }), h("span", { class: "who" }, h("b", { text: name }), note), end));
    }
  }

  draw();
  // A new photo (or the default again), from here or anywhere: redrawn.
  const stop = await onEvent("profile-changed", async () => {
    const next = await Bridge.profileGet();
    if (!next) return;
    const photoChanged = next.photo !== me.photo;
    me = { ...me, photo: next.photo, passkey: next.passkey };
    if (photoChanged) draw();
  });
  _ctx.onLeave = () => { window.clearTimeout(typing); void save(); stop?.(); };
}
