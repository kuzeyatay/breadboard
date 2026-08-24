import koffi from "koffi";

const CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
const CREATE_NEW_PROCESS_GROUP = 0x00000200;
const CREATE_NO_WINDOW = 0x08000000;
const EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
const FILE_APPEND_DATA = 0x00000004;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;
const FILE_SHARE_DELETE = 0x00000004;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
const GENERIC_READ = 0x80000000;
const OPEN_ALWAYS = 4;
const OPEN_EXISTING = 3;
const PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
const STARTF_USESTDHANDLES = 0x00000100;
const WAIT_OBJECT_0 = 0;
const WAIT_TIMEOUT = 258;
const WAIT_FAILED = 0xffffffff;

const kernel32 = koffi.load("kernel32.dll");
const HANDLE = koffi.pointer(koffi.opaque());
const HANDLE_WIDTH_BITS = koffi.sizeof(HANDLE) * 8;
const INVALID_HANDLE_ADDRESS = BigInt.asUintN(HANDLE_WIDTH_BITS, -1n);

const SECURITY_ATTRIBUTES = koffi.struct({
  nLength: "uint32_t",
  lpSecurityDescriptor: "void *",
  bInheritHandle: "int32_t",
});

const STARTUPINFOW = koffi.struct({
  cb: "uint32_t",
  lpReserved: "void *",
  lpDesktop: "void *",
  lpTitle: "void *",
  dwX: "uint32_t",
  dwY: "uint32_t",
  dwXSize: "uint32_t",
  dwYSize: "uint32_t",
  dwXCountChars: "uint32_t",
  dwYCountChars: "uint32_t",
  dwFillAttribute: "uint32_t",
  dwFlags: "uint32_t",
  wShowWindow: "uint16_t",
  cbReserved2: "uint16_t",
  lpReserved2: "void *",
  hStdInput: HANDLE,
  hStdOutput: HANDLE,
  hStdError: HANDLE,
});

const STARTUPINFOEXW = koffi.struct({
  StartupInfo: STARTUPINFOW,
  lpAttributeList: "void *",
});

const PROCESS_INFORMATION = koffi.struct({
  hProcess: HANDLE,
  hThread: HANDLE,
  dwProcessId: "uint32_t",
  dwThreadId: "uint32_t",
});

const CloseHandle = kernel32.func("__stdcall", "CloseHandle", "int32_t", [HANDLE]);
const CreateFileW = kernel32.func("__stdcall", "CreateFileW", HANDLE, [
  "str16",
  "uint32_t",
  "uint32_t",
  koffi.pointer(SECURITY_ATTRIBUTES),
  "uint32_t",
  "uint32_t",
  HANDLE,
]);
const CreateProcessW = kernel32.func("__stdcall", "CreateProcessW", "int32_t", [
  "str16",
  "void *",
  "void *",
  "void *",
  "int32_t",
  "uint32_t",
  "void *",
  "str16",
  koffi.pointer(STARTUPINFOEXW),
  koffi.out(koffi.pointer(PROCESS_INFORMATION)),
]);
const DeleteProcThreadAttributeList = kernel32.func(
  "__stdcall",
  "DeleteProcThreadAttributeList",
  "void",
  ["void *"],
);
const GetExitCodeProcess = kernel32.func(
  "__stdcall",
  "GetExitCodeProcess",
  "int32_t",
  [HANDLE, koffi.out(koffi.pointer("uint32_t"))],
);
const GetLastError = kernel32.func("uint32_t __stdcall GetLastError(void)");
const InitializeProcThreadAttributeList = kernel32.func(
  "__stdcall",
  "InitializeProcThreadAttributeList",
  "int32_t",
  ["void *", "uint32_t", "uint32_t", koffi.inout(koffi.pointer("size_t"))],
);
const TerminateProcess = kernel32.func("__stdcall", "TerminateProcess", "int32_t", [
  HANDLE,
  "uint32_t",
]);
const WaitForSingleObject = kernel32.func(
  "__stdcall",
  "WaitForSingleObject",
  "uint32_t",
  [HANDLE, "uint32_t"],
);
const UpdateProcThreadAttribute = kernel32.func(
  "__stdcall",
  "UpdateProcThreadAttribute",
  "int32_t",
  ["void *", "uint32_t", "size_t", "void *", "size_t", "void *", "void *"],
);

function isInvalidHandle(handle) {
  if (!handle) return true;
  return (
    BigInt.asUintN(HANDLE_WIDTH_BITS, koffi.address(handle)) ===
    INVALID_HANDLE_ADDRESS
  );
}

function windowsError(action, code = GetLastError()) {
  return new Error(`${action} failed with Windows error ${code}.`);
}

function quoteWindowsArgument(argument) {
  const value = String(argument);
  if (value.length > 0 && !/[\s"]/u.test(value)) return value;

  let quoted = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1);
      quoted += '"';
      backslashes = 0;
      continue;
    }
    quoted += "\\".repeat(backslashes);
    quoted += character;
    backslashes = 0;
  }
  quoted += "\\".repeat(backslashes * 2);
  return `${quoted}"`;
}

function closeHandle(handle) {
  if (handle && !isInvalidHandle(handle)) CloseHandle(handle);
}

function createInheritableFile(filePath, access, disposition) {
  const security = {
    nLength: koffi.sizeof(SECURITY_ATTRIBUTES),
    lpSecurityDescriptor: null,
    bInheritHandle: 1,
  };
  const handle = CreateFileW(
    filePath,
    access,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    security,
    disposition,
    FILE_ATTRIBUTE_NORMAL,
    null,
  );
  if (isInvalidHandle(handle)) {
    throw windowsError(`CreateFileW(${filePath})`);
  }
  return handle;
}

function createWindowsProcessOwnership() {
  let ownedHandle;
  let pid = 0;
  let closed = false;
  const exitCode = () => {
    if (closed || !ownedHandle) {
      throw new Error("The Windows process handle is already closed.");
    }
    const output = [0];
    if (!GetExitCodeProcess(ownedHandle, output)) {
      const code = GetLastError();
      throw windowsError("GetExitCodeProcess", code);
    }
    return output[0];
  };
  const wait = (timeoutMs) => {
    if (closed || !ownedHandle) {
      throw new Error("The Windows process handle is already closed.");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 0xfffffffe) {
      throw new RangeError("The Windows process wait timeout is invalid.");
    }
    const result = WaitForSingleObject(ownedHandle, timeoutMs);
    if (result === WAIT_OBJECT_0) return exitCode();
    if (result === WAIT_TIMEOUT) return null;
    if (result === WAIT_FAILED) {
      const code = GetLastError();
      throw windowsError("WaitForSingleObject", code);
    }
    throw new Error(`WaitForSingleObject returned unexpected status ${result}.`);
  };
  const waitForExit = (timeoutMs) => {
    const code = wait(timeoutMs);
    if (code === null) {
      throw new Error(
        `The Windows process ${pid} did not exit within ${timeoutMs} milliseconds.`,
      );
    }
    return code;
  };
  const processController = {
    get pid() {
      return pid;
    },
    status() {
      const code = wait(0);
      return code === null
        ? { alive: true, exitCode: null }
        : { alive: false, exitCode: code };
    },
    waitForExit,
    terminateAndWait(timeoutMs) {
      const terminated = TerminateProcess(ownedHandle, 1);
      const terminationCode = terminated ? null : GetLastError();
      try {
        return waitForExit(timeoutMs);
      } catch (waitError) {
        if (!terminated) {
          throw windowsError("TerminateProcess", terminationCode);
        }
        throw waitError;
      }
    },
    kill() {
      if (!closed && ownedHandle) TerminateProcess(ownedHandle, 1);
    },
    close() {
      if (closed) return;
      closed = true;
      closeHandle(ownedHandle);
      ownedHandle = undefined;
    },
  };
  return {
    processController,
    adopt(processHandle, processId) {
      ownedHandle = processHandle;
      pid = processId;
    },
  };
}

function attachLaunchedProcess(error, child, fallback) {
  const failure =
    error instanceof Error
      ? error
      : new Error("The Windows process launcher failed after process creation.", {
          cause: error,
        });
  try {
    Object.defineProperty(failure, "windowsBreakawayProcess", {
      value: child,
      enumerable: false,
    });
    return failure;
  } catch {
    fallback.errors[0] = error;
    fallback.cause = error;
    return fallback;
  }
}

/**
 * Start a console process outside the caller's BREAKAWAY_OK Windows job.
 *
 * The worker promotes its already-exclusive launch marker to its own PID as
 * its first action. Launching unsuspended avoids leaving an immortal suspended
 * process if the enclosing job closes during CreateProcessW's return boundary.
 */
export function launchWindowsBreakawayProcess({
  applicationPath,
  args,
  cwd,
  logPath,
}, testHooks) {
  if (process.platform !== "win32") {
    throw new Error("The Windows breakaway launcher is only available on Windows.");
  }
  if (
    typeof applicationPath !== "string" ||
    !applicationPath ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== "string") ||
    typeof cwd !== "string" ||
    !cwd ||
    typeof logPath !== "string" ||
    !logPath
  ) {
    throw new TypeError("The Windows breakaway process launch options are invalid.");
  }

  // Allocate every object needed to transfer ownership before CreateProcessW.
  // After the syscall succeeds, adoption is assignment-only and cannot strand
  // an unowned breakaway child during recoverable JS allocation pressure.
  const processOwnership = createWindowsProcessOwnership();
  const ownershipFallback = new AggregateError(
    [undefined],
    "The Windows process launcher failed after process creation.",
  );
  Object.defineProperty(ownershipFallback, "windowsBreakawayProcess", {
    value: processOwnership.processController,
    enumerable: false,
  });

  let logHandle;
  let inputHandle;
  let processHandle;
  let threadHandle;
  let attributeList;
  let inheritedHandleList;
  let attributeListInitialized = false;
  let launchedProcess;
  try {
    logHandle = createInheritableFile(logPath, FILE_APPEND_DATA, OPEN_ALWAYS);
    inputHandle = createInheritableFile("NUL", GENERIC_READ, OPEN_EXISTING);
    const commandLine = [applicationPath, ...args]
      .map(quoteWindowsArgument)
      .join(" ");
    const mutableCommandLine = Buffer.from(`${commandLine}\0`, "utf16le");
    const attributeListSize = [0];
    InitializeProcThreadAttributeList(null, 1, 0, attributeListSize);
    if (!Number.isSafeInteger(attributeListSize[0]) || attributeListSize[0] <= 0) {
      throw windowsError("InitializeProcThreadAttributeList(size query)");
    }
    attributeList = Buffer.alloc(attributeListSize[0]);
    if (!InitializeProcThreadAttributeList(attributeList, 1, 0, attributeListSize)) {
      throw windowsError("InitializeProcThreadAttributeList");
    }
    attributeListInitialized = true;

    inheritedHandleList = Buffer.alloc(koffi.sizeof(HANDLE) * 2);
    koffi.encode(
      inheritedHandleList,
      koffi.array(HANDLE, 2),
      [inputHandle, logHandle],
    );
    if (
      !UpdateProcThreadAttribute(
        attributeList,
        0,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
        inheritedHandleList,
        inheritedHandleList.byteLength,
        null,
        null,
      )
    ) {
      throw windowsError("UpdateProcThreadAttribute(handle list)");
    }

    const startupInfo = {
      StartupInfo: {
        cb: koffi.sizeof(STARTUPINFOEXW),
        lpReserved: null,
        lpDesktop: null,
        lpTitle: null,
        dwX: 0,
        dwY: 0,
        dwXSize: 0,
        dwYSize: 0,
        dwXCountChars: 0,
        dwYCountChars: 0,
        dwFillAttribute: 0,
        dwFlags: STARTF_USESTDHANDLES,
        wShowWindow: 0,
        cbReserved2: 0,
        lpReserved2: null,
        hStdInput: inputHandle,
        hStdOutput: logHandle,
        hStdError: logHandle,
      },
      lpAttributeList: attributeList,
    };
    const processInformation = {};
    const created = CreateProcessW(
      applicationPath,
      mutableCommandLine,
      null,
      null,
      1,
      CREATE_BREAKAWAY_FROM_JOB |
        CREATE_NEW_PROCESS_GROUP |
        CREATE_NO_WINDOW |
        EXTENDED_STARTUPINFO_PRESENT,
      null,
      cwd,
      startupInfo,
      processInformation,
    );
    if (!created) throw windowsError("CreateProcessW");
    processHandle = processInformation.hProcess;
    const pid = processInformation.dwProcessId;
    processOwnership.adopt(processHandle, pid);
    launchedProcess = processOwnership.processController;
    processHandle = undefined;
    threadHandle = processInformation.hThread;
    testHooks?.afterCreate?.({ pid });
    // The attribute list retains this backing-store pointer until deletion.
    // Keep an observable JS reference live across CreateProcessW.
    inheritedHandleList.readUInt8(0);
    DeleteProcThreadAttributeList(attributeList);
    attributeListInitialized = false;
    attributeList = undefined;
    inheritedHandleList = undefined;

    closeHandle(threadHandle);
    threadHandle = undefined;
    closeHandle(logHandle);
    logHandle = undefined;
    closeHandle(inputHandle);
    inputHandle = undefined;

    return launchedProcess;
  } catch (error) {
    if (attributeListInitialized) {
      inheritedHandleList?.readUInt8(0);
      DeleteProcThreadAttributeList(attributeList);
    }
    closeHandle(threadHandle);
    closeHandle(processHandle);
    closeHandle(inputHandle);
    closeHandle(logHandle);
    throw launchedProcess
      ? attachLaunchedProcess(error, launchedProcess, ownershipFallback)
      : error;
  }
}
