# MindCoach API — App Panel entegrasyon rehberi

Bu belge, **dış yönetim paneli (App Panel)** ile MindCoach backend API’sinin nasıl konuştuğunu açıklar. Paneli geliştiren veya işleten yapay zekaya doğrudan verilebilir.

---

## 1. Genel mimari

```
┌─────────────────────┐         HTTPS + API Key          ┌──────────────────────────┐
│  App Panel (sizin)  │  ──────────────────────────────► │  MindCoach API           │
│  Dashboard / CRUD   │         /panel/* uçları            │  (bu repo, Node/Express) │
└─────────────────────┘                                    └───────────┬──────────────┘
                                                                         │
                                                                         ▼
                                                              ┌──────────────────────┐
                                                              │  MySQL               │
                                                              │  users, consultants, │
                                                              │  user_tokens, chats  │
                                                              └──────────────────────┘
```

- **Mobil uygulama** rotaları (`/auth`, `/consultants`, `/chats`, …) **değiştirilmedi**; panel tamamen ayrı prefix kullanır: **`/panel`**.
- Eski **`/admin`** rotaları (rehber ekleme vb.) **aynı şekilde çalışmaya devam eder**; panel için tercih edilen yol `/panel`’dir.

---

## 2. Base URL (panelde kaydedilecek adresler)

Üretim örneği (domain sizin altyapınıza göre değişir):

| Amaç | Tam URL |
|------|---------|
| **Panel API base** | `https://api.mindcoach.app/panel` |
| Health | `https://api.mindcoach.app/panel/health` |
| Analyse (özet + grafik) | `https://api.mindcoach.app/panel/analyse` |
| Users (liste + düzenleme) | `https://api.mindcoach.app/panel/users` |

Yerel geliştirme:

| Amaç | URL |
|------|-----|
| Base | `http://localhost:3010/panel` |
| Health | `http://localhost:3010/panel/health` |
| Analyse | `http://localhost:3010/panel/analyse` |
| Users | `http://localhost:3010/panel/users` |

> **Not:** Kök `/health` uç noktası operasyonel izleme içindir; panel sözleşmesi için **`/panel/health`** kullanın.

---

## 3. Kimlik doğrulama

Panel sunucusu her istekte **API anahtarı** göndermelidir (şablon v2’de varsayılan olarak `Authorization` yok denmişti; MindCoach tarafında header desteği vardır):

**Seçenek A (önerilen):**
```http
X-Panel-Api-Key: <PANEL_API_KEY>
```

**Seçenek B:**
```http
Authorization: Bearer <PANEL_API_KEY>
```

Sunucu `.env`:
```env
PANEL_API_KEY=uzun-rastgele-bir-deger
# Opsiyonel: PANEL_TIMEZONE=Europe/Istanbul
# Opsiyonel: PANEL_DAILY_DAYS=30
```

`PANEL_API_KEY` yoksa geçici olarak `ADMIN_API_KEY` kabul edilir (ayrı anahtar önerilir).

---

## 4. Kullanıcı entegrasyonu (v2 sözleşmesi)

### 4.1 `GET /panel/health`

**200 örnek:**
```json
{
  "ok": true,
  "service": "mindcoach-api",
  "contractVersion": "2"
}
```

### 4.2 `GET /panel/analyse`

Panel dashboard metrikleri.

| Panel alanı | MindCoach kaynağı |
|-------------|-------------------|
| `summary.totalUsers` | `COUNT(users)` |
| `summary.loginsToday` | Bugün oluşturulan `user_tokens` kayıtları (oturum açma proxy) |
| `summary.newUsersToday` | Bugün `account_created_date` olan kullanıcılar |
| `daily[].logins` | Gün bazlı `user_tokens.created_at` |
| `daily[].newUsers` | Gün bazlı `users.account_created_date` |

Gün sınırı: `PANEL_TIMEZONE` (varsayılan `Europe/Istanbul`, +03:00).

**200 örnek (kısaltılmış):**
```json
{
  "contractVersion": "2",
  "generatedAt": "2026-05-18T12:00:00.000Z",
  "timezone": "Europe/Istanbul",
  "summary": {
    "totalUsers": 12450,
    "loginsToday": 320,
    "newUsersToday": 45
  },
  "daily": [
    { "date": "2026-05-01", "logins": 280, "newUsers": 38 },
    { "date": "2026-05-18", "logins": 320, "newUsers": 45 }
  ]
}
```

### 4.3 `GET /panel/users?page=1&limit=20`

**PanelUser** kanonik modeli:

| Panel | MindCoach |
|-------|-----------|
| `id` | `users.id` (string) |
| `email` | `credential_data.email` |
| `displayName` | `username` |
| `phone` | yok → `null` |
| `status` | şu an hep `active` |
| `createdAt` | `account_created_date` |
| `lastLoginAt` | `MAX(user_tokens.created_at)` |
| `extras.credential` | google / facebook / apple / guest |
| `extras.isPremium` | aktif `premium_devices` kaydı |
| `extras.*` | yaş, cinsiyet, dil, fotoğraf vb. |

**200 örnek:**
```json
{
  "contractVersion": "2",
  "data": [
    {
      "id": "42",
      "email": "ayse@ornek.com",
      "displayName": "Ayşe",
      "phone": null,
      "status": "active",
      "createdAt": "2025-11-03T08:15:00.000Z",
      "lastLoginAt": "2026-05-14T19:22:00.000Z",
      "extras": {
        "credential": "google",
        "providerId": "1092...",
        "isPremium": true,
        "age": 28,
        "gender": "female",
        "nativeLang": "tr"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 12450,
    "totalPages": 623
  }
}
```

### 4.4 `GET /panel/users/:id`

Tek kullanıcı; gövde `{ contractVersion, data: PanelUser }`.

### 4.5 `PATCH /panel/users/:id`

Kısmi güncelleme. Desteklenen alanlar:

| Panel gövdesi | Yazılan alan |
|---------------|--------------|
| `displayName` | `users.username` |
| `email` | `credential_data.email` (merge) |
| `status: "banned"` veya `"inactive"` | Tüm JWT oturumları iptal (`user_tokens` revoke) |
| `extras.age`, `extras.gender`, … | İlgili user kolonları |

`extras` **shallow merge** (iç içe objeler birleştirilmez).

---

## 5. Agent (rehber / consultant) entegrasyonu

Uygulamada **agent = consultant** (AI rehber). Ayrı “sahip kullanıcı” tablosu yok; platform sahipliği + **bağlı kullanıcılar** (sohbet etmiş kullanıcılar) modeli kullanılır.

### 5.1 Kavramlar

| Panel terimi | MindCoach |
|--------------|-----------|
| Agent | `consultants` satırı |
| Agent sahibi (`owner`) | Sabit: `{ type: "platform", id: "mindcoach", displayName: "MindCoach Platform" }` |
| Bağlı kullanıcılar | `chats` üzerinden agent ile en az bir sohbeti olan `users` |

### 5.2 Endpoint özeti

| Endpoint | Metot | Amaç |
|----------|-------|------|
| `/panel/agents/options` | GET | Form dropdown (job, features, roles, explanations) |
| `/panel/agents` | GET | Sayfalı agent listesi + kullanım istatistiği |
| `/panel/agents/:id` | GET | Detay + `linkedUsers` (varsayılan açık) |
| `/panel/agents` | POST | Yeni agent oluştur |
| `/panel/agents/:id` | PATCH | Agent güncelle |

### 5.3 `GET /panel/agents`

**PanelAgent örnek öğe:**
```json
{
  "id": "7",
  "displayName": "Dr. Elif",
  "names": { "tr": "Dr. Elif", "en": "Dr. Elif" },
  "job": "family_assistant",
  "status": "active",
  "createdAt": "2025-06-01T00:00:00.000Z",
  "owner": {
    "type": "platform",
    "id": "mindcoach",
    "displayName": "MindCoach Platform"
  },
  "usage": {
    "linkedUserCount": 1523,
    "chatCount": 2100
  },
  "extras": {
    "mainPrompt": "...",
    "photoURL": "https://...",
    "voiceId": "...",
    "features": ["family_conflicts"],
    "roles": ["female"],
    "rating": 4.8
  }
}
```

### 5.4 `GET /panel/agents/:id?includeLinkedUsers=false`

Detayda `linkedUsers` dizisi (agent ile sohbet etmiş kullanıcılar — “agent sahipleri” anlamında **bağlı kullanıcı listesi**):

```json
"linkedUsers": [
  {
    "userId": "42",
    "displayName": "Ayşe",
    "email": "ayse@ornek.com",
    "credential": "google",
    "firstChatAt": "2025-12-01T10:00:00.000Z",
    "lastMessageAt": "2026-05-10T18:30:00.000Z"
  }
]
```

### 5.5 `POST /panel/agents`

`/admin/consultants` ile aynı doğrulama kuralları (`consultantCatalog`).

**Örnek gövde:**
```json
{
  "names": { "tr": "Yeni Rehber", "en": "New Guide" },
  "job": "family_assistant",
  "mainPrompt": "Sen bir aile danışmanısın...",
  "photoURL": "https://cdn.example/photo.jpg",
  "voiceId": "elevenlabs-voice-id",
  "features": ["family_conflicts"],
  "roles": ["female"],
  "explanation": "explanationFamilyAssistant1",
  "rating": 0
}
```

**201:** `{ "contractVersion": "2", "data": PanelAgent }`

### 5.6 `PATCH /panel/agents/:id`

Örnek: `displayName`, `names`, `job`, `extras.mainPrompt`, `extras.rating`, vb.

---

## 6. Panel arayüzünde kayıt checklist

- [ ] Base: `https://<HOST>/panel`
- [ ] Health URL: `.../panel/health`
- [ ] Analyse URL: `.../panel/analyse`
- [ ] Users URL: `.../panel/users` (liste; PATCH için aynı base + `/:id`)
- [ ] Header: `X-Panel-Api-Key` veya `Authorization: Bearer`
- [ ] Agent modülü: `.../panel/agents` (+ options, create, detail)
- [ ] Timeout ~8 sn, yanıt < 64 KB

---

## 7. Test curl komutları

```bash
export PANEL_BASE="http://localhost:3010/panel"
export PANEL_KEY="your-panel-api-key"

curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/health"
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/analyse"
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/users?page=1&limit=10"
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/agents?page=1&limit=10"
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/agents/options"
```

---

## 8. Kod haritası (bu repoda)

| Dosya | Rol |
|-------|-----|
| `routes/panel.js` | Panel HTTP uçları |
| `middleware/panelAuth.js` | API key doğrulama |
| `services/panelService.js` | PanelUser / PanelAgent mapping |
| `repositories/PanelRepository.js` | Metrik ve listeleme SQL |
| `app.js` | `app.use('/panel', ...)` mount |
| `routes/admin.js` | Eski admin uçları (değişmedi) |

---

## 9. App Panel AI için özet prompt

```
MindCoach uygulaması panel entegrasyonu hazır.

Base URL: https://api.mindcoach.app/panel  (local: http://localhost:3010/panel)
Auth: X-Panel-Api-Key veya Authorization: Bearer <PANEL_API_KEY>

Kullanıcılar (v2):
- GET /health, /analyse, /users, /users/:id
- PATCH /users/:id

Agentler (consultants):
- GET /agents/options, /agents, /agents/:id
- POST /agents, PATCH /agents/:id
- owner = platform; linkedUsers = chats tablosundan bağlı kullanıcılar

Mobil rotalar (/auth, /consultants, ...) dokunulmadı.
Detay: docs/APP_PANEL_INTEGRATION.md
```

---

## 10. Sürüm

- **contractVersion:** `2`
- Şablon: kök `INTEGRATION_TEMPLATE.md`
- İlgili env: `PANEL_API_KEY`, `PANEL_TIMEZONE`, `PANEL_DAILY_DAYS`
