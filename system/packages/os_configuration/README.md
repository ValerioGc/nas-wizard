# Configurazione del sistema operativo

Da eseguire su Debian 13 appena installato, **prima** che il wizard installi gateway e launcher: lo
esegue lo script di avvio del pacchetto del wizard (`install.sh` nella radice). Installa
i pacchetti di sistema mancanti, prepara lo schermo per un monitor collegato al NAS e attiva il
firewall di base.

```bash
sudo ./install.sh
./install.sh --dry-run      # mostra le operazioni senza applicarle
```

| File                         | Scopo                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| `install.sh`                 | Il punto di avvio della configurazione                     |
| `scripts/system-packages.sh` | Installa con `apt-get` i pacchetti di sistema che mancano  |
| `scripts/screen.sh`          | Prepara lo schermo per un monitor collegato al NAS         |
| `scripts/wifi.sh`            | Tiene spento `wpa_supplicant` senza una scheda Wi-Fi       |
| `scripts/firewall.sh`        | Installa e attiva il firewall di base                      |
| `scripts/uninstall.sh`       | Rimuove i pacchetti che lo script precedente ha installato |

## I pacchetti

| Pacchetto         | A cosa serve                                                                   |
| ----------------- | ------------------------------------------------------------------------------ |
| `polkitd`         | Concede al launcher solo le sue azioni: riavvio, rete, avvio delle sue unità   |
| `nftables`        | Trasforma l'elenco degli indirizzi ammessi in un filtro davanti a tutto il NAS |
| `network-manager` | Cerca le reti Wi-Fi e si collega a una di esse dall'interfaccia                |
| `wpasupplicant`   | Si collega alle reti Wi-Fi per NetworkManager, spento senza una scheda Wi-Fi   |
| `wireless-regdb`  | Le regole radio del paese, per le schede Wi-Fi                                 |
| `parted`          | Prepara i dischi dati vuoti scelti in nas-disk-manager, con `e2fsprogs`        |
| `smartmontools`   | Legge lo stato di salute dei dischi per nas-disk-manager                       |

Si installano senza i pacchetti consigliati: `network-manager` porterebbe con sé ModemManager e
`ppp`, che a un NAS non servono. NetworkManager non prende in carico le interfacce già dichiarate in
`/etc/network/interfaces`: una macchina raggiunta via SSH non perde la connessione mentre lo si
installa.

Poi lo script rimuove ModemManager, BlueZ e cron, se ci sono, ciascuno solo quando
`apt-get -s purge` dice che con lui non se ne andrebbe nient'altro: un desktop che ne usa uno lo
tiene, senza trattenere gli altri. Su Debian 13 i lavori periodici del sistema (log, apt, man-db,
dpkg, fstrim) girano con i timer di systemd e nas-os non usa cron; cron resta comunque se un
utente ha un crontab (`/var/spool/cron/crontabs`) o se in `/etc/cron.d` o `/etc/cron.<periodo>`
c'è un lavoro che nessun pacchetto ha installato. Per riaverlo: `sudo apt install cron`. Finisce con
`apt-get autoremove --purge` e `apt-get clean`; una pulizia che non riesce è un avviso, non un
errore.

## Wi-Fi

`scripts/wifi.sh` installa `/usr/local/lib/nas-os-configuration/wifi.sh`, l'unità
`nas-os-wifi.service` che lo esegue a ogni avvio prima di NetworkManager e la regola udev
`80-nas-os-wifi.rules` che lo esegue quando compare una scheda Wi-Fi. Senza schede wireless
(`/sys/class/net/*/wireless`) maschera `wpa_supplicant.service` con `--runtime`, cioè solo in
`/run` fino al riavvio; con una scheda lo smaschera e lo avvia. Il pacchetto resta installato.
`scripts/wifi.sh --remove` toglie tutto e lascia `wpa_supplicant` com'era.

## Schermo

Su una macchina con un'uscita video (`/sys/class/drm/card*`) `scripts/screen.sh` installa `cog`
senza i pacchetti consigliati (WebKit disegna la pagina direttamente sullo schermo con DRM/KMS,
senza server grafico) e lo annota con gli altri pacchetti. Crea l'utente `nas-screen` (gruppi
`video`, `input` e `render`, senza password né shell), il servizio PAM della sua sessione
(`/etc/pam.d/nas-os-screen`) e due unità:

- `nas-os-screen.service`, spenta finché non la si attiva con
  `sudo systemctl enable --now nas-os-screen.service`: esegue `nas-wizard screen` come root, senza
  capability né rete. Pochi MB: guarda le uscite video, le tastiere e i mouse;
- `nas-os-screen-browser.service`: `cog` come `nas-screen` in una sessione propria su tty1, avviata
  solo quando un monitor è collegato (HDMI, DisplayPort, DVI, VGA) e fermata quando si scollega o
  dopo i minuti senza uso delle impostazioni di alimentazione (10 senza scelta), con lo schermo che
  si spegne e il monitor in standby. Al primo tasto riparte. I suoi dati stanno nella cartella di
  runtime e si perdono a ogni arresto: si accede ogni volta con la password. Gira solo mentre tty1
  è la console in primo piano: Ctrl+Alt+F2 (fino a F6) lo ferma e lascia lo schermo al login
  testuale di quel terminale, Ctrl+Alt+F1 lo riporta.

Il browser aspetta che `127.0.0.1:8081` risponda e lo apre: prima della configurazione il wizard,
poi il gateway, che su quella porta non chiede il certificato del dispositivo (mTLS). `scripts/screen.sh --remove` toglie unità, file e utente; `cog` va via con gli
altri pacchetti.

## Firewall

La tabella nftables `nas_base` blocca per impostazione predefinita ingresso, inoltro e uscita.
Sono ammessi il wizard e il redirect del gateway su TCP 80, il gateway HTTPS su TCP 443, SSH TCP 22 da indirizzi privati o link-local, il traffico di
risposta, loopback, DHCP, DNS, NTP e ICMP. `root`, `_apt` e `nas-os` possono usare HTTP e HTTPS per
gli aggiornamenti. Le applicazioni avviate da `nas-app@.service` possono usare HTTP e HTTPS; il
template registra i loro cgroup nell'insieme `nas_apps_out`. Le applicazioni a cui il launcher
concede la rete `smtp` (`permissions.network` nel manifest) sono anche nell'insieme `nas_apps_smtp`
e possono usare TCP 25, 465 e 587 per inviare posta. Altre porte in uscita sono bloccate.
La porta TCP 8081 sul loopback, quella dello schermo, accetta solo i processi dell'utente
`nas-screen`: nessun altro processo della macchina può aggirare il certificato del dispositivo.
Le cartelle condivise in rete (SMB) passano dall'insieme di porte `nas_shares`, aperto solo agli
indirizzi privati o link-local: è vuoto, e la porta 445 chiusa, finché il launcher non vi mette la
445 mentre almeno una cartella è condivisa; la svuota quando non ce n'è più nessuna.
La sincronizzazione con i PC passa dall'insieme `nas_sync`, aperto solo agli indirizzi privati o
link-local e vuoto finché il launcher non vi mette le porte di Syncthing (TCP e UDP 22000, UDP 21027)
mentre una sync è attiva. In uscita l'app della sync (insieme di cgroup `nas_apps_sync`) raggiunge
solo la rete locale su quelle porte, più il broadcast e il multicast della scoperta locale.
La lista degli indirizzi ammessi del launcher applica un secondo filtro in ingresso.

Le regole sono caricate all'avvio da `nas-os-base-firewall.service`. L'installazione attiva subito
il filtro: una sessione SSH da un indirizzo pubblico perderà la connessione. Configurare prima
un accesso dalla rete privata e verificare le porte richieste dalle applicazioni in uso. Per
ispezionare le regole: `sudo nft list table inet nas_base`. Per rimuoverle:
`sudo scripts/firewall.sh --remove`.

## Tornare indietro

`scripts/system-packages.sh` annota in `/var/lib/nas-os-configuration/packages` i pacchetti che ha
installato davvero. `../uninstall.sh` rimuove launcher e gateway, poi il firewall e infine solo quei pacchetti.
