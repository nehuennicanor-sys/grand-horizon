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
