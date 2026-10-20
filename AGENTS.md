<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Keep the core experience as a client-only React Three Fiber game; the interactive workshop and circuit scenes must not render during SSR because WebGL is browser-only.
- Normalize cloud-saved car configurations on read so older builds remain usable when categories or customization fields evolve.
- Share a lightweight rendering pipeline across workshop and race scenes: native MSAA, DPR capped at 1.5, one hemisphere and one directional light, baked reflection capture and static contact textures; this bounds integrated-GPU costs.
- Normalize cloned imported vehicle meshes in meters and isolate imported model failures from the canvas; this prevents arbitrary GLTF origins or missing resources from blanking the game.
- Keep interactive vehicle physics in a fixed-step browser-safe module with ref-driven animation and throttled DOM telemetry; this avoids frame-rate-dependent handling and per-frame React updates.
