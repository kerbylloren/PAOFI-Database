param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$resolvedPath = (Resolve-Path -LiteralPath $SourcePath).Path
$connection = New-Object System.Data.OleDb.OleDbConnection(
  "Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$resolvedPath;Persist Security Info=False;"
)

try {
  $connection.Open()
  $tables = @()
  $schema = $connection.GetSchema("Tables") |
    Where-Object {
      $_.TABLE_TYPE -eq "TABLE" -and
      $_.TABLE_NAME -notlike "MSys*" -and
      $_.TABLE_NAME -notlike "~TMP*"
    } |
    Sort-Object TABLE_NAME

  foreach ($tableSchema in $schema) {
    $tableName = [string]$tableSchema.TABLE_NAME
    $escapedName = $tableName.Replace("]", "]]")
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter(
      "SELECT * FROM [$escapedName]",
      $connection
    )
    $dataTable = New-Object System.Data.DataTable
    [void]$adapter.Fill($dataTable)
    $adapter.Dispose()

    $rows = @()
    foreach ($dataRow in $dataTable.Rows) {
      $record = [ordered]@{}
      foreach ($column in $dataTable.Columns) {
        $value = $dataRow[$column.ColumnName]
        if ($value -eq [DBNull]::Value) {
          $record[$column.ColumnName] = $null
        } elseif ($value -is [datetime]) {
          $record[$column.ColumnName] = $value.ToString("yyyy-MM-dd")
        } elseif ($value -is [byte[]]) {
          $record[$column.ColumnName] = [Convert]::ToBase64String($value)
        } else {
          $record[$column.ColumnName] = $value
        }
      }
      $rows += [pscustomobject]$record
    }

    $tables += [pscustomobject]@{
      name = $tableName
      rows = $rows
    }
  }

  [pscustomobject]@{
    source_file = [IO.Path]::GetFileName($resolvedPath)
    extracted_at = (Get-Date).ToUniversalTime().ToString("o")
    tables = $tables
  } | ConvertTo-Json -Depth 8 -Compress
} finally {
  if ($connection.State -eq "Open") {
    $connection.Close()
  }
  $connection.Dispose()
}
