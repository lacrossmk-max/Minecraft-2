# Blockwelt – Voxel-Sandbox fürs Handy 📱⛏️

Ein komplett eigenständiges, Minecraft-**inspiriertes** Voxel-Sandbox-Spiel, das direkt
im Browser läuft – optimiert für Touch-Bedienung auf dem Handy, aber auch am Desktop
mit Maus und Tastatur spielbar. Alle Texturen und Sounds werden prozedural im Code
erzeugt, es werden keine fremden Assets verwendet.

## ▶️ Spielen

**Option 1 – GitHub Pages (empfohlen):**
1. Im Repository: *Settings → Pages → Source: „Deploy from a branch"*, Branch auswählen, Ordner `/ (root)`.
2. Danach ist das Spiel unter `https://<benutzername>.github.io/<repo>/` erreichbar.
3. Auf dem Handy öffnen → „Vollbild" tippen → am besten „Zum Startbildschirm hinzufügen" (läuft dann offline als App).

**Option 2 – lokal:**
```bash
# im Repo-Ordner:
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## 🎮 Steuerung

**Handy (Touch):**
| Aktion | Geste |
|---|---|
| Laufen | linke Bildschirmhälfte berühren und ziehen (Joystick erscheint am Finger) |
| Umsehen | rechte Bildschirmhälfte wischen |
| Block setzen / benutzen / essen / Mob schlagen | kurz tippen |
| Block abbauen | gedrückt halten (Fortschrittsring) |
| Springen | ⬆-Knopf |
| Fliegen (Kreativ) | ⬆ doppelt tippen, ⬇ zum Sinken |
| Inventar / Handwerk | 🎒-Knopf |
| Sprinten | Joystick ganz nach vorn |

**Desktop:** WASD laufen, Maus umsehen (klicken für Mauszeiger-Sperre), Linksklick halten = abbauen, Rechtsklick = setzen, Leertaste = springen, F = fliegen (Kreativ), Shift = sinken, Strg = sprinten, E = Inventar, 1–9 = Hotbar, Esc = Pause.

## ✨ Features

- **Unendliche prozedurale Welt** mit Seed-Eingabe (gleicher Seed = gleiche Welt)
- **Biome:** Ebenen, Wald, Wüste (Kakteen!), Schneelandschaft, Gebirge, Ozeane & Strände
- **Höhlen** mit Lavaseen und **Erze**: Kohle, Eisen, Gold, Diamant (tiefenabhängig)
- **26 Blocktypen** inkl. Glas, Ziegel, Leuchtstein, TNT, Blumen, hohes Gras
- **Überlebensmodus:** Herzen, Hunger, Ertrinken, Fallschaden, Lava-/Kaktusschaden, Tod & Respawn
- **Kreativmodus:** unbegrenzte Blöcke, Fliegen
- **Handwerk:** vereinfachte Rezepte (Bretter, Werkbank, Glas, Ziegel, Leuchtstein, TNT)
- **Mobs:** Schweine (droppen Koteletts zum Essen) und nachts Zombies, die dich jagen und bei Tag verbrennen
- **TNT** mit Zündung, Kettenreaktion und Explosionskrater
- **Tag-/Nachtzyklus** mit Sonne, Mond, Sternen, Dämmerungsfarben und Uhr
- **Wasser & Schwimmen** mit Luftanzeige, Unterwasser-Tönung
- **Essen:** Äpfel (aus Laub) und Koteletts füllen den Hunger
- **Speichern:** Welt, Inventar und Position werden automatisch im Browser gespeichert
- **Partikel- und Soundeffekte** (prozedural per WebAudio)
- **PWA:** offline spielbar, als App installierbar
- Einstellungen: Sichtweite, Empfindlichkeit, Sound, Vollbild

## 🔧 Technik

- Reines HTML/CSS/JavaScript + [three.js](https://threejs.org) (lokal in `lib/` enthalten, keine Internetverbindung nötig)
- Chunk-basiertes Voxel-Rendering (16×64×16) mit Face-Culling und getrennten Meshes für opake, transparente und Wasser-Geometrie
- Deterministische Weltgenerierung: Perlin-Noise (2D/3D) für Terrain, Biome und Höhlen; Hash-basierte Platzierung von Bäumen und Erzen
- Nur Spieleränderungen werden gespeichert (Edit-Liste), der Rest wird aus dem Seed regeneriert

## ⚠️ Hinweis

Dies ist ein eigenständiges Fan-Projekt aus komplett eigenem Code und eigenen,
prozedural erzeugten Grafiken/Sounds. Es ist **nicht** Minecraft und steht in keiner
Verbindung zu Mojang oder Microsoft. Einige Original-Features (z. B. Redstone, Nether,
Verzauberungen, Multiplayer) sind bewusst nicht enthalten.
