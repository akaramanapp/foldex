# Foldex — Tasarım Notları

> Kaynak: claude.ai'deki tartışma (2026-11-14). Henüz kod yazılmadı; bu belge sadece üzerinde anlaşılan süreci özetliyor.
> Slogan önerisi: **"Foldex — every project your AI ever started, indexed."**

## Problem

Yapay zekayla birlikte bilgisayarda onlarca, yüzlerce proje (çoğu deneme) birikiyor. Hangi projenin ne yaptığını, nerede durduğunu gösteren bir index yok.

Mevcut açık kaynak araçlar (CodeBoard, Git-Scope, GitLocal, Backstage, repoindex, LocalNest, project-manage-mcp) ya sadece git durumunu gösteriyor ya da kurulumu ağır. Hiçbiri şu üçünü bir arada yapmıyor:

1. Tek satır config ile kurulum
2. Projenin ne yaptığını IDE'deki modelin kendisine yazdırmak (ayrı API anahtarı yok)
3. Her zaman güncel kalan bir HTML index sayfası

En yakını **repoindex**: MCP ile repolar hakkında soru sorduruyor ama pip ve indexleme adımları istiyor, özet üretmiyor, web sayfası yok.

## Temel ilke: en basit hâli

- Kullanıcı sadece IDE'sinin (Cursor, Claude Code vb.) MCP ayarına **tek bir blok** ekler:

  ```json
  "foldex": { "command": "npx", "args": ["-y", "foldex-mcp"] }
  ```

- Arka planda çalışan izleyici, hook, kural dosyası ya da veritabanı yok.
- MCP sunucusu kendi kendine tetiklenmez, sadece model bir aracını çağırınca çalışır. Bu yüzden otomatiklik "canlı tarama + modele gömülü talimat" ile sağlanır.

## Projeler nasıl index'e giriyor (öncelik sırasıyla)

1. **Oluştururken kaydet (ana mekanizma).** Yapay zeka yeni bir proje klasörü oluşturduğu anda `update_project`'i tam yolla çağırır. Kullanıcının isteği en iyi özettir; yol kesin olarak bilinir; deneme projeleri kaybolmaz.
2. **Çalışırken güncelle.** Projede önemli bir değişiklik olunca model özeti ve etiketleri tazeler. "Basit script" zamanla web uygulamasına dönüşebilir.
3. **Kök klasör taraması (güvenlik ağı).** Config'te verilen kök klasörler her araç çağrısında canlı taranır (klasör adı, README, package.json / pyproject.toml, son commit tarihi). Yapay zeka dışında açılan projeler (`git clone`, elle oluşturulan klasör) "özetsiz" olarak listede görünür.
4. **MCP roots (bonus).** Destekleyen istemcilerde açık klasör otomatik kaydedilebilir.

Bilerek yapılmayacak: Tüm diski `.git` arayarak taramak (yavaş olur, node_modules ve indirilen repolar da toplanır, mahremiyet açısından da rahatsız edici).

## Talimatlar MCP'nin içine gömülü

Kullanıcıdan kural dosyası yazmasını istemek yerine, sunucunun `instructions` alanına ve araç açıklamalarına şu talimatlar yazılır:

- "Yeni bir proje oluşturduğunda bu aracı tam yolla çağır."
- "Projede önemli bir değişiklik olunca özeti güncelle."
- "Yeni bir işe başlamadan önce benzer bir proje var mı kontrol et."

Model bu talimata her zaman uymayabilir. Bu yüzden `list_projects`/`list_pending` özeti eksik projeleri işaretler, eksikler görünür kalır ve sonradan tamamlanır.

## Araçlar (taslak)

| Araç | İş |
|---|---|
| `list_projects` | Listeler; teknoloji, durum ve son değişiklik tarihine göre filtrelenir |
| `search_projects(query)` | Anlama göre arar ("pdf'ten tablo çıkaran") |
| `get_project(name\|path)` | Özet, README, teknolojiler, son commit'ler |
| `update_project(path, summary, tags, status)` | Kaydı oluşturur veya günceller |
| `list_pending` | Özeti eksik projeler |

İsteğe bağlı: MCP "prompt"ları (Claude Code `/` menüsünde "projelerimi listele" gibi).

## Veri

- Merkezi yer: `~/.foldex/` (projeler dağınık olabildiği için klasörün içinde değil).
- Kalıcı olarak saklanan tek şey modelin yazdığı özet ve etiketler. Gerisi her seferinde canlı hesaplanır.
- Tek JSON dosyası, **atomik yazma** ile (geçici dosyaya yaz, sonra yerine taşı). Cursor ve Claude aynı anda açık olabilir.
- Kayıt alanları: tam yol (kimlik), oluşturulma tarihi, 1-2 cümlelik özet, etiketler, durum (`deneme` / `aktif` / `bitti` / `arşiv`), hangi IDE'den oluşturulduğu, git remote.
- Klasör silinince kaydı da silinir (0.1.2, kullanıcı isteği). İstisna: üst klasör de yoksa (takılı olmayan harici disk, ağ sürücüsü) kayıt silinmez, sadece listeden gizlenir. Taşınan projeyi git remote'undan eşleştirme fikri bu yüzden geçersiz kaldı; taşınan proje yeni yerinde yeni kayıt olur.
- Aynı projenin iki kopyası iki ayrı kayıt olarak tutulur; sayfada "aynı remote" diye yan yana gösterilir.
- Deneme kalabalığı: varsayılan durum `deneme`. Uzun süre dokunulmayanlar arşiv görünümüne geçer (silinmez).

## Kullanıcı index'e nasıl erişir

1. **IDE sohbeti (asıl kullanım):** "Hangi projelerim var?", "PDF'ten veri çıkaran bir şey yapmış mıydım?", "Özeti eksik projeleri tamamla."
2. **HTML sayfası:** Her güncellemede `~/.foldex/index.html` yeniden yazılır. Tek dosya ve aranabilir; teknoloji ve durum filtreleri ile proje kartları içerir (özet, teknoloji, tarih, yol, "Cursor'da aç / VS Code'da aç" linkleri). Kullanıcı sayfayı yer imlerine ekler.
3. **CLI (isteğe bağlı):** `npx foldex-mcp open` sayfayı yeniden üretip açar. IDE uzun süre açılmadığında sayfanın eski kalması sorununu çözer.

## Bilinen bedeller

- IDE açılmazsa HTML güncellenmez (`npx foldex-mcp open` ile çözülür).
- Özetin yazılması modelin talimata uymasına bağlı; eksikler görünür kalır.
- Eşzamanlı yazma riski atomik yazmayla azaltılır.

## İsim ve marka

- İsim: **Foldex** ("folder" + "index").
- npm: `foldex` adı boş ama npm, `lolex`'e çok benzediği için yayınlamayı reddediyor (typosquatting koruması). Paket adı **`foldex-mcp`** oldu; kurulum `npx -y foldex-mcp`.
- Benzer isim: FoldX (protein modelleme yazılımı), farklı bir alan.
- Domain: `foldex.dev` dolu. Öneriler: `foldex.sh` → `foldex.app` → `getfoldex.dev`. Domain başlangıçta şart değil; `foldex.github.io` yeterli.
- GitHub'da isim kontrolü henüz yapılmadı.

## Uygulama durumu (0.1.0, 2026-11-15)

- MVP yazıldı (`src/`): tarama, kayıt, 4 MCP aracı, açılışta otomatik kayıt, HTML sayfası ve `open` alt komutu. 21 test geçiyor.
- Durum değerleri, ürün global olduğu için İngilizce: `experiment` / `active` / `done` / `archived`.
- Açılışta kayıt: istemci MCP roots destekliyorsa açık klasörler oradan alınır (liste boşsa hiçbir şey kaydedilmez). Desteklemiyorsa sunucunun başladığı dizin kullanılır. Ev dizini, `/` ve config'teki kök klasörler hiçbir zaman proje olarak kaydedilmez.
- Son aktivite tarihi `git` çalıştırılmadan, `.git/logs/HEAD` dosyasının değişiklik zamanından okunur; yüzlerce projede bile hızlı kalır.
- **Açık:** Cursor'ın sunucuyu hangi dizinde başlattığı ve roots gönderip göndermediği henüz gerçek Cursor'da denenmedi.
- Kartlarda Cursor/VS Code linkleri yerine tek bir **Claude** linki var (2026-11-15, kullanıcı denedi ve çalıştı). Link sırasıyla şunlardan birine gider: klasördeki en son masaüstü oturumu (`claude://code/continue?session=local_…`, kaynak: `~/Library/Application Support/Claude/claude-code-sessions`), en son terminal oturumu (`claude://resume?session=<uuid>`) ya da o klasörde yeni oturum (`claude://code/new?folder=…`). Bu linkler ve dosyalar Claude uygulamasının belgelenmemiş iç parçaları; okunamazsa link "yeni oturum"a düşer.
- **Cursor (2026-11-15, Cursor 3.24'te ölçüldü):** Cursor Foldex'i iki süreçle başlatıyor. Agent süreci (istemci adı `Cursor`) sunucuyu açık klasörde başlatıyor ve roots göndermiyor; kayıt `cwd` ile çalışıyor. Ana süreç (`cursor-vscode`) ev dizininde başlıyor ve roots'u `file://` yerine düz yol olarak gönderiyor; SDK'nın katı şeması bunu reddettiği için roots ham olarak okunuyor. Ek ayar gerekmiyor. Kartlarda Cursor linki (`cursor://file/<yol>`), Cursor'dan kayıtlı bir proje varsa görünüyor; Claude linki Claude uygulaması yüklüyse.
- **VS Code (2026-11-16, VS Code 1.144'te ölçüldü):** İstemci adı `Visual Studio Code`, sunucuyu ev dizininde başlatıyor ve roots'u doğru `file://` biçiminde gönderiyor, ama açılışta liste boş; klasör sonradan geliyor. Foldex `roots/list_changed` bildirimini dinliyor ve araç çağrılarında (30 sn'de bir) klasörleri yeniden soruyor. Klasör açık değilken sohbet Copilot ajanı (`copilot-cli`) üzerinden `~/.copilot/chats/<id>` içinde çalışıyor; gizli klasörlerin içi bu yüzden hiç kaydedilmiyor. Kurulum: `code --add-mcp`.
- Kök klasör artık isteğe bağlı (2026-11-15): argüman verilmezse ev dizini taranır. Kurulum tek satır: `npx -y foldex-mcp`. Klasör vermek sadece taramayı daraltmak isteyenler için.
