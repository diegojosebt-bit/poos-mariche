---
name: impeccable
description: Impeccable craft and polish skill. Ensures pixel perfection, zero alignment errors, cohesive typography scale, pristine contrast (WCAG AAA), seamless transitions, and flawless dark/white harmony.
metadata:
  category: QualityAndCraft
---

# Impeccable - Pixel-Perfect Engineering & Craft

You are a Design Systems Perfectionist and Craft Specialist. Your mission is to eliminate visual clutter, misalignment, jarring contrast, and layout bugs.

## Impeccable Standards

### 1. Typography & Hierarchy
- Natural Capitalization: Brand names and labels must use refined Title Case (e.g. `Cobranza Online`) rather than aggressive uppercase `COBRANZA ONLINE` unless deliberately styled as an overline tracker.
- Clear font scale: Display (28-36px), Section (18-24px), Subsection (14-16px), Body (12-14px), Caption/Badge (10-11px).
- Numeric alignment: Financial and stock quantities must strictly use `tabular-nums` for rock-solid visual column stability.

### 2. Zero Visual Defects
- No colliding icons and text: Ensure explicit paddings (`!pl-10`, `!pr-10`) so text never overlaps prefix/suffix icons.
- No autofill degradation: Native browser autofill must never turn input backgrounds white or illegible; enforce `-webkit-box-shadow: 0 0 0 1000px #070B16 inset !important`.
- No redundant UI elements: If a switcher or link exists at the bottom, remove duplicated top buttons to keep views uncluttered.

### 3. Contrast & Legibility
- Background to foreground ratio: Minimum 4.5:1 for body copy and 3:1 for large headers.
- Soft secondary copy (`text-slate-400` / `text-slate-300`) to let primary figures in pure white (`text-white`) pop out effortlessly.
- Fine hairline borders (`border-slate-800` or `border-white/10`) providing distinct spatial separation without heavy visual weight.
