# appstore-release promo: design

## Style Prompt

Dark, restrained, and precise. It feels like a well-kept terminal sitting on a calm night-blue canvas. One blue accent marks intent (the agent, the command). Red and green appear only as status, never as decoration. Motion is confident and short, settling like UI rather than performing like a trailer. Every number and code string on screen is real: real App Store Connect error codes, real command names, real report sections.

## Colors

| Role                | Hex       | Notes                                                  |
| ------------------- | --------- | ------------------------------------------------------ |
| Background          | `#0b1019` | Night blue, tinted toward the accent; never pure black |
| Panel               | `#121a26` | Terminal windows and cards                             |
| Hairline            | `#253043` | Borders and rules                                      |
| Foreground          | `#e6edf3` | Primary text                                           |
| Muted               | `#9aa7b6` | Secondary text (clears WCAG AA on the background)      |
| Accent              | `#58a6ff` | The single accent: prompts, commands, highlights       |
| Status: blocked/409 | `#ff6b62` | Errors only                                            |
| Status: ok          | `#4fd17a` | Passing checks only                                    |
| Status: warn        | `#e3b341` | "BLOCKED" verdict only                                 |

These match `docs/social-preview.html`, so the video and the repository card read as one product.

## Typography

- **Geist**: statements and headlines. 800 for headlines, 300 for descriptors. Tracking -0.035em at display sizes.
- **Geist Mono**: anything a machine says, such as commands, error codes, report lines and step names.

The pairing changes one variable, proportional against monospaced: the human speaks in Geist and the API speaks in Geist Mono.

## Motion

- Entrances last 0.35–0.7s, with eases mixed from `power3.out`, `expo.out` and `back.out(1.4)`.
- Status flips (✗ to ✓) happen in place, with a short scale pop.
- Scene changes use blur crossfades or vertical pushes, and none takes longer than 0.6s.
- The ambient layer is a slow breathing glow and a faint grid drift.

## What NOT to Do

- No Apple logos, Apple glyphs, SF Symbols, or anything that impersonates Apple's branding. Add a "Not affiliated with Apple" line on the end card.
- No gradient text, no neon, no purple-to-blue gradients.
- No made-up metrics. Counts (6 skills, 11 MCP tools, 0 dependencies) come from the repository.
- No colored macOS traffic lights on terminal windows. Use neutral dots, so the window stays generic.
- No text smaller than 20px in 16:9 (16px data labels at most).
