# Recording the demo video

The competition video must be real gameplay (no AI-generated footage), with
captions on, and the game's own audio as the soundtrack. There is no headset,
so every shot is recorded in IWER, IWSDK's browser XR emulator, in its
`sunlit_living_room` room. The video must stay under 3:00; this plan comes
to **2:34** (eight shots, 2:25, then a 9-second end card).

**Director mode** plays each shot for you, with the same input a player would
use: emulated hands pinch, carry and let go of the planets, hand rays click the
panels, and the glasses shot uses gaze plus a pinch. You only start the
recording and click once. It exists only in the dev server (`?demo=1` does
nothing on the deployed site), and it saves nothing: every take starts from a
fresh game, and your own save is untouched.

The game's name comes from `APP_NAME` in `src/config.ts`. Below, **[NAME]**
means that name.

## 1. One-time setup

1. Use a 1920x1080 (or larger) screen if you can. On a smaller screen, such as
   a 1366x768 laptop, record full screen and export at 1080p; the editor
   upscales.
2. Pick a recorder:
   - **Windows Game Bar**: built in. Win+G opens it; Win+Alt+R starts and stops
     recording the active window. It records the window with system audio. In
     Settings > Gaming > Captures, choose 60 fps and "High" video quality, and
     turn on "Record audio when I record a game".
   - **OBS Studio** (free): add a "Window Capture" source for the Chrome window,
     and an "Application Audio Capture" source for `chrome.exe` (or keep
     "Desktop Audio"). Set Settings > Video to 1920x1080 at 60 fps.
3. Mute notifications (Windows Focus / Do not disturb), and close other apps
   that play sound.

## 2. Start the dev runtime

In a terminal at the repository root:

```sh
npx @iwsdk/cli dev up --no-open
```

This starts the dev server at `https://localhost:8081` without the managed
browser window, so your own Chrome or Edge window is the headed IWER session
(the dev server adds IWER to any page it serves on localhost). `npm run dev`
starts the same server plus a managed Chromium window; that window plays the
shots too (the automated check `npm run demo:shots` uses it), but it shows an
automation banner and the IWSDK toolbar, so record in your own window.

1. Open Chrome or Edge, go to `https://localhost:8081/` and accept the local
   certificate warning once (Advanced > Proceed).
2. Size the window: press F11 for full screen, or start a 1920x1080 window
   from PowerShell:

   ```powershell
   Start-Process chrome '--new-window --window-size=1920,1080 https://localhost:8081/?demo=1&shot=1'
   ```

3. Keep the window visible while a shot plays: a hidden or minimized window
   stops the emulator's frames, and the shot stops with an error.

When you are done, stop the server with `npx @iwsdk/cli dev down`.

## 3. Record one shot

1. Open the shot's URL (table below). The page enters the emulated session,
   seats you at the coffee table and places the board on it (about 10 s).
   Then it shows a card: "Shot N: ... Start recording, then click anywhere to
   play."
2. Start recording (Win+Alt+R, or Start Recording in OBS).
3. Click anywhere. The card disappears and the shot plays. The click also
   turns the game's audio on.
4. Stop recording when the tab title changes to **Done: shot N** (the
   "Plays" time below, plus a second or two). The last frame stays on screen.
5. In the editor, cut the first second (the card) and trim to the "Edit" length.

To retake a shot, reload the page (F5) and repeat. `https://localhost:8081/?demo=1`
plays shots 0-5 and 7 one after another in one take; it is handy for a
rehearsal, but separate takes are easier to edit.

If a shot stops, a card says where and why (for example "Shot 6 needs the Meta
VR Glasses emulator"). The browser console (F12) also logs each shot's start
and its length.

### Shot 6 needs the Meta VR Glasses emulator

Shot 6 shows the Meta VR Glasses view: its narrow field of view, with the
area outside it masked, and gaze plus a pinch as the input.

1. In `iwsdk.config.json`, change `"device": "metaQuest3"` to
   `"device": "metaVRGlasses"` and save. The dev server restarts by itself
   (about 20 s).
2. Reload `https://localhost:8081/?demo=1&shot=6` and record as above.
3. Change the line back to `"device": "metaQuest3"` and save. The other shots
   refuse to run on the glasses device, and shot 6 refuses the Quest 3.

After `dev down`, a config change can leave one Node process of the first dev
server running. Check with
`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine`
and stop the one whose command line contains `vite\bin\vite.js` and this
folder (`Stop-Process -Id <id>`).

## 4. Shot list

"Edit" is the length in the final video; "Plays" is how long director mode
takes on this machine, measured by `npm run demo:shots`.

| # | URL (after `https://localhost:8081/`) | Edit | Plays | What happens | Stop when |
| --- | --- | --- | --- | --- | --- |
| 0 | `?demo=1&shot=0` | 0:12 | 20.2 s | The opening hook. Leaning over the coffee table, the real room only. On the click the room dissolves into deep space over 2.5 s while the head holds still: the couch, the walls and the floor turn to black space with thousands of fine stars, and only the table with the board stays real (Room view: Mixed). Then the head rises slowly and the sunlit ringed giant comes into view, holds, and eases back down over the board. A hand pinches the planet onto its spot and lets go: the comet flies past the lit planet, the grid ripples, the target flares and the comet rises into the sky as a star. | The comet has risen into the sky |
| 1 | `?demo=1&shot=1` | 0:06 | 6.5 s | Level 6 with the white star already set. A hand pinches the planet from the tray onto the coffee table and lets go. The comet curves past the planet, the white star and the black hole (three bells) and hits the star. | The star is hit and the HUD shows the stars |
| 2 | `?demo=1&shot=2` | 0:20 | 24.6 s | Level 1 from a fresh game: the comet's attract loop and the ghost hand showing pinch, drag and let go. Then a real hand places the planet, the comet misses, the hand moves it and the comet hits the star (3 stars). | The HUD has shown 3 stars for about 4 s |
| 3 | `?demo=1&shot=3` | 0:26 | 30.2 s | Levels 4, 5 and 6 in a row, each placed by hand and flying: the black hole slings the comet, the white star pushes it, then both together. | Level 6 is solved |
| 4 | `?demo=1&shot=4` | 0:22 | 22.1 s | Level 6 solved with its melody (planet, white star, black hole: 3 stars); the notes replay as a phrase and end on a chord. The hand ray clicks Next and the chapter-complete moment opens: the ring of stars over the board, the looping comet, the arpeggio and "Chapter 1 complete: 18 of 18 stars". Then the head tilts up: the six solved levels form the chapter constellation in the sky, its links drawn in order, while the big planets pulse with the chord. | The constellation has been on screen about 4 s |
| 5 | `?demo=1&shot=5` | 0:21 | 31.2 s | Your Table: the hand ray clicks Make well, aims at the real cup on the coffee table (the reticle sits on it) and pinches: the cup becomes a gravity well. The hand places the planet and lets go; the comet bends around the cup while the camera leans to the side. Then the hand ray clicks Replay, and from the side the cup hides the comet as it passes behind it (depth occlusion). | The replayed comet has left the board |
| 6 | `?demo=1&shot=6` (glasses device) | 0:16 | 18.1 s | Meta VR Glasses view with its field-of-view mask. The gaze picks the planet, a pinch with the hand at rest (out of view) carries it, and level 1 is solved. Then gaze plus pinch opens Levels and picks level 2. | Level 2 has loaded |
| 7 | `?demo=1&shot=7` | 0:22 | 28.9 s | The hand ray opens Levels, then Settings: High contrast on (brighter rims, outlines), Board size large, small, medium, Left-handed on, Reduced motion on, Back, Close. The board then shows the left ghost hand on the high-contrast board, with nothing else moving. | The ghost hand has shown its move |

Shot 4 starts with levels 1-5 already at 3 stars: before the card, the
director plays their stored 3-star solutions through the game's own launch
and flight (off screen, in no time), as if you had played them. That is why
the chapter moment shows 18 of 18.

Shot 5: where the room puts the cup, no Your Table target can be solved with
that well, so the shot shows the comet bending around the cup and flying on,
not a hit. Say "bends" in the caption, not "solves".

Every shot plays in the Realistic Space look: dark space all around with
thousands of fine stars of real colours and a faint Milky Way, a sunlit,
textured ringed giant with its moons, other lit planets that orbit on their
own (inner ones faster), an asteroid belt and faint dust close to you. In
Room view Mixed the room shows only through a soft window over the board
and the table; the couch, the walls and the floor are space. On the board,
lit 3D bodies float over a spacetime grid that dips under each mass; the
comet has a curved warm dust tail and a straight blue ion tail, the black
hole a Doppler-bright disk and a photon ring, and flybys ripple the grid.
There are no comic words. Shot 0 holds the cosmos back until the click,
then lets the room dissolve into space.

The Quest shots film from a camera leaning in over the board (about 0.57 m
from its center, 45 degrees down), closer than the seated pose the board was
placed from, so the board and its bodies fill more of the frame. Shots 6 and 7 film from the seated pose
itself: the glasses fit and the Settings clicks were measured there.

## 5. Editing order, voiceover and captions

Captions on for the whole video: burn in the voiceover text, or upload it as
a caption file (YouTube and Vimeo both take `.srt`). The soundtrack is the
game's own audio from the recordings; keep it at full level under the voice,
and let the bells play on their own where the script says so.

| Time | Shot | Voiceover (also the caption) | Extra on-screen text |
| --- | --- | --- | --- |
| 0:00-0:12 | 0 | "Your room dissolves into deep space. The table stays." (then let the flight and the solve play without voice) | Over the rising star: **[NAME]**. Small, bottom corner, for the whole video's first 12 s: "Real gameplay, recorded in the IWER emulator" |
| 0:12-0:18 | 1 | (no voice for 3 s: let the three bells ring) "Pinch a planet onto your real table." | The tagline "Every solution plays a song." |
| 0:18-0:38 | 2 | "Your table is the board. The ghost hand shows the move: pinch, drag, let go. Miss, nudge the planet, try again. First level, about thirty seconds." | |
| 0:38-1:04 | 3 | "Every body bends the comet. A black hole slings it. A white star pushes it away. Each one you pass rings its own note." | "Black hole" and "White star" as labels while each flies |
| 1:04-1:26 | 4 | "Ring the notes in the right order and you earn the third star: your solution plays back as a melody. Every solve becomes a star overhead; finish the chapter and they join into a constellation." | |
| 1:26-1:47 | 5 | "Your Table mode turns real things into gravity. Aim at a cup and pinch: now it pulls the comet. Depth sensing keeps the cup in front of the comet when it passes behind." | "Depth occlusion" during the replay |
| 1:47-2:03 | 6 | "Built for Meta VR Glasses too: look at a planet, pinch anywhere, and move it. Every button works by gaze." | "Meta VR Glasses view (emulated)" |
| 2:03-2:25 | 7 | "Left-handed, high contrast, reduced motion, three board sizes, and how much of your room turns to space, all from the Settings page." | |
| 2:25-2:34 | end card | "Built with the Immersive Web SDK. Play it in your Quest browser." | "Built with IWSDK", "N automated tests, solver-verified levels" (take N from `npm test` and `npm run verify:iwer`), then the URL: https://krushnasalunke215-lang.github.io/pocket-orbit-plus/, and in small type at the bottom the credit "Planet and Milky Way textures: Solar System Scope, CC BY 4.0, solarsystemscope.com/textures" |

For the end card, freeze the last frame of shot 4 (the constellation) or
shot 7 and put the text over it. The texture credit is required: the CC BY
4.0 licence asks for attribution wherever the textures appear, and they
are in every shot (director mode renders no end card of its own, so the
credit goes on in the editor). Keep each caption on screen while its line
is spoken; split lines longer than about 40 characters into two.

Then export at 1080p, 30 or 60 fps, check that it is under 3:00, and upload
it as public on YouTube or Vimeo.

## 6. Backup clips (silent)

`npm run demo:clips` records every shot with Playwright as a silent
1280x720 `.webm` in `.agents/tasks/video-clips/` (`shot-0-dissolve.webm` to
`shot-7-accessibility.webm`), with one frame of each saved beside it as a
`.png`. It starts the dev server itself (no managed window), switches to the
glasses device for shot 6 and back, and stops the server at the end. Use the
clips only if a live take fails: they have no sound, so lay the game audio
from a live take under them.

## 7. Checks

`npm run demo:shots` plays every shot (`?demo=1&shot=0` to `shot=7`, without
the start card) in a headed managed IWER window and fails on a director error
or a console error; it saves one frame of each shot to
`.agents/tasks/screenshots/cosmos-real/demo-shot-N.png` and the timings to
`test-results/demo-shots-summary.json`.
