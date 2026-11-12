# Validation

Validated locally on 2026-11-10 with Node 24:

- `npm run typecheck`: passed.
- `npm test`: 55 tests passed (Seedance payload/status/error handling, signed Access verification boundaries, CSRF, the exact V2 timeline, and export/runtime preflight).
- `npm run build`: passed.
- `wrangler deploy --dry-run`: Worker bundled successfully, 1506.84 KiB / gzip 273.84 KiB; assets accepted. This is a packaging check, not a deployment.
- All self-hosted assets are below Cloudflare's 25 MiB per-file limit. FFmpeg WASM is split into 16 MiB parts.
- Native FFmpeg filter smoke check covered a silent clip and an audio clip, subtitle overlay, concatenation, and instrumental mixing. Browser FFmpeg itself still requires browser end-to-end verification.

- GitHub source and the Actions workflow are uploaded to https://github.com/Xiexuanxi-maker/christmas-kitten-studio. GitHub Actions run https://github.com/Xiexuanxi-maker/christmas-kitten-studio/actions/runs/42925116362 passed typecheck, all 55 tests, frontend build and Cloudflare packaging. Production deployment was skipped for this push, as designed.

Cloudflare preparation on 2026-11-12:

- Protected GitHub environment credentials were verified by the Cloudflare API, without reading secret values into this workspace.
- [Preparation run, attempt 2](https://github.com/Xiexuanxi-maker/christmas-kitten-studio/actions/runs/42963100492) succeeded: D1 `kitten-studio` and private R2 `kitten-studio-media` are ready. No application deployment occurred.

Cloudflare Access preparation on 2026-11-12:

- [Access setup](https://github.com/Xiexuanxi-maker/christmas-kitten-studio/actions/runs/43144053884) succeeded: initialized the missing team after user-confirmed Free activation, configured email One-time PIN, and verified the exact-hostname policy allows only `xiexuanxi@outlook.fr`.
- Team domain: `https://xiexuanxi-studio.cloudflareaccess.com`. Planned site: `christmas-kitten-studio.xiexuanxi-maker.workers.dev`.
- Current [GitHub CI](https://github.com/Xiexuanxi-maker/christmas-kitten-studio/actions/runs/43144053952) passed with 105 tests and Cloudflare packaging checks.

Not yet verified:

- No browser-control tool was exposed in this managed environment; browser layout and complete WASM export were not run.
- The Seedance API key and real browser email login have not yet been verified. Paid inference, generated video transfer and full 40-second export remain end-to-end checks after runtime credentials are complete.
- The current GitHub connection cannot manage the production environment or Secrets (HTTP 403); those values must be entered through GitHub settings. Existing unrelated repositories were untouched.

Local editing, JSON/SRT exports and music preview require no production credentials. The included images are AI-generated storyboard concepts, not generated video or real product photos.
