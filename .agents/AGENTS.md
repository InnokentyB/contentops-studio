# Strategic Planner Environment Constraints

- **Execution Context:** The strategic planner tool runs inside a Docker container with the root directory `/app` and does not have access to the local host's project files.
- **Content Files & Paths:** Because of this container isolation, referencing local file paths in `content_files` will hang/timeout. Always pass inline content/bodies in `assets` instead of relying on file imports.
