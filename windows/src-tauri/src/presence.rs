// JARVIS: what he notices about you without you asking (step 6 of #22).
//
// - How long the PC has had no keyboard or mouse input: his idle life (src/island/idle.ts)
//   plays, then winds down, from it.
// - Whether anything plays music in Windows' media panel (Spotify, Apple Music, a browser…):
//   he dances while it does. A light check every 2 s, an event only when it changes.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

static MUSIC: AtomicBool = AtomicBool::new(false);

/// Seconds since the last keyboard or mouse input anywhere on the PC.
#[tauri::command]
pub fn user_idle_seconds() -> f64 {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::SystemInformation::GetTickCount;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if GetLastInputInfo(&mut info).as_bool() {
            return GetTickCount().wrapping_sub(info.dwTime) as f64 / 1000.0;
        }
    }
    0.0
}

/// Whether music plays right now (as last checked).
#[tauri::command]
pub fn music_playing() -> bool {
    MUSIC.load(Ordering::Relaxed)
}

pub fn setup(app: &AppHandle) {
    #[cfg(windows)]
    {
        let app = app.clone();
        std::thread::spawn(move || loop {
            let now = any_playing();
            if MUSIC.swap(now, Ordering::Relaxed) != now {
                let _ = app.emit("music-playing", now);
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        });
    }
    #[cfg(not(windows))]
    let _ = app;
}

/// Any media session in Windows' media panel that is playing.
#[cfg(windows)]
fn any_playing() -> bool {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    let Ok(manager) = Manager::RequestAsync().and_then(|op| op.get()) else { return false };
    let Ok(sessions) = manager.GetSessions() else { return false };
    let count = sessions.Size().unwrap_or(0);
    (0..count).filter_map(|i| sessions.GetAt(i).ok()).any(|s| {
        s.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).is_ok_and(|st| st == Status::Playing)
    })
}
