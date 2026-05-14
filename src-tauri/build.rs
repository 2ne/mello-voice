fn main() {
    // Icons are baked into the executable / tray context; without this, changing PNG/ICO often
    // leaves a stale binary because no Rust sources changed.
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build();
}
