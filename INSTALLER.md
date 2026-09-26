# CARROTCAP CLI Installer

## Windows

Build:

```powershell
.\build-installer.bat
```

Output:

```text
release\CARROTCAP-CLI-Setup-<version>.exe
```

**Install:** double-click `CARROTCAP-CLI-Setup-<version>.exe`. It is a one-click, per-user installer (no admin, no wizard): it installs to `%LOCALAPPDATA%\Programs\carrotcap-cli`, creates Desktop and Start Menu shortcuts, and starts the app. Then in any terminal:

```powershell
carrotcap
```

### How the `carrotcap` command works

Two launchers are written to `%LOCALAPPDATA%\Microsoft\WindowsApps` (on PATH by default on Windows 10/11):

| File | Used by |
|---|---|
| `carrotcap.bat` | cmd, Windows PowerShell 5.1, PowerShell 7 |
| `carrotcap` (no extension) | Git Bash |

The separate **Cream CLI** product rewrites `WindowsApps\carrotcap.cmd` and `aor.cmd` every time it starts. Within one folder Windows tries extensions in `PATHEXT` order (`.COM;.EXE;.BAT;.CMD`), so `carrotcap.bat` wins over Cream's `carrotcap.cmd` without touching it. `aor` stays with Cream CLI.

Both launchers carry the marker line `CARROTCAP-CLI-LAUNCHER`. The installer, the app and the repair script only ever write or delete a launcher that is missing or carries that marker — never another program's file, a link or a folder.

The user `Path` is **not** modified (older versions appended the install folder; long PATH values could be truncated by the installer).

Assumptions: WindowsApps on PATH and the default `PATHEXT` order. If `PATHEXT` lists `.CMD` before `.BAT`, or a `carrotcap.exe`/`.com` comes earlier on PATH, that one wins — `scripts\repair-cli.ps1` reports this.

### Self-heal on launch

Every launch of the installed app rewrites its own launchers to the current `carrotcap.exe` path (same ownership rule). Opening the app once from the Start Menu repairs the command.

### Manual repair

```powershell
powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1
# or, pointing at a custom location:
powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1 -ExePath 'D:\Tools\carrotcap-cli\carrotcap.exe'
```

### Upgrade from an older install location

Older CARROTCAP builds installed to `%LOCALAPPDATA%\Programs\carrotcap`, which is also the parent folder of a Cream CLI install. The setup refuses to reuse that location (the uninstaller deletes its folder recursively); uninstall the old version from **Settings > Apps** first, then run the setup again.

### Uninstall

**Settings > Apps > CARROTCAP CLI**. Removes the app folder and our two launchers (marker checked). Cream CLI's files are left alone.

### Troubleshooting: `'carrotcap' is not recognized` / opens something else

```powershell
Test-Path "$env:LOCALAPPDATA\Programs\carrotcap-cli\carrotcap.exe"
where.exe carrotcap          # first line should end in \WindowsApps\carrotcap.bat
$env:PATHEXT                 # .BAT must come before .CMD
```

## macOS

macOS cannot run `.exe` installers. Build the macOS installer on a Mac:

```bash
npm install --omit=optional
npm run dist:mac
```

The configured macOS `.pkg` postinstall script creates:

```text
/usr/local/bin/carrotcap
```

Then any new terminal can run:

```bash
carrotcap
```

## Notes

`node-pty` is optional. If native compilation fails on a machine, CARROTCAP CLI starts in fallback terminal mode using `child_process`.
