param(
    [string]$ProjectPath = "C:\Users\Administrator\Documents\NinjaTrader 8\bin\Custom\NinjaTrader.Custom.csproj"
)

$ErrorActionPreference = "Stop"

[xml]$project = Get-Content -Path $ProjectPath -Raw
$removed = 0

foreach ($itemGroup in @($project.Project.ItemGroup)) {
    foreach ($compile in @($itemGroup.Compile)) {
        $include = $compile.Include
        if ($include -and $include.StartsWith("obj\", [System.StringComparison]::OrdinalIgnoreCase)) {
            [void]$itemGroup.RemoveChild($compile)
            $removed++
        }
    }
}

$project.Save($ProjectPath)
Write-Host "removed=$removed"
