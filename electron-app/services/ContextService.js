const { exec } = require('child_process');
const { clipboard, desktopCapturer } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Runs a PowerShell script via a temp .ps1 file (`-File`) instead of `-Command`.
 * `-Command` requires the script on a single line, which breaks here-strings
 * (`@" ... "@`) and embedded C#. Writing to a file preserves newlines.
 */
function runPowerShellScript(script) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `sileo-ps-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
    try {
      fs.writeFileSync(file, script, 'utf8');
    } catch (e) {
      return reject(e);
    }
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${file}"`,
      { windowsHide: true },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(file); } catch (_) {}
        if (err) return reject(err);
        resolve({ stdout, stderr });
      }
    );
  });
}

/**
 * Gets the title and process name of the currently active Windows application.
 */
async function getActiveWindowInfo() {
  // A small inline C# class lets us call user32.dll to read the foreground window.
  // NOTE: $pid is a read-only automatic variable in PowerShell, so we use $procId.
  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$hwnd = [Win32]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 256
[Win32]::GetWindowText($hwnd, $title, 256) | Out-Null
$procId = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
$procName = if ($proc) { $proc.ProcessName } else { 'Unknown' }
[PSCustomObject]@{ Title = $title.ToString(); ProcessName = $procName } | ConvertTo-Json -Compress
`;

  try {
    const { stdout } = await runPowerShellScript(psScript);
    const data = JSON.parse(stdout.trim());
    return { title: data.Title || '', processName: data.ProcessName || '' };
  } catch (e) {
    console.error('[ContextService] Error getting active window:', e.message);
    return { title: '', processName: '' };
  }
}

/**
 * Simulates Ctrl+C to grab the currently highlighted text, 
 * then restores the user's original clipboard content.
 */
async function getSelectedText() {
  let prevText = '';
  try { prevText = clipboard.readText(); } catch (e) {}
  
  clipboard.clear();

  return new Promise((resolve) => {
    // Single-line command (no here-string needed) → safe inside -Command "...".
    const psCmd = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')";

    exec(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, { windowsHide: true }, async (err) => {
      if (err) console.error('[ContextService] Ctrl+C error:', err.message);

      await sleep(150); // Wait for Windows to actually copy to clipboard
      const selected = clipboard.readText();

      // Restore previous clipboard silently
      setTimeout(() => {
        try {
          if (prevText) {
            clipboard.writeText(prevText);
          } else {
            clipboard.clear();
          }
        } catch (e) {}
      }, 50);

      resolve(selected ? selected.trim() : '');
    });
  });
}

/**
 * Captures a screenshot of the primary display as a base64 Data URL.
 */
async function getScreenScreenshot() {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1024, height: 1024 } });
    if (sources && sources.length > 0) {
      // sources[0] is usually the primary screen
      return sources[0].thumbnail.toDataURL(); // e.g. "data:image/png;base64,iVBORw0K..."
    }
  } catch (e) {
    console.error('[ContextService] Screenshot error:', e.message);
  }
  return null;
}

module.exports = {
  getActiveWindowInfo,
  getSelectedText,
  getScreenScreenshot
};
