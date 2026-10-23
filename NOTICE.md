# Third-party notices

## JoyCon2Mac

Parts of `extension/joycon.js` are ported from JoyCon2Mac
(https://github.com/OZORDI/JoyCon2Mac): the rumble packet encoding
(`FillJoyConVibrationMotorBlock` / `JoyConRumbleAmplitude10Bit`), the player
LED and connection vibration commands, the battery voltage curve, and the
resting-center approach to stick calibration. Its license and notice follow.

```
MIT License

Copyright (c) 2026 JoyCon2Mac Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

This project builds upon reverse engineering work from:
- joycon2cpp by TheFrano (https://github.com/TheFrano/joycon2cpp)
- Joy2Win by Logan-Gaillard (https://github.com/Logan-Gaillard/Joy2Win)
- Switch2-Controllers by Nohzockt (https://github.com/Nohzockt/Switch2-Controllers)
- Switch2-Mouse by NVNTLabs (https://github.com/NVNTLabs/Switch2-Mouse)

Special thanks to ndeadly and Narr the Reg for IMU initialization sequence discovery.
```

## Rubik typeface

`extension/fonts/rubik-*.woff2` are from the Rubik project
(https://github.com/googlefonts/rubik), licensed under the SIL Open Font
License 1.1. The full license is in `extension/fonts/OFL.txt`.

## Protocol documentation

Protocol facts (GATT UUIDs, report layouts, commands, flash memory map) come
from switch2_controller_research by ndeadly
(https://github.com/ndeadly/switch2_controller_research). No code from that
repository is included.
