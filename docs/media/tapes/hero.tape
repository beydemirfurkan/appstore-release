# Three screens, one idea each: what is wrong → fix it → submitted.
# Real CLI output, against the fake App Store Connect in scripts/demo/.
Output docs/media/hero.gif
Source docs/media/tapes/_settings.tape

Hide
Type "export DEMO_PORT=4011 PS1='\[\e[38;5;245m\]~/wellness \[\e[38;5;117m\]❯\[\e[0m\] ' && source scripts/demo/setup.sh >/dev/null && clear" Enter
Sleep 1.5s
# The first frame is what GitHub and link previews show before the GIF plays,
# so recording starts with the blocked report already on screen.
Type "appstore-release check" Enter
Sleep 2s
Show

Sleep 4.5s
Type "clear" Enter
Type "appstore-release release" Sleep 400ms Enter
Sleep 5s
Type "clear" Enter
Type "appstore-release submit --submit" Sleep 400ms Enter
Sleep 2s
Type "appstore-release check" Sleep 300ms Enter
Sleep 4.5s

Hide
Type "demo-stop" Enter
Sleep 500ms
