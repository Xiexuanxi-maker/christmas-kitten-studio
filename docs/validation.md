# Validation

Validated locally on 2026-11-10 with Node 24:

- `npm run typecheck`: passed.
- `npm test`: 55 tests passed (Seedance payload/status/error handling, signed Access verification boundaries, CSRF, the exact V2 timeline, and export/runtime preflight).
- `npm run build`: passed.
- `wrangler deploy --dry-run`: Worker bundled successfully, 1506.84 KiB / gzip 273.84 KiB; assets accepted. This is a packaging check, not a deployment.
- All self-hosted assets are below Cloudflare's 25 MiB per-file limit. FFmpeg WASM is split into 16 MiB parts.
- Native FFmpeg filter smoke check covered a silent clip and an audio clip, subtitle overlay, concatenation, and instrumental mixing. Browser FFmpeg itself still requires browser end-to-end verification.

Not yet verified:

- No browser-control tool was exposed in this managed environment; browser layout and complete WASM export were not run.
- Cloudflare account credentials, Access application, D1/R2 resources and Seedance API key are not configured. Real email OTP, inference, result transfer and 40-second video export require production setup.
- GitHub account Xiexuanxi-maker is connected. The user created https://github.com/Xiexuanxi-maker/christmas-kitten-studio; metadata reads succeed but git push returned HTTP 403. Repository Contents/Workflows write access must be granted before uploading. Existing unrelated repository was untouched.

Local editing, JSON/SRT exports and music preview require no production credentials. The included images are AI-generated storyboard concepts, not generated video or real product photos.
