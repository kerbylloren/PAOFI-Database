# PAOFI Livelihood Program Database

A standalone Windows desktop database application for the Payatas Orione
Foundation Inc. Livelihood Program. The app is built with Electron and opens in
its own application window, not as an Edge or Chrome app-mode window.

Download the Windows installer from the
[latest GitHub Release](https://github.com/kerbylloren/LP-Database/releases/latest).

## Current Release

Latest version: `0.1.9`

The release includes:

- Windows x64 installer: `PAOFI-LP-Database-Setup-<version>-x64.exe`
- Auto-update metadata: `latest.yml`
- Differential update map: `.exe.blockmap`

Users on `v0.1.7` or newer can receive updates through the built-in auto-update
flow. Users on older versions should download and run the latest installer
manually.

## Features

- Secure login screen for app access
- Starter `superadmin` account for account management
- Superadmin-only user account creation and editing
- Shared Turso cloud database support for use across multiple PCs
- Local SQLite fallback when no cloud configuration is present
- Beneficiary record editor and viewer
- Search page and full database table page
- Record Bin for deleted records
- Monitoring and reporting forms for monthly beneficiary progress
- Summary analytics on the main dashboard and detailed analytics in database views
- Beneficiary-level monitoring summary in profiles and print output
- JSON export for backup

## Account Access

A starter superadmin account is seeded during setup. The superadmin can create
standard user accounts in the Accounts page. Standard users can use the database
but cannot create or manage accounts.

Passwords are stored as PBKDF2 hashes, not as plain text.

## Cloud Database

The app supports Turso cloud database mode so records and user accounts can be
accessed consistently from multiple PCs.

When cloud defaults are packaged into a release, fresh installs connect to the
configured Turso database immediately. A local config file can also be used and
takes priority:

```text
%LOCALAPPDATA%\PAOFI-LP-Database-Data\cloud-database.json
```

Expected shape:

```json
{
  "provider": "turso",
  "url": "<TURSO_DATABASE_URL>",
  "authToken": "<TURSO_AUTH_TOKEN>"
}
```

Without cloud config, the app falls back to a local SQLite database.

## Installation Notes

Run the installer from the latest release:

```text
PAOFI-LP-Database-Setup-<version>-x64.exe
```

The installer preserves Turso configuration and database data while removing old
generated runtime or duplicate files during install/update.

Microsoft Defender SmartScreen may still warn because the installer is not
signed with a trusted code-signing certificate.

## Development

The application source lives in:

```text
native-app/
```

Install dependencies:

```powershell
cd native-app
npm install
```

Run the local web server:

```powershell
npm start
```

Run the Electron desktop shell:

```powershell
npm run electron:dev
```

Run tests:

```powershell
npm test
```

Build the Windows x64 installer:

```powershell
npm run package:installer
```

## Public Release Builds

For public distribution, sign the installer with a trusted Windows code-signing
certificate issued to `Kerby Lloren`. SmartScreen reputation cannot be reliably
fixed with package metadata alone.

```powershell
$env:CSC_LINK = "C:\path\to\kerby-lloren-code-signing.pfx"
$env:CSC_KEY_PASSWORD = "<certificate-password>"
npm run package:installer
Get-AuthenticodeSignature .\dist-electron\PAOFI-LP-Database-Setup-<version>-x64.exe
```

## Repository Layout

```text
.
|-- native-app/          Electron desktop database application
|-- README.md            Repository overview shown on GitHub
```

## Data Safety

- Turso credentials and local database files are ignored by Git.
- Deleted beneficiary records move to the Record Bin.
- The app can export beneficiary and monitoring records as a JSON backup.
- Account credentials are stored in the configured database, so cloud mode keeps
  accounts consistent across devices.
