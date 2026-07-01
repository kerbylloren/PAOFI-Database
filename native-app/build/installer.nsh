!macro customInstall
  DetailPrint "Cleaning up old PAOFI LP Database generated files..."

  ; Legacy preview launcher extraction folder. This does not contain user data.
  RMDir /r "$LOCALAPPDATA\PAOFI-LP-Database-Preview"

  ; Browser profile created by the temporary Edge/Chrome app-mode wrapper.
  RMDir /r "$LOCALAPPDATA\PAOFI-LP-Database-Data\AppWindowProfile"

  ; Runtime folder from older packages that bundled a separate node.exe backend.
  RMDir /r "$INSTDIR\resources\runtime"
  RMDir /r "$INSTDIR\resources\app\runtime"

  ; Empty/temporary logs from older backend launches.
  Delete "$INSTDIR\resources\app\server.err.log"
  Delete "$INSTDIR\resources\app\server.out.log"
  Delete "$LOCALAPPDATA\PAOFI-LP-Database-Data\server.err.log"
  Delete "$LOCALAPPDATA\PAOFI-LP-Database-Data\server.out.log"
!macroend
