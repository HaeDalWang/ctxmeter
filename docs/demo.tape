# ctxmeter README demo.
#
# Regenerate with:  ./scripts/build-demo.sh
#
# This tape emits PNG frames rather than a GIF because VHS 0.12.0 never starts
# ffmpeg (https://github.com/charmbracelet/vhs/issues/787). build-demo.sh does the
# encode. The recorded command is a real `ctxmeter` on PATH, symlinked to
# src/cli.js exactly as npm's bin entry installs it.

Output .demo-frames/

Require ctxmeter

Set Shell bash
Set FontSize 15
Set Columns 100
Set Rows 34
Set Padding 22
Set Theme "GitHub Dark"
Set TypingSpeed 55ms
Set WaitTimeout 30s

# A minimal prompt keeps the operator's directory layout out of the recording.
Hide
Type "export PS1='\033[38;5;245m❯\033[0m '"
Enter
Type "clear"
Enter
Show

Sleep 700ms
Type "ctxmeter"
Sleep 500ms
Enter

# Hold until the closing caveat line renders rather than guessing at scan time.
Wait+Screen@25s /not a tokenizer count/
Sleep 5s
