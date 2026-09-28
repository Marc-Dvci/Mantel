# Ring

Mantel uses four Ring webhook events and one Ring endpoint, as the Ring Partner API documentation describes them.

| Ring | Mantel |
|---|---|
| `button_press` | decide the door card, alert the family, then fetch the frame |
| `contact_sensor_faulted` on an outside door (faulted means the contact is broken: the door is **open**) | a night-time opening alerts the family and counts toward the Change Signal |
| `contact_sensor_cleared` | the door closed |
| `motion_detected` with `sub_type: human` at the doorbell | recorded, nothing on the TV |
| `POST /v1/devices/{id}/media/image/download` | the frame at the press, for the TV card and the family alert |

## Webhooks

The envelope is v1.1:

```json
{
  "meta": { "version": "1.1", "time": "...", "request_id": "c83081fc-...", "account_id": "ava1.ring.account.XXXYYY" },
  "data": {
    "id": "<device_id>_button_press_<timestamp>",
    "type": "button_press",
    "attributes": { "source": "<device_id>", "source_type": "devices", "timestamp": 1771027372393 },
    "relationships": { "devices": { "links": { "self": "/v1/devices/<device_id>" } } }
  }
}
```

`POST /ring/webhook` reads the raw body before any JSON parser, checks `X-Signature` (HMAC-SHA256, `sha256=<hex>` or bare hex) in constant time, parses, and records `meta.request_id` so a redelivery answers 200 "duplicate" and does nothing. The door card and the alert are stored before the response; the snapshot is fetched after it, so the reply stays well inside Ring's five seconds.

## The snapshot

```
POST /v1/devices/{device_id}/media/image/download
{ "type": "at_timestamp", "timestamp": <press ms>, "image_options": { "format": "jpeg", "resolution": { "width": 1280, "height": 720 } } }
→ 303 See Other, Location: <pre-signed URL>
GET <pre-signed URL> → image/jpeg
```

`RingClient.snapshot` takes the redirect by hand so the bearer token is never sent to the pre-signed host. The image is stored as household media and attached to the card and the alert, and the TV redraws the card when it lands.

## The simulator

`apps/server/src/ringsim.ts` serves the documented device list and the documented two-step image download, and delivers signed v1.1 webhooks over HTTP to the server's own `/ring/webhook`, so the demo exercises the production path. `POST /api/dev/ring/press {"visitor": "stranger" | "sarah" | "courier" | "empty"}` chooses who is in the frame.

## A Ring account

`RING_LIVE=1` links the household to a Ring account through the Ring API at `https://api.amazonvision.com`.

```bash
RING_LIVE=1 RING_ACCESS_TOKEN=<token> pnpm dev
pnpm ring:spike      # the account, its devices and each camera's last seven days, as Mantel reads them
```

1. **Link.** `GET /v1/devices?include=status,capabilities` returns a JSON:API compound document; `sideload` joins the `included` resources onto their devices. The doorbell is attached to the household by its Ring device id (`RING_DEVICE_ID` picks one when the account has several), next to the household's outside-door contact sensors.
2. **Read the doorbell's history.** Every `RING_POLL_SECONDS` (default 5), `GET /v1/history/devices/{id}/events?start_time=<ms>` returns the events since the last read. `ding` is a press and becomes the event the webhook path already understands, so it goes through the same door decision, the same alert and the same image download. `motion.human` is recorded as a person at the door.
3. **Once each.** A history event is keyed `history:<event id>` in the same receipt store as webhook request ids, so a press read twice is acted on once. Events that were already history when the household linked are never replayed onto the TV.

A token from the [Ring Developer Playground](https://developer.amazon.com/ring/console/playground) reads the account directly, with no app registration and no public URL. It lasts about thirty minutes; `RING_ACCESS_TOKEN_FILE=<path>` re-reads the token from a file on every call, so a fresh one can be pasted in without a restart.

With a registered app, Ring also pushes events: put the signing secret in `RING_WEBHOOK_SECRET`, point the webhook at `/ring/webhook`, and list outside-door contact sensors in `RING_OUTSIDE_DOORS`. Webhook deliveries and history reads share one receipt store, so a press that arrives both ways shows one card.
