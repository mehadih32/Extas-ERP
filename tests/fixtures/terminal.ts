import { execFile } from "node:child_process";

/*
 * Runs a command in a terminal of its own (a pseudo-terminal, as PuTTY gives), for
 * the restore scripts' questions: `early` is typed before the command starts (keys
 * pressed while the restore worked, or an extra Enter after a paste), and each reply
 * is typed once its question shows. Returns what the screen showed and the exit code.
 */

export type Terminal = { code: number; screen: string };

const DRIVER = `
import json, os, pty, select, sys, time
replies = json.loads(os.environ["TERMINAL_REPLIES"])
early = os.environ.get("TERMINAL_EARLY", "")
ready_r, ready_w = os.pipe()
pid, fd = pty.fork()
if pid == 0:
    os.close(ready_w)
    os.read(ready_r, 1)
    os.execvp(sys.argv[1], sys.argv[1:])
os.close(ready_r)
if early:
    # Typed before the command runs: it waits in the terminal for the next question.
    os.write(fd, early.encode())
    time.sleep(0.3)
os.write(ready_w, b"x")
screen, seen, deadline = "", "", time.time() + float(os.environ.get("TERMINAL_SECONDS", "60"))
while time.time() < deadline:
    if select.select([fd], [], [], 0.2)[0]:
        try:
            data = os.read(fd, 4096).decode("utf-8", "replace")
        except OSError:
            break
        if not data:
            break
        screen += data
        seen += data
    if replies and replies[0][0] in seen and seen.rstrip().endswith(":"):
        time.sleep(0.3)
        os.write(fd, (replies.pop(0)[1] + "\\r").encode())
        seen = ""
_, status = os.waitpid(pid, 0)
sys.stdout.write(screen)
sys.exit(os.waitstatus_to_exitcode(status))
`;

export function inTerminal(
  command: string[],
  options: {
    env?: Record<string, string>;
    early?: string;
    replies?: Array<[string, string]>;
    seconds?: number;
  } = {},
): Promise<Terminal> {
  return new Promise((resolve) => {
    execFile(
      "python3",
      ["-I", "-c", DRIVER, ...command],
      {
        env: {
          ...process.env,
          ...options.env,
          TERMINAL_REPLIES: JSON.stringify(options.replies ?? []),
          TERMINAL_EARLY: options.early ?? "",
          TERMINAL_SECONDS: String(options.seconds ?? 60),
        },
        timeout: ((options.seconds ?? 60) + 30) * 1000,
      },
      (error, stdout) =>
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : -1) : 0,
          screen: stdout,
        }),
    );
  });
}
