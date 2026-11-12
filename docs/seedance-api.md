# Seedance API research

Verified against official Volcano Engine / Volcano Ark documentation on 2026-11-10. These are live first-party docs, not third-party resellers.

## Official sources

- Create task: https://www.volcengine.com/docs/82379/1520757
- Machine-readable create task: https://docs.volcengine.com/docs/zh/ark/create-video-generation-task-api.md
- Query task: https://www.volcengine.com/docs/82379/1521309
- Machine-readable query task: https://docs.volcengine.com/docs/zh/ark/get-video-generation-task-api.md
- Models and limits: https://docs.volcengine.com/docs/zh/ark/model-list.md
- Base URL and authentication: https://docs.volcengine.com/docs/zh/ark/base-url-and-authentication.md
- Model setup / activation: https://ark.volcengine.com/region:cn-beijing/openManagement?LLM=%7B%7D&OpenTokenDrawer=false
- API keys: https://ark.volcengine.com/region:cn-beijing/apiKey

## Availability and model choice

The current official model list explicitly includes:

| Model | Model ID | Duration | Audio | Resolutions |
| --- | --- | --- | --- | --- |
| Seedance 2.0 | `doubao-seedance-2-0-260128` | integer 4–15 s (or -1 for automatic) | yes | 480p, 720p, 1080p, 4k |
| Seedance 2.0 fast | `doubao-seedance-2-0-fast-260128` | integer 4–15 s | yes | 480p, 720p |
| Seedance 2.0 mini | `doubao-seedance-2-0-mini-260615` | integer 4–15 s | yes | 480p, 720p |
| Seedance 2.5 | `doubao-seedance-2-5-260628` | integer 4–30 s | yes | 480p, 720p, 1080p |

Seedance 2.5 is described as fully public in the current official create-task documentation. API access still requires activating model service in the user's Volcano Ark account. Current docs say activation of 2.5 / 2.0 requires one of: account balance > CNY 200; qualifying savings plan; an eligible unspent model resource pack. This may change and should be presented as an account prerequisite, not charged or purchased automatically.

Recommend Seedance 2.0 at 720p for this implementation: portrait 720×1280, standard MP4, synchronized stereo audio. Support 1080p for standard 2.0, but do not send 1080p to fast/mini. 4k uses 10-bit HEVC and has tighter limits; avoid as the default. 2.5 1080p also uses HEVC; 720p is a safer browser target.

The current primary docs do not list Seedance 1.5 in the supported create-task models or current model table. Do not default to an assumed 1.5 identifier. Seedance 1.0 pro and pro fast remain listed but marked as due for retirement; they are silent, with 2–12 s durations. Those differences make them unsuitable as a transparent fallback for the user's audio brief.

## Wire protocol

Create:

```http
POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
Authorization: Bearer <ARK_API_KEY>
Content-Type: application/json
```

Minimal verified request for the Christmas product clip:

```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    {
      "type": "text",
      "text": "Vertical cinematic Christmas product film. A transparent premium acrylic kitten advent calendar gift box with a red satin bow, gold lettering and warm Christmas bokeh on a decorated tabletop. Slow macro camera push in. Soft Christmas instrumental music, a delicate bell chime and detailed quiet ASMR material sounds. No dialogue. Leave the lower safe area clear for captions added in editing."
    }
  ],
  "ratio": "9:16",
  "resolution": "720p",
  "duration": 4,
  "generate_audio": true,
  "watermark": false
}
```

The response contains an `id`, e.g. `cgt-...`. Persist that ID before returning to the client; do not wait on the create request for video completion.

Query:

```http
GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}
Authorization: Bearer <ARK_API_KEY>
```

Verified statuses: `queued`, `running`, `cancelled`, `succeeded`, `failed`, `expired`. Successful output is in `content.video_url`. Failure is in `error.code` and `error.message`. Other useful response fields: `duration`, `framespersecond`, `ratio`, `resolution`, `generate_audio`, `usage.completion_tokens`, `created_at`, `updated_at`.

The official SDK example polls every 10 seconds. Honor terminal failed/cancelled/expired states and do not poll indefinitely. A task's default execution timeout is 172800 seconds (48 h); `execution_expires_after` range is 3600–259200 s.

## Storage / asynchronous processing

- Generated video URLs expire after **24 hours**. Download/stream successful output to Cloudflare R2 immediately and return a same-origin authenticated media route. Do not save only the temporary provider URL as a durable deliverable.
- Normal task IDs expire after 7 days. (Draft task IDs have distinct validity rules; irrelevant if not using drafts.)
- There is a `callback_url` option. Callbacks send the same task shape and include queued/running/succeeded/failed/expired. The documentation describes retries for terminal success/failure but does not document a cryptographic callback signature in this page. Prefer backend polling, or treat callbacks as wake-ups and verify task state server-to-server before trusting the output.
- Do not expose the Ark key in Vite environment variables or the client. Worker secrets only.
- Personal non-4k quota is documented as max 180 RPM, 3 concurrent tasks; enterprises 600 RPM, 10 concurrent tasks. Do not launch all 11 storyboard shots concurrently by default. Two or three active jobs is safer.

## Product references and consistency

Text-only generation cannot guarantee the same exact manufactured product, letterforms or 24 correctly numbered doors across shots. For truthful commercial product imagery, upload real product reference photographs and review output. Official API supports image references:

```json
{
  "type": "image_url",
  "image_url": {"url": "https://public-or-signed-readable-reference.example/product.png"},
  "role": "reference_image"
}
```

For Seedance 2.0, up to 9 reference images. Each image must be <30 MB, width and height 300–6000 px, aspect ratio 0.4–2.5. Supported common formats include jpeg/png/webp. Base64 `data:image/png;base64,...` is also supported, but request body must stay <=64 MB; avoid base64 for large files. `first_frame` and `last_frame` roles are supported for frame-guided generation, but first/last-frame mode and all-modal reference mode are mutually exclusive and must not be mixed.

The API accepts Chinese and English prompts. Docs recommend <=500 Chinese characters or <=1000 English words. Prompt camera moves, materials, lighting and ASMR explicitly; English subtitles should be rendered separately for exact text/timing instead of relying on the model to draw typography.

## Timeline implications for the provided V2 script

The full timeline is 40 seconds. Seedance 2.0 cannot generate 40 seconds in one task. It also cannot directly generate the 3-second opening or the 2.4-second individual kitten closeups. Generate minimum 4-second source clips and trim during assembly, preserving the intended editorial timestamps. The 12–20 s packaging section remains three camera views, not a 24-cat montage.

Audio is generated per clip. Merely stitching these clips does not guarantee a continuous Christmas music bed. For a polished final, add a continuous licensed/user-provided Christmas instrumental track at assembly and retain/mix ASMR effects. If no such track is supplied, clearly label the per-shot generated audio limitation.

## Cloudflare boundary

Cloudflare can provide application hosting (Workers), login (Access email OTP), D1, R2, AI-assisted script editing via Workers AI, and deployment infrastructure together with GitHub Actions. **Seedance inference is a Volcano Ark service**; it is not a Cloudflare-hosted model. The user requested Seedance as well as all services on Cloudflare, so disclose this concrete necessary exception rather than claiming all inference runs on Cloudflare. Do not replace Seedance with a different video model silently.

## Account model activation

Creating a key does not itself enable Seedance. Verify Seedance 2.0 in the same `default` project using the [official activation page](https://ark.volcengine.com/region:cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model&projectName=default&tab=ComputerVision). The [official tutorial](https://docs.volcengine.com/docs/zh/ark/seedance-2-0.md) documents identity and balance/resource-pack requirements. Subscription or recharge decisions remain with the account owner; credential probes never submit inference jobs.
