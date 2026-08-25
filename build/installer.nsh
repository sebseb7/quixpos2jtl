!macro customInstall
  CreateShortCut "$SMPROGRAMS\QuixPOS2JTL CLI Server.lnk" "$INSTDIR\QuixPOS2JTL-CLI.cmd" "" "$INSTDIR\QuixPOS2JTL.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\QuixPOS2JTL CLI Server.lnk"
!macroend
