// The Flow pages of the Coucou window, by id (shell.ts draws the Notch ones
// from the island's settings).

import type { FlowPageRenderer, PageId } from "./shell";
import { insightsPage } from "./pages/insights";
import { dictionaryPage, snippetsPage } from "./pages/words";
import { stylesPage } from "./pages/styles";
import { flowSettingsPage } from "./pages/flowsettings";
import { voicePage } from "./pages/voice";
import { mailHomePage } from "./pages/mail-home";
import { mailOverviewPage } from "./pages/mail";

import { sessionsPage } from "./pages/sessions";
import { talkPage } from "./pages/talk";
import { dictationHomePage } from "./pages/dictation-home";
import { notetakerPage } from "./pages/notetaker";
import { prefsPage } from "./pages/prefs";
import { connectionsPage } from "./pages/connections";

export const FLOW_PAGE_RENDERERS: Partial<Record<PageId, FlowPageRenderer>> = {
  dictation: dictationHomePage,
  notes: notetakerPage,
  insights: insightsPage,
  dictionary: dictionaryPage,
  snippets: snippetsPage,
  styles: stylesPage,
  flowsettings: flowSettingsPage,
  voice: voicePage,
  mail: mailHomePage,
  mailOverview: mailOverviewPage,
  sessions: sessionsPage,
  talk: talkPage,
  prefs: prefsPage,
  integrations: connectionsPage,
};
