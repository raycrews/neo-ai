!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER
Var NeoFreshChoice
Var NeoKeepRadio
Var NeoFreshRadio


!macro customInit
  StrCpy $NeoFreshChoice 0
!macroend

!macro customPageAfterChangeDir
  Page custom NeoSettingsPage NeoSettingsLeave
!macroend

Function NeoSettingsPage
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 30u "Choose how Neo-AI should start after installation."
  Pop $0
  ${NSD_CreateRadioButton} 0 35u 100% 18u "Keep existing settings (recommended for upgrades)"
  Pop $NeoKeepRadio
  ${NSD_CreateRadioButton} 0 60u 100% 18u "Start fresh"
  Pop $NeoFreshRadio
  ${If} $NeoFreshChoice == 1
    ${NSD_Check} $NeoFreshRadio
  ${Else}
    ${NSD_Check} $NeoKeepRadio
  ${EndIf}
  ${NSD_CreateLabel} 0 90u 100% 65u "Start fresh opens first-time setup with an empty library and default preferences. Your existing books and settings are preserved in their current folders. You can reopen your books using Settings > General > Library folder."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function NeoSettingsLeave
  ${NSD_GetState} $NeoFreshRadio $NeoFreshChoice
FunctionEnd

!macro customInstall
  SetShellVarContext current
  ${If} $NeoFreshChoice == 1
    CreateDirectory "$APPDATA\Neo-AI"
    ClearErrors
    FileOpen $0 "$APPDATA\Neo-AI\fresh-setup-request" w
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Could not request fresh setup. Existing settings will be kept."
    ${Else}
      FileWrite $0 "Fresh setup requested by installer"
      FileClose $0
    ${EndIf}
  ${Else}
    Delete "$APPDATA\Neo-AI\fresh-setup-request"
  ${EndIf}
!macroend

!endif
