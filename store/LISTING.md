# Chrome Web Store submission

Published: https://chromewebstore.google.com/detail/joy2cloud/jjnpndfledflbabfinlmaiddnfonmdbk

Everything needed to fill in the Developer Dashboard, field by field.
Upload `dist/joy2cloud-v<version>-store.zip` (built by `npm run package`;
it has `manifest.json` at the root, as the store requires).

## Store listing

**Description** (the summary comes from the manifest, so this is the long one):

```
Play cloud games in Chrome with your Nintendo Switch 2 Joy-Con. No drivers, no system changes.

Switch 2 controllers use their own Bluetooth protocol, so computers don't recognize them as gamepads. Joy2Cloud connects to them straight from Chrome over Web Bluetooth and presents them to cloud gaming sites as a regular Xbox controller.

HOW IT WORKS
1. Click the Joy2Cloud icon to open its tab, and keep that tab open.
2. Hold the sync button on a Joy-Con until the lights flash, click Pair a Joy-Con and pick it from the list. Repeat with the other one.
3. Open your cloud gaming site in another tab and play.

FEATURES
• Both Joy-Con 2 combined into one Xbox-style controller
• Live view of every button and stick, so you can check everything before playing
• Stick calibration: reads each controller's factory calibration, plus a guided calibration so diagonals reach full tilt
• Vibration from the game, split across both grips like an Xbox controller, with adjustable strength
• Face buttons by position (bottom button is A, matching on-screen prompts) or by letter
• Auto-reconnect, and disconnect buttons when you're done
• Dark and light themes; English, Português, Français and Español

WORKS WITH
Xbox Cloud Gaming (tested). GeForce NOW, Amazon Luna and Boosteroid use the same browser controller API and should work too.

PRIVACY
No data collection, no analytics, no network requests of its own. Settings stay on your device.

Open source (MIT): https://github.com/Matheusnugas/Joy2Cloud

Joy2Cloud is an independent project, not affiliated with or endorsed by Nintendo, Microsoft, NVIDIA, Amazon or Boosteroid. Nintendo Switch and Joy-Con are trademarks of Nintendo; Xbox is a trademark of Microsoft.
```

**Category:** Games

**Language:** English

**Graphics** (all in this folder):

| Field | File |
| --- | --- |
| Store icon (128×128) | `store-icon-128.png` |
| Screenshots (1280×800) | `screenshot-1.jpg`, `screenshot-2.jpg`, `screenshot-3.jpg` |
| Small promo tile (440×280) | `promo-small.png` |
| Marquee promo tile (1400×560) | `promo-marquee.png` |

**Homepage URL:** https://github.com/Matheusnugas/Joy2Cloud

**Support URL:** https://github.com/Matheusnugas/Joy2Cloud/issues

## Privacy practices

**Single purpose:**

```
Lets Nintendo Switch 2 Joy-Con controllers be used as a game controller on cloud gaming websites, by connecting to them over Web Bluetooth and presenting them to the page through the browser's Gamepad API.
```

**Permission justification: storage**

```
Saves the user's own settings (language, theme, button layout, vibration strength) and the stick calibration recorded for each controller, locally on the device, so they persist between sessions.
```

**Host permission justification** (content scripts on xbox.com, play.geforcenow.com, luna.amazon.*, cloud.boosteroid.com, gamepad-tester.com, hardwaretester.com):

```
On these cloud gaming and gamepad-testing sites only, the extension adds a script so the page's Gamepad API reports the connected Joy-Con as a controller, and so the game's vibration requests can be sent back to the controllers. It does not read, modify or collect page content, and it runs on no other sites.
```

**Are you using remote code?** No, I am not using remote code.

**Data usage:** leave every data type unchecked (the extension collects none),
then tick the three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/Matheusnugas/Joy2Cloud/blob/main/PRIVACY.md

## Distribution

Visibility: Public. Regions: all.

## Notes for the reviewer

If the dashboard offers a field for test instructions:

```
This extension needs Nintendo Switch 2 Joy-Con controllers to do anything visible in a game. Without them, you can still click the toolbar icon to open the Joy2Cloud tab (pairing, live controller view, settings). To see the virtual controller a site receives, open gamepad-tester.com in another tab after pairing a Joy-Con. The extension makes no network requests and stores only local settings.
```
