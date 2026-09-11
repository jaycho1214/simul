import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseReachabilityProbe,
  REACHABILITY_POWERSHELL,
  type ReachabilityProbe,
} from "./reachability.ts";

const execFileAsync = promisify(execFile);

/**
 * Runs the read-only probe. Returns undefined on any failure — a missing
 * cmdlet, a locked-down execution policy, a slow WMI call — so the UI reports
 * 확인 불가 rather than a green tick it has not earned.
 *
 * -EncodedCommand takes UTF-16LE base64, which avoids every quoting problem a
 * multi-line script would otherwise hit inside a Windows command line.
 *
 * Unverifiable on macOS: this short-circuits to undefined on every platform
 * except win32, so on this dev machine it can only ever be typechecked, never
 * exercised against a real PowerShell host. Its behaviour against a real
 * Windows install — including what happens when Get-NetFirewallRule needs
 * elevation it does not have, or when the venue laptop's execution policy is
 * more restrictive than Bypass allows to override — is a pre-event check.
 */
export async function runWindowsReachabilityProbe(
  port: number,
): Promise<ReachabilityProbe | undefined> {
  if (process.platform !== "win32") return undefined;

  const encoded = Buffer.from(REACHABILITY_POWERSHELL(port), "utf16le").toString("base64");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    return parseReachabilityProbe(stdout);
  } catch (err) {
    console.error("windows reachability probe failed", err);
    return undefined;
  }
}
