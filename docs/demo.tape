# Regenerate with: docker compose up --build -d --wait && docker compose run --rm seed && vhs docs/demo.tape
Output docs/demo.gif

Require curl
Require jq

Set Shell "bash"
Set FontSize 15
Set Width 1200
Set Height 820
Set Padding 20
Set TypingSpeed 40ms
Set Theme "Catppuccin Mocha"

Hide
Type "export PS1='$ ' && clear"
Enter
Show

Type "STEP_PAUSE_SECONDS=2 ./scripts/demo.sh"
Sleep 500ms
Enter
Sleep 22s
