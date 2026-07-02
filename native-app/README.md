# PAOFI Database Native App

Electron desktop application for PAOFI program records. The current production
module covers the Livelihood Program and runs against either a local SQLite file
or a configured Turso cloud database.

## Start

The standalone Windows package is built with Electron and does not use the
user's Edge or Chrome installation.

Installer:

```powershell
npm run package:installer
```

For a public installer, configure a trusted code-signing certificate issued to
`Kerby Lloren` before building:

```powershell
$env:CSC_LINK = "C:\path\to\kerby-lloren-code-signing.pfx"
$env:CSC_KEY_PASSWORD = "<certificate-password>"
npm run package:installer
```

The output is:

```text
dist-electron\PAOFI-Database-Setup-<version>-x64.exe
```

Portable build:

```powershell
npm run package:standalone
```

The output is:

```text
dist-electron\PAOFI-Database-Standalone-<version>-x64.exe
```

The installer removes old generated preview/runtime folders during
install/update while preserving Turso config and database data. Existing data
from the legacy `PAOFI-LP-Database-Data` folder is copied into
`PAOFI-Database-Data` when the app starts.

Or run:

```powershell
npm start
```

For the desktop shell during development:

```powershell
npm run electron:dev
```

Without cloud config, the app stores data in:

```text
data\lp_database.sqlite
```

## Cloud Database

For Turso cloud mode, create:

```text
%LOCALAPPDATA%\PAOFI-Database-Data\cloud-database.json
```

with this shape:

```json
{
  "provider": "turso",
  "url": "<TURSO_DATABASE_URL>",
  "authToken": "<TURSO_AUTH_TOKEN>"
}
```

From the source folder, you can also set `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN`, then run:

```powershell
npm run cloud:config
npm run migrate:cloud
```

## Import From Google Sheets CSV

Export the `LP Beneficiaries Masterlist` sheet as CSV, then run:

```powershell
npm run import:csv -- "C:\path\to\masterlist.csv"
```

The importer follows the same column order used by the Apps Script `rowData`
array. CSV export usually does not include embedded pictures, so picture fields
may need to be reattached in the app.

## Verify

```powershell
npm test
```

## Notes

- New Livelihood Program records use the same `LP-YYYY-###` control number format.
- Deleting a record moves it to the Record Bin.
- The Export button downloads a JSON backup of active and deleted records.
- The app has separate pages for Main Menu, Search, Editor, Record Viewer,
  Database Table, Monitoring, and Record Bin.
