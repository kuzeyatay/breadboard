; Breadboard installer customisations (electron-builder includes this file).

; Replace the stock "is the app running?" check. See close-breadboard.ps1:
; the stock one matches Breadboard.exe by name anywhere, and reports
; "cannot be closed" for processes Windows is still tearing down.
!macro customCheckAppRunning
  InitPluginsDir
  File "/oname=$PLUGINSDIR\close-breadboard.ps1" "${BUILD_RESOURCES_DIR}\close-breadboard.ps1"
  DetailPrint `Closing "${PRODUCT_NAME}"...`
  breadboard_close_retry:
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-breadboard.ps1" -InstallDir "$INSTDIR"`
    Pop $R0
    Pop $R1
    ; "error" means PowerShell itself could not start; never block setup on that.
    StrCmp $R0 "error" breadboard_close_done
    StrCmp $R0 "0" breadboard_close_done
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Windows has not finished closing ${PRODUCT_NAME}:$\r$\n$\r$\n$R1$\r$\nWait a few seconds and click Retry. If this keeps appearing, end it in Task Manager (Details tab) or restart Windows, then run setup again." /SD IDCANCEL IDRETRY breadboard_close_retry
    Quit
  breadboard_close_done:
!macroend
