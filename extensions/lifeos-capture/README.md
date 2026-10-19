# LifeOS Capture

Click the toolbar icon once. The page becomes a task in **Web Articles**, with
the page title, its full link in Notes, **Low** priority, and **today** as its due
date in LifeOS's configured timezone. The project is created on the first save.

The compact popup shows the save status, title, source link, and **Open LifeOS**.
Extra text appears only when something needs attention. Repeating a capture finds the existing non-trashed
task and preserves your edits, including its date, priority, project and completed
status. Removing the URL from Notes also removes its duplicate-match identity.
Trashed pages can be saved again. Tags are left empty; add them in LifeOS.

## Install in Brave on macOS

Run `npm run capture:install` from the repository. This installs a local release
in Application Support, independent of the checkout. Then load that copy once:

1. Enter `brave://extensions` in Brave's address bar.
2. Enable **Developer mode**, choose **Load unpacked**, and select this folder:
   `~/Library/Application Support/LifeOS/browser-capture/extensions/lifeos-capture`.
   In the folder picker, **Command-Shift-G** lets you paste the path directly.
3. In Brave's puzzle-piece Extensions menu, pin **LifeOS Capture**.
4. Open any ordinary webpage and click the small green **L** icon once.
   Look for **Saved to LifeOS**. No form or second save click is needed.
5. Open LifeOS, go to **Tasks → Web Articles**, and open the new task.
   Check the title, Low priority, today's date, and **Read on [website]** link.
6. Click the icon again on the same page: it should say **Already in LifeOS**
   and leave just one task.
7. Quit and reopen Brave, then check that the pinned icon still captures pages.

If the earlier test version is loaded from the repository, remove that LifeOS
Capture entry first, then load the Application Support folder above and pin it.
Captured tasks stay in LifeOS. Keep Developer mode enabled and keep the installed
folder in place. This is a private unpacked installation; no store publication is
needed for this setup.

Use **LifeOS Dev → Refresh LifeOS** (Command-R) once if the desktop app was
already open when these changes were installed. This refreshes the new clickable
link control. You can edit the due date and priority in the task normally.

## How it stays small

- Manifest V3, plain HTML/CSS/JavaScript, no framework or runtime packages.
- Only `activeTab` and `nativeMessaging` permissions. No website host grants,
  content scripts, history access, browser storage, network requests or AI calls.
- The extension reads only the clicked tab's title and URL, not page contents.
- An event-driven service worker finishes the save if the popup is dismissed.
  A small Node helper starts for each request and then exits. Optional cloud
  snapshot work uses a short-lived child with a two-second deadline, so stalled
  cloud filesystem access cannot leave a helper running. No resident capture
  server, polling or port configuration is needed.
- The helper uses LifeOS's validated, locked, atomic store transaction and its
  existing backup configuration. Capture gives the optional cloud snapshot two
  seconds; an unavailable or slow backup reports **Saved locally** with a backup
  warning, never a failed capture. The local recovery copy is already written.
- Saving works without the LifeOS desktop window or web server running.

This release requires macOS, an existing Node runtime, and the existing local
LifeOS store. Saving from the installed copy works without Atlas mounted. The
**Open LifeOS** button still launches the source-backed LifeOS Dev desktop app,
which needs its workspace. Capture saves a link, not an offline article copy. Browser
settings, local files, new tabs and URLs containing embedded credentials are
rejected. Login-protected pages still require their normal login when revisited.

## Update or remove

After updating the repository, run `npm run capture:install`, then reload LifeOS
Capture in Brave's extension manager. The installer copies only the extension
and its small helper runtime, creates a launcher, and registers the native host.
It copies no personal data or development dependencies and does not edit Brave
profile preferences. Its files live here:

- `~/Library/Application Support/LifeOS/browser-capture/`
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.lifeos.capture.json`

Brave on macOS intentionally discovers native helpers in Chrome's directories,
even when Chrome is not installed. Registering only under Brave's own profile
directory does not work. This follows
[Brave's native-messaging path override](https://github.com/brave/brave-core/blob/master/app/brave_main_delegate.cc).

The launcher's explicit data directory is taken from LifeOS's storage resolution
at installation time, including an intentional `LIFEOS_DATA_DIR` override. Run
the installer again if the active store moves. The host allows only the extension
ID derived from the public `key` in the manifest. That key is not a secret.

To remove it, remove LifeOS Capture in Brave, then remove only the two paths
above. Keep the parent LifeOS directory: it holds the personal store. Captured
tasks remain in LifeOS. Store publication and other operating systems are outside
this release.

## Verification

`npm run check` checks the JavaScript, Node tests, and desktop compilation.
Focused tests exercise real framed native messages, timezone boundaries,
simultaneous writes, duplicate detection, recoverable Trash, malformed requests,
backup failure, missing helper feedback, safe opening of saved links, and captures
through an installed copy in a temporary Application Support directory.

The popup and LifeOS task details were rendered against an isolated demo store;
the popup preview substitutes browser APIs while exercising the real native
helper. Automated tests use isolated stores. After the user installed the
extension, a real Brave toolbar capture and duplicate retry were verified: the
requested article was saved once, with the intended defaults. The popup confirms
local success even when the optional cloud backup stalls. Loading the new release
folder and checking persistence after a full Brave restart are manual steps;
the browser-control policy prevents automated access to the extension manager.

Platform references: [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab),
[Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[Brave extension support](https://support.brave.com/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave).
