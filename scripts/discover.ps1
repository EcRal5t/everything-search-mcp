$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class EverythingDiscoveryWindows {
 public delegate bool Callback(IntPtr w, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr w,StringBuilder b,int n);
 public static string[] Names(){var a=new List<string>();EnumWindows((w,p)=>{var b=new StringBuilder(512);GetClassName(w,b,512);if(b.ToString().StartsWith("EVERYTHING_TASKBAR_NOTIFICATION"))a.Add(b.ToString());return true;},IntPtr.Zero);return a.ToArray();}
}
'@
$instances = @('')
foreach ($name in [EverythingDiscoveryWindows]::Names()) {
  if ($name -match '^EVERYTHING_TASKBAR_NOTIFICATION_?\((.*)\)$') { $instances += $Matches[1] }
}
$dirs = @()
Get-Process -Name Everything,Everything64 -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.Path) { $dirs += [IO.Path]::GetDirectoryName($_.Path) }
}
foreach ($key in @('HKCU:\Software\voidtools\Everything','HKLM:\Software\voidtools\Everything','HKLM:\Software\WOW6432Node\voidtools\Everything')) {
  $v = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
  if ($v.InstallLocation) { $dirs += $v.InstallLocation }
}
@{ instances = @($instances | Select-Object -Unique); directories = @($dirs | Select-Object -Unique) } | ConvertTo-Json -Compress
