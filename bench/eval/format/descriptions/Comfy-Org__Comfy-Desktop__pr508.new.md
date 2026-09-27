fix(launcher): make the title-bar feedback button work in Comfy windows

The title-bar Send Feedback button did nothing in Comfy instance windows (the Dashboard's works): `triggerOpenFeedback` only sent the `comfy-panel:open-feedback` IPC when `panelView` existed, and those windows build the panel lazily on the first non-Comfy switch, so a click on the ComfyUI body hit the early return.

- `triggerOpenFeedback` now follows the `click-install-update-pill` pattern: `ensurePanelView` creates the panel for the current body mode, invisible and at zero size behind the comfyView
- While the panel bundle is still loading, the IPC waits for `did-finish-load`, so PanelApp's listener is registered before it arrives

Tested: `pnpm run typecheck`, `lint`, `test` (802/802) and `build` pass. To check by hand: in a fresh Comfy window, click Send Feedback before anything else, and again from the waffle menu; the typeform should open.
