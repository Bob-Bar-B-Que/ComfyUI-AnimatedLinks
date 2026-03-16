# ComfyUI-AnimatedLinks ✨

> A visual enhancement extension for ComfyUI that adds animated arrows to links on hover and highlights Set/Get node pairs.

[![ComfyUI](https://img.shields.io/badge/ComfyUI-Extension-green?style=for-the-badge)](https://github.com/comfyanonymous/ComfyUI)
[![Version](https://img.shields.io/github/v/release/Bob-Bar-B-Que/ComfyUI-AnimatedLinks?style=for-the-badge)](https://github.com/Bob-Bar-B-Que/ComfyUI-AnimatedLinks/releases)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Frontend](https://img.shields.io/badge/Frontend-1.41%2B-purple?style=for-the-badge)](https://github.com/comfyanonymous/ComfyUI)
[![Ukraine](https://img.shields.io/badge/Made%20in-Ukraine%20🇺🇦-FFD700?style=for-the-badge&labelColor=005BBB)]()

---
## 🎬 Demo

<video src="assets/Links.mp4" autoplay loop muted width="700"></video>

## 🌻 Features
<!-- Replace with actual screenshots/webp when ready -->
| Feature | Preview |
|---|---|
| 🌊 Animated arrows on hover | <video src="https://github.com/user-attachments/assets/189f020e-0b3f-4464-8b6e-aaec55aa47af" controls loop muted width="400"></video> |
| 🌻 Set/Get node highlighting | <video src="https://github.com/user-attachments/assets/b6036154-6adb-4478-b8d0-a833cac629f3" controls loop muted width="400"></video> |

---

### 🌊 Animated Link Arrows
- Hover over any **node** to animate all its connected links
- **Rainbow colored** moving arrows that show data flow direction
- Arrow count scales **dynamically** with link length — short links get fewer arrows, long links get more
- Consistent animation speed regardless of link length
- Beautiful **glow effect** with colored shadows

### 🌾 Set/Get Node Highlighting
- Hover over a **SetNode** → highlights it in **yellow** + highlights all matching **GetNodes** in cyan
- Hover over a **GetNode** → highlights it in **cyan** (pulsing) + highlights the corresponding **SetNode** in yellow
- Works with **collapsed** nodes — highlight adapts to the actual node shape
- Compatible with [KJNodes](https://github.com/kijai/ComfyUI-KJNodes) Set/Get nodes

### ⚡ Performance
- Only renders when mouse is over a node — **zero overhead** when idle
- Uses ComfyUI's native rendering pipeline
- Compatible with ComfyUI Frontend **v1.41+**

---

## 📦 Installation

### Option 1: ComfyUI Manager (Recommended)
1. Open **ComfyUI Manager**
2. Click **Install Custom Nodes**
3. Search for `ComfyUI-AnimatedLinks`
4. Click **Install**
5. Restart or run ComfyUI.

### Option 2: Git Clone
```bash
cd ComfyUI/custom_nodes/
git clone https://github.com/Bob-Bar-B-Que/ComfyUI-AnimatedLinks.git
```
Restart or run ComfyUI.

### Option 3: Manual Install
1. Download this repository as **ZIP** (Code → Download ZIP)
2. Extract into `ComfyUI/custom_nodes/ComfyUI-AnimatedLinks/`
3. Make sure the folder contains `__init__.py` and `web/animated_links.js`
4. Run ComfyUI

### Option 4: Portable / Windows
1. Download ZIP and extract to:
   ```
   ComfyUI_windows_portable\ComfyUI\custom_nodes\ComfyUI-AnimatedLinks\
   ```
2. Restart or run ComfyUI.

---

## 🌻 How to Use

### Animated Arrows
Simply **hover your mouse over any node** — all connected links will animate with flowing directional arrows.

### 🌾 Set/Get Highlighting
- Install [KJNodes](https://github.com/kijai/ComfyUI-KJNodes) to use Set/Get nodes
- **Hover over a SetNode** to see which GetNodes use the same value
- **Hover over a GetNode** to see where the value comes from

---

## ⚙️ Configuration

You can tweak the animation by editing the `CONFIG` object at the top of `web/animated_links.js`:

```javascript
const CONFIG = {
  arrowSize: 7,          // Size of arrow triangles
  arrowSpacing: 120,     // Minimum distance between arrows (graph pixels)
  dotSpeed: 0.0008,      // Animation speed
  rainbow: true,         // true = rainbow colors, false = fixed color
  fixedColor: "#00cfff", // Color when rainbow is false
  glowWidth: 8,          // Width of the glow line
  glowBlur: 18,          // Intensity of the glow effect
};

```
## 📋 Changelog

### v1.7 — Current
- 🌊 Animated directional arrow triangles
- 🌾 Dynamic arrow count based on link length
- ⚡ Normalized animation speed across all link lengths
- 🌻 Set/Get node pair highlighting with pulsing effect
- 🇺🇦 Full compatibility with ComfyUI Frontend 1.41+
- Uses real ComfyUI render pipeline for accurate bezier curves

---

## 🌻 Support the Project

If this extension helps your workflow, consider supporting a Ukrainian developer 🇺🇦

### 🌻 Donatello (Ukrainian platform)
[![Donatello](https://img.shields.io/badge/🌻%20Donatello-Support-FFD700?style=for-the-badge&labelColor=005BBB)](https://donatello.to/Bob-Bar-B-Que)

### 🌾 Monobank
Scan the QR code or click on it to open the bank:

[![Monobank QR](assets/mono.png)](https://send.monobank.ua/jar/2UtLeKrSa8)

### 🪙 Crypto — USDT TRC20

Scan the QR code or click on it to copy the address:

[![USDT TRC20 QR](assets/USDT_trc20.png)](https://t.me/share/url?url=TKdsmXceZ2cUFDtF1hbPybZTvfarsuvP3k&text=USDT%20TRC20%20address)

```
## 📄 License

MIT License — free to use, modify and distribute.

---

## 🌾 Credits

- Built for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) by [@comfyanonymous](https://github.com/comfyanonymous)
- Set/Get node support via [KJNodes](https://github.com/kijai/ComfyUI-KJNodes) by [@kijai](https://github.com/kijai)
- Made with 🌻 in Ukraine 🇺🇦
