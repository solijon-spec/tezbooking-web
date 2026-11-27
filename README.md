# TezBooking — tur qidiruv sayti (prototip)

Turagentliklar uchun bitta qidiruvda bir nechta turoperatorning turlarini solishtiradigan sayt.
Hozircha **demo ma'lumotlar** bilan ishlaydi: operatorlar, mehmonxonalar va narxlar o'ylab topilgan.
Sayt uch tilda ishlaydi: **o'zbekcha, ruscha, inglizcha** (yuqoridagi UZ / RU / EN tugmalari).

Uchta bo'lim (yuqori menyu):
- **Turlar** — aviareys + mehmonxona, operatorlar narxlari yonma-yon.
  Natijalar ikki ko'rinishda: **Turlar bo'yicha** (asosiy — har bir tur alohida: operator, ovqat, xona, reysdagi joy; narx bo'yicha,
  30 tadan sahifalab) yoki **Mehmonxonalar bo'yicha** (guruhlangan). Kartada mehmonxona faktlari (dengiz, aeroport, asosiy qulayliklar),
  **Batafsil** oynasida — tavsif, qulayliklar, xona turlari, narxga nima kiradi / kirmaydi, reys va barcha operatorlarning narxlari.
  Demo mehmonxonalar tafsiloti `js/data.js` → `hotelInfo()` da yaratiladi; jonli (haqiqiy) mehmonxonalar uchun o'ylab topilmaydi.
- **Mehmonxonalar** — faqat mehmonxona (aviareyssiz): xuddi shu qidiruv va filtrlar, narxda reys yo'q.
- **Aviachiptalar** — borish-qaytish yoki bir tomonga, ekonom/biznes; aviakompaniya, to'g'ri reys va bagaj filtrlari,
  ±3 kunlik narx tasmasi. Demo reyslar `js/data.js` ichidagi `flightsFor()` da hisoblanadi.

**Mavjudlik (real vaqt):** sotuvi to'xtagan, reysda joy qolmagan va bron qilingan variantlar umuman ko'rsatilmaydi.
«Bron qilish» bosilgan variant natijalardan va mijozga taklifdan darhol olib tashlanadi (xabardagi «Bekor qilish» bilan qaytarsa bo'ladi).
Sahifa har 30 soniyada mavjudlikni qayta tekshiradi: sotilib ketganlar ro'yxatdan yo'qoladi, taklifdagilari olib tashlanib, agentga xabar chiqadi.
Demo'da «sotilib ketish» kun davomida tasodifiy simulyatsiya qilinadi (`js/data.js` → `soldOut()`); haqiqiy versiyada bu operator API'sidan olinadi.

Uchala bo'limdan ham variantni **mijozga taklif**ga qo'shish mumkin — bitta taklifda tur, mehmonxona va aviachipta aralash bo'lishi mumkin.

## Paket tarkibi, uchish shahri va GDS (2026-11-24)

- **Qayerdan uchish:** Toshkent, Samarqand, Buxoro, Urganch, Namangan, Farg'ona, Andijon, Termiz, Navoiy, Qarshi, Nukus, Dushanbe
  (ro'yxat `js/data.js` → `FROM`, `server/live/samo.js` → `FROM_RU`, `server/live/validation.js` → `FROM_IDS` — uchalasi bir xil bo'lsin).
  Har bir tur kartasida, «Batafsil» oynasida va mijozga taklif matnida: «Toshkentdan uchish (TAS) · 1 dek, 15:30».
- **Uchish sanasi va soati** — operator javobidagi tur qatorining o'zidan (`06.12.2026 10:25`, `server/live/samo.js` → `dep`, `depDate`),
  yo'nalish kodi ham (`TAS-2-SSH`). 2026-11-24 dagi sinovda Misr bo'yicha 826 turning hammasida vaqt bor edi; GDS paketlarda vaqt berilmaydi.
- **Mehmonxona tur paket ichidan:** «Mehmonxonalar» bo'limida operatorda «faqat mehmonxona» qidiruvi bo'lmasa yoki bo'sh bo'lsa,
  mehmonxona uning tur paketidan olinadi va «Tur paket ichidan · narx aviareys bilan» deb ko'rsatiladi
  (sinovda BAA bo'yicha Kazunion va FUN&SUN dan 500 ta mehmonxona shunday olindi). Chipta narxi ma'lum bo'lsa — narx = paket − chipta.
- **Chipta narxi:** charter paketlarda operatorlar chipta narxini ochiq bermaydi (na tur qatorida, na «Состав пакета» da), alohida
  aviachipta sahifalari ham charter reys qaytarmadi. Shu sabab `LIVE_TOUR_TICKETS` sukut bo'yicha o'chiq (operatorlarga ortiqcha so'rov
  yubormaslik uchun); yoqilsa (`=1`) server operatorning chipta sahifasidan mos reysni topishga urinadi. Demo'da chipta va mehmonxona
  narxi alohida ko'rsatiladi; «Chipta narxi ko'rsatilgan» filtri faqat natijalarda shunday takliflar bo'lsa chiqadi.
- **GDS paketlar** (muntazam reys, chipta GDS orqali): qator klassi `freight-external`, tur nomida `GDS` yoki Prestige'dagi `dynamic`.
  Sinovda: Turkiya (Easybooking) va Samarqanddan BAA (Easybooking, Kompas) — hammasi GDS. Filtrlar → «Paket» → «Faqat GDS paketlar».
- **Firma foizi (ustama):** tur firma ro'yxatdan o'tayotganda «Necha foiz olasiz?» deb so'raladi (0–50 %). Mijoz narxi = netto + shu foiz;
  netto rejimda har bir narx ostida «Mijozga: $1 195 (+10%)» ko'rinadi. Foizni tariflar oynasida yoki Telegram botda o'zgartirish mumkin,
  admin ham firmani tahrirlashda o'zgartira oladi.
- **Ro'yxatdan o'tish:** «Kirish» → «Ro'yxatdan o'ting» (firma nomi, telefon, login, parol — kamida 8 belgi, harf va raqam, foiz).
  IP'dan soatiga 3 ta, bot tuzog'i (yashirin maydon) bor. Yopish: `AGENCY_SELF_REGISTER=0`.

## Telegram bot

`server/telegram/` — tur agentliklar uchun kanal postlari (o'zbek va rus tillarida).

1. Telegram'da **@BotFather** → `/newbot` → tokenni `.env` ga yozing: `TELEGRAM_BOT_TOKEN=...`, so'ng `npm start`.
2. Firma saytda **Kirish → tariflar oynasi → «Botni ulash kodi»** ni bosadi va botga `/link 123456` yuboradi (kod 10 daqiqa, bir marta).
3. Botda: **📝 Post yaratish** → davlat → tunlar → qachon (yaqin 2 hafta / keyingi oy / aniq sana) → bot operatorlarning haqiqiy
   narxlaridan eng arzon 8 ta turni ko'rsatadi → birini yoki **«Top-5 bitta postda»** ni tanlang.
4. Post: mehmonxona va yulduzlar, qayerdan va qachon uchish (sana, hafta kuni, soat), necha kecha / kun, ovqat, xona, narx
   (firma foizi bilan), so'mda, telefon, firma nomi, heshteglar va rasm (yo'nalish rasmi yoki **🖼 O'z rasmim**).
5. **⚙️ Sozlamalar:** bot tili, post tili (UZ / RU / ikkalasi), uchish shahri, kanal, telefon, ustama foizi.
   Kanal ulash: botni kanalga **admin** qiling («Post yozish» huquqi) va `@kanal` ni yuboring — bot o'zi va siz admin ekaningizni tekshiradi.
6. **📤 Kanalga joylash** — bir tugma bilan (kuniga 40 tagacha).

Bot profil rasmi — TezBooking logosi (`images/telegram-bot-avatar.jpg`, 640×640, `logo-mark.png` dan). Botda rasm bo'lmasa,
server ishga tushganda o'zi o'rnatadi; boshqa rasmni BotFather → `/setuserpic` orqali qo'ysangiz, almashtirilmaydi.

Narxlar faqat haqiqiy (server/live, 10 daqiqa kesh — sayt bilan umumiy). Operatorlar javob bermasa, bot buni ochiq aytadi, o'ylab topilgan
tur chiqarmaydi. `npm run demo` yoki `TELEGRAM_DEMO=1` da namunaviy narxlar ishlatiladi va postning boshida **DEMO** deb yoziladi.
Bot long polling bilan ishlaydi — serverga tashqaridan webhook manzil ochish shart emas.

## Xavfsizlik qalqoni (server/security.js)

Har bir so'rov eng avval qalqondan o'tadi (sayt va admin porti):

| Nima | Qanday javob |
|---|---|
| Skaner manzillari: `/.env`, `/.git`, `/wp-admin`, `*.php`, `/phpmyadmin`, `/server/`, `/data/` … | darhol IP blok |
| URL'da SQL-injection, XSS, path traversal, `${jndi:` … naqshlari | darhol IP blok |
| Noto'g'ri parol (admin, tur firma, owner) | 5 ta xato ≈ blok; tur firma login'iga 15 daqiqada 10 xato — login yopiladi |
| Boshqa saytdan cookie bilan POST (CSRF, `Origin` mos emas) | 403 va ball |
| Bitta IP'dan daqiqasiga 600 dan ko'p so'rov | 10 daqiqa blok |
| Ko'p 404 (rasm/css/js dan tashqari) | ball yig'iladi |

Blok muddati oshib boradi: 15 daq → 1 soat → 6 soat → 24 soat → 7 kun. Bloklar va hodisalar bazada saqlanadi.
**Admin panel → Xavfsizlik:** bloklangan IP'lar, kuzatuvdagilar, oxirgi hodisalar, qo'lda bloklash / blokdan chiqarish.
Lokal (127.0.0.1) va `SHIELD_ALLOW_IPS` dagi IP'lar hech qachon bloklanmaydi.

Qo'shimcha himoyalar: barcha sahifalarda CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HTTPS'da HSTS;
sekin so'rovlar (slowloris) uchun vaqt chegaralari; jonli ulanishlar (SSE) IP boshiga 8 ta; production'da `null`/localhost CORS yopiq;
AI chat production'da faqat kirgan firmalarga (`CHAT_REQUIRE_LOGIN`); parol o'zgarsa boshqa qurilmalardagi sessiyalar yopiladi;
xotiradagi urinishlar jadvallari muntazam tozalanadi.

## Haqiqiy narxlar (tur operatorlardan)

"Turlar" bo'limida server (`npm start`) ishlayotganda narxlar **o'ylab topilmaydi** — ular tur operatorlarning
o'z qidiruvidan olinadi (`server/live/`). Ko'p operatorlar SAMO-Tour tizimida ishlaydi va "Поиск тура" sahifasi
login'siz ochiq: server o'sha sahifa brauzerga beradigan so'rovni yuboradi, javobdagi narxlarni o'qiydi va saytga beradi.

- Toshkent, Samarqand, Buxoro, Urganch, Namangan, Farg'ona, Andijon, Termiz, Navoiy, Qarshi, Nukus yoki Dushanbedan jo'nash (operator shu shahardan uchsa), tanlangan kun ±3 kun, aniq tunlar soni; narx USD, 2 kishi uchun jami.
- Natija 10 daqiqa keshda turadi (operator saytlariga ortiqcha yuk tushmasin). Bir xil mehmonxona turli operatorlarda bo'lsa — bitta kartada.
- Hozir ochiq qidiruvdan narx beradigan operatorlar: Prestige, Kazunion, Selfie Travel, Savtour, FUN&SUN, FlyKhiva, Malva, Easybooking, Kompas (yo'nalishga qarab).
- Ochiq qidiruvi yo'q yoki yopiq: ANEX, Crystal Bay (Toshkentdan emas), Centrum, Aqua, Vietratour (Toshkentdan emas), Pegas, Asialuxe, RezLive va boshqalar —
  ular operator bergan **API kaliti** bilan ulanadi. Filtrda "demo" belgisi bilan ko'rsatilgan.
- Bron hozircha "so'rov" sifatida TezBooking'da qayd etiladi; operatorga avtomatik yuborish API kaliti bilan ishlaydi.
- "Mehmonxonalar" va "Aviachiptalar" bo'limlari hali demo narxlarda (manbalar API kaliti bilan ulanadi).
- Internetdagi demo (GitHub Pages) serversiz ishlagani uchun u yerda demo narxlar ko'rsatiladi.

### Live API xavfsizligi

Live qidiruvi mijozlar uchun ochiq qoladi, shuning uchun u egasiga tegishli maxfiy API emas. Server qat'iy sana/yo'lovchi/yo'nalish tekshiruvi, IP va global daqiqalik limitlar, operatorlar bo'yicha parallelizm chegarasi, maksimal navbat va 25 soniyalik qidiruv muddati qo'llaydi. Operatorlarning xom xato matni API javobida berilmaydi.

Tashqi so'rovlar faqat konfiguratsiyadagi operator hostiga yuboriladi: DNS natijalaridagi loopback/privat manzillar bloklanadi, IP ulanishdan oldin tekshiriladi va shu tekshirilgan IP'ga ulanadi. Redirect faqat shu operator origin'ida qolsa kuzatiladi. Barcha manbalar HTTPS orqali so'raladi (Prestige va Selfie ham 2026-11 dan HTTPS). Anex o'z saytini SAMO'dan boshqa tizimga ko'chirgani uchun jonli qidiruvdan chiqarilgan — filtrda qoladi, API kaliti bilan ulanadi.

`LIVE_GLOBAL_CONCURRENCY`, `LIVE_OPERATOR_CONCURRENCY`, `LIVE_MAX_QUEUE`, `LIVE_RATE_PER_MIN`, `LIVE_GLOBAL_RATE_PER_MIN`, `LIVE_TIMEOUT_MS` sozlamalari `.env.example`-da berilgan. Standart qiymatlar: global 12/bitta operatorga 2, navbat 100, har bir IP uchun 20 va global 300 so'rov/daqiqa, qidiruv muddati 25 soniya. Limit to'lganda operator darajasida `busy` yoki HTTP `429` qaytadi.

`node --test` xavfsizlik va normalizatsiya testlarini faqat lokal soxta adapter/transport bilan bajaradi; testlar operatorlarga so'rov yubormaydi. Kelajakdagi Main Agent/worker queue uchun live-search adapter va dispatch qatlamlari ajratilgan, ammo Phase 1 hali brauzer worker yoki AI orchestratorni joriy qilmaydi.

## Demo versiya

**Internetda (o'rnatishsiz):** https://solijon-spec.github.io/tezbooking/
- Server kerak emas: sayt va admin panel API'si brauzer ichida taqlid qilinadi (`js/demo-api.js`).
- Har bir tashrif buyuruvchining o'z demo nusxasi bor (brauzerda saqlanadi), "Qayta boshlash" tugmasi boshlang'ich holatga qaytaradi.
- Demo faqat `*.github.io` da yoki manzilga `?demo` qo'shilganda yoqiladi (`?demo=0` — o'chiradi). Oddiy ishda (`npm start`) hech narsa qilmaydi.
- **Admin panel → Agentlar** ham ishlaydi: Main Agent topshiriqni tahlil qiladi (`js/agent-parser.js` — serverdagi bilan bir xil kod),
  9 ta operator ishchisi navbat bilan "qidiradi" va saytdagi demo narxlardan takliflar qaytaradi; ba'zan ishchi kutish vaqtidan oshib,
  ogohlantirish chiqadi. Operator saytlariga so'rov yuborilmaydi.

**Lokal (shu kompyuterda):** `npm run demo` → sayt http://localhost:3100, admin http://localhost:3101
- Alohida baza `data/demo.db` — haqiqiy baza va `.env` parollariga tegilmaydi. Qayta to'ldirish: `npm run demo -- --reset`.

| Demo kirish | Login | Parol |
|---|---|---|
| Tur firma (tarif faol) | `demo` | `demo12345` |
| Tur firma (tarifsiz — sotib olishni sinash) | `yangi` | `demo12345` |
| Admin panel | — | `admin12345` |

Namunaviy ma'lumotlar (`js/demo-seed.js`): 7 tur firma (faol, muddati tugayotgan, tugagan, to'lov kutayotgan, bloklangan),
8 to'lov va 12 bron — sanalar bugungi kunga nisbatan, bronlar saytdagi haqiqiy takliflardan olinadi.
To'lov demo rejimida: "Sotib olish" pulsiz darhol faollashtiradi.

## Qanday ochiladi

Hech narsa o'rnatish shart emas.

- **Eng oddiy yo'l:** `index.html` faylini ikki marta bosing, sayt brauzerda ochiladi.
- **VS Code ichida:** chap paneldagi Extensions bo'limidan "Live Server" kengaytmasini o'rnating,
  so'ng `index.html` ustida o'ng tugma → **Open with Live Server**. Faylni saqlaganingizda sahifa o'zi yangilanadi.

## Fayllar

| Fayl | Nima qiladi |
|---|---|
| `index.html` | Sahifa skeleti, shriftlar va skriptlarni ulaydi |
| `css/styles.css` | Barcha ranglar va uslublar (asosiy rang: `--accent`), telefon uchun moslashuv |
| `js/i18n.js` | **Tillar:** barcha matnlar, davlat/shahar nomlari, oy va hafta kunlari (uz / ru / en) |
| `js/data.js` | Demo ma'lumotlar: davlatlar, mehmonxonalar, operatorlar va narx hisoblash |
| `js/app.js` | Interfeys: holat (state), chizish (render), tugmalar va filtrlar |
| `js/chat.js` | AI yordamchi oynasi (o'ng pastdagi tugma) |
| `js/wheel.js` | Aylanma sana tanlagich (bron qilingan kunlar qizil) |
| `js/sync.js` | Bronlarni server bazasi bilan sinxronlash |
| `server/server.js` | Server: saytni ochadi, AI chat savollarini Claude API'ga yuboradi |
| `server/db.js` | Ma'lumotlar bazasi (SQLite): bronlar va ularning tarixi |
| `server/bookings.js` | Bronlar API'si va jonli yangilanishlar |
| `server/admin.js` | Admin panel API'si: parol bilan kirish, bronlar, firmalar, to'lovlar, tariflar |
| `server/accounts.js` | Tur firmalar (login/parol, o'zi ro'yxatdan o'tish, ustama foizi), tariflar, to'lovlar |
| `server/security.js` | Xavfsizlik qalqoni: hujumlarni aniqlash, IP bloklash, xavfsizlik sarlavhalari |
| `server/telegram/` | Telegram bot: `bot.js` (suhbat), `post.js` (post matni UZ/RU), `api.js` (Telegram API) |
| `js/account.js` | Saytda: tur firma kirishi, tariflar oynasi, to'lov |
| `js/demo-api.js`, `js/demo-seed.js` | Demo rejim: brauzerdagi soxta server va namunaviy ma'lumotlar |
| `server/demo.js` | Lokal demo: `npm run demo` (alohida baza, 3100/3101 portlar) |
| `admin.html`, `js/admin.js`, `css/admin.css` | Admin panel sahifasi (`/admin`) |
| `images/` | Sayt rasmlari (JPG, 960px): `country-<id>.jpg` — davlatlar, `hotel-resort-1..6` / `hotel-city-1..4` / `hotel-island-1` — mehmonxonalar; galereya uchun `hotel-beach-1..2`, `hotel-pool-1..2`, `hotel-aqua`, `hotel-spa`, `hotel-restaurant`, `hotel-lobby`, `room-std/sup/dlx` (hammasi umumiy, AI bilan yaratilgan; galereya `js/app.js` → `hotelGallery()` da mehmonxona qulayliklariga qarab tuziladi), `flight-plane.jpg` — aviachiptalar banneri. Logo: `logo.png` (asl, to'liq), `logo-horizontal.png` (sayt va admin sarlavhasi), `logo-mark.png` (belgi, 512px), `favicon-32.png`, `apple-touch-icon.png` |
| `package.json` | `npm start` buyrug'i (qo'shimcha paket yo'q) |
| `.env.example` | Sozlamalar namunasi — undan `.env` faylini yasaysiz |

**Yangi matn qo'shish:** `js/i18n.js` ichida uchala tilga ham bir xil kalit bilan qo'shing,
so'ng `app.js` da `t('kalit')` orqali chaqiring.

## Qidiruv filtrlari

Filtrlar panelida mehmonxona nomi, shahar yoki davlat bo'yicha qidirish mumkin. Matnli qidiruv
operator, narx, yulduz, ovqatlanish, shahar va mavjudlik filtrlari bilan birga ishlaydi; **Tozalash** barcha filtrlarni tiklaydi.

## AI chat (AI yordamchi)

O'ng pastdagi **AI yordamchi** tugmasi chat oynasini ochadi. U **faqat tur va sayohat** savollariga javob beradi:
yo'nalish va mavsum, viza, mehmonxona, aviareys, narxlar, mijozga taklif matni, TezBooking'dan foydalanish.
Boshqa mavzudagi savollarga (dasturlash, retsept, siyosat va h.k.) muloyim rad javobi qaytadi.

Cheklov ikki qavatli va serverda turadi (brauzerdan o'zgartirib bo'lmaydi):
1. Har bir savolni avval tez model (**Claude Haiku 5.5**) tekshiradi: tur/sayohat mavzusimi yoki yo'q.
2. Javobni **Claude Sonnet 5.5** yozadi; uning ko'rsatmasida ham "faqat sayohat" qoidasi bor.

"Joriy qidiruvni hisobga olish" belgilangan bo'lsa, ekrandagi qidiruv natijalari (birinchi 10 ta mehmonxona) ham AI'ga yuboriladi —
"Bolali oila uchun qaysi biri mos?" kabi savollarga shu natijalar asosida javob beradi.

### Ishga tushirish

1. **Node.js** o'rnating (LTS versiya): https://nodejs.org. Tekshirish — VS Code terminalida (Ctrl + `):  `node -v`
2. **Claude API kaliti** oling: https://platform.claude.com → API Keys. (Hisobingizda to'lov usuli bo'lishi kerak.)
3. Loyiha papkasida `.env.example` faylidan nusxa olib, nomini **`.env`** qiling va kalitni yozing:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. VS Code terminalida:
   ```
   npm start
   ```
5. Brauzerda oching: **http://localhost:3000**
   (Server ishlab tursa, `index.html` ni to'g'ridan-to'g'ri ochganda ham chat ishlaydi.)

Server ishlamasa yoki kalit yo'q bo'lsa, chat oynasida shu haqda tushuntirish chiqadi.

### Xavfsizlik

- API kaliti faqat `.env` faylida va serverda turadi — brauzerga hech qachon yuborilmaydi.
- `.env` fayli `.gitignore` da: GitHub'ga yuklanmaydi. Uni hech kimga yubormang.
- Server faqat shu kompyuterdan ochiladi (127.0.0.1). Har bir kompyuterdan daqiqasiga 20 tagacha so'rov.
- Internetga chiqarishdan oldin: HTTPS, agentlik login'i va server sozlamalarini (CORS) qo'shish kerak.

### Sozlash

- Model nomlari va port — `.env` faylida (`CHAT_MODEL`, `GUARD_MODEL`, `PORT`).
- Qoidalar matni — `server/server.js` ichida: `GUARD_PROMPT` (mavzu tekshiruvi) va `systemPrompt()` (javob qoidalari).
- Rad javobi matnlari — `server/server.js` ichidagi `REFUSAL` (uz / ru / en).

## Bronlar bazasi (server)

`npm start` bilan server ishlab tursa, bronlar **`data/tezbooking.db`** (SQLite) bazasida saqlanadi:
- bir nechta kompyuter yoki agent bitta serverga ulansa, hammasi bir xil bronlarni ko'radi;
- bron qilinsa yoki bekor qilinsa, barcha ochiq sahifalar **o'zi yangilanadi** (sahifani qayta ochish shart emas);
- bitta taklifni ikki agent bron qila olmaydi — ikkinchisiga "allaqachon bron qilingan" xabari chiqadi;
- bron o'chirilmaydi, "bekor qilingan" deb belgilanadi; har bir o'zgarish tarixi `booking_events` jadvalida turadi;
- server birinchi marta ulanganda, shu brauzerda avval qilingan bronlar bazaga avtomatik ko'chiriladi.

Server ishlamasa (`index.html` fayldan ochilgan), sayt avvalgidek bronlarni faqat brauzerda saqlaydi.

| API | Nima qiladi |
|---|---|
| `GET /api/bookings` | Faol bronlar |
| `POST /api/bookings` | Yangi bron (`409` — allaqachon bron qilingan) |
| `POST /api/bookings/cancel` | Bekor qilish |
| `GET /api/bookings/history?key=…` | Bitta bron tarixi |
| `GET /api/events` | Jonli yangilanishlar (Server-Sent Events) |

Talab: **Node.js 22.13 yoki yangi** (baza uchun Node ichidagi `node:sqlite` ishlatiladi, paket o'rnatish shart emas).
Bazani zaxiralash: server to'xtatilganda `data/` papkasidan nusxa oling.

## Admin panel

Manzil: **http://localhost:3001** — saytdan alohida port (faqat server orqali ishlaydi). Sayt portidan (`3000/admin`) admin ochilmaydi. Portni `.env` dagi `ADMIN_PORT` bilan o'zgartirish mumkin.

1. `.env` fayliga parol yozing: `ADMIN_PASSWORD=...` (kamida 12 belgi). Parol bo'lmasa, admin panel o'chiq.
2. Serverni qayta ishga tushiring: `npm start`.

Imkoniyatlar:
- ko'rsatkichlar: faol bronlar, hozir safarda, kelgusi, shu oy yangi, faol bronlar summasi (netto), turlar bo'yicha;
- barcha bronlar jadvali: qidiruv, holat (faol / bekor qilingan) va tur bo'yicha filtr;
- bronni **bekor qilish** yoki **qayta tiklash** — saytdagi barcha sahifalar darhol yangilanadi;
- har bir bron **tarixi** (qachon yaratilgan, kim bekor qilgan);
- **CSV** yuklab olish (Excel'da ochiladi);
- saytda bron qilinsa, jadval o'zi yangilanadi ("Jonli" belgisi).

### Tur firmalar, tariflar va to'lov

1. **Admin → Tur firmalar:** firma nomi va login yoziladi, parol avtomatik yaratiladi (bir marta ko'rsatiladi — nusxa olib, firmaga yuboring).
2. Firma saytga **Kirish** tugmasi orqali kiradi. Qidirish hamma uchun bepul, lekin **bron qilish faqat faol tarif bilan**.
   Tarif bo'lmasa, natijalar tepasida "Bron qilish uchun tarifni sotib oling" chiqadi.
3. Firma **3 oylik / 6 oylik / 1 yillik** tarifni tanlaydi (narxlar: Admin → Tariflar, so'mda).
4. To'lov (`.env` → `PAYMENT_MODE`):
   - `manual` (asosiy): firma to'lov so'rovini yuboradi → pulni bank yoki naqd orqali to'laydi →
     **Admin → To'lovlar → Tasdiqlash** → tarif darhol faollashadi (firma sahifasi o'zi yangilanadi);
   - `demo`: sinov uchun, "Sotib olish" pulsiz darhol faollashtiradi. **Haqiqiy saytda yoqmang.**
   - Payme / Click: merchant shartnomasi olingach `server/accounts.js` ga qo'shiladi.
5. Admin firmaga tarifni qo'lda ham bera oladi (**Tarif berish**), parolni yangilashi va firmani bloklashi mumkin.
6. To'lagan firmalar: **Admin → Tur firmalar → "To'lagan"** filtri; tarifi 14 kun ichida tugaydiganlar "Umumiy" bo'limida ko'rinadi.

Har bir firma faqat **o'z bronlarini** ko'radi (nomi, sanalari qizil). Boshqa firmalar bron qilgan takliflar qidiruvdan yashiriladi.
Firma parollari bazada scrypt xesh ko'rinishida saqlanadi.

Xavfsizlik: parol faqat serverda, sessiya HttpOnly cookie'da (12 soat). Noto'g'ri parol daqiqasiga 5 martadan ko'p kiritilsa, kirish vaqtincha to'xtaydi.
Server qayta ishga tushsa, qayta kirish kerak.

## Owner Console va multi-agent foundation

Manzil: **http://localhost:3000/owner**. Bu mavjud agentlik va mijoz sahifalaridan alohida, serverda autentifikatsiya qilinadigan Owner paneli.

1. `.env` faylida `OWNER_EMAIL=` ga o'z emailingizni yozing va Owner parol xeshini yarating:
   ```sh
   npm run owner:password
   ```
   Buyruq parolni terminalda yashirin kiritadi. Chiqqan `scrypt$...` qiymatini `.env` dagi `OWNER_PASSWORD_HASH` ga qo'ying. Xom parolni faylga yoki kodga yozmang; kamida 12 belgili parol ishlating.
2. `OWNER_DB_FILE=data/owner-os.db` mijozlarning `DB_FILE` bazasidan alohida bo'lishi shart. Owner migratsiyalari faqat shu alohida SQLite faylida ishlaydi.
3. Serverni qayta ishga tushirib, `/owner` ni oching. Xesh sozlanmagan bo'lsa, Owner kirishi o'chirilgan qoladi.

Paneldagi umumiy ko'rsatkichlar OS/process hamda Owner bazasidagi haqiqiy holatdan olinadi; mavjud bo'lmagan ishchi, narx yoki natija uydirilmaydi. 19 ta operatordan 13 tasi saytning jonli qidiruvi orqali ulangan (pastda — "Agent haqiqiy operatorlardan"); qolgan 6 tasi (Asialuxe, Pegas, Kazunion UAE, Velikolepniy Vek, Rezlive, Mir Jahon) **pending** holatda — ularning ochiq SAMO qidiruvi yo'q, login yoki API kaliti kerak.

Main Agent tuzilgan va tabiiy tildagi so'rovlarni tekshiradi, majburiy ma'lumot yetishmasa aniqlashtirish so'raydi va vazifalarni alohida Owner SQLite bazasida saqlaydi. Tabiiy til parseri deterministik tarzda ishlaydi. Ixtiyoriy LLM parseri `AGENT_LLM_ENABLED=1` va serverdagi `AGENT_LLM_API_KEY` bilan yoqiladi; kalit yo'q bo'lsa deterministik parser ishlaydi. LLM javob bermasa xato ochiq ko'rsatiladi, muvaffaqiyat sifatida yashirilmaydi.

Doimiy navbat scheduler orqali ishlaydi: global va operator bo'yicha parallelizm, vaqt cheklovi, chegaralangan qayta urinishlar, bekor qilish va qayta ishga tushganda uzilgan vazifalarni tiklash qo'llab-quvvatlanadi. Owner panel vazifa holatini SSE orqali kuzatadi. Faqat ro'yxatga olingan adapteri bor, yoqilgan va `verified` operatorga dispatch qilinishi mumkin. Agentlik login/paroli bilan ishlash: SAMO operatorlari, Pegas va Asialuxe (quyida); Aqua va Kazunion UAE uchun ulagich hali yo'q.

### Agent haqiqiy operatorlardan (jonli ishchilar)

`server/owner/live-workers.js` — 13 ta operator ishchisi (Aqua, Centrum, Crystal Bay, Easybooking, Fly Khiva, FS Travel, Kazunion, Kompas, Malva, Prestige, Savtour, Selfie, Vietra). Server ishga tushganda ular ro'yxatga olinadi va operator "Tasdiqlangan / Tayyor" holatiga o'tadi.

- Ishchi saytdagi qidiruv bilan bir xil yo'ldan boradi: operatorning "Поиск тура" sahifasi (himoya chetlab o'tilmaydi), sana ±3 kun, kesh sayt va Telegram bot bilan umumiy (10 daqiqa).
- **Agentlik kabineti:** `.env` da `OPERATOR_<ID>_LOGIN` / `OPERATOR_<ID>_PASSWORD` bo'lsa (Prestige, Kompas, Crystal Bay, Vietra, FS Travel, Kazunion, Centrum), ishchi agentlikning o'z logini bilan oddiy kirish formasi orqali kabinetga kiradi va qidiruvni kabinet sessiyasida bajaradi (`server/live/samo.js`, `server/live/credentials.js`). Sessiya 20 daqiqa ishlatiladi; parol qabul qilinmasa — 30 daqiqa qayta urinilmaydi (hisob bloklanmasin), qidiruv ochiq sahifa orqali davom etadi va admin panelda ogohlantirish chiqadi. Login/parol faqat `.env` da — bazaga, logga va API javoblariga yozilmaydi; panelda faqat holat ("Kabinet": Loginsiz / Login bor / Kirildi / Kirib bo'lmadi).
- **Pegas va Asialuxe (faqat login bilan):** ochiq qidiruvi yo'q, shuning uchun `OPERATOR_PEGAS_*` / `OPERATOR_ASIALUXE_*` bo'lsagina ishchi ulanadi (`server/live/pegas.js`, `server/live/asialuxe.js` — kabinet sahifasining o'z JSON so'rovlari). Login bo'lsa natijalari sayt, Telegram bot va agentlar qidiruvida (login bo'lmasa — hech qayerda). Narx USD da, reys vaqti bilan. Asialuxe dinamik paket: aniq sana bo'yicha; kurort berilsa avval o'sha shahar (2 ta), berilmasa 4 tagacha charter shahar; har safar barcha reyslar olinib, narx eng arzon reys bilan hisoblanadi. Javobi sekin: ishchiga 180 s (Pegas — 120 s), sayt/bot esa bitta operatorni ko'pi bilan 50 s kutadi (`LIVE_SITE_WAIT_MS`), qolganlar natijasi baribir chiqadi.
- **Paket filtri (saytda):** "GDS'siz (charter) turlar" va "GDS paketlar" — ikkalasi sukut bo'yicha belgilangan; GDS olib tashlansa faqat GDS'siz turlar, charter olib tashlansa faqat GDS turlar qoladi.
- **Mehmonxona bo'yicha qidiruv (saytda):** kartadagi "Shu mehmonxonadagi turlar" yoki filtrlardagi "Barcha operatorlarda qidirish" — barcha operatorlar faqat shu mehmonxonani qidiradi (`hotel=`). Admin panel → Agentlar → Natijalar: "Shu mehmonxona: barcha agentlar".
- **Mehmonxona bo'yicha:** buyruqda mehmonxona nomi bo'lsa — `CAMIA RESORT 4* - PHU QUOC NORTH 15 dekabr 7 kecha 2 kishi`, `hotel Camia Resort, Fukuok, ...`, `"Rixos Premium Belek" ...` — ishchi operatorning o'zida shu mehmonxona(lar) bo'yicha qidiradi (SAMO `HOTELS` filtri, natija birinchi sahifaga sig'adi) va faqat o'sha mehmonxona paketlarini qaytaradi. Kurort yozilmasa, davlat bo'yicha qidiriladi. Operatorda bunday mehmonxona bo'lmasa — jurnalda `no_hotel`.
- Topshiriq bo'yicha saralash: kurort ("Antalya" — Kemer, Belek, Side, Lara, Alanya va h.k.; "Alanya" — faqat Alanya), ovqatlanish (AI so'ralsa UAI ham), yulduz (kamida), byudjet (USD; so'mda — Markaziy bank kursi bo'yicha; EUR — filtrsiz). Sotuvda yo'q va reysda joyi qolmagan turlar chiqmaydi.
- Har bir operatordan eng arzon 200 ta taklif (`AGENT_LIVE_MAX_OFFERS`, 1–600); aynan so'ralgan kundagilar birinchi. SAMO natijasi sahifalab keladi (narx bo'yicha arzonidan qimmatiga): tanlangan kun alohida so'raladi va uning eng arzon 6 sahifasi (`LIVE_MAX_PAGES`, ~500–600 paket) parallel olinadi; qo'shni kunlar (±3) — faqat 1-sahifa. Operatorda yana bo'lsa, saytdagi taxtada "Operatordan yana yuklash" keyingi 6 sahifani olib keladi (`LIVE_MORE_PAGES`; API: `/api/live/tours?…&op=<id>&page=<n>`). Narxi EUR dagi paketlar (Kompas, FlyKhiva Turkiyasi) operatorning o'zi o'girgan USD narxi bilan ko'rsatiladi.
- Qidiruv filtri: davlatdan keyin **shahar (kurort)** tanlanadi (`js/cities.js`: Antaliya, Kemer, Istanbul, Dubay, Sharja, Pxuket, ...). Har bir operator shu shaharni o'zining filtri bilan qidiradi: SAMO — `TOWNS` (operatorning shahar guruhi yoki tumanlari), Pegas — hudud/shahar/tuman (`HotelRegionIds`, `HotelLocationIds`), Asialuxe — faqat shu shahar. Operatorda bunday shahar bo'lmasa — `no_city`. **Qaytish sanasi** ham bor: tanlansa tunlar soni shundan (1–30). Agent topshirig'i ham shunday: kurort operatorga shahar filtri bo'lib boradi, "15-22 dekabr" / "15.12 – 22.12" kabi qaytish sanasidan tunlar hisoblanadi.
- Paketlar har 5 daqiqada yangilanadi (`LIVE_REFRESH_MS`): oxirgi 30 daqiqada sayt, Telegram bot yoki agent so'ragan qidiruvlar (`LIVE_ACTIVE_MS`) fon rejimida operatorlardan qayta tortiladi; yangisi kelguncha eskisi beriladi, bu safar xato bergan operatorning oldingi paketlari qoladi. Sayt ochiq turgan bo'lsa yangisini o'zi oladi va "HH:MM da olindi" deb ko'rsatadi.
- Natijada: mehmonxona, yulduz, joy, sana, kechalar, uchish (yo'nalish va soat), ovqat, xona, narx (USD, netto, butun guruh uchun), GDS belgisi, mavjudlik, operator sahifasiga havola.
- Natija yo'q bo'lsa, sababi "Ishchilar jurnali"da: operator bu davlatga sotmaydi, bu shahardan uchish yo'q, shu kunlarga tur yo'q, joy qolmagan, kurort yoki filtrga mos kelmadi. Operator javob bermasa — xato, navbat sozlamasidagi qayta urinishlar bilan.
- Matndan uchish shahri (12 ta: "Samarqanddan", "из Бухары", "from Namangan") va yulduz ("5 yulduzli", "4*", "5 звезд") ham tushuniladi.
- O'chirish: `.env` → `AGENT_LIVE_WORKERS=0`. `npm run demo` da jonli ishchilar ulanmaydi (taqlidiy ishchi).

Fazaviy tekshiruvlar `npm test` orqali bajariladi. Scheduler hozir bitta jarayon va SQLite muhitiga mo'ljallangan; bir nechta server nusxasi, uzoq muddatli lease nazorati va haqiqiy adapterlarning tarmoq xavfsizligi Phase 4 uchun qo'shimcha arxitektura hamda sinovni talab qiladi.

### Agentlarni admin paneldan boshqarish

**Admin panel → Agentlar** (`http://localhost:3001/#agents`) — xuddi shu Main Agent, navbat va ishchilar, lekin kirish **admin paroli** bilan (alohida Owner paroli shart emas). API: `/api/admin/agents/*` (Owner API'ning o'zi, admin sessiyasi bilan; `/login`, `/logout` yopiq, o'zgartiruvchi so'rovlarda Origin tekshiriladi).

- Agentga topshiriq: oddiy matn (uz / ru / en) yoki aniq parametrlar; ma'lumot yetishmasa — aniqlashtiruvchi savollar.
- Vazifalar: holat, jarayon, takliflar soni, natijalar oynasi, **To'xtatish**; SSE orqali jonli yangilanadi.
- Operatorlar: yoqish / o'chirish, yangi operator qo'shish (holati "ulanmagan").
- Navbat sozlamalari, ogohlantirishlar va ishchilar jurnali.

`npm run demo` da agentlar alohida `data/demo-owner.db` bazasida va **taqlidiy ishchi** bilan ishlaydi (Aqua, faqat Turkiya, soxta "Demo Resort" taklifi) — operator saytlariga so'rov yuborilmaydi.

Owner sessiyasi scrypt parol tekshiruvi, HttpOnly/SameSite Strict cookie va ma'lumotni o'zgartiruvchi so'rovlarda Origin tekshiruvi bilan himoyalangan. Bu mahalliy panel internetga chiqarish uchun tayyor degani emas: public deployment uchun HTTPS, ishonchli reverse proxy, server darajasidagi kirish cheklovi va xavfsizlik ko'rigi zarur.

## Brauzerda saqlanadigan narsalar

Til, valyuta, narx turi (netto / mijoz), "Mening davlatlarim", mijozga taklif uchun tanlangan variantlar
va AI chat tarixi sahifa yangilansa ham saqlanib qoladi (`localStorage`, `tezbooking.*` kalitlari).

## Tuzatilgan xatolar (2026-11-17)

1. Sanani klaviaturadan yozish endi ishlaydi (chala yozilgan sana bugunga sakramaydi).
2. Sotuvi to'xtagan takliflarni bron qilib / taklifga qo'shib bo'lmaydi; ular "Eng arzon" bo'lib chiqmaydi.
3. Telefonda filtrlar "Filtrlar" tugmasi orqali ochiladi — natijalar ancha tepada.
4. Telefonda taklif paneli ekranning ko'pi bilan yarmini egallaydi.
5. Davlat tugmalari va sana tasmasidagi narx filtrlarni hisobga oladi.
6. Bosganda aylantirish joyi (sana tasmasi, operatorlar jadvali, taklif paneli) saqlanadi.
7. Mijozga taklif sahifa yangilansa ham saqlanadi.
8. "So'rov bo'yicha" takliflarda "So'rov yuborish" deb yoziladi.
9. Bolalar yoshi va xonalar soni qo'shildi; bola bo'lsa "kishi boshiga" o'rniga "butun guruh uchun" ko'rsatiladi.
10. "Mehmonxonalar" / "Aviachiptalar" — "tez orada" belgisi; "Mijozga takliflar" panelni ochadi.
11. Telefonda yuqori menyu yig'iladi (≡ tugmasi).
12. Esc tugmasi oynalar va panelni yopadi.
13. Oxirgi davlat yoki yo'nalishni olib tashlashga urinilganda tushuntiruvchi xabar chiqadi.
14. Oyna yopilgandan keyin klaviatura fokusi to'g'ri joyga qaytadi.
15. Operator filtri ikki qatorli toza ko'rinishda.
16. Barcha tugmalar telefon uchun kamida 44 px.
17. Sana maydoni tozalansa yoki o'tgan sana yozilsa, oldingi sana qaytariladi.
18. Reyting so'zlari: A'lo / Juda yaxshi / Yaxshi / Qoniqarli.
19. Qaynoq takliflar ham "2 kishi uchun" jami narxni ko'rsatadi; davlat tugmalarida "... dan".
20. Sana maydoni ostida sana so'z bilan yoziladi (brauzer formati chalkashtirmasligi uchun).

## Keyingi qadamlar

1. **Haqiqiy operatorlarni ulash.** `js/data.js` ichidagi `offersFor()` o'rniga operatorlar API'si
   (masalan, SAMO XML-shlyuzi) chaqiriladi. Buning uchun server qismi (backend) kerak:
   API kalitlari brauzerda emas, serverda saqlanishi shart.
2. **Agentlik akkauntlari:** kirish, "Mening davlatlarim", ustama foizi (hozir 10 %) akkauntda saqlanadi.
3. **Bron:** operator tizimida bron qilish va bron holatini kuzatish.
4. **Taklif sahifasi:** mijozga yuboriladigan havola va agentlik logosi bilan PDF.
5. **So'm kursi:** hozir 12 004,48 ga qotirilgan (CBU, 21.11.2026) — keyinchalik Markaziy bank API'sidan avtomatik olinadi.
