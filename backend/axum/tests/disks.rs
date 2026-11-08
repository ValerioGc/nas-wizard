use super::*;
use std::os::unix::fs::PermissionsExt;

const LISTED: &str = r#"{"blockdevices":[
  {"name":"sda","path":"/dev/sda","type":"disk","size":500,"serial":"SYS","tran":"sata","children":[
    {"name":"sda1","path":"/dev/sda1","type":"part","fstype":"vfat","mountpoints":["/boot/efi"]},
    {"name":"sda2","path":"/dev/sda2","type":"part","fstype":"crypto_LUKS","children":[
      {"name":"root","path":"/dev/mapper/root","type":"crypt","fstype":"ext4","mountpoints":["/"]}
    ]}
  ]},
  {"name":"sdb","path":"/dev/sdb","type":"disk","size":2000,"serial":" D1 ","wwn":"0x5001","model":"Data Disk","tran":"sata"},
  {"name":"sdc","path":"/dev/sdc","type":"disk","size":3000,"serial":"D2","tran":"sata","children":[
    {"name":"sdc1","path":"/dev/sdc1","type":"part","fstype":"ext4"}
  ]},
  {"name":"sdd","path":"/dev/sdd","type":"disk","size":64,"rm":true,"tran":"usb"},
  {"name":"sde","path":"/dev/sde","type":"disk","size":10,"ro":true},
  {"name":"sr0","path":"/dev/sr0","type":"rom","size":1}
]}"#;

fn offer() -> Offer {
    Offer {
        enabled: true,
        disks: parse(LISTED).expect("listed"),
    }
}

fn choice(device: &str, identity: &str) -> Choice {
    Choice {
        device: device.to_owned(),
        identity: identity.to_owned(),
    }
}

#[test]
fn lists_the_internal_data_disks_without_the_system() {
    let disks = parse(LISTED).expect("listed");

    assert_eq!(
        disks
            .iter()
            .map(|disk| disk.device.as_str())
            .collect::<Vec<_>>(),
        ["sdb", "sdc"]
    );
    assert_eq!(disks[0].identity, "0x5001/D1/2000");
    assert_eq!(disks[0].model.as_deref(), Some("Data Disk"));
    assert!(disks[0].empty);
    assert!(!disks[1].empty);
    assert!(parse("not json").is_err());
}

#[test]
fn a_choice_is_an_empty_disk_listed_now_with_its_identity() {
    assert!(check(
        &[],
        &Offer {
            enabled: false,
            disks: Vec::new()
        }
    )
    .is_ok());
    assert!(check(&[choice("sdb", "0x5001/D1/2000")], &offer()).is_ok());

    for (choices, reason) in [
        (vec![choice("sdc", "/D2/3000")], "not the empty disk"),
        (vec![choice("sdb", "/D9/2000")], "not the empty disk"),
        (vec![choice("sda", "/SYS/500")], "not a data disk"),
        (
            vec![
                choice("sdb", "0x5001/D1/2000"),
                choice("sdb", "0x5001/D1/2000"),
            ],
            "twice",
        ),
    ] {
        let refused = check(&choices, &offer()).expect_err("refused");
        assert!(refused.contains(reason), "{refused}");
    }
    let off = Offer {
        enabled: false,
        ..offer()
    };
    assert!(check(&[choice("sdb", "0x5001/D1/2000")], &off).is_err());
}

#[test]
fn each_choice_becomes_the_request_of_the_launcher() {
    let plain = request(&choice("nvme0n1", "w/s/1"));
    assert!(plain.get("op").is_none());
    assert!(plain.get("encrypt").is_none());
    assert_eq!(plain["identity"], "w/s/1");
    assert_eq!(plain["label"], "Data-nvme0n1");
    assert_eq!(label("averyveryverylongname").len(), 16);
}

#[tokio::test]
async fn prepares_each_disk_with_the_launcher_and_stops_at_the_first_failure() {
    let directory = std::env::temp_dir().join(format!("nas-wizard-disks-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).expect("directory");
    let calls = directory.join("calls");
    let launcher = directory.join("nas-os-axum");
    std::fs::write(
        &launcher,
        format!(
            "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> {calls}\n\
             [[ $1 == --initialize-storage && $(cat \"$2\") == *sdz* ]] && exit 1\nexit 0\n",
            calls = calls.display()
        ),
    )
    .expect("launcher");
    std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o755)).expect("mode");
    let list = directory.join("disks.json");
    std::fs::write(
        &list,
        r#"[{"device":"sdb","identity":"w/s/1"},{"device":"sdc","identity":"w/s/2"}]"#,
    )
    .expect("list");

    let done = prepare(&list, &launcher, &directory)
        .await
        .expect("prepared");
    assert_eq!(done, ["sdb", "sdc"]);
    let recorded = std::fs::read_to_string(&calls).expect("calls");
    assert_eq!(recorded.matches("--initialize-storage").count(), 2);
    assert!(!recorded.contains("--storage-crypt"));
    assert!(!directory.join("disk-initialize.json").exists());

    std::fs::write(
        &list,
        r#"[{"device":"sdz","identity":"w/s/3"},{"device":"sdy","identity":"w/s/4"}]"#,
    )
    .expect("list");
    let failed = prepare(&list, &launcher, &directory)
        .await
        .expect_err("failed");
    assert!(failed.contains("sdz"));
    std::fs::write(
        &list,
        r#"[{"device":"sdb","identity":"w/s/1","encrypt":true}]"#,
    )
    .expect("list");
    assert!(prepare(&list, &launcher, &directory).await.is_err());
    std::fs::write(&list, "not json").expect("list");
    assert!(prepare(&list, &launcher, &directory).await.is_err());
    std::fs::remove_dir_all(&directory).expect("removed");
}
