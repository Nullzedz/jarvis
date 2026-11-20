// JARVIS: his two shortcuts, chosen in Settings → Voice (design B, the keycap
// tiles), by their KeyboardEvent.code names as dictation's own shortcut is.
//
// - Talk: held to talk, tapped for hands-free (talk.rs). Left Ctrl + Win.
// - Ask: pressed to open the box at the cursor (ask.rs). Left Ctrl + Left Shift + Z.
//
// The keys are read with GetAsyncKeyState on each beat. A key of a shortcut that
// isn't a modifier (the Z) is taken by a keyboard hook while the shortcut's
// modifiers are held, so the app in front never gets it (Ctrl+Shift+Z is
// « redo » in many apps); the hook remembers it as held for the reads.

use std::sync::RwLock;

pub const DEFAULT_TALK: [&str; 2] = ["ControlLeft", "MetaLeft"];
pub const DEFAULT_ASK: [&str; 3] = ["ControlLeft", "ShiftLeft", "KeyZ"];

/// One shortcut: its virtual keys, which are modifiers.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Shortcut {
    vks: Vec<u32>,
    modifier: Vec<bool>,
}

struct Both {
    talk: Shortcut,
    ask: Shortcut,
}

static KEYS: RwLock<Option<Both>> = RwLock::new(None);

/// The keys chosen (KeyboardEvent.code names), or the default when they can't be used.
pub fn codes(chosen: &[String], default: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for c in chosen {
        if crate::flow::logic::known_code(c) && !out.contains(c) {
            out.push(c.clone());
        }
    }
    if out.is_empty() || out.len() > crate::flow::logic::MAX_COMBO {
        return default.iter().map(|s| s.to_string()).collect();
    }
    out
}

fn shortcut(codes: &[String]) -> Shortcut {
    let mut s = Shortcut::default();
    for c in codes {
        if let Some(vk) = vk(c) {
            s.vks.push(vk);
            s.modifier.push(crate::flow::logic::is_modifier_code(c));
        }
    }
    s
}

#[cfg(windows)]
fn vk(code: &str) -> Option<u32> {
    crate::flow::os::code_vk(code)
}

#[cfg(not(windows))]
fn vk(_code: &str) -> Option<u32> {
    None
}

/// Follows the preferences (at start and whenever they're saved).
pub fn apply(prefs: &crate::flow::store::Prefs) {
    let talk = shortcut(&codes(&prefs.talk_keys, &DEFAULT_TALK));
    let ask = shortcut(&codes(&prefs.ask_keys, &DEFAULT_ASK));
    *KEYS.write().unwrap() = Some(Both { talk, ask });
    #[cfg(windows)]
    os::start();
}

#[derive(Clone, Copy)]
pub enum Which {
    Talk,
    Ask,
}

fn get(which: Which) -> Shortcut {
    let keys = KEYS.read().unwrap();
    match (keys.as_ref(), which) {
        (Some(b), Which::Talk) => b.talk.clone(),
        (Some(b), Which::Ask) => b.ask.clone(),
        (None, Which::Talk) => shortcut(&DEFAULT_TALK.map(String::from)),
        (None, Which::Ask) => shortcut(&DEFAULT_ASK.map(String::from)),
    }
}

/// The generic virtual key Windows also reports for a sided modifier (0x10 Shift, 0x11 Ctrl, 0x12 Alt).
fn generic(vk: u32) -> Option<u32> {
    match vk {
        0xA0 | 0xA1 => Some(0x10),
        0xA2 | 0xA3 => Some(0x11),
        0xA4 | 0xA5 => Some(0x12),
        _ => None,
    }
}

/// The key JARVIS presses himself so a held Win or Alt, let go, opens no menu.
pub const MASK: u32 = 0xE8;

/// Whether `vk` counts as « another key » for this shortcut: not one of its keys,
/// not the generic twin of one of its modifiers, not a mouse button, not the mask.
fn is_other(s: &Shortcut, vk: u32) -> bool {
    vk >= 0x07 && vk != MASK && !s.vks.contains(&vk) && !s.vks.iter().any(|&k| generic(k) == Some(vk))
}

/// The shortcut held (every key down), and whether any other key is.
pub fn keys(which: Which) -> (bool, bool) {
    let s = get(which);
    if s.vks.is_empty() {
        return (false, false);
    }
    #[cfg(windows)]
    {
        let chord = s.vks.iter().all(|&vk| os::down(vk));
        let other = (0x07..=0xFEu32).any(|vk| is_other(&s, vk) && os::down(vk));
        (chord, other)
    }
    #[cfg(not(windows))]
    {
        (false, false)
    }
}

/// The shortcut holds Win or Alt: once it's down, JARVIS presses the mask key.
pub fn needs_mask(which: Which) -> bool {
    get(which).vks.iter().any(|&v| matches!(v, 0x5B | 0x5C | 0xA4 | 0xA5))
}

/// Presses and lets go of the mask key, so the held Win or Alt is read as part of a shortcut.
pub fn mask() {
    #[cfg(windows)]
    os::mask();
}

#[cfg(windows)]
mod os {
    use std::collections::HashSet;
    use std::sync::{Mutex, Once};

    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, KBDLLHOOKSTRUCT,
        LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    use super::KEYS;

    /// The shortcuts' own keys taken from the app in front, while held.
    static TAKEN: Mutex<Option<HashSet<u32>>> = Mutex::new(None);

    fn async_down(vk: u32) -> bool {
        (unsafe { GetAsyncKeyState(vk as i32) } as u16) & 0x8000 != 0
    }

    pub fn down(vk: u32) -> bool {
        async_down(vk) || TAKEN.lock().unwrap().as_ref().is_some_and(|t| t.contains(&vk))
    }

    /// True when the key goes to JARVIS, not to the app in front.
    fn on_key(vk: u32, press: bool, release: bool) -> bool {
        let mut taken = TAKEN.lock().unwrap();
        let taken = taken.get_or_insert_with(HashSet::new);
        if release {
            return taken.remove(&vk);
        }
        if !press {
            return false;
        }
        if taken.contains(&vk) {
            return true; // its repeats
        }
        let keys = KEYS.read().unwrap();
        let Some(both) = keys.as_ref() else { return false };
        for s in [&both.talk, &both.ask] {
            let Some(i) = s.vks.iter().position(|&k| k == vk) else { continue };
            if s.modifier[i] {
                continue;
            }
            // Its modifiers are held: the key is the shortcut's.
            let mods_held = s.vks.iter().zip(&s.modifier).filter(|(_, &m)| m).all(|(&k, _)| async_down(k));
            if mods_held && s.modifier.iter().any(|&m| m) {
                taken.insert(vk);
                return true;
            }
        }
        false
    }

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            if info.flags.0 & LLKHF_INJECTED.0 == 0 {
                let press = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
                let release = matches!(wparam.0 as u32, WM_KEYUP | WM_SYSKEYUP);
                if on_key(info.vkCode, press, release) {
                    return LRESULT(1);
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    /// The hook, once, on a thread of its own (it needs a message loop).
    pub fn start() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            std::thread::Builder::new()
                .name("jarvis-shortcut-keys".into())
                .spawn(|| unsafe {
                    let module = GetModuleHandleW(None).ok();
                    match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), module.map(Into::into), 0) {
                        Ok(_) => {
                            let mut msg = MSG::default();
                            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                                let _ = TranslateMessage(&msg);
                                DispatchMessageW(&msg);
                            }
                        }
                        Err(err) => crate::log::line(format!("shortcuts: no keyboard hook: {err}")),
                    }
                })
                .ok();
        });
    }

    fn key_input(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn mask() {
        let inputs = [key_input(super::MASK as u16, false), key_input(super::MASK as u16, true)];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(vks: &[u32], modifier: &[bool]) -> Shortcut {
        Shortcut { vks: vks.to_vec(), modifier: modifier.to_vec() }
    }

    #[test]
    fn unusable_keys_fall_back_to_the_default() {
        assert_eq!(codes(&[], &DEFAULT_TALK), ["ControlLeft", "MetaLeft"]);
        assert_eq!(codes(&["Nonsense".into()], &DEFAULT_ASK), ["ControlLeft", "ShiftLeft", "KeyZ"]);
        assert_eq!(codes(&["AltLeft".into(), "AltLeft".into(), "KeyJ".into()], &DEFAULT_TALK), ["AltLeft", "KeyJ"]);
    }

    #[test]
    fn the_shortcuts_own_keys_and_their_generic_twins_are_not_other_keys() {
        // Left Ctrl + Left Shift + Z.
        let ask = s(&[0xA2, 0xA0, 0x5A], &[true, true, false]);
        for vk in [0xA2, 0xA0, 0x5A, 0x11, 0x10, MASK, 0x01, 0x02] {
            assert!(!is_other(&ask, vk), "{vk:#x}");
        }
        for vk in [0xA3, 0x12, 0x5B, 0x41] {
            assert!(is_other(&ask, vk), "{vk:#x}");
        }
    }
}
