# Project publication channels: grouping and name sorting

Status: APPROVED by Owner on 2026-10-20: «Да, делаем так». Approval covers scenarios and local implementation; production release is excluded.

Source: direct Owner request on2026-10-20 to group the publication-channel list in project settings by platform and sort by the Channel field. Inspected public base8ac0958a92bc751f8e43b4100a2ad4a2706254b1. Current Settings.tsx renders one flat table; Channel is channel.name, Platform is channel.type. The file is3154 lines and has source-contract tests. Existing small-screen table becomes stacked rows below720px.

## LOCK-027

Operator boundary: existing Project settings → Channels → Publication channels table. Existing project access and list loading remain authoritative.

- Group all currently listed channels by platform, with a platform heading and channel count. Groups are expanded and remain visible.
- Canonical Dzen group includes existing zen/dzen/zen_article aliases. Recognized platforms have readable labels; unknown platform types remain visible under their own label rather than being discarded.
- Order platform groups alphabetically by their displayed label for the current ru/en locale.
- Within every platform, default to ascending channel.name. A single accessible sort control above the list switches ascending/descending name order, available on desktop and mobile. Group order stays fixed when changing channel-name direction.
- Use locale-aware natural comparison, case-insensitive, with numeric ordering (Channel2 before Channel10). Equal names have a stable numeric channel.id tie-breaker. Sorting does not mutate the loaded list.
- Active/inactive channels and default-channel badge stay present. Existing edit, default and delete controls remain bound to actual channel.id; sorting does not save data, invoke a provider, reset an editing form or change channel configuration.
- Keep ru/en labels, current visual identity, six columns, existing empty/loading/error states and mobile stacked rows. No search field, collapsing, new screen or persisted sort preference is introduced.

## QAR-027

- Each loaded channel appears exactly once; group counts equal rendered channel rows, including editing rows. Sorting is deterministic across rerenders.
- Native keyboard-operable sort control has a localized accessible name and visible state; group headings are semantic table row-group headings. DOM order matches visual order.
- At375px and1280px widths, headings, sort control and long names remain readable without new page-level horizontal overflow; existing action controls stay usable.
- Pure grouping/sorting for1000 synthetic channels completes within100ms in the bounded Docker verification environment. No new request occurs on view-sort changes.
- Required verification: RED first at the user-visible boundary, focused UI behavior checks, existing settings/LinkedIn contracts, relevant frontend build and npm run quality:gate, all inside Docker. Human UAT remains explicit.

## ARCH-027

- Add a small dedicated presentation component for the grouped table shell/header/body, plus a typed pure grouping/comparison helper. Existing row-render callback and its mutation handlers remain in Settings for compatibility.
- Replace only the existing table wrapper/map integration in Settings.tsx; do not expand its3154-line business logic or copy its edit forms. New component/helper files stay below300 lines each.
- Preserve existing source-contract anchors (including the channel-table class passed through to the actual table), accessible labels and API/ID bindings. Add narrowly scoped group/sort styling using the existing theme and spacing.
- Canonical durable entity remains the existing SocialChannel record. The grouping is an in-memory view, not a new saved ordering, provider registry, permission source or lifecycle state.
- No backend/schema/migration/dependency/credential change. Production deployment is outside this local implementation approval; prepare exact public contents separately.

## RISK-027

Low-impact reversible presentation change. Name/type strings render as ordinary React text, never HTML. Unknown providers and inactive records are not filtered out. Grouping aliases changes display grouping only, never provider dispatch. Stable IDs protect row/action identity; no sorting by config/secret fields. Existing project/Owner/demo controls remain intact. Testing uses synthetic data, intercepted app APIs and no provider sessions. Preserve current empty/error states and avoid hidden sort controls on mobile, where the existing thead is not displayed.

Manual acceptance after engineering verification: Owner confirms that finding channels by platform and alphabetic name is convenient in the existing project settings and that editing still targets the selected channel. This is not authorized until the human approves this design; approval must precede final scenarios/tests and implementation as required by AGENTS.md.
