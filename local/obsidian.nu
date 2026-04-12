# Open the playground vault in Obsidian
export def open [] {
    let vault_path = ($env.PWD | path join "Nushell Plugin Playground")
    ^open $"obsidian://open?path=($vault_path)"
}

# Sync built plugin to the playground vault
export def sync [] {
    let plugin_dir = ($env.PWD | path join "Nushell Plugin Playground" ".obsidian" "plugins" "obsidian-nushell")
    let files = ["main.js" "manifest.json" "styles.css"]

    rm -rf $plugin_dir
    mkdir $plugin_dir
    $files | each { |f|
        cp ($env.PWD | path join $f) $plugin_dir
        print $"copied ($f)"
    }
    print $"Synced to ($plugin_dir)"
}
