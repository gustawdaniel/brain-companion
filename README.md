# Brain Companion

Dyktafon i pilot GTD dla Brain OS: nagrywasz notatkę głosową na telefonie albo
komputerze, aplikacja wysyła ją do Twojej instalacji, a dyspozytor GTD zamienia
ją w zadania, wpisy do dziennika i zdarzenia kalendarza.

Aplikacja jest klientem Twojej instalacji — nie ma jednego „globalnego” serwera.
Adres serwera i token API podaje Ci `/setup` na Twoim hoście (karta
**Brain Companion**: kod QR + kod połączenia `brain://connect?...`).

## Co potrafi

- nagrywanie notatek głosowych i wysyłka na `POST /api/v1/voice/inbox`
- szybka notatka tekstowa (`POST /api/v1/voice/note`)
- sprawdzanie stanu serwera (`GET /health`) przed wysyłką — widać, czy host
  odpowiada i czy token jest przyjęty
- ustawienia połączenia w aplikacji (⚙️): adres serwera, nazwa urządzenia,
  token API — zapisywane lokalnie, bez rekompilacji

## Instalacja

Pliki instalacyjne są w wydaniach: <https://github.com/gustawdaniel/brain-companion/releases>.

| System | Plik | Uwagi |
|---|---|---|
| macOS 11+ | `Brain.Companion_<wersja>_universal.dmg` | Apple Silicon + Intel. Buildy bez certyfikatu Apple są niepodpisane: `xattr -dr com.apple.quarantine "/Applications/Brain Companion.app"` |
| Linux x64 | `Brain.Companion_<wersja>_amd64.AppImage` lub `.deb` | AppImage: `chmod +x` i uruchom |
| iOS | `Brain-Companion-ios-unsigned.zip` | Build bez podpisu (wymaga własnego konta Apple Developer do instalacji na urządzeniu — patrz niżej) |

Windows **nie jest wspierany** — nie budujemy `.msi`/`.exe`.

### iOS

CI buduje `.app` bez podpisu (`tauri ios build --no-sign`), bo podpisanie IPA
wymaga certyfikatu z konta Apple Developer. Bez niego pakiet instalujesz
lokalnie z Xcode (*Window → Devices and Simulators → +*) na własnym telefonie.
Gdy pojawi się konto Apple Developer, wystarczy dodać sekrety
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`,
`APPLE_PASSWORD`, `APPLE_TEAM_ID` i zmienić `--no-sign` na
`--export-method app-store-connect` w `.github/workflows/desktop.yml`.

## Konfiguracja połączenia

1. Wejdź na `http://<twoj-host>/setup` (w swoim tailnecie) i znajdź kartę
   **Brain Companion**.
2. Zeskanuj QR telefonem albo skopiuj **kod połączenia** i wklej go w oknie ⚙️
   w aplikacji desktopowej. Kod zawiera adres serwera, token i nazwę urządzenia.
3. Ręcznie to samo: ⚙️ → **Adres serwera** (np. `http://twoj-host` albo Twoja
   domena publiczna) → **Token API** → **Nazwa urządzenia** → **Zapisz**.

Token to sekret Twojej instalacji — na serwerze wyciągniesz go przez
`sudo brain-secrets get gtd.api_token`. Nie wpisuj go w miejscach publicznych;
QR/kod zostawiaj w swoim tailnecie.

## Budowanie ze źródeł

```bash
npm ci
npm run tauri dev      # tryb developerski
npm run tauri build    # paczki dla bieżącego systemu
```

Wymagania: Node 22+, Rust (stable), na Linuksie `libwebkit2gtk-4.1-dev`
i `libayatana-appindicator3-dev`, na macOS Xcode Command Line Tools.

Wersja aplikacji w wydaniu pochodzi z tagu (`v2026.11.2` → `2026.11.2`), a nie
z `tauri.conf.json` — CI nadpisuje ją przez `--config`.

## Wydania

- `.github/workflows/desktop.yml` (w tym repo) buduje DMG (macOS universal),
  AppImage/deb (Linux) i `.app` dla iOS, i dołącza je do GitHub Release.
- Wydanie powstaje **tylko wtedy, gdy zmieniły się pliki tej aplikacji** —
  `publish/push.sh` w monorepo porównuje drzewo bez manifestu i przy samym
  bumpie wersji monorepo nie tworzy nowego tagu (wymuszenie: `FORCE_RELEASE=1`).

### Podpisywanie i Notaryzacja macOS / iOS (Konto Apple Developer)

Workflow `.github/workflows/desktop.yml` automatycznie podpisuje aplikację certyfikatem Developer ID i notaryzuje ją w usłudze Apple Notary Service, jeśli w repozytorium GitHub (**Settings → Secrets and variables → Actions**) skonfigurowane są sekrety:

- `APPLE_CERTIFICATE` — zawartość certyfikatu *Developer ID Application* (`.p12`) zakodowana w Base64 (`base64 -i cert.p12 | pbcopy`).
- `APPLE_CERTIFICATE_PASSWORD` — hasło do pliku `.p12`.
- `APPLE_SIGNING_IDENTITY` *(opcjonalnie)* — pełna nazwa tożsamości, np. `"Developer ID Application: Imie Nazwisko (TEAM_ID)"` (jeśli pominięte, Tauri wykryje ją automatycznie z certyfikatu).
- `APPLE_ID` — adres email konta Apple Developer.
- `APPLE_PASSWORD` — hasło specyficzne dla aplikacji (App-Specific Password) wygenerowane na [appleid.apple.com](https://appleid.apple.com).
- `APPLE_TEAM_ID` — 10-znakowy Team ID z [developer.apple.com/account](https://developer.apple.com/account) (*Membership details*).

Gdy tych sekretów nie ma w repozytorium, pipeline CI wypisuje widoczne ostrzeżenie (warning) w podsumowaniu i buduje niesygnowany instalator `.dmg` — build kończy się sukcesem, a pliki trafiają do wydania.
