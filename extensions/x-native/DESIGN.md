---
name: ContentOps X native pilot
description: Source-grounded visual contract for the scoped X native operator popup.
colors:
  primary: "#333697"
  primary-hover: "#252874"
  text: "#252536"
  text-secondary: "#4b4b60"
  canvas: "#f7f8fc"
  control: "#fff"
  divider: "#d6d6e4"
  control-border: "#9292ab"
  control-hover: "#ededfa"
  status: "#ededf6"
  selection: "#dce0ff"
  selection-text: "#20205c"
typography:
  headline:
    fontFamily: "Arial, sans-serif"
    fontSize: "1.5rem"
    lineHeight: 1.3
  title:
    fontFamily: "Arial, sans-serif"
    fontSize: "1.05rem"
  paragraph:
    fontFamily: "Arial, sans-serif"
    fontSize: "0.9rem"
    lineHeight: 1.55
  label:
    fontFamily: "Arial, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 600
  button:
    fontFamily: "Arial, sans-serif"
    lineHeight: 1.4
rounded:
  control: "8px"
spacing:
  label-gap: "8px"
  compact: "12px"
  control-gap: "16px"
  field-gap: "20px"
  page: "24px"
  section-gap: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.control}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.control}"
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.control-hover}"
  text-field:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "12px"
    width: "100%"
  status:
    backgroundColor: "{colors.status}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.paragraph}"
    padding: "16px"
---

# Design System: ContentOps X native pilot

## Overview

**Creative North Star: "ContentOps restrained Operate"**

This document captures the existing X native pilot, not a new brand direction. The first body comment in `pilot.html` is the visual authority: retain ContentOps restrained indigo, flat sections and native form controls. Arial, a light canvas and sparse indigo actions support a precise operator workflow.

The package and no-send check precede an explicitly separate publication area. Installation identity, signed backend pairing/enrollment, backend owner UAT, no-send checking and released publication are separate events. The popup does not grant those authorities. Future publications reuse the installation enrollment through the shared lifecycle; the popup no-send action is not a requirement to repeat backend enrollment or owner UAT for each post.

**Key Characteristics:**

- Restrained inherited indigo; no replacement palette or visual world.
- Flat, rule-separated sections with native controls and visible labels.
- Textual status, explicit consent and a disabled-by-default send action.
- Public installation information only; no secret-bearing presentation.

Scope: `pilot.html`, `pilot.css`, `pilot-ui.mjs` and `pilot-ui-controller.mjs` in this directory. There is no scoped PRODUCT.md or approved visual comp. The separate key-only compatibility screen is not the pilot's visual authority.

Verification: the initial **No usable sandbox** result is superseded by a successful bounded fixture run in the existing reviewed container sandbox, using its exact seccomp profile and `SYS_CHROOT`, not `SYS_ADMIN`. `chrome://sandbox` reported namespace and seccomp protections **YES**. Desktop (`720px`) and mobile (`360px`) screenshots are recorded at the repository-relative paths `.impeccable/review/desktop.png` and `.impeccable/review/mobile.png`. The `x_finish_review` inspection returned **PASS — bounded visual/source review**. Both scoped P2 source fixes are resolved; the P1 claim that each popup check must repeat backend owner UAT is withdrawn. Real-account owner UAT remains unperformed; fixture evidence does not establish live publication readiness or owner acceptance.

## Colors

The palette is the existing restrained indigo and cool neutral set; the frontmatter records the exact CSS values.

### Primary

- **ContentOps indigo** (`primary`): primary publication action, secondary-action borders/text, links, focus outlines, caret and consent accent.
- **Deep indigo** (`primary-hover`): hover on the primary publication action only.

### Neutral

- **Dark ink** (`text`) and **supporting ink** (`text-secondary`): primary form content versus instructions and status text.
- **Cool canvas** (`canvas`) and **control white** (`control`): page and native form/action surfaces.
- **Section rule** (`divider`) and **field stroke** (`control-border`): separate workflow sections and identify editable controls.
- **Action wash** (`control-hover`) and **status wash** (`status`): secondary hover and the persistent result region.
- **Selection wash** (`selection`) and **selection ink** (`selection-text`): text selection only.

**The Textual State Rule.** Do not invent success/error colors: the current implementation distinguishes outcomes in the status text, not by a semantic color ramp.

## Typography

Arial with the generic sans-serif fallback is the implemented interface family. Headline, section title, paragraph, label and button roles are defined in the frontmatter. Heading weights are not explicitly overridden in the stylesheet; retain native heading semantics rather than inventing a new weight scale.

Paragraphs use a readable line height and a maximum measure of `70ch`. Labels are semibold; the consent label returns to regular weight and a line height of `1.5`. Public installation data uses native `pre` typography at `0.8rem` with a `1.5` line height. The status region is `0.9rem` and preserves line breaks while allowing long text to wrap anywhere.

## Layout

Use one document-flow column. The body has a minimum width of `320px`, maximum width of `720px`, centered horizontal margins and page padding from the frontmatter. At viewport widths at or below `420px`, page padding becomes `16px` and buttons span the available width. No multi-column layout or additional breakpoint is implemented.

The main heading and introductory no-send explanation lead into a collapsed installation disclosure. The package section follows, then a separate send/result section. Sections have `28px` top margin, `24px` top padding and a one-pixel top rule. Section headings have `16px` bottom margin. Subsequent labels have `20px` top margin; labels leave `8px` before fields. Buttons and disclosures have `16px` top margin. Inputs and textareas fill their container; textareas resize vertically. The consent row uses flex alignment at the top with a `12px` gap and a fixed `20px` checkbox.

## Elevation & Depth

No shadows, gradients, floating cards or animated elevation are implemented. Depth comes from the light canvas, white controls, subtle status wash and section rules. Hover changes only the button background. There are no declared transitions or motion tokens.

## Shapes

Buttons, inputs and textareas share gently rounded control corners using the frontmatter radius and a one-pixel border. Buttons have a minimum height of `44px` and left-aligned text. Sections and the status region remain flat and unrounded. Keep the browser-native checkbox and disclosure marker; no custom icon system is present.

## Components

### Buttons

Secondary actions are white with indigo text/stroke; the one-time publication action is indigo with white text. Preserve their different hover backgrounds. Disabled buttons retain their shape at `0.6` opacity with a not-allowed cursor. Focus-visible buttons, fields, links and disclosure summaries have a three-pixel indigo outline with a three-pixel offset.

### Fields and consent

Use visible Russian labels for the JSON package, code and optional exact text. Help text remains connected through the implemented accessible descriptions. The package has eight public fields; the UI warns against tokens and cookies. The code field allows `64` characters; optional local text allows `280` characters. These limits describe the current controls, not new authority rules. The consent checkbox is disabled until current exact-package readiness permits consent; it is never a prechecked shortcut.

### Disclosures

Native `details`/`summary` groups reveal public installation data and the optional local no-code check. Summaries have vertical padding and the same visible focus treatment as other interactive controls. Do not introduce navigation, tabs or card components that the popup does not have.

### Status and confirmed link

One persistent polite live status region reports not-checked, busy, local no-send, pairing-verified no-send, ready-not-sent, expired, reconciliation-required, connection-loss, invalid-input, native mismatch and confirmed-publication outcomes. Repeated rendering does not rewrite unchanged status text. Public installation output stays hidden until returned. The confirmed-post link stays hidden without a validated URL and opens in a new tab with `noopener noreferrer`.

### Runtime states

- Initial or edited input: not checked; send and consent are unavailable. Editing clears local consent/readiness.
- Busy: identity, check, readiness, reconciliation and fields are disabled; consent/send remain gated.
- Ready: exact-package readiness lasts locally at most `30` seconds; deliberate consent is still required. Readiness is not publication success.
- No-send: distinguish local checking from server-verified pairing, and neither from publication permission.
- Started or uncertain: use same-attempt reconciliation, not a resend or journal reset. Closing the popup does not cancel a started worker operation.
- Confirmed: display Planner confirmation and only expose a post link validated for the expected profile/status URL.

**The Authority Separation Rule.** Preserve the visual and textual separation between installation identity, no-send checking, readiness, deliberate publication and reconciliation. Local intent never replaces server authorization.

## Do's and Don'ts

### Do:

- Do preserve the inherited indigo, Arial and flat section rhythm.
- Do keep no-send checking and publication visibly separate.
- Do retain labels, keyboard focus outlines, native disclosures and textual status.
- Do preserve expired, busy, disabled and uncertain states as distinct operator outcomes.
- Do keep enrollment/backend owner UAT separate from popup no-send checks and reuse enrollment for future publications.

### Don't:

- Don't invent a new palette, tonal ramp, card system, navigation or decorative imagery.
- Don't imply installation data, pairing, readiness or a receipt proves publication success.
- Don't bypass consent, exact-package authorization or same-attempt reconciliation with a visual shortcut.
- Don't present fixture screenshots, source inspection or this document as real-account owner acceptance.
