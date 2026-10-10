# The whole story in one take: blocked → release → ready → submitted.
# Real CLI output, against the fake App Store Connect in scripts/demo/.
Output docs/media/hero.gif
Source docs/media/tapes/_settings.tape
Set Height 940
Set Width 1300

Hide
Type "export DEMO_PORT=4011 PS1='\[\e[38;5;245m\]~/wellness \[\e[38;5;75m\]$\[\e[0m\] ' && source scripts/demo/setup.sh >/dev/null && clear" Enter
Sleep 1.5s
Show

Type "appstore-release check" Sleep 300ms Enter
Sleep 5s
Type "clear" Enter
Type "appstore-release release" Sleep 300ms Enter
Sleep 7s
Type "clear" Enter
Type "appstore-release submit --submit" Sleep 300ms Enter
Sleep 2s
Type "appstore-release check" Sleep 300ms Enter
Sleep 4s

Hide
Type "kill $(cat $DEMO_WORK/server.pid)" Enter
Sleep 500ms
