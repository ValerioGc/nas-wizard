# nas-wizard

Il wizard di nas-os: la configurazione iniziale del NAS, dall'installazione di Debian 13 alla prima
pagina di accesso. È l'unico pacchetto che l'utente scarica (`ValerioGc/nas-wizard`); gateway
([../nas-gateway](../nas-gateway/README.md)) e launcher ([../nas-launcher](../nas-launcher/README.md)) li scarica il wizard,
all'ultima versione, con il token dato durante la configurazione.

## Il percorso

1. L'utente scarica `nas-wizard-<versione>-linux-x64.tar.gz` con il suo `.sha256`, lo copia sul
   NAS e lo estrae.
2. Esegue `sudo ./install.sh`, lo script di avvio, che non chiede niente:
   - controlla che sistema, `/etc`, `/var/lib` e swap siano cifrati con LUKS e che ci sia un TPM
     2.0 (`packages/pre_wizard/check-security.sh`), e se manca qualcosa si ferma prima di cambiare
     la macchina; con `--update` e con `--development` avvisa soltanto, e `--development` lo annota
     in `/var/lib/nas-wizard/security-development`, che il launcher segnala a ogni avvio;
   - esegue quello che serve prima del wizard (`packages/pre_wizard`): la configurazione del sistema
     operativo (`packages/os_configuration`: pacchetti e firewall di base);
   - chiede a GitHub, senza token, se esiste un wizard più recente e, se c'è, lo scarica, lo verifica
     ed esegue quello al suo posto;
   - installa il wizard in `/usr/local/lib/nas-wizard`, lo avvia come unità `nas-wizard` sulla
     porta 80 e lo segue fino alla fine. L'unità resta sulla macchina, disattivata dopo il
     passaggio al gateway: il ripristino del launcher la riavvia.
3. Dal browser l'utente completa il wizard: account, nome del NAS con lingua e tema, rete Wi-Fi,
   token e riepilogo. L’account usa nome utente e password; l’mTLS si configura solo dopo
   l’accesso, nel Centro sicurezza del NAS.
4. Il wizard esegue quello che viene dopo (`packages/post_wizard`) con il token appena dato: scarica
   gateway e launcher, ne verifica i checksum e li installa (`gateway_installation`,
   `ui_installation`), salva il token, crea l'utente del terminale e prepara i dischi dati
   (`ui_configuration`), crea l'account nel gateway e comunica nome del NAS, lingua e tema al launcher, che fa
   del nome il nome host della macchina. Per ultimo mette i manuali nella home dell'utente del
   terminale e svuota la cartella scompattata (resta solo `uninstall.sh`) insieme all'archivio
   accanto.
5. Alla fine offre l'autorità del NAS da installare per HTTPS. Il pulsante per accedere lascia
   le porte al gateway (HTTP sulla 80 e HTTPS sulla 443) e termina: la pagina passa da sola
   all'interfaccia del NAS, dove si accede con nome utente e password.

Dopo la prima configurazione il wizard si aggiorna con il NAS: il launcher lo controlla insieme a sé
stesso e al gateway (Impostazioni > Aggiornamenti) e lo installa con `sudo ./install.sh --update`
dal pacchetto nuovo. In questo modo lo script riconfigura il sistema operativo (idempotente, porta
per esempio le modifiche del firewall) e mette il wizard nuovo in `/usr/local/lib/nas-wizard`, senza
cercare altre versioni e senza avviarlo. Lo stesso avviene prima di un ripristino di fabbrica,
quando c'è un wizard più recente.

Il manuale di installazione ([system/installation_manual](system/installation_manual)) descrive il
percorso per chi installa e finisce in PDF nel pacchetto, con la versione del wizard. Il manuale
utente è del launcher ([../nas-launcher/docs/user_manual](../nas-launcher/docs/user_manual)): il
wizard copia entrambi nella home dell'utente del terminale.

## Avvio in sviluppo

Servono Node `^22.18.0 || >=24.12.0`, pnpm e Rust stable. In locale si installa con pnpm, le
pipeline con `npm ci` da `package-lock.json`: `pnpm install` lo riallinea da solo, dopo `pnpm add`,
`update` o `remove` va lanciato `pnpm run lock:npm`, e `pnpm run lint` fallisce finché i due non
corrispondono.

```bash
pnpm install
pnpm run backend:dev    # il wizard su 127.0.0.1:3006, senza installare niente
pnpm run dev            # in un secondo terminale: Vite inoltra /api al wizard
```

Senza `WIZARD_MODE=real` il wizard scarica davvero le release, in `backend/data`, ma non installa
niente e non cambia la rete: ogni passo dice che è simulato. `NAS_GITHUB_API` lo punta a una forge
diversa da GitHub, come fanno gli e2e.

## Verifiche

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

`pnpm run release:test` le esegue tutte in ordine e costruisce manuale e pacchetto. Struttura,
regole e rilascio sono in [DEVELOPMENT.md](DEVELOPMENT.md).

## NAS Finder

Durante la prima configurazione il wizard risponde alle richieste di NAS Finder su UDP 39877,
mostrando nome, stato di configurazione e porta della pagina web. Il firewall di base ha il set
`nas_discovery`, vuoto di default: il wizard ci mette la porta, aperta alla sola rete locale, e la
toglie quando smette di rispondere, al passaggio al gateway. Da lì la riapre il launcher, solo
mentre l'opzione "Rilevamento in rete" di Security Center è accesa.

Funzionamento, verifica e limiti della prova sono documentati in
[Integrazione NAS Finder](../destkop-apps/nas-finder/NAS-INTEGRATION.md).
La discovery non modifica autenticazione, HTTPS, mTLS o accesso al sistema.
