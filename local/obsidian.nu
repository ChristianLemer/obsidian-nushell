# Open the playground vault in Obsidian
export def launch [] {
    let vault_path = ($env.PWD | path join "Nushell Plugin Playground")
    ^open $"obsidian://open?path=($vault_path)"
}

# Sync built plugin to the playground vault
export def sync [] {
    let plugin_dir = ($env.PWD | path join "Nushell Plugin Playground" ".obsidian" "plugins" "nushell")
    let files = ["main.js" "manifest.json" "styles.css"]

    rm -rf $plugin_dir
    mkdir $plugin_dir
    $files | each { |f|
        cp ($env.PWD | path join $f) $plugin_dir
        print $"copied ($f)"
    }
    print $"Synced to ($plugin_dir)"
}

# Deploy built plugin to all vaults listed in local/vaults.nuon
export def deploy [] {
    let vaults_file = ($env.PWD | path join ".vaults.nuon")
    if not ($vaults_file | path exists) {
        print "No local/vaults.nuon found. Create a list of vault paths to deploy to."
        return
    }

    let vaults = (open $vaults_file) | each { |v| $v | path expand }
    let files = ["main.js" "manifest.json" "styles.css"]
    let src = $env.PWD

    let results = $vaults | each { |vault|
        let plugin_dir = ($vault | path join ".obsidian" "plugins" "nushell")
        if not ($vault | path join ".obsidian" | path exists) {
            let short = ($vault | str replace $env.HOME "~")
            print $"  skipped  ($short) — no .obsidian"
            return null
        }
        rm -rf $plugin_dir
        mkdir $plugin_dir
        $files | each { |f| cp ($src | path join $f) $plugin_dir }
        let short = ($vault | str replace $env.HOME "~")
        print $"  deployed → ($short)"
        $plugin_dir
    } | compact

    print $"\nDeployed to ($results | length) vaults."
}
