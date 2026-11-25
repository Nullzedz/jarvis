// JARVIS 1.0.0 (#98): from the name the code came with to JARVIS's own, once, at start-up.
// An install from before keeps everything: its folders move to the new names, the keys saved
// in the system's keychain are copied over, and the coding agents' hooks (in their own settings
// files) point at the new hook program. The old names below are the only ones left in the code:
// they are what an earlier install used.

use std::path::{Path, PathBuf};

/// The name the folders had before 1.0.0.
#[cfg(windows)]
const OLD_DIR: &str = "Coucou";
#[cfg(not(windows))]
const OLD_DIR: &str = "coucou";
/// The keychain service and app identifier before 1.0.0.
pub const OLD_SERVICE: &str = "fr.louisraille.coucou";
/// The hook program before 1.0.0.
const OLD_HOOK: &str = "coucou-hook";

/// Done once, before anything reads or writes its files (the log included: it's written after).
pub fn move_from_old_name() {
    let mut notes: Vec<String> = Vec::new();
    let config = crate::settings::config_dir();
    let local = crate::settings::local_dir();
    let old_local = local.with_file_name(OLD_DIR);
    let old_hook = old_local.join("bin");
    let moved_local = move_dir(&old_local, &local, &mut notes);
    move_dir(&config.with_file_name(OLD_DIR), &config, &mut notes);
    if moved_local {
        let _ = std::fs::rename(local.join("coucou.log"), local.join("jarvis.log"));
        point_hooks_at_new_name(&old_hook, &crate::settings::hook_exe_path(), &mut notes);
    }
    #[cfg(windows)]
    if let Some(base) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        // The windows' own data (what the pages keep), under the app's identifier.
        move_dir(&base.join(OLD_SERVICE), &base.join("com.nullzedz.jarvis"), &mut notes);
    }
    if crate::secrets::adopt_old(OLD_SERVICE) > 0 {
        notes.push("keys copied to JARVIS's name in the keychain".into());
    }
    for n in notes {
        crate::log::line(format!("legacy: {n}"));
    }
}

/// `from` becomes `to`. If `to` is already there (an early log line made it), what it lacks
/// comes over from `from`; nothing of JARVIS's is ever overwritten.
fn move_dir(from: &Path, to: &Path, notes: &mut Vec<String>) -> bool {
    if !from.is_dir() {
        return false;
    }
    if to.exists() {
        let mut moved = 0;
        if let Ok(entries) = std::fs::read_dir(from) {
            for e in entries.flatten() {
                let target = to.join(e.file_name());
                if !target.exists() && std::fs::rename(e.path(), &target).is_ok() {
                    moved += 1;
                }
            }
        }
        let _ = std::fs::remove_dir(from);
        if moved > 0 {
            notes.push(format!("merged {moved} item(s) from {} into {}", from.display(), to.display()));
        }
        return moved > 0;
    }
    match std::fs::rename(from, to) {
        Ok(()) => {
            notes.push(format!("moved {} to {}", from.display(), to.display()));
            true
        }
        Err(err) => {
            notes.push(format!("couldn't move {}: {err}", from.display()));
            false
        }
    }
}

/// The agents' settings files (Claude Code, Codex, Gemini, Cursor, Copilot, OpenCode…) that
/// run the old hook program by its path now run the new one. Each file changed is backed up
/// next to itself first (`.before-jarvis`).
fn point_hooks_at_new_name(old_bin: &Path, new_exe: &Path, notes: &mut Vec<String>) {
    let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from) else { return };
    let old_exe = old_bin.join(format!("{OLD_HOOK}{}", std::env::consts::EXE_SUFFIX));
    let pairs = path_forms(&old_exe, new_exe);
    let dirs = [".claude", ".codex", ".gemini", ".cursor", ".copilot", ".config", ".hermes", ".factory", ".qwen", ".antigravity", ".gemini-antigravity", ".amp"];
    let mut changed = 0;
    for d in dirs {
        walk(&home.join(d), 0, &mut |file| {
            if rewrite(file, &pairs) {
                changed += 1;
            }
        });
    }
    if changed > 0 {
        notes.push(format!("hooks pointed at the new hook program in {changed} agent settings file(s)"));
    }
}

/// The old and new paths as they're written in settings files: as they are, with forward
/// slashes, and with JSON's doubled backslashes.
fn path_forms(old: &Path, new: &Path) -> Vec<(String, String)> {
    let (o, n) = (old.to_string_lossy().to_string(), new.to_string_lossy().to_string());
    let mut pairs = vec![(o.replace('\\', "/"), n.replace('\\', "/")), (o.replace('\\', "\\\\"), n.replace('\\', "\\\\"))];
    if o.contains('\\') {
        pairs.push((o, n));
    }
    pairs.dedup();
    pairs
}

fn walk(dir: &Path, depth: usize, each: &mut dyn FnMut(&Path)) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        let Ok(kind) = e.file_type() else { continue };
        if kind.is_dir() {
            let name = e.file_name().to_string_lossy().to_string();
            if !["node_modules", "projects", "cache", "Cache", "logs", "sessions", "todos", "shell-snapshots"].contains(&name.as_str()) {
                walk(&p, depth + 1, each);
            }
        } else if kind.is_file() && e.metadata().is_ok_and(|m| m.len() <= 1_000_000) {
            let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            if ["json", "jsonc", "toml", "yaml", "yml", "js", "ts", "mjs", "py", "sh", "md"].contains(&ext.as_str()) {
                each(&p);
            }
        }
    }
}

/// The file with every old form of the path replaced, backed up first; whether it changed.
fn rewrite(file: &Path, pairs: &[(String, String)]) -> bool {
    let Ok(text) = std::fs::read_to_string(file) else { return false };
    let new = replace_all(&text, pairs);
    if new == text {
        return false;
    }
    let mut backup = file.as_os_str().to_owned();
    backup.push(".before-jarvis");
    std::fs::copy(file, PathBuf::from(backup)).is_ok() && std::fs::write(file, new).is_ok()
}

fn replace_all(text: &str, pairs: &[(String, String)]) -> String {
    pairs.iter().fold(text.to_string(), |t, (o, n)| t.replace(o.as_str(), n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_way_a_hook_path_is_written_is_moved() {
        let pairs = path_forms(Path::new(r"C:\Users\Sam\AppData\Local\Coucou\bin\coucou-hook.exe"), Path::new(r"C:\Users\Sam\AppData\Local\JARVIS\bin\jarvis-hook.exe"));
        let json = r#"{"command": "C:/Users/Sam/AppData/Local/Coucou/bin/coucou-hook.exe --agent claude Stop", "b": "C:\\Users\\Sam\\AppData\\Local\\Coucou\\bin\\coucou-hook.exe x"}"#;
        let out = replace_all(json, &pairs);
        assert!(!out.contains("coucou"));
        assert!(out.contains("C:/Users/Sam/AppData/Local/JARVIS/bin/jarvis-hook.exe --agent claude Stop"));
        assert!(out.contains(r"C:\\Users\\Sam\\AppData\\Local\\JARVIS\\bin\\jarvis-hook.exe x"));
    }

    #[test]
    fn a_folder_moves_only_where_jarvis_has_none() {
        let base = std::env::temp_dir().join(format!("jarvis-legacy-{}", std::process::id()));
        let (old, new) = (base.join("Old"), base.join("New"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("settings.json"), "{}").unwrap();
        let mut notes = Vec::new();
        assert!(move_dir(&old, &new, &mut notes));
        assert!(new.join("settings.json").exists() && !old.exists());
        // Both there: what JARVIS's lacks comes over, its own stays.
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("settings.json"), "old").unwrap();
        std::fs::write(old.join("notes.json"), "[]").unwrap();
        assert!(move_dir(&old, &new, &mut notes));
        assert_eq!(std::fs::read_to_string(new.join("settings.json")).unwrap(), "{}");
        assert!(new.join("notes.json").exists());
        let _ = std::fs::remove_dir_all(&base);
    }
}
