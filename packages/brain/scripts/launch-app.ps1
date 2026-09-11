# Lanza una app por su AppID (el mismo identificador que usa el menu
# Inicio de Windows, obtenido via Get-StartApps) y, si aparece una
# ventana nueva en los siguientes segundos, la minimiza -- para que
# abrir algo no te interrumpa lo que estabas haciendo.
#
# Sale por un archivo separado (en vez de pasar el script inline) para
# no pelear con el infierno de comillas anidadas de PowerShell + C#.
param(
  [Parameter(Mandatory = $true)][string]$AppId
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class JarvisWin32 {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

$before = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty Id

Start-Process "explorer.exe" -ArgumentList "shell:AppsFolder\$AppId"

$minimized = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Milliseconds 300
  $nuevas = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $before -notcontains $_.Id }
  if ($nuevas) {
    foreach ($p in $nuevas) {
      [JarvisWin32]::ShowWindowAsync($p.MainWindowHandle, 6) | Out-Null # 6 = SW_MINIMIZE
    }
    $minimized = $true
    break
  }
}

[PSCustomObject]@{ minimized = $minimized } | ConvertTo-Json -Compress
