# CARROTCAP CLI Installer

## Windows

Build:

```powershell
.\build-installer.bat
```

Output:

```text
release\CARROTCAP-CLI-0.1.0-win-x64.exe
```

**Important:** building only produces the `.exe` — it does NOT register the `carrotcap` command. You must double-click the produced `.exe` (or run it from Explorer) to actually install. After installation, open a **new** PowerShell window and run:

```powershell
carrotcap
```

The installer registers the command in two redundant ways so it works even on stripped-down PATH setups:

1. `%LOCALAPPDATA%\Microsoft\WindowsApps\carrotcap.cmd` — a shim that forwards to `carrotcap.exe`. This folder is on the user PATH by default on Windows 10/11.
2. The install directory (`%LOCALAPPDATA%\Programs\carrotcap`) is also appended to the user `Path` environment variable as a fallback. `carrotcap.exe` is then callable directly.

The installer broadcasts `WM_SETTINGCHANGE`, so newly opened terminals pick up the change immediately. Terminals that were already open before installing must be closed and reopened.

### Self-heal on launch

The packaged app self-heals the CLI registration on every launch (Windows only). If the original install ever lost the shim — antivirus quarantine, manual file copy, portable run from `release\win-unpacked\`, etc. — simply opening the app once from Start Menu will:

1. Recreate `%LOCALAPPDATA%\Microsoft\WindowsApps\carrotcap.cmd` pointing at the current `carrotcap.exe`.
2. Append the install directory to the user `Path` if missing.
3. Broadcast `WM_SETTINGCHANGE` so new terminals see the change.

After one launch, open a new PowerShell and `carrotcap` will work.

### Manual repair (no installer needed)

If the GUI is not even running but you have `carrotcap.exe` somewhere on disk, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1
# or, pointing at a custom location:
powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1 -ExePath 'D:\Tools\carrotcap\carrotcap.exe'
```

This script does the same registration the installer does — shim + user PATH + broadcast — without any admin rights and without rerunning the installer.

### Troubleshooting: `'carrotcap' is not recognized`

If you see:

```text
carrotcap : 'carrotcap' is not recognized as a cmdlet, function, ...
```

run these checks in PowerShell:

```powershell
# 1) Did you actually run the installer?
Test-Path "$env:LOCALAPPDATA\Programs\carrotcap\carrotcap.exe"
Test-Path "$env:LOCALAPPDATA\Microsoft\WindowsApps\carrotcap.cmd"

# 2) Is the WindowsApps folder on PATH?
($env:PATH -split ';') -match 'WindowsApps'

# 3) Open a NEW PowerShell window after installing (existing sessions cache PATH).
```

If `carrotcap.exe` exists but the command is still missing, just call the exe directly once to confirm the build is fine:

```powershell
& "$env:LOCALAPPDATA\Programs\carrotcap\carrotcap.exe"
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
