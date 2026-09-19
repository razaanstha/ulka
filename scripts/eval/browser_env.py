"""Local synthetic browser environment for repeatable runtime evaluation."""
import atexit
import json
import selectors
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class BrowserEnvironment:
    def __init__(self):
        self._process = subprocess.Popen(
            ["bun", "run", "scripts/eval/browser-environment.ts"], cwd=ROOT,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1,
        )
        self.success = False
        self._latest = None
        self._closed = False
        atexit.register(self._close)

    def _send(self, request):
        self._process.stdin.write(json.dumps(request) + "\n")
        self._process.stdin.flush()
        with selectors.DefaultSelector() as selector:
            selector.register(self._process.stdout, selectors.EVENT_READ)
            if not selector.select(timeout=30):
                raise TimeoutError("Browser environment did not respond within 30 seconds")
        line = self._process.stdout.readline()
        if not line:
            raise RuntimeError("Browser environment exited")
        response = json.loads(line)
        if not response["ok"]:
            raise ValueError(response["error"])
        self._latest = response["result"]
        # Success comes from fixture state read through CDP, never model claims.
        self.success = bool(self._latest["success"])
        return self._latest

    def reset(self, family="context-click", seed=0, **kwargs):
        self.success = False
        return json.dumps(self._send({"method": "reset", "family": family, "seed": int(seed)}))

    def browser_action(self, operation: str, target: str = "", text: str = "") -> str:
        """Perform one observed browser action and read the resulting page.

        Args:
            operation: An available operation such as CLICK, TYPE_TEXT, SELECT, WAIT, or DONE.
            target: Exact observed target ID, including option suffix for SELECT. Empty for WAIT or DONE.
            text: Exact field value for TYPE_TEXT; otherwise empty.

        Returns:
            The observed page, available actions, and whether the task is complete.
        """
        return json.dumps(self._send({"method": "step", "operation": operation, "target": target, "text": text}))

    def _close(self):
        if self._closed:
            return
        self._closed = True
        try:
            self._process.stdin.close()
            self._process.wait(timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            self._process.kill()
            self._process.wait()
        finally:
            self._process.stdout.close()
            self._process.stderr.close()
            atexit.unregister(self._close)
