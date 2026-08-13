@echo off
rem manager CLI entrypoint for cmd.exe / PowerShell. %~dp0 is this file's own
rem directory, so the path holds regardless of the caller's cwd.
bun run "%~dp0..\cli.ts" %*
