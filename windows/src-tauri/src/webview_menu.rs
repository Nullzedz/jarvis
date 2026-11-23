// The island's right-click menu: WebView2's own (Back, Refresh, Save as, Print, Inspect…), with
// one item of JARVIS's own on top when the click was on Home's squares: Edit, which opens that
// square's list.
//
// WebView2 can't ask the page what is under the pointer when it builds its menu, so the page
// says it first: on a right press over a square it calls `context_zone` with the square
// (src/views/views.ts); the menu opens on release, after that. The zone is used once.

use std::sync::Mutex;

#[cfg(windows)]
use tauri::{AppHandle, Emitter};
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment9, ICoreWebView2_11, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
    COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
};
#[cfg(windows)]
use webview2_com::{ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler};
#[cfg(windows)]
use wv2_core::{Interface, HSTRING};

#[cfg(windows)]
use crate::island::{self, WINDOW_LABEL};

/// The square under the last right press on Home, if it was on one.
static ZONE: Mutex<Option<u32>> = Mutex::new(None);

/// The page: the right press that's about to open the menu was on this square (None: elsewhere).
#[tauri::command]
pub fn context_zone(slot: Option<u32>) {
    if let Ok(mut zone) = ZONE.lock() {
        *zone = slot;
    }
}

#[cfg(windows)]
pub fn install(app: &AppHandle) {
    let Some(win) = island::window(app) else { return };
    let handle = app.clone();
    let result = win.with_webview(move |webview| unsafe {
        let core = match webview.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_11>()) {
            Ok(core) => core,
            Err(err) => {
                crate::log::line(format!("context menu: no webview: {err}"));
                return;
            }
        };
        let Ok(env) = webview.environment().cast::<ICoreWebView2Environment9>() else {
            crate::log::line("context menu: webview too old for custom items".to_string());
            return;
        };
        let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let slot = ZONE.lock().ok().and_then(|mut z| z.take());
            let Some(slot) = slot else { return Ok(()) };
            let items = args.MenuItems()?;
            let edit = env.CreateContextMenuItem(
                &HSTRING::from(crate::i18n::t("Edit")),
                None,
                COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
            )?;
            let line = env.CreateContextMenuItem(&HSTRING::new(), None, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR)?;
            let app = handle.clone();
            let picked = CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                let _ = app.emit_to(WINDOW_LABEL, "home-edit", slot);
                Ok(())
            }));
            let mut token = 0i64;
            edit.add_CustomItemSelected(&picked, &mut token)?;
            items.InsertValueAtIndex(0, &line)?;
            items.InsertValueAtIndex(0, &edit)?;
            Ok(())
        }));
        let mut token = 0i64;
        if let Err(err) = core.add_ContextMenuRequested(&handler, &mut token) {
            crate::log::line(format!("context menu: cannot listen: {err}"));
        }
    });
    if let Err(err) = result {
        crate::log::line(format!("context menu: {err}"));
    }
}
