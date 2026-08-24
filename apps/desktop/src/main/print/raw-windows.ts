/**
 * Send raw bytes to a named Windows printer.
 *
 * The Citizen CT-S310S is installed with its Windows driver over USB, so the
 * printer's *name* is the address — which is what Ajustes stores. Getting raw
 * ESC/POS past the driver (rather than having the driver render text as
 * graphics) means spooling with the RAW datatype, and the only interfaces for
 * that are Win32's winspool.drv.
 *
 * We reach it through PowerShell's Add-Type instead of a native node module:
 * no extra dependency, no Electron ABI rebuild, nothing to break on the next
 * Electron bump. The cost is one short-lived PowerShell process per ticket,
 * which is invisible next to the printer's own latency.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** RawPrinterHelper, the documented Win32 sequence: Open → StartDoc → Write. */
const SPOOL_SCRIPT = `
param([Parameter(Mandatory=$true)][string]$Printer, [Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArkomRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void Send(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
      throw new Exception("OpenPrinter failed for '" + printerName + "' (" + Marshal.GetLastWin32Error() + ")");
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "Arkom ticket";
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di))
        throw new Exception("StartDocPrinter failed (" + Marshal.GetLastWin32Error() + ")");
      try {
        if (!StartPagePrinter(hPrinter))
          throw new Exception("StartPagePrinter failed (" + Marshal.GetLastWin32Error() + ")");
        IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, buf, bytes.Length);
          int written;
          if (!WritePrinter(hPrinter, buf, bytes.Length, out written))
            throw new Exception("WritePrinter failed (" + Marshal.GetLastWin32Error() + ")");
          if (written != bytes.Length)
            throw new Exception("Short write: " + written + " of " + bytes.Length);
        } finally { Marshal.FreeCoTaskMem(buf); }
        EndPagePrinter(hPrinter);
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
"@
[ArkomRawPrint]::Send($Printer, [System.IO.File]::ReadAllBytes($Payload))
Write-Output "ok"
`;

/**
 * Resolves when the spooler has accepted the bytes; rejects with the Win32
 * failure otherwise. "Accepted by the spooler" is as far as any print API can
 * see — paper out or a powered-off printer surfaces at the queue, not here.
 */
export async function sendRawToPrinter(printerName: string, bytes: Buffer): Promise<void> {
  const dir = app.getPath("temp");
  const stamp = randomUUID();
  const payload = join(dir, `arkom-spool-${stamp}.bin`);
  const script = join(dir, `arkom-spool-${stamp}.ps1`);

  await writeFile(payload, bytes);
  await writeFile(script, SPOOL_SCRIPT, "utf8");

  try {
    await new Promise<void>((resolve, reject) => {
      const ps = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Printer", printerName, "-Payload", payload],
        { windowsHide: true },
      );
      let stderr = "";
      ps.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      ps.on("error", reject);
      ps.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `El spooler devolvió el código ${code}.`));
      });
    });
  } finally {
    await Promise.allSettled([unlink(payload), unlink(script)]);
  }
}
