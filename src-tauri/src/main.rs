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
const SUPERVISE_INTERVAL: Duration = Duration::from_millis(500);
const RESTART_DELAY_MIN: Duration = Duration::from_secs(1);
const RESTART_DELAY_MAX: Duration = Duration::from_secs(30);
const STABLE_UPTIME: Duration = Duration::from_secs(60);
const REFRESH_MENU_ID: &str = "refresh-lifeos";

struct Server {
    child: Child,
    url: String,
    started: Instant,
}

struct ServerProcess(Mutex<Option<Server>>);

impl ServerProcess {
    fn replace(&self, child: Child, url: String) -> Option<Child> {
        let server = Server {
            child,
            url,
            started: Instant::now(),
        };
        self.0
            .lock()
            .expect("server process lock poisoned")
            .replace(server)
            .map(|old| old.child)
    }

    fn stop(&self) {
        let Some(server) = self.0.lock().expect("server process lock poisoned").take() else {
            return;
        };
        Self::stop_child(server.child);
    }

    fn is_running(&self) -> bool {
        self.0.lock().expect("server process lock poisoned").is_some()
    }

    /// Takes the current server out if it has exited, returning its address and uptime.
    fn take_exited(&self) -> Option<(String, String, Duration)> {
        let mut guard = self.0.lock().expect("server process lock poisoned");
        let status = guard.as_mut()?.child.try_wait().ok().flatten()?;
        let server = guard.take()?;
        Some((status.to_string(), server.url, server.started.elapsed()))
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
            let (child, url) = start_server(&workspace, 0)?;
            let window_url = url.parse()?;
            if let Some(old_child) = app.state::<ServerProcess>().replace(child, url) {
                ServerProcess::stop_child(old_child);
            }

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(window_url))
                .title("LifeOS")
                .inner_size(1440.0, 920.0)
                .min_inner_size(980.0, 680.0)
                .resizable(true)
                .build()?;

            let handle = app.handle().clone();
            thread::spawn(move || supervise_server(handle));
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
    let (child, url) = start_server(&workspace, 0)?;
    if app.state::<AppLifecycle>().exiting.load(Ordering::Acquire) {
        ServerProcess::stop_child(child);
        return Ok(());
    }
    if let Err(error) = show_server(app, &url) {
        ServerProcess::stop_child(child);
        return Err(error);
    }

    let server = app.state::<ServerProcess>();
    let old_child = server.replace(child, url);
    if app.state::<AppLifecycle>().exiting.load(Ordering::Acquire) {
        server.stop();
    }
    if let Some(old_child) = old_child {
        ServerProcess::stop_child(old_child);
    }
    Ok(())
}

/// Restarts a server that stopped on its own. Without this the window stays open
/// on a dead address and every save fails with WebKit's bare "Load failed".
fn supervise_server(app: AppHandle) {
    let mut lost: Option<String> = None;
    let mut delay = RESTART_DELAY_MIN;
    loop {
        thread::sleep(if lost.is_some() {
            delay
        } else {
            SUPERVISE_INTERVAL
        });
        let lifecycle = app.state::<AppLifecycle>();
        if lifecycle.exiting.load(Ordering::Acquire) {
            return;
        }
        // Sharing the refresh flag keeps a restart and Command-R from racing.
        if lifecycle
            .refreshing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            continue;
        }

        let server = app.state::<ServerProcess>();
        if lost.is_some() && server.is_running() {
            // A refresh already replaced it.
            lost = None;
        }
        let mut wait = false;
        if lost.is_none() {
            if let Some((status, url, uptime)) = server.take_exited() {
                eprintln!("LifeOS server stopped unexpectedly ({status}); restarting it.");
                // A server that keeps failing soon after startup restarts after
                // growing delays; one that ran for a while restarts at once.
                if uptime < STABLE_UPTIME {
                    delay = (delay * 2).min(RESTART_DELAY_MAX);
                    wait = true;
                } else {
                    delay = RESTART_DELAY_MIN;
                }
                lost = Some(url);
            }
        }
        if let (false, Some(url)) = (wait, lost.as_deref()) {
            match restart_server(&app, url) {
                Ok(()) => lost = None,
                Err(error) => {
                    eprintln!("LifeOS server restart failed: {error}");
                    delay = (delay * 2).min(RESTART_DELAY_MAX);
                }
            }
        }
        lifecycle.refreshing.store(false, Ordering::Release);
    }
}

fn restart_server(app: &AppHandle, previous_url: &str) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = workspace_root()?;
    // Reusing the port keeps the open page's address valid, so it recovers
    // without a reload that would discard what the person was typing.
    let port = previous_url
        .parse::<tauri::Url>()
        .ok()
        .and_then(|url| url.port())
        .unwrap_or(0);
    let (child, url) = start_server(&workspace, port)?;
    if app.state::<AppLifecycle>().exiting.load(Ordering::Acquire) {
        ServerProcess::stop_child(child);
        return Ok(());
    }
    if url != previous_url {
        if let Err(error) = show_server(app, &url) {
            ServerProcess::stop_child(child);
            return Err(error);
        }
    }
    app.state::<ServerProcess>().replace(child, url);
    Ok(())
}

/// Points the window at a server's address, keeping the current route.
fn show_server(app: &AppHandle, url: &str) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("LifeOS main window is unavailable.")?;
    let mut target = url
        .parse::<tauri::Url>()
        .map_err(|error| format!("LifeOS server returned an invalid URL: {error}"))?;
    if let Ok(current) = window.url() {
        target.set_path(current.path());
        target.set_query(current.query());
        target.set_fragment(current.fragment());
    }
    window
        .navigate(target)
        .map_err(|error| format!("Could not load the LifeOS server: {error}"))?;
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

/// Starts the workspace server on `port`, or an OS-assigned port when it is 0.
fn start_server(workspace: &Path, port: u16) -> Result<(Child, String), Box<dyn std::error::Error>> {
    let node = node_executable()?;
    let mut child = Command::new(&node)
        .arg(workspace.join("scripts/dev-server.mjs"))
        .current_dir(workspace)
        .env("PORT", port.to_string())
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
