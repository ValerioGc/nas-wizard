NAS tools

The installation of the NAS copied these scripts here, into the home of the person who ran
sudo ./install.sh. They are a copy of their own, so they keep working even when an update breaks the
files of the NAS, and a factory reset leaves them here. A new installation puts the latest version
here again, the removal of the NAS takes them away.

  ./nas-status.sh            Tells how the NAS is doing. It only reads and changes nothing.
  sudo ./nas-status.sh       The same, with the firewall, the way out to the internet and the logs.
  sudo ./nas-status.sh --logs 80 --full --save
                             Adds the last 80 lines of each log and the installed checks, and
                             writes everything into ~/nas-report-<time>.txt to attach to a report.

  sudo ./nas-restart.sh      Restarts the launcher and the gateway and waits for them to answer.
  sudo ./nas-restart.sh --apps --firewall
                             Also restarts the running applications and loads the base firewall
                             again. It refuses while an update runs, unless --force is added.

Neither script touches SSH, the consoles, the network or the services of Debian.

When an update left a check pending that should not run, it is turned off with
  sudo systemctl disable nas-os-update-verify.service && sudo rm -rf /var/lib/nas-os/update-verify
