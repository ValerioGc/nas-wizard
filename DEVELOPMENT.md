# Developing nas-wizard

## Structure

```text
install.sh                       # Entry script placed at the release package root
src/
  App.vue, main.ts               # Single page without a router or Pinia
  views/WizardView.vue           # Setup steps and installation
  components/
    steps/                       # Account, appearance, network, disks, token, installation, and certificate
    layout/                      # Wizard frame and step progress
    alerts/                      # Alert banner
    commons/                     # Shared controls
  api/client.ts                  # HTTP requests with errors explained by the wizard
  composables/                   # Page appearance and polling
  i18n/                          # Italian and English wizard catalogs
  styles/                        # Tokens, themes, placeholders, mixins, and shared surfaces
  types/types.ts                 # Wizard types
  tests/                         # Mirrored source paths: unit, component, script, and end-to-end tests
backend/
  axum/src/
    main.rs                      # Serve the wizard, hand port 80 to the gateway, and handle self-update
    config.rs                    # Environment: real mode, forge, repositories, directories, and scripts
    state.rs                     # In-memory phase, steps, and choices
    installer.rs                 # Post-wizard script, progress, fetch, complete, and gateway handover
    forge.rs                     # GitHub releases, downloads, checksums, and archive extraction
    account.rs                   # Account and terminal-user validation
    discovery.rs                 # Optional NAS Finder discovery over UDP
    disks.rs                     # Data-disk offers, validation, and launcher storage commands
    network.rs                   # Networking through ip, sysfs, and nmcli
    screen.rs                    # Monitor/input watcher and local browser lifecycle
    token.rs                     # Per-repository release-token checks
    self_update.rs               # Newer wizard detection for the entry script
    http/                        # Routes, typed errors, JSON extraction, and static UI files
  axum/tests/                    # Rust tests mirroring src; support.rs contains shared helpers
system/packages/pre_wizard/      # LUKS/TPM checks and operating-system preparation
system/packages/os_configuration/  # System packages and base firewall
system/packages/post_wizard/     # Download, install, and configure the gateway and launcher
system/packages/uninstall.sh     # Full NAS removal
system/installation_manual/      # Installation manual included as a PDF in the package
scripts/                         # Formatting, build, and release tools
```

## Behavior

The wizard runs as root only while needed. The entry script copies the binary, UI,
`packages/post_wizard`, and `packages/os_configuration` into `/usr/local/lib/nas-wizard`, keeping
the release package structure. It writes `nas-wizard.service` with `WIZARD_MODE=real`, port 80,
state directory `/var/lib/nas-wizard`, and `NAS_WIZARD_PACKAGE`, the extracted directory that
`post_wizard` empties at the end. When a newer wizard takes over, `NAS_WIZARD_ORIGIN` identifies
the user's original directory. The entry script enables and starts the unit without prompting;
the token is entered on the page. At gateway handover, the wizard disables its unit but leaves
it installed. The launcher's reset operation (`nas-os-reset.service`) clears data and starts it
again. Before the gateway exists there is no account: like a router's setup page, the wizard
accepts whoever reaches it first and stops once setup is complete.

The wizard page is `/setup`. `/` returns a temporary, uncached 307 redirect to `/setup`. Its
relative location preserves the browser's protocol, host, and port, including forwarding
`localhost:8080` to a VM's port 80. The entry script prints the `/setup` address directly. When
the page opens, it fetches `/` with `cache: reload` without following redirects, replacing any
permanent redirect cached from an older gateway. Before opening `/login`, it checks that page
with `cache: reload` and `redirect: error`. A redirect or failed login-page check keeps the wizard
waiting. Browser cookies and settings are preserved.

State is kept in memory. Restart an interrupted wizard through the entry script. Every step is
repeatable: installers are idempotent, `nas-os-gateway account create` exits with 3 when an account
already exists, and an already configured launcher returns 409. Both cases count as success.

After the browser steps, the wizard runs `system/packages/post_wizard/install.sh` as root. Choices
are passed as arguments; the token, account name, and password travel on the first three lines of
stdin, never on the command line. The script announces progress on stdout (`@@step <id>`,
`@@detail <text>`, `@@done <id>`), which the wizard reads and displays. A failing script marks the
current step as failed and includes the latest output lines. A retry uses `--from <step>`.
Without `WIZARD_MODE=real`, it runs with `--simulate`. The script delegates existing Rust work to
the binary: `nas-wizard fetch <gateway|ui> --into <directory>` downloads and verifies a release
using the token in `WIZARD_TOKEN_PATH`; `nas-wizard complete` completes setup on the launcher.

| Step               | Action                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `download_gateway` | `nas-wizard fetch gateway`: latest release with a required checksum                                        |
| `download_ui`      | `nas-wizard fetch ui`: latest release with a required checksum                                             |
| `install_gateway`  | `gateway_installation/install.sh --no-start`: the wizard still owns port 80                                |
| `install_ui`       | `ui_installation/install.sh`: start the launcher on `127.0.0.1:3000`                                       |
| `configure`        | `ui_configuration/install.sh --user <user>`, with the token on stdin                                       |
| `disks`            | `nas-wizard disks <file>`: prepare selected empty disks through the launcher's root code                   |
| `account`          | `nas-os-gateway account create` through `systemd-run`, with a dynamic user and the gateway state directory |
| `certificate`      | Create only the NAS CA (`nas-os-gateway ca`), without devices or mTLS activation                           |
| `complete`         | `nas-wizard complete`: wait for the launcher, which restarts for the token, then call `setup/complete`     |
| `handover`         | After browser confirmation, close the listener, start the gateway, and wait for `/health`                  |

The `disks` step always exists but only acts when disks were selected. By default, even without
system encryption, the wizard offers a Data disks step (`GET /api/wizard/disks`,
`axum/src/disks.rs`). It lists internal whole disks excluding the system disk, offers to initialize
empty disks, and can encrypt them with only an automatic key because passwords must not travel
through the HTTP wizard. Choices are stored in a non-secret `disks.json` in the working directory
and passed to `post_wizard` with `--disks`. `nas-wizard disks` calls `nas-os-axum --initialize-storage`
and `nas-os-axum --storage-crypt`, which revalidate each disk and its identity before erasing it.
Keys are kept in `/run/nas-wizard-disks`. `WIZARD_DISKS_MODE=off` hides the step;
`WIZARD_ENCRYPTION_MODE=off` disables the encryption offer.

The password stays in memory until account creation, then is cleared. Neither the password nor
the token appears in public state read by the page or in the journal.

The `certificate` step asks the gateway, under its service identity, to create only the NAS CA.
The CA is written to root-readable `ca.pem` in the working directory. The wizard reads it, deletes
the file, and keeps it in memory. Once installation finishes, the phase becomes `ready`.
`GET /api/wizard/certificate` returns only `{ caPem }`, and the page offers the CA as a trusted
HTTPS authority. `POST /api/wizard/finish` starts handover. The gateway serves HTTP 80 and
HTTPS 443. The page waits for the gateway's `/health` to return `ok`, then opens `/login` on the
same origin, preserving forwarded ports such as `localhost:8080` and avoiding permanent redirects
cached on `/` by older gateway versions.

The wizard creates only the password account. It accepts no mTLS options or device data in
configuration JSON or the post-wizard script. After sign-in, Security Center creates device
certificates and enables mTLS with password reconfirmation. Activation requires a valid
certificate on the current gateway connection.

The page is served over plain HTTP to another computer, so it is not a secure context. Do not
use `crypto.randomUUID`, the Clipboard API, or other APIs requiring one.

The wizard always installs the latest gateway and launcher releases without version limits.

For a monitor connected to the NAS, `WIZARD_SCREEN_PORT` (8081 in the unit) adds an HTTP listener
on `127.0.0.1`. Handover passes it to the gateway together with port 80. The base firewall permits
this port only to `nas-screen`. The display watcher is installed disabled; enable it explicitly
with `sudo systemctl enable --now nas-os-screen.service`. Its process, `nas-wizard screen`
(`axum/src/screen.rs`), checks `/sys/class/drm` every second, reads `/dev/input/event*` on separate
threads, discovers newly connected input devices, and reads the launcher's idle timeout from
`/var/lib/nas-os/screen-off-minutes` (`NAS_SCREEN_MINUTES`). It starts
`nas-os-screen-browser.service` when a monitor is connected and stops it when disconnected. On
idle timeout it stops the browser and blanks the framebuffers (`blank` set to 4); the first input
restores the display and browser. The monitor counts as active only while tty1 is the foreground
console (`/sys/class/tty/tty0/active`). `cog` leaves keyboard handling to the kernel, so
Ctrl+Alt+F2 changes consoles, but holds the display while running. The watcher stops it to expose
the text terminal. `screen::next` is a pure function for these state transitions. The entry script
restarts an already running watcher after installation so it uses the new binary.

## Rules

Follow the shared UI conventions: Composition API with `<script setup lang="ts">`, no `any`,
`@/` imports, `_` between words in compound names, SCSS tokens instead of literal values, UI text
through `t`, camelCase translation keys, and no em dashes. Rust tests belong in
`backend/axum/tests/` and are included with `#[path]`. Ask before adding any dependency.

Shared components (`components/commons`, `AlertBanner`, and styles) are copied from the UI. The
wizard does not depend on the launcher UI, just as external applications do not.

The Italian and English catalogs in `src/i18n/` group texts by the current wizard steps
(`welcome`, `account`, `appearance`, `network`, `disks`, `token`, `summary`), followed by
`install` and `certificate`. Shared controls and messages live in `common`. Nested keys use
dot-separated paths, such as `t('account.fields.username')` or `t('install.steps.downloadGateway')`.
Both catalogs must have the same text paths and interpolation parameters.

## Releases

`pnpm run release:test` runs the local checks. `pnpm run release:merge -- --type=...` selects the
version and updates `package.json`, `backend/axum/Cargo.toml`, and `sonar-project.properties`.
The tag triggers `.github/workflows/build.yml`, which compiles, builds the installation manual
and package, and publishes the release while retaining the two latest releases.

The package is named `nas-wizard-<version>-linux-x64.tar.gz`, as expected by the entry script when
checking for a newer wizard.

The package includes the installation manual with the wizard's version. The launcher owns the
user manual describing its UI and includes it in its own release with its own version. At the
end of `post_wizard`, after installing and configuring the launcher, `post_wizard/clean-package.sh`
copies the installation manual from `/usr/local/lib/nas-wizard` and the user manual from the
downloaded launcher package to the terminal user's home, replacing previous versions. It then
empties the extracted directory, keeping only `uninstall.sh` copied from `packages/`. It removes
the adjacent `nas-wizard-*-linux-x64.tar.gz` archive and `.sha256`, and newer wizard downloads
under `/var/lib/nas-wizard-updates`. Cleanup requires the release package structure (`install.sh`,
`packages/uninstall.sh`, `wizard/`), never empties `/usr/local/lib/nas-wizard`, does not run during
simulation, and cannot fail the installation. The remaining `uninstall.sh` uses the installed
wizard's `os_configuration` scripts and removes the wizard last.

`md-to-pdf` generates the installation PDF using Chromium: `PUPPETEER_EXECUTABLE_PATH` if set,
otherwise an installed Brave, Chromium, or Chrome, falling back to Puppeteer's downloaded browser.
Chapters use fenced Bash code blocks, highlighted by `md-to-pdf` without an additional direct
syntax-highlighter import.

## Quality checks

`pnpm run test:sonar` generates frontend and backend coverage and runs the scanner through Podman.
Start SonarQube with `pnpm run podman:sonar:up`. It shares the instance used by other nas-os
projects with its own project key, `nas-wizard`.
