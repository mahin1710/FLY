@ECHO OFF

rem Set desired installer type:"msi" "exe".
set INSTALLER_TYPE=msi

set MAIN_JAR=%PROJECT_NAME%.jar

rem Remove previously generated installers.
IF EXIST target\installer rmdir /S /Q target\installer

rem In the end we will find the package inside the target/installer directory.
call "%JAVA_HOME%\bin\jpackage" ^
  --type %INSTALLER_TYPE% ^
  --dest target/installer ^
  --input target/ ^
  --name %PROJECT_NAME% ^
  --main-class %MAIN_CLASS% ^
  --main-jar %MAIN_JAR% ^
  --java-options -Xmx2048m ^
  --icon src/main/resources/images/SkynetLogo.ico ^
  --app-version %APP_VERSION% ^
  --vendor "mahin1710" ^
  --copyright "Copyright © 2026 mahin1710" ^
  --win-dir-chooser ^
  --win-shortcut ^
  --win-per-user-install ^
  --win-menu