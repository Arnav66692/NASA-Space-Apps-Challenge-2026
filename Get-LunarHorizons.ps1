param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]*$')]
    [string]$Name,

    [Parameter(Mandatory)]
    [ValidateRange(-90, 90)]
    [double]$Latitude,

    [Parameter(Mandatory)]
    [ValidateRange(-180, 360)]
    [double]$Longitude,

    [Parameter(Mandatory)]
    [string]$StartUtc,

    [ValidateSet(1, 5, 10, 15, 30, 60)]
    [int]$StepMinutes = 60,

    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'data')
)

$ErrorActionPreference = 'Stop'
$culture = [Globalization.CultureInfo]::InvariantCulture
$start = [DateTime]::ParseExact($StartUtc, 'yyyy-MM-dd HH:mm', $culture)
$stop = $start.AddHours(72)
$longitudeEast = ($Longitude + 360) % 360
$siteCoordinates = '{0},{1},0' -f $longitudeEast.ToString($culture), $Latitude.ToString($culture)
$expectedCount = 72 * 60 / $StepMinutes + 1

function Get-HorizonsAngles([string]$TargetId) {
    $parameters = [ordered]@{
        COMMAND = $TargetId
        EPHEM_TYPE = 'OBSERVER'
        CENTER = 'coord@301'
        COORD_TYPE = 'GEODETIC'
        SITE_COORD = $siteCoordinates
        START_TIME = $start.ToString('yyyy-MM-dd HH:mm', $culture)
        STOP_TIME = $stop.ToString('yyyy-MM-dd HH:mm', $culture)
        STEP_SIZE = "$StepMinutes min"
        QUANTITIES = '4'
        CSV_FORMAT = 'YES'
        TIME_TYPE = 'UT'
        APPARENT = 'AIRLESS'
        ELEV_CUT = '-90'
    }
    $query = ($parameters.GetEnumerator() | ForEach-Object {
        '{0}={1}' -f $_.Key, [Uri]::EscapeDataString("'$($_.Value)'")
    }) -join '&'

    $result = Invoke-RestMethod -TimeoutSec 30 -Uri "https://ssd.jpl.nasa.gov/api/horizons.api?format=json&$query"
    if ($result.error) {
        throw "Horizons target $TargetId returned an error: $($result.error)"
    }
    $table = [regex]::Match([string]$result.result, '(?s)\$\$SOE\s*(.*?)\s*\$\$EOE')
    if (-not $table.Success) {
        throw "Horizons target $TargetId returned no data table: $($result.result)"
    }

    foreach ($line in ($table.Groups[1].Value -split '\r?\n')) {
        # Quantity 4 puts azimuth and elevation after two status columns.
        $fields = $line -split ','
        $time = [DateTime]::ParseExact($fields[0].Trim(), 'yyyy-MMM-dd HH:mm', $culture)
        [pscustomobject]@{
            Time = $time
            Azimuth = [double]::Parse($fields[3].Trim(), $culture)
            Elevation = [double]::Parse($fields[4].Trim(), $culture)
        }
    }
}

$sun = @(Get-HorizonsAngles '10')
$earth = @(Get-HorizonsAngles '399')
if ($sun.Count -ne $expectedCount -or $earth.Count -ne $expectedCount) {
    throw "Expected $expectedCount rows. Horizons returned $($sun.Count) for the Sun and $($earth.Count) for Earth."
}

$rows = for ($i = 0; $i -lt $sun.Count; $i++) {
    $expectedTime = $start.AddMinutes($i * $StepMinutes)
    if ($sun[$i].Time -ne $expectedTime -or $earth[$i].Time -ne $expectedTime) {
        throw "Horizons returned an unexpected timestamp in row $($i + 1)."
    }
    [pscustomobject]@{
        timeUtc = $expectedTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", $culture)
        sunElevationDeg = $sun[$i].Elevation.ToString($culture)
        earthElevationDeg = $earth[$i].Elevation.ToString($culture)
        sunAzimuthDeg = $sun[$i].Azimuth.ToString($culture)
        earthAzimuthDeg = $earth[$i].Azimuth.ToString($culture)
        latitudeDeg = $Latitude.ToString($culture)
        longitudeEastDeg = $longitudeEast.ToString($culture)
    }
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$outputFile = Join-Path $OutputDirectory "$Name.csv"
$rows | Export-Csv -LiteralPath $outputFile -NoTypeInformation -Encoding utf8
Write-Host "Saved $($rows.Count) rows to $outputFile"
