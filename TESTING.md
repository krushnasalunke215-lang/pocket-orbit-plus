# Testing on a Quest headset

Thank you for testing. This takes about 5 minutes plus the time to write
down what you saw.

## The words used here

- **XR**: the immersive mode where the game fills your headset view instead
  of a flat browser window. The game offers mixed reality (AR) and falls back
  to plain VR when AR is missing.
- **Passthrough**: the headset's camera view of your real room. In AR the
  board sits on your real table and you see your room around it.
- **Debug overlay**: a small text panel to the left of the game's main panel
  (the HUD) with frame rate and measurements. It only appears when the page
  address ends with `?debug=1`.

## What you need

- A Meta Quest 3, Quest 3S or Quest Pro with the Quest Browser.
- A table in front of a chair. Space Setup (the room scan in the headset
  settings) is optional: test with it done and, if you can, with it skipped.
- For the real-object check: a mug, a bottle and a book, and a ruler.

## Open the game

1. In the Quest Browser open
   **https://krushnasalunke215-lang.github.io/pocket-orbit-plus/?debug=1**
   (without `?debug=1` it is the same game with no overlay).
2. Sit at your table and press **Enter AR** on the panel. Allow the
   permissions the browser asks for.
3. Use your hands (put the controllers down). Pinch thumb and index finger
   to grab a planet; let go to launch the comet.

## The 5-minute checklist

For each item, write down what happened. Short notes are fine.

1. **Frame rate.** At the start of level 1, read the overlay's first line
   (`fps .. avg | 1% low ..`). Read it again while the comet is flying.
   Report both pairs of numbers. The open level select covers the overlay,
   so close it (**Close**) before you read.
2. **Pinch-grab reliability.** Grab and move planet 1 five times. How many
   pinches grabbed on the first try? Then pinch right next to a planet
   (about 2 cm beside it, not on it): did it grab the planet, nothing, or
   something else?
3. **Text legibility.** Hold your head at a normal seated distance. Can you
   read the HUD (the panel behind the board) and the level select (press
   **Levels**) at arm's length? Which text was hard to read? Can you reach
   the Levels button, or did you have to aim at it from a distance?
4. **Table placement.** With Space Setup done: where did the board land (on
   your table, floating, in the floor)? Could you move it with the handle
   (the bar at the near edge of the board)? If you can, repeat with Space
   Setup skipped or cleared and say where it landed.
5. **The near-rim Launch/Replay button** (the small button left of the
   board's near edge). Press it once with a fingertip, and once by pinching
   while pointing at it. Did each launch the comet exactly once?
6. **Real objects (Your Table).** Press **Levels**, then **Your Table**, then
   **Make well**. Pinch Make well with the hand you will point with: the
   aiming circle (the reticle) follows that hand (a fingertip press uses the
   hand that pinched last). Point your hand at the top of a mug. Before you
   pinch, write down the overlay's hit line
   (`hit .. cm above board | jitter .. mm`). Then pinch: did the glowing
   well ring sit on the mug? Repeat with a bottle and a book (press Make
   well again each time). There is room for 3 wells: if the panel says
   "Max 3 wells", press **Clear wells** and carry on. Measure each object's
   real height with a ruler. Report a small table:

   | Object | Ruler height (cm) | Overlay height (cm) | Jitter (mm) | Ring on the object? |
   | ------ | ----------------- | ------------------- | ----------- | ------------------- |
   | Mug    |                   |                     |             |                     |
   | Bottle |                   |                     |             |                     |
   | Book   |                   |                     |             |                     |

   Also: does the board flicker on the table, and does the mug hide the part
   of the board behind it?
7. **Hand tracking lost mid-drag.** Grab a planet, keep pinching, and hide
   that hand behind your back. The planet should jump back to where it was,
   and the comet should not launch. Did it?
8. **Sound.** Did each planet ring a note from where it sits as the comet
   passes? Was anything too loud or too quiet (the bell notes, the soft
   background pad, the whoosh of the comet)?
9. **First minutes.** Before you touched anything, a see-through ghost hand
   showed how to drag a planet on level 1. Did you understand it without
   reading text? If you are left-handed, was a right ghost hand a problem?
10. **Level 6 three stars.** If you get that far: is 3 stars on level 6
    (Light and Dark) possible or frustrating?

## How to report

Please include:

- Your headset model (Quest 3, 3S or Pro).
- The Quest Browser version (Settings > Apps, then the Browser entry).
- One line copied from the overlay log, if you can reach the browser
  console; it looks like
  `{"fps":71.8,"low1":58.2,"calls":46,"triangles":22444,"hitHeightCm":16.3,"jitterMm":0.4}`.
  If not, the numbers you read from the overlay are enough.
- Screenshots or a short video (Quest: press the Meta button and use the
  camera icon).
- Your answers to the checklist above.

Post your report in the Meta Community Forums competition thread, or reply
to the direct message that asked you to test. Thank you!
