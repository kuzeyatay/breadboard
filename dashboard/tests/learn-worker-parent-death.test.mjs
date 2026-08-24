import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureRoot = path.join(dashboardRoot, "tests", "fixtures");

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function waitForCondition(predicate, message, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      try {
        if (predicate()) {
          clearInterval(timer);
          resolve();
          return;
        }
      } catch {
        // Atomic writers may briefly leave a file unreadable; keep observing.
      }
      if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 25);
  });
}

async function placeProcessInKillOnCloseJob(pid) {
  const { default: koffi } = await import("koffi");
  const kernel32 = koffi.load("kernel32.dll");
  koffi.pointer("LEARN_TEST_WINDOWS_HANDLE", koffi.opaque());
  const BASIC_LIMIT_INFORMATION = koffi.struct("LEARN_TEST_BASIC_LIMIT_INFORMATION", {
    PerProcessUserTimeLimit: "int64_t",
    PerJobUserTimeLimit: "int64_t",
    LimitFlags: "uint32_t",
    MinimumWorkingSetSize: "uintptr_t",
    MaximumWorkingSetSize: "uintptr_t",
    ActiveProcessLimit: "uint32_t",
    Affinity: "uintptr_t",
    PriorityClass: "uint32_t",
    SchedulingClass: "uint32_t",
  });
  const IO_COUNTERS = koffi.struct("LEARN_TEST_IO_COUNTERS", {
    ReadOperationCount: "uint64_t",
    WriteOperationCount: "uint64_t",
    OtherOperationCount: "uint64_t",
    ReadTransferCount: "uint64_t",
    WriteTransferCount: "uint64_t",
    OtherTransferCount: "uint64_t",
  });
  const EXTENDED_LIMIT_INFORMATION = koffi.struct(
    "LEARN_TEST_EXTENDED_LIMIT_INFORMATION",
    {
      BasicLimitInformation: BASIC_LIMIT_INFORMATION,
      IoInfo: IO_COUNTERS,
      ProcessMemoryLimit: "uintptr_t",
      JobMemoryLimit: "uintptr_t",
      PeakProcessMemoryUsed: "uintptr_t",
      PeakJobMemoryUsed: "uintptr_t",
    },
  );
  const CreateJobObjectW = kernel32.func(
    "LEARN_TEST_WINDOWS_HANDLE __stdcall CreateJobObjectW(void *lpJobAttributes, const char16_t *lpName)",
  );
  const SetInformationJobObject = kernel32.func(
    "int32_t __stdcall SetInformationJobObject(LEARN_TEST_WINDOWS_HANDLE hJob, int32_t JobObjectInformationClass, void *lpJobObjectInformation, uint32_t cbJobObjectInformationLength)",
  );
  const OpenProcess = kernel32.func(
    "LEARN_TEST_WINDOWS_HANDLE __stdcall OpenProcess(uint32_t dwDesiredAccess, int32_t bInheritHandle, uint32_t dwProcessId)",
  );
  const AssignProcessToJobObject = kernel32.func(
    "int32_t __stdcall AssignProcessToJobObject(LEARN_TEST_WINDOWS_HANDLE hJob, LEARN_TEST_WINDOWS_HANDLE hProcess)",
  );
  const CloseHandle = kernel32.func(
    "int32_t __stdcall CloseHandle(LEARN_TEST_WINDOWS_HANDLE hObject)",
  );
  const GetLastError = kernel32.func("uint32_t __stdcall GetLastError(void)");
  const handleWidthBits = koffi.sizeof("void *") * 8;
  const invalidHandleAddress = BigInt.asUintN(handleWidthBits, -1n);
  const invalidHandle = (handle) =>
    !handle ||
    BigInt.asUintN(handleWidthBits, koffi.address(handle)) === invalidHandleAddress;
  const fail = (action) =>
    new Error(`${action} failed with Windows error ${GetLastError()}.`);

  const job = CreateJobObjectW(null, null);
  if (invalidHandle(job)) throw fail("CreateJobObjectW");
  let processHandle;
  try {
    const limits = Buffer.alloc(koffi.sizeof(EXTENDED_LIMIT_INFORMATION));
    limits.writeUInt32LE(
      0x00000800 | 0x00002000,
      koffi.offsetof(BASIC_LIMIT_INFORMATION, "LimitFlags"),
    );
    if (!SetInformationJobObject(job, 9, limits, limits.length)) {
      throw fail("SetInformationJobObject");
    }
    processHandle = OpenProcess(0x00000001 | 0x00000100, 0, pid);
    if (invalidHandle(processHandle)) throw fail("OpenProcess");
    if (!AssignProcessToJobObject(job, processHandle)) {
      throw fail("AssignProcessToJobObject");
    }
  } catch (error) {
    if (processHandle && !invalidHandle(processHandle)) CloseHandle(processHandle);
    CloseHandle(job);
    throw error;
  }
  CloseHandle(processHandle);
  return {
    close() {
      CloseHandle(job);
    },
  };
}

test("a real Learn worker completes after its parent and enclosing Windows job die", async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "learn-worker-parent-death-"),
  );
  const fakeDashboardRoot = path.join(temporaryRoot, "dashboard");
  const contentPath = path.join(temporaryRoot, "content");
  const infoPath = path.join(temporaryRoot, "worker-info.json");
  const releasePath = path.join(temporaryRoot, "release");
  const completionPath = path.join(temporaryRoot, "completed.json");
  const startGatePath = path.join(temporaryRoot, "start-parent");
  fs.mkdirSync(fakeDashboardRoot, { recursive: true });
  fs.mkdirSync(contentPath, { recursive: true });

  const parent = spawn(
    process.execPath,
    [path.join(fixtureRoot, "learn-worker-parent.mjs")],
    {
      cwd: dashboardRoot,
      windowsHide: true,
      env: {
        ...process.env,
        QUARTZ_CONTENT_PATH: contentPath,
        LEARN_WORKER_TEST_DASHBOARD_ROOT: fakeDashboardRoot,
        LEARN_WORKER_TEST_REAL_WORKER_PATH: path.join(
          dashboardRoot,
          "scripts",
          "learn-worker.mjs",
        ),
        LEARN_WORKER_TEST_HOOK_PATH: path.join(
          fixtureRoot,
          "learn-worker-parent-death-hook.mjs",
        ),
        LEARN_WORKER_TEST_FIXTURE_ROOT: fixtureRoot,
        LEARN_WORKER_TEST_INFO_PATH: infoPath,
        LEARN_WORKER_TEST_RELEASE_PATH: releasePath,
        LEARN_WORKER_TEST_COMPLETION_PATH: completionPath,
        ...(process.platform === "win32"
          ? { LEARN_WORKER_TEST_START_GATE_PATH: startGatePath }
          : {}),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  parent.stderr.setEncoding("utf8");
  parent.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  let childPid;
  let outerJob;

  try {
    if (process.platform === "win32") {
      outerJob = await placeProcessInKillOnCloseJob(parent.pid);
      fs.writeFileSync(startGatePath, "start\n", "utf8");
    }
    await waitForCondition(
      () => fs.existsSync(infoPath),
      `The parent never observed a durable worker receipt. ${stderr}`,
    );
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    childPid = info.childPid;
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
    assert.equal(info.message.type, "ready");
    assert.equal(info.message.jobId, "learn_job_parent_death_fixture");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(info.receiptPath, "utf8")),
      info.message,
    );
    const concurrency = JSON.parse(fs.readFileSync(info.concurrencyPath, "utf8"));
    assert.equal(concurrency.requestId, info.message.requestId);
    assert.equal(
      concurrency.pid,
      childPid,
      "the worker must fence the launch marker to its own PID before readiness",
    );
    assert.equal(concurrency.state, "running");

    if (outerJob) {
      outerJob.close();
      outerJob = undefined;
    } else {
      parent.kill();
    }
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("The Next-like parent did not terminate.")),
        30_000,
      );
      parent.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    assert.equal(processIsAlive(childPid), true, "the worker must outlive its parent");

    fs.writeFileSync(releasePath, "release\n", "utf8");
    await waitForCondition(
      () => fs.existsSync(completionPath),
      "The detached worker did not complete after its parent died.",
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(completionPath, "utf8")), {
      pid: childPid,
      completed: true,
    });
    await waitForCondition(
      () => !processIsAlive(childPid),
      "The detached worker did not exit after completing its work.",
    );
    assert.equal(
      fs.existsSync(info.concurrencyPath),
      true,
      "the marker remains fenced through OS-level process exit for safe reclamation",
    );
  } finally {
    outerJob?.close();
    if (parent.exitCode === null) parent.kill();
    if (childPid && processIsAlive(childPid)) {
      try {
        process.kill(childPid);
      } catch {
        // The worker may have exited between the liveness check and cleanup.
      }
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
