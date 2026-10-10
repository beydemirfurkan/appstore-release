# The readiness report on its own: what is in the way, and in what order to fix it.
Output docs/media/check.gif
Source docs/media/tapes/_settings.tape

Hide
Type "export DEMO_PORT=4012 PS1='\[\e[38;5;245m\]~/wellness \[\e[38;5;75m\]$\[\e[0m\] ' && source scripts/demo/setup.sh >/dev/null && clear" Enter
Sleep 1.5s
Show

Type "appstore-release check" Sleep 300ms Enter
Sleep 7s

Hide
Type "kill $(cat $DEMO_WORK/server.pid)" Enter
Sleep 500ms
