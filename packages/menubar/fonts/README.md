# House fonts for the Switchboard menu-bar panel

Drop the three OFL (free) font files here and `build.sh` / `package-dmg.sh` bundle them into
`Switchboard.app/Contents/Resources/fonts/`, where `registerBundledFonts()` registers them at launch.
Until they're present the panel falls back to the macOS system font (it still renders fine).

Needed (variable `.ttf` from Google Fonts is fine — CoreText interpolates weights):
- `BricolageGrotesque[opsz,wdth,wght].ttf`  → family "Bricolage Grotesque" (display: wordmark, hero)
- `HankenGrotesk[wght].ttf`                  → family "Hanken Grotesk"      (body)
- `SplineSansMono[wght].ttf`                 → family "Spline Sans Mono"    (numbers, kickers)

Source: https://github.com/google/fonts (ofl/bricolagegrotesque, ofl/hankengrotesk, ofl/splinesansmono)
