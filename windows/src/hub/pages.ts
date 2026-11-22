// The Flow pages of the Coucou window, by id (shell.ts draws the Notch ones
// from the island's settings).

import type { FlowPageRenderer, PageId } from "./shell";
import { insightsPage } from "./pages/insights";
import { dictionaryPage, snippetsPage } from "./pages/words";
import { stylesPage } from "./pages/styles";
import { flowSettingsPage } from "./pages/flowsettings";
import { voicePage } from "./pages/voice";
import { mailBannedPage, mailOverviewPage, mailRulesPage, mailVIPPage } from "./pages/mail";

import { sessionsPage } from "./pages/sessions";
import { talkPage } from "./pages/talk";
import { dictationHomePage } from "./pages/dictation-home";
import { notetakerPage } from "./pages/notetaker";
import { prefsPage } from "./pages/prefs";

export const FLOW_PAGE_RENDERERS: Partial<Record<PageId, FlowPageRenderer>> = {
  dictation: dictationHomePage,
  notes: notetakerPage,
  insights: insightsPage,
  dictionary: dictionaryPage,
  snippets: snippetsPage,
  styles: stylesPage,
  flowsettings: flowSettingsPage,
  voice: voicePage,
  mailOverview: mailOverviewPage,
  mailRules: mailRulesPage,
  mailBanned: mailBannedPage,
  mailVIP: mailVIPPage,
  sessions: sessionsPage,
  talk: talkPage,
  prefs: prefsPage,
};
