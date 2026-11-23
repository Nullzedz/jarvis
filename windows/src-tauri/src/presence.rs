// JARVIS: what he notices about you without you asking (step 6 of #22).
//
// - How long the PC has had no keyboard or mouse input: his idle life (src/island/idle.ts)
//   plays, then winds down, from it.
// - What a music app plays in Windows' media panel (Apple Music, Spotify, TIDAL…; never a
//   browser or a video player): he dances while it plays, and the island shows it
//   ("now-playing", #49). A light check every 2 s; an event only when it changes.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

static MUSIC: AtomicBool = AtomicBool::new(false);
static NOW: Mutex<Option<NowPlaying>> = Mutex::new(None);

/// What plays now, as the island shows it.
#[derive(serde::Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    /// The music app, as people call it: "Apple Music", "Spotify", "TIDAL"…
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    /// The cover as a data URL, when the player gives one.
    pub art: Option<String>,
    /// Seconds into the song at `at` (Unix ms), and its length (0 when unknown): the island
    /// runs the progress bar on from there.
    pub position: f64,
    pub duration: f64,
    pub at: f64,
}

impl NowPlaying {
    /// The same song in the same state, give or take where it is in it: no need to tell the island
    /// again unless it jumped (a seek) by more than 3 s from where it should be.
    fn same_as(&self, other: &NowPlaying) -> bool {
        let still = NowPlaying { position: other.position, at: other.at, ..self.clone() };
        if still != *other {
            return false;
        }
        let expected = if self.playing { self.position + (other.at - self.at) / 1000.0 } else { self.position };
        (other.position - expected).abs() < 3.0
    }
}

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

/// What plays now (as last checked), or nothing.
#[tauri::command]
pub fn now_playing() -> Option<NowPlaying> {
    NOW.lock().ok().and_then(|n| n.clone())
}

/// ⏮ ⏯ ⏭ on the player the island shows: "previous", "playPause" or "next".
#[tauri::command]
pub async fn media_control(action: String) -> bool {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || win::control(&action)).await.unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        false
    }
}

pub fn setup(app: &AppHandle) {
    #[cfg(windows)]
    {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut cover_for = String::new();
            let mut cover: Option<String> = None;
            loop {
                let (any, now) = win::read(&mut cover_for, &mut cover);
                if MUSIC.swap(any, Ordering::Relaxed) != any {
                    let _ = app.emit("music-playing", any);
                }
                let changed = NOW.lock().map(|mut n| {
                    let same = match (&*n, &now) {
                        (Some(a), Some(b)) => a.same_as(b),
                        (None, None) => true,
                        _ => false,
                    };
                    if !same { *n = now.clone(); }
                    !same
                }).unwrap_or(false);
                if changed {
                    let _ = app.emit("now-playing", now);
                }
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        });
    }
    #[cfg(not(windows))]
    let _ = app;
}

/// The music apps, by a piece of their app id, and the name people know them by. Only these
/// count: a browser or a video player playing something is not music to dance to.
const MUSIC_APPS: [(&str, &str); 10] = [
    ("applemusic", "Apple Music"), ("itunes", "iTunes"), ("spotify", "Spotify"), ("tidal", "TIDAL"),
    ("deezer", "Deezer"), ("amazonmusic", "Amazon Music"), ("amazon.music", "Amazon Music"),
    ("youtubemusic", "YouTube Music"), ("soundcloud", "SoundCloud"), ("pandora", "Pandora"),
];

/// The music app's name, or None when the app isn't a music app.
pub fn music_app(app_id: &str) -> Option<&'static str> {
    let id = app_id.to_ascii_lowercase().replace([' ', '-'], "");
    MUSIC_APPS.iter().find(|(key, _)| id.contains(key)).map(|(_, name)| *name)
}

#[cfg(windows)]
mod win {
    use super::NowPlaying;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;

    const COVER_LIMIT: u32 = 2_000_000;

    fn playing(s: &Session) -> bool {
        s.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).is_ok_and(|st| st == Status::Playing)
    }

    fn app_id(s: &Session) -> String {
        s.SourceAppUserModelId().map(|id| id.to_string_lossy()).unwrap_or_default()
    }

    /// The music apps' sessions only (never a browser's or a video player's).
    fn music_sessions(manager: &Manager) -> Vec<Session> {
        let Ok(sessions) = manager.GetSessions() else { return Vec::new() };
        (0..sessions.Size().unwrap_or(0))
            .filter_map(|i| sessions.GetAt(i).ok())
            .filter(|s| super::music_app(&app_id(s)).is_some())
            .collect()
    }

    /// The music app to show: one that's playing, else the first one open.
    fn pick(manager: &Manager) -> Option<Session> {
        let all = music_sessions(manager);
        all.iter().find(|s| playing(s)).cloned().or_else(|| all.into_iter().next())
    }

    /// Whether anything plays, and what to show. The cover is read again only for a new song.
    pub fn read(cover_for: &mut String, cover: &mut Option<String>) -> (bool, Option<NowPlaying>) {
        let Ok(manager) = Manager::RequestAsync().and_then(|op| op.get()) else { return (false, None) };
        let any = music_sessions(&manager).iter().any(playing);
        let Some(session) = pick(&manager) else { return (any, None) };
        let Ok(props) = session.TryGetMediaPropertiesAsync().and_then(|op| op.get()) else { return (any, None) };
        let title = props.Title().map(|s| s.to_string_lossy()).unwrap_or_default();
        if title.is_empty() {
            return (any, None);
        }
        let artist = props.Artist().map(|s| s.to_string_lossy()).unwrap_or_default();
        let album = props.AlbumTitle().map(|s| s.to_string_lossy()).unwrap_or_default();
        // Where it is in the song, and how long it is (Windows' timeline, as for Spotify).
        let (position, duration, at) = session.GetTimelineProperties().ok().and_then(|tl| {
            let start = tl.StartTime().ok()?.Duration;
            let end = tl.EndTime().ok()?.Duration;
            let pos = tl.Position().ok()?.Duration;
            let at = tl.LastUpdatedTime().ok().and_then(|u| crate::spotify::windows_time_to_unix_ms(u.UniversalTime));
            Some((crate::spotify::ticks_to_secs(pos - start), crate::spotify::ticks_to_secs(end - start), at.unwrap_or(0.0)))
        }).unwrap_or((0.0, 0.0, 0.0));
        let app_id = app_id(&session);
        let key = format!("{app_id}|{title}|{artist}");
        if *cover_for != key {
            *cover_for = key;
            *cover = cover_bytes(&props).and_then(|b| crate::spotify::data_url(&b));
        }
        (any, Some(NowPlaying {
            app: super::music_app(&app_id).unwrap_or("Music").to_string(),
            title,
            artist,
            album,
            playing: playing(&session),
            art: cover.clone(),
            position,
            duration,
            at,
        }))
    }

    fn cover_bytes(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<Vec<u8>> {
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > COVER_LIMIT as u64 {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.get().ok()?;
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(bytes)
    }

    /// ⏮ ⏯ ⏭ on the player the island shows.
    pub fn control(action: &str) -> bool {
        let Ok(manager) = Manager::RequestAsync().and_then(|op| op.get()) else { return false };
        let Some(s) = pick(&manager) else { return false };
        let op = match action {
            "previous" => s.TrySkipPreviousAsync(),
            "next" => s.TrySkipNextAsync(),
            "playPause" => s.TryTogglePlayPauseAsync(),
            _ => return false,
        };
        op.and_then(|o| o.get()).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::music_app;

    #[test]
    fn only_music_apps_count_and_by_their_names() {
        assert_eq!(music_app("AppleInc.AppleMusicWin_nzyj5cx40ttqa!App"), Some("Apple Music"));
        assert_eq!(music_app("Spotify.exe"), Some("Spotify"));
        assert_eq!(music_app("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), Some("Spotify"));
        assert_eq!(music_app("TIDAL.exe"), Some("TIDAL"));
        // Browsers and video players never count.
        assert_eq!(music_app("MSEdge"), None);
        assert_eq!(music_app("Chrome"), None);
        assert_eq!(music_app("308046B0AF4A39CB"), None); // Firefox
        assert_eq!(music_app("Microsoft.ZuneVideo_8wekyb3d8bbwe!Microsoft.ZuneVideo"), None);
    }
}
