// JARVIS (#96): what an app shows that you can click (buttons, menu items, tabs,
// links…), by name and exact place, read from Windows UI Automation: the list
// screen readers use. Free and local: no picture, no AI. « Where is…? » plans
// its route from these names and finds each next step among them by name.

use std::sync::atomic::{AtomicU32, Ordering};

/// One thing to click: its name, and where it is (physical px: x, y, w, h).
#[derive(Clone, Debug, PartialEq)]
pub struct Named {
    pub name: String,
    pub rect: (f64, f64, f64, f64),
}

/// The app that was in front when the ask box opened (the box itself takes the focus).
static FRONT: AtomicU32 = AtomicU32::new(0);

/// Notes the app in front, unless it's JARVIS himself.
pub fn note_front() {
    if let Some(pid) = user_app() {
        {
            FRONT.store(pid, Ordering::Relaxed);
            // Chromium and Electron apps fill in their list only once something asks for it:
            // asked now, it's ready by the time the question is typed.
            std::thread::spawn(move || {
                let _ = read(pid);
            });
        }
    }
}

/// The app the user is in: the one in front; if that's one of JARVIS's windows (the ask box,
/// his layer: #96, then he read nothing and said he couldn't point), the top-most window
/// that isn't his; else the one noted when the box opened.
pub fn user_app() -> Option<u32> {
    user_window().map(|(_, pid)| pid).or_else(|| Some(FRONT.load(Ordering::Relaxed)).filter(|p| *p != 0))
}

/// The user's window (its handle) and its app, as `user_app` finds them.
pub fn user_window() -> Option<(isize, u32)> {
    let me = std::process::id();
    match front_now() {
        Some((hwnd, pid)) if pid != me => Some((hwnd, pid)),
        _ => top_other_app(me),
    }
}

/// The app in front now, if it's another than `pid` and isn't JARVIS: the user went elsewhere.
pub fn elsewhere(pid: u32) -> bool {
    front_pid_now().is_some_and(|p| p != pid && p != std::process::id())
}

/// The window the question was asked from, brought back in front (#96: alt-tabbed away while
/// he looked it up, the guide was drawn over another app).
#[cfg(windows)]
pub fn bring_back(hwnd: isize) -> bool {
    crate::platform::bring_forward(hwnd)
}

#[cfg(not(windows))]
pub fn bring_back(_hwnd: isize) -> bool {
    false
}

/// Whose window is under a point on the screen (a click is the guided app's only if it's on it).
#[cfg(windows)]
pub fn pid_at(x: f64, y: f64) -> Option<u32> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT};
    unsafe {
        let hwnd = GetAncestor(WindowFromPoint(POINT { x: x as i32, y: y as i32 }), GA_ROOT);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        (pid != 0).then_some(pid)
    }
}

#[cfg(not(windows))]
pub fn pid_at(_x: f64, _y: f64) -> Option<u32> {
    None
}

/// The top-most ordinary window (shown, titled, not a tool window) of another app than `me`.
#[cfg(windows)]
fn top_other_app(me: u32) -> Option<(isize, u32)> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW};
    struct Find {
        me: u32,
        found: u32,
        hwnd: isize,
    }
    unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
        let f = &mut *(data.0 as *mut Find);
        let ordinary = IsWindowVisible(hwnd).as_bool()
            && !IsIconic(hwnd).as_bool()
            && GetWindowTextLengthW(hwnd) > 0
            && (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0) == 0;
        if ordinary {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != 0 && pid != f.me {
                f.found = pid;
                f.hwnd = hwnd.0 as isize;
                return false.into();
            }
        }
        true.into()
    }
    let mut f = Find { me, found: 0, hwnd: 0 };
    // Windows are listed from the top down.
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut f as *mut Find as isize));
    }
    (f.found != 0).then_some((f.hwnd, f.found))
}

#[cfg(not(windows))]
fn top_other_app(_me: u32) -> Option<(isize, u32)> {
    None
}

/// The name of a name, for matching: lower case, letters and digits only.
fn key(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// The thing called `name`: the same name first, then one that contains it (« Billing » finds
/// « Billing & plans »), then one it contains if that's most of it (« Open Help menu » finds
/// « Help »… but « App Settings » never finds « Apps »: #96, Discord); the closest wins, so
/// « Settings » isn't « Settings sync status ».
pub fn find<'a>(list: &'a [Named], name: &str) -> Option<&'a Named> {
    let want = key(name);
    if want.is_empty() {
        return None;
    }
    if let Some(n) = list.iter().find(|n| key(&n.name) == want) {
        return Some(n);
    }
    let mut near: Vec<&Named> = list.iter().filter(|n| {
        let k = key(&n.name);
        !k.is_empty() && (k.contains(&want) || (k.len() >= 4 && k.len() * 2 >= want.len() && want.contains(&k) && !want.starts_with(&k)))
    }).collect();
    near.sort_by_key(|n| (key(&n.name).len() as i64 - want.len() as i64).abs());
    near.first().copied()
}

/// The names as sent to the AI, each with where it sits in the app (#96: the account button
/// was « nullzeed Pro »; « bottom-left » is what tells it's the account menu): « nullzeed Pro
/// (bottom-left) ». Each once, short, at most `most`.
pub fn described(list: &[Named], most: usize) -> Vec<String> {
    let (x0, y0) = list.iter().fold((f64::MAX, f64::MAX), |(x, y), n| (x.min(n.rect.0), y.min(n.rect.1)));
    let (x1, y1) = list.iter().fold((f64::MIN, f64::MIN), |(x, y), n| (x.max(n.rect.0 + n.rect.2), y.max(n.rect.1 + n.rect.3)));
    let (w, h) = ((x1 - x0).max(1.0), (y1 - y0).max(1.0));
    let mut out: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for n in list {
        let s: String = n.name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(48).collect();
        // A long name is content (a chat's title, a message), not a control (#96): left out, like
        // the compressed lists that did better on fewer tokens.
        if s.is_empty() || seen.contains(&s) || n.name.chars().count() > 40 {
            continue;
        }
        let (cx, cy) = ((n.rect.0 + n.rect.2 / 2.0 - x0) / w, (n.rect.1 + n.rect.3 / 2.0 - y0) / h);
        let v = if cy < 0.2 { "top" } else if cy > 0.8 { "bottom" } else { "middle" };
        let hz = if cx < 0.25 { "left" } else if cx > 0.75 { "right" } else { "centre" };
        out.push(format!("{s} ({v}-{hz})"));
        seen.push(s);
        if out.len() >= most {
            break;
        }
    }
    out
}

/// The names as sent to the AI: each once, short, at most `most`.
pub fn names(list: &[Named], most: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for n in list {
        let s: String = n.name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(48).collect();
        if !s.is_empty() && !out.iter().any(|o| o == &s) {
            out.push(s);
        }
        if out.len() >= most {
            break;
        }
    }
    out
}

fn front_pid_now() -> Option<u32> {
    front_now().map(|(_, pid)| pid)
}

#[cfg(windows)]
fn front_now() -> Option<(isize, u32)> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    let hwnd = unsafe { GetForegroundWindow() };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    (pid != 0).then_some((hwnd.0 as isize, pid))
}

#[cfg(not(windows))]
fn front_now() -> Option<(isize, u32)> {
    None
}

/// The app's exe name (« claude », « explorer »): routes are remembered per app.
#[cfg(windows)]
pub fn app_name(pid: u32) -> String {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default()
    }
}

#[cfg(not(windows))]
pub fn app_name(_pid: u32) -> String {
    String::new()
}

/// Everything clickable with a name that the app `pid` shows now, in all its windows (a
/// menu that pops up is a window of its own). Empty when the app shares none.
pub fn clickable(pid: u32) -> Vec<Named> {
    let started = std::time::Instant::now();
    let mut out = read(pid);
    // Only the window's own buttons: the app was just woken up (Chromium, Electron); again.
    if out.len() < 8 {
        std::thread::sleep(std::time::Duration::from_millis(400));
        out = read(pid);
    }
    crate::log::line(format!("uia: {} named things in {} ms", out.len(), started.elapsed().as_millis()));
    out
}

fn read(pid: u32) -> Vec<Named> {
    read_with(pid, false)
}

/// What the app has that you could click but that's scrolled out of view (#96): Windows still
/// lists it, marked off screen.
pub fn hidden(pid: u32) -> Vec<Named> {
    read_with(pid, true)
}

#[cfg(windows)]
fn read_with(pid: u32, offscreen: bool) -> Vec<Named> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::*;

    let read = || -> windows::core::Result<Vec<Named>> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let root = uia.GetRootElement()?;
            let of_app = uia.CreatePropertyCondition(UIA_ProcessIdPropertyId, &VARIANT::from(pid as i32))?;
            let tops = root.FindAll(TreeScope_Children, &of_app)?;
            let cache = uia.CreateCacheRequest()?;
            for p in [UIA_NamePropertyId, UIA_BoundingRectanglePropertyId, UIA_ControlTypePropertyId, UIA_IsEnabledPropertyId] {
                cache.AddProperty(p)?;
            }
            let shown = uia.CreateAndCondition(&uia.ControlViewCondition()?, &uia.CreatePropertyCondition(UIA_IsOffscreenPropertyId, &VARIANT::from(offscreen))?)?;
            let kinds = [
                UIA_ButtonControlTypeId,
                UIA_MenuItemControlTypeId,
                UIA_TabItemControlTypeId,
                UIA_ListItemControlTypeId,
                UIA_HyperlinkControlTypeId,
                UIA_CheckBoxControlTypeId,
                UIA_RadioButtonControlTypeId,
                UIA_TreeItemControlTypeId,
                UIA_ComboBoxControlTypeId,
                UIA_SplitButtonControlTypeId,
                UIA_DataItemControlTypeId,
            ];
            let mut out = Vec::new();
            for t in 0..tops.Length()? {
                let top = tops.GetElement(t)?;
                let Ok(found) = top.FindAllBuildCache(TreeScope_Descendants, &shown, &cache) else { continue };
                for i in 0..found.Length()? {
                    let e = found.GetElement(i)?;
                    if !kinds.contains(&e.CachedControlType()?) || !e.CachedIsEnabled()?.as_bool() {
                        continue;
                    }
                    let name = e.CachedName()?.to_string();
                    let r = e.CachedBoundingRectangle()?;
                    let (w, h) = ((r.right - r.left) as f64, (r.bottom - r.top) as f64);
                    if name.trim().is_empty() || (!offscreen && (w < 4.0 || h < 4.0)) {
                        continue;
                    }
                    out.push(Named { name: name.trim().to_string(), rect: (r.left as f64, r.top as f64, w, h) });
                    if out.len() >= 400 {
                        return Ok(out);
                    }
                }
            }
            Ok(out)
        }
    };
    read().unwrap_or_else(|e| {
        crate::log::line(format!("uia: couldn't read the app's buttons: {e}"));
        Vec::new()
    })
}

#[cfg(not(windows))]
fn read_with(_pid: u32, _offscreen: bool) -> Vec<Named> {
    Vec::new()
}

/// Anything on screen in the app `pid` called exactly `name` (any case), button or not (#96: in
/// Discord's settings, « Accessibility » wasn't among the buttons): the last word before a picture.
#[cfg(windows)]
pub fn named(pid: u32, name: &str) -> Option<Named> {
    use windows::core::BSTR;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::*;
    if name.trim().is_empty() {
        return None;
    }
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        let root = uia.GetRootElement().ok()?;
        let of_app = uia.CreatePropertyCondition(UIA_ProcessIdPropertyId, &VARIANT::from(pid as i32)).ok()?;
        let tops = root.FindAll(TreeScope_Children, &of_app).ok()?;
        let called = uia.CreatePropertyConditionEx(UIA_NamePropertyId, &VARIANT::from(BSTR::from(name.trim())), PropertyConditionFlags_IgnoreCase).ok()?;
        let shown = uia.CreatePropertyCondition(UIA_IsOffscreenPropertyId, &VARIANT::from(false)).ok()?;
        let both = uia.CreateAndCondition(&called, &shown).ok()?;
        for t in 0..tops.Length().ok()? {
            let Ok(e) = tops.GetElement(t).and_then(|top| top.FindFirst(TreeScope_Descendants, &both)) else { continue };
            let r = e.CurrentBoundingRectangle().ok()?;
            let (w, h) = ((r.right - r.left) as f64, (r.bottom - r.top) as f64);
            if w >= 4.0 && h >= 4.0 {
                return Some(Named { name: name.trim().to_string(), rect: (r.left as f64, r.top as f64, w, h) });
            }
        }
        None
    }
}

#[cfg(not(windows))]
pub fn named(_pid: u32, _name: &str) -> Option<Named> {
    None
}

/// The thing called `name` in the app `pid`, scrolled into view by the app itself (#96: a
/// setting further down a list). Whether it could be.
#[cfg(windows)]
pub fn scroll_to(pid: u32, name: &str) -> bool {
    use windows::core::{Interface, BSTR};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::*;
    let go = || -> windows::core::Result<bool> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let root = uia.GetRootElement()?;
            let of_app = uia.CreatePropertyCondition(UIA_ProcessIdPropertyId, &VARIANT::from(pid as i32))?;
            let tops = root.FindAll(TreeScope_Children, &of_app)?;
            let called = uia.CreatePropertyConditionEx(UIA_NamePropertyId, &VARIANT::from(BSTR::from(name)), PropertyConditionFlags_IgnoreCase)?;
            let walker = uia.ControlViewWalker()?;
            for t in 0..tops.Length()? {
                let Ok(mut e) = tops.GetElement(t).and_then(|top| top.FindFirst(TreeScope_Descendants, &called)) else { continue };
                // It, or the row it's in, knows how to come into view.
                for _ in 0..3 {
                    if let Ok(p) = e.GetCurrentPattern(UIA_ScrollItemPatternId) {
                        if let Ok(item) = p.cast::<IUIAutomationScrollItemPattern>() {
                            item.ScrollIntoView()?;
                            return Ok(true);
                        }
                    }
                    let Ok(up) = walker.GetParentElement(&e) else { break };
                    e = up;
                }
            }
            Ok(false)
        }
    };
    go().unwrap_or(false)
}

#[cfg(not(windows))]
pub fn scroll_to(_pid: u32, _name: &str) -> bool {
    false
}

/// The app's search box, if one is on screen: a text field whose name says search or find.
#[cfg(windows)]
pub fn search_box(pid: u32) -> Option<Named> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::*;
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        let root = uia.GetRootElement().ok()?;
        let of_app = uia.CreatePropertyCondition(UIA_ProcessIdPropertyId, &VARIANT::from(pid as i32)).ok()?;
        let tops = root.FindAll(TreeScope_Children, &of_app).ok()?;
        // A text field, or a box you type in that drops a list (Discord's « Search … » is one).
        let edit = uia
            .CreateOrCondition(
                &uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_EditControlTypeId.0)).ok()?,
                &uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_ComboBoxControlTypeId.0)).ok()?,
            )
            .ok()?;
        let shown = uia.CreatePropertyCondition(UIA_IsOffscreenPropertyId, &VARIANT::from(false)).ok()?;
        let both = uia.CreateAndCondition(&edit, &shown).ok()?;
        for t in 0..tops.Length().ok()? {
            let Ok(found) = tops.GetElement(t).and_then(|top| top.FindAll(TreeScope_Descendants, &both)) else { continue };
            for i in 0..found.Length().unwrap_or(0) {
                let Ok(e) = found.GetElement(i) else { continue };
                let name = e.CurrentName().map(|n| n.to_string()).unwrap_or_default();
                let help = e.CurrentHelpText().map(|n| n.to_string()).unwrap_or_default();
                let says = format!("{name} {help}").to_lowercase();
                if !(says.contains("search") || says.contains("find")) {
                    continue;
                }
                let Ok(r) = e.CurrentBoundingRectangle() else { continue };
                let (w, h) = ((r.right - r.left) as f64, (r.bottom - r.top) as f64);
                if w >= 20.0 && h >= 8.0 {
                    return Some(Named { name, rect: (r.left as f64, r.top as f64, w, h) });
                }
            }
        }
        None
    }
}

#[cfg(not(windows))]
pub fn search_box(_pid: u32) -> Option<Named> {
    None
}

/// One thing in the app's layout (#96): what it is, and where it sits in the app's tree (the
/// path of child numbers from its window), with the dialog it's in, if any.
#[derive(Clone, Debug, PartialEq)]
pub struct Spot {
    pub named: Named,
    pub path: Vec<u16>,
    pub dialog: Option<Vec<u16>>,
    pub search: bool,
}

/// What to work from now: the names, the panel you're in first, and that panel's search box.
#[derive(Clone, Debug, Default)]
pub struct Focus {
    pub list: Vec<Named>,
    pub search: Option<Named>,
}

/// The panel you're working in (#96: Discord's settings, a layer over the server, with its own
/// search box): a dialog if one is open (the one with the most in it); else the smallest part
/// of the tree holding what's new since `before` (what your click opened). A path prefix.
pub fn panel_of(spots: &[Spot], before: &[String]) -> Option<Vec<u16>> {
    let mut dialogs: Vec<(Vec<u16>, usize)> = Vec::new();
    for s in spots.iter().filter_map(|s| s.dialog.as_ref()) {
        match dialogs.iter_mut().find(|(d, _)| d == s) {
            Some((_, n)) => *n += 1,
            None => dialogs.push((s.clone(), 1)),
        }
    }
    if let Some((d, _)) = dialogs.into_iter().max_by_key(|(_, n)| *n) {
        return Some(d);
    }
    if before.is_empty() {
        return None;
    }
    let new: Vec<&Spot> = spots.iter().filter(|s| !s.search && !before.contains(&s.named.name)).collect();
    if new.len() < 3 {
        return None;
    }
    let mut common = new[0].path.clone();
    for s in &new[1..] {
        let same = common.iter().zip(&s.path).take_while(|(a, b)| a == b).count();
        common.truncate(same);
    }
    // The whole window (or just its frame) isn't a panel.
    (common.len() >= 2).then_some(common)
}

/// What to work from now, the panel you're in first (all of it, then 25 from elsewhere), and
/// the search box in that panel (or, with none, the one nearest what's new).
pub fn focused(pid: u32, before: &[String]) -> Focus {
    let spots = snapshot(pid);
    let panel = panel_of(&spots, before);
    let inside = |s: &Spot| panel.as_ref().is_some_and(|p| s.path.starts_with(p));
    let mut list: Vec<Named> = spots.iter().filter(|s| !s.search && inside(s)).map(|s| s.named.clone()).collect();
    let outside = spots.iter().filter(|s| !s.search && !inside(s)).map(|s| s.named.clone());
    if panel.is_some() {
        list.extend(outside.take(25));
    } else {
        list.extend(outside);
    }
    let boxes: Vec<&Spot> = spots.iter().filter(|s| s.search).collect();
    // The box in the panel, or nearest above it in the tree (a settings search sits beside its list).
    let in_tree = panel.as_ref().and_then(|p| (2..=p.len()).rev().find_map(|k| boxes.iter().find(|b| b.path.starts_with(&p[..k]))));
    let search = in_tree.or_else(|| {
        // No box in the panel: the one nearest what's new.
        let new: Vec<&Spot> = spots.iter().filter(|s| !s.search && !before.contains(&s.named.name)).collect();
        if new.is_empty() || before.is_empty() {
            return boxes.first();
        }
        let (cx, cy) = new.iter().fold((0.0, 0.0), |(x, y), s| (x + s.named.rect.0 / new.len() as f64, y + s.named.rect.1 / new.len() as f64));
        boxes.iter().min_by(|a, b| {
            let d = |s: &Spot| (s.named.rect.0 - cx).powi(2) + (s.named.rect.1 - cy).powi(2);
            d(a).total_cmp(&d(b))
        })
    }).map(|s| s.named.clone());
    crate::log::line(format!("uia: focus: {} of {} things{}, search box {}", list.len(), spots.len(), if panel.is_some() { " (a panel)" } else { "" }, if search.is_some() { "found" } else { "none" }));
    Focus { list, search }
}

/// The app's layout in one go (#96): its whole tree read at once, then walked here, so each
/// thing comes with where it sits (UFO²'s way of reading a Windows app).
#[cfg(windows)]
pub fn snapshot(pid: u32) -> Vec<Spot> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::*;

    struct Walk {
        out: Vec<Spot>,
        seen: usize,
    }
    fn walk(e: &IUIAutomationElement, path: &mut Vec<u16>, dialog: Option<Vec<u16>>, w: &mut Walk) {
        w.seen += 1;
        if w.seen > 6000 || path.len() > 80 {
            return;
        }
        unsafe {
            let kind = e.CachedControlType().unwrap_or_default();
            let is_dialog = e.GetCachedPropertyValue(UIA_IsDialogPropertyId).ok().and_then(|v| bool::try_from(&v).ok()).unwrap_or(false);
            let dialog = if (is_dialog || kind == UIA_WindowControlTypeId) && path.len() > 1 { Some(path.clone()) } else { dialog };
            let offscreen = e.CachedIsOffscreen().map(|b| b.as_bool()).unwrap_or(false);
            let name = e.CachedName().map(|n| n.to_string()).unwrap_or_default();
            if !offscreen && !name.trim().is_empty() {
                let clickable = [
                    UIA_ButtonControlTypeId, UIA_MenuItemControlTypeId, UIA_TabItemControlTypeId, UIA_ListItemControlTypeId, UIA_HyperlinkControlTypeId,
                    UIA_CheckBoxControlTypeId, UIA_RadioButtonControlTypeId, UIA_TreeItemControlTypeId, UIA_ComboBoxControlTypeId, UIA_SplitButtonControlTypeId, UIA_DataItemControlTypeId,
                ]
                .contains(&kind);
                let typed = kind == UIA_EditControlTypeId || kind == UIA_ComboBoxControlTypeId;
                let help = e.CachedHelpText().map(|n| n.to_string()).unwrap_or_default();
                let says = format!("{name} {help}").to_lowercase();
                let search = typed && (says.contains("search") || says.contains("find"));
                if clickable || search {
                    if let Ok(r) = e.CachedBoundingRectangle() {
                        let (rw, rh) = ((r.right - r.left) as f64, (r.bottom - r.top) as f64);
                        if rw >= 4.0 && rh >= 4.0 {
                            w.out.push(Spot { named: Named { name: name.trim().to_string(), rect: (r.left as f64, r.top as f64, rw, rh) }, path: path.clone(), dialog: dialog.clone(), search });
                        }
                    }
                }
            }
            let Ok(kids) = e.GetCachedChildren() else { return };
            for i in 0..kids.Length().unwrap_or(0) {
                let Ok(k) = kids.GetElement(i) else { continue };
                path.push(i as u16);
                walk(&k, path, dialog.clone(), w);
                path.pop();
            }
        }
    }

    let started = std::time::Instant::now();
    let read = || -> windows::core::Result<Vec<Spot>> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let root = uia.GetRootElement()?;
            let of_app = uia.CreatePropertyCondition(UIA_ProcessIdPropertyId, &VARIANT::from(pid as i32))?;
            let tops = root.FindAll(TreeScope_Children, &of_app)?;
            let cache = uia.CreateCacheRequest()?;
            for p in [UIA_NamePropertyId, UIA_BoundingRectanglePropertyId, UIA_ControlTypePropertyId, UIA_IsOffscreenPropertyId, UIA_IsDialogPropertyId, UIA_HelpTextPropertyId] {
                cache.AddProperty(p)?;
            }
            cache.SetTreeScope(TreeScope_Subtree)?;
            cache.SetTreeFilter(&uia.ControlViewCondition()?)?;
            let mut w = Walk { out: Vec::new(), seen: 0 };
            for t in 0..tops.Length()? {
                let Ok(top) = tops.GetElement(t).and_then(|top| top.BuildUpdatedCache(&cache)) else { continue };
                let mut path = vec![t as u16];
                walk(&top, &mut path, None, &mut w);
            }
            Ok(w.out)
        }
    };
    let out = read().unwrap_or_else(|e| {
        crate::log::line(format!("uia: couldn't read the app's layout: {e}"));
        Vec::new()
    });
    crate::log::line(format!("uia: layout of {} things in {} ms", out.len(), started.elapsed().as_millis()));
    out
}

#[cfg(not(windows))]
pub fn snapshot(_pid: u32) -> Vec<Spot> {
    Vec::new()
}

/// The clickable thing at a point on the screen (physical px), and its name: what the AI saw
/// on a picture, named as the app names it.
#[cfg(windows)]
pub fn at(x: f64, y: f64) -> Option<Named> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::UI::Accessibility::*;
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        let walker = uia.ControlViewWalker().ok()?;
        let mut e = uia.ElementFromPoint(POINT { x: x as i32, y: y as i32 }).ok()?;
        // Up from what's under the point (an icon, a label) to the button it's part of.
        for _ in 0..5 {
            let name = e.CurrentName().map(|n| n.to_string()).unwrap_or_default();
            let kind = e.CurrentControlType().unwrap_or_default();
            let clickable = [UIA_ButtonControlTypeId, UIA_MenuItemControlTypeId, UIA_TabItemControlTypeId, UIA_ListItemControlTypeId, UIA_HyperlinkControlTypeId, UIA_SplitButtonControlTypeId, UIA_TreeItemControlTypeId].contains(&kind);
            if clickable && !name.trim().is_empty() {
                let r = e.CurrentBoundingRectangle().ok()?;
                return Some(Named { name: name.trim().to_string(), rect: (r.left as f64, r.top as f64, (r.right - r.left) as f64, (r.bottom - r.top) as f64) });
            }
            e = walker.GetParentElement(&e).ok()?;
        }
        None
    }
}

#[cfg(not(windows))]
pub fn at(_x: f64, _y: f64) -> Option<Named> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(name: &str) -> Named {
        Named { name: name.into(), rect: (0.0, 0.0, 10.0, 10.0) }
    }

    #[test]
    fn a_name_is_found_as_it_is_then_near_it() {
        let list = [n("Settings sync status"), n("Settings"), n("Billing & plans"), n("Help")];
        assert_eq!(find(&list, "settings").unwrap().name, "Settings");
        assert_eq!(find(&list, "Billing").unwrap().name, "Billing & plans");
        assert!(find(&list, "Open Help menu").is_none());
        let discord = [n("Apps"), n("User Settings"), n("Notification Settings")];
        assert!(find(&discord, "App Settings").is_none());
        assert_eq!(find(&[n("Help menu")], "Open Help menu").unwrap().name, "Help menu");
        assert!(find(&list, "Export").is_none());
        assert!(find(&list, "").is_none());
    }

    #[test]
    fn names_go_once_and_short() {
        let list = [n("Save"), n("Save"), n("  New   chat "), n(&"x".repeat(80))];
        let got = names(&list, 10);
        assert_eq!(got, vec!["Save".to_string(), "New chat".to_string(), "x".repeat(48)]);
        assert_eq!(names(&list, 1).len(), 1);
    }

    #[test]
    fn the_panel_is_the_open_dialog_or_what_the_click_opened() {
        let s = |name: &str, path: &[u16], dialog: Option<&[u16]>, search: bool| Spot { named: n(name), path: path.to_vec(), dialog: dialog.map(|d| d.to_vec()), search };
        // A dialog open: it's the panel.
        let with_dialog = [s("Chat", &[0, 1, 0], None, false), s("Close", &[0, 2, 0, 1], Some(&[0, 2]), false), s("OK", &[0, 2, 0, 2], Some(&[0, 2]), false)];
        assert_eq!(panel_of(&with_dialog, &[]), Some(vec![0, 2]));
        // No dialog: where the new things are (the settings layer), not the server behind it.
        let layered = [
            s("Search Server", &[0, 0, 1, 3], None, true),
            s("General", &[0, 0, 1, 5], None, false),
            s("My Account", &[0, 0, 4, 1, 0], None, false),
            s("Connections", &[0, 0, 4, 1, 1], None, false),
            s("Connected Apps", &[0, 0, 4, 1, 2], None, false),
            s("Search", &[0, 0, 4, 0], None, true),
        ];
        let before = ["Search Server".to_string(), "General".to_string()];
        assert_eq!(panel_of(&layered, &before), Some(vec![0, 0, 4, 1]));
        assert_eq!(panel_of(&layered, &[]), None);
    }

    #[test]
    fn each_name_says_where_it_sits() {
        let at = |name: &str, x: f64, y: f64| Named { name: name.into(), rect: (x, y, 10.0, 10.0) };
        let list = [at("Menu", 0.0, 0.0), at("nullzeed Pro", 0.0, 990.0), at("Share", 990.0, 0.0), at("Send", 500.0, 500.0)];
        assert_eq!(described(&list, 10), vec!["Menu (top-left)", "nullzeed Pro (bottom-left)", "Share (top-right)", "Send (middle-centre)"]);
    }
}

#[cfg(all(test, windows))]
mod live {
    /// By hand: UIA_PID=<an app's process id> cargo test --lib uia::live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn reads_a_running_app() {
        let pid: u32 = std::env::var("UIA_PID").ok().and_then(|p| p.parse().ok()).expect("UIA_PID");
        let list = super::clickable(pid);
        println!("{} ({}): {:?}", super::app_name(pid), list.len(), super::described(&list, 400));
        let hidden = super::hidden(pid);
        let f = super::focused(pid, &[]);
        println!("FOCUS {} first {:?} SEARCH {:?}", f.list.len(), super::described(&f.list, 12), f.search.map(|s| s.name));
        println!("HIDDEN {} e.g. {:?} SEARCH {:?}", hidden.len(), super::names(&hidden, 8), super::search_box(pid));
    }
}
