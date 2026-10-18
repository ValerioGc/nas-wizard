#!/usr/bin/env bash
#
# After the wizard. The wizard runs it as root once
# the user has made the choices, with the token, the account name and the password on three lines
# of its input, never on its command line, and shows the steps it announces on its output.
#
#   printf '%s\n%s\n%s\n' "$token" "$account" "$password" | sudo ./install.sh \
#     --user <user of the terminal> --language <it|en> --theme <system|light|dark> \
#     --name <name of the NAS> --wizard <nas-wizard> --work <directory> [--disks <file>]
#     [--from <step>] [--simulate]
#
# It downloads the latest gateway and launcher with the token and checks them against
# their published checksums (`nas-wizard fetch`), installs the gateway without starting it (port
# 80 is still the wizard's), installs the launcher, stores the token, creates the user of the
# terminal and reconciles its data volumes (ui_configuration), prepares the empty data disks chosen
# in the page with the root code of the launcher (`nas-wizard disks`), creates the account in the
# gateway, has the gateway make the HTTPS authority of the NAS (left in the work directory for
# the wizard to offer), hands the name of the NAS, language and theme to the launcher (`nas-wizard complete`), which ends the
# first configuration and makes the name the hostname. Last, clean-package.sh puts the manuals in
# the home of the user of the terminal and empties the package the NAS was installed from, but for
# its uninstall.sh. Once the HTTPS authority is offered the wizard hands the ports over to the
# gateway.
#
# A step starts with `@@step <id>`, may add `@@detail <text>` and ends with `@@done <id>`. A
# failure ends the script with the status of the step that failed. --from skips the steps before
# that one, for a retry; --simulate downloads for real and installs nothing.

set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
installed=$(cd -- "$here/../.." && pwd)
package=${NAS_WIZARD_PACKAGE:-$installed}
[[ -d $package ]] || package=$installed
readonly here installed package
readonly STEPS=(download_gateway download_ui install_gateway install_ui configure disks account certificate complete)

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

user='' language='' theme='' name='' wizard='' work='' disks='' from='' simulate=false
while (($# > 0)); do
  case $1 in
    --user | --language | --theme | --name | --wizard | --work | --disks | --from)
      (($# >= 2)) || fail "$1 needs a value"
      declare "${1#--}=$2"
      shift 2
      ;;
    --simulate)
      simulate=true
      shift
      ;;
    *) fail "unknown option: $1" ;;
  esac
done

[[ $user =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "not a user name: ${user:-<empty>}"
[[ $language =~ ^(it|en)$ ]] || fail "not a language: ${language:-<empty>}"
[[ $theme =~ ^(system|light|dark)$ ]] || fail "not a theme: ${theme:-<empty>}"
[[ $name =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || fail "not a name for the NAS: ${name:-<empty>}"
[[ -x $wizard ]] || fail "the wizard is not at ${wizard:-<empty>}"
[[ -n $work ]] || fail '--work names no directory'
[[ -z $disks || -f $disks ]] || fail "the list of the disks is not at $disks"
if [[ -n $from ]]; then
  [[ " ${STEPS[*]} " == *" $from "* ]] || fail "not a step: $from"
fi
$simulate || [[ $EUID -eq 0 ]] || fail "it has to run as root: the wizard runs it"

token='' account='' password=''
IFS= read -r token || true
IFS= read -r account || true
IFS= read -r password || true

install -d -m 0700 "$work"
secrets=$(mktemp -d "$work/.secrets.XXXXXX")
trap 'rm -rf "$secrets"' EXIT
(umask 077 && printf '%s' "$token" >"$secrets/token")
token=''

simulated() {
  $simulate || return 1
  echo '@@detail simulated'
}

download() {
  local which=$1 version
  if [[ $which == gateway ]] && ! $simulate; then
    bash "$here/../os_configuration/install.sh"
  fi
  version=$(WIZARD_TOKEN_PATH=$secrets/token "$wizard" fetch "$which" --into "$work/$which")
  echo "@@detail version $version"
}

install_gateway() {
  simulated && return
  bash "$work/gateway/packages/gateway_installation/install.sh" --no-start
}

install_ui() {
  simulated && return
  bash "$work/ui/packages/ui_installation/install.sh"
}

configure() {
  simulated && return
  bash "$work/ui/packages/ui_configuration/install.sh" --user "$user" <"$secrets/token"
}

prepare_disks() {
  if [[ -z $disks ]]; then
    echo '@@detail none'
    return
  fi
  simulated && return
  "$wizard" disks "$disks"
}

create_account() {
  simulated && return
  local status=0
  printf '%s\n%s\n' "$account" "$password" |
    systemd-run --wait --pipe --quiet --collect \
      --property=DynamicUser=yes --property=StateDirectory=nas-os-gateway \
      /usr/local/bin/nas-os-gateway account create || status=$?
  case $status in
    0) ;;
    3) echo '@@detail already there' ;;
    *) return "$status" ;;
  esac
}

gateway() {
  systemd-run --wait --pipe --quiet --collect \
    --property=DynamicUser=yes --property=StateDirectory=nas-os-gateway \
    /usr/local/bin/nas-os-gateway "$@"
}

certificate() {
  simulated && return
  local answer
  answer=$(gateway ca)
  (umask 077 && printf '%s\n' "$answer" >"$work/ca.pem")
}

complete() {
  simulated && return
  local detail
  detail=$("$wizard" complete --language "$language" --theme "$theme" --name "$name")
  [[ -z $detail ]] || echo "@@detail $detail"
}

clean_package() {
  $simulate && return
  bash "$here/clean-package.sh" --user "$user" --package "$package" --installed "$installed" \
    --work "$work" || echo 'warning: the package the NAS was installed from stays as it is'
}

step() {
  local id=$1
  shift
  if [[ -n $from ]]; then
    [[ $id == "$from" ]] || return 0
    from=''
  fi
  echo "@@step $id"
  "$@"
  echo "@@done $id"
}

step download_gateway download gateway
step download_ui download ui
step install_gateway install_gateway
step install_ui install_ui
step configure configure
step disks prepare_disks
step account create_account
step certificate certificate
step complete complete
password=''
clean_package
