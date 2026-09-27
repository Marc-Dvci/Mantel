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

## Going live

Set `RING_ACCESS_TOKEN` (and `RING_API_BASE_URL=https://api.amazonvision.com`), put the signing secret in `RING_WEBHOOK_SECRET`, point the webhook at `/ring/webhook`, and list outside-door contact sensors in `RING_OUTSIDE_DOORS`. The household's `ringDevices` list maps device ids to the doorbell and the doors.
