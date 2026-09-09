#!/bin/zsh
set -eu

script_dir="${0:A:h}"
codex_bin="${HOME}/.codex/bin"
loader="${codex_bin}/load-contentops-env"
agent_dir="${HOME}/Library/LaunchAgents"
agent="${agent_dir}/com.contentops.codex-env.plist"
label="com.contentops.codex-env"
uid="$(id -u)"

mkdir -p "$codex_bin" "$agent_dir" "${HOME}/.codex/log"
install -m 700 "${script_dir}/load_contentops_codex_env_macos.zsh" "$loader"

cat > "$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${loader}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.codex/log/contentops-env-loader.log</string>
</dict>
</plist>
PLIST

chmod 600 "$agent"
plutil -lint "$agent" >/dev/null
"$loader"
/bin/launchctl bootout "gui/${uid}/${label}" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/${uid}" "$agent"

echo "ContentOps environment loader installed. Restart Codex to apply it."
