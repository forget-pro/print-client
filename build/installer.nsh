!macro customInstall
  WriteRegStr HKCU "Software\Classes\PicPrint.Image" "" "图片打印"
  WriteRegStr HKCU "Software\Classes\PicPrint.Image" "FriendlyAppName" "图片打印"
  WriteRegStr HKCU "Software\Classes\PicPrint.Image\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "图片打印"
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr HKCU "Software\Classes\.jpg\OpenWithProgids" "PicPrint.Image" ""
  WriteRegStr HKCU "Software\Classes\.jpeg\OpenWithProgids" "PicPrint.Image" ""
  WriteRegStr HKCU "Software\Classes\.png\OpenWithProgids" "PicPrint.Image" ""
  WriteRegStr HKCU "Software\Classes\.webp\OpenWithProgids" "PicPrint.Image" ""

  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".jpg" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".jpeg" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".png" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".webp" ""

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\PicPrint.Image"
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegValue HKCU "Software\Classes\.jpg\OpenWithProgids" "PicPrint.Image"
  DeleteRegValue HKCU "Software\Classes\.jpeg\OpenWithProgids" "PicPrint.Image"
  DeleteRegValue HKCU "Software\Classes\.png\OpenWithProgids" "PicPrint.Image"
  DeleteRegValue HKCU "Software\Classes\.webp\OpenWithProgids" "PicPrint.Image"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
