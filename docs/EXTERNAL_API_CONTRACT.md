# External API Contract v2 (MindCoach — App Panel)

Panel sunucusunun beklediği kanonik JSON şeması. Implementasyon: `/panel/*` rotaları.

## Health

`GET /panel/health` → `200`

```json
{ "ok": true, "service": "mindcoach-api", "contractVersion": "2" }
```

## Analyse

`GET /panel/analyse` → `200`

```json
{
  "contractVersion": "2",
  "generatedAt": "ISO-8601",
  "timezone": "Europe/Istanbul",
  "summary": {
    "totalUsers": 0,
    "loginsToday": 0,
    "newUsersToday": 0
  },
  "daily": [
    { "date": "YYYY-MM-DD", "logins": 0, "newUsers": 0 }
  ]
}
```

## Users

### List

`GET /panel/users?page=1&limit=20` → `200`

```json
{
  "contractVersion": "2",
  "data": [ "PanelUser" ],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

### PanelUser

| Alan | Tip | Zorunlu |
|------|-----|---------|
| id | string | evet |
| email | string \| null | hayır |
| displayName | string \| null | hayır |
| phone | string \| null | hayır |
| status | active \| inactive \| banned \| null | hayır |
| createdAt | ISO-8601 \| null | hayır |
| lastLoginAt | ISO-8601 \| null | hayır |
| extras | object | hayır |

### Get one

`GET /panel/users/:id` → `200` `{ contractVersion, data: PanelUser }` | `404`

### Patch

`PATCH /panel/users/:id` — partial body, same field names. `extras` shallow merge.

## Agents (extension)

`GET /panel/agents` — paginated `PanelAgent` list.

`PanelAgent` adds: `names`, `job`, `owner`, `usage`, `extras`, optional `linkedUsers` on detail.

Auth: `X-Panel-Api-Key` or `Authorization: Bearer <key>`.
