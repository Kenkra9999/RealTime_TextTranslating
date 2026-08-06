$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("C:\Users\kenkr\OneDrive\Desktop\LinguaContext Pro.lnk")
$Shortcut.TargetPath = "c:\Users\kenkr\OneDrive\Desktop\BotDichTuVaNote\dichvanotechu2\launch.bat"
$Shortcut.WorkingDirectory = "c:\Users\kenkr\OneDrive\Desktop\BotDichTuVaNote\dichvanotechu2"
$Shortcut.IconLocation = "c:\Users\kenkr\OneDrive\Desktop\BotDichTuVaNote\dichvanotechu2\icon.ico,0"
$Shortcut.Description = "LinguaContext Pro - Real-Time Text Translating"
$Shortcut.WindowStyle = 7
$Shortcut.Save()
