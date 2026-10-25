import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import type { TargetIntegrity } from './insertionFlow'

/** A failed or slow probe must never delay dictation for long; unknown is the safe answer. */
const PROBE_TIMEOUT_MS = 1500
const DISPOSE_TIMEOUT_MS = 1000

export interface TargetIntegrityProbe {
  /** Starts the hidden helper during startup so Add-Type is compiled before the hotkey goes live. */
  warmup(): void
  check(): Promise<TargetIntegrity>
  dispose(): Promise<void>
}

/**
 * Windows: Windows PowerShell 5.1 is present on every supported Windows 10/11
 * install. Keeping one hidden helper alive avoids compiling the C# probe for
 * every utterance; `Add-Type` runs once when the helper starts during app
 * initialization.
 *
 * The C# side calls OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION) and
 * OpenProcessToken, then compares TokenElevation and TokenIntegrityLevel with
 * the current process. Any failure returns `unknown`, which callers must treat
 * as unsafe (the same path as an elevated target).
 */
const PROBE_SCRIPT = String.raw`
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class MurmurTargetIntegrityProbe
{
    private const int ProcessQueryLimitedInformation = 0x1000;
    private const int TokenQuery = 0x0008;
    private const int TokenElevation = 20;
    private const int TokenIntegrityLevel = 25;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(int access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, int access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
        IntPtr token,
        int informationClass,
        IntPtr information,
        int informationLength,
        out int returnLength);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthority(IntPtr sid, int index);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    public static string Check()
    {
        IntPtr window = GetForegroundWindow();
        if (window == IntPtr.Zero)
        {
            return "unknown";
        }

        uint targetProcessId;
        GetWindowThreadProcessId(window, out targetProcessId);
        if (targetProcessId == 0)
        {
            return "unknown";
        }

        int currentIntegrity;
        bool currentElevated;
        if (!TryReadToken(GetCurrentProcess(), out currentIntegrity, out currentElevated))
        {
            return "unknown";
        }

        IntPtr targetProcess = OpenProcess(
            ProcessQueryLimitedInformation,
            false,
            unchecked((int)targetProcessId));
        if (targetProcess == IntPtr.Zero)
        {
            return "unknown";
        }

        try
        {
            int targetIntegrity;
            bool targetElevated;
            if (!TryReadToken(targetProcess, out targetIntegrity, out targetElevated))
            {
                return "unknown";
            }

            if (targetElevated && !currentElevated)
            {
                return "higher";
            }
            if (targetIntegrity > currentIntegrity)
            {
                return "higher";
            }
            return "same-or-lower";
        }
        finally
        {
            CloseHandle(targetProcess);
        }
    }

    private static bool TryReadToken(IntPtr process, out int integrity, out bool elevated)
    {
        integrity = 0;
        elevated = false;

        IntPtr token;
        if (!OpenProcessToken(process, TokenQuery, out token))
        {
            return false;
        }

        try
        {
            IntPtr elevationBuffer = Marshal.AllocHGlobal(4);
            try
            {
                int needed;
                if (!GetTokenInformation(token, TokenElevation, elevationBuffer, 4, out needed))
                {
                    return false;
                }
                elevated = Marshal.ReadInt32(elevationBuffer) != 0;
            }
            finally
            {
                Marshal.FreeHGlobal(elevationBuffer);
            }

            int length;
            GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out length);
            if (length <= 0)
            {
                return false;
            }

            IntPtr integrityBuffer = Marshal.AllocHGlobal(length);
            try
            {
                if (!GetTokenInformation(token, TokenIntegrityLevel, integrityBuffer, length, out length))
                {
                    return false;
                }

                IntPtr sid = Marshal.ReadIntPtr(integrityBuffer);
                if (sid == IntPtr.Zero)
                {
                    return false;
                }

                IntPtr subAuthorityCountPointer = GetSidSubAuthorityCount(sid);
                if (subAuthorityCountPointer == IntPtr.Zero)
                {
                    return false;
                }

                byte subAuthorityCount = Marshal.ReadByte(subAuthorityCountPointer);
                if (subAuthorityCount == 0)
                {
                    return false;
                }

                IntPtr lastSubAuthority = GetSidSubAuthority(sid, subAuthorityCount - 1);
                if (lastSubAuthority == IntPtr.Zero)
                {
                    return false;
                }

                integrity = Marshal.ReadInt32(lastSubAuthority);
                return true;
            }
            finally
            {
                Marshal.FreeHGlobal(integrityBuffer);
            }
        }
        finally
        {
            CloseHandle(token);
        }
    }
}
'@

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ($line -eq 'quit') {
        break
    }
    if ($line -eq 'check') {
        try {
            $status = [MurmurTargetIntegrityProbe]::Check()
            [Console]::Out.WriteLine('{"status":"' + $status + '"}')
        } catch {
            [Console]::Out.WriteLine('{"status":"unknown"}')
        }
        [Console]::Out.Flush()
    }
}
`

interface PendingCheck {
  readonly resolve: (value: TargetIntegrity) => void
  readonly timer: NodeJS.Timeout
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parses the one-line JSON response; anything malformed is unsafe. */
export function parseProbeStatus(line: string): TargetIntegrity {
  try {
    const value: unknown = JSON.parse(line)
    if (isRecord(value)) {
      const status = value['status']
      if (status === 'same-or-lower' || status === 'higher' || status === 'unknown') {
        return status
      }
    }
  } catch {
    // Malformed output is handled as unknown below.
  }
  return 'unknown'
}

/**
 * Starts the hidden helper during app initialization and keeps it for the app
 * lifetime. The inserter serializes insertions, so a single request/response
 * slot is enough; a second concurrent check is treated as unknown instead of
 * guessing.
 */
export function createTargetIntegrityProbe(): TargetIntegrityProbe {
  let child: ChildProcess | null = null
  let reader: Interface | null = null
  let pending: PendingCheck | null = null
  let disposed = false
  let disposePromise: Promise<void> | null = null

  function finish(value: TargetIntegrity): void {
    const active = pending
    if (active === null) {
      return
    }
    pending = null
    clearTimeout(active.timer)
    active.resolve(value)
  }

  function clearChild(process: ChildProcess): void {
    if (child === process) {
      child = null
      reader?.close()
      reader = null
    }
  }

  function handleLine(line: string): void {
    if (pending === null) {
      return
    }
    finish(parseProbeStatus(line))
  }

  function start(): void {
    if (disposed || child !== null) {
      return
    }

    const encodedScript = Buffer.from(PROBE_SCRIPT, 'utf16le').toString('base64')
    let process: ChildProcess
    try {
      process = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-OutputFormat',
          'Text',
          '-EncodedCommand',
          encodedScript
        ],
        {
          // Windows: no console window and no visible PowerShell host.
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
    } catch (error) {
      console.error('[murmur] the target integrity helper could not start', error)
      return
    }

    child = process

    process.on('error', (error) => {
      console.warn('[murmur] the target integrity helper failed', error)
      clearChild(process)
      finish('unknown')
    })

    process.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[murmur] the target integrity helper exited with code ${code}`)
      }
      clearChild(process)
      finish('unknown')
    })

    process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim()
      if (message !== '') {
        console.warn(`[murmur] target integrity helper: ${message}`)
      }
    })

    const output = process.stdout
    if (output === null) {
      clearChild(process)
      finish('unknown')
      return
    }

    reader = createInterface({ input: output })
    reader.on('line', handleLine)
  }

  function warmup(): void {
    if (!disposed) {
      start()
    }
  }

  function check(): Promise<TargetIntegrity> {
    if (disposed) {
      return Promise.resolve('unknown')
    }
    if (pending !== null) {
      console.warn('[murmur] target integrity check is already running')
      return Promise.resolve('unknown')
    }
    if (child === null) {
      start()
    }

    const process = child
    const input = process?.stdin
    if (process === null || input === null || input === undefined) {
      return Promise.resolve('unknown')
    }

    return new Promise<TargetIntegrity>((resolve) => {
      const timer = setTimeout(() => {
        console.warn('[murmur] target integrity check timed out')
        finish('unknown')
      }, PROBE_TIMEOUT_MS)
      pending = { resolve, timer }

      try {
        input.write('check\n', (error) => {
          if (error !== null && error !== undefined) {
            finish('unknown')
          }
        })
      } catch (error) {
        console.warn('[murmur] the target integrity helper could not be queried', error)
        finish('unknown')
      }
    })
  }

  function dispose(): Promise<void> {
    if (disposePromise !== null) {
      return disposePromise
    }

    disposed = true
    finish('unknown')

    const process = child
    child = null
    reader?.close()
    reader = null

    disposePromise = (async () => {
      if (process === null || process.exitCode !== null) {
        return
      }

      try {
        process.stdin?.write('quit\n')
      } catch {
        // The helper may already be gone; killing it below is still safe.
      }

      try {
        process.kill()
      } catch {
        // Ignore a helper that has already exited.
      }

      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout | null = setTimeout(() => {
          timer = null
          resolve()
        }, DISPOSE_TIMEOUT_MS)

        process.once('exit', () => {
          if (timer !== null) {
            clearTimeout(timer)
            timer = null
          }
          resolve()
        })
      })
    })()

    return disposePromise
  }

  return { warmup, check, dispose }
}
