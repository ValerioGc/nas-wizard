# Sviluppo di nas-wizard

## Struttura

```text
install.sh                       # Lo script di avvio: finisce nella radice del pacchetto
src/
  App.vue, main.ts               # Una pagina sola, senza router né Pinia
  views/WizardView.vue           # I passi della configurazione e l'installazione
  components/                    # Un passo per componente, l'avanzamento, i controlli comuni
  api/client.ts                  # HTTP verso il wizard, con l'errore che il wizard spiega
  composables/                   # Tema della pagina e lettura periodica
  i18n/                          # Catalogo italiano e inglese del wizard
  styles/                        # Token, temi, placeholder, mixin e superficie comune
  types/types.ts                 # I tipi del wizard
  tests/                         # Stessi percorsi di src: unit, component, script ed e2e
backend/
  axum/src/
    main.rs                      # Serve il wizard e passa la porta 80 al gateway; self-update
    config.rs                    # L'ambiente: modo reale, forge, repository, cartelle, script
    state.rs                     # Fase, passi e scelte, in memoria
    installer.rs                 # Lo script dopo il wizard, i suoi passi, fetch, complete, il
                                 #   passaggio al gateway
    forge.rs                     # Release di GitHub, scaricamento, checksum, scompattamento
    account.rs                   # Le regole dell'account e dell'utente del terminale
    network.rs                   # Rete con ip, sysfs e nmcli
    token.rs                     # Il token, repository per repository
    self_update.rs               # Un wizard più recente, per lo script di avvio
    http/                        # Rotte, errore tipizzato, estrattore JSON, file dell'interfaccia
  tests/                         # Test Rust, stessi percorsi di axum/src; support.rs è condiviso
system/packages/pre_wizard/      # Prima del wizard: controllo di LUKS e TPM, configurazione del sistema
system/packages/os_configuration/  # Pacchetti di sistema e firewall di base
system/packages/post_wizard/     # Dopo il wizard: scarica, installa e configura gateway e launcher
system/packages/uninstall.sh     # Rimozione completa del NAS
system/installation_manual/      # Manuale di installazione, in PDF nel pacchetto
scripts/                         # Formattazione, build e rilascio
```

## Come funziona

Il wizard gira come root, solo finché serve: lo script di avvio lo copia in
`/usr/local/lib/nas-wizard` (binario, interfaccia, `packages/post_wizard` e
`packages/os_configuration`, con la stessa struttura del pacchetto) e scrive l'unità
`nas-wizard.service`, con `WIZARD_MODE=real`, la porta 80, la cartella di stato `/var/lib/nas-wizard`
e `NAS_WIZARD_PACKAGE`, la cartella estratta, che `post_wizard` svuota alla fine. Quando parte un
wizard più recente al suo posto, `NAS_WIZARD_ORIGIN` gli dice qual era la cartella dell'utente. La abilita e la avvia senza chiedere niente: il token si dà nella pagina. Al
passaggio al gateway il wizard la disattiva, ma l'unità resta: il ripristino del launcher
(`nas-os-reset.service`) cancella i dati e la avvia di nuovo. Prima del gateway non
c'è nessun account: come la pagina di configurazione di un router, il wizard risponde a chi lo
raggiunge per primo, e termina appena ha finito.

La pagina del wizard è `/setup`: `/` risponde con un redirect temporaneo (307), senza cache,
a `/setup`. Il percorso relativo mantiene protocollo, host e porta del browser, anche con
l'inoltro `localhost:8080` alla porta 80 della VM. Lo script stampa direttamente `/setup`.
Quando la pagina si apre, rilegge `/` con `cache: reload` e senza seguire redirect: sostituisce
un eventuale redirect permanente memorizzato da un gateway precedente. Prima di aprire `/login`,
fa lo stesso controllo su quella pagina con `cache: reload` e `redirect: error`. Un redirect o
un errore della login lascia il wizard in attesa. Cookie e impostazioni del browser restano intatti.

Lo stato sta in memoria. Un wizard interrotto si riavvia dallo script di avvio, e ogni passo si può
ripetere: gli installer sono rieseguibili, `nas-os-gateway account create` che trova l'account già
creato esce con 3, e il launcher già configurato risponde 409. Entrambi i casi contano come passo
riuscito.

Il lavoro dopo i passi della pagina è `system/packages/post_wizard/install.sh`, eseguito come root.
Il wizard gli passa le scelte come argomenti e il token, il nome dell'account e la password sulle
prime tre righe dell'input, mai sulla riga di comando. Lo script annuncia ogni passo sull'output
(`@@step <id>`, `@@detail <testo>`, `@@done <id>`), il wizard li legge e li mostra nella pagina, e
uno script che esce con un errore lascia fallito il passo in corso con le ultime righe dell'output.
Un nuovo tentativo riparte con `--from <passo>`; senza `WIZARD_MODE=real` lo script gira con
`--simulate`. Per quello che il Rust fa già, lo script richiama il binario: `nas-wizard fetch
<gateway|ui> --into <cartella>` scarica e verifica una release con il token in `WIZARD_TOKEN_PATH`,
`nas-wizard complete` chiude la configurazione sul launcher.

I passi:

| Passo              | Cosa fa                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `download_gateway` | `nas-wizard fetch gateway`: ultima release, checksum obbligatorio                          |
| `download_ui`      | `nas-wizard fetch ui`: ultima release, checksum obbligatorio                               |
| `install_gateway`  | `gateway_installation/install.sh --no-start`: la porta 80 è ancora del wizard              |
| `install_ui`       | `ui_installation/install.sh`: il launcher parte su `127.0.0.1:3000`                        |
| `configure`        | `ui_configuration/install.sh --user <utente>`, con il token sull'input                     |
| `disks`            | `nas-wizard disks <file>`: i dischi vuoti scelti, preparati dal codice root del launcher   |
| `account`          | `nas-os-gateway account create` con `systemd-run`, utente dinamico e cartella del gateway  |
| `certificate`      | Solo CA del NAS (`nas-os-gateway ca`), senza dispositivi o attivazione mTLS                |
| `complete`         | `nas-wizard complete`: aspetta il launcher (si riavvia per il token), poi `setup/complete` |
| `handover`         | Dopo la conferma della pagina: chiude il listener, avvia il gateway, aspetta `/health`     |

Il passo `disks` esiste sempre ma lavora solo se la pagina ha scelto dei dischi: di predefinito,
anche senza sistema cifrato, il wizard mostra il passaggio Dischi dati (`GET /api/wizard/disks`,
`axum/src/disks.rs`), che elenca i dischi interi interni senza il sistema, propone di inizializzare
quelli vuoti e di cifrarli con la sola chiave automatica, perché nel wizard in HTTP non passano
password. Le scelte arrivano a `post_wizard` in `disks.json` nella cartella di lavoro (nessun
segreto) con `--disks`; `nas-wizard disks` le esegue con `nas-os-axum --initialize-storage` e
`nas-os-axum --storage-crypt`, che ricontrollano disco e identità prima di cancellare; le chiavi
stanno in `/run/nas-wizard-disks`. `WIZARD_DISKS_MODE=off` nell'unità nasconde il passaggio,
`WIZARD_ENCRYPTION_MODE=off` toglie la proposta di cifratura.

La password resta in memoria finché l'account non è creato, poi viene cancellata; né lei né il
token compaiono mai nello stato che la pagina legge o nel journal.

Il passo `certificate` fa creare al gateway, con l'identità della sua unità, solo la CA del NAS.
La CA finisce in `ca.pem` nella cartella di lavoro, leggibile solo da root: il wizard la legge,
la cancella e la tiene in memoria. Finiti i passi, la fase è `ready`: la pagina chiede
`GET /api/wizard/certificate`, che risponde solo con `{ caPem }`, e offre la CA da installare
come attendibile per HTTPS. `POST /api/wizard/finish` avvia la consegna. Il gateway risponde in
HTTP sulla 80 e HTTPS sulla 443: la pagina aspetta che `/health` risponda `ok` dal gateway e
apre `/login` sulla stessa origine, conservando anche una porta inoltrata come `localhost:8080`
ed evitando eventuali redirect permanenti su `/` salvati da una vecchia versione del gateway.

Il wizard crea solo l'account con password. Non accetta opzioni mTLS o dati di un dispositivo,
né nella configurazione JSON né nello script post-wizard. Dopo l'accesso al NAS, il Centro
sicurezza crea i certificati dei dispositivi e permette di attivare mTLS con una nuova conferma
della password; il gateway richiede un certificato valido sulla connessione che lo attiva.

La pagina si apre in HTTP semplice da un altro computer, quindi non è un contesto sicuro: niente
`crypto.randomUUID`, Clipboard API o altre API che lo richiedono.

Il wizard installa sempre l'ultima release del gateway e del launcher, senza limiti di versione.

Lo schermo di un monitor collegato al NAS: con `WIZARD_SCREEN_PORT` (8081 nell'unità) il wizard
risponde anche su `127.0.0.1` a quella porta, che alla consegna passa al gateway con la 80. Il
firewall di base la apre solo all'utente `nas-screen`. `nas-wizard screen` (`axum/src/screen.rs`) è
il processo di `nas-os-screen.service`: ogni secondo guarda le uscite in `/sys/class/drm`, legge
gli eventi di `/dev/input/event*` (ognuno su un thread, rilette quando se ne collega uno nuovo) e i
minuti che il launcher scrive in `/var/lib/nas-os/screen-off-minutes` (`NAS_SCREEN_MINUTES`). Con
un monitor collegato avvia `nas-os-screen-browser.service`; scollegato lo ferma; dopo i minuti senza
uso lo ferma e spegne i framebuffer (`blank` a 4), al primo evento li riaccende e lo riavvia.
Conta come collegato solo mentre tty1 è la console in primo piano (`/sys/class/tty/tty0/active`):
`cog` lascia la tastiera al kernel, che con Ctrl+Alt+F2 cambia console da solo, ma tiene lo
schermo finché gira, quindi il processo lo ferma e lascia il terminale testuale visibile. Il
passaggio fra gli stati è `screen::next`, una funzione pura; lo script di avvio riavvia il servizio
dopo ogni installazione, così gira sempre il binario nuovo.

## Regole

Sono quelle della UI, che il wizard condivide: Composition API con `<script setup lang="ts">`,
niente `any`, alias `@/`, nomi composti con `_`, token SCSS al posto dei valori letterali, testo
dell'interfaccia solo da `t`, chiavi in camelCase, mai il trattino lungo, test Rust in
`backend/tests/` inclusi con `#[path]`, nessuna nuova dipendenza senza chiederla.

I componenti comuni (`components/commons`, `AlertBanner`, gli stili) sono una copia di quelli della
UI: il wizard non dipende dalla UI, come le app esterne.

## Rilascio

Come nella UI: `pnpm run release:test` è il cancello locale, `pnpm run release:merge -- --type=...`
sceglie la versione e la scrive in `package.json`, `backend/axum/Cargo.toml` e
`sonar-project.properties`, e il tag avvia `.github/workflows/build.yml`, che compila, costruisce
il manuale di installazione e il pacchetto e pubblica la release tenendo le due più recenti.

Il pacchetto si chiama `nas-wizard-<versione>-linux-x64.tar.gz`: è il nome che lo script di avvio
cerca quando chiede un wizard più recente.

Il pacchetto contiene il manuale di installazione, con la versione del wizard. Il manuale utente
descrive l'interfaccia ed è del launcher: sta nel suo repository, esce nel suo pacchetto con la sua
versione. Alla fine di `post_wizard`, quando il launcher è installato e configurato,
`post_wizard/clean-package.sh` copia nella home dell'utente del terminale il manuale di
installazione (da `/usr/local/lib/nas-wizard`, dove lo mette lo script di avvio) e quello utente
(dal pacchetto del launcher scaricato), al posto di quelli di un'installazione precedente. Poi
svuota la cartella estratta lasciando solo `uninstall.sh` (copiato da `packages/`), toglie
l'archivio `nas-wizard-*-linux-x64.tar.gz` con il suo `.sha256` dalla cartella che la contiene e il
wizard più recente scaricato in `/var/lib/nas-wizard-updates`. Svuota solo una cartella con la
struttura del pacchetto (`install.sh`, `packages/uninstall.sh`, `wizard/`), mai
`/usr/local/lib/nas-wizard`, non lo fa in simulazione e non fa mai fallire l'installazione.
`uninstall.sh`, rimasto da solo, prende gli script di `os_configuration` dal wizard installato e
toglie il wizard per ultimo.

Il manuale in PDF lo genera `md-to-pdf` con un browser
Chromium: quello indicato da `PUPPETEER_EXECUTABLE_PATH`, altrimenti Brave, Chromium o Chrome se
installati, altrimenti quello che Puppeteer scarica da sé.

## Qualità

`pnpm run test:sonar` genera la copertura del frontend e del backend e avvia lo scanner con Podman.
SonarQube si avvia con `pnpm run podman:sonar:up`: è la stessa istanza degli altri progetti di
nas-os, con la chiave `nas-wizard`.
