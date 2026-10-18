# nas-wizard

The nas-os wizard handles initial NAS setup, from installing Debian 13 to the first sign-in page.
It is the only package the user downloads (`ValerioGc/nas-wizard`). The wizard downloads the
latest [gateway](../nas-gateway/README.md) and [launcher](../nas-launcher/README.md) releases,
using the token provided during setup when required.

## Installation flow

1. Download `nas-wizard-<version>-linux-x64.tar.gz` and its `.sha256`, copy them to the NAS, and
   extract the archive.
2. Run `sudo ./install.sh`. This entry script requires no interactive input. It:
   - checks that the system, `/etc`, `/var/lib`, and swap use LUKS encryption and that a TPM 2.0 is
     present (`packages/pre_wizard/check-security.sh`). Missing protection produces a warning but
     does not stop installation. Results are saved in `/var/lib/nas-wizard/security`
     (`system=encrypted|plain`, `tpm=present|missing`). The launcher displays a notification once
     and shares this status with the Disks app. `--development` remains accepted but is no longer
     needed;
   - runs the pre-wizard tasks (`packages/pre_wizard`), including operating-system configuration
     (`packages/os_configuration`: packages and the base firewall);
   - asks GitHub, without a token, whether a newer wizard exists. If so, it downloads and verifies
     that release and runs its entry script instead;
   - installs the wizard in `/usr/local/lib/nas-wizard`, starts the `nas-wizard` systemd unit on
     port 80, and follows it until completion. The unit remains installed but disabled after
     handover to the gateway, so the launcher's reset operation can restart it.
3. Complete setup in the browser: account, NAS name, language, theme, Wi-Fi, optional data-disk
   initialization, release token, and summary. The account uses a username and password. Device
   certificates and mTLS are configured later in Security Center after signing in.
4. The wizard runs `packages/post_wizard` with the supplied token. It downloads and verifies the
   gateway and launcher, installs them (`gateway_installation`, `ui_installation`), stores the
   token, creates the terminal user, and prepares data disks (`ui_configuration` and the optional
   disk-initialization step). It creates the gateway account and sends the NAS name, language, and
   theme to the launcher, which applies the hostname. Finally, it copies the manuals to the
   terminal user's home and empties the extracted package directory, keeping only `uninstall.sh`.
   The adjacent archive is removed too.
5. Download the NAS authority certificate for trusted HTTPS access. The sign-in button hands the
   ports to the gateway (HTTP 80 and HTTPS 443), then closes the wizard. The page automatically
   opens the NAS interface, where users sign in with their username and password.

After initial setup, the launcher checks for wizard updates alongside its own and the gateway's
(Settings > Updates). It installs a new wizard with `sudo ./install.sh --update` from the new
package. This reapplies the idempotent operating-system configuration, including firewall
changes, and replaces `/usr/local/lib/nas-wizard` without checking for another version or starting
the wizard. The same update happens before a factory reset when a newer wizard is available.

The [installation manual](system/installation_manual) describes this process for installers and
is included as a PDF with the wizard's version. The launcher owns the
[user manual](../nas-launcher/docs/user_manual); the wizard copies both manuals to the terminal
user's home.

## Development

Use Node `^22.18.0 || >=24.12.0`, pnpm, and stable Rust. Local development uses pnpm; pipelines use
`npm ci` with `package-lock.json`. `pnpm install` synchronizes that lockfile automatically. After
`pnpm add`, `update`, or `remove`, run `pnpm run lock:npm`. Lint fails until the manifest and npm
lockfile agree.

```bash
pnpm install
pnpm run backend:dev    # Wizard on 127.0.0.1:3006 without installing anything
pnpm run dev            # In a second terminal: Vite proxies /api to the wizard
```

Without `WIZARD_MODE=real`, releases are downloaded into `backend/data`, but nothing is installed
and the network is unchanged. Each installation step reports that it is simulated. `NAS_GITHUB_API`
selects a forge other than GitHub, as used by the end-to-end tests.

## Checks

```bash
pnpm run format:check
pnpm run lint
pnpm run build
pnpm run test:unit
pnpm run test:component
pnpm run test:e2e
cargo fmt --manifest-path backend/Cargo.toml --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml
```

`pnpm run release:test` runs all checks in sequence and builds the manual and release package.
See [DEVELOPMENT.md](DEVELOPMENT.md) for structure, rules, and releases.

## NAS Finder

During initial setup, the wizard responds to NAS Finder requests on UDP 39877 with the hostname,
configuration status, and web port. The base firewall's `nas_discovery` set is empty by default.
The wizard adds the discovery port, allowing local-network access only, and removes it when
handing control to the gateway. Afterward, the launcher reopens it only while Security Center's
network discovery option is enabled.

Behavior, checks, and verification limits are documented in
[NAS Finder integration](../destkop-apps/nas-finder/NAS-INTEGRATION.md).
Discovery does not change authentication, HTTPS, mTLS, or system access.
