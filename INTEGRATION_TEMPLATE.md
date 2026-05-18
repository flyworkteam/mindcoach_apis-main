# App Panel — Uygulama API entegrasyon şablonu (v2)

Her mobil/web uygulamasının backend’i farklı kullanıcı modeli ve alan adları kullanabilir. Panel tarafında **tek bir kanonik (ortak) şema** vardır; entegrasyon görevi, sizin API’nizdeki veriyi bu şemaya **map** etmektir.

Bu dosyayı ilgili uygulamanın backend ekibine veya yapay zekaya verin. Alt bölümdeki **AI prompt şablonunu** doldurup yapıştırmanız yeterlidir.

---

## Her uygulamada zorunlu veriler

| Panel ihtiyacı | Nereden gelir | Açıklama |
|----------------|---------------|----------|
| Toplam kullanıcı | `GET /analyse` → `summary.totalUsers` | Kayıtlı / sayılan tüm kullanıcılar |
| Günlük giriş sayısı | `summary.loginsToday` | Bugün uygulamaya giriş (oturum açma) sayısı |
| Günlük yeni kullanıcı | `summary.newUsersToday` | Bugün ilk kez kayıt olanlar |
| Tarihe göre girişler | `daily[].logins` | Grafik / tablo için gün bazlı giriş |
| Tarihe göre yeni kullanıcılar | `daily[].newUsers` | Gün bazlı kayıt |
| Tüm kullanıcı listesi | `GET /users` | Düzenleme ekranı için sayfalı liste |
| Kullanıcı düzenleme | `PATCH /users/:id` | Panelden yapılan değişikliklerinize yazılması |

Opsiyonel: `GET /health` (canlılık), `GET /users/:id` (tek kayıt detayı).

---

## Endpoint özeti

Tam URL’ler panelde ayrı ayrı kaydedilir (örnek path’ler):

| Endpoint | Metot | Amaç |
|----------|-------|------|
| `/health` | GET | Servis ayakta mı (2xx) |
| `/analyse` | GET | Özet sayılar + günlük seri (JSON) |
| `/users` | GET | Kullanıcı listesi (JSON, sayfalı) |
| `/users/:id` | GET | Tek kullanıcı (opsiyonel) |
| `/users/:id` | PATCH | Kullanıcı güncelleme |

Detaylı JSON alanları: [`EXTERNAL_API_CONTRACT.md`](./EXTERNAL_API_CONTRACT.md) (v2).

---

## Kanonik kullanıcı modeli (PanelUser)

Backend’inizde alan adları farklı olsa bile yanıtta **bu isimlere map** edin. Uygulamaya özel alanları `extras` içinde saklayın; panel bunları gösterebilir, düzenleme formunda genişletilebilir.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "kullanici@ornek.com",
  "displayName": "Ayşe Yılmaz",
  "phone": "+905551234567",
  "status": "active",
  "createdAt": "2025-11-03T08:15:00.000Z",
  "lastLoginAt": "2026-05-14T19:22:00.000Z",
  "extras": {
    "plan": "premium",
    "city": "Istanbul"
  }
}
```

| Alan | Zorunlu | Tip | Not |
|------|---------|-----|-----|
| `id` | Evet | string | Sizin sistemdeki benzersiz kimlik (UUID, sayı string olarak vb.) |
| `email` | Hayır | string \| null | |
| `displayName` | Hayır | string \| null | Ad-soyad veya kullanıcı adı |
| `phone` | Hayır | string \| null | |
| `status` | Hayır | `"active"` \| `"inactive"` \| `"banned"` \| null | Sizde farklı enum varsa map tablosu kullanın |
| `createdAt` | Hayır | ISO-8601 \| null | Kayıt zamanı |
| `lastLoginAt` | Hayır | ISO-8601 \| null | Son giriş |
| `extras` | Hayır | object | Uygulamaya özel alanlar (değiştirmeden aktarın) |

**PATCH gövdesi:** Sadece değişen alanlar gönderilir. Desteklediğiniz alanları güncelleyin; `extras` altındaki anahtarlar birleştirilmeli (merge) veya sizin politikanıza göre tam replace — davranışı entegrasyon notunda yazın.

---

## Mapping katmanı (uygulama başına)

Entegrasyon sırasında doldurulacak tablo. AI veya geliştirici bunu referans alır.

### Özet metrikleri (`/analyse`)

| Panel alanı | Sizin kaynağınız (tablo / sorgu / alan) | Not |
|-------------|----------------------------------------|-----|
| `summary.totalUsers` | | örn. `COUNT(*) FROM users` |
| `summary.loginsToday` | | örn. `login_events` bugün |
| `summary.newUsersToday` | | örn. `created_at >= bugün 00:00` |
| `daily[].logins` | | Gün bazlı GROUP BY |
| `daily[].newUsers` | | Gün bazlı yeni kayıt |

### Kullanıcı listesi (`/users`)

| Panel alanı | Sizin alanınız | Dönüşüm |
|-------------|----------------|---------|
| `id` | | |
| `email` | | |
| `displayName` | | örn. `full_name` veya `username` |
| `phone` | | |
| `status` | | örn. `is_active` → active/inactive |
| `createdAt` | | |
| `lastLoginAt` | | |
| `extras.*` | | Listelenmesi gereken ek alanlar |

### Durum eşlemesi (örnek)

| Sizin değeriniz | Panel `status` |
|-----------------|----------------|
| `1`, `"enabled"` | `active` |
| `0`, `"disabled"` | `inactive` |
| `"blocked"` | `banned` |

---

## AI prompt şablonu (kopyala → doldur → yapıştır)

Aşağıdaki bloğu olduğu gibi kopyalayın. `{{...}}` yerlerini doldurun. Son satırdaki dosya listesini ek olarak iletin.

```
Görev: Mobil uygulama backend'imi App Panel v2 sözleşmesine uygun hale getir.

Uygulama: {{UYGULAMA_ADI}}
Bundle ID: {{BUNDLE_ID}}
Base URL (örnek): {{https://api.ornek.com/v1}}

Mevcut stack: {{Node/PHP/Laravel/Firebase/...}}
Veritabanı / auth: {{PostgreSQL + JWT / Firestore / ...}}

Zorunlu endpoint'ler (hepsi GET/PATCH, panel sunucusundan çağrılır):
1) GET {{BASE}}/health — 2xx yeterli, body opsiyonel {"ok":true}
2) GET {{BASE}}/analyse — JSON; generatedAt + summary (totalUsers, loginsToday, newUsersToday) + daily[] (date, logins, newUsers)
3) GET {{BASE}}/users?page=&limit= — PanelUser listesi + pagination
4) PATCH {{BASE}}/users/:id — Panelden gelen kısmi güncelleme

Bizim kullanıcı modeli (kaynak):
{{JSON veya tablo alan listesi — örn. user_id, mail, ad_soyad, aktif_mi, son_giris, abonelik_tipi}}

Mapping (Panel → bizim alan):
- id ← {{kaynak}}
- email ← {{kaynak}}
- displayName ← {{kaynak}}
- status ← {{kaynak}} (active/inactive/banned kurallarını yaz)
- createdAt ← {{kaynak}}
- lastLoginAt ← {{kaynak}}
- extras: {{hangi alanlar extras'a gidecek}}

Metrik kaynakları:
- totalUsers: {{sorgu veya açıklama}}
- loginsToday: {{login tablosu / event adı}}
- newUsersToday: {{kayıt tarihi alanı}}
- daily.logins / daily.newUsers: {{kaç günlük geriye, timezone: Europe/Istanbul}}

Kısıtlar:
- HTTPS, yanıt < 64 KB, ~8 sn timeout
- Panel şu an Authorization header göndermiyor; güvenlik: {{IP allowlist / URL token / API key header — siz nasıl yapacaksanız}}
- İç ağ URL'leri kullanma (SSRF)

Çıktı isteğim:
1) Her endpoint için route/handler kodu
2) Mapping fonksiyonu (kaynak user → PanelUser)
3) Örnek JSON yanıtlar (health, analyse, users listesi, PATCH örneği)
4) Kısa test curl komutları

Referans: Bu repodaki docs/EXTERNAL_API_CONTRACT.md ve docs/INTEGRATION_TEMPLATE.md dosyalarının tamamını oku ve ona uy.
```

---

## Entegrasyon kontrol listesi

- [ ] `/health` 2xx dönüyor
- [ ] `/analyse` zorunlu alanlar dolu, `daily` en az son 7–30 gün (tercihen 30)
- [ ] `totalUsers`, `loginsToday`, `newUsersToday` tanımlarınız dokümante
- [ ] `/users` sayfalama çalışıyor (`page`, `limit`, `total`)
- [ ] Liste öğeleri `id` içeriyor; `extras` kayıp veri taşımıyor
- [ ] `PATCH /users/:id` panel alanlarını kalıcı güncelliyor
- [ ] Timezone tutarlı (öneri: UTC depolama, `daily.date` UTC veya belirtilen TZ’de gün sınırı)
- [ ] Panelde üç URL kayıtlı: Health, Analyse, Users

---

## Sürüm ve uyumluluk

- **v2** kullanıcı odaklı özet ve `/users` uçlarını ekler.
- Eski **v1** `analyse` yanıtları (`activeUsers`, `sessions24h`, …) panelde kademeli kaldırılabilir; yeni entegrasyonlarda v2 kullanın.
- Sözleşme değişirse `contractVersion: "2"` kök alana eklenebilir (opsiyonel).
