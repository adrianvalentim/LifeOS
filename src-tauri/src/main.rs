#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
#[cfg(target_os = "macos")]
use tauri::menu::PredefinedMenuItem;
#[cfg(not(target_os = "macos"))]
use tauri::menu::Submenu;
use tauri::{
    menu::{Menu, MenuItemBuilder},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

const SERVER_READY_PREFIX: &str = "LifeOS running at ";
const SERVER_START_TIMEOUT: Duration = Duration::from_secs(20);
const REFRESH_MENU_ID: &str = "refresh-lifeos";

struct ServerProcess(Mutex<Option<Child>>);

impl ServerProcess {
    fn replace(&self, child: Child) -> Option<Child> {
        self.0
            .lock()
            .expect("server process lock poisoned")
            .replace(child)
    }

    fn stop(&self) {
        let Some(child) = self.0.lock().expect("server process lock poisoned").take() else {
            return;
        };
        Self::stop_child(child);
    }

    fn stop_child(mut child: Child) {
        #[cfg(unix)]
        {
            let _ = Command::new("/bin/kill")
                .args(["-TERM", &child.id().to_string()])
                .status();
            for _ in 0..50 {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                thread::sleep(Duration::from_millis(20));
            }
        }

        let _ = child.kill();
        let _ = child.wait();
    }
}

struct AppLifecycle {
    refreshing: AtomicBool,
    exiting: AtomicBool,
}

fn main() {
    let app = tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .manage(AppLifecycle {
            refreshing: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
        })
        .menu(|handle| {
            let menu = Menu::default(handle)?;
            let refresh = MenuItemBuilder::with_id(REFRESH_MENU_ID, "Refresh LifeOS")
                .accelerator("CmdOrCtrl+R")
                .build(handle)?;

            #[cfg(target_os = "macos")]
            {
                let separator = PredefinedMenuItem::separator(handle)?;
                for item in menu.items()? {
                    let Some(submenu) = item.as_submenu() else {
                        continue;
                    };
                    if submenu.text()? == handle.package_info().name {
                        submenu.insert_items(&[&refresh, &separator], 2)?;
                        break;
                    }
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                let lifeos_menu = Submenu::with_items(handle, "LifeOS", true, &[&refresh])?;
                menu.prepend(&lifeos_menu)?;
            }

            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == REFRESH_MENU_ID {
                request_refresh(app.clone());
            }
        })
        .setup(|app| {
            let workspace = workspace_root()?;
            let (child, url) = start_server(&workspace)?;
            if let Some(old_child) = app.state::<ServerProcess>().replace(child) {
                ServerProcess::stop_child(old_child);
            }

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("LifeOS")
                .inner_size(1440.0, 920.0)
                .min_inner_size(980.0, 680.0)
                .resizable(true)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build LifeOS desktop shell");

    app.run(|handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            handle
                .state::<AppLifecycle>()
                .exiting
                .store(true, Ordering::Release);
            handle.state::<ServerProcess>().stop();
        }
    });
}

fn request_refresh(app: AppHandle) {
    let lifecycle = app.state::<AppLifecycle>();
    if lifecycle.exiting.load(Ordering::Acquire)
        || lifecycle
            .refreshing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
    {
        return;
    }

    thread::spawn(move || {
        if let Err(error) = refresh_lifeos(&app) {
            eprintln!("LifeOS refresh failed: {error}");
        }
        app.state::<AppLifecycle>()
            .refreshing
            .store(false, Ordering::Release);
    });
}

fn refresh_lifeos(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = workspace_root()?;
    let (child, url) = start_server(&workspace)?;
    if app.state::<AppLifecycle>().exiting.load(Ordering::Acquire) {
        ServerProcess::stop_child(child);
        return Ok(());
    }

    let Some(window) = app.get_webview_window("main") else {
        ServerProcess::stop_child(child);
        return Err("LifeOS main window is unavailable during refresh.".into());
    };
    let mut target = match url.parse::<tauri::Url>() {
        Ok(target) => target,
        Err(error) => {
            ServerProcess::stop_child(child);
            return Err(format!("LifeOS server returned an invalid URL: {error}").into());
        }
    };
    if let Ok(current) = window.url() {
        target.set_path(current.path());
        target.set_query(current.query());
        target.set_fragment(current.fragment());
    }
    if let Err(error) = window.navigate(target) {
        ServerProcess::stop_child(child);
        return Err(format!("Could not load the refreshed LifeOS server: {error}").into());
    }

    let server = app.state::<ServerProcess>();
    let old_child = server.replace(child);
    if app.state::<AppLifecycle>().exiting.load(Ordering::Acquire) {
        server.stop();
    }
    if let Some(old_child) = old_child {
        ServerProcess::stop_child(old_child);
    }
    Ok(())
}

fn workspace_root() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let workspace = env::var_os("LIFEOS_WORKSPACE")
        .map(PathBuf::from)
        .or_else(|| option_env!("LIFEOS_WORKSPACE").map(PathBuf::from))
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("src-tauri must live inside the LifeOS workspace")
                .to_path_buf()
        });
    let entrypoint = workspace.join("scripts/dev-server.mjs");
    if !entrypoint.is_file() {
        return Err(format!(
            "LifeOS workspace not found at {}. Set LIFEOS_WORKSPACE and rebuild the development app.",
            workspace.display()
        )
        .into());
    }
    Ok(workspace)
}

fn start_server(workspace: &Path) -> Result<(Child, String), Box<dyn std::error::Error>> {
    let node = node_executable()?;
    let mut child = Command::new(&node)
        .arg(workspace.join("scripts/dev-server.mjs"))
        .current_dir(workspace)
        .env("PORT", "0")
        .env("LIFEOS_DESKTOP", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", node.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("LifeOS server stdout is unavailable")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("LifeOS server stderr is unavailable")?;
    let (lines_tx, lines_rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            println!("{line}");
            let _ = lines_tx.send(line);
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("LifeOS server: {line}");
        }
    });

    let deadline = Instant::now() + SERVER_START_TIMEOUT;
    while Instant::now() < deadline {
        match lines_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) if line.starts_with(SERVER_READY_PREFIX) => {
                let url = line[SERVER_READY_PREFIX.len()..].trim().to_string();
                return Ok((child, url));
            }
            Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if let Some(status) = child.try_wait()? {
            return Err(format!("LifeOS server exited before startup with {status}.").into());
        }
    }

    let _ = child.kill();
    let _ = child.wait();
    Err("LifeOS server did not become ready within 20 seconds.".into())
}

fn node_executable() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let mut candidates = Vec::new();
    if let Some(value) = env::var_os("LIFEOS_NODE") {
        candidates.push(PathBuf::from(value));
    }
    if let Some(value) = option_env!("LIFEOS_NODE") {
        candidates.push(PathBuf::from(value));
    }
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/opt/homebrew/bin/node"));
        candidates.push(PathBuf::from("/usr/local/bin/node"));
    }
    candidates.push(PathBuf::from("/usr/bin/node"));

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "Node.js was not found. Set LIFEOS_NODE to its absolute path and rebuild the development app."
                .into()
        })
}
