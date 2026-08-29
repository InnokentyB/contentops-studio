# Interface localization

The web interface uses `LocaleProvider` as its single locale boundary. English is the default for new visitors; the `EN / RU` selector persists the choice in `localStorage` under `planner-locale` and updates the document `lang` attribute.

Navigation and authentication are migrated to locale keys. Remaining operational screens must use `useLocale()` instead of adding new hard-coded user-facing strings. User-authored project content is not translated.
