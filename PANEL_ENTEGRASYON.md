# MindCoach API — App Panel entegrasyon dökümantasyonu

Bu belge, **dış yönetim paneli (App Panel)** entegrasyonunda yapılan tüm geliştirmeleri, API adreslerini, endpoint’leri ve App Panel yapay zekasına verilecek özeti içerir.

**İlgili dosyalar:**

| Dosya | İçerik |
|-------|--------|
| `PANEL_ENTEGRASYON.md` (bu dosya) | Uygulama özeti + tam entegrasyon rehberi |
| `docs/EXTERNAL_API_CONTRACT.md` | Kanonik JSON şeması (v2) |
| `INTEGRATION_TEMPLATE.md` | Genel App Panel şablonu (tüm uygulamalar) |

---

## 1. Yapılan işler (özet)

`INTEGRATION_TEMPLATE.md` (App Panel v2) şablonuna göre MindCoach backend’ine **ayrı bir `/panel` API katmanı** eklendi. Mobil uygulama akışları **değiştirilmedi**.

### 1.1 Eklenen özellikler

| Özellik | Açıklama |
|---------|----------|
| Panel health | Servis canlılık kontrolü |
| Panel analyse | Toplam kullanıcı, günlük giriş, yeni kayıt + 30 günlük seri |
| Panel users | Sayfalı kullanıcı listesi, detay, PATCH ile düzenleme |
| Panel agents | AI rehber (consultant) listesi, detay, oluşturma, güncelleme |
| Agent bağlı kullanıcılar | Her agent için sohbet etmiş kullanıcı listesi |
| Agent form catalog | Dropdown seçenekleri (`/panel/agents/options`) |
| API key koruması | `PANEL_API_KEY` ile panel istekleri |

### 1.2 Dokunulmayanlar

- `/auth`, `/consultants`, `/chats`, `/appointments`, `/moods`, … (mobil rotalar)
- Kök `/health` (operasyonel izleme)
- `/admin/*` (mevcut admin API; geriye dönük uyumlu)

### 1.3 Oluşturulan / güncellenen dosyalar

| Dosya | Durum | Görev |
|-------|-------|-------|
| `routes/panel.js` | **Yeni** | Panel HTTP endpoint’leri |
| `middleware/panelAuth.js` | **Yeni** | API key doğrulama |
| `services/panelService.js` | **Yeni** | PanelUser / PanelAgent mapping, iş kuralları |
| `repositories/PanelRepository.js` | **Yeni** | Metrik ve listeleme SQL sorguları |
| `repositories/ConsultantRepository.js` | **Güncellendi** | `update()` metodu (panel agent PATCH) |
| `app.js` | **Güncellendi** | `app.use('/panel', ...)` mount |
| `docs/EXTERNAL_API_CONTRACT.md` | **Yeni** | JSON sözleşmesi v2 |

---

## 2. Mimari

```
┌─────────────────────┐     X-Panel-Api-Key / Bearer      ┌─────────────────────────┐
│  App Panel          │ ─────────────────────────────────►│  MindCoach API          │
│  (yönetim paneli)   │         GET/PATCH /panel/*        │  Express — port 3010    │
└─────────────────────┘                                   └────────────┬────────────┘
                                                                       │
                    ┌──────────────────────────────────────────────────┼──────────────────┐
                    ▼                                                  ▼                  ▼
              users tablosu                              consultants tablosu      user_tokens, chats
```

- Panel istekleri yalnızca **`/panel`** prefix’i üzerinden gelir.
- Mapping katmanı `panelService.js` içinde: veritabanı alanları → App Panel kanonik şeması.

---

## 3. Base URL

### 3.1 Üretim (örnek)

```
https://api.mindcoach.app/panel
```

| Panel alanı | Kaydedilecek tam URL |
|-------------|----------------------|
| Health | `https://api.mindcoach.app/panel/health` |
| Analyse | `https://api.mindcoach.app/panel/analyse` |
| Users | `https://api.mindcoach.app/panel/users` |

Agent modülü aynı base altında: `.../panel/agents`, `.../panel/agents/options`

### 3.2 Yerel geliştirme

```
http://localhost:3010/panel
```

---

## 4. Ortam değişkenleri

Sunucu `.env` dosyasına ekleyin:

```env
# Zorunlu (panel erişimi için)
PANEL_API_KEY=uzun-güvenli-rastgele-değer

# Opsiyonel
PANEL_TIMEZONE=Europe/Istanbul
PANEL_DAILY_DAYS=30
```

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `PANEL_API_KEY` | — | Panel isteklerini doğrular |
| `PANEL_TIMEZONE` | `Europe/Istanbul` | Günlük metrik gün sınırı (+03:00) |
| `PANEL_DAILY_DAYS` | `30` | `analyse.daily` dizisi uzunluğu (7–90) |

`PANEL_API_KEY` tanımlı değilse geçici olarak `ADMIN_API_KEY` kabul edilir (üretimde ayrı anahtar önerilir).

---

## 5. Kimlik doğrulama

Her panel isteğinde **bir** header gönderin:

```http
X-Panel-Api-Key: <PANEL_API_KEY>
```

veya

```http
Authorization: Bearer <PANEL_API_KEY>
```

| HTTP | Anlam |
|------|-------|
| 401 | Anahtar gönderilmedi |
| 403 | Geçersiz anahtar |
| 503 | Sunucuda `PANEL_API_KEY` / `ADMIN_API_KEY` yok |

---

## 6. Endpoint referansı

Tüm uçlar `contractVersion: "2"` döner (health hariç kendi şeması).

### 6.1 Kullanıcılar (App Panel v2 zorunlu)

| Endpoint | Metot | Açıklama |
|----------|-------|----------|
| `/panel/health` | GET | Canlılık |
| `/panel/analyse` | GET | Özet + günlük seri |
| `/panel/users` | GET | Sayfalı liste (`?page=1&limit=20`) |
| `/panel/users/:id` | GET | Tek kullanıcı |
| `/panel/users/:id` | PATCH | Kısmi güncelleme |

### 6.2 Agentler (MindCoach uzantısı)

| Endpoint | Metot | Açıklama |
|----------|-------|----------|
| `/panel/agents/options` | GET | Form catalog (job, features, roles, …) |
| `/panel/agents` | GET | Sayfalı agent listesi |
| `/panel/agents/:id` | GET | Detay + bağlı kullanıcılar |
| `/panel/agents` | POST | Yeni agent |
| `/panel/agents/:id` | PATCH | Agent güncelle |

**Not:** `GET /panel/agents/:id` route’u, `GET /panel/agents/options` ile çakışmaz; Express sırası `options` önce tanımlı.

---

## 7. Veri mapping

### 7.1 PanelUser (`GET /panel/users`)

| Panel alanı | MindCoach kaynağı |
|-------------|-------------------|
| `id` | `users.id` (string) |
| `email` | `credential_data.email` |
| `displayName` | `users.username` |
| `phone` | — (`null`) |
| `status` | Şu an `active` |
| `createdAt` | `account_created_date` |
| `lastLoginAt` | `MAX(user_tokens.created_at)` |
| `extras.credential` | google / facebook / apple / guest |
| `extras.isPremium` | Aktif `premium_devices` kaydı |
| `extras.age`, `gender`, `nativeLang`, … | İlgili user kolonları |

### 7.2 Analyse metrikleri (`GET /panel/analyse`)

| Panel alanı | SQL / kaynak |
|-------------|--------------|
| `summary.totalUsers` | `COUNT(*)` FROM `users` |
| `summary.loginsToday` | Bugün oluşturulan `user_tokens` (giriş proxy) |
| `summary.newUsersToday` | Bugün `account_created_date` olan kullanıcılar |
| `daily[].logins` | Gün bazlı `user_tokens.created_at` |
| `daily[].newUsers` | Gün bazlı `users.account_created_date` |

### 7.3 PanelAgent (`GET /panel/agents`)

| Panel alanı | MindCoach kaynağı |
|-------------|-------------------|
| Agent | `consultants` satırı |
| `displayName` | `names.tr` veya `names.en` |
| `owner` | Sabit platform: `MindCoach Platform` |
| `usage.linkedUserCount` | `COUNT(DISTINCT user_id)` FROM `chats` |
| `usage.chatCount` | `COUNT(*)` FROM `chats` |
| `linkedUsers` (detay) | Agent ile sohbeti olan kullanıcılar |

**Agent sahibi:** Ayrı sahip tablosu yok. `owner` = platform; “bağlı kullanıcılar” = o agent ile en az bir `chats` kaydı olan kullanıcılar.

### 7.4 PATCH davranışı

**Kullanıcı (`PATCH /panel/users/:id`):**

| Panel gövdesi | Veritabanı |
|---------------|------------|
| `displayName` | `username` |
| `email` | `credential_data.email` (merge) |
| `status: banned` / `inactive` | Tüm token’lar revoke |
| `extras.*` | İlgili kolonlar (shallow merge) |

**Agent (`PATCH /panel/agents/:id`):**

`displayName`, `names`, `job`, `extras.mainPrompt`, `extras.rating`, `extras.features`, vb.

---

## 8. Örnek JSON yanıtlar

### 8.1 Health

```json
{
  "ok": true,
  "service": "mindcoach-api",
  "contractVersion": "2"
}
```

### 8.2 Analyse

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
    { "date": "2026-05-17", "logins": 290, "newUsers": 40 },
    { "date": "2026-05-18", "logins": 320, "newUsers": 45 }
  ]
}
```

### 8.3 Kullanıcı listesi

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

### 8.4 Agent + bağlı kullanıcılar

```json
{
  "contractVersion": "2",
  "data": {
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
      "photoURL": "https://cdn.example/photo.jpg",
      "voiceId": "elevenlabs-id",
      "features": ["family_conflicts"],
      "roles": ["female"],
      "rating": 4.8
    },
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
  }
}
```

### 8.5 Yeni agent oluşturma (POST)

**İstek:**

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

Doğrulama kuralları `config/consultantCatalog.js` ile aynıdır (`/admin/consultants` ile uyumlu).

---

## 9. Test komutları

```bash
export PANEL_BASE="http://localhost:3010/panel"
export PANEL_KEY="your-panel-api-key"

# Health
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/health" | jq

# Analyse
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/analyse" | jq

# Kullanıcılar
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/users?page=1&limit=10" | jq
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/users/42" | jq

# Kullanıcı güncelleme
curl -s -X PATCH -H "X-Panel-Api-Key: $PANEL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Yeni Ad"}' \
  "$PANEL_BASE/users/42" | jq

# Agentler
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/agents/options" | jq
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/agents?page=1&limit=10" | jq
curl -s -H "X-Panel-Api-Key: $PANEL_KEY" "$PANEL_BASE/agents/7" | jq
```

---

## 10. Panel kurulum checklist

- [ ] `PANEL_API_KEY` sunucu `.env` dosyasında tanımlı
- [ ] Panel base URL: `https://<HOST>/panel`
- [ ] Health URL kayıtlı
- [ ] Analyse URL kayıtlı
- [ ] Users URL kayıtlı
- [ ] Header: `X-Panel-Api-Key` veya `Authorization: Bearer`
- [ ] Agent modülü URL’leri yapılandırıldı
- [ ] HTTPS, timeout ~8 sn

---

## 11. App Panel AI’ya verilecek prompt

Aşağıdaki metni doğrudan App Panel yapay zekasına yapıştırabilirsiniz:

```
MindCoach backend App Panel v2 entegrasyonu tamamlandı.

BASE URL (üretim örnek): https://api.mindcoach.app/panel
BASE URL (yerel): http://localhost:3010/panel

Kimlik doğrulama: Her istekte
  X-Panel-Api-Key: <PANEL_API_KEY>
  veya Authorization: Bearer <PANEL_API_KEY>

Kullanıcı endpoint'leri (App Panel v2):
  GET  /panel/health
  GET  /panel/analyse     → summary + daily (30 gün, Europe/Istanbul)
  GET  /panel/users       → ?page=&limit=  PanelUser listesi
  GET  /panel/users/:id
  PATCH /panel/users/:id  → displayName, email, status, extras

Agent endpoint'leri (consultant = AI rehber):
  GET  /panel/agents/options  → form dropdown catalog
  GET  /panel/agents          → liste + usage istatistikleri
  GET  /panel/agents/:id      → detay + linkedUsers (sohbet etmiş kullanıcılar)
  POST /panel/agents          → yeni agent (names, job, mainPrompt zorunlu)
  PATCH /panel/agents/:id

Agent owner: platform (MindCoach). Bağlı kullanıcılar = chats tablosundan.
Mobil rotalar (/auth, /consultants, /chats) değiştirilmedi.

Tam döküman: PANEL_ENTEGRASYON.md
JSON sözleşme: docs/EXTERNAL_API_CONTRACT.md
```

---

## 12. Sürüm ve uyumluluk

| Öğe | Değer |
|-----|-------|
| Sözleşme | App Panel **v2** |
| `contractVersion` | `"2"` |
| Şablon referansı | `INTEGRATION_TEMPLATE.md` |
| Eski `/admin` API | Çalışır; yeni işler için `/panel` kullanın |

---

*Son güncelleme: App Panel entegrasyonu — MindCoach API `/panel` katmanı.*
